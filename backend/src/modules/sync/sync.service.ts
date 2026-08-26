import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { FETCHER_FACTORY, FetcherFactory } from '../../common/http/fetcher.factory';
import { DEFAULT_LOCATIONS, buildAdapter } from '../../ingestion/adapter-registry';
import { RawExhibition } from '../../ingestion/adapters/exhibition-source';
import { IngestSummary, IngestionService } from '../../ingestion/ingestion.service';
import { Normalizer } from '../../ingestion/normalizer/normalizer';
import { DbReferenceResolver } from '../../ingestion/normalizer/reference-resolver';
import { ChangeProcessingResult, ChangeProcessor } from './change-processor';
import { returningRow } from '../../common/db/returning';

export interface SyncOptions {
  /** Sync one source only. Omitted means every enabled source with an adapter. */
  source?: string;
  dryRun?: boolean;
  locations?: string[];
  maxDetailFetches?: number;
  /** How many listing pages to walk, which is how much history to carry. */
  maxListPages?: number;
}

export interface SourceSyncResult {
  source: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
  fetched: number;
  created: number;
  updated: number;
  duplicates: number;
  conflicts: number;
  review: number;
  failed: number;
  durationMs: number;
  error?: string;
}

export interface SyncResult {
  startedAt: string;
  finishedAt: string;
  sources: SourceSyncResult[];
  changes: ChangeProcessingResult;
  remindersScheduled: number;
  lockSkipped?: boolean;
}

interface SourceRow {
  id: string;
  name: string;
  is_enabled: boolean;
  fetch_mode: 'DIRECT' | 'RELAY';
  rate_limit_per_sec: number;
  consecutive_failures: number;
}

const LOCK_NAME = 'ingestion';

