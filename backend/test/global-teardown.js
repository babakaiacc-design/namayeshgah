module.exports = async () => {
  const pg = globalThis.__EMBEDDED_PG__;
  if (pg) {
    await pg.stop();
    console.log('[db] embedded postgres stopped');
  }
};
