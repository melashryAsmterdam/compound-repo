import { cookies } from 'next/headers';
import { PORTAL, type Locale } from '@compound/i18n';

/** Fallback for request deep links in SMS (go.<domain>/r/<id>) when the app does not open. */
export default async function RequestLink() {
  const locale: Locale = (await cookies()).get('cs_locale')?.value === 'en' ? 'en' : 'ar';
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <p>{PORTAL[locale]['invite.install']}</p>
    </main>
  );
}
