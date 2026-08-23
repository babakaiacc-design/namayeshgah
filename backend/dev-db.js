/**
 * Local development database.
 *
 * Boots an embedded PostgreSQL and keeps it running until the process is
 * stopped, so the API and the web app can be exercised without Docker.
 */
const path = require('path');
const M = require('embedded-postgres');

const EmbeddedPostgres = M.default || M;
const PORT = 55450;
const DB = 'exhibition_reminder_dev';

(async () => {
  const pg = new EmbeddedPostgres({
    databaseDir: path.join(__dirname, '.pgdev'),
    user: 'postgres',
    password: 'postgres',
    port: PORT,
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--no-locale'],
  });

  await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase(DB);
  } catch {
    // Already there from a previous run.
  }

  console.log(`READY postgresql://postgres:postgres@localhost:${PORT}/${DB}`);

  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  // Hold the process open.
  setInterval(() => {}, 1 << 30);
})().catch((error) => {
  console.error('dev-db failed:', error.message);
  process.exit(1);
});
