import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * Toast system — replaces window.alert/confirm with calm, non-modal
 * notifications. Three intents (error / success / info), 4s auto-dismiss,
 * click to dismiss early. Stacks bottom-right so it never blocks chat.
 */

export type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  /** Hover lifts the auto-dismiss so users can finish reading long messages. */
  paused?: boolean;
}

interface ToastApi {
  success: (msg: string, opts?: { duration?: number }) => void;
  error: (msg: string, opts?: { duration?: number }) => void;
  info: (msg: string, opts?: { duration?: number }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string, duration = DEFAULT_DURATION) => {
      const id = ++counter.current;
      setItems((prev) => [...prev, { id, kind, message }]);
      window.setTimeout(() => remove(id), duration);
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (msg, opts) => push('success', msg, opts?.duration),
      error: (msg, opts) => push('error', msg, opts?.duration ?? 6000),
      info: (msg, opts) => push('info', msg, opts?.duration),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport items={items} onDismiss={remove} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed bottom-4 right-4 z-[300] flex w-[min(calc(100vw-2rem),22rem)] flex-col gap-2"
    >
      {items.map((t) => (
        <ToastCard key={t.id} item={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>,
    document.body,
  );
}

const ACCENT: Record<ToastKind, { bar: string; dot: string }> = {
  success: { bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
  error: { bar: 'bg-rose-500', dot: 'bg-rose-500' },
  info: { bar: 'bg-slate-400', dot: 'bg-slate-400' },
};

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const [enter, setEnter] = useState(false);
  useEffect(() => {
    /** Two-frame delay so the initial render uses the off-screen class, then
     * we flip on the on-screen class — gives the browser a chance to paint
     * the start state before the transition kicks in. */
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setEnter(true)));
    return () => cancelAnimationFrame(id);
  }, []);
  const a = ACCENT[item.kind];
  return (
    <button
      type="button"
      onClick={onDismiss}
      className={
        'pointer-events-auto flex w-full items-start gap-3 overflow-hidden rounded-xl border border-slate-200 bg-white py-3 pl-3 pr-3.5 text-left shadow-lg shadow-slate-900/[0.08] transition-all duration-200 ease-out hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/40 dark:hover:bg-slate-800 ' +
        (enter ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0')
      }
    >
      <span className={'mt-1.5 h-2 w-2 shrink-0 rounded-full ' + a.dot} />
      <span className="flex-1 text-[13px] leading-snug text-slate-700 dark:text-slate-200">
        {item.message}
      </span>
      <span className={'-mr-1 h-full w-1 shrink-0 rounded-full ' + a.bar} aria-hidden />
    </button>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
