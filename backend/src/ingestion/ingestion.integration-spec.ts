import { readFileSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';

import { createTestDataSource } from '../../test/test-db';
import { seed } from '../database/seeds/run-seed';
import { EventroSource } from './adapters/eventro.source';
import { RawExhibition } from './adapters/exhibition-source';
import { Fetcher, RawResponse } from '../common/http/fetcher';
import { IngestionService } from './ingestion.service';
import { Normalizer } from './normalizer/normalizer';
import { DbReferenceResolver } from './normalizer/reference-resolver';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '../../test/fixtures', name), 'utf8');

const TEHRAN_LISTING = fixture('eventro-tehran.html');
const EVENT_DETAIL = fixture('eventro-event-53066.html');

const fixtureFetcher: Fetcher = {
  async get(url: string): Promise<RawResponse> {
    const body = url.includes('/tc/fairs/tehran')
      ? TEHRAN_LISTING
      : url.includes('/events/53066')
        ? EVENT_DETAIL
        : '<html></html>';
    return { url, status: 200, body, headers: {}, notModified: false };
  },
};

describe('ingestion pipeline', () => {
  let dataSource: DataSource;
  let service: IngestionService;

  const query = async <T = any>(sql: string, params: unknown[] = []): Promise<T[]> =>
    dataSource.query(sql, params);

  beforeAll(async () => {
    dataSource = await createTestDataSource('ingestion');
    await seed(dataSource);
    service = new IngestionService(dataSource, new Normalizer(new DbReferenceResolver(dataSource)));
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  /** Wipes ingested data between blocks, leaving reference data in place. */
  const resetIngested = async () => {
    await query('TRUNCATE exhibition_source_records, exhibition_changes, exhibitions CASCADE');
  };

  const rawFor = (overrides: Partial<RawExhibition> = {}): RawExhibition => ({
    sourceExternalId: '90001',
    sourceUrl: 'https://eventro.ir/events/90001',
    title: 'نمایشگاه بین المللی صنعت مبلمان تهران',
    startDate: '2026-09-11',
    endDate: '2026-09-14',
    venue: 'محل دائمی نمایشگاه های بین المللی تهران',
    city: 'تهران',
    category: 'خانه، خانه داری و دکوراسیون',
    organizer: 'شرکت نمونه',
    ...overrides,
  });

  describe('from the real Eventro fixtures', () => {
    beforeAll(async () => {
      await resetIngested();
      const source = new EventroSource();
      const result = await source.fetchExhibitions({
        fetcher: fixtureFetcher,
        locations: ['tehran'],
      });
      await service.ingest('eventro', result.exhibitions);
    });

    it('creates exhibitions from real source data', async () => {
      const [row] = await query<{ count: string }>('SELECT count(*) FROM exhibitions');
      expect(Number(row.count)).toBeGreaterThan(5);
    });

    it('stores the dates the source published, unchanged', async () => {
      const [row] = await query<{ start_date: string; end_date: string; date_status: string }>(
        `SELECT e.start_date, e.end_date, e.date_status
         FROM exhibitions e
         JOIN exhibition_source_records r ON r.exhibition_id = e.id
         WHERE r.source_external_id = '53066'`,
      );
      expect(row.start_date).toBe('2026-08-31');
      expect(row.end_date).toBe('2026-09-03');
      expect(row.date_status).toBe('CONFIRMED');
    });

    it('resolves the venue through the seeded alias table', async () => {
      // The source writes "محل دائمی نمایشگاه های بین المللی تهران"; the seed
      // maps that spelling onto the Tehran fairground.
      const [row] = await query<{ slug: string }>(
        `SELECT v.slug
         FROM exhibitions e
         JOIN venues v ON v.id = e.venue_id
         JOIN exhibition_source_records r ON r.exhibition_id = e.id
         WHERE r.source_external_id = '53066'`,
      );
      expect(row.slug).toBe('tehran-international-fairground');
    });

    it('marks an exhibition UNKNOWN when only the listing date was available', async () => {
      // Every record except 53066 lacks a detail page in the fixture set, so it
      // has a start date and no end date. Rule 58 forbids inventing the end.
      const rows = await query<{ date_status: string; end_date: string | null }>(
        `SELECT date_status, end_date FROM exhibitions WHERE end_date IS NULL`,
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.date_status === 'UNKNOWN')).toBe(true);
    });

    it('gives every exhibition a traceable source record', async () => {
      const [row] = await query<{ count: string }>(
        `SELECT count(*) FROM exhibitions e
         WHERE NOT EXISTS (
           SELECT 1 FROM exhibition_source_records r WHERE r.exhibition_id = e.id
         )`,
      );
      expect(Number(row.count)).toBe(0);
    });

    it('keeps the raw payload, including the upstream source eventro cites', async () => {
      const [row] = await query<{ raw_payload: Record<string, unknown> }>(
        `SELECT raw_payload FROM exhibition_source_records WHERE source_external_id = '53066'`,
      );
      expect(String(row.raw_payload.upstreamUrl)).toContain('calendar.iranfair.com');
    });

    it('writes a Persian translation row rather than a title column', async () => {
      const [row] = await query<{ title: string }>(
        `SELECT t.title
         FROM exhibition_translations t
         JOIN exhibition_source_records r ON r.exhibition_id = t.exhibition_id
         WHERE r.source_external_id = '53066' AND t.locale = 'fa'`,
      );
      expect(row.title).toContain('الکامپ');
    });

    it('is idempotent when the same data is ingested again', async () => {
      const [before] = await query<{ count: string }>('SELECT count(*) FROM exhibitions');

      const source = new EventroSource();
      const result = await source.fetchExhibitions({
        fetcher: fixtureFetcher,
        locations: ['tehran'],
      });
      const summary = await service.ingest('eventro', result.exhibitions);

      const [after] = await query<{ count: string }>('SELECT count(*) FROM exhibitions');
      expect(after.count).toBe(before.count);
      expect(summary.created).toBe(0);
    });
  });

  describe('two sources reporting the same exhibition', () => {
    beforeEach(async () => {
      await resetIngested();
    });

    it('merges them into one exhibition', async () => {
      await service.ingest('eventro', [rawFor()]);
      await service.ingest('exhibitionmakers', [
        rawFor({
          sourceExternalId: 'em-1',
          sourceUrl: 'https://exhibitionmakers.com/e/1',
          title: 'نمایشگاه صنعت مبلمان تهران',
        }),
      ]);

      const [row] = await query<{ count: string }>('SELECT count(*) FROM exhibitions');
      expect(Number(row.count)).toBe(1);

      const [records] = await query<{ count: string }>(
        'SELECT count(*) FROM exhibition_source_records',
      );
      expect(Number(records.count)).toBe(2);
    });

    it('raises confidence when two independent sources agree on the dates', async () => {
      await service.ingest('eventro', [rawFor()]);
      const [before] = await query<{ confidence: string }>('SELECT confidence FROM exhibitions');
      expect(Number(before.confidence)).toBeCloseTo(0.7, 2);

      await service.ingest('exhibitionmakers', [
        rawFor({ sourceExternalId: 'em-1', sourceUrl: 'https://exhibitionmakers.com/e/1' }),
      ]);

      const [after] = await query<{ confidence: string }>('SELECT confidence FROM exhibitions');
      expect(Number(after.confidence)).toBeGreaterThanOrEqual(0.9);
    });

    it('records a CONFLICT instead of picking a winner when dates disagree', async () => {
      await service.ingest('eventro', [rawFor()]);
      await service.ingest('exhibitionmakers', [
        rawFor({
          sourceExternalId: 'em-1',
          sourceUrl: 'https://exhibitionmakers.com/e/1',
          startDate: '2026-09-13',
          endDate: '2026-09-16',
        }),
      ]);

      const [exhibition] = await query<{
        date_status: string;
        review_status: string;
        start_date: string;
        confidence: string;
      }>('SELECT date_status, review_status, start_date, confidence FROM exhibitions');

      expect(exhibition.date_status).toBe('CONFLICT');
      expect(exhibition.review_status).toBe('PENDING_REVIEW');
      // The first, more-established dates are kept on display.
      expect(exhibition.start_date).toBe('2026-09-11');
      // A contested date must not look well established.
      expect(Number(exhibition.confidence)).toBeLessThanOrEqual(0.7);
    });

    it('keeps both stories on a conflict so an admin can compare them', async () => {
      await service.ingest('eventro', [rawFor()]);
      await service.ingest('exhibitionmakers', [
        rawFor({
          sourceExternalId: 'em-1',
          sourceUrl: 'https://exhibitionmakers.com/e/1',
          startDate: '2026-09-13',
          endDate: '2026-09-16',
        }),
      ]);

      const rows = await query<{ source_start_date: string }>(
        `SELECT source_start_date FROM exhibition_source_records ORDER BY source_start_date`,
      );
      const dates = rows.map((row) => row.source_start_date);
      expect(dates).toEqual(['2026-09-11', '2026-09-13']);
    });

    it('lets a more trusted source correct the dates and logs the change', async () => {
      await service.ingest('eventro', [rawFor()]);

      // iranfair carries confidence 1.00, above eventro's 0.70.
      await query(`UPDATE sources SET is_enabled = true WHERE name = 'iranfair'`);
      await service.ingest('iranfair', [
        rawFor({
          sourceExternalId: 'if-1',
          sourceUrl: 'https://calendar.iranfair.com/e/1',
          startDate: '2026-09-13',
          endDate: '2026-09-16',
        }),
      ]);

      const [exhibition] = await query<{ start_date: string; date_status: string }>(
        'SELECT start_date, date_status FROM exhibitions',
      );
      expect(exhibition.start_date).toBe('2026-09-13');
      expect(exhibition.date_status).toBe('CONFIRMED');

      const changes = await query<{ field: string; old_value: string; new_value: string }>(
        `SELECT field, old_value, new_value FROM exhibition_changes ORDER BY field`,
      );
      const startChange = changes.find((change) => change.field === 'start_date');
      expect(startChange).toBeDefined();
      expect(startChange!.old_value).toContain('2026-09-11');
      expect(startChange!.new_value).toContain('2026-09-13');
    });

    it('leaves the change unprocessed so reminders can be recalculated', async () => {
      await service.ingest('eventro', [rawFor()]);
      await query(`UPDATE sources SET is_enabled = true WHERE name = 'iranfair'`);
      await service.ingest('iranfair', [
        rawFor({
          sourceExternalId: 'if-1',
          sourceUrl: 'https://calendar.iranfair.com/e/1',
          startDate: '2026-09-13',
          endDate: '2026-09-16',
        }),
      ]);

      const [row] = await query<{ count: string }>(
        `SELECT count(*) FROM exhibition_changes WHERE processed_at IS NULL`,
      );
      expect(Number(row.count)).toBeGreaterThan(0);
    });
  });

  describe('records with missing information', () => {
    beforeEach(async () => {
      await resetIngested();
    });

    it('stores a dateless exhibition as UNKNOWN rather than dropping it', async () => {
      const summary = await service.ingest('eventro', [
        rawFor({ startDate: undefined, endDate: undefined }),
      ]);

      expect(summary.created).toBe(1);
      const [row] = await query<{ date_status: string; start_date: string | null }>(
        'SELECT date_status, start_date FROM exhibitions',
      );
      expect(row.date_status).toBe('UNKNOWN');
      expect(row.start_date).toBeNull();
    });

    it('fills a previously unknown date without calling it a conflict', async () => {
      await service.ingest('eventro', [rawFor({ startDate: undefined, endDate: undefined })]);
      await service.ingest('eventro', [rawFor()]);

      const [row] = await query<{ date_status: string; start_date: string }>(
        'SELECT date_status, start_date FROM exhibitions',
      );
      expect(row.date_status).toBe('CONFIRMED');
      expect(row.start_date).toBe('2026-09-11');

      const [changes] = await query<{ count: string }>('SELECT count(*) FROM exhibition_changes');
      expect(Number(changes.count)).toBe(0);
    });

    it('rejects a record with no usable title', async () => {
      const summary = await service.ingest('eventro', [rawFor({ title: '   ' })]);
      expect(summary.created).toBe(0);
      expect(summary.failed).toBe(1);
      expect(summary.errors[0]).toContain('title is required');
    });

    it('rejects a record whose dates are inverted', async () => {
      const summary = await service.ingest('eventro', [
        rawFor({ startDate: '2026-09-16', endDate: '2026-09-11' }),
      ]);
      expect(summary.failed).toBe(1);
      expect(summary.errors[0]).toContain('after endDate');
    });

    it('warns about an unmapped venue instead of inventing one', async () => {
      const summary = await service.ingest('eventro', [
        rawFor({ venue: 'سالن کاملا ناشناخته', title: 'نمایشگاه یکتا برای تست ونیو' }),
      ]);

      expect(summary.warnings.some((warning) => warning.includes('unmapped venue'))).toBe(true);
      const [row] = await query<{ count: string }>(
        `SELECT count(*) FROM venues WHERE name_fa = 'سالن کاملا ناشناخته'`,
      );
      expect(Number(row.count)).toBe(0);
    });

    it('reports an unknown source rather than failing silently', async () => {
      const summary = await service.ingest('does-not-exist', [rawFor()]);
      expect(summary.errors[0]).toContain('unknown source');
      expect(summary.failed).toBe(1);
    });
  });

  describe('dry run', () => {
    beforeEach(async () => {
      await resetIngested();
    });

    it('reports what would happen without writing anything', async () => {
      const summary = await service.ingest('eventro', [rawFor()], { dryRun: true });

      expect(summary.created).toBe(1);
      const [row] = await query<{ count: string }>('SELECT count(*) FROM exhibitions');
      expect(Number(row.count)).toBe(0);
    });

    it('detects that a second run would deduplicate', async () => {
      await service.ingest('eventro', [rawFor()]);
      const summary = await service.ingest(
        'exhibitionmakers',
        [rawFor({ sourceExternalId: 'em-1', sourceUrl: 'https://exhibitionmakers.com/e/1' })],
        { dryRun: true },
      );

      expect(summary.created).toBe(0);
      expect(summary.duplicates).toBe(1);
    });
  });
});
