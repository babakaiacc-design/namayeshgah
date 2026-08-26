import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { AllowGuest } from '../auth/jwt-auth.guard';
import { ExhibitionDetailDto } from './dto/exhibition.dto';
import { CityQueryDto, QueryExhibitionsDto, UpcomingQueryDto } from './dto/query-exhibitions.dto';
import { ExhibitionsService } from './exhibitions.service';

/**
 * Read endpoints, all open to guests.
 *
 * Section 33 of the brief: browsing, searching and filtering never require an
 * account. Only reminders do.
 */
@AllowGuest()
@ApiTags('exhibitions')
@Controller('exhibitions')
export class ExhibitionsController {
  constructor(private readonly service: ExhibitionsService) {}

  @Get()
  @ApiOperation({ summary: 'Search and filter exhibitions. Pagination is mandatory.' })
  list(@Query() query: QueryExhibitionsDto) {
    return this.service.search(query);
  }

  @Get('search')
  @ApiOperation({ summary: 'Alias of the list endpoint, sorted by relevance by default' })
  search(@Query() query: QueryExhibitionsDto) {
    return this.service.search(query);
  }

  @Get('today')
  @ApiOperation({
    summary: 'Exhibitions running right now, judged in the city timezone',
  })
  today(@Query() query: CityQueryDto) {
    return this.service.today(query.city ?? 'tehran', query.locale ?? 'fa', query.limit, query.offset);
  }

  @Get('upcoming')
  @ApiOperation({ summary: 'Exhibitions starting within the next N days' })
  upcoming(@Query() query: UpcomingQueryDto) {
    return this.service.upcoming(query);
  }

  @Get('date/:date')
  @ApiOperation({ summary: 'Exhibitions open on a given Gregorian date' })
  @ApiParam({ name: 'date', example: '2026-08-31', description: 'yyyy-mm-dd' })
  onDate(@Param('date') date: string, @Query() query: CityQueryDto) {
    // The API speaks Gregorian ISO dates only; converting from the Jalali
    // calendar is the client's job, so no calendar maths lives on the server.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date must be an ISO Gregorian date, yyyy-mm-dd');
    }
    return this.service.onDate(date, query.city ?? 'tehran', query.locale ?? 'fa', query.limit, query.offset);
  }

  @Get(':idOrSlug')
  @ApiOperation({ summary: 'One exhibition, including where its data came from' })
  @ApiOkResponse({ type: ExhibitionDetailDto })
  findOne(@Param('idOrSlug') idOrSlug: string, @Query('locale') locale = 'fa') {
    return this.service.findOne(idOrSlug, locale);
  }
}
