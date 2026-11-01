/**
 * Local Postgres without Docker: PGlite (Postgres 16 in WASM) behind a socket on :5432,
 * persisted in apps/api/.pglite. `docker compose` Postgres works the same if you prefer it.
 */
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const port = Number(process.env.PGPORT ?? 5432);
const db = await PGlite.create({ dataDir: './.pglite', extensions: { citext, pg_trgm } });
// PGlite serves one connection at a time: run the API with DB_POOL_MAX=1 against it.
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
await server.start();
console.log(`Postgres (PGlite) on postgres://postgres@127.0.0.1:${port}/postgres — Ctrl+C to stop`);
process.on('SIGINT', async () => {
  await server.stop();
  await db.close();
  process.exit(0);
});
