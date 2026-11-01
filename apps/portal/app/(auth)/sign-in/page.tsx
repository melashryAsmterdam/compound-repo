'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AuthCard } from '@/components/auth-card';
import { Button, Field, Input } from '@/components/ui';
import { ApiError, api, type Schemas } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { useErrorText, useI18n } from '@/lib/i18n';

function SignIn() {
  const { t, locale } = useI18n();
  const err = useErrorText();
  const router = useRouter();
  const next = useSearchParams().get('next') ?? '/requests';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const ch = await api<Schemas['OtpChallenge']>('POST', '/admin/v1/auth/login', { email, password }, { auth: false });
      sessionStorage.setItem('cs_mfa', JSON.stringify(ch));
      router.push(`/verify?next=${encodeURIComponent(next)}`);
    } catch (x) {
      const e2 = x as ApiError;
      if (e2.code === 'account_locked' && typeof e2.body.lockedUntil === 'string') setError(t('auth.lockedUntil', { time: formatTime(new Date(e2.body.lockedUntil), locale) }));
      else setError(err(e2.code));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t('auth.signIn')}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label={t('auth.email')} htmlFor="email">
          <Input id="email" type="email" dir="ltr" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t('auth.password')} htmlFor="password">
          <div className="flex gap-2">
            <Input id="password" type={show ? 'text' : 'password'} dir="ltr" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            <Button type="button" variant="ghost" onClick={() => setShow((s) => !s)} aria-pressed={show}>
              {show ? t('auth.hide') : t('auth.show')}
            </Button>
          </div>
        </Field>
        {error && (
          <p role="alert" className="rounded-md bg-danger-bg p-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" busy={busy} disabled={!email || !password}>
          {t('auth.signIn')}
        </Button>
        <Link href="/forgot-password" className="text-center text-sm text-accent underline">
          {t('auth.forgot')}
        </Link>
      </form>
    </AuthCard>
  );
}

export default function Page() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
