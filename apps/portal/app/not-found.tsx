'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/i18n';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-lg">{t('sys.notFound')}</p>
      <Link href="/requests" className="rounded-md bg-accent px-4 py-2 text-accent-ink">
        {t('sys.goRequests')}
      </Link>
    </main>
  );
}
