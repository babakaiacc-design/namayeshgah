import { Injectable, NotFoundException } from '@nestjs/common';

import { PaginatedDto } from '../../common/dto/pagination.dto';
import {
  ExhibitionDetailDto,
  ExhibitionDto,
  toExhibitionDto,
} from './dto/exhibition.dto';
import { QueryExhibitionsDto, UpcomingQueryDto } from './dto/query-exhibitions.dto';
import { ExhibitionsRepository } from './exhibitions.repository';

@Injectable()
export class ExhibitionsService {
  constructor(private readonly repository: ExhibitionsRepository) {}

  async search(query: QueryExhibitionsDto): Promise<PaginatedDto<ExhibitionDto>> {
    const { items, total } = await this.repository.search(query);
    return new PaginatedDto(items.map(toExhibitionDto), total, query.limit, query.offset);
  }

  async today(city: string, locale: string, limit: number, offset: number) {
    const { items, total } = await this.repository.findOngoing(city, locale, limit, offset);
    return new PaginatedDto(items.map(toExhibitionDto), total, limit, offset);
  }

  async onDate(date: string, city: string, locale: string, limit: number, offset: number) {
    const { items, total } = await this.repository.findStartingOn(
      date,
      city,
      locale,
      limit,
      offset,
    );
    return new PaginatedDto(items.map(toExhibitionDto), total, limit, offset);
  }

  async upcoming(query: UpcomingQueryDto) {
    const { items, total } = await this.repository.findUpcoming(
      query.days,
      query.city ?? 'tehran',
      query.locale ?? 'fa',
      query.limit,
      query.offset,
    );
    return new PaginatedDto(items.map(toExhibitionDto), total, query.limit, query.offset);
  }

  async findOne(idOrSlug: string, locale: string): Promise<ExhibitionDetailDto> {
    const row = await this.repository.findByIdOrSlug(idOrSlug, locale);
    if (!row) throw new NotFoundException(`exhibition "${idOrSlug}" was not found`);

    const sources = await this.repository.findSourceRecords(row.id);

    return {
      ...toExhibitionDto(row),
      // Provenance travels with the detail response so a client can show where
      // a date came from, and show both sides when they disagree.
      sources: sources.map((source: any) => ({
        sourceName: source.source_name,
        displayName: source.display_name,
        sourceUrl: source.source_url,
        sourceTitle: source.source_title,
        startDate: source.source_start_date,
        endDate: source.source_end_date,
        venue: source.source_venue,
        confidence: Number(source.source_confidence),
        lastFetchedAt: source.last_fetched_at.toISOString(),
      })),
    };
  }
}
