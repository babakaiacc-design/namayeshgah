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

      await this.warmPool();
    }
  }

  /**
   * Pre-establishes the connection pool at startup instead of leaving pg-pool
   * to open connections lazily on the first requests that need them.
   *
   * Some networks — this one included — resolve the pooler hostname to
   * several IPs where individual ones intermittently and unpredictably stop
   * responding to new connections (observed directly: the same IP fails once,
   * then succeeds on the very next attempt). A request that happens to need a
   * fresh connection during one of those windows waits out the full
   * connectionTimeoutMillis before failing. Warming the pool here, with
   * retries, means that stall happens at boot — where a few extra seconds is
   * fine — rather than on a real request.
   */
  private async warmPool(): Promise<void> {
    const poolSize = Number.parseInt(process.env.DB_POOL_SIZE ?? '5', 10);
    const results = await Promise.allSettled(
      Array.from({ length: poolSize }, () => this.warmOneConnection()),
    );
    const ready = results.filter((r) => r.status === 'fulfilled').length;
    this.logger.log(`[bootstrap] connection pool warmed: ${ready}/${poolSize} ready`);
  }

  private async warmOneConnection(attempts = 3): Promise<void> {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await this.dataSource.query('SELECT 1');
        return;
      } catch (error) {
        if (attempt === attempts) {
          this.logger.warn(`[bootstrap] a pool connection failed after ${attempts} attempts`, error);
          return; // non-fatal: the pool just runs one connection short
        }
      }
    }
  }
}
