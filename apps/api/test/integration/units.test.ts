import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, PORTAL, type TestApp } from '../helpers/test-app.js';

describe('units (A1) and owner assignment (A2)', () => {
  let t: TestApp;
  let session: { cookie: string; csrf: string };
  let other: { cookie: string; csrf: string };

  beforeAll(async () => {
    t = await createTestApp();
    await t.createCompound('owner@example.sa');
    await t.createCompound('other@example.sa');
    session = await t.signIn('owner@example.sa');
    other = await t.signIn('other@example.sa');
  });
  afterAll(() => t.close());

  const as = (s: { cookie: string; csrf: string }) => ({
    get: (url: string) => t.http().get(url).set('Cookie', s.cookie),
    send: (method: 'post' | 'patch' | 'put' | 'delete', url: string, body?: object) =>
      t.http()[method](url).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf).set('Origin', PORTAL).send(body),
  });
  const me = () => as(session);

  it('creates a unit and rejects a duplicate number case-insensitively (AC1, AC2)', async () => {
    const res = await me().send('post', '/admin/v1/units', { number: 'B-14', block: 'B', type: 'villa' }).expect(201);
    expect(res.body).toMatchObject({ number: 'B-14', block: 'B', status: 'active', activation: 'not_invited', owner: null, openRequestCount: 0, invitesRemainingToday: 5 });
    const dup = await me().send('post', '/admin/v1/units', { number: 'b-14', type: 'villa' }).expect(409);
    expect(dup.body.code).toBe('unit_number_taken');
  });

  it('validates input with field errors', async () => {
    const res = await me().send('post', '/admin/v1/units', { number: '', type: 'castle' }).expect(422);
    expect(res.body.code).toBe('validation_failed');
    expect(res.body.errors.map((e: { field: string }) => e.field).sort()).toEqual(['number', 'type']);
  });

  it('lists, searches, filters and paginates (AC4, AC5)', async () => {
    for (const n of ['A-1', 'A-2', 'C-1']) {
      await me().send('post', '/admin/v1/units', { number: n, block: n[0], type: 'apartment' }).expect(201);
    }
    const all = await me().get('/admin/v1/units').expect(200);
    expect(all.body).toMatchObject({ page: 1, pageSize: 50, total: 4 });
    expect(all.body.items.map((u: { number: string }) => u.number)).toEqual(['A-1', 'A-2', 'B-14', 'C-1']);

    expect((await me().get('/admin/v1/units?block=A').expect(200)).body.total).toBe(2);
    expect((await me().get('/admin/v1/units?q=c-').expect(200)).body.items[0].number).toBe('C-1');
    expect((await me().get('/admin/v1/units?page=2').expect(200)).body).toMatchObject({ items: [], total: 4 });

    const blocks = await me().get('/admin/v1/units/blocks').expect(200);
    expect(blocks.body).toEqual([
      { block: 'A', unitCount: 2, activeResidentCount: 0 },
      { block: 'B', unitCount: 1, activeResidentCount: 0 },
      { block: 'C', unitCount: 1, activeResidentCount: 0 },
    ]);
  });

  it('another compound cannot see or touch these units', async () => {
    const list = await as(other).get('/admin/v1/units').expect(200);
    expect(list.body.total).toBe(0);
    const id = (await me().get('/admin/v1/units?q=B-14').expect(200)).body.items[0].id;
    await as(other).get(`/admin/v1/units/${id}`).expect(404);
    await as(other).send('patch', `/admin/v1/units/${id}`, { notes: 'x' }).expect(404);
  });

  it('assigns an owner, normalising the phone; one person can own several units (AC1, AC7)', async () => {
    const units = (await me().get('/admin/v1/units?block=A').expect(200)).body.items;
    const res = await me()
      .send('put', `/admin/v1/units/${units[0].id}/owner`, { fullName: 'Noura Al-Qahtani', phone: '٠٥١٢٣٤٥٦٧٨', locale: 'ar' })
      .expect(200);
    expect(res.body.owner).toMatchObject({ fullName: 'Noura Al-Qahtani', phone: '+966512345678', activatedAt: null });
    expect(res.body.activation).toBe('not_invited'); // assigned, invite not sent yet

    const second = await me()
      .send('put', `/admin/v1/units/${units[1].id}/owner`, { fullName: 'Noura Al-Qahtani', phone: '0512345678', email: 'noura@example.sa' })
      .expect(200);
    expect(second.body.owner.personId).toBe(res.body.owner.personId);
    expect(second.body.owner.email).toBe('noura@example.sa');

    expect((await me().get('/admin/v1/units?q=0512345').expect(200)).body.total).toBe(2);
    expect((await me().get('/admin/v1/units?q=noura').expect(200)).body.total).toBe(2);
  });

  it('rejects an invalid phone and a phone/email belonging to two different people', async () => {
    const unit = (await me().get('/admin/v1/units?q=C-1').expect(200)).body.items[0];
    expect((await me().send('put', `/admin/v1/units/${unit.id}/owner`, { fullName: 'X Y', phone: '0112345678' }).expect(422)).body.code).toBe('phone_invalid');
    await me().send('put', `/admin/v1/units/${unit.id}/owner`, { fullName: 'Sara', email: 'sara@example.sa' }).expect(200);
    const clash = await me()
      .send('put', `/admin/v1/units/${unit.id}/owner`, { fullName: 'Mixed', phone: '0512345678', email: 'sara@example.sa' })
      .expect(422);
    expect(clash.body.code).toBe('owner_identity_conflict');
  });

  it('changing the owner revokes the previous assignment and is audited (AC6)', async () => {
    const unit = (await me().get('/admin/v1/units?q=C-1').expect(200)).body.items[0];
    const res = await me().send('put', `/admin/v1/units/${unit.id}/owner`, { fullName: 'Khalid', phone: '0598765432' }).expect(200);
    expect(res.body.owner.fullName).toBe('Khalid');
    const { rows } = await t.sql.query(`SELECT status FROM unit_assignment WHERE unit_id = $1 ORDER BY created_at, status`, [unit.id]);
    expect(rows.map((r) => r.status).sort()).toEqual(['invited', 'revoked']);
    const audit = await t.sql.query(`SELECT action, changes FROM audit_log WHERE entity_id = $1 ORDER BY id`, [unit.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['unit.create', 'owner.assign', 'owner.assign']);
    expect(JSON.stringify(audit.rows)).not.toMatch(/Khalid|0598765432|sara@/); // no PII in the audit log

    await me().send('delete', `/admin/v1/units/${unit.id}/owner`).expect(204);
    expect((await me().get(`/admin/v1/units/${unit.id}`).expect(200)).body.owner).toBeNull();
  });

  it('patches fields and status; delete only for a never-used unit (AC3)', async () => {
    const units = (await me().get('/admin/v1/units').expect(200)).body.items as { id: string; number: string }[];
    const used = units.find((u) => u.number === 'A-1')!;
    const fresh = units.find((u) => u.number === 'B-14')!;

    const patched = await me().send('patch', `/admin/v1/units/${used.id}`, { notes: 'Corner villa', status: 'inactive' }).expect(200);
    expect(patched.body).toMatchObject({ notes: 'Corner villa', status: 'inactive' });
    expect((await me().send('patch', `/admin/v1/units/${used.id}`, { number: 'B-14' }).expect(409)).body.code).toBe('unit_number_taken');
    expect((await me().send('put', `/admin/v1/units/${used.id}/owner`, { fullName: 'Late', phone: '0500000001' }).expect(409)).body.code).toBe('unit_inactive');

    expect((await me().send('delete', `/admin/v1/units/${used.id}`).expect(409)).body.code).toBe('unit_in_use');
    await me().send('delete', `/admin/v1/units/${fresh.id}`).expect(204);
    await me().get(`/admin/v1/units/${fresh.id}`).expect(404);
  });

  it('audit log hash chain links each row to the previous one', async () => {
    const { rows } = await t.sql.query(
      `SELECT prev_hash, row_hash FROM audit_log WHERE compound_id = (SELECT compound_id FROM admin_user WHERE email = 'owner@example.sa') AND actor_type = 'admin' ORDER BY id`,
    );
    for (let i = 1; i < rows.length; i++) expect(rows[i].prev_hash).toEqual(rows[i - 1].row_hash);
  });
});
