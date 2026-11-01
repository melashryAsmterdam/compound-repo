import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import { useEffect, type ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider } from '@/components/Toast';
import { createResidentApi, type ResidentMe } from '@/lib/api';
import { i18n, type Locale } from '@/lib/i18n';
import { SessionProvider, useSession } from '@/lib/session';

export type Route = (req: Request) => Response | Promise<Response> | undefined;

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' } });

export const ME: ResidentMe = {
  personId: '9f1c1d7e-0000-4000-8000-000000000001',
  fullName: 'نورة العتيبي',
  phone: '+966551234567',
  email: null,
  locale: 'ar',
  muteAnnouncements: false,
  units: [{
    unitId: '7a9e0000-0000-4000-8000-000000000014', number: '14', block: 'B',
    compound: { id: 'c0000000-0000-4000-8000-000000000001', nameAr: 'مجمع النرجس', nameEn: 'Narjis Compound', contactPhone: '+966112345678', timezone: 'Asia/Riyadh' },
  }],
};

/** A fetch that dispatches to `routes` by "METHOD /path" and records every call. */
export function mockFetch(routes: Record<string, (req: Request, body: unknown) => Response | Promise<Response>>) {
  const calls: { method: string; path: string; search: string; headers: Headers; body: unknown }[] = [];
  const fn = async (input: Request | string, init?: RequestInit) => {
    const req = typeof input === 'string' ? new Request(input, init) : input;
    const url = new URL(req.url);
    const text = req.method === 'GET' ? '' : await req.clone().text();
    const body = text ? JSON.parse(text) : undefined;
    calls.push({ method: req.method, path: url.pathname, search: url.search, headers: req.headers, body });
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(' ');
      const re = new RegExp(`^${p!.replace(/:[a-zA-Z]+/g, '[^/]+')}$`);
      return m === req.method && re.test(url.pathname);
    });
    if (!key) return json(404, { code: 'not_found', status: 404, title: 'nf', type: 'about:blank' });
    return routes[key]!(req, body);
  };
  return { fetch: fn, calls };
}

function SignedIn({ me, children }: { me: ResidentMe; children: ReactElement }) {
  const { adoptTokens, status } = useSession();
  useEffect(() => {
    void adoptTokens({ accessToken: 'at', accessTokenExpiresAt: '2030-01-01T00:00:00Z', refreshToken: 'rt', me });
  }, [adoptTokens, me]);
  return status === 'signedIn' ? children : <></>;
}

export async function renderScreen(ui: ReactElement, opts: { fetch: ReturnType<typeof mockFetch>['fetch']; signedIn?: boolean; locale?: Locale; me?: ResidentMe }) {
  void i18n.changeLanguage(opts.locale ?? 'en');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  const tokens = { value: null as string | null, getRefreshToken: async () => tokens.value, setRefreshToken: async (t: string | null) => void (tokens.value = t) };
  const api = createResidentApi({ baseUrl: 'http://api.test', appVersion: '1.0.0', tokens, getLocale: () => (i18n.language as Locale), fetch: opts.fetch as never });
  const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
  const tree = (
    <SafeAreaProvider initialMetrics={metrics}>
      <QueryClientProvider client={qc}>
        <SessionProvider api={api}>
          <ToastProvider>{opts.signedIn ? <SignedIn me={opts.me ?? ME}>{ui}</SignedIn> : ui}</ToastProvider>
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
  const r = await render(tree);
  return { ...r, qc, api };
}
