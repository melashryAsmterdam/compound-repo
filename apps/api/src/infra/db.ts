import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { Pool, type PoolClient } from 'pg';
import { logger } from './logger';

/** One query surface inside a transaction. */
export interface Tx {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  /** NOTIFY delivered on commit (realtime + worker wake-up). */
  notify(channel: string, payload: unknown): Promise<void>;
}

export interface TenantCtx {
  compoundId: string;
  personId?: string;
}

type Q = ((sql: string, params?: unknown[]) => Promise<any[]>) & { exec: (sql: string) => Promise<void> };
type RawRunner = <T>(fn: (q: Q) => Promise<T>) => Promise<T>;

/**
 * All DB access goes through `tenant()` (RLS enforced: SET LOCAL ROLE app_api +
 * app.compound_id) or `system()` (app_system, BYPASSRLS) for the few
 * cross-tenant lookups listed in 000_roles.sql. Standards: "RLS-aware TenantTx".
 */
export class Db {
  private constructor(
    private readonly runTx: RawRunner,
    private readonly listenImpl: (channel: string, cb: (payload: string) => void) => Promise<() => Promise<void>>,
    private readonly closeImpl: () => Promise<void>,
    readonly driver: 'pg' | 'pglite',
  ) {}

  static async pglite(dir?: string): Promise<Db> {
    const { PGlite } = await import('@electric-sql/pglite');
    const { citext } = await import('@electric-sql/pglite/contrib/citext');
    const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
    if (dir) mkdirSync(dir, { recursive: true });
    const pg = (await PGlite.create(dir ?? 'memory://', { extensions: { citext, pg_trgm } })) as unknown as PGlite;
    const runTx: RawRunner = (fn) =>
      pg.transaction(async (tx) => {
        const q = (async (sql: string, params?: unknown[]) => (await tx.query(sql, params as any[])).rows as any[]) as Q;
        q.exec = async (sql) => {
          await tx.exec(sql);
        };
        return fn(q);
      });
    return new Db(
      runTx,
      async (channel, cb) => pg.listen(channel, cb),
      async () => pg.close(),
      'pglite',
    );
  }

  static async pg(url: string): Promise<Db> {
    const pool = new Pool({ connectionString: url, max: 10 });
    const runTx: RawRunner = async (fn) => {
      const client: PoolClient = await pool.connect();
      try {
        await client.query('BEGIN');
        const q = (async (sql: string, params?: unknown[]) => (await client.query(sql, params as any[])).rows) as Q;
        q.exec = async (sql) => {
          await client.query(sql);
        };
        const out = await fn(q);
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    };
    const listen = async (channel: string, cb: (p: string) => void) => {
      const client = await pool.connect();
      client.on('notification', (n) => n.channel === channel && cb(n.payload ?? ''));
      await client.query(`LISTEN ${channel}`);
      return async () => {
        await client.query(`UNLISTEN ${channel}`).catch(() => undefined);
        client.release();
      };
    };
    return new Db(runTx, listen, () => pool.end(), 'pg');
  }

  private wrap(raw: Q): Tx & { exec(sql: string): Promise<void> } {
    const q = (sql: string, params?: unknown[]) => raw(sql, params?.map(encodeParam));
    return {
      query: q as Tx['query'],
      exec: raw.exec,
      one: async (sql, params) => (await q(sql, params))[0],
      notify: async (channel, payload) => {
        await q('SELECT pg_notify($1, $2)', [channel, JSON.stringify(payload)]);
      },
    };
  }

  /** RLS-scoped transaction for one compound. */
  tenant<T>(ctx: TenantCtx, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.runTx(async (q) => {
      await q('SET LOCAL ROLE app_api');
      await q(`SELECT set_config('app.compound_id', $1, true), set_config('app.person_id', $2, true)`, [
        ctx.compoundId,
        ctx.personId ?? '',
      ]);
      return fn(this.wrap(q));
    });
  }

  /** Cross-tenant transaction (BYPASSRLS). Keep usage to lookups that cannot know the compound yet, jobs and crons. */
  system<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.runTx(async (q) => {
      await q('SET LOCAL ROLE app_system');
      return fn(this.wrap(q));
    });
  }

  /** Migrations and seeding run as the owner role. */
  owner<T>(fn: (tx: Tx & { exec(sql: string): Promise<void> }) => Promise<T>): Promise<T> {
    return this.runTx(async (q) => fn(this.wrap(q)));
  }

  listen(channel: string, cb: (payload: string) => void) {
    return this.listenImpl(channel, cb);
  }

  close() {
    return this.closeImpl();
  }

  async migrate(): Promise<void> {
    const dir = join(__dirname, 'migrations');
    await this.owner((tx) => tx.query('CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'));
    const done = new Set((await this.owner((tx) => tx.query<{ name: string }>('SELECT name FROM schema_migration'))).map((r) => r.name));
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      const sql = readFileSync(join(dir, file), 'utf8');
      await this.owner(async (tx) => {
        await tx.exec(sql);
        await tx.query('INSERT INTO schema_migration (name) VALUES ($1)', [file]);
      });
      logger.info({ migration: file }, 'applied migration');
    }
  }
}


/** JS arrays → Postgres array literal, so enum/uuid/text[] params behave the same on pg and PGlite. */
export function encodeParam(v: unknown): unknown {
  if (!Array.isArray(v)) return v;
  const items = v.map((x) => (x === null || x === undefined ? 'NULL' : `"${String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`));
  return `{${items.join(',')}}`;
}
