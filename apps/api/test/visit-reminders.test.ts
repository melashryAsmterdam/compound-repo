import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activeResident, adminSession, createRequest, setup, type AdminSession, type TestEnv } from './helpers';

let env: TestEnv;
let admin: AdminSession;
beforeAll(async () => {
  env = await setup();
});
afterAll(() => env.close());

const RIYADH = 3 * 3_600_000;
/** Move the test clock to the next hh:mm in Riyadh. */
function clockTo(hh: number, mm: number) {
  const now = env.ctx.now().getTime();
  const local = new Date(now + RIYADH);
  const target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hh, mm) - RIYADH;
  env.ctx.clock.advance((target > now ? target : target + 86_400_000) - now);
}
const riyadhDate = (offsetDays: number) => new Date(env.ctx.now().getTime() + offsetDays * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
const reminders = () => env.ctx.db.system((tx) => tx.query<any>(`SELECT request_id, created_at FROM notification WHERE type = 'visit_reminder'`));

describe('QA-11: visit reminder timing', () => {
  it('sends at 20:00–20:05 the evening before, and covers a visit booked later that evening', async () => {
    clockTo(19, 50);
    const email = 'reminders@test.sa';
    admin = await adminSession(env, email); // after the clock jump, so the 30-min idle timeout does not apply
    const { unitId, resident } = await activeResident(env, admin);
    const early = await createRequest(resident, unitId);
    const late = await createRequest(resident, unitId, { description: 'Air conditioner is dripping water' });
    await admin.post(`/admin/v1/requests/${early.id}/comments`, { visit: { date: riyadhDate(1), startTime: '09:00', endTime: '11:00' } }).expect(201);

    await env.handlers.tick();
    expect(await reminders()).toHaveLength(0); // 19:50: too early

    env.ctx.clock.advance(12 * 60_000); // 20:02
    await env.handlers.tick();
    expect((await reminders()).map((r) => r.request_id)).toEqual([early.id]);

    env.ctx.clock.advance(88 * 60_000); // 21:30: a late booking for tomorrow
    admin = await adminSession(env, email);
    await admin.post(`/admin/v1/requests/${late.id}/comments`, { visit: { date: riyadhDate(1), startTime: '13:00', endTime: '14:00' } }).expect(201);
    env.ctx.clock.advance(5 * 60_000); // next 5-minute slot
    await env.handlers.tick();
    const ids = (await reminders()).map((r) => r.request_id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(late.id);

    env.ctx.clock.advance(5 * 60_000);
    await env.handlers.tick();
    expect(await reminders()).toHaveLength(2); // once per visit
  });
});
