'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { AuthCard } from '@/components/auth-card';
import { useI18n } from '@/lib/i18n';

function Expired() {
  const { t } = useI18n();
  const next = useSearchParams().get('next') ?? '/requests';
  return (
    <AuthCard title={t('sys.expired')}>
      <Link href={`/sign-in?next=${encodeURIComponent(next)}`} className="block rounded-md bg-accent px-4 py-2 text-center text-accent-ink">
        {t('sys.signInAgain')}
      </Link>
    </AuthCard>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Expired />
    </Suspense>
  );
}
