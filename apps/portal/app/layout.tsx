import type { Metadata } from 'next';
import { IBM_Plex_Sans_Arabic } from 'next/font/google';
import { cookies, headers } from 'next/headers';
import type { ReactNode } from 'react';
import type { Locale } from '@compound/i18n';
import { Providers } from './providers';
import './globals.css';

const plex = IBM_Plex_Sans_Arabic({ subsets: ['arabic', 'latin'], weight: ['400', '500', '600', '700'], variable: '--font-plex-arabic', display: 'swap' });

export const metadata: Metadata = { title: 'Compound Admin', robots: { index: false, follow: false } };

/** Arabic is the default; the choice is a cookie, not a URL prefix (spec §2.2). */
async function resolveLocale(): Promise<Locale> {
  const c = (await cookies()).get('cs_locale')?.value;
  if (c === 'ar' || c === 'en') return c;
  const accept = (await headers()).get('accept-language') ?? '';
  return /^en\b/i.test(accept) && !/\bar\b/i.test(accept.split(',')[0] ?? '') ? 'en' : 'ar';
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await resolveLocale();
  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} className={plex.variable}>
      <body className="min-h-dvh antialiased">
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
