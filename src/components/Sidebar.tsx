import { useCallback, useEffect, useState } from 'react';
import type { View } from '../types';
import { useAppPreferences } from '../context/AppPreferencesContext';
import { useAuth } from '../context/AuthContext';
import { I } from './Icons';

const MD_MIN = 768;
const W_COLLAPSED = 68;
const W_EXPANDED = 248;

function useIsMobile() {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width: ${MD_MIN - 1}px)`).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MD_MIN - 1}px)`);
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return mobile;
}

interface Item {
  key: View;
  labelKey: string;
  icon: React.ReactNode;
  badge?: number | string;
}

const items: Item[] = [
  { key: 'inbox',     labelKey: 'nav.inbox',     icon: <I.Inbox   className="h-5 w-5" /> },
  { key: 'orders',    labelKey: 'nav.orders',    icon: <I.Box     className="h-5 w-5" /> },
  { key: 'slips',     labelKey: 'nav.slips',     icon: <I.Receipt className="h-5 w-5" /> },
  { key: 'shop',      labelKey: 'nav.shop',      icon: <I.Store   className="h-5 w-5" /> },
  { key: 'analytics', labelKey: 'nav.analytics', icon: <I.Chart   className="h-5 w-5" /> },
];

interface Props {
  active: View;
  onChange: (view: View) => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/** Smooth label reveal: slides width + fades opacity. */
function labelStyle(expanded: boolean): React.CSSProperties {
  return {
    maxWidth:   expanded ? 180  : 0,
    opacity:    expanded ? 1    : 0,
    overflow:   'hidden',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    transition: expanded
      ? 'max-width 300ms cubic-bezier(0.4,0,0.2,1) 30ms, opacity 240ms ease-in 50ms'
      : 'max-width 260ms cubic-bezier(0.4,0,0.2,1), opacity 160ms ease-out',
  };
}

export function Sidebar({ active, onChange }: Props) {
  const { t } = useAppPreferences();
  const { user, logout } = useAuth();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const expanded = isMobile ? mobileOpen : open;

  useEffect(() => {
    setOpen(false);
    setMobileOpen(false);
  }, [isMobile]);

  const lbl = labelStyle(expanded);

  const toggleSidebar = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isMobile) {
        setMobileOpen((v) => !v);
        return;
      }
      setOpen((v) => !v);
    },
    [isMobile],
  );

  const aside = (
    <aside
      style={!isMobile ? { width: expanded ? W_EXPANDED : W_COLLAPSED } : undefined}
      className={[
        'flex h-screen shrink-0 flex-col overflow-hidden border-r border-slate-200/90 bg-white select-none',
        'dark:border-slate-800 dark:bg-slate-900',
        !isMobile ? 'transition-[width] duration-300 ease-in-out' : '',
        isMobile
          ? 'fixed left-0 top-0 z-[45] w-[248px] shadow-2xl transition-transform duration-300 ease-in-out ' +
            (expanded ? 'translate-x-0' : '-translate-x-full pointer-events-none')
          : '',
      ].filter(Boolean).join(' ')}
    >
      {/* ── Logo ─────────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-[14px] pt-6 pb-2">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-600 text-white shadow-sm ring-4 ring-brand-100 dark:bg-brand-500 dark:ring-brand-900/40">
            <I.Zap className="h-[18px] w-[18px]" />
          </div>
          <div style={lbl}>
            <div className="text-[17px] font-extrabold leading-none tracking-tight text-slate-900 dark:text-white">
              Chatz
            </div>
            <div className="mt-0.5 text-[11px] font-medium text-slate-400 dark:text-slate-500">
              {t('sidebar.workspace')}
            </div>
          </div>
        </div>
      </div>

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <nav className="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden overscroll-y-contain px-2 pb-2">
        {items.map((it) => {
          const isActive = active === it.key;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => {
                onChange(it.key);
                if (isMobile) setMobileOpen(false);
              }}
              title={!expanded ? t(it.labelKey) : undefined}
              className={[
                'group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                isActive
                  ? 'bg-brand-600 text-white shadow-sm dark:bg-brand-500'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
              ].join(' ')}
            >
              <span
                className={
                  'shrink-0 ' +
                  (isActive
                    ? 'text-white'
                    : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300')
                }
              >
                {it.icon}
              </span>
              <span style={lbl}>{t(it.labelKey)}</span>
              {it.badge != null && (
                <span
                  style={lbl}
                  className={
                    'chip shrink-0 ' +
                    (isActive
                      ? 'bg-white/20 text-white'
                      : typeof it.badge === 'number'
                        ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200'
                        : 'bg-brand-600 text-white dark:bg-brand-500')
                  }
                >
                  {it.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-slate-200 dark:border-slate-800">
        {/* Toggle — top of footer, above user row */}
        <div
          className={[
            'flex shrink-0 px-2 pt-2 pb-1',
            expanded ? 'justify-end' : 'justify-center',
          ].join(' ')}
        >
          <button
            type="button"
            onClick={toggleSidebar}
            title={expanded ? 'เก็บเมนู' : 'เปิดเมนู'}
            aria-label={expanded ? 'เก็บเมนู' : 'เปิดเมนู'}
            aria-expanded={expanded}
            className={[
              'grid h-8 w-8 place-items-center rounded-xl transition',
              expanded
                ? 'bg-brand-600 text-white shadow-sm hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-400'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
            ].join(' ')}
          >
            {expanded ? (
              <I.ChevronLeft className="h-4 w-4" />
            ) : (
              <I.ChevronRight className="h-4 w-4" />
            )}
          </button>
        </div>

        <div
          className={[
            'flex items-center py-3 transition-[padding,gap] duration-300',
            expanded ? 'gap-2.5 px-4' : 'justify-center px-2',
          ].join(' ')}
        >
          <div
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600 text-[11px] font-bold text-white ring-2 ring-white dark:bg-brand-500 dark:ring-slate-900"
            title={!expanded ? (user?.displayName || user?.username || undefined) : undefined}
            aria-hidden
          >
            {user ? initials(user.displayName || user.username) : '??'}
          </div>

          <div
            style={{
              ...lbl,
              flex: 1,
              minWidth: 0,
              maxWidth: expanded ? 140 : 0,
            }}
          >
            <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
              {user?.displayName || user?.username || '—'}
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="text-[11px] text-slate-400 transition hover:text-rose-500 dark:text-slate-500 dark:hover:text-rose-400"
            >
              ออกจากระบบ
            </button>
          </div>

          <div
            style={{
              maxWidth: expanded ? 36 : 0,
              opacity: expanded ? 1 : 0,
              overflow: 'hidden',
              flexShrink: 0,
              transition: lbl.transition,
            }}
          >
            <button
              type="button"
              className={
                'btn-ghost rounded-xl p-1.5 ' +
                (active === 'settings'
                  ? 'bg-brand-600 text-white dark:bg-brand-500'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100')
              }
              aria-label={t('nav.settings')}
              title={t('nav.settings')}
              onClick={() => {
                onChange('settings');
                if (isMobile) setMobileOpen(false);
              }}
            >
              <I.Settings className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );

  if (!isMobile) return aside;

  return (
    <div className="relative w-0 shrink-0 overflow-visible">
      {expanded && (
        <button
          type="button"
          aria-label="ปิดเมนู"
          className="fixed inset-0 z-[40] bg-slate-900/35 backdrop-blur-[1px]"
          onClick={() => setMobileOpen(false)}
        />
      )}
      {aside}
    </div>
  );
}
