import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ExhibitionRow } from '../exhibitions.repository';

export class ExhibitionDatesDto {
  @ApiPropertyOptional({ description: 'yyyy-mm-dd, null when no source has published one' })
  start!: string | null;

  @ApiPropertyOptional()
  end!: string | null;

  /**
   * CONFIRMED, UNKNOWN, CONFLICT or POSTPONED.
   *
   * Deliberately part of the public contract. Rule 58 forbids inventing a date,
   * which is only meaningful if the client can tell a confirmed date from an
   * absent or disputed one and say so to the user.
   */
  @ApiProperty({ enum: ['CONFIRMED', 'UNKNOWN', 'CONFLICT', 'POSTPONED'] })
  status!: string;

  @ApiPropertyOptional()
  startTime!: string | null;

  @ApiPropertyOptional()
  endTime!: string | null;

  @ApiPropertyOptional({ description: 'Days until the start, in the venue city timezone' })
  daysUntil!: number | null;

  @ApiProperty()
  isOngoing!: boolean;
}

export class ExhibitionDto {
  @ApiProperty() id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional() description!: string | null;

  @ApiProperty({ type: ExhibitionDatesDto }) dates!: ExhibitionDatesDto;

  @ApiProperty() city!: { slug: string; name: string; timezone: string; country: string };
  @ApiPropertyOptional() venue!: {
    slug: string;
    name: string;
    latitude: number | null;
    longitude: number | null;
    address: string | null;
  } | null;
  @ApiPropertyOptional() category!: { slug: string; name: string } | null;
  @ApiPropertyOptional() organizer!: string | null;

  @ApiProperty() isInternational!: boolean;
  @ApiProperty() isSpecialized!: boolean;
  @ApiProperty() status!: string;
  @ApiProperty() eventType!: string;

  @ApiPropertyOptional() officialWebsite!: string | null;
  @ApiPropertyOptional() imageUrl!: string | null;

  /** 0..1, from section 14. Lets the client show how well corroborated a row is. */
  @ApiProperty() confidence!: number;

  /** Section 30: the app shows "last checked N days ago". */
  @ApiPropertyOptional() lastVerifiedAt!: string | null;
}

const toNumber = (value: string | null): number | null =>
  value === null || value === undefined ? null : Number(value);

export function toExhibitionDto(row: ExhibitionRow): ExhibitionDto {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    dates: {
      start: row.start_date,
      end: row.end_date,
      status: row.date_status,
      startTime: row.start_time,
      endTime: row.end_time,
      daysUntil: row.days_until === null ? null : Number(row.days_until),
      isOngoing: row.is_ongoing,
    },
    city: {
      slug: row.city_slug,
      name: row.city_name,
      timezone: row.city_timezone,
      country: row.country_iso2,
    },
    venue: row.venue_slug
      ? {
          slug: row.venue_slug,
          name: row.venue_name as string,
          latitude: toNumber(row.venue_latitude),
          longitude: toNumber(row.venue_longitude),
          address: row.venue_address,
        }
      : null,
    category: row.category_slug
      ? { slug: row.category_slug, name: row.category_name as string }
      : null,
    organizer: row.organizer_name,
    isInternational: row.is_international,
    isSpecialized: row.is_specialized,
    status: row.status,
    eventType: row.event_type,
    officialWebsite: row.official_website,
    imageUrl: row.image_url,
    confidence: Number(row.confidence),
    lastVerifiedAt: row.last_verified_at ? row.last_verified_at.toISOString() : null,
  };
}

export class ExhibitionSourceDto {
  @ApiProperty() sourceName!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() sourceUrl!: string;
  @ApiProperty() sourceTitle!: string;
  @ApiPropertyOptional() startDate!: string | null;
  @ApiPropertyOptional() endDate!: string | null;
  @ApiPropertyOptional() venue!: string | null;
  @ApiProperty() confidence!: number;
  @ApiProperty() lastFetchedAt!: string;
}

export class ExhibitionDetailDto extends ExhibitionDto {
  /**
   * Every source that reported this exhibition. When dates.status is CONFLICT
   * this is where the disagreement is visible.
   */
  @ApiProperty({ type: [ExhibitionSourceDto] })
  sources!: ExhibitionSourceDto[];
}
