import { Injectable, Inject } from '@nestjs/common';
import { DomainError, normalise, toWesternDigits } from '@compound/domain';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../infra/audit.service.js';
import { Clock } from '../../infra/clock.js';
import { Db, isUniqueViolation, type Queryable } from '../../infra/db/db.service.js';
import { notFound } from '../../infra/errors.js';
import type { AdminContext } from '../auth/admin-context.js';
import type { Activation, OwnerInput, UnitInput, UnitListQuery, UnitPatch } from './units.schemas.js';

export const INVITES_PER_UNIT_PER_DAY = 5;

interface UnitRow {
  id: string;
  number: string;
  block: string | null;
  type: string;
  floor: string | null;
  notes: string | null;
  status: 'active' | 'inactive';
  created_at: Date;
  updated_at: Date;
  person_id: string | null;
  full_name: string | null;
  phone_e164: string | null;
  email: string | null;
  locale: 'ar' | 'en' | null;
  activated_at: Date | null;
  activation: Activation;
  open_request_count: number;
  total: number;
}

/**
 * One query shape for list and detail. Activation derivation follows data model §2;
 * "invited" needs an invitation actually sent — an assigned owner with no invite is still not_invited.
 */
const UNIT_SELECT = `
  SELECT u.id, u.number, u.block, u.type, u.floor, u.notes, u.status, u.created_at, u.updated_at,
         p.id AS person_id, p.full_name, p.phone_e164, p.email, p.locale, ua.activated_at,
         CASE
           WHEN ua.id IS NULL THEN 'not_invited'
           WHEN ua.status = 'active' THEN 'active'
           WHEN inv.id IS NULL THEN 'not_invited'
           WHEN inv.expires_at < $1 THEN 'expired'
           WHEN inv.all_failed THEN 'failed'
           ELSE 'invited'
         END AS activation,
         (SELECT count(*)::int FROM request r
           WHERE r.unit_id = u.id AND r.status IN ('new','in_progress','done')) AS open_request_count
  FROM unit u
  LEFT JOIN unit_assignment ua ON ua.unit_id = u.id AND ua.status <> 'revoked'
  LEFT JOIN person p ON p.id = ua.person_id
  LEFT JOIN LATERAL (
    SELECT i.id, i.expires_at,
           (SELECT count(*) > 0 AND bool_and(md.status IN ('failed','undelivered'))
              FROM message_delivery md WHERE md.invitation_id = i.id) AS all_failed
    FROM invitation i
    WHERE i.assignment_id = ua.id AND i.superseded_at IS NULL AND i.revoked_at IS NULL
    ORDER BY i.created_at DESC LIMIT 1
  ) inv ON true`;

