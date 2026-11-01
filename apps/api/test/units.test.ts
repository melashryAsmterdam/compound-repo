import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activeResident, adminSession, inviteTokenFrom, nextPhone, setup, type AdminSession, type TestEnv } from './helpers';

let env: TestEnv;
let admin: AdminSession;
beforeAll(async () => {
  env = await setup();
  admin = await adminSession(env);
});
afterAll(() => env.close());

describe('A1 units', () => {
  it('creates, rejects duplicates case-insensitively, edits', async () => {
    const u = await admin.post('/admin/v1/units', { number: 'B-14', block: 'B', type: 'villa', floor: null, notes: 'corner' }).expect(201);
    expect(u.body).toMatchObject({ number: 'B-14', block: 'B', activation: 'not_invited', openRequestCount: 0, owner: null, invitesRemainingToday: 5 });
    const dup = await admin.post('/admin/v1/units', { number: 'b-14', type: 'villa' }).expect(409);
    expect(dup.body.code).toBe('unit_number_taken');
    expect(dup.body.title).toMatch(/already exists/);
    const ar = await admin.post('/admin/v1/units', { number: 'B-14', type: 'villa' }).set('Accept-Language', 'ar').expect(409);
    expect(ar.body.title).toContain('وحدة');
    const p = await admin.patch(`/admin/v1/units/${u.body.id}`, { type: 'townhouse', notes: '' }).expect(200);
    expect(p.body).toMatchObject({ type: 'townhouse', notes: null });
  });

  it('accepts Arabic-Indic digits in unit numbers', async () => {
    const u = await admin.post('/admin/v1/units', { number: 'Z-١٢', type: 'apartment' }).expect(201);
    expect(u.body.number).toBe('Z-12');
  });

  it('deletes only unused units; otherwise deactivate (A1-AC3)', async () => {
    const free = await admin.post('/admin/v1/units', { number: 'DEL-1', type: 'other' }).expect(201);
    await admin.del(`/admin/v1/units/${free.body.id}`).expect(204);
    const used = await admin.post('/admin/v1/units', { number: 'DEL-2', type: 'other' }).expect(201);
    await admin.put(`/admin/v1/units/${used.body.id}/owner`, { fullName: 'Owner Two', email: 'o2@test.sa' }).expect(200);
    const r = await admin.del(`/admin/v1/units/${used.body.id}`).expect(409);
    expect(r.body.code).toBe('unit_in_use');
    const off = await admin.patch(`/admin/v1/units/${used.body.id}`, { status: 'inactive' }).expect(200);
    expect(off.body.status).toBe('inactive');
    const inv = await admin.post(`/admin/v1/units/${used.body.id}/invitations`, { channels: ['email'] }).expect(409);
    expect(inv.body.code).toBe('unit_inactive');
  });

  it('lists with search, filters, pagination, and blocks summary (A1-AC4/5)', async () => {
    for (let i = 1; i <= 55; i++) await admin.post('/admin/v1/units', { number: `L-${i}`, block: 'L', type: 'apartment' }).expect(201);
    const p1 = await admin.get('/admin/v1/units?block=L').expect(200);
    expect(p1.body).toMatchObject({ page: 1, pageSize: 50, total: 55 });
    expect(p1.body.items).toHaveLength(50);
    expect(p1.body.items[0].number).toBe('L-1');
    const p2 = await admin.get('/admin/v1/units?block=L&page=2').expect(200);
    expect(p2.body.items).toHaveLength(5);
    const q = await admin.get('/admin/v1/units?q=L-5').expect(200);
    expect(q.body.items.map((u: any) => u.number)).toEqual(expect.arrayContaining(['L-5', 'L-50']));
    const blocks = await admin.get('/admin/v1/units/blocks').expect(200);
    expect(blocks.body).toEqual(expect.arrayContaining([{ block: 'L', unitCount: 55, activeResidentCount: 0 }]));
    await admin.get('/admin/v1/units?pageSize=20').expect(422);
  });
});

