import { Client } from 'pg';
import { DataSource } from 'typeorm';

import { configurePostgresDateParsing } from '../src/common/dates/pg-date';

configurePostgresDateParsing();

/**
 * Gives an integration spec its own database.
 *
 * Sharing one database across spec files makes them order-dependent: the seed
 * asserts "no exhibitions exist", which a spec that ran earlier would break.
 * A database per spec keeps each file independent and lets them assert on
 * absolute counts.
 */
export async function createTestDataSource(name: string): Promise<DataSource> {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error('DATABASE_URL is not set — test/global-setup.js should have provided one');
  }

  const url = new URL(baseUrl);
  const dbName = `test_${name}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');

  const admin = new Client({
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: 'postgres',
  });

  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName}`);
  } finally {
    await admin.end();
  }

  url.pathname = `/${dbName}`;

  const dataSource = new DataSource({
    type: 'postgres',
    url: url.toString(),
    ssl: false,
    migrations: [__dirname + '/../src/database/migrations/*.ts'],
    migrationsTableName: 'migrations',
    synchronize: false,
    logging: ['error'],
  });

  await dataSource.initialize();
  await dataSource.runMigrations();

  return dataSource;
}
