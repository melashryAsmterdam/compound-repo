import { createHash } from 'node:crypto';
import type { Tx } from './db';
import { buf } from './crypto';

export interface AuditInput {
  compoundId: string | null;
  actorType: 'admin' | 'resident' | 'system' | 'operator';
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  /** {field: [old, new]}; PII must already be masked by the caller. */
  changes?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

/** Key-order independent JSON (jsonb reorders keys). */
export function canon(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`;
}

/** Append-only, hash-chained per compound (tamper evidence). */
export async function audit(tx: Tx, a: AuditInput): Promise<void> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`audit:${a.compoundId ?? 'platform'}`]);
  const prev = await tx.one<{ row_hash: Uint8Array }>(
    `SELECT row_hash FROM audit_log WHERE compound_id IS NOT DISTINCT FROM $1 ORDER BY id DESC LIMIT 1`,
    [a.compoundId],
  );
  const prevHash = prev ? buf(prev.row_hash) : null;
  const createdAt = new Date();
  const material = canon([a.compoundId, a.actorType, a.actorId, a.action, a.entityType, a.entityId, a.changes ?? null, createdAt.toISOString()]);
  const rowHash = createHash('sha256').update(prevHash ?? Buffer.alloc(0)).update(material).digest();
  await tx.query(
    `INSERT INTO audit_log (compound_id, actor_type, actor_id, action, entity_type, entity_id, changes, ip, user_agent, prev_hash, row_hash, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [a.compoundId, a.actorType, a.actorId, a.action, a.entityType, a.entityId, a.changes ? JSON.stringify(a.changes) : null, a.ip ?? null, a.userAgent?.slice(0, 300) ?? null, prevHash, rowHash, createdAt],
  );
}

/** Verify a compound's chain (ops / tests). */
export async function verifyAuditChain(tx: Tx, compoundId: string): Promise<boolean> {
  const rows = await tx.query<any>(
    `SELECT compound_id, actor_type, actor_id, action, entity_type, entity_id, changes, prev_hash, row_hash, created_at FROM audit_log WHERE compound_id = $1 ORDER BY id`,
    [compoundId],
  );
  let prev: Buffer | null = null;
  for (const r of rows) {
    const material = canon([r.compound_id, r.actor_type, r.actor_id, r.action, r.entity_type, r.entity_id, r.changes ?? null, new Date(r.created_at).toISOString()]);
    const h: Buffer = createHash('sha256').update(prev ?? Buffer.alloc(0)).update(material).digest();
    if (!h.equals(buf(r.row_hash))) return false;
    prev = h;
  }
  return true;
}
