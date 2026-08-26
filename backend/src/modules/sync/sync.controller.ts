import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController, ApiOperation } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { AllowGuest } from '../auth/jwt-auth.guard';
import { SyncSecretGuard } from './sync-secret.guard';
import { SyncService } from './sync.service';

export class RawExhibitionDto {
  @IsOptional()
  @IsString()
  sourceExternalId?: string;

  @IsString()
  sourceUrl!: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  rawStartDate?: string;

  @IsOptional()
  @IsString()
  rawEndDate?: string;

  @IsOptional()
  @IsString()
  venue?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  organizer?: string;

  @IsOptional()
  @IsString()
  organizerContact?: string;

  @IsOptional()
  @IsString()
  officialWebsite?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsObject()
  extra?: Record<string, unknown>;
}

export class ManualIngestDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RawExhibitionDto)
  exhibitions!: RawExhibitionDto[];
}

export class TriggerSyncDto {
  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  locations?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  maxDetailFetches?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  maxListPages?: number;
}

/**
 * Internal endpoint driven by the scheduled GitHub Actions job.
 *
 * Excluded from the public API docs and guarded by a shared secret rather than
 * a user token. AllowGuest only turns off the JWT guard; SyncSecretGuard is
 * what actually protects it.
 */
@ApiExcludeController()
@AllowGuest()
@UseGuards(SyncSecretGuard)
@Controller('internal')
export class SyncController {
  constructor(private readonly service: SyncService) {}

  @Post('sync')
  @HttpCode(200)
  @ApiOperation({ summary: 'Run ingestion for one or all enabled sources' })
  trigger(@Body() body: TriggerSyncDto) {
    return this.service.run({
      source: body.source,
      dryRun: body.dryRun,
      locations: body.locations,
      maxDetailFetches: body.maxDetailFetches,
      maxListPages: body.maxListPages,
    });
  }

  @Get('sources')
  @ApiOperation({ summary: 'Source monitoring: last run, failures, counts' })
  sources() {
    return this.service.sourceStatus();
  }

  @Post('manual-ingest')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ingest hand-curated exhibitions under the "manual" source' })
  manualIngest(@Body() body: ManualIngestDto) {
    return this.service.ingestManual(body.exhibitions);
  }
}
