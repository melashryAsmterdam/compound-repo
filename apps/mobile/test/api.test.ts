import { ApiError, createResidentApi, unwrap, type TokenStore } from '@/lib/api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' } });

function memoryTokens(initial: string | null = null): TokenStore & { value: string | null } {
  const s = { value: initial } as TokenStore & { value: string | null };
  s.getRefreshToken = async () => s.value;
  s.setRefreshToken = async (t) => {
    s.value = t;
  };
  return s;
}

const me = { personId: 'p', fullName: 'Noura', locale: 'ar' as const, muteAnnouncements: false, units: [] };
const pair = (n: number) => ({ accessToken: `at${n}`, accessTokenExpiresAt: '2030-01-01T00:00:00Z', refreshToken: `rt${n}`, me });

describe('resident API client', () => {
  it('sends bearer + Accept-Language and maps Problem codes', async () => {
    const calls: Request[] = [];
    const fetch = jest.fn(async (r: Request) => {
      calls.push(r);
      return json(409, { type: 'about:blank', title: 'x', status: 409, code: 'version_conflict' });
    });
    const api = createResidentApi({ baseUrl: 'http://api', tokens: memoryTokens(), getLocale: () => 'en', fetch: fetch as never });
    await api.adopt(pair(1));
    const err = await unwrap(api.client.POST('/app/v1/requests/{requestId}/confirm', { params: { path: { requestId: 'r' } }, body: { expectedVersion: 1 } })).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('version_conflict');
    expect(calls[0]!.headers.get('Authorization')).toBe('Bearer at1');
    expect(calls[0]!.headers.get('Accept-Language')).toBe('en');
  });

  it('rotates the refresh token once on 401 and retries with the new access token', async () => {
    const tokens = memoryTokens('rt1');
    const seen: string[] = [];
    const fetch = jest.fn(async (input: Request | string, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/app/v1/auth/refresh')) {
        expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: 'rt1' });
        return json(200, pair(2));
      }
      const auth = (input as Request).headers.get('Authorization') ?? '';
      seen.push(auth);
      return auth === 'Bearer at2' ? json(200, me) : json(401, { code: 'unauthenticated' });
    });
    const api = createResidentApi({ baseUrl: 'http://api', tokens, getLocale: () => 'ar', fetch: fetch as never });
    const got = await unwrap(api.client.GET('/app/v1/me'));
    expect(got.fullName).toBe('Noura');
    expect(seen).toEqual(['', 'Bearer at2']);
    expect(tokens.value).toBe('rt2');
  });

  it('on session_revoked: clears the refresh token and reports auth lost', async () => {
    const tokens = memoryTokens('rt1');
    const lost = jest.fn();
    const fetch = jest.fn(async (input: Request | string) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/auth/refresh')) return json(401, { code: 'session_revoked' });
      return json(401, { code: 'unauthenticated' });
    });
    const api = createResidentApi({ baseUrl: 'http://api', tokens, getLocale: () => 'ar', onAuthLost: lost, fetch: fetch as never });
    expect(await api.refresh()).toBe(false);
    expect(lost).toHaveBeenCalledWith('session_revoked');
    expect(api.lastRefreshCode()).toBe('session_revoked');
    expect(tokens.value).toBeNull();
  });

  it('turns a network failure into ApiError(0, network_error)', async () => {
    const api = createResidentApi({ baseUrl: 'http://api', tokens: memoryTokens(), getLocale: () => 'ar', fetch: (async () => { throw new TypeError('Network request failed'); }) as never });
    const err = await unwrap(api.client.GET('/app/v1/categories')).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.isNetwork).toBe(true);
  });

  it('only one refresh runs for concurrent 401s', async () => {
    const tokens = memoryTokens('rt1');
    let refreshes = 0;
    const fetch = jest.fn(async (input: Request | string) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/auth/refresh')) {
        refreshes++;
        await new Promise((r) => setTimeout(r, 10));
        return json(200, pair(2));
      }
      return (input as Request).headers.get('Authorization') === 'Bearer at2' ? json(200, []) : json(401, { code: 'unauthenticated' });
    });
    const api = createResidentApi({ baseUrl: 'http://api', tokens, getLocale: () => 'ar', fetch: fetch as never });
    await Promise.all([unwrap(api.client.GET('/app/v1/categories')), unwrap(api.client.GET('/app/v1/categories'))]);
    expect(refreshes).toBe(1);
  });
});
