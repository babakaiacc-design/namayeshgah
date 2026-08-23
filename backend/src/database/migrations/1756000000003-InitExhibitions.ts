import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The canonical exhibition record plus its translations and categories.
 *
 * Two decisions worth reading before changing anything here:
 *
 * 1. `start_date` is NULLABLE. Rule 58 of the brief forbids inventing a date,
 *    so an exhibition whose date no source has published is stored with
 *    date_status = 'UNKNOWN' and a null date. A CHECK constraint enforces the
 *    other half of that rule: a row may only claim 'CONFIRMED' if it actually
 *    has dates.
 *
 * 2. Titles live in `exhibition_translations`, not in columns. A fixed
 *    title/english_title pair cannot grow to the four languages on the roadmap.
 *    The parent table keeps only `canonical_title`, which exists for
 *    deduplication rather than display.
 */
export class InitExhibitions1756000000003 implements MigrationInterface {
  name = 'InitExhibitions1756000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE exhibitions (
        id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        slug                  text NOT NULL UNIQUE,

        canonical_title       text NOT NULL,
        canonical_title_norm  text GENERATED ALWAYS AS (persian_normalize_search(canonical_title)) STORED,

        event_type            event_type_enum NOT NULL DEFAULT 'EXHIBITION',
        status                exhibition_status_enum NOT NULL DEFAULT 'SCHEDULED',

        start_date            date,
        end_date              date,
        date_status           date_status_enum NOT NULL DEFAULT 'UNKNOWN',
        start_time            time,
        end_time              time,

        city_id               uuid NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
        venue_id              uuid REFERENCES venues(id) ON DELETE SET NULL,
        organizer_id          uuid REFERENCES organizers(id) ON DELETE SET NULL,
        primary_category_id   uuid REFERENCES categories(id) ON DELETE SET NULL,

        official_website      text,
        image_url             text,
        logo_url              text,
        tags                  text[] NOT NULL DEFAULT '{}',

        is_international      boolean NOT NULL DEFAULT false,
        is_specialized        boolean NOT NULL DEFAULT false,

        -- 0.00 to 1.00, derived from which sources agree. See DATA_SOURCES.md.
        confidence            numeric(3,2) NOT NULL DEFAULT 0.40,
        review_status         review_status_enum NOT NULL DEFAULT 'AUTO_APPROVED',

        -- Aggregate of title, organizer, venue and tags, maintained by the
        -- ingestion pipeline. search_vector is derived from it so the index can
        -- stay a generated column.
        search_text           text NOT NULL DEFAULT '',
        search_vector         tsvector GENERATED ALWAYS AS (
                                to_tsvector('simple', persian_normalize_search(search_text))
                              ) STORED,

        last_verified_at      timestamptz,
        created_at            timestamptz NOT NULL DEFAULT now(),
        updated_at            timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT chk_exhibitions_date_order
          CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date),

        -- The database refuses to let a row claim a confirmed date it does not have.
        CONSTRAINT chk_exhibitions_confirmed_has_dates
          CHECK (date_status <> 'CONFIRMED' OR (start_date IS NOT NULL AND end_date IS NOT NULL)),

        CONSTRAINT chk_exhibitions_confidence_range
          CHECK (confidence >= 0 AND confidence <= 1)
      );
    `);

    // Range queries (today / upcoming / a given day) are the hottest path.
    await queryRunner.query(`
      CREATE INDEX idx_exhibitions_start_date ON exhibitions(start_date);
      CREATE INDEX idx_exhibitions_end_date ON exhibitions(end_date);
      CREATE INDEX idx_exhibitions_date_range ON exhibitions(start_date, end_date);
      CREATE INDEX idx_exhibitions_city ON exhibitions(city_id);
      CREATE INDEX idx_exhibitions_venue ON exhibitions(venue_id);
      CREATE INDEX idx_exhibitions_category ON exhibitions(primary_category_id);
      CREATE INDEX idx_exhibitions_organizer ON exhibitions(organizer_id);
      CREATE INDEX idx_exhibitions_status ON exhibitions(status);
      CREATE INDEX idx_exhibitions_review_status ON exhibitions(review_status)
        WHERE review_status = 'PENDING_REVIEW';
      CREATE INDEX idx_exhibitions_search_vector ON exhibitions USING gin (search_vector);
      -- Exact / prefix lookups on the normalized title. Fuzzy scoring for
      -- deduplication is done in TypeScript, with the full-text index above
      -- narrowing the candidate set first.
      CREATE INDEX idx_exhibitions_title_norm ON exhibitions(canonical_title_norm);
      CREATE INDEX idx_exhibitions_tags ON exhibitions USING gin (tags);
    `);

    await queryRunner.query(`
      CREATE TABLE exhibition_translations (
        exhibition_id  uuid NOT NULL REFERENCES exhibitions(id) ON DELETE CASCADE,
        locale         text NOT NULL,
        title          text NOT NULL,
        description    text,
        created_at     timestamptz NOT NULL DEFAULT now(),
        updated_at     timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (exhibition_id, locale)
      );
      CREATE INDEX idx_exhibition_translations_locale ON exhibition_translations(locale);
    `);

    // An exhibition legitimately belongs to several categories (a furniture
    // fair is also decoration). primary_category_id stays on the parent for
    // cheap filtering; this table carries the full set.
    await queryRunner.query(`
      CREATE TABLE exhibition_categories (
        exhibition_id  uuid NOT NULL REFERENCES exhibitions(id) ON DELETE CASCADE,
        category_id    uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        PRIMARY KEY (exhibition_id, category_id)
      );
      CREATE INDEX idx_exhibition_categories_category ON exhibition_categories(category_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS exhibition_categories`);
    await queryRunner.query(`DROP TABLE IF EXISTS exhibition_translations`);
    await queryRunner.query(`DROP TABLE IF EXISTS exhibitions`);
  }
}
