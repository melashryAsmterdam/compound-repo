import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activeResident, adminSession, createRequest, inviteTokenFrom, nextPhone, otpFrom, residentClient, setup, type AdminSession, type TestEnv } from './helpers';

let env: TestEnv;
let admin: AdminSession;
beforeAll(async () => {
  env = await setup();
  admin = await adminSession(env);
});
afterAll(() => env.close());

describe('QA-10: owner change hands open requests to the new owner (option c)', () => {
  it('moves open requests, keeps closed ones with the old owner, and the new owner can act on them', async () => {
    const { unitId, resident: oldOwner } = await activeResident(env, admin);
    const open = await createRequest(oldOwner, unitId);
    const cancelled = await createRequest(oldOwner, unitId, { description: 'Door handle is loose on the balcony' });
    await oldOwner.post(`/app/v1/requests/${cancelled.id}/cancel`, { expectedVersion: cancelled.version }).expect(200);

    const phone = nextPhone();
    await admin.put(`/admin/v1/units/${unitId}/owner`, { fullName: 'Faisal Al-Qahtani', phone }).expect(200);

    // Old owner: access gone straight away.
    await oldOwner.get(`/app/v1/requests/${open.id}`).expect((r) => expect([403, 404]).toContain(r.status));
    const rows = await env.ctx.db.system((tx) => tx.query<any>(`SELECT id, created_by_person_id FROM request WHERE unit_id = $1`, [unitId]));
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.created_by_person_id]));
    expect(byId[cancelled.id]).toBe(oldOwner.personId);
    expect(byId[open.id]).not.toBe(oldOwner.personId);

    const audit = await env.ctx.db.system((tx) => tx.one<any>(`SELECT changes FROM audit_log WHERE action = 'requests.transfer' AND entity_id = $1`, [unitId]));
    expect(JSON.stringify(audit?.changes)).toContain(open.id);

    // New owner activates and sees the open request; the cancelled one is not theirs.
    await admin.post(`/admin/v1/units/${unitId}/invitations`, { channels: ['sms'] }).expect(201);
    await env.drain();
    const start = await env.http.post('/app/v1/activation/start').send({ invitationToken: inviteTokenFrom(env, phone) }).expect(200);
    const installationId = randomUUID();
    const done = await env.http
      .post('/app/v1/activation/complete')
      .send({ challengeId: start.body.challengeId, code: otpFrom(env, phone), consent: { privacyNoticeVersion: '2026-11-01', termsVersion: '2026-11-01', locale: 'ar' }, device: { installationId, platform: 'ios' } })
      .expect(200);
    const newOwner = residentClient(env, done.body, installationId);
    expect(byId[open.id]).toBe(newOwner.personId);
    const list = await newOwner.get(`/app/v1/units/${unitId}/requests`).expect(200);
    const ids = list.body.items.map((i: any) => i.id);
    expect(ids).toContain(open.id);
    expect(ids).not.toContain(cancelled.id);
    await newOwner.get(`/app/v1/requests/${open.id}`).expect(200);
  });

  it('removing the owner without a new one leaves requests with the admin', async () => {
    const { unitId, resident } = await activeResident(env, admin);
    const r = await createRequest(resident, unitId);
    await admin.del(`/admin/v1/units/${unitId}/owner`).expect(204);
    const row = await env.ctx.db.system((tx) => tx.one<any>(`SELECT created_by_person_id FROM request WHERE id = $1`, [r.id]));
    expect(row?.created_by_person_id).toBe(resident.personId);
    await admin.get(`/admin/v1/requests/${r.id}`).expect(200);
  });
});
