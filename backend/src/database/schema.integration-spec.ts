import { DataSource } from 'typeorm';

import { createTestDataSource } from '../../test/test-db';
import { normalizeForSearch } from '../common/persian/persian.util';

/**
 * Applies every migration to a real PostgreSQL and asserts the schema behaves.
 *
 * The parity block is the important one. `persian_normalize_search` in SQL and
 * `normalizeForSearch` in TypeScript must agree exactly, because the first
 * builds the search index and the second builds the query. If they ever drift,
 * search returns nothing and no error is raised anywhere — this test is what
 * makes that failure loud.
 */
describe('database schema', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource('schema');
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  const query = async <T = any>(sql: string, params: unknown[] = []): Promise<T[]> =>
    dataSource.query(sql, params);

  describe('migrations', () => {
    it('applies cleanly and records every migration', async () => {
      const rows = await query<{ name: string }>('SELECT name FROM migrations ORDER BY id');
      expect(rows.length).toBe(5);
      expect(rows[0].name).toContain('InitExtensionsAndFunctions');
    });

    it('is idempotent when run again', async () => {
      const applied = await dataSource.runMigrations();
      expect(applied).toHaveLength(0);
    });

    it('installs the extensions the pipeline depends on', async () => {
      const rows = await query<{ extname: string }>(
        `SELECT extname FROM pg_extension WHERE extname IN ('pg_trgm', 'unaccent')`,
      );
      expect(rows.map((r) => r.extname).sort()).toEqual(['pg_trgm', 'unaccent']);
    });

    it('stores text as UTF8', async () => {
      const [row] = await query<{ encoding: string }>(
        `SELECT pg_encoding_to_char(encoding) AS encoding
         FROM pg_database WHERE datname = current_database()`,
      );
      expect(row.encoding).toBe('UTF8');
    });

    it('creates every table the brief requires', async () => {
      const rows = await query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      const tables = rows.map((r) => r.table_name);

      for (const expected of [
        'countries', 'cities', 'venues', 'categories', 'organizers',
        'exhibitions', 'exhibition_translations', 'exhibition_categories',
        'sources', 'exhibition_source_records', 'exhibition_changes', 'sync_runs',
        'users', 'auth_identities', 'favorites', 'reminders', 'notifications',
        'admin_users',
      ]) {
        expect(tables).toContain(expected);
      }
    });
  });

  describe('persian_normalize_search parity with normalizeForSearch', () => {
    // Realistic inputs: Persian, Latin, digits and punctuation are the domain
    // the ingestion pipeline actually sees.
    const corpus = [
      'نمایشگاه بین المللی الکترونیک، کامپیوتر و تجارت الکترونیکی (الکامپ) تهران 1405',
      'نمایشگاه‌های تهران',
      'نمایشگاه های تهران',
      'نمایشگاه مواد غذایی ۱۴۰۵ /اگروفود ۱۴۰۵',
      'نمايشگاه كتاب',
      'AGROFOOD Tehran 2026',
      'نمایشگاه صنعت مبلمان تهران - HOFEX',
      'اولین نمایشگاه پمپ، ولو، آب شیرین کن ها و صنایع وابسته تهران',
      'نمایشگاه   با    فاصله‌های   زیاد',
      '﻿نمایشگاه​کتاب',
      'نمایشگاه إیران أکسپو ٢٠٢٦',
      '',
      '   ',
    ];

    it.each(corpus)('matches TypeScript for %j', async (input) => {
      const [row] = await query<{ result: string }>(
        'SELECT persian_normalize_search($1) AS result',
        [input],
      );
      expect(row.result).toBe(normalizeForSearch(input));
    });

    it('collapses both plural spellings to the same key', async () => {
      const [row] = await query<{ a: string; b: string }>(
        `SELECT persian_normalize_search($1) AS a, persian_normalize_search($2) AS b`,
        ['نمایشگاه‌های تهران', 'نمایشگاه های تهران'],
      );
      expect(row.a).toBe(row.b);
    });

    it('does not destroy Persian letters under the C locale', async () => {
      // The reason the function avoids [:alnum:]: under a C-locale cluster that
      // class is ASCII-only and would erase the entire string.
      const [row] = await query<{ result: string }>(
        'SELECT persian_normalize_search($1) AS result',
        ['نمایشگاه کتاب تهران'],
      );
      expect(row.result).toBe('نمایشگاه کتاب تهران');
    });
  });

  describe('constraints that enforce the no-invented-dates rule', () => {
    let cityId: string;

    beforeAll(async () => {
      const [country] = await query<{ id: string }>(
        `INSERT INTO countries (iso2, name_fa, name_en) VALUES ('ZZ', 'سرزمین آزمایش', 'Testland')
         RETURNING id`,
      );
      const [city] = await query<{ id: string }>(
        `INSERT INTO cities (country_id, slug, name_fa, name_en, timezone)
         VALUES ($1, 'test-city', 'شهر آزمایش', 'Test City', 'Asia/Tehran') RETURNING id`,
        [country.id],
      );
      cityId = city.id;
    });

    const insertExhibition = (fields: string, values: unknown[]) =>
      query(
        `INSERT INTO exhibitions (slug, canonical_title, city_id, ${fields})
         VALUES ($1, $2, $3, ${values.map((_, i) => `$${i + 4}`).join(', ')})`,
        [`slug-${Math.random().toString(36).slice(2)}`, 'نمایشگاه آزمایشی', cityId, ...values],
      );

    it('allows an exhibition with no date at all', async () => {
      await expect(insertExhibition(`date_status`, ['UNKNOWN'])).resolves.toBeDefined();
    });

    it('refuses to mark a date CONFIRMED without dates', async () => {
      await expect(insertExhibition(`date_status`, ['CONFIRMED'])).rejects.toThrow(
        /chk_exhibitions_confirmed_has_dates/,
      );
    });

    it('accepts CONFIRMED once both dates are present', async () => {
      await expect(
        insertExhibition(`date_status, start_date, end_date`, [
          'CONFIRMED',
          '2026-08-31',
          '2026-09-03',
        ]),
      ).resolves.toBeDefined();
    });

    it('rejects an end date before the start date', async () => {
      await expect(
        insertExhibition(`start_date, end_date`, ['2026-09-03', '2026-08-31']),
      ).rejects.toThrow(/chk_exhibitions_date_order/);
    });

    it('rejects a confidence outside 0..1', async () => {
      await expect(insertExhibition(`confidence`, [1.5])).rejects.toThrow(
        /chk_exhibitions_confidence_range/,
      );
    });
  });

  describe('search and dedup support', () => {
    let cityId: string;

    beforeAll(async () => {
      const [city] = await query<{ id: string }>(
        `SELECT id FROM cities WHERE slug = 'test-city'`,
      );
      cityId = city.id;
    });

    it('populates the generated normalized title and full-text vector', async () => {
      await query(
        `INSERT INTO exhibitions (slug, canonical_title, city_id, search_text)
         VALUES ('furniture-1405', $1, $2, $1)`,
        ['نمایشگاه‌های صنعت مبلمان تهران', cityId],
      );

      const [row] = await query<{ norm: string; hits: number }>(
        `SELECT canonical_title_norm AS norm,
                (search_vector @@ plainto_tsquery('simple', persian_normalize_search($1)))::int AS hits
         FROM exhibitions WHERE slug = 'furniture-1405'`,
        ['مبلمان'],
      );

      expect(row.norm).toBe('نمایشگاه های صنعت مبلمان تهران');
      expect(row.hits).toBe(1);
    });

    it('finds the row when the user types the other plural spelling', async () => {
      const [row] = await query<{ found: number }>(
        `SELECT count(*)::int AS found FROM exhibitions
         WHERE search_vector @@ plainto_tsquery('simple', persian_normalize_search($1))`,
        ['نمایشگاه های مبلمان'],
      );
      expect(row.found).toBeGreaterThan(0);
    });

    it('does not depend on pg_trgm for Persian similarity', async () => {
      // Documents why deduplication scores similarity in TypeScript.
      // pg_trgm's tokenizer follows the cluster's ctype. Under a C locale it
      // emits no trigrams at all for Persian, so similarity() returns 0 and a
      // trigram index would be empty. Supabase runs a UTF-8 locale where the
      // same call DOES work — which is exactly the trap: the score would differ
      // between CI and production. This asserts the property we actually rely
      // on (that nothing breaks either way), not a locale-specific number.
      const [row] = await query<{ trigrams: string[]; score: number }>(
        `SELECT show_trgm($1) AS trigrams,
                similarity($1, $2) AS score`,
        ['نمایشگاه صنعت مبلمان', 'نمایشگاه مبلمان'],
      );

      const isLocaleAware = row.trigrams.length > 0;
      if (isLocaleAware) {
        expect(Number(row.score)).toBeGreaterThan(0);
      } else {
        expect(Number(row.score)).toBe(0);
      }

      // Latin text tokenizes under every locale, which is why the extension is
      // still worth keeping for English titles.
      const [latin] = await query<{ score: number }>(
        `SELECT similarity('agrofood tehran', 'agrofood tehran 2026') AS score`,
      );
      expect(Number(latin.score)).toBeGreaterThan(0);
    });
  });

  describe('ingestion and engagement constraints', () => {
    it('keeps one record per external id per source', async () => {
      const [source] = await query<{ id: string }>(
        `INSERT INTO sources (name, display_name, base_url, confidence)
         VALUES ('test-source', 'Test Source', 'https://example.test', 0.70) RETURNING id`,
      );

      const insert = () =>
        query(
          `INSERT INTO exhibition_source_records
             (source_id, source_external_id, source_url, source_title, content_hash)
           VALUES ($1, '53066', 'https://eventro.ir/tc/fairs/tehran', 'الکامپ', 'hash1')`,
          [source.id],
        );

      await expect(insert()).resolves.toBeDefined();
      await expect(insert()).rejects.toThrow(/idx_source_records_external/);
    });

    it('forces a favourite to target either an exhibition or a category, not both', async () => {
      const [user] = await query<{ id: string }>(
        `INSERT INTO users (anonymous_device_id) VALUES ('device-1') RETURNING id`,
      );
      const [exhibition] = await query<{ id: string }>(
        `SELECT id FROM exhibitions WHERE slug = 'furniture-1405'`,
      );
      const [category] = await query<{ id: string }>(
        `INSERT INTO categories (slug, name_fa, name_en)
         VALUES ('test-furniture', 'مبلمان آزمایشی', 'Test Furniture') RETURNING id`,
      );

      await expect(
        query(`INSERT INTO favorites (user_id, exhibition_id, category_id) VALUES ($1, $2, $3)`, [
          user.id,
          exhibition.id,
          category.id,
        ]),
      ).rejects.toThrow(/chk_favorites_exactly_one_target/);

      await expect(
        query(`INSERT INTO favorites (user_id, category_id) VALUES ($1, $2)`, [
          user.id,
          category.id,
        ]),
      ).resolves.toBeDefined();
    });

    it('allows a reminder with no instant yet when the date is unknown', async () => {
      const [user] = await query<{ id: string }>(`SELECT id FROM users LIMIT 1`);
      const [exhibition] = await query<{ id: string }>(
        `SELECT id FROM exhibitions WHERE slug = 'furniture-1405'`,
      );

      await expect(
        query(
          `INSERT INTO reminders (user_id, exhibition_id, reminder_type, offset_days)
           VALUES ($1, $2, 'DAYS_7', 7)`,
          [user.id, exhibition.id],
        ),
      ).resolves.toBeDefined();
    });

    it('rejects a negative reminder offset', async () => {
      const [user] = await query<{ id: string }>(`SELECT id FROM users LIMIT 1`);
      const [exhibition] = await query<{ id: string }>(
        `SELECT id FROM exhibitions WHERE slug = 'furniture-1405'`,
      );

      await expect(
        query(
          `INSERT INTO reminders (user_id, exhibition_id, reminder_type, offset_days)
           VALUES ($1, $2, 'CUSTOM', -1)`,
          [user.id, exhibition.id],
        ),
      ).rejects.toThrow(/chk_reminders_offset_non_negative/);
    });
  });
});
