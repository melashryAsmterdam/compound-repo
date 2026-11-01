import { logger } from './logger';
import { newId } from './crypto';
import type { Db, Tx } from './db';
import type { Clock } from './clock';

export type JobName =
  | 'send-invitation'
  | 'send-otp'
  | 'send-notification'
  | 'sms-fallback-check'
  | 'process-upload'
  | 'announcement-dispatch'
  | 'send-email';

export interface JobRow {
  id: string;
  name: JobName;
  payload: any;
  attempts: number;
  max_attempts: number;
}

/** Enqueue inside the caller's transaction (outbox: change + event/audit + job commit together). */
export async function enqueue(
  tx: Tx,
  name: JobName,
  payload: Record<string, unknown>,
  opts: { runAt?: Date; singletonKey?: string; maxAttempts?: number } = {},
): Promise<void> {
  await tx.query(
    `INSERT INTO job (id, name, payload, run_at, singleton_key, max_attempts)
     VALUES ($1, $2, $3, COALESCE($4, now()), $5, $6)
     ON CONFLICT (singleton_key) WHERE singleton_key IS NOT NULL AND status IN ('pending','running') DO NOTHING`,
    [newId(), name, JSON.stringify(payload), opts.runAt ?? null, opts.singletonKey ?? null, opts.maxAttempts ?? 5],
  );
  await tx.notify('jobs', { name });
}

const BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000];

export type Handler = (job: JobRow) => Promise<void>;

/** Job consumer (worker mode). FOR UPDATE SKIP LOCKED so several workers can run. */
export class Worker {
  private handlers = new Map<JobName, Handler>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  on(name: JobName, h: Handler) {
    this.handlers.set(name, h);
  }

  /** Run every due job until none are left (tests and the inline dev worker). Returns how many ran. */
  async drain(max = 1000): Promise<number> {
    let total = 0;
    for (;;) {
      const now = this.clock.now();
      const batch = await this.db.system((tx) =>
        tx.query<JobRow>(
          `UPDATE job SET status = 'running', attempts = attempts + 1, locked_at = $1, updated_at = $1
           WHERE id IN (SELECT id FROM job WHERE status = 'pending' AND run_at <= $1 ORDER BY run_at, created_at LIMIT 20 FOR UPDATE SKIP LOCKED)
           RETURNING id, name, payload, attempts, max_attempts`,
          [now],
        ),
      );
      if (batch.length === 0) return total;
      for (const job of batch) {
        await this.runOne(job);
        total++;
      }
      if (total >= max) return total;
    }
  }

  private async runOne(job: JobRow) {
    const h = this.handlers.get(job.name);
    try {
      if (!h) throw new Error(`no handler for ${job.name}`);
      await h(job);
      await this.db.system((tx) => tx.query(`UPDATE job SET status = 'done', updated_at = now() WHERE id = $1`, [job.id]));
    } catch (err) {
      const failed = job.attempts >= job.max_attempts;
      const delay = BACKOFF_MS[Math.min(job.attempts - 1, BACKOFF_MS.length - 1)]!;
      logger.warn({ job: job.name, id: job.id, attempts: job.attempts, err: (err as Error).message }, 'job failed');
      await this.db.system((tx) =>
        tx.query(
          `UPDATE job SET status = $2, run_at = $3, last_error = $4, updated_at = now() WHERE id = $1`,
          [job.id, failed ? 'failed' : 'pending', new Date(this.clock.now().getTime() + delay), String((err as Error).message).slice(0, 500)],
        ),
      );
    }
  }

  start(intervalMs = 1000) {
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        await this.drain();
      } catch (e) {
        logger.error({ err: e }, 'worker tick failed');
      } finally {
        this.running = false;
      }
    };
    this.timer = setInterval(tick, intervalMs);
    void this.db.listen('jobs', () => void tick());
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}
