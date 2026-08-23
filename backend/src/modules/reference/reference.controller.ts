import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { AllowGuest } from '../auth/jwt-auth.guard';
import { ReferenceService } from './reference.service';

@AllowGuest()
@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly service: ReferenceService) {}

  @Get()
  @ApiOperation({ summary: 'Category tree with per-category exhibition counts' })
  @ApiQuery({ name: 'city', required: false, description: 'Scope the counts to one city' })
  list(@Query('city') city?: string) {
    return this.service.categories(city);
  }
}

@AllowGuest()
@ApiTags('venues')
@Controller('venues')
export class VenuesController {
  constructor(private readonly service: ReferenceService) {}

  @Get()
  @ApiOperation({ summary: 'Venues, optionally filtered by city' })
  @ApiQuery({ name: 'city', required: false })
  list(@Query('city') city?: string) {
    return this.service.venues(city);
  }
}

@AllowGuest()
@ApiTags('cities')
@Controller('cities')
export class CitiesController {
  constructor(private readonly service: ReferenceService) {}

  @Get()
  @ApiOperation({ summary: 'Cities with their IANA timezone' })
  list() {
    return this.service.cities();
  }
}
