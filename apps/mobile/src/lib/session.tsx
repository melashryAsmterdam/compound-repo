import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as Updates from 'expo-updates';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DevSettings, I18nManager, Platform } from 'react-native';
import { createResidentApi, REVOKE_CODES, unwrap, type ResidentApi, type ResidentMe, type TokenPair, type UnitRef } from './api';
import { API_URL, APP_VERSION } from './config';
import { currentLocale, i18n, isRtl, type Locale } from './i18n';
import { clearPersonalData, readPrefs, secureTokenStore, writePrefs } from './storage';

export type SessionStatus = 'booting' | 'signedOut' | 'signedIn';
export interface RevokeNotice {
  unitLabel?: string;
  phone?: string;
}

interface SessionValue {
  api: ResidentApi;
  status: SessionStatus;
  me: ResidentMe | null;
  unit: UnitRef | null;
  locale: Locale;
  revoked: RevokeNotice | null;
  /** M-01 step 5: try the stored refresh token. Returns where to go. */
  restore(): Promise<'signedIn' | 'signedOut' | 'revoked' | 'offline'>;
  adoptTokens(pair: TokenPair): Promise<void>;
  refreshMe(): Promise<ResidentMe | null>;
  selectUnit(unitId: string): Promise<void>;
  setLocale(locale: Locale): Promise<{ restarting: boolean }>;
  signOut(opts?: { remote?: boolean }): Promise<void>;
  /** Any screen that sees unit_access_revoked / session_revoked calls this. */
  handleRevoke(code: string): Promise<void>;
  clearRevoked(): void;
}

const Ctx = createContext<SessionValue | null>(null);

export function unitLabel(u: Pick<UnitRef, 'number' | 'block'> | null | undefined): string {
  if (!u) return '';
  return u.block && !u.number?.startsWith(u.block) ? `${u.block}-${u.number}` : (u.number ?? '');
}

export function SessionProvider({ children, api: injected }: { children: ReactNode; api?: ResidentApi }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>('booting');
  const [me, setMe] = useState<ResidentMe | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [locale, setLocaleState] = useState<Locale>(currentLocale());
  const [revoked, setRevoked] = useState<RevokeNotice | null>(null);
  const onAuthLost = useRef<(code: string) => void>(() => {});

  const api = useMemo(
    () =>
      injected ??
      createResidentApi({
        baseUrl: API_URL,
        tokens: secureTokenStore,
        getLocale: currentLocale,
        appVersion: APP_VERSION,
        // Any call answering 426 sends the person to M-27 Update required (contract v1.1).
        onUpdateRequired: () => router.replace('/update-required'),
        onAuthLost: (code) => onAuthLost.current(code),
      }),
    [injected],
  );

  const applyMe = useCallback(async (next: ResidentMe) => {
    setMe(next);
    const prefs = await readPrefs();
    const ids = next.units.map((u) => u.unitId);
    const chosen = prefs.unitId && ids.includes(prefs.unitId) ? prefs.unitId : (ids[0] ?? null);
    setUnitId(chosen);
    if (chosen !== prefs.unitId) await writePrefs({ unitId: chosen ?? undefined });
    return next;
  }, []);

  const refreshMe = useCallback(async () => {
    const next = await unwrap(api.client.GET('/app/v1/me'));
    const prevIds = new Set(me?.units.map((u) => u.unitId) ?? []);
    const lost = me?.units.filter((u) => !next.units.some((n) => n.unitId === u.unitId)) ?? [];
    await applyMe(next);
    if (prevIds.size && lost.length && next.units.length) {
      // Another unit remains: drop the lost one with a notice instead of the full revoke screen (M-27).
      setRevoked({ unitLabel: unitLabel(lost[0]), phone: lost[0]?.compound?.contactPhone });
    }
    return next;
  }, [api, applyMe, me]);

  const signOut = useCallback(
    async ({ remote = true }: { remote?: boolean } = {}) => {
      if (remote && api.getAccessToken()) await api.client.POST('/app/v1/auth/logout').catch(() => undefined);
      await api.clear();
      await clearPersonalData();
      qc.clear();
      setMe(null);
      setUnitId(null);
      setStatus('signedOut');
    },
    [api, qc],
  );

  const handleRevoke = useCallback(
    async (code: string) => {
      const u = me?.units.find((x) => x.unitId === unitId);
      if (code === 'unit_access_revoked' && me && me.units.length > 1) {
        // Re-read the profile: if other units remain we only drop this one.
        try {
          const next = await refreshMe();
          if (next.units.length) return;
        } catch {
          /* fall through to full revoke */
        }
      }
      setRevoked({ unitLabel: unitLabel(u), phone: u?.compound?.contactPhone });
      await signOut({ remote: false });
    },
    [me, unitId, refreshMe, signOut],
  );

  onAuthLost.current = (code) => {
    if (code === 'session_revoked') void handleRevoke(code);
    else void signOut({ remote: false });
  };

  const restore = useCallback(async () => {
    if (!(await api.hasRefreshToken())) {
      setStatus('signedOut');
      return 'signedOut' as const;
    }
    try {
      const ok = await api.refresh();
      if (!ok) {
        setStatus('signedOut');
        return api.lastRefreshCode() === 'session_revoked' ? ('revoked' as const) : ('signedOut' as const);
      }
      await refreshMe();
      setStatus('signedIn');
      return 'signedIn' as const;
    } catch {
      // Network down with a stored session: open from cache with the offline banner (M-01 states).
      setStatus('signedIn');
      return 'offline' as const;
    }
  }, [api, refreshMe]);

  const adoptTokens = useCallback(
    async (pair: TokenPair) => {
      await api.adopt(pair);
      await applyMe(pair.me);
      setRevoked(null);
      setStatus('signedIn');
    },
    [api, applyMe],
  );

  const selectUnit = useCallback(async (id: string) => {
    setUnitId(id);
    await writePrefs({ unitId: id });
  }, []);

  const setLocale = useCallback(
    async (next: Locale) => {
      await i18n.changeLanguage(next);
      setLocaleState(next);
      await writePrefs({ locale: next });
      if (status === 'signedIn') {
        await unwrap(api.client.PATCH('/app/v1/me', { body: { locale: next } })).then(setMe).catch(() => undefined);
      }
      const restarting = applyDirection(next);
      return { restarting };
    },
    [api, status],
  );

  // Revoke codes surfacing from any query/mutation.
  useEffect(() => {
    const unsub = qc.getQueryCache().subscribe((e) => {
      const err = e.query.state.error as { code?: string } | null;
      if (e.type === 'updated' && err?.code && REVOKE_CODES.has(err.code)) void handleRevoke(err.code);
    });
    return unsub;
  }, [qc, handleRevoke]);

  const unit = me?.units.find((u) => u.unitId === unitId) ?? null;

  const value: SessionValue = {
    api,
    status,
    me,
    unit,
    locale,
    revoked,
    restore,
    adoptTokens,
    refreshMe,
    selectUnit,
    setLocale,
    signOut,
    handleRevoke,
    clearRevoked: () => setRevoked(null),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

/**
 * Apply layout direction for the locale. RN needs a reload for a direction change (Expo localization
 * guide); returns true when a reload was triggered.
 */
export function applyDirection(locale: Locale): boolean {
  const rtl = isRtl(locale);
  if (Platform.OS === 'web' || I18nManager.isRTL === rtl) return false;
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  setTimeout(() => {
    Updates.reloadAsync().catch(() => DevSettings.reload());
  }, 600);
  return true;
}
