import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import { seed } from './seeds/run-seed';

/**
 * Bootstrap database on startup: runs pending migrations and idempotent seed.
 * For free tiers without preDeployCommand support (Render free), this ensures
 * schema is ready before any request hits the app.
 *
 * Errors are fatal: a broken DB should not let the app boot.
 */
@Injectable()
export class BootstrapService {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get('app.isProduction')) {
      this.logger.log('Running migrations and seed on startup...');
      try {
        const migrations = await this.dataSource.runMigrations();
        this.logger.log(`[bootstrap] ${migrations.length} migration(s) executed`);
        await seed(this.dataSource);
        this.logger.log('[bootstrap] database ready');
      } catch (error) {
        this.logger.error('[bootstrap] failed', error);
        throw error; // fail fast; app should not boot with broken DB
      }
    }
  }
}
