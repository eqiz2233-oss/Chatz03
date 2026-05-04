import type { Channel, Conversation } from '../../types';
import { ChannelIcon, I } from '../Icons';
import { useAppPreferences } from '../../context/AppPreferencesContext';
import { useMemo, useState } from 'react';

interface Props {
  conversations: Conversation[];
  activeId: string;
  onSelect: (id: string) => void;
}

type ToggleFilterKey = 'unread' | Channel;

export function ConversationList({ conversations, activeId, onSelect }: Props) {
  const { t } = useAppPreferences();
  const FILTERS = useMemo(
    () =>
      [
        { key: 'all' as const, label: t('inbox.filterAll'), mode: 'clear' as const },
        { key: 'unread' as const, label: t('inbox.filterUnread'), mode: 'toggle' as const },
        { key: 'line' as const, label: 'LINE', mode: 'toggle' as const },
        { key: 'ig' as const, label: 'IG', mode: 'toggle' as const },
        { key: 'facebook' as const, label: 'FB', mode: 'toggle' as const },
      ] as const,
    [t],
  );

  /** Empty = no restriction (same as “ทั้งหมด”). Channels OR together; unread ANDs with channel rule. */
  const [selected, setSelected] = useState<Set<ToggleFilterKey>>(() => new Set());
  const [q, setQ] = useState('');

  const toggleKey = (key: ToggleFilterKey) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const filtered = conversations.filter((c) => {
    if (q && !c.customerName.toLowerCase().includes(q.toLowerCase())) return false;
    if (selected.has('unread') && c.unread <= 0) return false;
    const channelPicks = (['line', 'ig', 'facebook'] as const).filter((ch) => selected.has(ch));
    if (channelPicks.length > 0 && !channelPicks.includes(c.channel)) return false;
    return true;
  });

  return (
    <div className="flex h-full min-h-0 w-[340px] shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-4 pb-3 pt-5 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">{t('inbox.title')}</h2>
          <div className="flex items-center gap-1">
            <button className="btn-ghost p-1.5">
              <I.Filter className="h-4 w-4" />
            </button>
            <button className="btn-ghost p-1.5">
              <I.Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="relative mt-3">
          <I.Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('inbox.searchPlaceholder')}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:bg-slate-900 dark:focus:ring-brand-900/40"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const isOn =
              f.mode === 'clear'
                ? selected.size === 0
                : selected.has(f.key);
            return (
              <button
                key={f.key}
                type="button"
                aria-pressed={isOn}
                onClick={() => {
                  if (f.mode === 'clear') setSelected(new Set());
                  else toggleKey(f.key);
                }}
                className={
                  'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition ' +
                  (isOn
                    ? 'bg-slate-900 text-white dark:bg-brand-600 dark:text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700')
                }
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.map((c) => {
          const isActive = c.id === activeId;
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={
                'flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left transition dark:border-slate-800 ' +
                (isActive ? 'bg-brand-50/50 dark:bg-brand-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50')
              }
            >
              <div className="relative shrink-0">
                <img src={c.avatar} className="h-11 w-11 rounded-full bg-slate-100 dark:bg-slate-800" alt="" />
                <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-white dark:bg-slate-900">
                  <ChannelIcon channel={c.channel} className="h-4 w-4" />
                </span>
                {c.online && (
                  <span className="absolute -top-0.5 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500 dark:border-slate-900" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{c.customerName}</div>
                  <div className="shrink-0 text-[11px] text-slate-400 dark:text-slate-500">{c.lastAt}</div>
                </div>
                <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{c.lastSnippet}</div>
                <div className="mt-1.5 flex items-center gap-1">
                  {c.tags?.map((tag) => (
                    <span key={tag} className="chip bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {tag}
                    </span>
                  ))}
                  {c.intent === 'ready_to_buy' && (
                    <span className="chip bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">🔥 {t('inbox.intentReady')}</span>
                  )}
                  {c.intent === 'paid' && (
                    <span className="chip bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">✓ {t('inbox.intentPaid')}</span>
                  )}
                </div>
              </div>
              {c.unread > 0 && (
                <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-600 text-[10px] font-semibold text-white dark:bg-brand-500">
                  {c.unread}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
