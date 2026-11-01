import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activeResident, adminSession, createRequest, setup, type AdminSession, type TestEnv } from './helpers';

let env: TestEnv;
let admin: AdminSession;
beforeAll(async () => {
  env = await setup();
  admin = await adminSession(env);
});
afterAll(() => env.close());

const smsTo = (phone: string) => env.ctx.channels.outbox.filter((m) => m.channel === 'sms' && m.to === phone);

describe('request lifecycle (PRD §5)', () => {
  it('runs the full loop: create → in progress → visit → done → reopen → done → confirm', async () => {
    const { unitId, resident, phone } = await activeResident(env, admin, { number: 'B-14', block: 'B' });
    await resident.put('/app/v1/devices/current', { pushToken: 'tok-noura', pushEnabled: true }).expect(204);

    // R2: create, idempotent replay
    const key = randomUUID();
    const body = { categoryCode: 'plumbing', description: 'Water leak under the kitchen sink', locationInUnit: 'Kitchen', preferredSlot: 'morning' };
    const created = await resident.post(`/app/v1/units/${unitId}/requests`, body).set('Idempotency-Key', key).expect(201);
    expect(created.body).toMatchObject({ ref: expect.stringMatching(/^REQ-\d{5}$/), status: 'new', version: 1, allowedActions: ['cancel'], locationInUnit: 'Kitchen' });
    const replay = await resident.post(`/app/v1/units/${unitId}/requests`, body).set('Idempotency-Key', key).expect(200);
    expect(replay.body.id).toBe(created.body.id);
    const id = created.body.id;

    // A3: dashboard, counters, search by ref and text
    const list = await admin.get('/admin/v1/requests').expect(200);
    expect(list.body.items[0]).toMatchObject({ id, residentName: 'Noura Al-Harbi', outcome: null, unit: { number: 'B-14' } });
    expect((await admin.get('/admin/v1/requests/counters').expect(200)).body).toMatchObject({ new: 1, inProgress: 0 });
    expect((await admin.get(`/admin/v1/requests?q=${created.body.ref}`).expect(200)).body.items).toHaveLength(1);
    expect((await admin.get('/admin/v1/requests?q=kitchen').expect(200)).body.items).toHaveLength(1);
    expect((await admin.get('/admin/v1/requests?q=B-14').expect(200)).body.items).toHaveLength(1);
    expect((await admin.get('/admin/v1/requests?status=done,closed').expect(200)).body.items).toHaveLength(0);
    expect((await admin.get('/admin/v1/requests?category=plumbing&block=B').expect(200)).body.items).toHaveLength(1);

    // A3-AC5: transitions with optimistic concurrency
    let d = (await admin.get(`/admin/v1/requests/${id}`).expect(200)).body;
    expect(d).toMatchObject({ allowedTransitions: ['in_progress', 'done'], canComment: true, resident: { phone, isCurrentOwner: true } });
    const stale = await admin.post(`/admin/v1/requests/${id}/transitions`, { to: 'in_progress', expectedVersion: 99 }).expect(409);
    expect(stale.body.code).toBe('version_conflict');
    d = (await admin.post(`/admin/v1/requests/${id}/transitions`, { to: 'in_progress', expectedVersion: 1 }).expect(200)).body;
    expect(d).toMatchObject({ status: 'in_progress', version: 2, allowedTransitions: ['done'] });

    // A4: comment + visit (Riyadh wall clock → UTC), visible to resident as "Management"
    await env.drain();
    const pushes = env.ctx.channels.outbox.filter((m) => m.channel === 'push' && m.to === 'tok-noura');
    expect(pushes.at(-1)).toMatchObject({ subject: 'Al Narjis Compound', text: expect.stringContaining('In Progress') });
    expect(pushes.at(-1)!.text).not.toContain('leak'); // PDPL: no description in push
    const c = await admin.post(`/admin/v1/requests/${id}/comments`, { body: 'Plumber will come', visit: { date: '2026-11-10', startTime: '09:00', endTime: '11:00' } }).expect(201);
    expect(c.body).toMatchObject({ type: 'visit_scheduled', visit: { startAt: '2026-11-10T06:00:00.000Z', endAt: '2026-11-10T08:00:00.000Z' }, editableUntil: expect.any(String) });
    const bad = await admin.post(`/admin/v1/requests/${id}/comments`, { visit: { date: '2026-11-10', startTime: '11:00', endTime: '09:00' } }).expect(422);
    expect(bad.body.code).toBe('visit_invalid');
    const r2 = await admin.post(`/admin/v1/requests/${id}/comments`, { visit: { date: '2026-11-11', startTime: '13:00', endTime: '14:00' } }).expect(201);
    expect(r2.body.type).toBe('visit_rescheduled');
    const edited = await admin.patch(`/admin/v1/requests/${id}/comments/${c.body.id}`, { body: 'Plumber Ahmed will come' }).expect(200);
    expect(edited.body.editedAt).not.toBeNull();

    const rv = (await resident.get(`/app/v1/requests/${id}`).expect(200)).body;
    expect(rv.visit).toEqual({ startAt: '2026-11-11T10:00:00.000Z', endAt: '2026-11-11T11:00:00.000Z' });
    expect(rv.timeline.map((e: any) => e.type)).toEqual(['created', 'status_changed', 'visit_scheduled', 'visit_rescheduled']);
    expect(rv.timeline[2].actor).toEqual({ type: 'admin', displayName: 'Management' });
    expect(rv.timeline[2].editableUntil).toBeNull();

    // Done → push + SMS fallback when the push is not acknowledged within 10 minutes
    d = (await admin.post(`/admin/v1/requests/${id}/transitions`, { to: 'done', expectedVersion: rv.version }).expect(200)).body;
    expect(d).toMatchObject({ status: 'done', outcome: 'awaiting_confirmation', autoCloseAt: expect.any(String) });
    await env.drain();
    // The app acknowledges the two visit pushes (cancels their fallback); the Done push stays unacknowledged.
    const pushed = env.ctx.channels.outbox.filter((m) => m.channel === 'push' && m.to === 'tok-noura' && /Visit/.test(m.text));
    expect(pushed).toHaveLength(2);
    for (const p of pushed) await resident.post(`/app/v1/notifications/${p.data!.notificationId}/received`).expect(204);
    const smsBefore = smsTo(phone).length;
    // Fallback SMS respect quiet hours; pin the clock to 10:00 Riyadh for a deterministic check.
    const offset = new Date('2026-11-02T07:00:00Z').getTime() + 11 * 60_000 - Date.now();
    env.ctx.clock.advance(offset);
    try {
      await env.drain();
    } finally {
      env.ctx.clock.advance(-offset);
    }
    const fallback = smsTo(phone).slice(smsBefore);
    expect(fallback).toHaveLength(1);
    expect(fallback[0]!.text).toMatch(/is done\. Please confirm/);

    // R4: reopen with reason → In Progress, flagged
    const notifs = (await resident.get('/app/v1/notifications').expect(200)).body;
    expect(notifs.unreadCount).toBeGreaterThan(0);
    expect(notifs.items[0]).toMatchObject({ type: 'request_status_changed', deepLink: `compoundapp://requests/${id}` });
    const ro = await resident.post(`/app/v1/requests/${id}/reopen`, { reason: 'Still dripping', expectedVersion: d.version }).expect(200);
    expect(ro.body).toMatchObject({ status: 'in_progress', reopenCount: 1, allowedActions: [] });
    expect((await admin.get('/admin/v1/requests/counters').expect(200)).body).toMatchObject({ reopened: 1, inProgress: 1 });
    expect((await admin.get('/admin/v1/requests?reopened=true').expect(200)).body.items[0]).toMatchObject({ outcome: 'reopened' });

    d = (await admin.post(`/admin/v1/requests/${id}/transitions`, { to: 'done', expectedVersion: ro.body.version }).expect(200)).body;
    const ok = await resident.post(`/app/v1/requests/${id}/confirm`, { expectedVersion: d.version }).expect(200);
    expect(ok.body).toMatchObject({ status: 'closed', closeReason: 'confirmed', allowedActions: [] });
    const closed = (await admin.get(`/admin/v1/requests/${id}`).expect(200)).body;
    expect(closed).toMatchObject({ outcome: 'confirmed', canComment: false, allowedTransitions: [] });
    expect((await admin.post(`/admin/v1/requests/${id}/comments`, { body: 'late note' }).expect(409)).body.code).toBe('request_closed');
    expect((await resident.post(`/app/v1/requests/${id}/reopen`, { reason: 'x', expectedVersion: ok.body.version }).expect(409)).body.code).toBe('invalid_transition');
  });

  it('resident cancels while New only (R2-AC6); admin cannot move backwards (Q-10)', async () => {
    const { unitId, resident } = await activeResident(env, admin);
    const r = await createRequest(resident, unitId);
    const done = (await admin.post(`/admin/v1/requests/${r.id}/transitions`, { to: 'done', expectedVersion: 1 }).expect(200)).body;
    expect((await admin.post(`/admin/v1/requests/${r.id}/transitions`, { to: 'in_progress', expectedVersion: done.version }).expect(409)).body.code).toBe('invalid_transition');
    expect((await resident.post(`/app/v1/requests/${r.id}/cancel`, { expectedVersion: done.version }).expect(409)).body.code).toBe('invalid_transition');
    const r2 = await createRequest(resident, unitId);
    const c = await resident.post(`/app/v1/requests/${r2.id}/cancel`, { expectedVersion: 1 }).expect(200);
    expect(c.body.status).toBe('cancelled');
    const mine = (await resident.get(`/app/v1/units/${unitId}/requests?state=open`).expect(200)).body.items;
    expect(mine.map((x: any) => x.id)).toEqual([r.id]);
  });

  it('auto-closes Done requests after 7 days with no response (R4-AC4)', async () => {
    const { unitId, resident } = await activeResident(env, admin);
    const r = await createRequest(resident, unitId);
    await admin.post(`/admin/v1/requests/${r.id}/transitions`, { to: 'done', expectedVersion: 1 }).expect(200);
    env.ctx.clock.advance(7 * 86_400_000 + 60_000);
    try {
      expect(await env.handlers.autoClose()).toBeGreaterThanOrEqual(1);
    } finally {
      env.ctx.clock.advance(-(7 * 86_400_000 + 60_000));
    }
    const d = (await resident.get(`/app/v1/requests/${r.id}`).expect(200)).body;
    expect(d).toMatchObject({ status: 'closed', closeReason: 'no_response' });
    expect(d.timeline.at(-1)).toMatchObject({ type: 'auto_closed', actor: { type: 'system' } });
  });

  it('validates input and resident authorisation', async () => {
    const { unitId, resident } = await activeResident(env, admin);
    const other = await activeResident(env, admin);
    const short = await resident.post(`/app/v1/units/${unitId}/requests`, { categoryCode: 'plumbing', description: 'short' }).set('Idempotency-Key', randomUUID()).expect(422);
    expect(short.body.errors[0].field).toBe('description');
    await resident.post(`/app/v1/units/${unitId}/requests`, { categoryCode: 'plumbing', description: 'long enough text here' }).expect(422);
    await resident.post(`/app/v1/units/${other.unitId}/requests`, { categoryCode: 'plumbing', description: 'not my unit at all' }).set('Idempotency-Key', randomUUID()).expect(403);
    const theirs = await createRequest(other.resident, other.unitId);
    await resident.get(`/app/v1/requests/${theirs.id}`).expect(404);
    await env.http.get(`/app/v1/units/${unitId}/requests`).expect(401);
  });

  it('isolates compounds: another compound\'s admin cannot see or act (RLS)', async () => {
    const { unitId, resident } = await activeResident(env, admin);
    const r = await createRequest(resident, unitId);
    const otherAdmin = await adminSession(env, 'other-compound@test.sa');
    expect(otherAdmin.compoundId).not.toBe(admin.compoundId);
    await otherAdmin.get(`/admin/v1/requests/${r.id}`).expect(404);
    await otherAdmin.get(`/admin/v1/units/${unitId}`).expect(404);
    expect((await otherAdmin.get('/admin/v1/requests').expect(200)).body.items).toHaveLength(0);
    await otherAdmin.post(`/admin/v1/requests/${r.id}/transitions`, { to: 'done', expectedVersion: 1 }).expect(404);
  });
});

