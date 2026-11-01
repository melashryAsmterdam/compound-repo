import { Injectable, Inject } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Clock } from './clock.js';
import type { Queryable } from './db/db.service.js';

export interface AuditEntry {
  compoundId: string;
  actorType: 'admin' | 'resident' | 'system' | 'operator';
  actorId: string | null;
  action: string; // e.g. unit.create, owner.assign, admin.login
  entityType: string;
  entityId: string | null;
  /** {field: [old, new]} — never raw PII (names, phones, emails are left out or masked). */
  changes?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

/** Append-only, hash-chained per compound (data model §1). Call inside the mutation's transaction. */
@Injectable()
export class AuditService {
  constructor(@Inject(Clock) private readonly clock: Clock) {}

  async record(q: Queryable, entry: AuditEntry): Promise<void> {
    await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`audit:${entry.compoundId}`]);
    const prev = await q.query<{ row_hash: Buffer }>(
      'SELECT row_hash FROM audit_log WHERE compound_id = $1 ORDER BY id DESC LIMIT 1',
      [entry.compoundId],
    );
    const prevHash = prev.rows[0]?.row_hash ?? null;
    const createdAt = this.clock.now();
    const changes = entry.changes ?? null;
    const rowHash = createHash('sha256')
      .update(prevHash ?? Buffer.alloc(0))
      .update(
        JSON.stringify([
          entry.compoundId,
          entry.actorType,
          entry.actorId,
          entry.action,
          entry.entityType,
          entry.entityId,
          changes,
          createdAt.toISOString(),
        ]),
      )
      .digest();
    await q.query(
      `INSERT INTO audit_log (compound_id, actor_type, actor_id, action, entity_type, entity_id, changes,
                              ip, user_agent, prev_hash, row_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        entry.compoundId,
        entry.actorType,
        entry.actorId,
        entry.action,
        entry.entityType,
        entry.entityId,
        changes,
        entry.ip ?? null,
        entry.userAgent ?? null,
        prevHash,
        rowHash,
        createdAt,
      ],
    );
  }
}
