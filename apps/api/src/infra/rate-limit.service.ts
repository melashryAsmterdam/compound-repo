import { Injectable, Inject } from '@nestjs/common';
import { Clock } from './clock.js';
import type { Queryable } from './db/db.service.js';

/** Fixed-window counters in Postgres (ADR-003). Returns false once the limit is exceeded. */
@Injectable()
export class RateLimitService {
  constructor(@Inject(Clock) private readonly clock: Clock) {}

  async hit(q: Queryable, key: string, windowMs: number, limit: number): Promise<boolean> {
    const now = this.clock.now().getTime();
    const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
    const { rows } = await q.query<{ count: number }>(
      `INSERT INTO rate_limit_bucket (key, window_start, count) VALUES ($1, $2, 1)
       ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit_bucket.count + 1
       RETURNING count`,
      [key, windowStart],
    );
    return (rows[0]?.count ?? 0) <= limit;
  }

  async count(q: Queryable, key: string, windowMs: number): Promise<number> {
    const now = this.clock.now().getTime();
    const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
    const { rows } = await q.query<{ count: number }>(
      'SELECT count FROM rate_limit_bucket WHERE key = $1 AND window_start = $2',
      [key, windowStart],
    );
    return rows[0]?.count ?? 0;
  }
}