describe('A2 owner & invitations', () => {
  it('validates the owner contact (K-4)', async () => {
    const u = await admin.post('/admin/v1/units', { number: 'O-1', type: 'villa' }).expect(201);
    const bad = await admin.put(`/admin/v1/units/${u.body.id}/owner`, { fullName: 'Fahad', phone: '0112345678' }).expect(422);
    expect(bad.body.errors).toEqual([{ field: 'phone', code: 'phone_invalid' }]);
    const none = await admin.put(`/admin/v1/units/${u.body.id}/owner`, { fullName: 'Fahad' }).expect(422);
    expect(none.body.errors[0].code).toBe('contact_required');
    const ok = await admin.put(`/admin/v1/units/${u.body.id}/owner`, { fullName: 'Fahad', phone: '٠٥٥١٢٣٤٥٦٧' }).expect(200);
    expect(ok.body.owner).toMatchObject({ fullName: 'Fahad', phone: '+966551234567' });
    expect(ok.body.activation).toBe('not_invited');
  });

  it('sends the link, enforces channels, supersedes on resend, limits to 5/24h (A2-AC2..AC5)', async () => {
    const phone = nextPhone();
    const u = await admin.post('/admin/v1/units', { number: 'O-2', type: 'villa' }).expect(201);
    const noOwner = await admin.post(`/admin/v1/units/${u.body.id}/invitations`, { channels: ['sms'] }).expect(409);
    expect(noOwner.body.code).toBe('no_owner_assigned');
    await admin.put(`/admin/v1/units/${u.body.id}/owner`, { fullName: 'Sara', phone }).expect(200);
    const noEmail = await admin.post(`/admin/v1/units/${u.body.id}/invitations`, { channels: ['email'] }).expect(409);
    expect(noEmail.body.code).toBe('channel_unavailable');

    const first = await admin.post(`/admin/v1/units/${u.body.id}/invitations`, { channels: ['sms'] }).expect(201);
    expect(first.body).toMatchObject({ channels: ['sms'], state: 'pending', deliveries: [{ channel: 'sms', status: 'queued', destinationMasked: expect.stringMatching(/^\+9665\*+\d{3}$/) }] });
    await env.drain();
    const tokenA = inviteTokenFrom(env, phone);
    const sms = env.ctx.channels.last('sms', phone)!;
    expect(sms.text).toContain('O-2');
    const d = await admin.get(`/admin/v1/units/${u.body.id}`).expect(200);
    expect(d.body).toMatchObject({ activation: 'invited', invitesRemainingToday: 4, latestInvitation: { deliveries: [{ status: 'sent' }] } });

    await admin.post(`/admin/v1/units/${u.body.id}/invitations`, { channels: ['sms'] }).expect(201);
    await env.drain();
    const old = await env.http.get(`/app/v1/invitations/${tokenA}`).expect(410);
    expect(old.body).toMatchObject({ code: 'invitation_revoked', compoundContactPhone: '+966112345678' });
    const tokenB = inviteTokenFrom(env, phone);
    const preview = await env.http.get(`/app/v1/invitations/${tokenB}`).expect(200);
    expect(preview.body).toMatchObject({ fullName: 'Sara', unitNumber: 'O-2', compoundNameEn: 'Al Narjis Compound', otpChannel: 'sms' });

    for (let i = 0; i < 3; i++) await admin.post(`/admin/v1/units/${u.body.id}/invitations`, { channels: ['sms'] }).expect(201);
    const limited = await admin.post(`/admin/v1/units/${u.body.id}/invitations`, { channels: ['sms'] }).expect(429);
    expect(limited.body.code).toBe('invite_limit_reached');
    const history = await admin.get(`/admin/v1/units/${u.body.id}/invitations`).expect(200);
    expect(history.body.map((i: any) => i.state)).toEqual(['pending', 'superseded', 'superseded', 'superseded', 'superseded']);
  });

  it('shows Failed with the reason when every channel bounced (A2-AC4)', async () => {
    const u = await admin.post('/admin/v1/units', { number: 'O-3', type: 'villa' }).expect(201);
    await admin.put(`/admin/v1/units/${u.body.id}/owner`, { fullName: 'Bounce', email: 'bounce@test.sa' }).expect(200);
    await admin.post(`/admin/v1/units/${u.body.id}/invitations`, { channels: ['email'] }).expect(201);
    await env.drain();
    const msg = env.ctx.channels.last('email', 'bounce@test.sa')!;
    await env.http.post('/webhooks/email/console').send({ messageId: msg.providerMessageId, status: 'failed', reason: 'mailbox does not exist' }).expect(204);
    const d = await admin.get(`/admin/v1/units/${u.body.id}`).expect(200);
    expect(d.body.activation).toBe('failed');
    expect(d.body.latestInvitation.deliveries[0]).toMatchObject({ status: 'failed', failureReason: 'mailbox does not exist' });
    const f = await admin.get('/admin/v1/units?activation=failed').expect(200);
    expect(f.body.items.map((x: any) => x.number)).toContain('O-3');
  });

  it('expired links show Expired and return 410 invitation_expired (Q-6)', async () => {
    const phone = nextPhone();
    const u = await admin.post('/admin/v1/units', { number: 'O-4', type: 'villa' }).expect(201);
    await admin.put(`/admin/v1/units/${u.body.id}/owner`, { fullName: 'Late', phone }).expect(200);
    await admin.post(`/admin/v1/units/${u.body.id}/invitations`, { channels: ['sms'] }).expect(201);
    await env.drain();
    const token = inviteTokenFrom(env, phone);
    // Age the link by 8 days (moving the clock would also expire the admin session).
    await env.ctx.db.owner((tx) => tx.query(`UPDATE invitation SET expires_at = now() - interval '1 day', created_at = now() - interval '8 days' WHERE assignment_id IN (SELECT id FROM unit_assignment WHERE unit_id = $1)`, [u.body.id]));
    expect((await env.http.get(`/app/v1/invitations/${token}`).expect(410)).body.code).toBe('invitation_expired');
    expect((await admin.get(`/admin/v1/units/${u.body.id}`).expect(200)).body.activation).toBe('expired');
  });

  it('one person can own several units and activates them all at once (A2-AC7, Q-2)', async () => {
    const phone = nextPhone();
    const a = await admin.post('/admin/v1/units', { number: 'M-1', type: 'villa' }).expect(201);
    const b = await admin.post('/admin/v1/units', { number: 'M-2', type: 'villa' }).expect(201);
    for (const u of [a, b]) {
      await admin.put(`/admin/v1/units/${u.body.id}/owner`, { fullName: 'Multi Owner', phone }).expect(200);
      await admin.post(`/admin/v1/units/${u.body.id}/invitations`, { channels: ['sms'] }).expect(201);
    }
    await env.drain();
    const { resident } = await (async () => {
      const token = inviteTokenFrom(env, phone);
      const start = await env.http.post('/app/v1/activation/start').send({ invitationToken: token }).expect(200);
      const code = env.ctx.channels.last('sms', phone)!.text.match(/(\d{6})/)![1];
      const done = await env.http.post('/app/v1/activation/complete').send({
        challengeId: start.body.challengeId, code,
        consent: { privacyNoticeVersion: '2026-11-01', termsVersion: '2026-11-01', locale: 'ar' },
        device: { installationId: crypto.randomUUID(), platform: 'android' },
      }).expect(200);
      return { resident: done.body };
    })();
    expect(resident.me.units.map((u: any) => u.number).sort()).toEqual(['M-1', 'M-2']);
    expect(resident.me.locale).toBe('ar');
    for (const u of [a, b]) expect((await admin.get(`/admin/v1/units/${u.body.id}`).expect(200)).body.activation).toBe('active');
  });

  it('changing the owner revokes the old owner\'s access; history stays on the unit (A2-AC6, Q-7)', async () => {
    const { unitId, resident } = await activeResident(env, admin, { number: 'CH-1' });
    const req = await resident
      .post(`/app/v1/units/${unitId}/requests`, { categoryCode: 'electrical', description: 'Lights flicker in the hallway' })
      .set('Idempotency-Key', crypto.randomUUID())
      .expect(201);
    const already = await admin.post(`/admin/v1/units/${unitId}/invitations`, { channels: ['sms'] }).expect(409);
    expect(already.body.code).toBe('already_active');

    await admin.put(`/admin/v1/units/${unitId}/owner`, { fullName: 'New Owner', phone: nextPhone() }).expect(200);
    const denied = await resident.get(`/app/v1/units/${unitId}/requests`).expect(403);
    expect(denied.body.code).toBe('unit_access_revoked');
    await resident.get(`/app/v1/requests/${req.body.id}`).expect(403);
    const refresh = await env.http.post('/app/v1/auth/refresh').send({ refreshToken: resident.refresh }).expect(401);
    expect(refresh.body.code).toBe('session_revoked');

    const hist = await admin.get(`/admin/v1/units/${unitId}/requests`).expect(200);
    expect(hist.body.items).toHaveLength(1);
    const detail = await admin.get(`/admin/v1/requests/${req.body.id}`).expect(200);
    expect(detail.body.resident.isCurrentOwner).toBe(false);
    const audit = await admin.get(`/admin/v1/audit-log?entityType=unit_assignment`).expect(200);
    expect(audit.body.items.map((x: any) => x.action)).toEqual(expect.arrayContaining(['owner.change', 'owner.revoke', 'owner.assign', 'assignment.activate']));
  });
});
