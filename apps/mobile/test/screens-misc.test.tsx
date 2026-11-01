import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import Notifications from '@/app/notifications';
import Settings from '@/app/(tabs)/settings';
import Consent from '@/app/consent';
import Privacy from '@/app/privacy';
import { setFlow } from '@/lib/flow';
import { json, ME, mockFetch, renderScreen } from './render';
import { mockRouter } from './setup';

beforeEach(() => jest.clearAllMocks());

describe('M-22 Notifications', () => {
  it('groups by day, opens the target and marks it read', async () => {
    const now = new Date().toISOString();
    const api = mockFetch({
      'GET /app/v1/notifications': () => json(200, {
        unreadCount: 1,
        items: [
          { id: 'n1', type: 'request_status_changed', title: 'REQ-00123 is now Done', createdAt: now, isRead: false, requestId: 'r1', deepLink: 'compound://requests/r1' },
          { id: 'n2', type: 'announcement', title: 'Water cut', createdAt: '2026-01-01T00:00:00Z', isRead: true, announcementId: 'a1' },
        ],
      }),
      'POST /app/v1/notifications/:id/read': () => new Response(null, { status: 204 }),
    });
    await renderScreen(<Notifications />, { fetch: api.fetch, signedIn: true });
    expect(await screen.findByText('Today')).toBeTruthy();
    expect(screen.getByText('Earlier')).toBeTruthy();
    await fireEvent.press(screen.getByText('REQ-00123 is now Done'));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/requests/r1'));
    expect(api.calls.some((c) => c.path === '/app/v1/notifications/n1/read')).toBe(true);
  });
});

describe('M-23 Settings', () => {
  it('announcements toggle saves muteAnnouncements; request updates cannot be muted', async () => {
    const api = mockFetch({
      'PATCH /app/v1/me': (_r, body) => json(200, { ...ME, ...(body as object) }),
      'GET /app/v1/me': () => json(200, { ...ME, muteAnnouncements: true }),
    });
    await renderScreen(<Settings />, { fetch: api.fetch, signedIn: true });
    await fireEvent(await screen.findByTestId('mute-switch'), 'valueChange', false);
    await waitFor(() => expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ muteAnnouncements: true }));
    expect(screen.getByText("Always on so you don't miss visits")).toBeTruthy();
    expect(screen.getByText(/\+9665\*{5}567/)).toBeTruthy();
  });
});

describe('M-06 Consent', () => {
  it('needs the tick, then completes activation with versions, locale and device', async () => {
    setFlow({
      mode: 'activation',
      code: '123456',
      challenge: { challengeId: '3b6f2c4e-0000-4000-8000-000000000001', channel: 'sms', maskedDestination: 'x', expiresAt: '2099-01-01T00:00:00Z', resendsRemaining: 3 },
    });
    const api = mockFetch({
      'GET /app/v1/legal/:doc': (req) => json(200, { version: req.url.includes('terms') ? 't-2' : 'pn-3', locale: 'en', html: '<p>x</p>' }),
      'POST /app/v1/activation/complete': () => json(200, { accessToken: 'a', accessTokenExpiresAt: '2030-01-01T00:00:00Z', refreshToken: 'r', me: ME }),
    });
    await renderScreen(<Consent />, { fetch: api.fetch });
    await waitFor(() => expect(api.calls.filter((c) => c.path.startsWith('/app/v1/legal/')).length).toBe(2));
    expect(screen.getByTestId('consent-agree')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('consent-check'));
    await fireEvent.press(screen.getByTestId('consent-agree'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/push-primer'));
    expect(api.calls.find((c) => c.path === '/app/v1/activation/complete')!.body).toMatchObject({
      challengeId: '3b6f2c4e-0000-4000-8000-000000000001',
      code: '123456',
      consent: { privacyNoticeVersion: 'pn-3', termsVersion: 't-2', locale: 'en' },
      device: { platform: 'ios' },
    });
  });

  it('consent_version_outdated unticks and asks to review again', async () => {
    setFlow({ mode: 'activation', code: '123456', challenge: { challengeId: '3b6f2c4e-0000-4000-8000-000000000001', channel: 'sms', maskedDestination: 'x', expiresAt: '2099-01-01T00:00:00Z', resendsRemaining: 3 } });
    const api = mockFetch({
      'GET /app/v1/legal/:doc': () => json(200, { version: 'v1', locale: 'en', html: '<p>x</p>' }),
      'POST /app/v1/activation/complete': () => json(409, { code: 'consent_version_outdated', status: 409, title: 'x', type: 'about:blank' }),
    });
    await renderScreen(<Consent />, { fetch: api.fetch });
    await waitFor(() => expect(screen.getByTestId('consent-check')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('consent-check'));
    await waitFor(() => expect(screen.getByTestId('consent-agree')).toBeEnabled());
    await fireEvent.press(screen.getByTestId('consent-agree'));
    expect(await screen.findByText('The privacy notice was updated. Please review it again.')).toBeTruthy();
    expect(screen.getByTestId('consent-check').props.accessibilityState.checked).toBe(false);
  });
});

describe('M-25 Privacy', () => {
  it('shows the accepted privacy notice from ResidentMe.consent (v1.1)', async () => {
    const api = mockFetch({});
    await renderScreen(<Privacy />, { fetch: api.fetch, signedIn: true, me: { ...ME, consent: { acceptedAt: '2026-10-30T09:00:00Z', policyVersion: 'pn-3' } } });
    expect((await screen.findByTestId('consent-line')).props.children).toMatch(/version pn-3/);
  });
  it('hides the line when the profile has no consent yet', async () => {
    await renderScreen(<Privacy />, { fetch: mockFetch({}).fetch, signedIn: true, me: { ...ME, consent: null } });
    expect(screen.queryByTestId('consent-line')).toBeNull();
  });
});
