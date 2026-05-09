import { useCallback, useEffect, useRef, useState } from 'react';
import type { View } from '../types';
import { useAppPreferences } from '../context/AppPreferencesContext';
import { I } from './Icons';

const MD_MIN = 768;

function useIsNarrow() {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width: ${MD_MIN - 1}px)`).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MD_MIN - 1}px)`);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  return narrow;
}

interface Item {
  key: View;
  labelKey: string;
  icon: React.ReactNode;
  badge?: number | string;
}

const items: Item[] = [
  { key: 'inbox', labelKey: 'nav.inbox', icon: <I.Inbox className="h-5 w-5" /> },
  { key: 'orders', labelKey: 'nav.orders', icon: <I.Box className="h-5 w-5" /> },
  { key: 'slips', labelKey: 'nav.slips', icon: <I.Receipt className="h-5 w-5" /> },
  { key: 'shop', labelKey: 'nav.shop', icon: <I.Store className="h-5 w-5" /> },
  { key: 'analytics', labelKey: 'nav.analytics', icon: <I.Chart className="h-5 w-5" /> },
];

interface Props {
  active: View;
  onChange: (view: View) => void;
}

export function Sidebar({ active, onChange }: Props) {
  const { t } = useAppPreferences();
  const narrow = useIsNarrow();
  const [peeled, setPeeled] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearClose = useCallback(() => {
    if (closeTimer.current != null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const peelOpen = useCallback(() => {
    clearClose();
    setPeeled(true);
  }, [clearClose]);

  const scheduleClose = useCallback(() => {
    clearClose();
    closeTimer.current = setTimeout(() => setPeeled(false), 240);
  }, [clearClose]);

  useEffect(() => {
    if (!narrow) {
      setPeeled(false);
      clearClose();
    }
  }, [narrow, clearClose]);

  const aside = (
    <aside
      onMouseEnter={narrow ? peelOpen : undefined}
      onMouseLeave={narrow ? scheduleClose : undefined}
      className={
        'flex h-screen w-[248px] shrink-0 flex-col overflow-hidden border-r border-slate-200/90 bg-white select-none dark:border-slate-800 dark:bg-slate-900 ' +
        (narrow
          ? 'fixed left-0 top-0 z-[45] shadow-2xl transition-transform duration-200 ease-out ' +
            (peeled ? 'translate-x-0' : '-translate-x-full pointer-events-none')
          : '')
      }
    >
      <div className="shrink-0 px-5 pt-6 pb-2">
        <div className="flex items-center gap-2.5">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-brand-600 text-white shadow-sm dark:bg-brand-500">
            <I.Zap className="h-[18px] w-[18px]" />
          </div>
          <div>
            <div className="text-[16px] font-bold leading-none tracking-tight text-slate-900 dark:text-white">Chatz</div>
            <div className="mt-0.5 text-[11px] font-medium text-slate-400 dark:text-slate-500">{t('sidebar.workspace')}</div>
          </div>
        </div>
      </div>

      <nav className="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden overscroll-y-contain px-3 pb-2">
        {items.map((it) => {
          const isActive = active === it.key;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => {
                onChange(it.key);
                if (narrow) scheduleClose();
              }}
              className={
                'group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ' +
                (isActive
                  ? 'bg-brand-600 text-white shadow-sm dark:bg-brand-500'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white')
              }
            >
              <span
                className={
                  isActive
                    ? 'text-white'
                    : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300'
                }
              >
                {it.icon}
              </span>
              <span className="min-w-0 flex-1 truncate text-left">{t(it.labelKey)}</span>
              {it.badge != null && (
                <span
                  className={
                    'shrink-0 chip ' +
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

      <div className="flex shrink-0 items-center gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
        <div
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-200 text-slate-600 ring-2 ring-white dark:bg-slate-700 dark:text-slate-200 dark:ring-slate-900"
          aria-hidden
        >
          <I.Bot className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">คุณเอก (Owner)</div>
          <div className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {t('sidebar.online')}
          </div>
        </div>
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
            if (narrow) scheduleClose();
          }}
        >
          <I.Settings className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );

  if (!narrow) {
    return aside;
  }

  return (
    <div className="relative w-0 shrink-0 overflow-visible">
      {peeled && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-[40] bg-slate-900/35 backdrop-blur-[1px] md:hidden"
          onClick={() => {
            clearClose();
            setPeeled(false);
          }}
        />
      )}
      {!peeled && (
        <div
          role="presentation"
          className="pointer-events-auto fixed left-0 top-0 z-[50] h-full w-4 bg-gradient-to-r from-slate-200/90 to-transparent dark:from-slate-700/90 md:hidden"
          onMouseEnter={peelOpen}
          onTouchStart={peelOpen}
        />
      )}
      {aside}
    </div>
  );
}
