import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import {
  ExhibitionSort,
  ExhibitionTimeframe,
  QueryExhibitionsDto,
} from './dto/query-exhibitions.dto';

export interface ExhibitionRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  date_status: string;
  start_time: string | null;
  end_time: string | null;
  status: string;
  event_type: string;
  is_international: boolean;
  is_specialized: boolean;
  confidence: string;
  last_verified_at: Date | null;
  official_website: string | null;
  image_url: string | null;
  city_slug: string;
  city_name: string;
  city_timezone: string;
  country_iso2: string;
  venue_slug: string | null;
  venue_name: string | null;
  venue_latitude: string | null;
  venue_longitude: string | null;
  venue_address: string | null;
  category_slug: string | null;
  category_name: string | null;
  organizer_name: string | null;
  days_until: number | null;
  is_ongoing: boolean;
}

/**
 * Read side for exhibitions.
 *
 * Written as SQL rather than through an ORM query builder because the parts
 * that matter here are Postgres-specific: the generated search vector, the
 * Persian normalization function shared with the ingestion pipeline, and the
 * per-row timezone arithmetic that decides what counts as "today".
 */
@Injectable()
export class ExhibitionsRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * "Today" is not one date. An exhibition in Dubai is still running when it is
   * already tomorrow in Tehran, so the comparison uses each row's own city
   * timezone rather than the server clock. Getting this wrong would be
   * invisible while the app only covers Tehran and would surface as
   * off-by-one-day listings the moment a second country is added.
   */
  private readonly localToday = `(now() AT TIME ZONE ci.timezone)::date`;

  /**
   * The end date exists only once a detail page has been fetched, and detail
   * fetches are budgeted per sync run — so most rows carry it, but a fair
   * share, especially further-out ones, do not yet. Comparing against
   * `e.end_date` directly makes those rows vanish from every date-range query,
   * since `NULL >= anything` is neither true nor false in SQL. Falling back to
   * `start_date` treats an exhibition with an unknown end as a single day,
   * which is the best guess the data supports and matches findStartingOn.
   */
  private readonly effectiveEndDate = 'COALESCE(e.end_date, e.start_date)';

  private baseSelect(localeParam: string): string {
    return `
      SELECT
        e.id, e.slug,
        COALESCE(tl.title, tfa.title, e.canonical_title) AS title,
        COALESCE(tl.description, tfa.description)        AS description,
        e.start_date, e.end_date, e.date_status, e.start_time, e.end_time,
        e.status::text AS status, e.event_type::text AS event_type,
        e.is_international, e.is_specialized, e.confidence, e.last_verified_at,
        e.official_website, e.image_url,
        ci.slug AS city_slug, ci.name_fa AS city_name, ci.timezone AS city_timezone,
        co.iso2 AS country_iso2,
        v.slug AS venue_slug, v.name_fa AS venue_name,
        v.latitude AS venue_latitude, v.longitude AS venue_longitude,
        v.address AS venue_address,
        cat.slug AS category_slug, cat.name_fa AS category_name,
        org.name_fa AS organizer_name,
        CASE WHEN e.start_date IS NULL THEN NULL
             ELSE (e.start_date - ${this.localToday}) END AS days_until,
        COALESCE(
          e.start_date <= ${this.localToday} AND ${this.effectiveEndDate} >= ${this.localToday},
          false
        ) AS is_ongoing
      FROM exhibitions e
      JOIN cities ci      ON ci.id = e.city_id
      JOIN countries co   ON co.id = ci.country_id
      LEFT JOIN venues v  ON v.id = e.venue_id
      LEFT JOIN categories cat ON cat.id = e.primary_category_id
      LEFT JOIN organizers org ON org.id = e.organizer_id
      LEFT JOIN exhibition_translations tl
             ON tl.exhibition_id = e.id AND tl.locale = ${localeParam}
      LEFT JOIN exhibition_translations tfa
             ON tfa.exhibition_id = e.id AND tfa.locale = 'fa'
    `;
  }

  async search(query: QueryExhibitionsDto): Promise<{ items: ExhibitionRow[]; total: number }> {
    const params: unknown[] = [];
    const push = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    const conditions: string[] = ['e.review_status <> \'REJECTED\''];

    if (!query.includeUndated) {
      conditions.push(`e.start_date IS NOT NULL`);
    }

    if (query.city) conditions.push(`ci.slug = ${push(query.city)}`);
    if (query.country) conditions.push(`co.iso2 = upper(${push(query.country)})`);
    if (query.venue) conditions.push(`v.slug = ${push(query.venue)}`);
    if (query.dateFrom) conditions.push(`${this.effectiveEndDate} >= ${push(query.dateFrom)}::date`);
    if (query.dateTo) conditions.push(`e.start_date <= ${push(query.dateTo)}::date`);
    if (query.isInternational !== undefined) {
      conditions.push(`e.is_international = ${push(query.isInternational)}`);
    }
    if (query.isSpecialized !== undefined) {
      conditions.push(`e.is_specialized = ${push(query.isSpecialized)}`);
    }

    switch (query.timeframe) {
      case ExhibitionTimeframe.Ongoing:
        conditions.push(
          `e.start_date <= ${this.localToday} AND ${this.effectiveEndDate} >= ${this.localToday}`,
        );
        break;
      case ExhibitionTimeframe.Upcoming:
        conditions.push(`e.start_date > ${this.localToday}`);
        break;
      case ExhibitionTimeframe.Past:
        conditions.push(`${this.effectiveEndDate} < ${this.localToday}`);
        break;
      default:
        break;
    }

    // Selecting a parent category must return its children too, otherwise
    // filtering by "Home and Lifestyle" would show nothing while every
    // exhibition sits under "Furniture".
    let categoryCte = '';
    if (query.category) {
      const slug = push(query.category);
      categoryCte = `
        WITH RECURSIVE category_tree AS (
          SELECT id FROM categories WHERE slug = ${slug}
          UNION ALL
          SELECT c.id FROM categories c JOIN category_tree t ON c.parent_id = t.id
        )
      `;
      conditions.push(`(
        e.primary_category_id IN (SELECT id FROM category_tree)
        OR EXISTS (
          SELECT 1 FROM exhibition_categories ec
          WHERE ec.exhibition_id = e.id
            AND ec.category_id IN (SELECT id FROM category_tree)
        )
      )`);
    }

    let rankExpression = 'NULL';
    const term = (query.search ?? '').trim();
    if (term) {
      const searchParam = push(term);
      // Two ways to match: whole-token full text, and a substring of the
      // normalized title. The second is what makes typing part of a word in a
      // search box behave the way a user expects.
      conditions.push(`(
        e.search_vector @@ plainto_tsquery('simple', persian_normalize_search(${searchParam}))
        OR e.canonical_title_norm LIKE '%' || persian_normalize_search(${searchParam}) || '%'
      )`);
      rankExpression = `ts_rank(e.search_vector, plainto_tsquery('simple', persian_normalize_search(${searchParam})))`;
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const orderBy = this.buildOrderBy(query.sort, rankExpression);

    // Everything pushed so far appears in the WHERE clause, so the count query
    // can reuse exactly this prefix. The locale is bound afterwards because it
    // is referenced only by the translation joins in the SELECT; passing it to
    // a query that never mentions it makes Postgres reject the bind.
    const filterParamCount = params.length;

    const localeParam = push(query.locale ?? 'fa');
    const limitParam = push(query.limit);
    const offsetParam = push(query.offset);

    const items: ExhibitionRow[] = await this.dataSource.query(
      `${categoryCte}
       ${this.baseSelect(localeParam)}
       ${where}
       ORDER BY ${orderBy}
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params,
    );

    const [countRow] = await this.dataSource.query(
      `${categoryCte}
       SELECT count(*)::int AS total
       FROM exhibitions e
       JOIN cities ci    ON ci.id = e.city_id
       JOIN countries co ON co.id = ci.country_id
       LEFT JOIN venues v ON v.id = e.venue_id
       ${where}`,
      params.slice(0, filterParamCount),
    );

    return { items, total: countRow?.total ?? 0 };
  }

  /**
   * Upcoming ascending, then past descending.
   *
   * Expressed as three keys rather than one so each group keeps its own
   * direction: the next exhibition should be first, and among ones that have
   * already happened the most recent is the one somebody is asking about.
   */
  private readonly soonestFirst = [
    `(e.start_date >= ${this.localToday}) DESC`,
    `CASE WHEN e.start_date >= ${this.localToday} THEN e.start_date END ASC`,
    `CASE WHEN e.start_date < ${this.localToday} THEN e.start_date END DESC`,
  ].join(', ');

  private buildOrderBy(sort: ExhibitionSort | undefined, rankExpression: string): string {
    switch (sort) {
      case ExhibitionSort.StartDateDesc:
        return 'e.start_date DESC NULLS LAST, e.id';
      case ExhibitionSort.Soonest:
        return `${this.soonestFirst}, e.id`;
      case ExhibitionSort.Relevance:
        // Many rows share a rank when they share the matched words, so the
        // tiebreaker decides most of the ordering in practice.
        return rankExpression === 'NULL'
          ? `${this.soonestFirst}, e.id`
          : `${rankExpression} DESC, ${this.soonestFirst}, e.id`;
      default:
        // Plain ascending, which is what a calendar month wants.
        return 'e.start_date ASC NULLS LAST, e.id';
    }
  }

  /** Running right now, judged in the city's own timezone. */
  async findOngoing(city: string, locale: string, limit: number, offset: number) {
    return this.search({
      city,
      locale,
      limit,
      offset,
      timeframe: ExhibitionTimeframe.Ongoing,
      includeUndated: false,
      sort: ExhibitionSort.StartDateAsc,
    } as QueryExhibitionsDto);
  }

  async findStartingOn(date: string, city: string, locale: string, limit: number, offset: number) {
    const params: unknown[] = [locale, date, city, limit, offset];
    const items: ExhibitionRow[] = await this.dataSource.query(
      `${this.baseSelect('$1')}
       WHERE e.review_status <> 'REJECTED'
         AND e.start_date IS NOT NULL
         AND $2::date BETWEEN e.start_date AND COALESCE(e.end_date, e.start_date)
         AND ($3::text IS NULL OR ci.slug = $3)
       ORDER BY e.start_date ASC, e.id
       LIMIT $4 OFFSET $5`,
      params,
    );

    const [countRow] = await this.dataSource.query(
      `SELECT count(*)::int AS total
       FROM exhibitions e
       JOIN cities ci ON ci.id = e.city_id
       WHERE e.review_status <> 'REJECTED'
         AND e.start_date IS NOT NULL
         AND $1::date BETWEEN e.start_date AND COALESCE(e.end_date, e.start_date)
         AND ($2::text IS NULL OR ci.slug = $2)`,
      [date, city],
    );

    return { items, total: countRow?.total ?? 0 };
  }

  async findUpcoming(days: number, city: string, locale: string, limit: number, offset: number) {
    const items: ExhibitionRow[] = await this.dataSource.query(
      `${this.baseSelect('$1')}
       WHERE e.review_status <> 'REJECTED'
         AND e.start_date IS NOT NULL
         AND e.start_date > ${this.localToday}
         AND e.start_date <= ${this.localToday} + ($2 || ' days')::interval
         AND ($3::text IS NULL OR ci.slug = $3)
       ORDER BY e.start_date ASC, e.id
       LIMIT $4 OFFSET $5`,
      [locale, String(days), city, limit, offset],
    );

    const [countRow] = await this.dataSource.query(
      `SELECT count(*)::int AS total
       FROM exhibitions e
       JOIN cities ci ON ci.id = e.city_id
       WHERE e.review_status <> 'REJECTED'
         AND e.start_date IS NOT NULL
         AND e.start_date > (now() AT TIME ZONE ci.timezone)::date
         AND e.start_date <= (now() AT TIME ZONE ci.timezone)::date + ($1 || ' days')::interval
         AND ($2::text IS NULL OR ci.slug = $2)`,
      [String(days), city],
    );

    return { items, total: countRow?.total ?? 0 };
  }

  async findByIdOrSlug(idOrSlug: string, locale: string): Promise<ExhibitionRow | undefined> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);

    const [row] = await this.dataSource.query(
      `${this.baseSelect('$1')}
       WHERE ${isUuid ? 'e.id = $2::uuid' : 'e.slug = $2'}
       LIMIT 1`,
      [locale, idOrSlug],
    );
    return row;
  }

  /**
   * Provenance for one exhibition: which source said what, and when it was last
   * seen. Section 11 of the brief — the app must be able to show where a date
   * came from, and an admin must be able to compare two disagreeing sources.
   */
  async findSourceRecords(exhibitionId: string) {
    return this.dataSource.query(
      `SELECT s.name AS source_name, s.display_name, s.confidence AS source_confidence,
              r.source_url, r.source_title, r.source_start_date, r.source_end_date,
              r.source_venue, r.last_fetched_at
       FROM exhibition_source_records r
       JOIN sources s ON s.id = r.source_id
       WHERE r.exhibition_id = $1
       ORDER BY s.confidence DESC, r.last_fetched_at DESC`,
      [exhibitionId],
    );
  }
}