describe('resident session (R0)', () => {
  it('signs in by OTP, rotates refresh tokens and detects reuse', async () => {
    const { phone } = await activeResident(env, admin);
    const start = await env.http.post('/app/v1/auth/otp/start').send({ phone: phone.replace('+966', '0') }).expect(200);
    expect(start.body).toMatchObject({ channel: 'sms', resendsRemaining: 3, maskedDestination: expect.stringContaining('*') });
    const code = env.ctx.channels.last('sms', phone)!.text.match(/(\d{6})/)![1];
    const v = await env.http.post('/app/v1/auth/otp/verify').send({ challengeId: start.body.challengeId, code, device: { installationId: randomUUID(), platform: 'android' } }).expect(200);
    const r1 = await env.http.post('/app/v1/auth/refresh').send({ refreshToken: v.body.refreshToken }).expect(200);
    await env.http.post('/app/v1/auth/refresh').send({ refreshToken: v.body.refreshToken }).expect(401); // reuse
    expect((await env.http.post('/app/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken }).expect(401)).body.code).toBe('session_revoked');
  });

  it('never reveals whether a number is registered', async () => {
    const before = env.ctx.channels.outbox.length;
    const r = await env.http.post('/app/v1/auth/otp/start').send({ phone: '0599999999' }).expect(200);
    expect(r.body.challengeId).toBeDefined();
    expect(env.ctx.channels.outbox.length).toBe(before);
    expect((await env.http.post('/app/v1/auth/otp/verify').send({ challengeId: r.body.challengeId, code: '123456', device: { installationId: randomUUID(), platform: 'ios' } }).expect(400)).body.code).toBe('otp_invalid');
  });

  it('requires the current consent versions (R1-AC4)', async () => {
    const r = await env.http.post('/app/v1/activation/complete').send({
      challengeId: randomUUID(), code: '123456', consent: { privacyNoticeVersion: '2020-01-01', termsVersion: '2026-11-01', locale: 'en' }, device: { installationId: randomUUID(), platform: 'ios' },
    }).expect(409);
    expect(r.body.code).toBe('consent_version_outdated');
    const legal = await env.http.get('/app/v1/legal/privacy_notice?locale=ar').expect(200);
    expect(legal.body).toMatchObject({ version: '2026-11-01', locale: 'ar', html: expect.stringContaining('الخصوصية') });
  });
});
