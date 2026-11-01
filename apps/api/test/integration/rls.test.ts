import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../../src/infra/db/db.service.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

// ADR-012: a forgotten WHERE compound_id must not leak another compound's rows.
describe('row-level security as app_api', () => {
  let t: TestApp;
  let db: Db;
  let a: string;
  let b: string;

  beforeAll(async () => {
    t = await createTestApp();
    db = t.app.get(Db);
    a = (await t.createCompound('a@example.sa')).compoundId;
    b = (await t.createCompound('b@example.sa')).compoundId;
    await t.sql.query(`INSERT INTO unit (id, compound_id, number, type) VALUES ($1, $2, 'A-1', 'villa'), ($3, $4, 'B-1', 'villa')`, [
      randomUUID(),
      a,
      randomUUID(),
      b,
    ]);
  });
  afterAll(() => t.close());

  it('sees only its own compound without any WHERE clause', async () => {
    const rows = await db.tenant(a, async (q) => (await q.query('SELECT number FROM unit')).rows);
    expect(rows).toEqual([{ number: 'A-1' }]);
  });

  it('sees nothing when no compound is set', async () => {
    const rows = await db.global(async (q) => (await q.query('SELECT number FROM unit')).rows);
    expect(rows).toEqual([]);
  });

  it('cannot write a row into another compound', async () => {
    await expect(
      db.tenant(a, (q) => q.query(`INSERT INTO unit (id, compound_id, number, type) VALUES ($1, $2, 'X', 'villa')`, [randomUUID(), b])),
    ).rejects.toThrow(/row-level security/);
  });

  it('cannot update or delete the audit log', async () => {
    await expect(db.tenant(a, (q) => q.query('DELETE FROM audit_log'))).rejects.toThrow(/permission denied/);
  });
});
