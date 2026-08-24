import { Fetcher } from '../../common/http/fetcher';

/**
 * What a source reports, before anything has been cleaned up.
 *
 * `RawExhibition` is deliberately permissive: every text field is whatever the
 * site actually printed, and dates are optional. Adapters are forbidden from
 * normalizing, mapping, or filling in gaps — that is the Normalizer's job, and
 * keeping the boundary sharp is what makes adapters testable against a saved
 * fixture. A missing date stays missing so the pipeline can record UNKNOWN
 * rather than a guess.
 */
export interface RawExhibition {
  /** Stable id from the source, when it has one. The strongest dedup signal. */
  sourceExternalId?: string;
  sourceUrl: string;
  title: string;

  /**
   * ISO yyyy-mm-dd, and ONLY when the source stated a Gregorian date. Adapters
   * must never convert a Jalali date themselves — see DATA_SOURCES.md.
   */
  startDate?: string;
  endDate?: string;

  /** The Jalali date exactly as printed, kept for cross-checking. */
  rawStartDate?: string;
  rawEndDate?: string;

  venue?: string;
  city?: string;
  country?: string;
  category?: string;
  organizer?: string;
  organizerContact?: string;
  officialWebsite?: string;
  imageUrl?: string;
  status?: string;

  /** Anything else worth keeping verbatim, stored as jsonb on the record. */
  extra?: Record<string, unknown>;
}

export interface SourceContext {
  fetcher: Fetcher;
  /** Locations to pull, using whatever slug the source itself uses. */
  locations: string[];
  logger?: {
    debug(message: string, meta?: unknown): void;
    warn(message: string, meta?: unknown): void;
  };
  /** Caps detail-page requests per run so one sync cannot run away. */
  maxDetailFetches?: number;

  /**
   * How many pages of the listing to walk.
   *
   * eventro pages backwards through time, so this is really "how much history
   * to carry". Past exhibitions matter: somebody searching for a furniture fair
   * wants to know when it was held and where, not only whether one is coming.
   */
  maxListPages?: number;
}

export interface SourceResult {
  exhibitions: RawExhibition[];
  /** Non-fatal problems: a single unparseable row must not fail the run. */
  warnings: string[];
}

export interface ExhibitionSource {
  readonly name: string;
  readonly displayName: string;
  readonly baseUrl: string;
  fetchExhibitions(context: SourceContext): Promise<SourceResult>;
}
