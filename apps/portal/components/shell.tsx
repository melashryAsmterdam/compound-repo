'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { parseRequestRef, toWesternDigits } from '@compound/domain';
import { Button, Dialog, Skeleton, cx } from '@/components/ui';
import { get, post, qs, setCsrf, setUnauthenticatedHandler, type AdminRequestSummary } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { closeLive, useLiveStatus } from '@/lib/live';
import { useCounters, useLiveInvalidation, useMe } from '@/lib/queries';

const IDLE_MS = 30 * 60_000;
const WARN_MS = 28 * 60_000;

function NavLink({ href, label, badge }: { href: string; label: string; badge?: number }) {
  const active = usePathname().startsWith(href);
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={cx('flex min-h-10 items-center justify-between rounded-md px-3 text-sm', active ? 'bg-accent text-accent-ink' : 'hover:bg-canvas')}>
      <span>{label}</span>
      {badge ? <span className={cx('rounded-full px-2 text-xs', active ? 'bg-white/20' : 'bg-danger text-white')}>{badge}</span> : null}
    </Link>
  );
}

/** P-05: header, side navigation (start side), live status, idle-timeout warning. */
export function Shell({ children }: { children: ReactNode }) {
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();
  const counters = useCounters();
  const live = useLiveStatus();
  useLiveInvalidation();
  const [search, setSearch] = useState('');
  const [menu, setMenu] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [warnLeft, setWarnLeft] = useState<number | null>(null);
  const lastActive = useRef(Date.now());

  const expire = useCallback(() => {
    closeLive();
    setCsrf(null);
    router.replace(`/session-expired?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }, [router]);

  useEffect(() => setUnauthenticatedHandler(expire), [expire]);

  // Idle tracking: server idle timeout is 30 min; warn at 28 (spec P-05).
  useEffect(() => {
    const bump = () => {
      if (warnLeft === null) lastActive.current = Date.now();
    };
    const events = ['keydown', 'pointerdown', 'scroll'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const i = setInterval(() => {
      const idle = Date.now() - lastActive.current;
      if (idle >= IDLE_MS) expire();
      else if (idle >= WARN_MS) setWarnLeft(IDLE_MS - idle);
    }, 1000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(i);
    };
  }, [expire, warnLeft]);

  useEffect(() => setNavOpen(false), [pathname]);

  async function stay() {
    await get('/admin/v1/me').catch(() => undefined);
    lastActive.current = Date.now();
    setWarnLeft(null);
  }

  async function signOut() {
    await post('/admin/v1/auth/logout').catch(() => undefined);
    closeLive();
    setCsrf(null);
    router.replace('/sign-in');
  }

  /** Enter: exact REQ- match opens the request; else the dashboard with the text as search. */
  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = toWesternDigits(search.trim());
    if (!q) return;
    if (/^req/i.test(q) && parseRequestRef(q) !== null) {
      const r = await get<{ items: AdminRequestSummary[] }>(`/admin/v1/requests${qs({ q, limit: 1 })}`).catch(() => null);
      if (r?.items[0]) return router.push(`/requests/${r.items[0].ref}`);
    }
    router.push(`/requests${qs({ q })}`);
  }

  const compound = me.data?.compound;
  const badge = counters.data ? counters.data.new + counters.data.reopened : undefined;
  const mm = warnLeft !== null ? `${Math.floor(warnLeft / 60000)}:${String(Math.floor((warnLeft % 60000) / 1000)).padStart(2, '0')}` : '';

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface px-4 py-2">
        <Button variant="ghost" className="lg:hidden" aria-label={t('nav.menu')} onClick={() => setNavOpen((o) => !o)}>
          ☰
        </Button>
        <div className="flex min-w-0 items-center gap-2">
          {compound?.logoUrl ? <img src={compound.logoUrl} alt="" className="size-8 rounded object-cover" /> : <div className="size-8 rounded bg-canvas" aria-hidden />}
          {compound ? <span className="truncate font-semibold">{locale === 'ar' ? compound.nameAr : compound.nameEn}</span> : <Skeleton className="h-4 w-32" />}
        </div>
        <form onSubmit={onSearch} className="ms-auto hidden max-w-sm flex-1 md:block" role="search">
          <input
            type="search"
            aria-label={t('nav.globalSearch')}
            placeholder={t('nav.globalSearch')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-h-9 w-full rounded-md border border-line bg-canvas px-3 text-sm"
          />
        </form>
        {!live && (
          <span className="flex items-center gap-1 text-xs text-warning" role="status">
            <span className="size-2 rounded-full bg-warning" aria-hidden />
            <span className="hidden sm:inline">{t('nav.livePaused')}</span>
          </span>
        )}
        <Button variant="ghost" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')} lang={locale === 'ar' ? 'en' : 'ar'}>
          {t('lang.switch')}
        </Button>
        <div className="relative">
          <Button variant="ghost" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            {me.data?.fullName ?? '…'}
          </Button>
          {menu && (
            <div role="menu" className="absolute end-0 top-full z-40 mt-1 flex w-48 flex-col rounded-md border border-line bg-surface p-1 shadow-lg">
              <Link role="menuitem" href="/settings?tab=account" className="rounded px-3 py-2 text-sm hover:bg-canvas" onClick={() => setMenu(false)}>
                {t('nav.myAccount')}
              </Link>
              <button role="menuitem" className="rounded px-3 py-2 text-start text-sm hover:bg-canvas" onClick={signOut}>
                {t('nav.signOut')}
              </button>
            </div>
          )}
        </div>
      </header>
      <div className="flex flex-1">
        <nav aria-label={t('nav.menu')} className={cx('w-56 shrink-0 flex-col gap-1 border-e border-line bg-surface p-3', navOpen ? 'fixed inset-y-14 start-0 z-20 flex' : 'hidden lg:flex')}>
          <NavLink href="/requests" label={t('nav.requests')} badge={badge} />
          <NavLink href="/units" label={t('nav.units')} />
          <NavLink href="/announcements" label={t('nav.announcements')} />
          <NavLink href="/settings" label={t('nav.settings')} />
        </nav>
        <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
      </div>
      <Dialog
        open={warnLeft !== null}
        onClose={stay}
        title={t('session.warn', { time: mm })}
        footer={
          <>
            <Button onClick={signOut}>{t('nav.signOut')}</Button>
            <Button variant="primary" onClick={stay}>
              {t('session.stay')}
            </Button>
          </>
        }
      >
        <span />
      </Dialog>
    </div>
  );
}
