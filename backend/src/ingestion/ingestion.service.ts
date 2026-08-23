import { createHash } from 'crypto';
import { DataSource } from 'typeorm';

import { normalizeForSearch } from '../common/persian/persian.util';
import { RawExhibition } from './adapters/exhibition-source';
import { MatchCandidate, decide, scoreMatch } from './dedup/similarity';
import { Normalizer, NormalizedExhibition } from './normalizer/normalizer';
import { validateNormalized, validateRaw } from './validation/validator';

export interface IngestOptions {
  /** Runs the whole pipeline including matching, but writes nothing. */
  dryRun?: boolean;
}

export interface IngestSummary {
  source: string;
  fetched: number;
  created: number;
  updated: number;
  duplicates: number;
  conflicts: number;
  review: number;
  failed: number;
  warnings: string[];
  errors: string[];
}

interface SourceRow {
  id: string;
  name: string;
  confidence: number;
}

interface CandidateRow {
  id: string;
  canonical_title: string;
  start_date: string | null;
  end_date: string | null;
  venue_id: string | null;
  primary_category_id: string | null;
  confidence: string;
  date_status: string;
}

type Runner = (sql: string, params?: unknown[]) => Promise<any>;

/**
 * Turns raw source records into canonical exhibitions.
 *
 * The ordering of concerns matters: a source record is written FIRST and
 * always, even when the record ends up merged into an existing exhibition. That
 * is what makes rule 58 auditable. Every date on display can be traced back to
 * the exact row a source produced, and when two sources disagree both rows
 * survive instead of one overwriting the other.
 */
