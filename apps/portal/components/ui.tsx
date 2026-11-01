'use client';

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { useI18n } from '@/lib/i18n';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/** LTR isolate for IDs, unit numbers, phones (spec §1.1). */
export function Bdi({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={className}>
      {children}
    </bdi>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ variant = 'secondary', busy, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-accent text-accent-ink hover:bg-accent-hover',
    secondary: 'bg-surface border border-line hover:bg-canvas',
    ghost: 'hover:bg-canvas',
    danger: 'bg-danger text-white hover:opacity-90',
  };
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={cx('inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50', styles[variant], className)}
    >
      {busy && <span className="size-3 animate-spin rounded-full border-2 border-current border-e-transparent" aria-hidden />}
      {children}
    </button>
  );
}

export function Field({ label, error, hint, children, htmlFor }: { label: ReactNode; error?: string | null; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const control = 'min-h-9 w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm aria-[invalid=true]:border-danger';

export function Input(props: InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) {
  return <input {...props} className={cx(control, props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: React.Ref<HTMLTextAreaElement> }) {
  return <textarea {...props} className={cx(control, 'min-h-24', props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(control, props.className)} />;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-lg border border-line bg-surface p-4', className)}>{children}</section>;
}

const CHIP: Record<string, string> = {
  // Request statuses: Saha tokens color.status.
  new: 'bg-status-new-bg text-status-new',
  in_progress: 'bg-status-in-progress-bg text-status-in-progress',
  done: 'border border-status-done-border text-status-done',
  closed: 'bg-status-closed-bg text-status-closed',
  cancelled: 'border border-status-cancelled-border bg-status-cancelled-bg text-status-cancelled',
  reopened: 'bg-status-reopened-bg text-status-reopened',
  active: 'bg-success-bg text-success',
  invited: 'bg-info-bg text-info',
  failed: 'bg-danger-bg text-danger',
  expired: 'bg-warning-bg text-warning',
  not_invited: 'bg-neutral-bg text-muted',
  danger: 'bg-danger-bg text-danger',
  neutral: 'bg-neutral-bg text-muted',
};
export function Chip({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', CHIP[tone] ?? CHIP.neutral)}>{children}</span>;
}

export function Skeleton({ className }: { className?: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 300); // nothing before 300 ms (spec §1.4)
    return () => clearTimeout(t);
  }, []);
  return <div aria-hidden className={cx('rounded bg-line/60', show && 'animate-pulse', className)} />;
}

export function ErrorPanel({ onRetry, traceId }: { onRetry?: () => void; traceId?: string }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-lg border border-line bg-surface p-8 text-center">
      <p>{t('common.loadFailed')}</p>
      {onRetry && <Button onClick={onRetry}>{t('common.retry')}</Button>}
      {traceId && <p className="text-xs text-muted">{t('common.reference', { id: traceId })}</p>}
    </div>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line bg-surface p-10 text-center text-muted">
      <p>{children}</p>
      {action}
    </div>
  );
}

/** Accessible modal dialog (native <dialog>: focus trap + Esc). */
export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={id} onClose={onClose} className={cx('m-auto w-[min(92vw,32rem)] rounded-lg border border-line bg-surface p-0 text-ink backdrop:bg-black/40', wide && 'w-[min(92vw,44rem)]')}>
      {open && (
        <div className="flex flex-col gap-4 p-5">
          <h2 id={id} className="text-lg font-semibold">
            {title}
          </h2>
          <div className="flex flex-col gap-3">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** Side panel that slides from the end side (left in Arabic). */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} className="ms-auto me-0 my-0 h-dvh max-h-dvh w-[min(100vw,28rem)] border-s border-line bg-surface p-0 text-ink backdrop:bg-black/30">
      {open && (
        <div className="flex h-full flex-col">
          <h2 className="border-b border-line p-4 text-lg font-semibold">{title}</h2>
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line p-4">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

type Toast = { id: number; text: string; action?: { label: string; onClick: () => void } };
const ToastCtx = createContext<(text: string, action?: Toast['action']) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, action?: Toast['action']) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, action }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="fixed bottom-4 start-4 z-50 flex flex-col gap-2">
        {items.map((i) => (
          <div key={i.id} className="flex items-center gap-3 rounded-md bg-ink px-4 py-2 text-sm text-white shadow-lg">
            <span>{i.text}</span>
            {i.action && (
              <button className="font-semibold underline" onClick={i.action.onClick}>
                {i.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function PageHeader({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {children}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Checkbox({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cx('inline-flex min-h-8 items-center gap-2 text-sm', rest.disabled && 'opacity-50')}>
      <input type="checkbox" className="size-4" {...rest} />
      {label}
    </label>
  );
}

export function Radio({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className="inline-flex min-h-8 items-center gap-2 text-sm">
      <input type="radio" className="size-4" {...rest} />
      {label}
    </label>
  );
}
