'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';

/** P-01…P-04 frame: centred card, language switch at the top end corner. */
export function AuthCard({ title, children }: { title: ReactNode; children: ReactNode }) {
  const { t, locale, setLocale } = useI18n();
  return (
    <main className="relative flex min-h-dvh items-center justify-center p-4">
      <button className="absolute end-4 top-4 rounded px-2 py-1 text-sm hover:bg-surface" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')} lang={locale === 'ar' ? 'en' : 'ar'}>
        {t('lang.switch')}
      </button>
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 shadow-sm">
        <p className="mb-1 text-sm text-muted">{t('app.name')}</p>
        <h1 className="mb-5 text-xl font-semibold">{title}</h1>
        {children}
      </div>
    </main>
  );
}
