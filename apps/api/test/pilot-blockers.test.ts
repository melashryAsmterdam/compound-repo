import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config';
import { ConsoleChannels } from '../src/infra/channels';
import { logger } from '../src/infra/logger';
import { sha256 } from '../src/infra/crypto';
import { Db } from '../src/infra/db';
import { activeResident, adminSession, createRequest, inviteTokenFrom, nextPhone, setup, type AdminSession, type TestEnv } from './helpers';

let env: TestEnv;
let admin: AdminSession;
beforeAll(async () => {
  env = await setup();
  admin = await adminSession(env);
});
afterAll(() => env.close());

const prod = {
  NODE_ENV: 'production',
  DB_DRIVER: 'pg',
  DATABASE_URL: 'postgres://x@db/compound',
  JWT_PRIVATE_KEY: 'pem',
  OTP_PEPPER: 'prod-pepper-0123456789',
  STORAGE_SECRET: 'prod-secret-0123456789',
  TOKEN_SECRET: 'prod-token-secret-0123456789abcdef0123',
};

describe('QA-02 / B2: no message text in logs, no dev adapters in production', () => {
  it('console channels log metadata only by default', async () => {
    const spy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const ch = new ConsoleChannels();
    await ch.sms.send({ to: '+966512345678', text: 'رمز التحقق: 123456 http://x/a/' + 'T'.repeat(43) });
    await ch.email.send({ to: 'noura@gmail.com', subject: 'Invite', text: 'Open http://x/a/' + 'T'.repeat(43) });
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(logged).not.toContain('123456');
    expect(logged).not.toContain('T'.repeat(43));
    expect(logged).not.toContain('noura@gmail.com');
    expect(logged).not.toContain('+966512345678');
    expect(ch.outbox).toHaveLength(2); // tests still read codes from the in-memory outbox
  });

  it('logs text only with the development opt-in', async () => {
    const spy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    await new ConsoleChannels({ logText: true }).sms.send({ to: '+966512345678', text: 'code 654321' });
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(logged).toContain('654321');
    expect(() => loadConfig({ NODE_ENV: 'test', LOG_MESSAGE_TEXT: '1' })).toThrow(/development only/);
    expect(loadConfig({ NODE_ENV: 'development', LOG_MESSAGE_TEXT: '1' }).LOG_MESSAGE_TEXT).toBe('1');
  });

  it('production refuses console providers and local storage', () => {
    expect(() => loadConfig(prod)).toThrow(/SMS_PROVIDER=console/);
    expect(() => loadConfig({ ...prod, LOG_MESSAGE_TEXT: '1' })).toThrow();
    expect(() => loadConfig({ ...prod, TOKEN_SECRET: 'dev-only-token-secret-change-me-0123456789' })).toThrow(/secrets not set/);
  });
});

describe('QA-03 / B6: resident token only in the Authorization header', () => {
  it('refuses ?access_token= on the live-updates stream', async () => {
    const { resident } = await activeResident(env, admin);
    const res = await env.http.get(`/app/v1/events/stream?access_token=${encodeURIComponent(resident.access)}`);
    expect(res.status).toBe(401);
  });
});

describe('QA-06: a visit cannot be scheduled in the past', () => {
  it('returns 422 visit_in_past for a window that has started', async () => {
    const { unitId, resident } = await activeResident(env, admin);
    const r = await createRequest(resident, unitId);
    const past = await admin.post(`/admin/v1/requests/${r.id}/comments`, { visit: { date: '2020-01-01', startTime: '09:00', endTime: '11:00' } }).expect(422);
    expect(past.body.code).toBe('visit_in_past');
    const today = env.ctx.now().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
    const earlier = await admin.post(`/admin/v1/requests/${r.id}/comments`, { visit: { date: today, startTime: '00:00', endTime: '00:30' } }).expect(422);
    expect(earlier.body.code).toBe('visit_in_past');
  });
});

