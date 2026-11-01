'use client';

import { useI18n } from '@/lib/i18n';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-lg">{t('sys.error')}</p>
      <button onClick={reset} className="rounded-md bg-accent px-4 py-2 text-accent-ink">
        {t('common.retry')}
      </button>
      {error.digest && <p className="text-xs text-muted">{t('common.reference', { id: error.digest })}</p>}
    </main>
  );
}
