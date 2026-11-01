import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import QRCode from 'qrcode';
import { PORTAL, fill, type Locale } from '@compound/i18n';
import type { Schemas } from '@compound/api-client';
import { serverGet } from '@/lib/server-api';
import { CopyLink } from './copy-link';
import { DEFAULT_APP_STORE_URL, playStoreLink } from '@/lib/store-links';

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' };


/** W-01 invite landing / W-02 invite not valid. No analytics; token never shown as text. */
export default async function InviteLanding({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const cookieLocale = (await cookies()).get('cs_locale')?.value;
  const locale: Locale = cookieLocale === 'en' ? 'en' : 'ar';
  const t = (k: keyof (typeof PORTAL)['en'], p: Record<string, string | number> = {}) => fill(PORTAL[locale][k], p);
  const ua = h.get('user-agent') ?? '';
  const os = /iPhone|iPad|iPod/i.test(ua) ? 'ios' : /Android/i.test(ua) ? 'android' : 'desktop';
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const link = `${proto}://${h.get('host')}/a/${token}`;
  const r = await serverGet<Schemas['InvitationPreview']>(`/app/v1/invitations/${encodeURIComponent(token)}`, locale);

  if (!r.ok) {
    const code = r.body?.code as string | undefined;
    const msg = code === 'invitation_expired' ? t('invite.expired') : code === 'invitation_used' ? t('invite.used') : t('invite.revoked');
    const phone = r.body?.compoundContactPhone as string | undefined;
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-xl font-semibold">{msg}</h1>
        <p>{t('invite.askResend')}</p>
        {phone && (
          <a href={`tel:${phone}`} className="rounded-md bg-accent px-4 py-2 text-accent-ink">
            {t('invite.call', { phone: '' })}
            <bdi dir="ltr">{phone}</bdi>
          </a>
        )}
      </main>
    );
  }

  const inv = r.data;
  const first = inv.fullName.split(/\s+/)[0] ?? inv.fullName;
  const qr = os === 'desktop' ? await QRCode.toDataURL(link, { margin: 1, width: 220 }) : null;
  const stores = [
    { key: 'ios', href: process.env.APP_STORE_URL || DEFAULT_APP_STORE_URL, label: t('invite.appStore') },
    { key: 'android', href: playStoreLink(token), label: t('invite.playStore') },
  ].sort((a) => (a.key === os ? -1 : 1));

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 p-6 text-center">
      {inv.compoundLogoUrl && <img src={inv.compoundLogoUrl} alt="" className="size-16 rounded-lg object-cover" />}
      <h1 className="text-2xl font-semibold">{t('invite.welcome', { name: first })}</h1>
      <p>
        {fill(PORTAL[locale]['invite.intro'], { compound: locale === 'ar' ? inv.compoundNameAr : inv.compoundNameEn, unit: inv.unitNumber })}
      </p>
      <p className="text-muted">{t('invite.install')}</p>
      <div className="flex flex-col gap-2" dir="ltr">
        {stores.map((s) => (
          <a key={s.key} href={s.href} className="rounded-lg bg-ink px-5 py-3 text-white" rel="noreferrer">
            {s.label}
          </a>
        ))}
      </div>
      <p className="text-sm text-muted">{t('invite.afterInstall')}</p>
      <CopyLink link={link} label={t('invite.copy')} done={t('invite.copied')} />
      {qr && (
        <figure className="flex flex-col items-center gap-2">
          <img src={qr} alt="" width={220} height={220} className="rounded border border-line bg-white p-2" />
          <figcaption className="text-sm text-muted">{t('invite.scan')}</figcaption>
        </figure>
      )}
    </main>
  );
}
