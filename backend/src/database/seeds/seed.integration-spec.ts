import { DataSource } from 'typeorm';

import { createTestDataSource } from '../../../test/test-db';
import { CATEGORIES, SOURCES, VENUES } from './seed-data';
import { seed } from './run-seed';

describe('reference data seed', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource('seed');
    await seed(dataSource);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  const query = async <T = any>(sql: string, params: unknown[] = []): Promise<T[]> =>
    dataSource.query(sql, params);

  it('is idempotent', async () => {
    const before = await query<{ count: string }>('SELECT count(*) FROM categories');
    await seed(dataSource);
    const after = await query<{ count: string }>('SELECT count(*) FROM categories');
    expect(after[0].count).toBe(before[0].count);
  });

  it('creates Tehran with a real IANA timezone', async () => {
    const [city] = await query<{ timezone: string; country: string }>(
      `SELECT c.timezone, co.iso2 AS country
       FROM cities c JOIN countries co ON co.id = c.country_id
       WHERE c.slug = 'tehran'`,
    );
    expect(city.country).toBe('IR');
    expect(city.timezone).toBe('Asia/Tehran');

    // A bad zone name would only surface as wrongly-timed reminders, so assert
    // Postgres itself accepts it.
    const [check] = await query<{ ok: boolean }>(
      `SELECT (now() AT TIME ZONE $1) IS NOT NULL AS ok`,
      [city.timezone],
    );
    expect(check.ok).toBe(true);
  });

  it('creates every Tehran venue from the brief', async () => {
    const rows = await query<{ slug: string }>(`SELECT slug FROM venues`);
    const slugs = rows.map((r) => r.slug);
    for (const venue of VENUES) {
      expect(slugs).toContain(venue.slug);
    }
  });

  it('leaves venue coordinates null rather than guessing them', async () => {
    const rows = await query<{ slug: string }>(
      `SELECT slug FROM venues WHERE latitude IS NOT NULL OR longitude IS NOT NULL`,
    );
    expect(rows).toEqual([]);
  });

  it('builds the category tree with parents attached', async () => {
    const [furniture] = await query<{ parent_slug: string }>(
      `SELECT p.slug AS parent_slug
       FROM categories c JOIN categories p ON p.id = c.parent_id
       WHERE c.slug = 'furniture'`,
    );
    expect(furniture.parent_slug).toBe('home-lifestyle');

    const expectedTopLevel = CATEGORIES.length;
    const [top] = await query<{ count: string }>(
      `SELECT count(*) FROM categories WHERE parent_id IS NULL`,
    );
    expect(Number(top.count)).toBe(expectedTopLevel);
  });

  it('resolves a source category label through the alias table', async () => {
    // The literal label eventro.ir uses for its food category.
    const [row] = await query<{ slug: string }>(
      `SELECT c.slug
       FROM category_aliases a JOIN categories c ON c.id = a.category_id
       WHERE a.normalized = persian_normalize_search($1)`,
      ['صنایع غذایی و کشاورزی'],
    );
    expect(row.slug).toBe('food');
  });

  it('resolves a venue alias regardless of half-space spelling', async () => {
    const [withZwnj] = await query<{ slug: string }>(
      `SELECT v.slug FROM venue_aliases a JOIN venues v ON v.id = a.venue_id
       WHERE a.normalized = persian_normalize_search($1)`,
      ['نمایشگاه بین‌المللی تهران'],
    );
    const [withSpace] = await query<{ slug: string }>(
      `SELECT v.slug FROM venue_aliases a JOIN venues v ON v.id = a.venue_id
       WHERE a.normalized = persian_normalize_search($1)`,
      ['نمایشگاه بین المللی تهران'],
    );
    expect(withZwnj.slug).toBe('tehran-international-fairground');
    expect(withSpace.slug).toBe('tehran-international-fairground');
  });

  it('registers every source with its documented confidence', async () => {
    const rows = await query<{ name: string; confidence: string; is_enabled: boolean }>(
      `SELECT name, confidence, is_enabled FROM sources`,
    );
    const byName = new Map(rows.map((r) => [r.name, r]));

    for (const source of SOURCES) {
      const row = byName.get(source.name);
      expect(row).toBeDefined();
      expect(Number(row!.confidence)).toBeCloseTo(source.confidence, 2);
    }

    // The official source carries full trust but must stay switched off until
    // an Iranian egress exists — see DATA_SOURCES.md section 5.
    expect(Number(byName.get('iranfair')!.confidence)).toBe(1);
    expect(byName.get('iranfair')!.is_enabled).toBe(false);
    expect(byName.get('eventro')!.is_enabled).toBe(true);
  });

  it('seeds no exhibitions at all', async () => {
    // Rule 44: real exhibition data only ever arrives through ingestion, where
    // it carries a traceable source record.
    const [row] = await query<{ count: string }>(`SELECT count(*) FROM exhibitions`);
    expect(Number(row.count)).toBe(0);
  });
});
