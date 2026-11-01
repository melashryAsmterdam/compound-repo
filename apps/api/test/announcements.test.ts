import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activeResident, adminSession, setup, type AdminSession, type TestEnv } from './helpers';

let env: TestEnv;
let admin: AdminSession;
let a1: Awaited<ReturnType<typeof activeResident>>;
let b1: Awaited<ReturnType<typeof activeResident>>;
beforeAll(async () => {
  env = await setup();
  admin = await adminSession(env);
  a1 = await activeResident(env, admin, { number: 'AN-1', block: 'North' });
  b1 = await activeResident(env, admin, { number: 'AN-2', block: 'South' });
  await a1.resident.put('/app/v1/devices/current', { pushToken: 'tok-a1', pushEnabled: true }).expect(204);
  await b1.resident.put('/app/v1/devices/current', { pushToken: 'tok-b1', pushEnabled: true }).expect(204);
});
afterAll(() => env.close());

describe('A5 announcements', () => {
  it('validates languages and audience', async () => {
    const r = await admin.post('/admin/v1/announcements', { languages: 'both', titleAr: 'انقطاع المياه', bodyAr: 'غدًا', audience: { type: 'all' } }).expect(422);
    expect(r.body.errors.map((e: any) => e.field)).toEqual(['titleEn', 'bodyEn']);
    await admin.post('/admin/v1/announcements', { languages: 'en', titleEn: 'x', bodyEn: 'y', audience: { type: 'blocks', blocks: [] } }).expect(422);
    const past = await admin.post('/admin/v1/announcements', { languages: 'en', titleEn: 'x', bodyEn: 'y', audience: { type: 'all' }, scheduledAt: '2020-01-01T00:00:00Z' }).expect(422);
    expect(past.body.code).toBe('schedule_in_past');
  });

  it('previews audience and SMS counts (A5-AC3)', async () => {
    expect((await admin.post('/admin/v1/announcements/audience-preview', { audience: { type: 'all' }, sendSms: true }).expect(200)).body).toEqual({ recipientCount: 2, smsCount: 2 });
    expect((await admin.post('/admin/v1/announcements/audience-preview', { audience: { type: 'blocks', blocks: ['North'] } }).expect(200)).body).toEqual({ recipientCount: 1, smsCount: 0 });
    expect((await admin.post('/admin/v1/announcements/audience-preview', { audience: { type: 'units', unitIds: [b1.unitId] } }).expect(200)).body.recipientCount).toBe(1);
  });

  it('sends now to a block with SMS, counts reads, respects mute, and deletes (A5-AC2..AC6, R5-AC5)', async () => {
    await a1.resident.patch('/app/v1/me', { muteAnnouncements: true }).expect(200);
    const created = await admin.post('/admin/v1/announcements', {
      languages: 'both', titleAr: 'انقطاع المياه', bodyAr: 'غدًا من 9 إلى 12', titleEn: 'Water cut-off', bodyEn: 'Tomorrow 9–12',
      audience: { type: 'blocks', blocks: ['North', 'South'] }, sendSms: true,
    }).expect(201);
    expect(created.body.status).toBe('sending');
    await env.drain();
    const sent = (await admin.get(`/admin/v1/announcements/${created.body.id}`).expect(200)).body;
    expect(sent).toMatchObject({ status: 'sent', recipientCount: 2, smsCount: 2, readCount: 0, audience: { type: 'blocks', blocks: ['North', 'South'] } });
    expect(env.ctx.channels.outbox.filter((m) => m.channel === 'push' && m.to === 'tok-a1')).toHaveLength(0); // muted
    expect(env.ctx.channels.last('push', 'tok-b1')!.text).toContain('Water cut-off');
    expect(env.ctx.channels.last('sms', a1.phone)!.text).toContain('Water cut-off'); // SMS ignores mute: urgent channel

    const list = (await b1.resident.get(`/app/v1/units/${b1.unitId}/announcements`).expect(200)).body.items;
    expect(list[0]).toMatchObject({ id: created.body.id, title: 'Water cut-off', isRead: false, locale: 'en' });
    await b1.resident.patch('/app/v1/me', { locale: 'ar' }).expect(200);
    const opened = (await b1.resident.get(`/app/v1/announcements/${created.body.id}`).expect(200)).body;
    expect(opened).toMatchObject({ title: 'انقطاع المياه', isRead: true, locale: 'ar' });
    expect((await admin.get(`/admin/v1/announcements/${created.body.id}`).expect(200)).body.readCount).toBe(1);

    await admin.del(`/admin/v1/announcements/${created.body.id}`).expect(204);
    expect((await b1.resident.get(`/app/v1/units/${b1.unitId}/announcements`).expect(200)).body.items).toHaveLength(0);
    await b1.resident.get(`/app/v1/announcements/${created.body.id}`).expect(404);
  });

  it('schedules for later and dispatches on the cron (A5-AC4); deleting a scheduled one cancels it', async () => {
    const at = new Date(env.ctx.now().getTime() + 3_600_000).toISOString();
    const s = await admin.post('/admin/v1/announcements', { languages: 'ar', titleAr: 'صيانة المسبح', bodyAr: 'الأحد', audience: { type: 'all' }, scheduledAt: at }).expect(201);
    const s2 = await admin.post('/admin/v1/announcements', { languages: 'ar', titleAr: 'ملغي', bodyAr: 'ملغي', audience: { type: 'all' }, scheduledAt: at }).expect(201);
    expect(s.body).toMatchObject({ status: 'scheduled', readCount: null });
    await admin.del(`/admin/v1/announcements/${s2.body.id}`).expect(204);
    const svc = (env.handlers as any).announcements;
    expect(await svc.dispatchDue()).toBe(0);
    env.ctx.clock.advance(3_600_000 + 1000);
    try {
      expect(await svc.dispatchDue()).toBe(1);
    } finally {
      env.ctx.clock.advance(-(3_600_000 + 1000));
    }
    expect((await admin.get(`/admin/v1/announcements/${s.body.id}`).expect(200)).body).toMatchObject({ status: 'sent', recipientCount: 2 });
    const all = (await admin.get('/admin/v1/announcements').expect(200)).body.items.map((x: any) => x.id);
    expect(all).toContain(s.body.id);
    expect(all).not.toContain(s2.body.id);
  });
});
