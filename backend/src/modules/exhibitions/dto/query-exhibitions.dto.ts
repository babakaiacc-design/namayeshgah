import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export enum ExhibitionSort {
  StartDateAsc = 'startDate',
  StartDateDesc = '-startDate',
  Relevance = 'relevance',
  /**
   * Upcoming first and soonest, then the past with the most recent first.
   *
   * Plain ascending order was fine while the calendar only held the current
   * window, but now that a year of history is ingested it buries what is coming
   * under exhibitions from three years ago.
   */
  Soonest = 'soonest',
}

export enum ExhibitionTimeframe {
  Ongoing = 'ongoing',
  Upcoming = 'upcoming',
  Past = 'past',
}

const toBoolean = ({ value }: { value: unknown }) => {
  if (value === undefined || value === '') return undefined;
  return value === true || value === 'true' || value === '1';
};

/**
 * Filters from section 31 of the brief.
 *
 * Slugs are used rather than ids so a client can build a link without holding
 * a uuid, and so the API stays readable.
 */
export class QueryExhibitionsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Free text; Persian is normalized before matching' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Inclusive lower bound, yyyy-mm-dd' })
  @IsOptional()
  @IsISO8601({ strict: true })
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Inclusive upper bound, yyyy-mm-dd' })
  @IsOptional()
  @IsISO8601({ strict: true })
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Category slug; child categories are included' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Venue slug' })
  @IsOptional()
  @IsString()
  venue?: string;

  @ApiPropertyOptional({ description: 'City slug', default: 'tehran' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'Country ISO-3166 alpha-2' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ enum: ExhibitionTimeframe })
  @IsOptional()
  @IsEnum(ExhibitionTimeframe)
  timeframe?: ExhibitionTimeframe;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isInternational?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isSpecialized?: boolean;

  /**
   * Exhibitions whose date no source has published are hidden by default: a
   * dateless row is not useful in a calendar. It stays reachable so an admin,
   * or a client that wants to show it honestly, can ask for it.
   */
  @ApiPropertyOptional({
    default: false,
    description: 'Include exhibitions whose dates are UNKNOWN',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  includeUndated?: boolean = false;

  @ApiPropertyOptional({ enum: ExhibitionSort, default: ExhibitionSort.StartDateAsc })
  @IsOptional()
  @IsEnum(ExhibitionSort)
  sort?: ExhibitionSort = ExhibitionSort.StartDateAsc;

  @ApiPropertyOptional({ default: 'fa', description: 'Locale for the returned title' })
  @IsOptional()
  @IsString()
  locale?: string = 'fa';
}

/**
 * Shared by /today and /date/:date.
 *
 * Both used to mix a whole-object `@Query() paging: PaginationQueryDto` with
 * separately-decorated `@Query('city')`/`@Query('locale')` params. Under the
 * global ValidationPipe's forbidNonWhitelisted, the whole-object decorator
 * validates the ENTIRE querystring against PaginationQueryDto, so any request
 * that actually passed city or locale — which is every real client — was
 * rejected with 400 "property city should not exist". One DTO that declares
 * every field the query can carry avoids that trap.
 */
export class CityQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ default: 'tehran' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ default: 'fa' })
  @IsOptional()
  @IsString()
  locale?: string = 'fa';
}

export class UpcomingQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ default: 7, minimum: 1, maximum: 365 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  days = 7;

  @ApiPropertyOptional({ default: 'tehran' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ default: 'fa' })
  @IsOptional()
  @IsString()
  locale?: string = 'fa';
}
