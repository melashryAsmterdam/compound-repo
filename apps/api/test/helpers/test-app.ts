import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { loadConfig, type Config } from '../../src/config.js';
import { Clock } from '../../src/infra/clock.js';
import { DB_POOL } from '../../src/infra/db/db.service.js';
import { Messenger, type OutboundMessage } from '../../src/infra/messaging/messenger.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { configureApp } from '../../src/setup.js';
import { startTestDb } from './test-db.js';

export class FakeClock extends Clock {
  constructor(private current = new Date('2026-11-01T07:00:00Z')) {
    super();
  }
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class CapturingMessenger extends Messenger {
  readonly sent: OutboundMessage[] = [];
  async send(message: OutboundMessage): Promise<void> {
    this.sent.push(message);
  }
  lastOtp(): string {
    const t = [...this.sent].reverse().find((m) => m.template.kind === 'admin_otp')?.template;
    if (t?.kind !== 'admin_otp') throw new Error('no OTP sent');
    return t.code;
  }
}

export const PORTAL = 'http://portal.test';
export const PASSWORD = 'correct horse battery';

export interface TestApp {
  app: INestApplication;
  http: () => ReturnType<typeof request>;
  clock: FakeClock;
  messenger: CapturingMessenger;
  config: Config;
  /** Superuser queries for arranging and inspecting data (no role switch, so RLS is bypassed). */
  sql: Pick<pg.Pool, 'query'>;
  createCompound: (email: string) => Promise<{ compoundId: string; adminId: string }>;
  signIn: (email: string) => Promise<{ cookie: string; csrf: string }>;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const db = await startTestDb();
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: db.url,
    DB_SET_ROLE: 'app_api',
    DB_POOL_MAX: '1',
    OTP_PEPPER: 'test-pepper-test-pepper-test-pepper-1234',
    PORTAL_ORIGIN: PORTAL,
    COOKIE_SECURE: 'true',
  });
  const clock = new FakeClock();
  const messenger = new CapturingMessenger();
  const mod = await Test.createTestingModule({ imports: [AppModule.register({ config, clock, messenger })] }).compile();
  const app = mod.createNestApplication({ logger: false });
  configureApp(app, config);
  await app.init();

  const sql = app.get<pg.Pool>(DB_POOL);
  const hash = await hashPassword(PASSWORD);

  const http = () => request(app.getHttpServer());

  return {
    app,
    http,
    clock,
    messenger,
    config,
    sql,
    async createCompound(email) {
      const compoundId = randomUUID();
      const adminId = randomUUID();
      await sql.query(
        `INSERT INTO compound (id, name_ar, name_en, contact_phone) VALUES ($1, 'النرجس', 'Al Narjis', '+966112345678')`,
        [compoundId],
      );
      await sql.query(
        `INSERT INTO admin_user (id, compound_id, email, full_name, password_hash) VALUES ($1, $2, $3, 'Abu Fahad', $4)`,
        [adminId, compoundId, email, hash],
      );
      return { compoundId, adminId };
    },
    async signIn(email) {
      const login = await http().post('/admin/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
      const res = await http()
        .post('/admin/v1/auth/mfa/verify')
        .send({ challengeId: login.body.challengeId, code: messenger.lastOtp() })
        .expect(200);
      const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
      return { cookie: setCookie[0]!.split(';')[0]!, csrf: res.body.csrfToken as string };
    },
    async close() {
      await app.close();
      await db.stop();
    },
  };
}