describe('QA-07: invitation preview carries the compound phone (contract v1.1)', () => {
  it('includes compoundPhone', async () => {
    const phone = nextPhone();
    const unit = await admin.post('/admin/v1/units', { number: 'P-77', block: 'A', type: 'villa' }).expect(201);
    await admin.put(`/admin/v1/units/${unit.body.id}/owner`, { fullName: 'Sara', phone }).expect(200);
    await admin.post(`/admin/v1/units/${unit.body.id}/invitations`, { channels: ['sms'] }).expect(201);
    await env.drain();
    const res = await env.http.get(`/app/v1/invitations/${inviteTokenFrom(env, phone)}`).expect(200);
    expect(res.body).toHaveProperty('compoundPhone');
    const compound = await admin.get('/admin/v1/compound').expect(200);
    expect(res.body.compoundPhone).toBe(compound.body.contactPhone ?? null);
  });
});

describe('B3: no raw link tokens or addresses at rest in the job table', () => {
  it('invitation and password-reset jobs carry ids only; the links still work', async () => {
    const phone = nextPhone();
    const unit = await admin.post('/admin/v1/units', { number: 'B3-1', block: 'A', type: 'villa' }).expect(201);
    await admin.put(`/admin/v1/units/${unit.body.id}/owner`, { fullName: 'Sara', phone }).expect(200);
    await admin.post(`/admin/v1/units/${unit.body.id}/invitations`, { channels: ['sms'] }).expect(201);
    const email = `reset-${Date.now()}@test.sa`;
    await adminSession(env, email);
    await env.http.post('/admin/v1/auth/password/forgot').send({ email }).expect(202);

    const jobs = await env.ctx.db.system((tx) => tx.query<any>(`SELECT name, payload FROM job WHERE name IN ('send-invitation','send-email')`));
    expect(jobs.length).toBeGreaterThanOrEqual(2);
    const payloads = JSON.stringify(jobs.map((j) => j.payload));
    expect(payloads).not.toMatch(/[A-Za-z0-9_-]{43}/);
    expect(payloads).not.toContain(email);
    expect(payloads).not.toContain(phone);

    await env.drain();
    const token = inviteTokenFrom(env, phone);
    await env.http.get(`/app/v1/invitations/${token}`).expect(200);
    const resetMail = env.ctx.channels.last('email', email)!;
    const resetToken = resetMail.text.match(/token=([A-Za-z0-9_-]{43})/)![1]!;
    const row = await env.ctx.db.system((tx) => tx.one<any>(`SELECT 1 AS ok FROM password_reset WHERE token_hash = $1`, [sha256(resetToken)]));
    expect(row?.ok).toBe(1);
  });
});

describe('B4: jobs left running by a dead worker are retried', () => {
  it('reclaims a running job whose lock is older than the visibility timeout', async () => {
    const phone = nextPhone();
    const unit = await admin.post('/admin/v1/units', { number: 'B4-1', block: 'A', type: 'villa' }).expect(201);
    await admin.put(`/admin/v1/units/${unit.body.id}/owner`, { fullName: 'Huda', phone }).expect(200);
    await admin.post(`/admin/v1/units/${unit.body.id}/invitations`, { channels: ['sms'] }).expect(201);
    // Simulate a worker that claimed the job and died 10 minutes ago.
    const stale = new Date(env.ctx.now().getTime() - 10 * 60_000);
    await env.ctx.db.system((tx) => tx.query(`UPDATE job SET status = 'running', attempts = 1, locked_at = $1 WHERE name = 'send-invitation' AND status = 'pending'`, [stale]));
    await env.drain();
    expect(() => inviteTokenFrom(env, phone)).not.toThrow();
    const left = await env.ctx.db.system((tx) => tx.query<any>(`SELECT status FROM job WHERE name = 'send-invitation' AND status = 'running'`));
    expect(left).toHaveLength(0);
  });
});