/**
 * Orchestrates a scheduled ingestion run.
 *
 * Three responsibilities the ingestion pipeline deliberately does not own:
 * choosing which sources to run, recording how each run went, and turning the
 * detected changes into rescheduled reminders.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(FETCHER_FACTORY) private readonly fetchers: FetcherFactory,
    private readonly changeProcessor: ChangeProcessor,
  ) {}

  async run(options: SyncOptions = {}): Promise<SyncResult> {
    const startedAt = new Date();

    // The scheduler and a manual run can overlap. A durable lock row is used
    // rather than an advisory lock because an advisory lock dies with its
    // session, and a crashed run would leave the next one blocked forever;
    // a row carries an expiry that lets the next run take over.
    const acquired = await this.acquireLock();
    if (!acquired) {
      this.logger.warn('another sync is already running, skipping');
      return {
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        sources: [],
        changes: emptyChanges(),
        remindersScheduled: 0,
        lockSkipped: true,
      };
    }

    try {
      const sources = await this.selectSources(options.source);
      const results: SourceSyncResult[] = [];

      for (const source of sources) {
        results.push(await this.syncSource(source, options));
      }

      // Reminders are only touched after ingestion, so a run that moved a date
      // reschedules in the same pass.
      const changes = options.dryRun
        ? emptyChanges()
        : await this.changeProcessor.processPending();
      const remindersScheduled = options.dryRun
        ? 0
        : await this.changeProcessor.scheduleWaitingReminders();

      return {
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        sources: results,
        changes,
        remindersScheduled,
      };
    } finally {
      await this.releaseLock();
    }
  }

  /**
   * Hand-curated exhibitions, bypassing the adapter/fetcher entirely.
   *
   * Exists for venues whose own site is too unstructured to scrape (see the
   * "manual" source's notes in seed-data.ts). Goes through the same
   * IngestionService as every adapter, so a manual entry still gets a
   * traceable exhibition_source_records row, dedup against anything an
   * adapter already found, and conflict detection if another source
   * disagrees on the dates.
   */
  async ingestManual(raws: RawExhibition[]): Promise<IngestSummary> {
    const ingestion = new IngestionService(
      this.dataSource,
      new Normalizer(new DbReferenceResolver(this.dataSource)),
    );
    return ingestion.ingest('manual', raws);
  }

  /**
   * Admin dedup fix-up: folds one exhibition into another.
   *
   * Needed because the automatic matcher in IngestionService only merges when
   * its similarity score crosses a threshold — a manual entry and an adapter
   * record for the same real-world event can still end up as two rows if
   * their titles are worded very differently, even with identical dates and
   * venue. This is the same operation a future admin Review Queue (roadmap
   * phase 5) would perform; it just has no UI yet.
   */
  async mergeExhibitions(fromId: string, intoId: string): Promise<{ merged: boolean }> {
    if (fromId === intoId) return { merged: false };

    return this.dataSource.transaction(async (manager) => {
      const [[target], [source]] = await Promise.all([
        manager.query(`SELECT id FROM exhibitions WHERE id = $1 FOR UPDATE`, [intoId]),
        manager.query(`SELECT id FROM exhibitions WHERE id = $1 FOR UPDATE`, [fromId]),
      ]);
      if (!target || !source) return { merged: false };

      // Fill in whatever the surviving row is missing before the losing row
      // is gone for good.
      await manager.query(
        `UPDATE exhibitions e SET
           official_website    = COALESCE(e.official_website, f.official_website),
           image_url           = COALESCE(e.image_url, f.image_url),
           primary_category_id = COALESCE(e.primary_category_id, f.primary_category_id),
           organizer_id        = COALESCE(e.organizer_id, f.organizer_id),
           venue_id            = COALESCE(e.venue_id, f.venue_id),
           search_text         = CASE WHEN length(f.search_text) > length(e.search_text)
                                      THEN f.search_text ELSE e.search_text END,
           updated_at          = now()
         FROM exhibitions f
         WHERE e.id = $2 AND f.id = $1`,
        [fromId, intoId],
      );

      await manager.query(
        `UPDATE exhibition_source_records SET exhibition_id = $2 WHERE exhibition_id = $1`,
        [fromId, intoId],
      );
      await manager.query(
        `UPDATE exhibition_changes SET exhibition_id = $2 WHERE exhibition_id = $1`,
        [fromId, intoId],
      );
      // exhibition_translations and exhibition_categories cascade-delete with
      // the losing row; the surviving row already has its own of each.
      await manager.query(`DELETE FROM exhibitions WHERE id = $1`, [fromId]);

      const [row] = await manager.query(
        `SELECT e.date_status,
                (SELECT max(s.confidence)
                   FROM exhibition_source_records r
                   JOIN sources s ON s.id = r.source_id
                  WHERE r.exhibition_id = e.id) AS best,
                (SELECT count(DISTINCT r.source_id)
                   FROM exhibition_source_records r
                  WHERE r.exhibition_id = e.id
                    AND r.source_start_date IS NOT DISTINCT FROM e.start_date
                    AND r.source_end_date IS NOT DISTINCT FROM e.end_date) AS agreeing
         FROM exhibitions e WHERE e.id = $1`,
        [intoId],
      );
      if (row) {
        const best = Number(row.best ?? 0.4);
        const agreeing = Number(row.agreeing ?? 0);
        let confidence = best;
        if (row.date_status === 'CONFLICT') confidence = Math.min(best, 0.7);
        else if (agreeing >= 2) confidence = Math.max(best, 0.9);
        await manager.query(`UPDATE exhibitions SET confidence = $2 WHERE id = $1`, [
          intoId,
          confidence.toFixed(2),
        ]);
      }

      return { merged: true };
    });
  }

  /**
   * Source monitoring, section 28: what each source did on its last run and
   * whether it is currently healthy.
   */
  async sourceStatus() {
    const rows = await this.dataSource.query(
      `SELECT s.name, s.display_name, s.confidence, s.fetch_mode::text AS fetch_mode,
              s.is_enabled, s.sync_interval_hours, s.last_success_at, s.last_failure_at,
              s.last_error, s.consecutive_failures,
              r.status::text AS last_run_status, r.started_at AS last_run_started_at,
              r.finished_at AS last_run_finished_at, r.fetched_count, r.created_count,
              r.updated_count, r.duplicate_count, r.conflict_count, r.failed_count
       FROM sources s
       LEFT JOIN LATERAL (
         SELECT * FROM sync_runs WHERE source_id = s.id ORDER BY started_at DESC LIMIT 1
       ) r ON true
       ORDER BY s.confidence DESC, s.name`,
    );

    return rows.map((row: any) => ({
      name: row.name,
      displayName: row.display_name,
      confidence: Number(row.confidence),
      fetchMode: row.fetch_mode,
      isEnabled: row.is_enabled,
      // Reported so an operator can see at a glance which sources exist but
      // cannot run yet because they sit behind the Iranian block.
      hasAdapter: Boolean(buildAdapter(row.name)),
      syncIntervalHours: row.sync_interval_hours,
      lastSuccessAt: row.last_success_at,
      lastFailureAt: row.last_failure_at,
      lastError: row.last_error,
      consecutiveFailures: row.consecutive_failures,
      healthy: row.consecutive_failures < 3,
      lastRun: row.last_run_status
        ? {
            status: row.last_run_status,
            startedAt: row.last_run_started_at,
            finishedAt: row.last_run_finished_at,
            fetched: row.fetched_count,
            created: row.created_count,
            updated: row.updated_count,
            duplicates: row.duplicate_count,
            conflicts: row.conflict_count,
            failed: row.failed_count,
          }
        : null,
    }));
  }

  private async selectSources(name?: string): Promise<SourceRow[]> {
    if (name) {
      return this.dataSource.query(
        `SELECT id, name, is_enabled, fetch_mode::text AS fetch_mode,
                rate_limit_per_sec, consecutive_failures
         FROM sources WHERE name = $1`,
        [name],
      );
    }

    return this.dataSource.query(
      `SELECT id, name, is_enabled, fetch_mode::text AS fetch_mode,
              rate_limit_per_sec, consecutive_failures
       FROM sources WHERE is_enabled ORDER BY confidence DESC, name`,
    );
  }

  private async syncSource(source: SourceRow, options: SyncOptions): Promise<SourceSyncResult> {
    const started = Date.now();

    const base: SourceSyncResult = {
      source: source.name,
      status: 'SKIPPED',
      fetched: 0,
      created: 0,
      updated: 0,
      duplicates: 0,
      conflicts: 0,
      review: 0,
      failed: 0,
      durationMs: 0,
    };

    if (!source.is_enabled) {
      // Sources behind the Iranian block ship disabled; running them would only
      // produce timeouts and pollute the failure counters.
      return { ...base, error: 'source is disabled', durationMs: Date.now() - started };
    }

    const adapter = buildAdapter(source.name);
    if (!adapter) {
      return { ...base, error: 'no adapter implemented', durationMs: Date.now() - started };
    }

    const runId = options.dryRun ? undefined : await this.startRun(source.id);

    try {
      const fetcher = this.fetchers.forSource({
        name: source.name,
        fetchMode: source.fetch_mode,
        ratePerSecond: source.rate_limit_per_sec,
      });
      const locations = options.locations ?? DEFAULT_LOCATIONS[source.name] ?? ['tehran'];

      const fetched = await adapter.fetchExhibitions({
        fetcher,
        locations,
        maxDetailFetches: options.maxDetailFetches,
        maxListPages: options.maxListPages,
        logger: {
          debug: (message) => this.logger.debug(message),
          warn: (message) => this.logger.warn(message),
        },
      });

      const ingestion = new IngestionService(
        this.dataSource,
        new Normalizer(new DbReferenceResolver(this.dataSource)),
      );
      const summary = await ingestion.ingest(source.name, fetched.exhibitions, {
        dryRun: options.dryRun,
      });

      const status = this.deriveStatus(summary, fetched.warnings.length);
      const result: SourceSyncResult = {
        source: source.name,
        status,
        fetched: summary.fetched,
        created: summary.created,
        updated: summary.updated,
        duplicates: summary.duplicates,
        conflicts: summary.conflicts,
        review: summary.review,
        failed: summary.failed,
        durationMs: Date.now() - started,
        error: summary.errors[0],
      };

      if (runId) {
        await this.finishRun(runId, status, summary, fetched.warnings);
        await this.recordSourceOutcome(source, status, summary.errors[0]);
      }

      return result;
    } catch (error) {
      const message = (error as Error).message;

      if (runId) {
        await this.failRun(runId, message);
        await this.recordSourceOutcome(source, 'FAILED', message);
      }

      return {
        ...base,
        status: 'FAILED',
        error: message,
        durationMs: Date.now() - started,
      };
    }
  }

  private deriveStatus(
    summary: IngestSummary,
    fetchWarnings: number,
  ): 'SUCCESS' | 'PARTIAL' | 'FAILED' {
    if (summary.fetched === 0) return 'FAILED';
    if (summary.failed === summary.fetched) return 'FAILED';
    if (summary.failed > 0 || summary.errors.length > 0 || fetchWarnings > 0) return 'PARTIAL';
    return 'SUCCESS';
  }

  private async startRun(sourceId: string): Promise<string> {
    const [row] = await this.dataSource.query(
      `INSERT INTO sync_runs (source_id, status) VALUES ($1, 'RUNNING') RETURNING id`,
      [sourceId],
    );
    return row.id;
  }

  private async finishRun(
    runId: string,
    status: string,
    summary: IngestSummary,
    warnings: string[],
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE sync_runs SET
         status = $2::sync_status_enum, finished_at = now(),
         fetched_count = $3, created_count = $4, updated_count = $5,
         duplicate_count = $6, conflict_count = $7, failed_count = $8,
         error_message = $9, details = $10
       WHERE id = $1`,
      [
        runId,
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
          ingestWarnings: summary.warnings.slice(0, 50),
          fetchWarnings: warnings.slice(0, 50),
        }),
      ],
    );
  }

  private async failRun(runId: string, message: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE sync_runs SET status = 'FAILED', finished_at = now(), error_message = $2
       WHERE id = $1`,
      [runId, message],
    );
  }

  /**
   * Source monitoring, section 28. A run that fails repeatedly is escalated so
   * an admin finds out before the data quietly goes stale.
   */
  private async recordSourceOutcome(
    source: SourceRow,
    status: string,
    error?: string,
  ): Promise<void> {
    if (status === 'FAILED') {
      // Without returningRow this destructure yields the inner rows array
      // rather than a row, so the escalation below never fired.
      const row = returningRow<{ consecutive_failures: number }>(
        await this.dataSource.query(
          `UPDATE sources SET last_failure_at = now(), last_error = $2,
                  consecutive_failures = consecutive_failures + 1, updated_at = now()
           WHERE id = $1
           RETURNING consecutive_failures`,
          [source.id, error ?? 'unknown error'],
        ),
      );

      if (Number(row?.consecutive_failures ?? 0) >= 3) {
        this.logger.error(
          `source "${source.name}" has failed ${row?.consecutive_failures} times in a row: ${error ?? 'unknown error'}`,
        );
      }
      return;
    }

    await this.dataSource.query(
      `UPDATE sources SET last_success_at = now(), last_error = NULL,
              consecutive_failures = 0, updated_at = now()
       WHERE id = $1`,
      [source.id],
    );
  }

  private async acquireLock(ttlMinutes = 30): Promise<boolean> {
    const [row] = await this.dataSource.query(
      `INSERT INTO sync_locks (name, locked_at, expires_at, holder)
       VALUES ($1, now(), now() + ($2 || ' minutes')::interval, $3)
       ON CONFLICT (name) DO UPDATE
         SET locked_at = now(),
             expires_at = now() + ($2 || ' minutes')::interval,
             holder = $3
         WHERE sync_locks.expires_at < now()
       RETURNING name`,
      [LOCK_NAME, String(ttlMinutes), `pid-${process.pid}`],
    );

    return Boolean(row);
  }

  private async releaseLock(): Promise<void> {
    await this.dataSource.query(`DELETE FROM sync_locks WHERE name = $1`, [LOCK_NAME]);
  }
}

function emptyChanges(): ChangeProcessingResult {
  return {
    changesProcessed: 0,
    remindersRescheduled: 0,
    remindersUnscheduled: 0,
    notificationsCreated: 0,
  };
}
