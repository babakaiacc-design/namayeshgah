import { DataSource } from 'typeorm';

import configuration from '../config/configuration';
import { DirectFetcher } from '../common/http/direct-fetcher';
import { dataSourceOptions } from '../database/data-source';
import { ADAPTERS, DEFAULT_LOCATIONS, buildAdapter, knownSources } from './adapter-registry';
import { IngestionService } from './ingestion.service';
import { Normalizer } from './normalizer/normalizer';
import { DbReferenceResolver } from './normalizer/reference-resolver';

/**
 * Manual sync entry point.
 *
 *   npm run sync -- --source=eventro --dry-run
 *   npm run sync -- --source=eventro --locations=tehran,germany
 *
 * The scheduled path goes through the API instead (see the GitHub Actions
 * workflow); this exists for development and for an operator who needs to pull
 * one source by hand.
 */

interface Args {
  source?: string;
  locations?: string[];
  dryRun: boolean;
  maxDetails?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false };

  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--source=')) args.source = arg.slice('--source='.length);
    else if (arg.startsWith('--locations=')) {
      args.locations = arg
        .slice('--locations='.length)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (arg.startsWith('--max-details=')) {
      args.maxDetails = Number.parseInt(arg.slice('--max-details='.length), 10);
    }
  }

  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.source) {
    console.error('usage: npm run sync -- --source=<name> [--dry-run] [--locations=a,b]');
    console.error(`known sources: ${knownSources().join(', ')}`);
    return 2;
  }

  const adapter = buildAdapter(args.source);
  if (!adapter) {
    console.error(`no adapter for source "${args.source}"`);
    console.error(`known sources: ${knownSources().join(', ')}`);
    return 2;
  }

  const config = configuration();
  const dataSource = new DataSource(dataSourceOptions);
  await dataSource.initialize();

  try {
    const [sourceRow] = await dataSource.query(
      `SELECT id, is_enabled, rate_limit_per_sec FROM sources WHERE name = $1`,
      [args.source],
    );

    if (!sourceRow) {
      console.error(`source "${args.source}" is not registered — run npm run seed first`);
      return 2;
    }
    if (!sourceRow.is_enabled) {
      // Blocked sources ship disabled on purpose; refusing here stops a run
      // that would only produce connection timeouts.
      console.error(`source "${args.source}" is disabled; enable it before syncing`);
      return 2;
    }

    const fetcher = new DirectFetcher({
      userAgent: config.fetch.userAgent,
      timeoutMs: config.fetch.timeoutMs,
      ratePerSecond: sourceRow.rate_limit_per_sec ?? config.fetch.ratePerSecond,
      maxRetries: config.fetch.maxRetries,
    });

    const locations = args.locations ?? DEFAULT_LOCATIONS[args.source] ?? ['tehran'];

    console.log(
      `[sync] ${args.source} locations=${locations.join(',')}${args.dryRun ? ' (dry run)' : ''}`,
    );

    const started = Date.now();
    const fetched = await adapter.fetchExhibitions({
      fetcher,
      locations,
      maxDetailFetches: args.maxDetails,
      logger: {
        debug: (message) => console.log(`[fetch] ${message}`),
        warn: (message) => console.warn(`[fetch] ${message}`),
      },
    });

    for (const warning of fetched.warnings) console.warn(`[fetch] ${warning}`);
    console.log(`[sync] fetched ${fetched.exhibitions.length} records`);

    const service = new IngestionService(
      dataSource,
      new Normalizer(new DbReferenceResolver(dataSource)),
    );
    const summary = await service.ingest(args.source, fetched.exhibitions, {
      dryRun: args.dryRun,
    });

    for (const warning of summary.warnings.slice(0, 20)) console.warn(`[ingest] ${warning}`);
    for (const error of summary.errors.slice(0, 20)) console.error(`[ingest] ${error}`);

    console.log(
      `[sync] created=${summary.created} updated=${summary.updated} ` +
        `duplicates=${summary.duplicates} conflicts=${summary.conflicts} ` +
        `review=${summary.review} failed=${summary.failed} ` +
        `in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );

    if (!args.dryRun) {
      await recordSyncRun(dataSource, sourceRow.id, summary, fetched.warnings.length);
    }

    // A run where nothing could be ingested is a failure worth a non-zero exit,
    // so a scheduled caller notices.
    return summary.fetched > 0 && summary.failed === summary.fetched ? 1 : 0;
  } finally {
    await dataSource.destroy();
  }
}

async function recordSyncRun(
  dataSource: DataSource,
  sourceId: string,
  summary: {
    fetched: number;
    created: number;
    updated: number;
    duplicates: number;
    conflicts: number;
    failed: number;
    errors: string[];
    warnings: string[];
  },
  fetchWarnings: number,
): Promise<void> {
  const status =
    summary.fetched === 0 || summary.failed === summary.fetched
      ? 'FAILED'
      : summary.failed > 0 || fetchWarnings > 0
        ? 'PARTIAL'
        : 'SUCCESS';

  await dataSource.query(
    `INSERT INTO sync_runs (
       source_id, status, started_at, finished_at, fetched_count, created_count,
       updated_count, duplicate_count, conflict_count, failed_count, error_message, details
     ) VALUES ($1, $2::sync_status_enum, now(), now(), $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      sourceId,
      status,
      summary.fetched,
      summary.created,
      summary.updated,
      summary.duplicates,
      summary.conflicts,
      summary.failed,
      summary.errors[0] ?? null,
      JSON.stringify({
        errors: summary.errors.slice(0, 50),
        warnings: summary.warnings.slice(0, 50),
      }),
    ],
  );

  if (status === 'FAILED') {
    await dataSource.query(
      `UPDATE sources SET last_failure_at = now(), last_error = $2,
              consecutive_failures = consecutive_failures + 1, updated_at = now()
       WHERE id = $1`,
      [sourceId, summary.errors[0] ?? 'no records ingested'],
    );
  } else {
    await dataSource.query(
      `UPDATE sources SET last_success_at = now(), consecutive_failures = 0, updated_at = now()
       WHERE id = $1`,
      [sourceId],
    );
  }
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error('[sync] fatal:', error);
      process.exit(1);
    });
}

export { parseArgs, main };
