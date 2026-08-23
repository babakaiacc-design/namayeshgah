import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController, ApiOperation } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { AllowGuest } from '../auth/jwt-auth.guard';
import { SyncSecretGuard } from './sync-secret.guard';
import { SyncService } from './sync.service';

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
    });
  }

  @Get('sources')
  @ApiOperation({ summary: 'Source monitoring: last run, failures, counts' })
  sources() {
    return this.service.sourceStatus();
  }
}
