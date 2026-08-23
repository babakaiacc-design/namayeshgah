import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { AllowGuest } from '../auth/jwt-auth.guard';

// The scheduled keepalive has no token, so this must stay open.
@AllowGuest()
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Also serves as the wake-up target for the scheduled keepalive, which stops
   * Render from sleeping the service and Supabase from pausing the project.
   */
  @Get()
  @ApiOperation({ summary: 'Liveness and database connectivity check' })
  async check() {
    let database: 'up' | 'down' = 'down';
    try {
      await this.dataSource.query('SELECT 1');
      database = 'up';
    } catch {
      database = 'down';
    }

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