describe('B5: migrations are a separate job; the API only checks them', () => {
  it('reports pending migrations, refuses an unmigrated schema, and migrates idempotently', async () => {
    const db = await Db.pglite();
    try {
      expect(await db.pendingMigrations()).toEqual(Db.migrationFiles());
      await expect(db.assertMigrated()).rejects.toThrow(/pending migrations/);
      await Promise.all([db.migrate(), db.migrate()]);
      expect(await db.pendingMigrations()).toEqual([]);
      await expect(db.assertMigrated()).resolves.toBeUndefined();
      const rows = await db.owner((tx) => tx.query<any>('SELECT name FROM schema_migration'));
      expect(rows).toHaveLength(Db.migrationFiles().length);
    } finally {
      await db.close();
    }
  });
});

describe('Architect decision (Q-28): deactivating a unit revokes its owner', () => {
  it('resident loses access, requests stay with the admin, audit records the revoked assignment', async () => {
    const { unitId, resident } = await activeResident(env, admin);
    const r = await createRequest(resident, unitId);
    await admin.patch(`/admin/v1/units/${unitId}`, { status: 'inactive' }).expect(200);
    const me = await resident.get('/app/v1/me').expect(200);
    expect(me.body.units.map((u: any) => u.id ?? u.unitId)).not.toContain(unitId);
    await resident.get(`/app/v1/requests/${r.id}`).expect((res) => expect([403, 404]).toContain(res.status));
    await admin.get(`/admin/v1/requests/${r.id}`).expect(200);
    const detail = await admin.get(`/admin/v1/units/${unitId}`).expect(200);
    expect(detail.body.owner).toBeNull();
    const row = await env.ctx.db.system((tx) => tx.one<any>(`SELECT changes FROM audit_log WHERE action = 'unit.deactivate' AND entity_id = $1`, [unitId]));
    expect(JSON.stringify(row?.changes)).toContain('unit_deactivated');
  });
});

describe('Architect decision 6: activation runs one tenant transaction per compound', () => {
  it('activates units in two compounds and audits each in its own compound', async () => {
    const other = await adminSession(env, `second-${Date.now()}@test.sa`);
    const phone = nextPhone();
    const invite = async (s: AdminSession, number: string) => {
      const u = await s.post('/admin/v1/units', { number, block: 'A', type: 'villa' }).expect(201);
      await s.put(`/admin/v1/units/${u.body.id}/owner`, { fullName: 'Reem', phone }).expect(200);
      await s.post(`/admin/v1/units/${u.body.id}/invitations`, { channels: ['sms'] }).expect(201);
      await env.drain();
      return u.body.id as string;
    };
    const u1 = await invite(admin, 'D6-1');
    const token = inviteTokenFrom(env, phone);
    const u2 = await invite(other, 'D6-2');
    const start = await env.http.post('/app/v1/activation/start').send({ invitationToken: token }).expect(200);
    const code = env.ctx.channels.last('sms', phone)!.text.match(/\b(\d{6})\b/)![1];
    const done = await env.http
      .post('/app/v1/activation/complete')
      .send({ challengeId: start.body.challengeId, code, consent: { privacyNoticeVersion: '2026-11-01', termsVersion: '2026-11-01', locale: 'ar' }, device: { installationId: crypto.randomUUID(), platform: 'android' } })
      .expect(200);
    expect(done.body.accessToken).toBeTruthy();
    for (const [s, unitId] of [[admin, u1], [other, u2]] as const) {
      expect((await s.get(`/admin/v1/units/${unitId}`).expect(200)).body.activation).toBe('active');
    }
    const audits = await env.ctx.db.system((tx) => tx.query<any>(`SELECT compound_id FROM audit_log WHERE action = 'assignment.activate' AND actor_id = $1`, [done.body.me.personId]));
    expect(new Set(audits.map((a) => a.compound_id))).toEqual(new Set([admin.compoundId, other.compoundId]));
  });
});
