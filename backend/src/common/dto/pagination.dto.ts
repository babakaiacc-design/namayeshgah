import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/**
 * Pagination is mandatory on every list endpoint (section 31 of the brief).
 *
 * The cap matters more than the default: a free-tier database and a 512MB
 * service cannot serve an unbounded result set, and a mobile client on a slow
 * connection should never receive one either.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;
}

export class PaginatedDto<T> {
  @ApiProperty({ isArray: true })
  items: T[];

  @ApiProperty({ description: 'Total rows matching the filter, ignoring paging' })
  total: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  offset: number;

  @ApiProperty({ description: 'True when another page exists after this one' })
  hasMore: boolean;

  constructor(items: T[], total: number, limit: number, offset: number) {
    this.items = items;
    this.total = total;
    this.limit = limit;
    this.offset = offset;
    this.hasMore = offset + items.length < total;
  }
}
