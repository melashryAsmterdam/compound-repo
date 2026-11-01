'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthCard } from '@/components/auth-card';
import { Button, Field, Input, useToast } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useErrorText, useI18n } from '@/lib/i18n';

function Reset() {
  const { t } = useI18n();
  const err = useErrorText();
  const toast = useToast();
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const long = pw.length >= 12;
  const match = pw.length > 0 && pw === pw2;

  return (
    <AuthCard title={t('auth.newPassword')}>
      {expired ? (
        <p role="alert" className="text-sm">
          {t('auth.linkExpired')}{' '}
          <Link className="text-accent underline" href="/forgot-password">
            {t('auth.forgotTitle')}
          </Link>
        </p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api('POST', '/admin/v1/auth/password/reset', { token, newPassword: pw }, { auth: false });
              toast(t('auth.passwordChanged'));
              router.replace('/sign-in');
            } catch (x) {
              const c = (x as ApiError).code;
              if (c === 'reset_token_invalid') setExpired(true);
              else setError(err(c));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label={t('auth.newPassword')} htmlFor="pw" error={error}>
            <Input id="pw" type="password" dir="ltr" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <Field label={t('auth.confirmPassword')} htmlFor="pw2">
            <Input id="pw2" type="password" dir="ltr" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </Field>
          <ul className="text-sm">
            <li className={long ? 'text-success' : 'text-muted'}>{long ? '✓' : '○'} {t('auth.rule12')}</li>
            <li className={match ? 'text-success' : 'text-muted'}>{match ? '✓' : '○'} {t('auth.ruleMatch')}</li>
            <li className="text-muted">○ {t('auth.ruleBreach')}</li>
          </ul>
          <Button type="submit" variant="primary" busy={busy} disabled={!long || !match}>
            {t('auth.savePassword')}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Reset />
    </Suspense>
  );
}
