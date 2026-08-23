import { normalizeForSearch } from '../../common/persian/persian.util';

/**
 * Trigram similarity, implemented here rather than delegated to pg_trgm.
 *
 * pg_trgm tokenizes according to the database's ctype: on a C-locale cluster it
 * produces no trigrams at all for Persian and similarity() always returns 0,
 * while Supabase's UTF-8 locale makes the same call work. Depending on it would
 * mean CI and production quietly disagreeing about which exhibitions are
 * duplicates. Computing it in TypeScript makes the score identical everywhere.
 *
 * The algorithm mirrors pg_trgm's: each word is padded with two leading and one
 * trailing space, three-character windows are collected, and the two sets are
 * compared by Jaccard index. Padding is what makes short words comparable and
 * gives word beginnings extra weight.
 */
export function trigrams(input: string): Set<string> {
  const normalized = normalizeForSearch(input);
  if (!normalized) return new Set();

  const result = new Set<string>();

  for (const word of normalized.split(' ')) {
    if (!word) continue;
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) {
      result.add(padded.slice(i, i + 3));
    }
  }

  return result;
}

/** Jaccard index of the two trigram sets, 0..1. */
export function titleSimilarity(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);

  if (left.size === 0 && right.size === 0) return 0;
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const gram of left) {
    if (right.has(gram)) intersection += 1;
  }

  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface DateRange {
  start?: string | null;
  end?: string | null;
}

/**
 * How much two date ranges agree, 0..1.
 *
 * Returns undefined when either side has no start date. That is not the same as
 * "they disagree": an exhibition whose date nobody has published yet must not
 * be pushed away from its duplicate just because the date is unknown, so the
 * caller drops the signal instead of scoring it zero.
 */
export function dateOverlap(a: DateRange, b: DateRange): number | undefined {
  if (!a.start || !b.start) return undefined;

  const aStart = Date.parse(a.start);
  const bStart = Date.parse(b.start);
  if (Number.isNaN(aStart) || Number.isNaN(bStart)) return undefined;

  const aEnd = a.end ? Date.parse(a.end) : aStart;
  const bEnd = b.end ? Date.parse(b.end) : bStart;

  const day = 86_400_000;
  const overlap = Math.min(aEnd, bEnd) - Math.max(aStart, bStart);

  if (overlap >= 0) {
    const spanA = aEnd - aStart + day;
    const spanB = bEnd - bStart + day;
    return (overlap + day) / Math.max(spanA, spanB);
  }

  // Disjoint. A postponement of a day or two is still very likely the same
  // event, so decay rather than dropping straight to zero.
  const gapDays = Math.abs(overlap) / day;
  if (gapDays <= 7) return Math.max(0, 0.5 - gapDays * 0.07);
  return 0;
}

export interface MatchCandidate {
  title: string;
  start?: string | null;
  end?: string | null;
  venueId?: string | null;
  categoryId?: string | null;
  /** Set only when both records come from the same source. */
  externalId?: string | null;
}

export interface MatchResult {
  score: number;
  /** Per-signal contributions, for the admin review queue to display. */
  signals: Record<string, number>;
  /** True when a source's own id proved identity outright. */
  exact: boolean;
  reason: string;
}

const WEIGHTS = {
  title: 0.45,
  dates: 0.3,
  venue: 0.15,
  category: 0.1,
} as const;

/**
 * Highest score a title-only comparison may reach.
 *
 * Two different editions of the same annual fair have nearly identical titles.
 * Without a date, a venue or a category to corroborate, the pair goes to the
 * admin review queue instead of being merged automatically.
 */
export const TITLE_ONLY_CEILING = 0.94;

export const AUTO_MERGE_THRESHOLD = 0.95;
export const REVIEW_THRESHOLD = 0.8;

/**
 * Weighted match score between an incoming record and an existing exhibition.
 *
 * Signals that neither record can supply are excluded from the denominator
 * rather than counted as disagreement, so a record with an unknown date is
 * judged on the evidence that does exist.
 */
export function scoreMatch(a: MatchCandidate, b: MatchCandidate): MatchResult {
  if (a.externalId && b.externalId && a.externalId === b.externalId) {
    return {
      score: 1,
      signals: { externalId: 1 },
      exact: true,
      reason: 'identical external id from the same source',
    };
  }

  const signals: Record<string, number> = {};
  let weighted = 0;
  let totalWeight = 0;

  const add = (name: keyof typeof WEIGHTS, value: number | undefined) => {
    if (value === undefined) return;
    signals[name] = value;
    weighted += WEIGHTS[name] * value;
    totalWeight += WEIGHTS[name];
  };

  add('title', titleSimilarity(a.title, b.title));
  add('dates', dateOverlap(a, b));

  if (a.venueId && b.venueId) add('venue', a.venueId === b.venueId ? 1 : 0);
  if (a.categoryId && b.categoryId) add('category', a.categoryId === b.categoryId ? 1 : 0);

  if (totalWeight === 0) {
    return { score: 0, signals, exact: false, reason: 'no comparable signals' };
  }

  let score = weighted / totalWeight;
  let reason = 'weighted signal match';

  const corroborated = Object.keys(signals).some((name) => name !== 'title');
  if (!corroborated && score > TITLE_ONLY_CEILING) {
    score = TITLE_ONLY_CEILING;
    reason = 'title-only match, capped pending review';
  }

  return { score, signals, exact: false, reason };
}

export type MatchDecision = 'MERGE' | 'REVIEW' | 'SEPARATE';

export function decide(score: number): MatchDecision {
  if (score >= AUTO_MERGE_THRESHOLD) return 'MERGE';
  if (score >= REVIEW_THRESHOLD) return 'REVIEW';
  return 'SEPARATE';
}
