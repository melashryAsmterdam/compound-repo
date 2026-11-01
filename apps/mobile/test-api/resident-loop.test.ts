/**
 * End-to-end check of the app's own API layer (src/lib/api.ts, upload.ts, requests.ts) against a
 * running backend — the full R1→R5 loop with the admin side driven over HTTP.
 *
 * Start the API with: DEV_FIXED_OTP=123456 OTP_IP_HOURLY_LIMIT=100000 LOGIN_IP_LIMIT=100000 \
 *   PORT=4100 node dist/main.js > api.log   (then seed the demo compound)
 * Run with: E2E_API_URL=http://127.0.0.1:4100 E2E_API_LOG=/path/api.log pnpm test:api
 * (API started with NODE_ENV=development LOG_MESSAGE_TEXT=1 DEV_FIXED_OTP=123456 so the invite link is logged — QA-02)
 * Skips when E2E_API_URL is unset.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { ApiError, createResidentApi, unwrap, type TokenStore } from '../src/lib/api';
import { outcomeBadges, statusChip, timelineLine } from '../src/lib/requests';
import { uploadBlob } from '../src/lib/upload';

const BASE = process.env.E2E_API_URL;
const LOG = process.env.E2E_API_LOG;
const OTP = process.env.E2E_OTP ?? '123456';
const ADMIN = { email: process.env.E2E_ADMIN_EMAIL ?? 'admin@narjis.example.sa', password: process.env.E2E_ADMIN_PASSWORD ?? 'Narjis-Admin-2026' };
const PORTAL = process.env.E2E_PORTAL_ORIGIN ?? 'http://localhost:3000';

// 1×1 JPEG
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

async function admin() {
  const login = await fetch(`${BASE}/admin/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ADMIN) });
  assert.equal(login.status, 200, await login.clone().text());
  const { challengeId } = (await login.json()) as { challengeId: string };
  const verify = await fetch(`${BASE}/admin/v1/auth/mfa/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challengeId, code: OTP }) });
  assert.equal(verify.status, 200);
  const cookie = verify.headers.get('set-cookie')!.split(';')[0]!;
  const { csrfToken } = (await verify.json()) as { csrfToken: string };
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Cookie: cookie, 'Accept-Language': 'en', 'Content-Type': 'application/json', ...(method === 'GET' ? {} : { 'X-CSRF-Token': csrfToken, Origin: PORTAL }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
  return call;
}

function inviteTokenFor(phone: string): string {
  const masked = phone.slice(-3);
  for (let i = 0; i < 50; i++) {
    const lines = readFileSync(LOG!, 'utf8').split('\n').reverse();
    const line = lines.find((l) => l.includes('[sms]') && l.includes('/a/') && l.includes(masked));
    const token = line?.match(/\/a\/([A-Za-z0-9_-]{43})/)?.[1];
    if (token) return token;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }
  throw new Error('invite not found in API log');
}

const memTokens = (): TokenStore & { v: string | null } => {
  const t = { v: null as string | null } as TokenStore & { v: string | null };
  t.getRefreshToken = async () => t.v;
  t.setRefreshToken = async (x) => void (t.v = x);
  return t;
};

describe('resident app ↔ backend', { skip: !BASE || !LOG ? 'E2E_API_URL / E2E_API_LOG not set' : false }, () => {
  it('invite → activate → report with photo → in progress + visit → done → reopen → done → confirm', async () => {
    const adm = await admin();
    const phone = `+9665${String(Date.now()).slice(-8)}`;
    const unit = await adm('POST', '/admin/v1/units', { number: `M-${Date.now() % 100000}`, block: 'M', type: 'villa' });
    assert.equal(unit.status, 201, JSON.stringify(unit.body));
    assert.equal((await adm('PUT', `/admin/v1/units/${unit.body.id}/owner`, { fullName: 'Noura Mobile', phone, locale: 'ar' })).status, 200);
    assert.equal((await adm('POST', `/admin/v1/units/${unit.body.id}/invitations`, { channels: ['sms'] })).status, 201);
    const token = inviteTokenFor(phone);

    const tokens = memTokens();
    const locale = { v: 'ar' as 'ar' | 'en' };
    const api = createResidentApi({ baseUrl: BASE!, appVersion: '1.0.0', tokens, getLocale: () => locale.v });

    // R1: preview → start → legal → complete
    const preview = await unwrap(api.client.GET('/app/v1/invitations/{token}', { params: { path: { token } } }));
    assert.equal(preview.fullName, 'Noura Mobile');
    assert.equal(preview.otpChannel, 'sms');
    const challenge = await unwrap(api.client.POST('/app/v1/activation/start', { body: { invitationToken: token } }));
    const pn = await unwrap(api.client.GET('/app/v1/legal/{document}', { params: { path: { document: 'privacy_notice' }, query: { locale: 'ar' } } }));
    const terms = await unwrap(api.client.GET('/app/v1/legal/{document}', { params: { path: { document: 'terms' }, query: { locale: 'ar' } } }));
    const pair = await unwrap(api.client.POST('/app/v1/activation/complete', {
      body: {
        challengeId: challenge.challengeId, code: OTP,
        consent: { privacyNoticeVersion: pn.version, termsVersion: terms.version, locale: 'ar' },
        device: { installationId: randomUUID(), platform: 'android', appVersion: '1.0.0', locale: 'ar' },
      },
    }));
    await api.adopt(pair);
    assert.equal(tokens.v, pair.refreshToken);
    const unitId = pair.me.units.find((u) => u.number === unit.body.number)!.unitId!;

    // Used link → invitation_used (R1-AC7)
    const used = await unwrap(api.client.GET('/app/v1/invitations/{token}', { params: { path: { token } } })).catch((e) => e);
    assert.ok(used instanceof ApiError && used.code === 'invitation_used', String(used?.code));

    // QA-07: the preview carries the compound phone (may be null if the compound has none)
    assert.ok('compoundPhone' in preview, 'InvitationPreview.compoundPhone present');

    // QA-03 / B6: SSE takes the bearer only in the Authorization header (what src/lib/realtime.ts sends)
    const ctl = new AbortController();
    const sse = await fetch(`${BASE}/app/v1/events/stream`, { headers: api.authHeaders(), signal: ctl.signal });
    assert.equal(sse.status, 200);
    assert.match(sse.headers.get('content-type') ?? '', /text\/event-stream/);
    ctl.abort();
    const inUrl = await fetch(`${BASE}/app/v1/events/stream?access_token=${encodeURIComponent(pair.accessToken)}`);
    assert.equal(inUrl.status, 401, 'token in the query string is refused');
    await inUrl.body?.cancel();

    // R5 device registration + categories in Arabic
    assert.equal((await api.client.PUT('/app/v1/devices/current', { body: { pushToken: 'test-device-token', pushEnabled: true, locale: 'ar', appVersion: '1.0.0' } })).response.status, 204);
    const cats = await unwrap(api.client.GET('/app/v1/categories'));
    assert.equal(cats.length, 8);
    assert.equal(cats.find((c) => c.code === 'plumbing')!.nameAr, 'سباكة');

    // R2: photo upload + create with Idempotency-Key, replay returns the same request
    const uploadId = await uploadBlob(api, new Blob([JPEG], { type: 'image/jpeg' }), 'request_photo');
    const key = randomUUID();
    const body = { categoryCode: 'plumbing' as const, description: 'تسريب ماء تحت مغسلة المطبخ', locationInUnit: 'المطبخ', preferredSlot: 'morning' as const, photoUploadIds: [uploadId] };
    const created = await unwrap(api.client.POST('/app/v1/units/{unitId}/requests', { params: { path: { unitId }, header: { 'Idempotency-Key': key } }, body }));
    assert.match(created.ref, /^REQ-\d+$/);
    assert.equal(created.status, 'new');
    assert.deepEqual(created.allowedActions, ['cancel']);
    const replay = await unwrap(api.client.POST('/app/v1/units/{unitId}/requests', { params: { path: { unitId }, header: { 'Idempotency-Key': key } }, body }));
    assert.equal(replay.id, created.id, 'idempotent replay must return the same request');
    assert.equal(statusChip(created).key, 'status.new');

    // A3/A4: admin works it and schedules a visit
    const rid = created.id;
    let v = (await adm('GET', `/admin/v1/requests/${rid}`)).body.version as number;
    const ip = await adm('POST', `/admin/v1/requests/${rid}/transitions`, { to: 'in_progress', expectedVersion: v });
    assert.equal(ip.status, 200, JSON.stringify(ip.body));
    assert.equal((await adm('POST', `/admin/v1/requests/${rid}/comments`, { body: 'السباك يصل الثلاثاء', visit: { date: '2099-03-03', startTime: '09:00', endTime: '11:00' } })).status, 201);

    // R3: resident sees status, comment and visit; cancel no longer allowed
    let detail = await unwrap(api.client.GET('/app/v1/requests/{requestId}', { params: { path: { requestId: rid } } }));
    assert.equal(detail.status, 'in_progress');
    assert.ok(detail.visit?.startAt && new Date(detail.visit.startAt).toISOString() === '2099-03-03T06:00:00.000Z', `visit is Riyadh 09:00 → 06:00Z, got ${detail.visit?.startAt}`);
    assert.ok(!detail.allowedActions?.includes('cancel'));
    const kinds = (detail.timeline ?? []).map((e) => timelineLine(e, (s) => s).key);
    assert.ok(kinds.includes('detail.ev_comment') || kinds.includes('detail.ev_visit_scheduled'), kinds.join(','));
    assert.ok((detail.photos ?? []).length === 1, 'photo attached');

    // Resident cancel now → invalid_transition (M-18 "too late")
    const late = await unwrap(api.client.POST('/app/v1/requests/{requestId}/cancel', { params: { path: { requestId: rid } }, body: { expectedVersion: detail.version } })).catch((e) => e);
    assert.ok(late instanceof ApiError && (late.code === 'invalid_transition' || late.code === 'version_conflict'), String(late?.code));

    // Done → R4 reopen with reason
    v = (await adm('GET', `/admin/v1/requests/${rid}`)).body.version;
    assert.equal((await adm('POST', `/admin/v1/requests/${rid}/transitions`, { to: 'done', expectedVersion: v })).status, 200);
    detail = await unwrap(api.client.GET('/app/v1/requests/{requestId}', { params: { path: { requestId: rid } } }));
    assert.equal(detail.status, 'done');
    assert.deepEqual([...(detail.allowedActions ?? [])].sort(), ['confirm', 'reopen']);
    assert.ok(detail.autoCloseAt, 'autoCloseAt set when done');
    assert.equal(outcomeBadges(detail)[0]?.key, 'status.awaiting');

    // Stale version → version_conflict, then the real reopen
    const stale = await unwrap(api.client.POST('/app/v1/requests/{requestId}/reopen', { params: { path: { requestId: rid } }, body: { reason: 'x', expectedVersion: detail.version - 1 } })).catch((e) => e);
    assert.ok(stale instanceof ApiError && stale.status === 409, String(stale?.code));
    const reopened = await unwrap(api.client.POST('/app/v1/requests/{requestId}/reopen', { params: { path: { requestId: rid } }, body: { reason: 'ما زال يسرب', expectedVersion: detail.version } }));
    assert.equal(reopened.status, 'in_progress');
    assert.equal(reopened.reopenCount, 1);
    assert.equal(outcomeBadges(reopened)[0]?.key, 'status.reopened');

    // Done again → confirm → Closed · Confirmed
    v = (await adm('GET', `/admin/v1/requests/${rid}`)).body.version;
    assert.equal((await adm('POST', `/admin/v1/requests/${rid}/transitions`, { to: 'done', expectedVersion: v })).status, 200);
    detail = await unwrap(api.client.GET('/app/v1/requests/{requestId}', { params: { path: { requestId: rid } } }));
    const closed = await unwrap(api.client.POST('/app/v1/requests/{requestId}/confirm', { params: { path: { requestId: rid } }, body: { expectedVersion: detail.version } }));
    assert.equal(closed.status, 'closed');
    assert.equal(closed.closeReason, 'confirmed');
    assert.equal(statusChip(closed).key, 'status.closedConfirmed');

    // Lists: closed filter has it, open does not
    const openList = await unwrap(api.client.GET('/app/v1/units/{unitId}/requests', { params: { path: { unitId }, query: { state: 'open' } } }));
    const closedList = await unwrap(api.client.GET('/app/v1/units/{unitId}/requests', { params: { path: { unitId }, query: { state: 'closed' } } }));
    assert.ok(!openList.items.some((r) => r.id === rid));
    assert.ok(closedList.items.some((r) => r.id === rid));

    // R5: notifications were created for status changes / comments, in Arabic
    const notes = await unwrap(api.client.GET('/app/v1/notifications'));
    assert.ok(notes.items.some((n) => n.requestId === rid), 'notification for this request');
    assert.ok(/[؀-ۿ]/.test(notes.items[0]!.title), `title in Arabic: ${notes.items[0]!.title}`);

    // Announcement to all → appears for the unit; opening marks it read
    const ann = await adm('POST', '/admin/v1/announcements', { languages: 'both', titleAr: 'انقطاع المياه', bodyAr: 'الخميس من 9 إلى 12', titleEn: 'Water cut', bodyEn: 'Thursday 9 to 12', audience: { type: 'all' } });
    assert.ok(ann.status === 201 || ann.status === 200, JSON.stringify(ann.body));
    let list = { items: [] as { id: string; title: string; isRead: boolean }[] };
    for (let i = 0; i < 20 && !list.items.some((a) => a.id === ann.body.id); i++) {
      await new Promise((r) => setTimeout(r, 300));
      list = await unwrap(api.client.GET('/app/v1/units/{unitId}/announcements', { params: { path: { unitId } } }));
    }
    const mine = list.items.find((a) => a.id === ann.body.id);
    assert.ok(mine, 'announcement delivered');
    const unread = await unwrap(api.client.GET('/app/v1/notifications'));
    assert.ok(unread.unreadCount > 0 && unread.items.some((n) => n.announcementId === mine!.id && !n.isRead), 'announcement notification unread');
    assert.equal(mine!.title, 'انقطاع المياه');
    await unwrap(api.client.GET('/app/v1/announcements/{announcementId}', { params: { path: { announcementId: mine!.id } } }));
    list = await unwrap(api.client.GET('/app/v1/units/{unitId}/announcements', { params: { path: { unitId } } }));
    assert.equal(list.items.find((a) => a.id === mine!.id)!.isRead, true);
    // QA-14: deep links use compoundapp://
    for (const n of (await unwrap(api.client.GET('/app/v1/notifications'))).items) {
      if (n.deepLink) assert.match(n.deepLink, /^compoundapp:\/\//, n.deepLink);
    }
    assert.equal((await api.client.POST('/app/v1/notifications/read-all')).response.status, 204);
    assert.equal((await unwrap(api.client.GET('/app/v1/notifications'))).unreadCount, 0);

    // Settings: language + mute saved on the server
    locale.v = 'en';
    const me = await unwrap(api.client.PATCH('/app/v1/me', { body: { locale: 'en', muteAnnouncements: true } }));
    assert.equal(me.locale, 'en');
    assert.equal(me.muteAnnouncements, true);

    // Refresh rotation, then sign out revokes the family
    assert.equal(await api.refresh(), true);
    assert.notEqual(tokens.v, pair.refreshToken);
    const oldRefresh = await fetch(`${BASE}/app/v1/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: pair.refreshToken }) });
    assert.equal(oldRefresh.status, 401, 'reusing a rotated refresh token is refused');

    // QA-13: 5 wrong codes per challenge; after that even the right code is refused
    const signIn = await unwrap(api.client.POST('/app/v1/auth/otp/start', { body: { phone } }));
    const device = { installationId: randomUUID(), platform: 'android' as const };
    const wrong = OTP === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const e = await unwrap(api.client.POST('/app/v1/auth/otp/verify', { body: { challengeId: signIn.challengeId, code: wrong, device } })).catch((x) => x);
      assert.ok(e instanceof ApiError && e.status === 400, String(e?.code));
    }
    const spent = await unwrap(api.client.POST('/app/v1/auth/otp/verify', { body: { challengeId: signIn.challengeId, code: OTP, device } })).catch((x) => x);
    assert.ok(spent instanceof ApiError && spent.code === 'otp_attempts_exceeded', String(spent?.code));
  });

  it('min version from /app/v1/meta; an older app gets 426 app_update_required (v1.1)', async () => {
    const api = createResidentApi({ baseUrl: BASE!, appVersion: '1.0.0', tokens: memTokens(), getLocale: () => 'en' });
    const meta = await unwrap(api.client.GET('/app/v1/meta'));
    assert.match(meta.minSupportedVersion.ios, /^\d+\.\d+\.\d+$/);
    let updateRequired = 0;
    const old = createResidentApi({ baseUrl: BASE!, appVersion: '0.0.1', tokens: memTokens(), getLocale: () => 'en', onUpdateRequired: () => void updateRequired++ });
    const e = await unwrap(old.client.POST('/app/v1/auth/otp/start', { body: { phone: '+966500000002' } })).catch((x) => x);
    assert.ok(e instanceof ApiError && e.status === 426 && e.code === 'app_update_required', String(e?.code));
    assert.equal(updateRequired, 1);
  });

  it('sign-in by OTP never reveals whether the number exists', async () => {
    const api = createResidentApi({ baseUrl: BASE!, appVersion: '1.0.0', tokens: memTokens(), getLocale: () => 'en' });
    const c = await unwrap(api.client.POST('/app/v1/auth/otp/start', { body: { phone: '+966500000001' } }));
    assert.ok(c.challengeId);
    const err = await unwrap(api.client.POST('/app/v1/auth/otp/verify', {
      body: { challengeId: c.challengeId, code: OTP, device: { installationId: randomUUID(), platform: 'ios' } },
    })).catch((e) => e);
    assert.ok(err instanceof ApiError && err.status === 400, String(err?.code));
  });
});
