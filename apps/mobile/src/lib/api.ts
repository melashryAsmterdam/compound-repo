import { createApiClient, type Schemas } from '@compound/api-client';
import type { Locale } from './i18n/types';

export type ResidentMe = Schemas['ResidentMe'];
export type TokenPair = Schemas['TokenPair'];
export type OtpChallenge = Schemas['OtpChallenge'];
export type Problem = Schemas['Problem'];
export type RequestDetail = Schemas['ResidentRequestDetail'];
export type RequestSummary = Schemas['ResidentRequestSummary'];
export type RequestEvent = Schemas['RequestEvent'];
export type Announcement = Schemas['ResidentAnnouncement'];
export type AppNotification = Schemas['Notification'];
export type Category = Schemas['Category'];
export type CategoryCode = Schemas['CategoryCode'];
export type InvitationPreview = Schemas['InvitationPreview'];
export type Photo = Schemas['Photo'];
export type UnitRef = ResidentMe['units'][number];

/** A failed call, carrying the contract's stable Problem.code (clients localise by code). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly problem?: Partial<Problem>,
  ) {
    super(code);
    this.name = 'ApiError';
  }
  get isNetwork() {
    return this.status === 0;
  }
}

/** Codes that end the session or the unit and send the user to M-27 Access revoked. */
export const REVOKE_CODES = new Set(['unit_access_revoked', 'session_revoked', 'no_active_units']);

export interface TokenStore {
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(token: string | null): Promise<void>;
}

export interface ApiOptions {
  baseUrl: string;
  tokens: TokenStore;
  getLocale: () => Locale;
  /** Sent as X-App-Version on every call (contract v1.1). */
  appVersion: string;
  /** Called when any call answers 426 app_update_required (contract v1.1). */
  onUpdateRequired?: () => void;
  /** Called once when refresh fails (session_revoked / refresh_expired) so the app can sign out. */
  onAuthLost?: (code: string) => void;
  fetch?: typeof fetch;
}

const REFRESH_PATH = '/app/v1/auth/refresh';

/**
 * Typed client for /app/v1 generated from the contract. Wraps fetch to add the bearer token
 * (memory only, ADR-012), Accept-Language and X-App-Version, to report 426 app_update_required, and to rotate the refresh token once on 401.
 */
export function createResidentApi(opts: ApiOptions) {
  const baseFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  let accessToken: string | null = null;
  let refreshing: Promise<boolean> | null = null;
  let lastRefreshCode: string | null = null;

  async function refresh(): Promise<boolean> {
    const rt = await opts.tokens.getRefreshToken();
    if (!rt) return false;
    const res = await baseFetch(`${opts.baseUrl}${REFRESH_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': opts.getLocale(), 'X-App-Version': opts.appVersion },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (!res.ok) {
      const p = await readProblem(res);
      if (res.status === 426) opts.onUpdateRequired?.();
      lastRefreshCode = p.code;
      if (res.status === 401) {
        accessToken = null;
        await opts.tokens.setRefreshToken(null);
        opts.onAuthLost?.(p.code);
      }
      return false;
    }
    const pair = (await res.json()) as TokenPair;
    lastRefreshCode = null;
    await adopt(pair);
    return true;
  }

  async function adopt(pair: TokenPair) {
    accessToken = pair.accessToken;
    await opts.tokens.setRefreshToken(pair.refreshToken);
  }

  const authFetch = async (input: Request): Promise<Response> => {
    const retry = input.clone();
    const send = (req: Request) => {
      req.headers.set('Accept-Language', opts.getLocale());
      req.headers.set('X-App-Version', opts.appVersion);
      if (accessToken && !req.headers.has('Authorization')) req.headers.set('Authorization', `Bearer ${accessToken}`);
      return baseFetch(req);
    };
    let res: Response;
    try {
      res = await send(input);
    } catch {
      throw new ApiError(0, 'network_error');
    }
    if (res.status === 426) opts.onUpdateRequired?.();
    if (res.status !== 401 || input.url.endsWith(REFRESH_PATH) || !(await opts.tokens.getRefreshToken())) return res;
    refreshing ??= refresh().finally(() => {
      refreshing = null;
    });
    if (!(await refreshing)) return res;
    retry.headers.delete('Authorization');
    return send(retry);
  };

  const client = createApiClient({ baseUrl: opts.baseUrl, fetch: authFetch });

  return {
    client,
    adopt,
    refresh,
    clear: async () => {
      accessToken = null;
      await opts.tokens.setRefreshToken(null);
    },
    getAccessToken: () => accessToken,
    /** Headers for calls made outside openapi-fetch (the SSE stream). Bearer only ever in a header (B6). */
    authHeaders: (): Record<string, string> => ({
      'Accept-Language': opts.getLocale(),
      'X-App-Version': opts.appVersion,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    }),
    lastRefreshCode: () => lastRefreshCode,
    hasRefreshToken: async () => Boolean(await opts.tokens.getRefreshToken()),
  };
}

export type ResidentApi = ReturnType<typeof createResidentApi>;

async function readProblem(res: Response): Promise<Problem> {
  try {
    const body = (await res.json()) as Partial<Problem>;
    return { type: 'about:blank', title: '', status: res.status, code: body.code ?? codeFromStatus(res.status), ...body } as Problem;
  } catch {
    return { type: 'about:blank', title: '', status: res.status, code: codeFromStatus(res.status) };
  }
}

function codeFromStatus(status: number): string {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  return status >= 500 ? 'internal_error' : 'validation_failed';
}

/** Turn an openapi-fetch result into data or a thrown ApiError. */
export async function unwrap<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await p;
  if (response.ok) return data as T;
  const body = (error ?? {}) as Partial<Problem>;
  throw new ApiError(response.status, body.code ?? codeFromStatus(response.status), body);
}
