import { config as loadEnv } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';

import { configurePostgresDateParsing } from '../common/dates/pg-date';

loadEnv();

// Must run before any pool is created, so DATE columns come back as plain
// 'YYYY-MM-DD' strings rather than local-midnight Date objects.
configurePostgresDateParsing();

const bool = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined ? fallback : value.toLowerCase() === 'true';

/**
 * Shared by the Nest runtime and the TypeORM CLI so migrations always run
 * against exactly the connection the app uses.
 */
export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: bool(process.env.DB_SSL, false) ? { rejectUnauthorized: false } : false,
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  migrationsTableName: 'migrations',
  synchronize: false,
  logging: process.env.NODE_ENV === 'development' ? ['error', 'warn', 'migration'] : ['error'],
  extra: {
    max: Number.parseInt(process.env.DB_POOL_SIZE ?? '10', 10),
    // See docs/ARCHITECTURE.md section 3 — must be false behind Supabase's pooler.
    prepare: bool(process.env.DB_PREPARE, true),
  },
};

export default new DataSource(dataSourceOptions);
