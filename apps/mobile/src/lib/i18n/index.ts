import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ar } from './ar';
import { en } from './en';
import { DEFAULT_LOCALE, type Locale } from './types';

export * from './types';

export const resources = { ar: { translation: ar }, en: { translation: en } } as const;

void i18next.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LOCALE,
  fallbackLng: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export const i18n = i18next;

export function currentLocale(): Locale {
  return i18next.language === 'en' ? 'en' : 'ar';
}

/** Problem.code → localised message, falling back to the generic error (screen spec §1.4). */
export function errorText(code: string | undefined): string {
  const key = `errors.${code ?? 'internal_error'}`;
  return i18next.exists(key) ? i18next.t(key) : i18next.t('errors.internal_error');
}