export class IngestionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly normalizer: Normalizer,
  ) {}

  async ingest(
    sourceName: string,
    raws: RawExhibition[],
    options: IngestOptions = {},
  ): Promise<IngestSummary> {
    const summary: IngestSummary = {
      source: sourceName,
      fetched: raws.length,
      created: 0,
      updated: 0,
      duplicates: 0,
      conflicts: 0,
      review: 0,
      failed: 0,
      warnings: [],
      errors: [],
    };

    const source = await this.loadSource(sourceName);
    if (!source) {
      summary.errors.push(`unknown source "${sourceName}"`);
      summary.failed = raws.length;
      return summary;
    }

    for (const raw of raws) {
      try {
        await this.ingestOne(source, raw, summary, options);
      } catch (error) {
        // One bad record must not abort the run.
        summary.failed += 1;
        summary.errors.push(`${raw.sourceUrl}: ${(error as Error).message}`);
      }
    }

    return summary;
  }

  private async ingestOne(
    source: SourceRow,
    raw: RawExhibition,
    summary: IngestSummary,
    options: IngestOptions,
  ): Promise<void> {
    const rawCheck = validateRaw(raw);
    if (!rawCheck.valid) {
      summary.failed += 1;
      summary.errors.push(`${raw.sourceUrl}: ${rawCheck.errors.join('; ')}`);
      return;
    }

    const { normalized, warnings, rejectedReason } = await this.normalizer.normalize(raw);
    summary.warnings.push(...warnings);

    if (!normalized) {
      summary.failed += 1;
      summary.errors.push(`${raw.sourceUrl}: ${rejectedReason ?? 'could not be normalized'}`);
      return;
    }

    const normalizedCheck = validateNormalized(normalized);
    if (!normalizedCheck.valid) {
      summary.failed += 1;
      summary.errors.push(`${raw.sourceUrl}: ${normalizedCheck.errors.join('; ')}`);
      return;
    }

    const candidates = await this.findCandidates(normalized);
    const incoming: MatchCandidate = {
      title: normalized.canonicalTitle,
      start: normalized.startDate,
      end: normalized.endDate,
      venueId: normalized.venueId,
      categoryId: normalized.primaryCategoryId,
    };

    let best: { row: CandidateRow; score: number } | undefined;
    for (const row of candidates) {
      const result = scoreMatch(incoming, {
        title: row.canonical_title,
        start: row.start_date,
        end: row.end_date,
        venueId: row.venue_id,
        categoryId: row.primary_category_id,
      });
      if (!best || result.score > best.score) best = { row, score: result.score };
    }

    // A previous run of THIS source already claimed an exhibition for this
    // external id. That link is stronger evidence than any similarity score,
    // and honouring it keeps an event stable when its title is edited upstream.
    const linked = await this.findLinkedExhibition(source.id, raw);
    const decision = linked ? 'MERGE' : best ? decide(best.score) : 'SEPARATE';
    const targetId = linked ?? (decision === 'SEPARATE' ? undefined : best?.row.id);

    if (options.dryRun) {
      this.tallyDryRun(decision, targetId, summary);
      return;
    }

    await this.dataSource.transaction(async (manager) => {
      const run: Runner = (sql, params) => manager.query(sql, params);

      let exhibitionId = targetId;

      if (!exhibitionId) {
        exhibitionId = await this.createExhibition(run, normalized, source);
        summary.created += 1;
      } else {
        const changed = await this.mergeIntoExhibition(
          run,
          exhibitionId,
          normalized,
          source,
          summary,
        );
        if (changed) summary.updated += 1;
        summary.duplicates += 1;
      }

      if (decision === 'REVIEW') {
        summary.review += 1;
        await run(
          `UPDATE exhibitions SET review_status = 'PENDING_REVIEW', updated_at = now()
           WHERE id = $1 AND review_status <> 'APPROVED'`,
          [exhibitionId],
        );
      }

      await this.writeSourceRecord(run, source, raw, normalized, exhibitionId);
    });
  }

  private tallyDryRun(decision: string, targetId: string | undefined, summary: IngestSummary) {
    if (!targetId) {
      summary.created += 1;
      return;
    }
    summary.duplicates += 1;
    if (decision === 'REVIEW') summary.review += 1;
  }

  /**
   * Narrows the comparison set before the TypeScript scorer runs.
   *
   * Any token of the title may match, because two sources rarely word a title
   * identically, and a date window catches records whose wording differs more
   * than their schedule does.
   */
  private async findCandidates(record: NormalizedExhibition): Promise<CandidateRow[]> {
    const tokens = normalizeForSearch(record.canonicalTitle)
      .split(' ')
      .filter((token) => token.length > 1)
      .slice(0, 8);

    // Safe to pass straight to to_tsquery: normalizeForSearch leaves only
    // letters, digits and spaces, so no tsquery operator can survive it.
    const tsquery = tokens.join(' | ');

    return this.dataSource.query(
      `SELECT id, canonical_title, start_date, end_date, venue_id,
              primary_category_id, confidence, date_status
       FROM exhibitions
       WHERE city_id = $1
         AND (
           ($2 <> '' AND search_vector @@ to_tsquery('simple', $2))
           OR ($3::date IS NOT NULL
               AND start_date BETWEEN $3::date - INTERVAL '21 days'
                                  AND $3::date + INTERVAL '21 days')
         )
       LIMIT 50`,
      [record.cityId, tsquery, record.startDate ?? null],
    );
  }

  private async findLinkedExhibition(
    sourceId: string,
    raw: RawExhibition,
  ): Promise<string | undefined> {
    if (!raw.sourceExternalId) return undefined;

    const rows = await this.dataSource.query(
      `SELECT exhibition_id FROM exhibition_source_records
       WHERE source_id = $1 AND source_external_id = $2 AND exhibition_id IS NOT NULL
       LIMIT 1`,
      [sourceId, raw.sourceExternalId],
    );
    return rows[0]?.exhibition_id ?? undefined;
  }

  private async createExhibition(
    run: Runner,
    record: NormalizedExhibition,
    source: SourceRow,
  ): Promise<string> {
    const rows = await run(
      `INSERT INTO exhibitions (
         slug, canonical_title, start_date, end_date, date_status,
         city_id, venue_id, organizer_id, primary_category_id,
         official_website, image_url, is_international, is_specialized,
         confidence, search_text, last_verified_at
       ) VALUES ($1,$2,$3,$4,$5::date_status_enum,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
       ON CONFLICT (slug) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [
        record.slug,
        record.canonicalTitle,
        record.startDate ?? null,
        record.endDate ?? null,
        record.dateStatus,
        record.cityId,
        record.venueId ?? null,
        record.organizerId ?? null,
        record.primaryCategoryId ?? null,
        record.officialWebsite ?? null,
        record.imageUrl ?? null,
        record.isInternational,
        record.isSpecialized,
        source.confidence,
        record.searchText,
      ],
    );

    const exhibitionId = rows[0].id;

    await run(
      `INSERT INTO exhibition_translations (exhibition_id, locale, title)
       VALUES ($1, 'fa', $2)
       ON CONFLICT (exhibition_id, locale)
       DO UPDATE SET title = EXCLUDED.title, updated_at = now()`,
      [exhibitionId, record.displayTitle],
    );

    if (record.primaryCategoryId) {
      await run(
        `INSERT INTO exhibition_categories (exhibition_id, category_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [exhibitionId, record.primaryCategoryId],
      );
    }

    return exhibitionId;
  }

  /**
   * Folds one source view into an existing exhibition.
   *
   * The date rule is the important part:
   *  - filling an empty date is never a conflict;
   *  - a more trusted source may correct the dates, and the correction is
   *    logged so reminders can be recalculated;
   *  - an equally or less trusted source that disagrees produces a CONFLICT and
   *    a review flag rather than a silent overwrite;
   *  - two independent sources agreeing raises confidence to the "multiple
   *    trusted sources" level from section 14.
   */
  private async mergeIntoExhibition(
    run: Runner,
    exhibitionId: string,
    record: NormalizedExhibition,
    source: SourceRow,
    summary: IngestSummary,
  ): Promise<boolean> {
    const [existing] = await run(
      `SELECT start_date, end_date, venue_id, date_status, confidence
       FROM exhibitions WHERE id = $1 FOR UPDATE`,
      [exhibitionId],
    );
    if (!existing) return false;

    const existingConfidence = Number(existing.confidence);
    const existingStart = toIso(existing.start_date);
    const existingEnd = toIso(existing.end_date);

    let nextStart = existingStart;
    let nextEnd = existingEnd;
    let nextStatus: string = existing.date_status;
    let changed = false;

    const incomingHasDates = Boolean(record.startDate && record.endDate);
    const existingHasDates = Boolean(existingStart && existingEnd);

    if (incomingHasDates && !existingHasDates) {
      nextStart = record.startDate;
      nextEnd = record.endDate;
      nextStatus = 'CONFIRMED';
      changed = true;
    } else if (incomingHasDates && existingHasDates) {
      const differs = record.startDate !== existingStart || record.endDate !== existingEnd;

      // A source revising its OWN listing is a postponement, not a
      // disagreement. Section 13 of the brief is exactly this case: the
      // published dates move and everything downstream must follow. Treating it
      // as a conflict would freeze the old dates and never reschedule anyone's
      // reminder. A conflict requires two different sources telling us
      // different things.
      const contested = differs && (await this.otherSourcesBacking(run, exhibitionId, source.id, existingStart));

      if (differs && !contested) {
        await this.recordChange(run, exhibitionId, 'start_date', existingStart, record.startDate, source.id);
        await this.recordChange(run, exhibitionId, 'end_date', existingEnd, record.endDate, source.id);
        nextStart = record.startDate;
        nextEnd = record.endDate;
        nextStatus = 'CONFIRMED';
        changed = true;
      } else if (differs && source.confidence > existingConfidence) {
        await this.recordChange(run, exhibitionId, 'start_date', existingStart, record.startDate, source.id);
        await this.recordChange(run, exhibitionId, 'end_date', existingEnd, record.endDate, source.id);
        nextStart = record.startDate;
        nextEnd = record.endDate;
        nextStatus = 'CONFIRMED';
        changed = true;
      } else if (differs) {
        await this.recordChange(run, exhibitionId, 'start_date', existingStart, record.startDate, source.id);
        nextStatus = 'CONFLICT';
        summary.conflicts += 1;
        changed = true;
        await run(
          `UPDATE exhibitions SET review_status = 'PENDING_REVIEW'
           WHERE id = $1 AND review_status <> 'APPROVED'`,
          [exhibitionId],
        );
      } else if (existing.date_status !== 'CONFLICT') {
        nextStatus = 'CONFIRMED';
      }
    }

    if (record.venueId && !existing.venue_id) changed = true;

    await run(
      `UPDATE exhibitions SET
         start_date          = $2,
         end_date            = $3,
         date_status         = $4::date_status_enum,
         venue_id            = COALESCE(venue_id, $5),
         organizer_id        = COALESCE(organizer_id, $6),
         primary_category_id = COALESCE(primary_category_id, $7),
         official_website    = COALESCE(official_website, $8),
         image_url           = COALESCE(image_url, $9),
         search_text         = CASE WHEN length($10) > length(search_text)
                                    THEN $10 ELSE search_text END,
         last_verified_at    = now(),
         updated_at          = now()
       WHERE id = $1`,
      [
        exhibitionId,
        nextStart ?? null,
        nextEnd ?? null,
        nextStatus,
        record.venueId ?? null,
        record.organizerId ?? null,
        record.primaryCategoryId ?? null,
        record.officialWebsite ?? null,
        record.imageUrl ?? null,
        record.searchText,
      ],
    );

    return changed;
  }

  /**
   * Recomputes confidence after the current source record has been written, so
   * the agreement count includes it. Called by the caller once the source
   * record exists.
   */
  private async refreshConfidence(run: Runner, exhibitionId: string): Promise<void> {
    const [row] = await run(
      `SELECT e.date_status,
              (SELECT max(s.confidence)
                 FROM exhibition_source_records r
                 JOIN sources s ON s.id = r.source_id
                WHERE r.exhibition_id = e.id) AS best,
              (SELECT count(DISTINCT r.source_id)
                 FROM exhibition_source_records r
                WHERE r.exhibition_id = e.id
                  AND r.source_start_date IS NOT DISTINCT FROM e.start_date
                  AND r.source_end_date IS NOT DISTINCT FROM e.end_date) AS agreeing
       FROM exhibitions e WHERE e.id = $1`,
      [exhibitionId],
    );
    if (!row) return;

    const best = Number(row.best ?? 0.4);
    const agreeing = Number(row.agreeing ?? 0);

    // Section 14: a conflict caps trust, independent agreement raises it.
    let confidence = best;
    if (row.date_status === 'CONFLICT') confidence = Math.min(best, 0.7);
    else if (agreeing >= 2) confidence = Math.max(best, 0.9);

    await run(`UPDATE exhibitions SET confidence = $2 WHERE id = $1`, [
      exhibitionId,
      confidence.toFixed(2),
    ]);
  }

  /**
   * Whether any source OTHER than this one currently backs the stored dates.
   *
   * Distinguishes a source revising its own listing (a postponement) from two
   * sources genuinely disagreeing (a conflict).
   */
  private async otherSourcesBacking(
    run: Runner,
    exhibitionId: string,
    sourceId: string,
    startDate: string | undefined,
  ): Promise<boolean> {
    if (!startDate) return false;

    const [row] = await run(
      `SELECT count(DISTINCT r.source_id)::int AS n
       FROM exhibition_source_records r
       WHERE r.exhibition_id = $1
         AND r.source_id <> $2
         AND r.source_start_date = $3::date`,
      [exhibitionId, sourceId, startDate],
    );

    return Number(row?.n ?? 0) > 0;
  }

  private async recordChange(
    run: Runner,
    exhibitionId: string,
    field: string,
    oldValue: string | undefined,
    newValue: string | undefined,
    sourceId: string,
  ): Promise<void> {
    if (!newValue || oldValue === newValue) return;
    await run(
      `INSERT INTO exhibition_changes (exhibition_id, field, old_value, new_value, source_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [exhibitionId, field, oldValue ?? null, newValue, sourceId],
    );
  }

  private async writeSourceRecord(
    run: Runner,
    source: SourceRow,
    raw: RawExhibition,
    normalized: NormalizedExhibition,
    exhibitionId: string,
  ): Promise<void> {
    // Hashing the source view lets a later run tell an untouched record from an
    // edited one without re-parsing everything downstream.
    const contentHash = createHash('sha256')
      .update(
        JSON.stringify([
          raw.title,
          raw.startDate ?? null,
          raw.endDate ?? null,
          raw.venue ?? null,
          raw.organizer ?? null,
        ]),
      )
      .digest('hex');

    await run(
      `INSERT INTO exhibition_source_records (
         exhibition_id, source_id, source_external_id, source_url, source_title,
         source_start_date, source_end_date, source_venue, source_category,
         source_organizer, raw_payload, content_hash, confidence, last_fetched_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
       ON CONFLICT (source_id, source_external_id) WHERE source_external_id IS NOT NULL
       DO UPDATE SET
         exhibition_id     = EXCLUDED.exhibition_id,
         source_title      = EXCLUDED.source_title,
         source_start_date = EXCLUDED.source_start_date,
         source_end_date   = EXCLUDED.source_end_date,
         source_venue      = EXCLUDED.source_venue,
         raw_payload       = EXCLUDED.raw_payload,
         content_hash      = EXCLUDED.content_hash,
         last_fetched_at   = now()`,
      [
        exhibitionId,
        source.id,
        raw.sourceExternalId ?? null,
        raw.sourceUrl,
        raw.title,
        normalized.startDate ?? null,
        normalized.endDate ?? null,
        raw.venue ?? null,
        raw.category ?? null,
        raw.organizer ?? null,
        JSON.stringify({
          ...raw.extra,
          rawStartDate: raw.rawStartDate,
          rawEndDate: raw.rawEndDate,
        }),
        contentHash,
        source.confidence,
      ],
    );

    await this.refreshConfidence(run, exhibitionId);
  }

  private async loadSource(name: string): Promise<SourceRow | undefined> {
    const rows = await this.dataSource.query(
      `SELECT id, name, confidence FROM sources WHERE name = $1 LIMIT 1`,
      [name],
    );
    return rows[0]
      ? { id: rows[0].id, name: rows[0].name, confidence: Number(rows[0].confidence) }
      : undefined;
  }
}

function toIso(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    // Postgres DATE comes back as a local-midnight Date; formatting it in UTC
    // would shift it a day west of Greenwich.
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}
