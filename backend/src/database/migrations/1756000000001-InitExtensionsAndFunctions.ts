import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Extensions, shared enums, and the SQL mirror of the Persian text normalizer.
 *
 * The normalizer is the reason this migration exists as hand-written SQL: the
 * search index must be built with exactly the same rules the application uses
 * when it builds a query. `persian_normalize_search` mirrors
 * `normalizeForSearch` in src/common/persian/persian.util.ts, and
 * persian-sql-parity.spec.ts asserts the two stay in step.
 */
export class InitExtensionsAndFunctions1756000000001 implements MigrationInterface {
  name = 'InitExtensionsAndFunctions1756000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // pg_trgm is installed for Latin-script matching, but the deduplication
    // engine does NOT rely on it for Persian. Its tokenizer follows the
    // cluster's ctype: on a C-locale cluster show_trgm() returns an empty array
    // for Persian input, so a trigram index over Persian titles would be empty
    // and similarity() would always return 0. Supabase runs a UTF-8 locale
    // where it does work, which is the dangerous case -- local and CI would
    // silently disagree with production. Similarity is therefore scored in
    // TypeScript, where it is deterministic everywhere.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS unaccent`);

    // ---------------------------------------------------------------------
    // Persian normalization
    //
    // Character classes are spelled out with chr() code points rather than
    // POSIX classes such as [:alnum:], because POSIX classes follow the
    // database's ctype. On a C-locale cluster [:alnum:] matches ASCII only,
    // which would silently delete every Persian letter and leave the search
    // index empty. Explicit code points behave identically everywhere.
    // ---------------------------------------------------------------------

    // Harakat (U+064B..U+0652), superscript alef (U+0670), tatweel (U+0640),
    // and the zero-width characters that arrive with copy-pasted HTML.
    const removable = [1611, 1612, 1613, 1614, 1615, 1616, 1617, 1618, 1648, 1600, 8203, 8205, 8206, 8207, 65279]
      .map((code) => `chr(${code})`)
      .join(' || ');

    // Keep Latin letters, digits, spaces, and Arabic-script LETTERS only.
    //
    // The ranges are deliberately narrow rather than the whole Arabic block:
    // U+0600..U+06FF also contains punctuation such as the Arabic comma
    // (U+060C) and full stop (U+06D4). Keeping the whole block would leave
    // that punctuation in the search key while the TypeScript side strips it,
    // and the two normalizers would disagree.
    //   U+0621..U+064A  core Arabic letters
    //   U+066E..U+06D3  extended letters, including Persian p/ch/zh/g/k/y
    const keptCharacters =
      "'[^a-z0-9 ' || chr(1569) || '-' || chr(1610) || chr(1646) || '-' || chr(1747) || ']'";

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION persian_fold(input text)
      RETURNS text
      LANGUAGE sql
      IMMUTABLE
      PARALLEL SAFE
      AS $$
        SELECT translate(
          coalesce(input, ''),
          -- Arabic look-alikes, then Persian and Arabic-Indic digits
          'يىكةؤئآأإٱ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩',
          'ییکهویاااا01234567890123456789'
        )
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION persian_normalize_search(input text)
      RETURNS text
      LANGUAGE sql
      IMMUTABLE
      PARALLEL SAFE
      AS $$
        SELECT btrim(
          regexp_replace(
            regexp_replace(
              lower(
                replace(
                  translate(persian_fold(input), ${removable}, ''),
                  -- ZWNJ marks a word boundary in Persian, so it becomes a
                  -- real space. This is what makes the two ways users type a
                  -- plural collapse to one key.
                  chr(8204), ' '
                )
              ),
              ${keptCharacters}, ' ', 'g'
            ),
            ' +', ' ', 'g'
          )
        )
      $$;
    `);

    // ---------------------------------------------------------------------
    // Enums
    // ---------------------------------------------------------------------
    const enums: Array<[string, string[]]> = [
      ['exhibition_status_enum', ['SCHEDULED', 'ONGOING', 'FINISHED', 'CANCELLED', 'POSTPONED']],
      // UNKNOWN and CONFLICT are first-class: the project never invents a date.
      ['date_status_enum', ['CONFIRMED', 'UNKNOWN', 'CONFLICT', 'POSTPONED']],
      ['event_type_enum', ['EXHIBITION', 'CONFERENCE', 'FESTIVAL', 'TRADE_SHOW', 'OTHER']],
      ['review_status_enum', ['AUTO_APPROVED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED']],
      ['fetch_mode_enum', ['DIRECT', 'RELAY']],
      ['sync_status_enum', ['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED']],
      [
        'reminder_type_enum',
        ['DAYS_30', 'DAYS_14', 'DAYS_7', 'DAYS_3', 'DAYS_1', 'START_DAY', 'CUSTOM'],
      ],
      ['auth_provider_enum', ['ANONYMOUS', 'GOOGLE', 'OTP', 'EMAIL']],
      ['user_tier_enum', ['FREE', 'PRO', 'BUSINESS']],
      [
        'notification_type_enum',
        ['REMINDER', 'DATE_CHANGE', 'VENUE_CHANGE', 'CANCELLED', 'NEW_EXHIBITION', 'DIGEST'],
      ],
      ['admin_role_enum', ['VIEWER', 'EDITOR', 'ADMIN']],
    ];

    for (const [name, values] of enums) {
      const literals = values.map((value) => `'${value}'`).join(', ');
      await queryRunner.query(`
        DO $$ BEGIN
          CREATE TYPE ${name} AS ENUM (${literals});
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const enumNames = [
      'admin_role_enum',
      'notification_type_enum',
      'user_tier_enum',
      'auth_provider_enum',
      'reminder_type_enum',
      'sync_status_enum',
      'fetch_mode_enum',
      'review_status_enum',
      'event_type_enum',
      'date_status_enum',
      'exhibition_status_enum',
    ];

    for (const name of enumNames) {
      await queryRunner.query(`DROP TYPE IF EXISTS ${name}`);
    }

    await queryRunner.query(`DROP FUNCTION IF EXISTS persian_normalize_search(text)`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS persian_fold(text)`);
  }
}
