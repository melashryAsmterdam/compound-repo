'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { toWesternDigits } from '@compound/domain';
import { AuthCard } from '@/components/auth-card';
import { Bdi, Button, Field, Input } from '@/components/ui';
import { ApiError, api, setCsrf, type Schemas } from '@/lib/api';
import { useErrorText, useI18n } from '@/lib/i18n';

function Verify() {
  const { t } = useI18n();
  const err = useErrorText();
  const router = useRouter();
  const next = useSearchParams().get('next') ?? '/requests';
  const [ch, setCh] = useState<Schemas['OtpChallenge'] | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const raw = sessionStorage.getItem('cs_mfa');
    if (!raw) router.replace('/sign-in');
    else setCh(JSON.parse(raw));
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [router]);

  async function verify(value: string) {
    if (!ch || value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ csrfToken: string }>('POST', '/admin/v1/auth/mfa/verify', { challengeId: ch.challengeId, code: value }, { auth: false });
      setCsrf(r.csrfToken);
      sessionStorage.removeItem('cs_mfa');
      // Only same-origin paths (no open redirect).
      router.replace(next.startsWith('/') && !next.startsWith('//') ? next : '/requests');
    } catch (x) {
      setError(err((x as ApiError).code));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!ch) return;
    try {
      const r = await api<Schemas['OtpChallenge']>('POST', '/admin/v1/auth/mfa/resend', { challengeId: ch.challengeId }, { auth: false });
      setCh(r);
      sessionStorage.setItem('cs_mfa', JSON.stringify(r));
      setError(null);
    } catch (x) {
      setError(err((x as ApiError).code));
    }
  }

  const wait = ch?.resendAvailableAt ? Math.max(0, Math.ceil((new Date(ch.resendAvailableAt).getTime() - now) / 1000)) : 0;

  return (
    <AuthCard title={t('auth.mfaTitle')}>
      {ch && (
        <p className="mb-4 text-sm text-muted">
          {t('auth.mfaSent', { dest: '' })}
          <Bdi>{ch.maskedDestination}</Bdi>
        </p>
      )}
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void verify(code);
        }}
      >
        <Field label={t('auth.code')} htmlFor="code" error={error}>
          <Input
            id="code"
            dir="ltr"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
            className="text-center font-mono text-2xl tracking-[0.5em]"
            value={code}
            aria-invalid={!!error}
            onChange={(e) => {
              const v = toWesternDigits(e.target.value).replace(/\D/g, '').slice(0, 6);
              setCode(v);
              if (v.length === 6) void verify(v); // auto-submit on 6 digits
            }}
          />
        </Field>
        <Button type="submit" variant="primary" busy={busy} disabled={code.length !== 6}>
          {t('auth.verify')}
        </Button>
        <Button type="button" variant="ghost" onClick={resend} disabled={wait > 0 || ch?.resendsRemaining === 0}>
          {wait > 0 ? t('auth.resendIn', { s: wait }) : t('auth.resend')}
        </Button>
        <Link href="/sign-in" className="text-center text-sm text-accent underline">
          {t('auth.backToSignIn')}
        </Link>
      </form>
    </AuthCard>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
