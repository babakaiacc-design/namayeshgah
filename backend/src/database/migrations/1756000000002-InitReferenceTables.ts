import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reference data: countries, cities, venues, categories, organizers.
 *
 * The country -> city -> venue chain exists from day one even though the MVP
 * only ships Tehran, because retrofitting a country level later would touch
 * every query. `cities.timezone` is mandatory for the same reason: reminder
 * instants are derived from the event's local date plus the city's zone, so a
 * missing zone would produce alarms that fire at the wrong hour abroad.
 */
export class InitReferenceTables1756000000002 implements MigrationInterface {
  name = 'InitReferenceTables1756000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE countries (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        iso2            char(2) NOT NULL UNIQUE,
        name_fa         text NOT NULL,
        name_en         text NOT NULL,
        default_locale  text NOT NULL DEFAULT 'fa',
        is_active       boolean NOT NULL DEFAULT true,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE cities (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        country_id  uuid NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
        slug        text NOT NULL UNIQUE,
        name_fa     text NOT NULL,
        name_en     text NOT NULL,
        timezone    text NOT NULL,
        latitude    numeric(10,7),
        longitude   numeric(10,7),
        is_active   boolean NOT NULL DEFAULT true,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_cities_country ON cities(country_id);
    `);

    await queryRunner.query(`
      CREATE TABLE venues (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        city_id     uuid NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
        slug        text NOT NULL UNIQUE,
        name_fa     text NOT NULL,
        name_en     text,
        address     text,
        latitude    numeric(10,7),
        longitude   numeric(10,7),
        website     text,
        phone       text,
        is_active   boolean NOT NULL DEFAULT true,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_venues_city ON venues(city_id);
    `);

    // Sources write venue names as free text and spell them inconsistently.
    // The normalizer resolves those strings through this table instead of
    // guessing, so an unmatched spelling surfaces as a gap rather than
    // silently creating a duplicate venue.
    await queryRunner.query(`
      CREATE TABLE venue_aliases (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        venue_id    uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
        alias       text NOT NULL,
        normalized  text GENERATED ALWAYS AS (persian_normalize_search(alias)) STORED,
        created_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX idx_venue_aliases_normalized ON venue_aliases(normalized);
      CREATE INDEX idx_venue_aliases_venue ON venue_aliases(venue_id);
    `);

    await queryRunner.query(`
      CREATE TABLE categories (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        parent_id   uuid REFERENCES categories(id) ON DELETE RESTRICT,
        slug        text NOT NULL UNIQUE,
        name_fa     text NOT NULL,
        name_en     text NOT NULL,
        icon        text,
        sort_order  integer NOT NULL DEFAULT 0,
        is_active   boolean NOT NULL DEFAULT true,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_categories_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
      );
      CREATE INDEX idx_categories_parent ON categories(parent_id);
    `);

    await queryRunner.query(`
      CREATE TABLE category_aliases (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        category_id  uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        alias        text NOT NULL,
        normalized   text GENERATED ALWAYS AS (persian_normalize_search(alias)) STORED,
        created_at   timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX idx_category_aliases_normalized ON category_aliases(normalized);
      CREATE INDEX idx_category_aliases_category ON category_aliases(category_id);
    `);

    await queryRunner.query(`
      CREATE TABLE organizers (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        slug         text NOT NULL UNIQUE,
        name_fa      text NOT NULL,
        name_en      text,
        name_norm    text GENERATED ALWAYS AS (persian_normalize_search(name_fa)) STORED,
        phone        text,
        email        text,
        website      text,
        -- An organizer's own site outranks aggregators when dates conflict.
        is_verified  boolean NOT NULL DEFAULT false,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now()
      );
      -- btree on the normalized name rather than a trigram index: pg_trgm
      -- tokenizes nothing for Persian on a C-locale cluster (see migration
      -- 001). Fuzzy organizer matching happens in TypeScript.
      CREATE INDEX idx_organizers_name_norm ON organizers(name_norm);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS organizers`);
    await queryRunner.query(`DROP TABLE IF EXISTS category_aliases`);
    await queryRunner.query(`DROP TABLE IF EXISTS categories`);
    await queryRunner.query(`DROP TABLE IF EXISTS venue_aliases`);
    await queryRunner.query(`DROP TABLE IF EXISTS venues`);
    await queryRunner.query(`DROP TABLE IF EXISTS cities`);
    await queryRunner.query(`DROP TABLE IF EXISTS countries`);
  }
}
