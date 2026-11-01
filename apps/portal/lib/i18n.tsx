'use client';

import { PORTAL, errorMessage, fill, type Locale, type PortalKey } from '@compound/i18n';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

export const LOCALE_COOKIE = 'cs_locale';

type T = (key: PortalKey, params?: Record<string, string | number>) => string;
const Ctx = createContext<{ locale: Locale; t: T; dir: 'rtl' | 'ltr'; setLocale: (l: Locale) => void } | null>(null);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const t = useCallback<T>((key, params) => fill(PORTAL[locale][key] ?? PORTAL.en[key] ?? key, params ?? {}), [locale]);
  const setLocale = useCallback((l: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  }, []);
  const value = useMemo(() => ({ locale, t, dir: (locale === 'ar' ? 'rtl' : 'ltr') as 'rtl' | 'ltr', setLocale }), [locale, t, setLocale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error('LocaleProvider missing');
  return v;
}

/** Problem.code → localised message (screen spec §1.4). */
export function useErrorText() {
  const { locale } = useI18n();
  return (code: string | undefined) => errorMessage(code ?? 'internal_error', locale);
}
