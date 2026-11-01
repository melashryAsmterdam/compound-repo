import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { buildApp, type Built } from '../src/app';
import { loadConfig } from '../src/config';
import { seed } from '../src/seed';

export const PORTAL = 'http://localhost:3000';

export interface TestEnv extends Built {
  http: ReturnType<typeof request>;
  close(): Promise<void>;
  /** Run every due job (and optionally crons). */
  drain(): Promise<number>;
}

export async function setup(): Promise<TestEnv> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DB_DRIVER: 'pglite',
    STORAGE_DIR: mkdtempSync(join(tmpdir(), 'compound-objects-')),
    PORTAL_ORIGIN: PORTAL,
    PUBLIC_API_URL: 'http://127.0.0.1:4000',
    OTP_IP_HOURLY_LIMIT: '100000',
    LOGIN_IP_LIMIT: '100000',
  });
  const built = await buildApp(config);
  const server = built.app.getHttpServer();
  return {
    ...built,
    http: request(server),
    drain: () => built.ctx.worker.drain(),
    async close() {
      await built.app.close();
      await built.ctx.db.close();
    },
  };
}

export interface AdminSession {
  compoundId: string;
  cookie: string;
  csrf: string;
  get(path: string): request.Test;
  post(path: string, body?: unknown): request.Test;
  patch(path: string, body?: unknown): request.Test;
  put(path: string, body?: unknown): request.Test;
  del(path: string): request.Test;
}

let counter = 0;

/** Seed a compound + admin and sign in through password + email OTP. */
export async function adminSession(env: TestEnv, email = `admin${++counter}@test.sa`): Promise<AdminSession> {
  const s = await seed(env.ctx, { email, password: 'Correct-Horse-Battery-1' });
  const login = await env.http.post('/admin/v1/auth/login').send({ email, password: 'Correct-Horse-Battery-1' }).expect(200);
  const code = otpFrom(env, email);
  const verify = await env.http.post('/admin/v1/auth/mfa/verify').send({ challengeId: login.body.challengeId, code }).expect(200);
  const cookie = String(verify.headers['set-cookie']![0]).split(';')[0]!;
  const csrf = verify.body.csrfToken as string;
  const withAuth = (t: request.Test, mutate: boolean) => {
    t.set('Cookie', cookie).set('Accept-Language', 'en');
    if (mutate) t.set('X-CSRF-Token', csrf).set('Origin', PORTAL);
    return t;
  };
  return {
    compoundId: s.compoundId,
    cookie,
    csrf,
    get: (p) => withAuth(env.http.get(p), false),
    post: (p, b) => withAuth(env.http.post(p), true).send(b as object),
    patch: (p, b) => withAuth(env.http.patch(p), true).send(b as object),
    put: (p, b) => withAuth(env.http.put(p), true).send(b as object),
    del: (p) => withAuth(env.http.delete(p), true),
  };
}

export function otpFrom(env: TestEnv, to: string): string {
  const m = env.ctx.channels.last(to.includes('@') ? 'email' : 'sms', to);
  const code = m?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`no OTP sent to ${to}`);
  return code;
}

export function inviteTokenFrom(env: TestEnv, to: string): string {
  const m = env.ctx.channels.last(to.includes('@') ? 'email' : 'sms', to);
  const token = m?.text.match(/\/a\/([A-Za-z0-9_-]{43})/)?.[1];
  if (!token) throw new Error(`no invitation sent to ${to}`);
  return token;
}

export interface ResidentSession {
  personId: string;
  access: string;
  refresh: string;
  installationId: string;
  me: any;
  get(path: string): request.Test;
  post(path: string, body?: unknown): request.Test;
  patch(path: string, body?: unknown): request.Test;
  put(path: string, body?: unknown): request.Test;
}

export function residentClient(env: TestEnv, tokens: { accessToken: string; refreshToken: string; me: any }, installationId: string): ResidentSession {
  const auth = (t: request.Test) => t.set('Authorization', `Bearer ${tokens.accessToken}`).set('Accept-Language', 'en');
  return {
    personId: tokens.me.personId,
    access: tokens.accessToken,
    refresh: tokens.refreshToken,
    installationId,
    me: tokens.me,
    get: (p) => auth(env.http.get(p)),
    post: (p, b) => auth(env.http.post(p)).send((b ?? {}) as object),
    patch: (p, b) => auth(env.http.patch(p)).send((b ?? {}) as object),
    put: (p, b) => auth(env.http.put(p)).send((b ?? {}) as object),
  };
}

let phoneSeq = 10_000_000;
export const nextPhone = () => `+9665${String(++phoneSeq).padStart(8, '0')}`;

/** Create a unit, assign an owner, invite by SMS and complete activation in the app. */
export async function activeResident(env: TestEnv, admin: AdminSession, opts: { number?: string; block?: string; phone?: string } = {}) {
  const phone = opts.phone ?? nextPhone();
  const unit = await admin.post('/admin/v1/units', { number: opts.number ?? `V-${++counter}`, block: opts.block ?? 'A', type: 'villa' }).expect(201);
  await admin.put(`/admin/v1/units/${unit.body.id}/owner`, { fullName: 'Noura Al-Harbi', phone }).expect(200);
  await admin.post(`/admin/v1/units/${unit.body.id}/invitations`, { channels: ['sms'] }).expect(201);
  await env.drain();
  const token = inviteTokenFrom(env, phone);
  const start = await env.http.post('/app/v1/activation/start').send({ invitationToken: token }).expect(200);
  const installationId = randomUUID();
  const done = await env.http
    .post('/app/v1/activation/complete')
    .send({
      challengeId: start.body.challengeId,
      code: otpFrom(env, phone),
      consent: { privacyNoticeVersion: '2026-11-01', termsVersion: '2026-11-01', locale: 'en' },
      device: { installationId, platform: 'ios' },
    })
    .expect(200);
  return { unitId: unit.body.id as string, phone, resident: residentClient(env, done.body, installationId) };
}

export async function createRequest(r: ResidentSession, unitId: string, extra: Record<string, unknown> = {}) {
  const res = await r
    .post(`/app/v1/units/${unitId}/requests`, { categoryCode: 'plumbing', description: 'Kitchen sink is leaking under the cabinet', ...extra })
    .set('Idempotency-Key', randomUUID())
    .expect(201);
  return res.body;
}
