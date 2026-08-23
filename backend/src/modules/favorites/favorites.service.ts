import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { returningRows } from '../../common/db/returning';

export interface FavoriteDto {
  id: string;
  kind: 'exhibition' | 'category';
  exhibitionId: string | null;
  categoryId: string | null;
  title: string;
  slug: string;
  createdAt: string;
}

@Injectable()
export class FavoritesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * A favourite targets either an exhibition or a category, never both.
   *
   * Following a category is what feeds the "new exhibition in your field"
   * notification in section 24, so the two live in one table rather than two.
   */
  async add(
    userId: string,
    input: { exhibitionId?: string; categoryId?: string },
  ): Promise<FavoriteDto> {
    const targets = [input.exhibitionId, input.categoryId].filter(Boolean);
    if (targets.length !== 1) {
      throw new BadRequestException('supply exactly one of exhibitionId or categoryId');
    }

    if (input.exhibitionId) {
      const [exists] = await this.dataSource.query(
        `SELECT 1 FROM exhibitions WHERE id = $1`,
        [input.exhibitionId],
      );
      if (!exists) throw new NotFoundException('exhibition was not found');
    } else {
      const [exists] = await this.dataSource.query(`SELECT 1 FROM categories WHERE id = $1`, [
        input.categoryId,
      ]);
      if (!exists) throw new NotFoundException('category was not found');
    }

    // The partial unique indexes make a repeat call idempotent rather than an
    // error, which is what a heart button toggled twice should do.
    const [row] = await this.dataSource.query(
      `INSERT INTO favorites (user_id, exhibition_id, category_id)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING id, created_at`,
      [userId, input.exhibitionId ?? null, input.categoryId ?? null],
    );

    if (!row) {
      const [existing] = await this.dataSource.query(
        `SELECT id, created_at FROM favorites
         WHERE user_id = $1
           AND exhibition_id IS NOT DISTINCT FROM $2
           AND category_id IS NOT DISTINCT FROM $3`,
        [userId, input.exhibitionId ?? null, input.categoryId ?? null],
      );
      return this.hydrate(existing, input);
    }

    return this.hydrate(row, input);
  }

  async list(userId: string): Promise<FavoriteDto[]> {
    const rows = await this.dataSource.query(
      `SELECT f.id, f.exhibition_id, f.category_id, f.created_at,
              COALESCE(t.title, e.canonical_title, c.name_fa) AS title,
              COALESCE(e.slug, c.slug) AS slug
       FROM favorites f
       LEFT JOIN exhibitions e ON e.id = f.exhibition_id
       LEFT JOIN categories  c ON c.id = f.category_id
       LEFT JOIN exhibition_translations t
              ON t.exhibition_id = e.id AND t.locale = 'fa'
       WHERE f.user_id = $1
       ORDER BY f.created_at DESC`,
      [userId],
    );

    return rows.map((row: any) => ({
      id: row.id,
      kind: row.exhibition_id ? ('exhibition' as const) : ('category' as const),
      exhibitionId: row.exhibition_id,
      categoryId: row.category_id,
      title: row.title,
      slug: row.slug,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  async remove(userId: string, id: string): Promise<void> {
    const deleted = returningRows(
      await this.dataSource.query(
        `DELETE FROM favorites WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, userId],
      ),
    );
    if (deleted.length === 0) throw new NotFoundException('favorite was not found');
  }

  private async hydrate(
    row: { id: string; created_at: string },
    input: { exhibitionId?: string; categoryId?: string },
  ): Promise<FavoriteDto> {
    const [detail] = input.exhibitionId
      ? await this.dataSource.query(
          `SELECT COALESCE(t.title, e.canonical_title) AS title, e.slug
           FROM exhibitions e
           LEFT JOIN exhibition_translations t
                  ON t.exhibition_id = e.id AND t.locale = 'fa'
           WHERE e.id = $1`,
          [input.exhibitionId],
        )
      : await this.dataSource.query(
          `SELECT name_fa AS title, slug FROM categories WHERE id = $1`,
          [input.categoryId],
        );

    return {
      id: row.id,
      kind: input.exhibitionId ? 'exhibition' : 'category',
      exhibitionId: input.exhibitionId ?? null,
      categoryId: input.categoryId ?? null,
      title: detail?.title ?? '',
      slug: detail?.slug ?? '',
      createdAt: new Date(row.created_at).toISOString(),
    };
  }
}
