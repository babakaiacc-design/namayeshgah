import { DataSource } from 'typeorm';

/**
 * Turns the free text a source printed into ids from our reference tables.
 *
 * Kept behind an interface so the Normalizer can be unit tested without a
 * database, and so the lookup strategy can change without touching mapping
 * logic.
 *
 * Every lookup goes through `persian_normalize_search`, the same SQL function
 * that built the alias index — see ARCHITECTURE.md section 7.
 */
export interface CityRef {
  id: string;
  slug: string;
  timezone: string;
}

export interface VenueRef {
  id: string;
  slug: string;
  cityId: string;
  nameFa: string;
}

export interface CategoryRef {
  id: string;
  slug: string;
  nameFa: string;
}

export interface OrganizerRef {
  id: string;
  nameFa: string;
}

export interface ReferenceResolver {
  resolveCity(name: string | undefined): Promise<CityRef | undefined>;
  resolveVenue(name: string | undefined): Promise<VenueRef | undefined>;
  /** Scans free text for any known venue alias. */
  findVenueInText(text: string): Promise<VenueRef | undefined>;
  resolveCategory(name: string | undefined): Promise<CategoryRef | undefined>;
  /** Scans free text for any known category alias. */
  findCategoryInText(text: string): Promise<CategoryRef | undefined>;
  /** Looks an organizer up by name, creating it when it is new. */
  resolveOrganizer(name: string | undefined): Promise<OrganizerRef | undefined>;
  defaultCity(): Promise<CityRef | undefined>;
}

export class DbReferenceResolver implements ReferenceResolver {
  constructor(
    private readonly dataSource: DataSource,
    private readonly defaultCitySlug = 'tehran',
  ) {}

  async resolveCity(name: string | undefined): Promise<CityRef | undefined> {
    if (!name?.trim()) return undefined;

    const rows = await this.dataSource.query(
      `SELECT id, slug, timezone FROM cities
       WHERE persian_normalize_search(name_fa) = persian_normalize_search($1)
          OR persian_normalize_search(name_en) = persian_normalize_search($1)
          OR slug = lower($1)
       LIMIT 1`,
      [name.trim()],
    );
    return rows[0] ? { id: rows[0].id, slug: rows[0].slug, timezone: rows[0].timezone } : undefined;
  }

  async resolveVenue(name: string | undefined): Promise<VenueRef | undefined> {
    if (!name?.trim()) return undefined;

    const rows = await this.dataSource.query(
      `SELECT v.id, v.slug, v.city_id, v.name_fa
       FROM venues v
       LEFT JOIN venue_aliases a ON a.venue_id = v.id
       WHERE persian_normalize_search(v.name_fa) = persian_normalize_search($1)
          OR a.normalized = persian_normalize_search($1)
       LIMIT 1`,
      [name.trim()],
    );
    return rows[0]
      ? { id: rows[0].id, slug: rows[0].slug, cityId: rows[0].city_id, nameFa: rows[0].name_fa }
      : undefined;
  }

  /**
   * Some sources name the venue only inside the title, so the alias table is
   * searched for any alias contained in the text. The longest alias wins, so
   * a specific name is preferred over a shorter one it contains.
   */
  async findVenueInText(text: string): Promise<VenueRef | undefined> {
    if (!text?.trim()) return undefined;

    const rows = await this.dataSource.query(
      `SELECT v.id, v.slug, v.city_id, v.name_fa
       FROM venue_aliases a
       JOIN venues v ON v.id = a.venue_id
       WHERE position(a.normalized IN persian_normalize_search($1)) > 0
         AND length(a.normalized) >= 4
       ORDER BY length(a.normalized) DESC
       LIMIT 1`,
      [text],
    );
    return rows[0]
      ? { id: rows[0].id, slug: rows[0].slug, cityId: rows[0].city_id, nameFa: rows[0].name_fa }
      : undefined;
  }

  async resolveCategory(name: string | undefined): Promise<CategoryRef | undefined> {
    if (!name?.trim()) return undefined;

    const rows = await this.dataSource.query(
      `SELECT c.id, c.slug, c.name_fa
       FROM categories c
       LEFT JOIN category_aliases a ON a.category_id = c.id
       WHERE persian_normalize_search(c.name_fa) = persian_normalize_search($1)
          OR a.normalized = persian_normalize_search($1)
       LIMIT 1`,
      [name.trim()],
    );
    return rows[0] ? { id: rows[0].id, slug: rows[0].slug, nameFa: rows[0].name_fa } : undefined;
  }

  /**
   * Falls back to reading the category out of the title.
   *
   * eventro publishes no category field at all, so without this every ingested
   * exhibition would be uncategorised and the category filter would return
   * nothing. Aliases shorter than four characters are ignored because a short
   * word appears inside unrelated titles too often to be evidence, and the
   * longest match wins so a specific category beats a generic one.
   */
  async findCategoryInText(text: string): Promise<CategoryRef | undefined> {
    if (!text?.trim()) return undefined;

    const rows = await this.dataSource.query(
      `SELECT c.id, c.slug, c.name_fa
       FROM category_aliases a
       JOIN categories c ON c.id = a.category_id
       WHERE position(a.normalized IN persian_normalize_search($1)) > 0
         AND length(a.normalized) >= 4
         AND c.parent_id IS NOT NULL
       ORDER BY length(a.normalized) DESC
       LIMIT 1`,
      [text],
    );
    return rows[0] ? { id: rows[0].id, slug: rows[0].slug, nameFa: rows[0].name_fa } : undefined;
  }

  async resolveOrganizer(name: string | undefined): Promise<OrganizerRef | undefined> {
    const trimmed = name?.trim();
    if (!trimmed) return undefined;

    const existing = await this.dataSource.query(
      `SELECT id, name_fa FROM organizers
       WHERE name_norm = persian_normalize_search($1) LIMIT 1`,
      [trimmed],
    );
    if (existing[0]) return { id: existing[0].id, nameFa: existing[0].name_fa };

    // Organizers are open-ended, unlike venues and categories, so a new name is
    // recorded rather than dropped. is_verified stays false until an admin
    // confirms it, which keeps it below an official source in conflicts.
    const slug = `org-${Buffer.from(trimmed).toString('hex').slice(0, 24)}`;
    const created = await this.dataSource.query(
      `INSERT INTO organizers (slug, name_fa) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name_fa = EXCLUDED.name_fa
       RETURNING id, name_fa`,
      [slug, trimmed],
    );
    return { id: created[0].id, nameFa: created[0].name_fa };
  }

  async defaultCity(): Promise<CityRef | undefined> {
    const rows = await this.dataSource.query(
      `SELECT id, slug, timezone FROM cities WHERE slug = $1 LIMIT 1`,
      [this.defaultCitySlug],
    );
    return rows[0] ? { id: rows[0].id, slug: rows[0].slug, timezone: rows[0].timezone } : undefined;
  }
}
