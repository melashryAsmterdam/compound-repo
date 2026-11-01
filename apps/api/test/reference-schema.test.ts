import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Smoke test until Testcontainers Postgres 16 runs in CI: the reference DDL must apply cleanly.
describe('schema.sql', () => {
  it('applies to an empty Postgres and creates the core tables', async () => {
    const db = new PGlite({ extensions: { citext, pg_trgm } });
    const sql = (f: string) => readFileSync(join(__dirname, '../../../infra/db', f), 'utf8');
    await db.exec(sql('roles.sql'));
    const ddl = sql('schema.sql');
    await db.exec(ddl);
    const { rows } = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const tables = rows.map((r) => r.table_name);
    for (const t of ['compound', 'unit', 'unit_assignment', 'invitation', 'request', 'request_event', 'audit_log']) {
      expect(tables).toContain(t);
    }
    await db.close();
  });
});
