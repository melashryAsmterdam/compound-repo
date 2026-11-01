import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Alert } from 'react-native';
import RequestDetailScreen from '@/app/requests/[id]';
import Home from '@/app/(tabs)/index';
import MyRequests from '@/app/(tabs)/requests';
import Review from '@/app/requests/new/review';
import { saveDraft } from '@/lib/drafts';
import { DraftProvider } from '@/lib/useDraft';
import { CATEGORIES, requestDetail } from './fixtures';
import { json, ME, mockFetch, renderScreen } from './render';
import { mockRouter, setParams } from './setup';

const UNIT = ME.units[0]!.unitId!;
const pressAlertButton = (label: string) =>
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    buttons?.find((b) => b.text === label)?.onPress?.();
  });

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  setParams({});
});

describe('M-15 Request detail', () => {
  it('renders the timeline oldest → newest and offers Cancel only while allowed', async () => {
    setParams({ id: 'b7c1e2f0-0000-4000-8000-000000000123' });
    const api = mockFetch({
      'GET /app/v1/requests/:id': () => json(200, requestDetail()),
      'GET /app/v1/categories': () => json(200, CATEGORIES),
      'GET /app/v1/notifications': () => json(200, { items: [], unreadCount: 0 }),
    });
    await renderScreen(<RequestDetailScreen />, { fetch: api.fetch, signedIn: true });
    const timeline = await screen.findByTestId('timeline');
    const texts = within(timeline).getAllByText(/You created the request|Management/).map((n) => n.props.children);
    expect(texts[0]).toBe('You created the request');
    expect(screen.queryByTestId('decision-bar')).toBeNull();
    expect(screen.getByText('Plumber on Tuesday')).toBeTruthy();
  });

  it('Done → decision bar; Confirm sends expectedVersion and shows Closed · Confirmed', async () => {
    setParams({ id: 'b7c1e2f0-0000-4000-8000-000000000123' });
    const done = requestDetail({ status: 'done', doneAt: '2026-11-02T08:00:00Z', autoCloseAt: '2026-11-09T08:00:00Z', allowedActions: ['confirm', 'reopen'], version: 7 });
    const api = mockFetch({
      'GET /app/v1/requests/:id': () => json(200, done),
      'POST /app/v1/requests/:id/confirm': () => json(200, { ...done, status: 'closed', closeReason: 'confirmed', allowedActions: [], version: 8 }),
      'GET /app/v1/categories': () => json(200, CATEGORIES),
      'GET /app/v1/notifications': () => json(200, { items: [], unreadCount: 0 }),
      'GET /app/v1/units/:u/requests': () => json(200, { items: [] }),
    });
    pressAlertButton('Yes, close it');
    await renderScreen(<RequestDetailScreen />, { fetch: api.fetch, signedIn: true });
    expect(await screen.findByTestId('decision-bar')).toBeTruthy();
    expect(screen.getByText(/close automatically on/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('confirm-fixed'));
    await waitFor(() => expect(screen.getByText('Closed · Confirmed')).toBeTruthy());
    expect(api.calls.find((c) => c.path.endsWith('/confirm'))!.body).toEqual({ expectedVersion: 7 });
    expect(screen.queryByTestId('decision-bar')).toBeNull();
    expect(screen.getByText('Create a new request')).toBeTruthy();
  });

  it('a conflict reloads the request and explains why', async () => {
    setParams({ id: 'b7c1e2f0-0000-4000-8000-000000000123' });
    let version = 7;
    const api = mockFetch({
      'GET /app/v1/requests/:id': () => json(200, requestDetail({ status: 'done', allowedActions: ['confirm', 'reopen'], version })),
      'POST /app/v1/requests/:id/confirm': () => {
        version = 9;
        return json(409, { code: 'version_conflict', status: 409, title: 'x', type: 'about:blank' });
      },
      'GET /app/v1/categories': () => json(200, CATEGORIES),
      'GET /app/v1/notifications': () => json(200, { items: [], unreadCount: 0 }),
    });
    pressAlertButton('Yes, close it');
    await renderScreen(<RequestDetailScreen />, { fetch: api.fetch, signedIn: true });
    await fireEvent.press(await screen.findByTestId('confirm-fixed'));
    expect(await screen.findByText('This request was updated. Please check again.')).toBeTruthy();
    await waitFor(() => expect(api.calls.filter((c) => c.method === 'GET' && c.path.startsWith('/app/v1/requests/')).length).toBeGreaterThan(1));
  });

  it('Reopen opens the reopen sheet', async () => {
    setParams({ id: 'b7c1e2f0-0000-4000-8000-000000000123' });
    const api = mockFetch({
      'GET /app/v1/requests/:id': () => json(200, requestDetail({ status: 'done', allowedActions: ['confirm', 'reopen'] })),
      'GET /app/v1/categories': () => json(200, CATEGORIES),
      'GET /app/v1/notifications': () => json(200, { items: [], unreadCount: 0 }),
    });
    await renderScreen(<RequestDetailScreen />, { fetch: api.fetch, signedIn: true });
    await fireEvent.press(await screen.findByTestId('reopen'));
    expect(mockRouter.push).toHaveBeenCalledWith('/reopen/b7c1e2f0-0000-4000-8000-000000000123');
  });
});

describe('M-14 submit (R2-AC5: no duplicate on retry)', () => {
  it('reuses the same Idempotency-Key after a failed attempt and shows the success ID', async () => {
    await saveDraft(UNIT, {
      idempotencyKey: '5d1c0e8a-0000-4000-8000-0000000000aa', categoryCode: 'plumbing', description: 'Water leaking under the sink', photos: [], locationKey: 'kitchen',
    });
    let attempt = 0;
    const api = mockFetch({
      'POST /app/v1/units/:u/requests': () => (++attempt === 1
        ? json(503, { code: 'internal_error', status: 503, title: 'x', type: 'about:blank' })
        : json(201, requestDetail({ ref: 'REQ-00124' }))),
      'GET /app/v1/categories': () => json(200, CATEGORIES),
      'GET /app/v1/notifications': () => json(200, { items: [], unreadCount: 0 }),
    });
    await renderScreen(<DraftProvider><Review /></DraftProvider>, { fetch: api.fetch, signedIn: true });
    await fireEvent.press(await screen.findByTestId('submit-request'));
    expect(await screen.findByText(/Your request is saved/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('submit-request'));
    expect(await screen.findByTestId('request-sent')).toBeTruthy();
    expect(screen.getByText(/REQ-00124/)).toBeTruthy();
    const posts = api.calls.filter((c) => c.method === 'POST');
    expect(posts.map((c) => c.headers.get('Idempotency-Key'))).toEqual(['5d1c0e8a-0000-4000-8000-0000000000aa', '5d1c0e8a-0000-4000-8000-0000000000aa']);
    expect(posts[1]!.body).toEqual({ categoryCode: 'plumbing', description: 'Water leaking under the sink', locationInUnit: 'Kitchen' });
  });
});

describe('M-10 Home and M-11 My Requests', () => {
  const summary = (p: object) => ({ ...requestDetail(), timeline: undefined, ...p });

  it('Home shows the one-request action card and the next visit', async () => {
    const api = mockFetch({
      'GET /app/v1/units/:u/requests': () => json(200, {
        items: [
          summary({ id: 'd1', ref: 'REQ-00200', status: 'done' }),
          summary({ id: 'v1', ref: 'REQ-00201', status: 'in_progress', visit: { startAt: '2099-01-01T06:00:00Z', endAt: '2099-01-01T08:00:00Z' } }),
        ],
      }),
      'GET /app/v1/units/:u/announcements': () => json(200, { items: [{ id: 'a1', title: 'Water cut Thursday', body: 'From 9 to 12', sentAt: '2026-11-01T06:00:00Z', isRead: false }] }),
      'GET /app/v1/categories': () => json(200, CATEGORIES),
      'GET /app/v1/notifications': () => json(200, { items: [], unreadCount: 2 }),
    });
    await renderScreen(<Home />, { fetch: api.fetch, signedIn: true });
    const card = await screen.findByTestId('home-action');
    expect(within(card).getByText(/REQ-00200/)).toBeTruthy();
    expect(screen.getByTestId('visit-card')).toBeTruthy();
    expect(screen.getByText('Water cut Thursday')).toBeTruthy();
    expect(api.calls.find((c) => c.path.endsWith('/requests'))!.path).toBe(`/app/v1/units/${UNIT}/requests`);
  });

  it('My Requests: empty Open state, then Closed uses state=closed', async () => {
    const api = mockFetch({
      'GET /app/v1/units/:u/requests': () => json(200, { items: [] }),
      'GET /app/v1/categories': () => json(200, CATEGORIES),
    });
    await renderScreen(<MyRequests />, { fetch: api.fetch, signedIn: true });
    expect(await screen.findByText('No open requests')).toBeTruthy();
    await fireEvent.press(screen.getByText('Closed'));
    expect(await screen.findByText('Closed requests will appear here.')).toBeTruthy();
    const states = api.calls.filter((c) => c.path.endsWith('/requests')).map((c) => new URLSearchParams(c.search).get('state'));
    expect(states).toEqual(['open', 'closed']);
  });

  it('Arabic: status chips and dates use the Arabic vocabulary', async () => {
    const api = mockFetch({
      'GET /app/v1/units/:u/requests': () => json(200, { items: [summary({ status: 'in_progress', reopenCount: 1 })] }),
      'GET /app/v1/categories': () => json(200, CATEGORIES),
    });
    await renderScreen(<MyRequests />, { fetch: api.fetch, signedIn: true, locale: 'ar' });
    expect(await screen.findByText('قيد التنفيذ')).toBeTruthy();
    expect(screen.getByText('أُعيد فتحه ×1')).toBeTruthy();
    expect(screen.getByText('سباكة')).toBeTruthy();
  });
});

afterAll(async () => {
  await act(async () => undefined);
});
