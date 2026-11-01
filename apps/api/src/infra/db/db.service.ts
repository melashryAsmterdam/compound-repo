import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';
import { CONFIG, type Config } from '../../config.js';

export type Queryable = Pick<pg.PoolClient, 'query'>;
export const DB_POOL = Symbol('DB_POOL');

export function createPool(config: Config): pg.Pool {
  return new pg.Pool({ connectionString: config.DATABASE_URL, max: config.DB_POOL_MAX });
}

/**
 * Every database access goes through here (the `TenantTx` of repo standard §4).
 * `tenant()` opens a transaction scoped by RLS to one compound; `global()` is for the few
 * tables without compound_id (person, sessions, OTP, rate limits).
 */
@Injectable()
export class Db implements OnModuleDestroy {
  constructor(
    @Inject(DB_POOL) private readonly pool: pg.Pool,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  tenant<T>(compoundId: string, fn: (q: Queryable) => Promise<T>): Promise<T> {
    return this.tx(fn, compoundId);
  }

  global<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    return this.tx(fn, null);
  }

  private async tx<T>(fn: (q: Queryable) => Promise<T>, compoundId: string | null): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (this.config.DB_SET_ROLE) await client.query(`SET LOCAL ROLE ${this.config.DB_SET_ROLE}`);
      if (compoundId) await setCompound(client, compoundId);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

/** Switch the RLS scope inside an open transaction (used once the compound becomes known). */
export async function setCompound(q: Queryable, compoundId: string): Promise<void> {
  await q.query(`SELECT set_config('app.compound_id', $1, true)`, [compoundId]);
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const e = error as { code?: string; constraint?: string };
  return e.code === '23505' && (!constraint || e.constraint === constraint);
}
