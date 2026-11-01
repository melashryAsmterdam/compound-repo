'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import type { Locale } from '@compound/i18n';
import { ToastProvider } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { LocaleProvider } from '@/lib/i18n';

export function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: true,
            retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
          },
        },
      }),
  );
  return (
    <LocaleProvider locale={locale}>
      <QueryClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    </LocaleProvider>
  );
}
