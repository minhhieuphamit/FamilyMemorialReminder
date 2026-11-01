import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function DaysBadge({ days }: { days: number }) {
  const label = days === 0 ? 'Hôm nay' : days === 1 ? 'Ngày mai' : days < 0 ? `Đã qua ${-days} ngày` : `Còn ${days} ngày`;
  const tone =
    days === 0
      ? 'bg-accent text-accent-ink'
      : days > 0 && days <= 7
        ? 'bg-warn-soft text-warn'
        : days < 0
          ? 'bg-subtle text-muted'
          : 'bg-accent-soft text-accent';
  return <span className={`inline-block shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${tone}`}>{label}</span>;
}

export function StatusDot({ ok, label }: { ok: boolean | null; label: string }) {
  const color = ok === null ? 'bg-muted' : ok ? 'bg-ok' : 'bg-danger';
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className={`size-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-accent' : 'bg-line'}`}
    >
      <span className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  );
}

export function Notice({ tone, children }: { tone: 'warn' | 'danger' | 'ok' | 'info'; children: ReactNode }) {
  const styles = {
    warn: 'bg-warn-soft text-warn',
    danger: 'bg-danger-soft text-danger',
    ok: 'bg-ok-soft text-ok',
    info: 'bg-subtle text-muted',
  };
  return <div className={`rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${styles[tone]}`}>{children}</div>;
}

export function Loading() {
  return <p className="py-10 text-center text-sm text-muted">Đang tải...</p>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Notice tone="danger">
      {message}
      {onRetry && (
        <button type="button" className="ml-2 cursor-pointer font-semibold underline" onClick={onRetry}>
          Thử lại
        </button>
      )}
    </Notice>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card px-5 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

type ToastTone = 'ok' | 'error';
const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((message: string, tone: ToastTone = 'ok') => {
    setToast({ message, tone });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div
          role="status"
          className={`fixed inset-x-4 bottom-24 z-50 mx-auto max-w-sm rounded-xl px-4 py-3 text-center text-sm font-medium shadow-lg md:bottom-6 ${
            toast.tone === 'ok' ? 'bg-ink text-bg' : 'bg-danger text-white dark:text-black'
          }`}
        >
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) dialog.showModal();
    if (!props.open && dialog.open) dialog.close();
  }, [props.open]);

  return (
    <dialog
      ref={ref}
      onCancel={props.onCancel}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-line bg-surface p-5 text-ink backdrop:bg-black/50"
    >
      <h2 className="text-lg font-semibold">{props.title}</h2>
      <div className="mt-2 text-sm leading-relaxed text-muted">{props.children}</div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn" onClick={props.onCancel}>
          Hủy
        </button>
        <button type="button" className={`btn ${props.danger ? 'btn-danger' : 'btn-primary'}`} onClick={props.onConfirm}>
          {props.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
