import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Read-only reference data: categories, venues and cities.
 *
 * These three share one service because they are the same kind of thing, a
 * small slowly-changing lookup list the client caches, and splitting them into
 * three near-identical modules would add files without adding structure. Each
 * still gets its own controller so the URL surface matches section 31.
 */
export interface CategoryNode {
  id: string;
  slug: string;
  nameFa: string;
  nameEn: string;
  icon: string | null;
  exhibitionCount: number;
  children: CategoryNode[];
}

@Injectable()
export class ReferenceService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * The category tree, nested. Returned whole rather than paginated because it
   * is small, bounded, and the client renders it as a filter list.
   *
   * exhibitionCount reflects only dated, non-rejected exhibitions, so a filter
   * chip never promises results the list endpoint will not return.
   */
  async categories(city?: string): Promise<CategoryNode[]> {
    const rows = await this.dataSource.query(
      `SELECT c.id, c.parent_id, c.slug, c.name_fa, c.name_en, c.icon, c.sort_order,
              COALESCE((
                SELECT count(*)
                FROM exhibitions e
                JOIN cities ci ON ci.id = e.city_id
                WHERE e.primary_category_id = c.id
                  AND e.review_status <> 'REJECTED'
                  AND e.start_date IS NOT NULL
                  AND ($1::text IS NULL OR ci.slug = $1)
              ), 0)::int AS exhibition_count
       FROM categories c
       WHERE c.is_active
       ORDER BY c.sort_order, c.name_fa`,
      [city ?? null],
    );

    const byId = new Map<string, CategoryNode & { parentId: string | null }>();
    for (const row of rows) {
      byId.set(row.id, {
        id: row.id,
        parentId: row.parent_id,
        slug: row.slug,
        nameFa: row.name_fa,
        nameEn: row.name_en,
        icon: row.icon,
        exhibitionCount: row.exhibition_count,
        children: [],
      });
    }

    const roots: CategoryNode[] = [];
    for (const node of byId.values()) {
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }

    // A parent chip should count everything underneath it, otherwise selecting
    // "Home and Lifestyle" would show a count of zero while its children hold
    // all the exhibitions.
    const rollUp = (node: CategoryNode): number => {
      const total = node.children.reduce((sum, child) => sum + rollUp(child), node.exhibitionCount);
      node.exhibitionCount = total;
      return total;
    };
    roots.forEach(rollUp);

    const strip = (node: CategoryNode & { parentId?: string | null }): CategoryNode => {
      delete node.parentId;
      node.children.forEach(strip as never);
      return node;
    };

    return roots.map((node) => strip(node));
  }

  async venues(city?: string) {
    const rows = await this.dataSource.query(
      `SELECT v.slug, v.name_fa, v.name_en, v.address, v.latitude, v.longitude,
              v.website, v.phone, ci.slug AS city_slug, ci.name_fa AS city_name
       FROM venues v
       JOIN cities ci ON ci.id = v.city_id
       WHERE v.is_active AND ($1::text IS NULL OR ci.slug = $1)
       ORDER BY v.name_fa`,
      [city ?? null],
    );

    return rows.map((row: any) => ({
      slug: row.slug,
      nameFa: row.name_fa,
      nameEn: row.name_en,
      address: row.address,
      // Null until an admin fills them from a verified source. The client must
      // hide the directions button rather than drop a pin on a guess.
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      website: row.website,
      phone: row.phone,
      city: { slug: row.city_slug, name: row.city_name },
    }));
  }

  async cities() {
    const rows = await this.dataSource.query(
      `SELECT ci.slug, ci.name_fa, ci.name_en, ci.timezone, co.iso2, co.name_fa AS country_name
       FROM cities ci
       JOIN countries co ON co.id = ci.country_id
       WHERE ci.is_active
       ORDER BY ci.name_fa`,
    );

    return rows.map((row: any) => ({
      slug: row.slug,
      nameFa: row.name_fa,
      nameEn: row.name_en,
      timezone: row.timezone,
      country: { iso2: row.iso2, nameFa: row.country_name },
    }));
  }
}
