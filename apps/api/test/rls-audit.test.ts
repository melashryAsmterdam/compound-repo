import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyAuditChain } from '../src/infra/audit';
import { activeResident, adminSession, createRequest, setup, type TestEnv } from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(() => env.close());

describe('row-level security (backstop for tenant isolation)', () => {
  it('a tenant transaction sees only its compound, and cannot write into another', async () => {
    const a = await adminSession(env, 'rls-a@test.sa');
    const b = await adminSession(env, 'rls-b@test.sa');
    const { unitId, resident } = await activeResident(env, a);
    await createRequest(resident, unitId);
    const seenByB = await env.ctx.db.tenant({ compoundId: b.compoundId }, (tx) => tx.query(`SELECT id FROM request`));
    expect(seenByB).toHaveLength(0);
    const seenByA = await env.ctx.db.tenant({ compoundId: a.compoundId }, (tx) => tx.query(`SELECT id FROM request`));
    expect(seenByA).toHaveLength(1);
    await expect(
      env.ctx.db.tenant({ compoundId: b.compoundId }, (tx) =>
        tx.query(`INSERT INTO unit (id, compound_id, number, type) VALUES (gen_random_uuid(), $1, 'X', 'villa')`, [a.compoundId]),
      ),
    ).rejects.toThrow(/row-level security/);
    const none = await env.ctx.db.tenant({ compoundId: '00000000-0000-0000-0000-000000000000' }, (tx) => tx.query(`SELECT id FROM unit`));
    expect(none).toHaveLength(0);
  });

  it('every tenant table has RLS forced', async () => {
    const rows = await env.ctx.db.owner((tx) =>
      tx.query<any>(`SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN information_schema.columns col ON col.table_name = c.relname AND col.column_name = 'compound_id' WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace`),
    );
    expect(rows.length).toBeGreaterThanOrEqual(14);
    for (const r of rows) expect({ table: r.relname, rls: r.relrowsecurity && r.relforcerowsecurity }).toEqual({ table: r.relname, rls: true });
  });
});

describe('audit log (K-6, §8)', () => {
  it('is append-only for the app roles and hash-chained', async () => {
    const a = await adminSession(env, 'audit@test.sa');
    await a.post('/admin/v1/units', { number: 'AU-1', type: 'villa' }).expect(201);
    await a.post('/admin/v1/units', { number: 'AU-2', type: 'villa' }).expect(201);
    expect(await env.ctx.db.tenant({ compoundId: a.compoundId }, (tx) => verifyAuditChain(tx, a.compoundId))).toBe(true);
    await expect(env.ctx.db.tenant({ compoundId: a.compoundId }, (tx) => tx.query(`UPDATE audit_log SET action = 'x'`))).rejects.toThrow(/permission denied/);
    await expect(env.ctx.db.system((tx) => tx.query(`DELETE FROM audit_log`))).rejects.toThrow(/permission denied/);
    await env.ctx.db.owner((tx) => tx.query(`UPDATE audit_log SET action = 'tampered' WHERE compound_id = $1 AND action = 'unit.create'`, [a.compoundId]));
    expect(await env.ctx.db.tenant({ compoundId: a.compoundId }, (tx) => verifyAuditChain(tx, a.compoundId))).toBe(false);
  });

  it('masks PII in owner changes', async () => {
    const a = await adminSession(env, 'audit-pii@test.sa');
    const u = await a.post('/admin/v1/units', { number: 'AU-9', type: 'villa' }).expect(201);
    await a.put(`/admin/v1/units/${u.body.id}/owner`, { fullName: 'Hessa Al-Qahtani', phone: '0551112233', email: 'hessa@example.sa' }).expect(200);
    const log = (await a.get('/admin/v1/audit-log').expect(200)).body.items;
    const text = JSON.stringify(log);
    expect(text).not.toContain('Hessa Al-Qahtani');
    expect(text).not.toContain('0551112233');
    expect(text).not.toContain('+966551112233');
    expect(text).not.toContain('hessa@example.sa');
    expect(log[0]).toMatchObject({ action: 'owner.assign', actor: { type: 'admin' } });
  });
});
