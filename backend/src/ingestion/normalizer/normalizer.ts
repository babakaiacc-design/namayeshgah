import { normalizePersian, normalizeForSearch, slugify } from '../../common/persian/persian.util';
import { RawExhibition } from '../adapters/exhibition-source';
import { ReferenceResolver } from './reference-resolver';

/**
 * A canonical exhibition candidate: source text mapped onto our own ids.
 *
 * Everything an adapter left as free text has been resolved here, and anything
 * that could not be resolved is absent rather than approximated.
 */
export interface NormalizedExhibition {
  displayTitle: string;
  canonicalTitle: string;
  slug: string;

  startDate?: string;
  endDate?: string;
  dateStatus: 'CONFIRMED' | 'UNKNOWN';

  cityId: string;
  venueId?: string;
  organizerId?: string;
  primaryCategoryId?: string;

  officialWebsite?: string;
  imageUrl?: string;
  isInternational: boolean;
  isSpecialized: boolean;

  searchText: string;
  tags: string[];
}

export interface NormalizeResult {
  normalized?: NormalizedExhibition;
  warnings: string[];
  /** Set when the record could not be mapped at all. */
  rejectedReason?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Maps a RawExhibition onto reference ids.
 *
 * Deliberately does NOT convert dates: adapters only ever supply a Gregorian
 * date the source itself printed, so there is nothing to convert. The one date
 * decision made here is whether the pair is complete enough to be called
 * CONFIRMED.
 */
export class Normalizer {
  constructor(private readonly resolver: ReferenceResolver) {}

  async normalize(raw: RawExhibition): Promise<NormalizeResult> {
    const warnings: string[] = [];

    const displayTitle = normalizePersian(raw.title);
    if (!displayTitle) {
      return { warnings, rejectedReason: 'title is empty after normalization' };
    }

    // The venue is usually stated outright, but some sources only put it in the
    // title, so fall back to scanning the title for a known alias.
    let venue = await this.resolver.resolveVenue(raw.venue);
    if (!venue) {
      venue = await this.resolver.findVenueInText(displayTitle);
      if (!venue && raw.venue) {
        // Worth surfacing: an unmapped venue means a missing alias, not a
        // reason to invent a new venue row.
        warnings.push(`unmapped venue "${raw.venue}" for "${displayTitle}"`);
      }
    }

    // A resolved venue pins the city more reliably than the source's own text.
    let city = venue
      ? undefined
      : (await this.resolver.resolveCity(raw.city)) ?? (await this.resolver.defaultCity());

    let cityId = venue?.cityId ?? city?.id;
    if (!cityId) {
      const fallback = await this.resolver.defaultCity();
      cityId = fallback?.id;
      city = fallback;
    }
    if (!cityId) {
      return { warnings, rejectedReason: 'no city could be resolved and no default city exists' };
    }

    // Some sources state a category; others, eventro included, state none at
    // all, so the title is the only place left to look.
    let category = await this.resolver.resolveCategory(raw.category);
    if (!category) {
      category = await this.resolver.findCategoryInText(displayTitle);
      if (!category && raw.category) {
        warnings.push(`unmapped category "${raw.category}" for "${displayTitle}"`);
      }
    }

    const organizer = await this.resolver.resolveOrganizer(raw.organizer);

    const { startDate, endDate, dateStatus, dateWarnings } = this.resolveDates(raw, displayTitle);
    warnings.push(...dateWarnings);

    const level = typeof raw.extra?.level === 'string' ? raw.extra.level : '';
    const normalizedLevel = normalizeForSearch(level);
    const normalizedTitle = normalizeForSearch(displayTitle);

    const searchText = [
      displayTitle,
      raw.organizer,
      venue?.nameFa,
      category?.nameFa,
      raw.city,
    ]
      .filter(Boolean)
      .join(' ');

    return {
      warnings,
      normalized: {
        displayTitle,
        canonicalTitle: displayTitle,
        slug: this.buildSlug(displayTitle, raw),
        startDate,
        endDate,
        dateStatus,
        cityId,
        venueId: venue?.id,
        organizerId: organizer?.id,
        primaryCategoryId: category?.id,
        officialWebsite: raw.officialWebsite,
        imageUrl: raw.imageUrl,
        // Taken from the source's own "سطح برگزاری" field where it exists, and
        // only then from the title.
        isInternational: normalizedLevel
          ? normalizedLevel.includes('بین المللی')
          : normalizedTitle.includes('بین المللی'),
        isSpecialized: normalizedTitle.includes('تخصصی'),
        searchText,
        tags: [],
      },
    };
  }

  /**
   * A date pair is CONFIRMED only when both ends are present and valid.
   *
   * A start with no end stays UNKNOWN rather than having the end defaulted to
   * the start: rule 58 forbids inventing a date, and the database rejects a
   * CONFIRMED row without both dates anyway.
   */
  private resolveDates(raw: RawExhibition, title: string) {
    const dateWarnings: string[] = [];
    const startDate = this.validDate(raw.startDate);
    const endDate = this.validDate(raw.endDate);

    if (raw.startDate && !startDate) {
      dateWarnings.push(`ignored malformed start date "${raw.startDate}" for "${title}"`);
    }
    if (raw.endDate && !endDate) {
      dateWarnings.push(`ignored malformed end date "${raw.endDate}" for "${title}"`);
    }

    if (startDate && endDate && startDate > endDate) {
      dateWarnings.push(`start after end for "${title}", both kept but marked unknown`);
      return { startDate, endDate, dateStatus: 'UNKNOWN' as const, dateWarnings };
    }

    const dateStatus = startDate && endDate ? ('CONFIRMED' as const) : ('UNKNOWN' as const);
    return { startDate, endDate, dateStatus, dateWarnings };
  }

  private validDate(value: string | undefined): string | undefined {
    if (!value || !ISO_DATE.test(value)) return undefined;

    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return undefined;
    if (parsed.toISOString().slice(0, 10) !== value) return undefined;

    // Guards against a parser producing something absurd, such as a year that
    // came from a page number.
    const year = parsed.getUTCFullYear();
    if (year < 2000 || year > 2100) return undefined;

    return value;
  }

  /**
   * The source's own id keeps slugs unique and stable across runs; without one
   * a hash of the title is used so re-running produces the same slug.
   */
  private buildSlug(title: string, raw: RawExhibition): string {
    const base = slugify(title).slice(0, 80) || 'exhibition';
    const suffix =
      raw.sourceExternalId ??
      Buffer.from(normalizeForSearch(title)).toString('hex').slice(0, 10);
    return `${base}-${suffix}`;
  }
}
