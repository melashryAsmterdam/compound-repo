import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activeResident, adminSession, setup, type AdminSession, type TestEnv, otpFrom } from './helpers';

let env: TestEnv;
let admin: AdminSession;
beforeAll(async () => {
  env = await setup();
  admin = await adminSession(env);
});
afterAll(() => env.close());

describe('contract v1.1 operations', () => {
  it('PATCH /admin/v1/me changes the portal language', async () => {
    const res = await admin.patch('/admin/v1/me', { locale: 'en' }).expect(200);
    expect(res.body.locale).toBe('en');
    await admin.patch('/admin/v1/me', { locale: 'fr' }).expect(422);
    expect((await admin.get('/admin/v1/me').expect(200)).body.locale).toBe('en');
  });

  it('POST /admin/v1/me/password checks the current password and revokes other sessions only', async () => {
    const email = `pw-${Date.now()}@test.sa`;
    const a = await adminSession(env, email);
    // a second session for the same admin
    const login = await env.http.post('/admin/v1/auth/login').send({ email, password: 'Correct-Horse-Battery-1' }).expect(200);
    const verify = await env.http.post('/admin/v1/auth/mfa/verify').send({ challengeId: login.body.challengeId, code: otpFrom(env, email) }).expect(200);
    const other = String(verify.headers['set-cookie']![0]).split(';')[0]!;

    const bad = await a.post('/admin/v1/me/password', { currentPassword: 'wrong-password-123', newPassword: 'New-Long-Password-42' }).expect(400);
    expect(bad.body.code).toBe('current_password_invalid');
    await a.post('/admin/v1/me/password', { currentPassword: 'Correct-Horse-Battery-1', newPassword: 'short' }).expect(422);
    await a.post('/admin/v1/me/password', { currentPassword: 'Correct-Horse-Battery-1', newPassword: 'New-Long-Password-42' }).expect(204);

    await a.get('/admin/v1/me').expect(200); // this session is kept
    await env.http.get('/admin/v1/me').set('Cookie', other).expect(401); // the other one is revoked
    await env.http.post('/admin/v1/auth/login').send({ email, password: 'New-Long-Password-42' }).expect(200);
  });

  it('GET /admin/v1/units/summary counts units', async () => {
    const before = (await admin.get('/admin/v1/units/summary').expect(200)).body;
    await activeResident(env, admin);
    await admin.post('/admin/v1/units', { number: `S-${Date.now() % 100000}`, block: 'B', type: 'apartment' }).expect(201);
    const after = (await admin.get('/admin/v1/units/summary').expect(200)).body;
    expect(after).toEqual({
      total: before.total + 2,
      active: before.active + 2,
      inactive: before.inactive,
      assigned: before.assigned + 1,
      unassigned: before.unassigned + 1,
      pendingInvitations: before.pendingInvitations,
    });
  });

  it('GET /app/v1/meta is public, and old app versions get 426 app_update_required', async () => {
    const meta = await env.http.get('/app/v1/meta').expect(200);
    expect(meta.body).toEqual({ minSupportedVersion: { ios: '1.0.0', android: '1.0.0' }, latestVersion: { ios: '1.0.0', android: '1.0.0' } });
    const old = await env.http.get('/app/v1/categories').set('X-App-Version', '0.9.9').expect(426);
    expect(old.body.code).toBe('app_update_required');
    await env.http.get('/app/v1/meta').set('X-App-Version', '0.9.9').expect(200);
    const ok = await env.http.get('/app/v1/categories').set('X-App-Version', '1.0.0');
    expect(ok.status).not.toBe(426);
  });
});
