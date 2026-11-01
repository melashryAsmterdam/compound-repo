'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AuthCard } from '@/components/auth-card';
import { Button, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function ForgotPassword() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <AuthCard title={t('auth.forgotTitle')}>
      {sent ? (
        <p role="status" className="mb-4 text-sm">
          {t('auth.resetSent')}
        </p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            await api('POST', '/admin/v1/auth/password/forgot', { email }, { auth: false }).catch(() => undefined);
            setBusy(false);
            setSent(true); // same message whatever the outcome (no enumeration)
          }}
        >
          <Field label={t('auth.email')} htmlFor="email">
            <Input id="email" type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" busy={busy} disabled={!email}>
            {t('auth.sendReset')}
          </Button>
        </form>
      )}
      <Link href="/sign-in" className="mt-4 block text-center text-sm text-accent underline">
        {t('auth.backToSignIn')}
      </Link>
    </AuthCard>
  );
}
