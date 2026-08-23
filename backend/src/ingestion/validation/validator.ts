import { normalizePersian } from '../../common/persian/persian.util';
import { RawExhibition } from '../adapters/exhibition-source';
import { NormalizedExhibition } from '../normalizer/normalizer';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Gate applied before a raw record is allowed into the pipeline (section 45).
 *
 * Note what is deliberately NOT required: a start date. Section 45 lists dates
 * as mandatory, but rule 58 forbids inventing one, and the two only conflict if
 * "required" is read as "must exist on every record". The resolution used
 * throughout this project is that a date must be VALID when present and
 * TRACEABLE to a source, never fabricated to satisfy a schema. A dateless
 * exhibition is stored with date_status = 'UNKNOWN'.
 */
export function validateRaw(raw: RawExhibition): ValidationResult {
  const errors: string[] = [];

  if (!normalizePersian(raw.title)) {
    errors.push('title is required');
  }

  if (!raw.sourceUrl || !isHttpUrl(raw.sourceUrl)) {
    errors.push(`sourceUrl is not a valid http(s) url: ${raw.sourceUrl ?? '(missing)'}`);
  }

  const start = parseIsoDate(raw.startDate);
  const end = parseIsoDate(raw.endDate);

  if (raw.startDate && !start) errors.push(`startDate is not a valid ISO date: ${raw.startDate}`);
  if (raw.endDate && !end) errors.push(`endDate is not a valid ISO date: ${raw.endDate}`);
  if (start && end && start > end) {
    errors.push(`startDate ${raw.startDate} is after endDate ${raw.endDate}`);
  }

  if (raw.officialWebsite && !isHttpUrl(raw.officialWebsite)) {
    // Not fatal: a bad organizer website should not cost us the exhibition.
    raw.officialWebsite = undefined;
  }

  return { valid: errors.length === 0, errors };
}

/** Second gate, after reference resolution, mirroring the database constraints. */
export function validateNormalized(record: NormalizedExhibition): ValidationResult {
  const errors: string[] = [];

  if (!record.displayTitle) errors.push('displayTitle is required');
  if (!record.slug) errors.push('slug is required');
  if (!record.cityId) errors.push('cityId is required');

  if (record.startDate && record.endDate && record.startDate > record.endDate) {
    errors.push('startDate is after endDate');
  }

  // The same rule the CHECK constraint enforces, caught here so the failure
  // carries a readable message instead of a Postgres error.
  if (record.dateStatus === 'CONFIRMED' && !(record.startDate && record.endDate)) {
    errors.push('dateStatus CONFIRMED requires both a start and an end date');
  }

  return { valid: errors.length === 0, errors };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseIsoDate(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10) === value ? value : undefined;
}
