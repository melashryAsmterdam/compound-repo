import { DomainError } from '../errors';
import type { Tx } from './db';

/**
 * Fixed-window counter in rate_limit_bucket. Throws `code` (default rate_limited, 429)
 * when the window is full. Returns the remaining allowance after this hit.
 */
export async function hit(tx: Tx, key: string, limit: number, windowMs: number, code = 'rate_limited', now = new Date()): Promise<number> {
  const start = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const row = await tx.one<{ count: number }>(
    `INSERT INTO rate_limit_bucket (key, window_start, count) VALUES ($1, $2, 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit_bucket.count + 1
     RETURNING count`,
    [key, start],
  );
  if (row!.count > limit) throw new DomainError(code, 429);
  return limit - row!.count;
}

/** Rolling-window count for per-unit invite limits (A2-AC5: 5 per 24 h). */
export async function countSince(tx: Tx, sql: string, params: unknown[]): Promise<number> {
  const r = await tx.one<{ n: number }>(sql, params);
  return Number(r?.n ?? 0);
}
