/**
 * Boots a throwaway PostgreSQL for integration tests.
 *
 * When DATABASE_URL is already set (CI, which provides a postgres service
 * container) this does nothing and the existing database is used.
 */
const path = require('path');
const { rmSync } = require('fs');
const EmbeddedPostgresModule = require('embedded-postgres');

const EmbeddedPostgres = EmbeddedPostgresModule.default || EmbeddedPostgresModule;

const PORT = 55432;
const DB_NAME = 'exhibition_reminder_test';

module.exports = async () => {
  if (process.env.DATABASE_URL) {
    console.log('[db] using DATABASE_URL from the environment');
    return;
  }

  // A previous run that was killed before teardown (piping jest output into
  // head can SIGPIPE it) leaves a data directory behind, and initialise() then
  // fails or hangs. Clearing it first makes the suite self-healing.
  const databaseDir = path.join(__dirname, '..', '.pgdata');
  rmSync(databaseDir, { recursive: true, force: true });

  const pg = new EmbeddedPostgres({
    databaseDir,
    user: 'postgres',
    password: 'postgres',
    port: PORT,
    persistent: false,
    // UTF8 is not optional: initdb defaults to the Windows ANSI codepage here,
    // which mangles every Persian string. The C locale is deliberate too —
    // it matches the assumption behind persian_normalize_search, which avoids
    // POSIX character classes precisely because they are ASCII-only under C.
    initdbFlags: ['--encoding=UTF8', '--no-locale'],
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB_NAME);

  globalThis.__EMBEDDED_PG__ = pg;
  process.env.DATABASE_URL = `postgresql://postgres:postgres@localhost:${PORT}/${DB_NAME}`;
  process.env.DB_SSL = 'false';

  console.log('[db] embedded postgres ready on port ' + PORT);
};
