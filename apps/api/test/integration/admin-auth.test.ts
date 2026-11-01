import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, PASSWORD, PORTAL, type TestApp } from '../helpers/test-app.js';

describe('admin sign-in (A0)', () => {
  let t: TestApp;
  let adminId: string;

  beforeAll(async () => {
    t = await createTestApp();
    ({ adminId } = await t.createCompound('owner@example.sa'));
  });
  beforeEach(async () => {
    await t.sql.query('UPDATE admin_user SET failed_logins = 0, locked_until = NULL');
    await t.sql.query('DELETE FROM rate_limit_bucket');
  });
  afterAll(() => t.close());

  const login = (email: string, password: string) => t.http().post('/admin/v1/auth/login').send({ email, password });

  it('password + emailed code signs in, sets a hardened cookie and returns the CSRF token (AC1, AC2)', async () => {
    const res = await login('Owner@Example.sa', PASSWORD).expect(200);
    expect(res.body).toMatchObject({ channel: 'email', maskedDestination: 'o***@example.sa', resendsRemaining: 3 });
    expect(t.messenger.sent.at(-1)).toMatchObject({ channel: 'email', destination: 'owner@example.sa' });

    const verified = await t.http()
      .post('/admin/v1/auth/mfa/verify')
      .send({ challengeId: res.body.challengeId, code: t.messenger.lastOtp() })
      .expect(200);
    const cookie = String(verified.headers['set-cookie']);
    expect(cookie).toMatch(/^__Host-cs_admin=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(verified.body.admin).toMatchObject({ id: adminId, email: 'owner@example.sa', compound: { nameEn: 'Al Narjis' } });
    expect(verified.body.csrfToken).toHaveLength(43);
  });

  it('wrong password and unknown email answer the same', async () => {
    const wrong = await login('owner@example.sa', 'nope').expect(401);
    const unknown = await login('nobody@example.sa', 'nope').expect(401);
    expect(wrong.body.code).toBe('invalid_credentials');
    expect(unknown.body.code).toBe('invalid_credentials');
  });

  it('locks for 15 minutes after 5 failures (AC3)', async () => {
    for (let i = 0; i < 4; i++) await login('owner@example.sa', 'nope').expect(401);
    expect((await login('owner@example.sa', 'nope').expect(423)).body.code).toBe('account_locked');
    await login('owner@example.sa', PASSWORD).expect(423);
    t.clock.advance(15 * 60_000 + 1);
    await login('owner@example.sa', PASSWORD).expect(200);
  });

  it('a wrong code counts, and the 5th wrong code kills the challenge', async () => {
    const { body } = await login('owner@example.sa', PASSWORD).expect(200);
    const good = t.messenger.lastOtp();
    const bad = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) {
      const r = await t.http().post('/admin/v1/auth/mfa/verify').send({ challengeId: body.challengeId, code: bad }).expect(400);
      expect(r.body.code).toBe('otp_invalid');
    }
    await t.http().post('/admin/v1/auth/mfa/verify').send({ challengeId: body.challengeId, code: bad }).expect(429);
    await t.http().post('/admin/v1/auth/mfa/verify').send({ challengeId: body.challengeId, code: good }).expect(429);
  });

  it('codes expire after 5 minutes; resend has a 60 s cooldown and a limit of 3', async () => {
    const { body } = await login('owner@example.sa', PASSWORD).expect(200);
    const resend = () => t.http().post('/admin/v1/auth/mfa/resend').send({ challengeId: body.challengeId });
    await resend().expect(429);
    for (let i = 0; i < 3; i++) {
      t.clock.advance(61_000);
      await resend().expect(200);
    }
    t.clock.advance(61_000);
    await resend().expect(429);

    const code = t.messenger.lastOtp();
    t.clock.advance(5 * 60_000);
    const r = await t.http().post('/admin/v1/auth/mfa/verify').send({ challengeId: body.challengeId, code }).expect(400);
    expect(r.body.code).toBe('otp_expired');
  });

  it('session: me works, mutations need CSRF and the portal origin, idle timeout is 30 minutes (AC5)', async () => {
    const { cookie, csrf } = await t.signIn('owner@example.sa');
    await t.http().get('/admin/v1/me').set('Cookie', cookie).expect(200);
    await t.http().post('/admin/v1/units').set('Cookie', cookie).send({}).expect(403);
    await t.http().post('/admin/v1/units').set('Cookie', cookie).set('X-CSRF-Token', csrf).set('Origin', 'https://evil.example').send({}).expect(403);

    t.clock.advance(29 * 60_000);
    await t.http().get('/admin/v1/me').set('Cookie', cookie).expect(200); // slides the window
    t.clock.advance(30 * 60_000 + 1);
    expect((await t.http().get('/admin/v1/me').set('Cookie', cookie).expect(401)).body.code).toBe('unauthenticated');
  });

  it('logout revokes the session', async () => {
    const { cookie, csrf } = await t.signIn('owner@example.sa');
    await t.http().post('/admin/v1/auth/logout').set('Cookie', cookie).set('X-CSRF-Token', csrf).set('Origin', PORTAL).expect(204);
    await t.http().get('/admin/v1/me').set('Cookie', cookie).expect(401);
  });

  it('password reset: always 202, single-use 30-minute link, revokes sessions (AC4)', async () => {
    const { cookie } = await t.signIn('owner@example.sa');
    await t.http().post('/admin/v1/auth/password/forgot').send({ email: 'nobody@example.sa' }).expect(202);
    const before = t.messenger.sent.length;
    await t.http().post('/admin/v1/auth/password/forgot').send({ email: 'owner@example.sa' }).expect(202);
    expect(t.messenger.sent.length).toBe(before + 1);
    const tpl = t.messenger.sent.at(-1)!.template;
    if (tpl.kind !== 'password_reset') throw new Error('expected reset email');
    const token = new URL(tpl.link).searchParams.get('token')!;

    const newPassword = 'a brand new passphrase';
    await t.http().post('/admin/v1/auth/password/reset').send({ token, newPassword }).expect(204);
    await t.http().post('/admin/v1/auth/password/reset').send({ token, newPassword }).expect(400);
    await t.http().get('/admin/v1/me').set('Cookie', cookie).expect(401);
    await login('owner@example.sa', newPassword).expect(200);

    const { rows } = await t.sql.query(`SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY id`, [adminId]);
    expect(rows.map((r) => r.action)).toContain('admin.password_reset');
  });
});
