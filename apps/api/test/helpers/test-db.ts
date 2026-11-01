import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { createServer } from 'node:net';
import { migrate } from '../../src/infra/db/migrate.js';

/**
 * A fresh, fully migrated Postgres (PGlite) per test file. PGlite serves one connection at a
 * time, so the app pool and the test helpers share a single connection. Testcontainers in CI.
 */
export async function startTestDb(): Promise<{ url: string; stop: () => Promise<void> }> {
  const db = await PGlite.create({ extensions: { citext, pg_trgm } });
  const port = await freePort();
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
  await server.start();
  const url = `postgres://postgres@127.0.0.1:${port}/postgres`;
  await migrate(url);
  return {
    url,
    stop: async () => {
      await server.stop();
      await db.close();
    },
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const address = s.address();
      s.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}
