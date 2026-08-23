/** Mirrors the response DTOs the backend publishes. */

export type DateStatus = 'CONFIRMED' | 'UNKNOWN' | 'CONFLICT' | 'POSTPONED';

export interface ExhibitionDates {
  start: string | null;
  end: string | null;
  /**
   * Part of the contract on purpose. The backend never invents a date, and the
   * UI is expected to say so rather than showing a blank where a date belongs.
   */
  status: DateStatus;
  startTime: string | null;
  endTime: string | null;
  daysUntil: number | null;
  isOngoing: boolean;
}

export interface CityRef {
  slug: string;
  name: string;
  timezone: string;
  country: string;
}

export interface VenueRef {
  slug: string;
  name: string;
  /** Null until an admin fills it from a verified source; hide directions then. */
  latitude: number | null;
  longitude: number | null;
  address: string | null;
}

export interface CategoryRef {
  slug: string;
  name: string;
}

export interface Exhibition {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  dates: ExhibitionDates;
  city: CityRef;
  venue: VenueRef | null;
  category: CategoryRef | null;
  organizer: string | null;
  isInternational: boolean;
  isSpecialized: boolean;
  status: string;
  eventType: string;
  officialWebsite: string | null;
  imageUrl: string | null;
  confidence: number;
  lastVerifiedAt: string | null;
}

export interface ExhibitionSource {
  sourceName: string;
  displayName: string;
  sourceUrl: string;
  sourceTitle: string;
  startDate: string | null;
  endDate: string | null;
  venue: string | null;
  confidence: number;
  lastFetchedAt: string;
}

export interface ExhibitionDetail extends Exhibition {
  sources: ExhibitionSource[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface CategoryNode {
  id: string;
  slug: string;
  nameFa: string;
  nameEn: string;
  icon: string | null;
  exhibitionCount: number;
  children: CategoryNode[];
}

export interface Venue {
  slug: string;
  nameFa: string;
  nameEn: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  website: string | null;
  phone: string | null;
  city: { slug: string; name: string };
}

export interface City {
  slug: string;
  nameFa: string;
  nameEn: string;
  timezone: string;
  country: { iso2: string; nameFa: string };
}

export interface ExhibitionQuery {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  category?: string;
  venue?: string;
  city?: string;
  timeframe?: 'ongoing' | 'upcoming' | 'past';
  isInternational?: boolean;
  isSpecialized?: boolean;
  includeUndated?: boolean;
  sort?: 'startDate' | '-startDate' | 'relevance';
  limit?: number;
  offset?: number;
}