@Injectable()
export class UnitsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  list(admin: AdminContext, query: UnitListQuery) {
    return this.db.tenant(admin.compoundId, async (q) => {
      const params: unknown[] = [this.clock.now()];
      const where: string[] = [];
      if (query.q) {
        params.push(`%${escapeLike(query.q)}%`);
        const text = `$${params.length}`;
        const digits = toWesternDigits(query.q).replace(/\D/g, '').replace(/^0+/, '');
        let phoneClause = '';
        if (digits.length >= 3) {
          params.push(`%${digits}%`);
          phoneClause = ` OR x.phone_e164 LIKE $${params.length}`;
        }
        where.push(`(x.number ILIKE ${text} OR x.full_name ILIKE ${text}${phoneClause})`);
      }
      if (query.block) {
        params.push(query.block);
        where.push(`x.block = $${params.length}`);
      }
      if (query.activation) {
        params.push(query.activation);
        where.push(`x.activation = $${params.length}`);
      }
      if (query.status) {
        params.push(query.status);
        where.push(`x.status = $${params.length}`);
      }
      const filtered = `FROM (${UNIT_SELECT}) x ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
      const { rows } = await q.query<UnitRow>(
        `SELECT x.*, count(*) OVER ()::int AS total ${filtered}
         ORDER BY x.block NULLS FIRST, lower(x.number)
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.pageSize, (query.page - 1) * query.pageSize],
      );
      // A page past the end has no row to carry the window count.
      const total =
        rows[0]?.total ??
        (query.page > 1
          ? ((await q.query<{ n: number }>(`SELECT count(*)::int AS n ${filtered}`, params)).rows[0]?.n ?? 0)
          : 0);
      return { items: rows.map(toSummary), page: query.page, pageSize: query.pageSize, total };
    });
  }

  blocks(admin: AdminContext) {
    return this.db.tenant(admin.compoundId, async (q) => {
      const { rows } = await q.query<{ block: string; unit_count: number; active_resident_count: number }>(
        `SELECT u.block, count(DISTINCT u.id)::int AS unit_count,
                count(DISTINCT ua.id) FILTER (WHERE ua.status = 'active')::int AS active_resident_count
         FROM unit u LEFT JOIN unit_assignment ua ON ua.unit_id = u.id
         WHERE u.block IS NOT NULL GROUP BY u.block ORDER BY u.block`,
      );
      return rows.map((r) => ({ block: r.block, unitCount: r.unit_count, activeResidentCount: r.active_resident_count }));
    });
  }

  get(admin: AdminContext, unitId: string) {
    return this.db.tenant(admin.compoundId, (q) => this.detail(q, unitId));
  }

  create(admin: AdminContext, input: UnitInput) {
    return this.db.tenant(admin.compoundId, async (q) => {
      const id = randomUUID();
      const now = this.clock.now();
      try {
        await q.query('SAVEPOINT unit_insert');
        await q.query(
          `INSERT INTO unit (id, compound_id, number, block, type, floor, notes, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
          [id, admin.compoundId, input.number, input.block, input.type, input.floor, input.notes, now],
        );
      } catch (error) {
        if (isUniqueViolation(error, 'unit_number_uq')) throw new DomainError('unit_number_taken', 409);
        throw error;
      }
      await this.audit.record(q, {
        ...actor(admin),
        action: 'unit.create',
        entityType: 'unit',
        entityId: id,
        changes: { number: [null, input.number], block: [null, input.block], type: [null, input.type] },
      });
      return this.detail(q, id);
    });
  }

  update(admin: AdminContext, unitId: string, patch: UnitPatch) {
    return this.db.tenant(admin.compoundId, async (q) => {
      const current = await this.lockUnit(q, unitId);
      const fields = ['number', 'block', 'type', 'floor', 'notes', 'status'] as const;
      const changes: Record<string, [unknown, unknown]> = {};
      for (const f of fields) {
        if (patch[f] !== undefined && patch[f] !== current[f]) changes[f] = [current[f], patch[f]];
      }
      if (Object.keys(changes).length) {
        const sets = Object.keys(changes).map((f, i) => `${f} = $${i + 3}`);
        try {
          await q.query(
            `UPDATE unit SET ${sets.join(', ')}, updated_at = $2 WHERE id = $1`,
            [unitId, this.clock.now(), ...Object.values(changes).map(([, v]) => v)],
          );
        } catch (error) {
          if (isUniqueViolation(error, 'unit_number_uq')) throw new DomainError('unit_number_taken', 409);
          throw error;
        }
        await this.audit.record(q, { ...actor(admin), action: 'unit.update', entityType: 'unit', entityId: unitId, changes });
      }
      return this.detail(q, unitId);
    });
  }

  /** Hard delete only for a unit that never had an owner or a request (A1-AC3). */
  remove(admin: AdminContext, unitId: string) {
    return this.db.tenant(admin.compoundId, async (q) => {
      const current = await this.lockUnit(q, unitId);
      const { rows } = await q.query<{ in_use: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM unit_assignment WHERE unit_id = $1)
             OR EXISTS (SELECT 1 FROM request WHERE unit_id = $1) AS in_use`,
        [unitId],
      );
      if (rows[0]?.in_use) throw new DomainError('unit_in_use', 409);
      await q.query('DELETE FROM unit WHERE id = $1', [unitId]);
      await this.audit.record(q, {
        ...actor(admin),
        action: 'unit.delete',
        entityType: 'unit',
        entityId: unitId,
        changes: { number: [current.number, null] },
      });
    });
  }

  /**
   * Assign or change the owner (A2-AC1, AC6, AC7). People are global and matched by phone/email,
   * so one person can own several units. Changing owner revokes the old assignment and any
   * pending invitation; the old owner's requests stay on the unit.
   */
  assignOwner(admin: AdminContext, unitId: string, input: OwnerInput) {
    return this.db.tenant(admin.compoundId, async (q) => {
      const unit = await this.lockUnit(q, unitId);
      if (unit.status !== 'active') throw new DomainError('unit_inactive', 409);
      const now = this.clock.now();
      const phone = input.phone ? normalise(input.phone) : null;
      const personId = await this.findOrCreatePerson(q, { ...input, phone, email: input.email ?? null }, now);

      const live = await this.liveAssignment(q, unitId);
      if (live?.person_id === personId) return this.detail(q, unitId);
      if (live) await this.revokeAssignment(q, admin, live.id, now);

      const assignmentId = randomUUID();
      await q.query(
        `INSERT INTO unit_assignment (id, compound_id, unit_id, person_id, role, status, assigned_by, created_at)
         VALUES ($1, $2, $3, $4, 'owner', 'invited', $5, $6)`,
        [assignmentId, admin.compoundId, unitId, personId, admin.adminId, now],
      );
      await this.audit.record(q, {
        ...actor(admin),
        action: 'owner.assign',
        entityType: 'unit',
        entityId: unitId,
        changes: { personId: [live?.person_id ?? null, personId], assignmentId: [live?.id ?? null, assignmentId] },
      });
      return this.detail(q, unitId);
    });
  }

  revokeOwner(admin: AdminContext, unitId: string) {
    return this.db.tenant(admin.compoundId, async (q) => {
      await this.lockUnit(q, unitId);
      const live = await this.liveAssignment(q, unitId);
      if (!live) return;
      await this.revokeAssignment(q, admin, live.id, this.clock.now());
      await this.audit.record(q, {
        ...actor(admin),
        action: 'owner.revoke',
        entityType: 'unit',
        entityId: unitId,
        changes: { personId: [live.person_id, null] },
      });
    });
  }

  private async findOrCreatePerson(
    q: Queryable,
    input: { fullName: string; phone: string | null; email: string | null; locale: 'ar' | 'en' },
    now: Date,
  ): Promise<string> {
    const { rows } = await q.query<{ id: string; phone_e164: string | null; email: string | null; has_active: boolean }>(
      `SELECT p.id, p.phone_e164, p.email,
              EXISTS (SELECT 1 FROM unit_assignment ua WHERE ua.person_id = p.id AND ua.status = 'active') AS has_active
       FROM person p
       WHERE p.erased_at IS NULL AND (p.phone_e164 = $1 OR p.email = $2)
       FOR UPDATE OF p`,
      [input.phone, input.email],
    );
    // Note: has_active only sees this compound's assignments (RLS); good enough to decide
    // whether this compound may still correct the person's name.
    if (rows.length > 1) throw new DomainError('owner_identity_conflict', 422);
    const found = rows[0];
    if (!found) {
      const id = randomUUID();
      await q.query(
        `INSERT INTO person (id, full_name, phone_e164, email, locale, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [id, input.fullName, input.phone, input.email, input.locale, now],
      );
      return id;
    }
    const phoneClash = input.phone && found.phone_e164 && found.phone_e164 !== input.phone;
    const emailClash = input.email && found.email && found.email !== input.email;
    if (phoneClash || emailClash) throw new DomainError('owner_identity_conflict', 422);
    await q.query(
      `UPDATE person SET phone_e164 = COALESCE(phone_e164, $2), email = COALESCE(email, $3),
              full_name = CASE WHEN $4 THEN full_name ELSE $5 END,
              locale = CASE WHEN $4 THEN locale ELSE $6::locale_code END,
              updated_at = $7
       WHERE id = $1`,
      [found.id, input.phone, input.email, found.has_active, input.fullName, input.locale, now],
    );
    return found.id;
  }

  private async liveAssignment(q: Queryable, unitId: string) {
    const { rows } = await q.query<{ id: string; person_id: string }>(
      `SELECT id, person_id FROM unit_assignment WHERE unit_id = $1 AND status <> 'revoked' FOR UPDATE`,
      [unitId],
    );
    return rows[0];
  }

  private async revokeAssignment(q: Queryable, admin: AdminContext, assignmentId: string, now: Date) {
    await q.query(
      `UPDATE unit_assignment SET status = 'revoked', revoked_at = $2, revoked_by = $3 WHERE id = $1`,
      [assignmentId, now, admin.adminId],
    );
    await q.query(
      `UPDATE invitation SET revoked_at = $2
       WHERE assignment_id = $1 AND used_at IS NULL AND revoked_at IS NULL AND superseded_at IS NULL`,
      [assignmentId, now],
    );
  }

  private async lockUnit(q: Queryable, unitId: string) {
    const { rows } = await q.query<{
      number: string;
      block: string | null;
      type: string;
      floor: string | null;
      notes: string | null;
      status: string;
    }>('SELECT number, block, type, floor, notes, status FROM unit WHERE id = $1 FOR UPDATE', [unitId]);
    if (!rows[0]) throw notFound();
    return rows[0];
  }

  private async detail(q: Queryable, unitId: string) {
    const now = this.clock.now();
    const { rows } = await q.query<UnitRow>(`SELECT * FROM (${UNIT_SELECT}) x WHERE x.id = $2`, [now, unitId]);
    const row = rows[0];
    if (!row) throw notFound();
    const sent = await q.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM invitation i JOIN unit_assignment ua ON ua.id = i.assignment_id
       WHERE ua.unit_id = $1 AND i.created_at > $2`,
      [unitId, new Date(now.getTime() - 24 * 60 * 60 * 1000)],
    );
    return {
      ...toSummary(row),
      floor: row.floor,
      notes: row.notes,
      latestInvitation: null, // filled in with the invitations module
      invitesRemainingToday: Math.max(0, INVITES_PER_UNIT_PER_DAY - (sent.rows[0]?.n ?? 0)),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}

function toSummary(row: UnitRow) {
  return {
    id: row.id,
    number: row.number,
    block: row.block,
    type: row.type,
    status: row.status,
    owner: row.person_id
      ? {
          personId: row.person_id,
          fullName: row.full_name!,
          phone: row.phone_e164,
          email: row.email,
          locale: row.locale!,
          activatedAt: row.activated_at?.toISOString() ?? null,
        }
      : null,
    activation: row.activation,
    openRequestCount: row.open_request_count,
  };
}

function actor(admin: AdminContext) {
  return {
    compoundId: admin.compoundId,
    actorType: 'admin' as const,
    actorId: admin.adminId,
    ip: admin.ip,
    userAgent: admin.userAgent,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
