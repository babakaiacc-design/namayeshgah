import { DataSource } from 'typeorm';

import { dataSourceOptions } from '../data-source';
import { CATEGORIES, CITIES, COUNTRIES, SOURCES, VENUES, CategorySeed } from './seed-data';

/**
 * Idempotent reference-data seed. Safe to run on every deploy: every insert is
 * ON CONFLICT DO NOTHING, keyed on a natural unique column.
 *
 * Aliases in particular rely on that — several spellings of a venue name
 * collapse to the same normalized form once persian_normalize_search runs, and
 * the unique index on the generated column is what stops the duplicates.
 */
export async function seed(dataSource: DataSource): Promise<void> {
  const counts = { countries: 0, cities: 0, venues: 0, categories: 0, aliases: 0, sources: 0 };

  for (const country of COUNTRIES) {
    await dataSource.query(
      `INSERT INTO countries (iso2, name_fa, name_en, default_locale)
       VALUES ($1, $2, $3, $4) ON CONFLICT (iso2) DO NOTHING`,
      [country.iso2, country.nameFa, country.nameEn, country.defaultLocale],
    );
    counts.countries += 1;
  }

  for (const city of CITIES) {
    await dataSource.query(
      `INSERT INTO cities (country_id, slug, name_fa, name_en, timezone)
       VALUES ((SELECT id FROM countries WHERE iso2 = $1), $2, $3, $4, $5)
       ON CONFLICT (slug) DO NOTHING`,
      [city.countryIso2, city.slug, city.nameFa, city.nameEn, city.timezone],
    );
    counts.cities += 1;
  }

  for (const venue of VENUES) {
    await dataSource.query(
      `INSERT INTO venues (city_id, slug, name_fa, name_en, address, website)
       VALUES ((SELECT id FROM cities WHERE slug = $1), $2, $3, $4, $5, $6)
       ON CONFLICT (slug) DO NOTHING`,
      [venue.citySlug, venue.slug, venue.nameFa, venue.nameEn ?? null, venue.address ?? null, venue.website ?? null],
    );
    counts.venues += 1;

    for (const alias of venue.aliases) {
      await dataSource.query(
        `INSERT INTO venue_aliases (venue_id, alias)
         VALUES ((SELECT id FROM venues WHERE slug = $1), $2)
         ON CONFLICT (normalized) DO NOTHING`,
        [venue.slug, alias],
      );
      counts.aliases += 1;
    }
  }

  const insertCategory = async (category: CategorySeed, parentSlug: string | null) => {
    await dataSource.query(
      `INSERT INTO categories (parent_id, slug, name_fa, name_en, sort_order)
       VALUES (
         CASE WHEN $1::text IS NULL THEN NULL ELSE (SELECT id FROM categories WHERE slug = $1) END,
         $2, $3, $4, $5
       )
       ON CONFLICT (slug) DO NOTHING`,
      [parentSlug, category.slug, category.nameFa, category.nameEn, category.sortOrder],
    );
    counts.categories += 1;

    // The category's own name is an alias too, so a source that spells the
    // category exactly as we do resolves without a hand-written mapping.
    for (const alias of [category.nameFa, ...(category.aliases ?? [])]) {
      await dataSource.query(
        `INSERT INTO category_aliases (category_id, alias)
         VALUES ((SELECT id FROM categories WHERE slug = $1), $2)
         ON CONFLICT (normalized) DO NOTHING`,
        [category.slug, alias],
      );
      counts.aliases += 1;
    }

    for (const child of category.children ?? []) {
      await insertCategory(child, category.slug);
    }
  };

  for (const category of CATEGORIES) {
    await insertCategory(category, null);
  }

  for (const source of SOURCES) {
    await dataSource.query(
      `INSERT INTO sources (name, display_name, base_url, confidence, fetch_mode, is_enabled, notes)
       VALUES ($1, $2, $3, $4, $5::fetch_mode_enum, $6, $7)
       ON CONFLICT (name) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             base_url     = EXCLUDED.base_url,
             confidence   = EXCLUDED.confidence,
             fetch_mode   = EXCLUDED.fetch_mode,
             notes        = EXCLUDED.notes,
             updated_at   = now()`,
      [
        source.name,
        source.displayName,
        source.baseUrl,
        source.confidence,
        source.fetchMode,
        source.isEnabled,
        source.notes,
      ],
    );
    counts.sources += 1;
  }

  // eslint-disable-next-line no-console
  console.log('[seed] processed', counts);
}

if (require.main === module) {
  (async () => {
    const dataSource = new DataSource(dataSourceOptions);
    await dataSource.initialize();
    try {
      await seed(dataSource);
    } finally {
      await dataSource.destroy();
    }
  })().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('[seed] failed:', error);
    process.exit(1);
  });
}
