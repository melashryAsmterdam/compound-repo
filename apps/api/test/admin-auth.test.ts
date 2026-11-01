import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../src/seed';
import { PORTAL, adminSession, otpFrom, setup, type TestEnv } from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(() => env.close());

describe('A0 admin sign-in', () => {
  it('password + email OTP signs in, sets a __Host- cookie and returns CSRF', async () => {
    const s = await adminSession(env);
    expect(s.cookie).toMatch(/^__Host-cs_admin=/);
    const me = await s.get('/admin/v1/me').expect(200);
    expect(me.body).toMatchObject({ role: 'compound_admin', compound: { nameEn: 'Al Narjis Compound', timezone: 'Asia/Riyadh' } });
    expect(me.headers['x-csrf-token']).toBe(s.csrf);
  });

  it('rejects wrong password with a generic error and unknown emails the same way', async () => {
    await seed(env.ctx, { email: 'wrong@test.sa', password: 'Correct-Horse-Battery-1' });
    const a = await env.http.post('/admin/v1/auth/login').send({ email: 'wrong@test.sa', password: 'nope' }).expect(401);
    const b = await env.http.post('/admin/v1/auth/login').send({ email: 'nobody@test.sa', password: 'nope' }).expect(401);
    expect(a.body.code).toBe('invalid_credentials');
    expect(b.body.code).toBe('invalid_credentials');
    expect(a.headers['content-type']).toMatch(/application\/problem\+json/);
  });

  it('locks the account for 15 minutes after 5 failures (A0-AC3)', async () => {
    await seed(env.ctx, { email: 'lock@test.sa', password: 'Correct-Horse-Battery-1' });
    for (let i = 0; i < 4; i++) await env.http.post('/admin/v1/auth/login').send({ email: 'lock@test.sa', password: 'bad' }).expect(401);
    const fifth = await env.http.post('/admin/v1/auth/login').send({ email: 'lock@test.sa', password: 'bad' }).expect(423);
    expect(fifth.body.code).toBe('account_locked');
    await env.http.post('/admin/v1/auth/login').send({ email: 'lock@test.sa', password: 'Correct-Horse-Battery-1' }).expect(423);
  });

  it('a wrong 2FA code fails, and 5 wrong codes kill the challenge', async () => {
    await seed(env.ctx, { email: 'mfa@test.sa', password: 'Correct-Horse-Battery-1' });
    const login = await env.http.post('/admin/v1/auth/login').send({ email: 'mfa@test.sa', password: 'Correct-Horse-Battery-1' }).expect(200);
    const good = otpFrom(env, 'mfa@test.sa');
    const bad = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) {
      const r = await env.http.post('/admin/v1/auth/mfa/verify').send({ challengeId: login.body.challengeId, code: bad }).expect(400);
      expect(r.body.code).toBe('otp_invalid');
    }
    const r = await env.http.post('/admin/v1/auth/mfa/verify').send({ challengeId: login.body.challengeId, code: bad }).expect(400);
    expect(r.body.code).toBe('otp_attempts_exceeded');
    await env.http.post('/admin/v1/auth/mfa/verify').send({ challengeId: login.body.challengeId, code: good }).expect(400);
  });

  it('a resend does not reset the wrong-code counter (QA-13)', async () => {
    await seed(env.ctx, { email: 'mfa2@test.sa', password: 'Correct-Horse-Battery-1' });
    const login = await env.http.post('/admin/v1/auth/login').send({ email: 'mfa2@test.sa', password: 'Correct-Horse-Battery-1' }).expect(200);
    const id = login.body.challengeId;
    const wrong = (c: string) => (c === '000000' ? '111111' : '000000');
    for (let i = 0; i < 3; i++) await env.http.post('/admin/v1/auth/mfa/verify').send({ challengeId: id, code: wrong(otpFrom(env, 'mfa2@test.sa')) }).expect(400);
    env.ctx.clock.advance(61_000);
    await env.http.post('/admin/v1/auth/mfa/resend').send({ challengeId: id }).expect(200);
    const code = otpFrom(env, 'mfa2@test.sa');
    await env.http.post('/admin/v1/auth/mfa/verify').send({ challengeId: id, code: wrong(code) }).expect(400);
    const fifth = await env.http.post('/admin/v1/auth/mfa/verify').send({ challengeId: id, code: wrong(code) }).expect(400);
    expect(fifth.body.code).toBe('otp_attempts_exceeded');
    env.ctx.clock.advance(61_000);
    const again = await env.http.post('/admin/v1/auth/mfa/resend').send({ challengeId: id }).expect(400);
    expect(again.body.code).toBe('otp_attempts_exceeded');
    env.ctx.clock.advance(-122_000);
  });

  it('requires CSRF token and a trusted Origin on mutations', async () => {
    const s = await adminSession(env);
    const noCsrf = await env.http.post('/admin/v1/units').set('Cookie', s.cookie).send({ number: 'X1', type: 'villa' }).expect(403);
    expect(noCsrf.body.code).toBe('csrf_invalid');
    await env.http.post('/admin/v1/units').set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf).set('Origin', 'https://evil.example').send({ number: 'X1', type: 'villa' }).expect(403);
    await env.http.post('/admin/v1/units').set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf).set('Origin', PORTAL).send({ number: 'X1', type: 'villa' }).expect(201);
  });

  it('expires the session after 30 minutes idle (A0-AC5)', async () => {
    const s = await adminSession(env);
    env.ctx.clock.advance(31 * 60 * 1000);
    try {
      const r = await s.get('/admin/v1/me').expect(401);
      expect(r.body.code).toBe('unauthenticated');
    } finally {
      env.ctx.clock.advance(-31 * 60 * 1000);
    }
  });

  it('logout revokes the session', async () => {
    const s = await adminSession(env);
    await s.post('/admin/v1/auth/logout').expect(204);
    await s.get('/admin/v1/me').expect(401);
  });

  it('password reset: always 202, single-use 30-min link, revokes sessions (A0-AC4)', async () => {
    const s = await adminSession(env, 'reset@test.sa');
    await env.http.post('/admin/v1/auth/password/forgot').send({ email: 'nobody@test.sa' }).expect(202);
    await env.http.post('/admin/v1/auth/password/forgot').send({ email: 'reset@test.sa' }).expect(202);
    await env.drain();
    const mail = env.ctx.channels.last('email', 'reset@test.sa')!;
    const token = mail.text.match(/token=([A-Za-z0-9_-]{43})/)![1];
    const weak = await env.http.post('/admin/v1/auth/password/reset').send({ token, newPassword: 'short' }).expect(422);
    expect(weak.body.code).toBe('validation_failed');
    await env.http.post('/admin/v1/auth/password/reset').send({ token, newPassword: 'A-brand-new-passphrase-26' }).expect(204);
    await env.http.post('/admin/v1/auth/password/reset').send({ token, newPassword: 'A-brand-new-passphrase-27' }).expect(400);
    await s.get('/admin/v1/me').expect(401);
    await env.http.post('/admin/v1/auth/login').send({ email: 'reset@test.sa', password: 'A-brand-new-passphrase-26' }).expect(200);
  });
});
