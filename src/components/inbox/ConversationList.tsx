import type { Channel, Conversation } from '../../types';
import { ChannelIcon, I } from '../Icons';
import { useAppPreferences } from '../../context/AppPreferencesContext';
import { ConversationRowSkeleton } from '../Skeleton';
import { playNotification, useMutedState } from '../../lib/inboxNotifications';
import { useMemo, useState } from 'react';

interface Props {
  conversations: Conversation[];
  activeId: string;
  onSelect: (id: string) => void;
  /** True on first fetch before any conversation arrives — render skeleton rows. */
  loading?: boolean;
  /** Hide on phones when the user has drilled into a conversation. */
  hiddenOnMobile?: boolean;
}

type ToggleFilterKey = 'unread' | Channel;

export function ConversationList({ conversations, activeId, onSelect, loading = false, hiddenOnMobile = false }: Props) {
  const { t } = useAppPreferences();
  const [muted, setMuted] = useMutedState();
  const FILTERS = useMemo(
    () =>
      [
        { key: 'all' as const, label: t('inbox.filterAll'), mode: 'clear' as const },
        { key: 'unread' as const, label: t('inbox.filterUnread'), mode: 'toggle' as const },
        { key: 'line' as const, channel: 'line' as const, ariaLabel: 'LINE', mode: 'toggle' as const },
        { key: 'ig' as const, channel: 'ig' as const, ariaLabel: 'Instagram', mode: 'toggle' as const },
        { key: 'facebook' as const, channel: 'facebook' as const, ariaLabel: 'Facebook', mode: 'toggle' as const },
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

  const totalUnread = useMemo(() => conversations.reduce((acc, c) => acc + (c.unread > 0 ? c.unread : 0), 0), [conversations]);
  const { pinnedRows, otherRows } = useMemo(() => {
    const pinned = filtered.filter((c) => Boolean(c.pinnedMessageId));
    const other = filtered.filter((c) => !c.pinnedMessageId);
    return { pinnedRows: pinned, otherRows: other };
  }, [filtered]);

  const renderRow = (c: Conversation) => {
    const isActive = c.id === activeId;
    return (
      <button
        key={c.id}
        onClick={() => onSelect(c.id)}
        className={
          'flex w-full items-start gap-3 border-b border-slate-100/90 px-4 py-3.5 text-left transition dark:border-slate-800/90 ' +
          (isActive
            ? 'bg-brand-600 text-white dark:bg-brand-500'
            : 'text-slate-900 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800/60')
        }
      >
        <div className="relative shrink-0">
          <img
            src={c.avatar}
            className={'h-12 w-12 rounded-full ring-2 ' + (isActive ? 'ring-white/30' : 'ring-white dark:ring-slate-900')}
            alt=""
          />
          <span
            className={
              'absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full ' +
              (isActive ? 'bg-brand-700 dark:bg-brand-600' : 'bg-white dark:bg-slate-900')
            }
          >
            <ChannelIcon channel={c.channel} className="h-4 w-4" />
          </span>
          {c.online && (
            <span
              className={
                'absolute -top-0.5 right-0 h-2.5 w-2.5 rounded-full border-2 ' +
                (isActive ? 'border-brand-600 bg-emerald-300 dark:border-brand-500' : 'border-white bg-emerald-500 dark:border-slate-900')
              }
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className={'truncate text-sm font-semibold ' + (isActive ? 'text-white' : 'text-slate-900 dark:text-slate-100')}>
              {c.customerName}
            </div>
            <div className={'shrink-0 text-[11px] ' + (isActive ? 'text-white/75' : 'text-slate-400 dark:text-slate-500')}>{c.lastAt}</div>
          </div>
          <div className={'mt-0.5 truncate text-xs ' + (isActive ? 'text-white/85' : 'text-slate-500 dark:text-slate-400')}>{c.lastSnippet}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {c.tags?.map((tag) => (
              <span
                key={tag}
                className={
                  'chip ' +
                  (isActive ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300')
                }
              >
                {tag}
              </span>
            ))}
            {c.intent === 'ready_to_buy' && (
              <span
                className={
                  'chip ' +
                  (isActive ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300')
                }
              >
                🔥 {t('inbox.intentReady')}
              </span>
            )}
            {c.intent === 'paid' && (
              <span
                className={
                  'chip ' +
                  (isActive ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300')
                }
              >
                ✓ {t('inbox.intentPaid')}
              </span>
            )}
          </div>
        </div>
        {c.unread > 0 && (
          <span
            className={
              'grid h-5 min-w-[1.25rem] place-items-center rounded-full px-1 text-[10px] font-semibold ' +
              (isActive ? 'bg-white text-brand-600' : 'bg-brand-600 text-white dark:bg-brand-500')
            }
          >
            {c.unread}
          </span>
        )}
      </button>
    );
  };

  return (
    <div
      className={
        'flex h-full min-h-0 w-full shrink-0 flex-col border-r border-slate-200/90 bg-white dark:border-slate-800 dark:bg-slate-900 md:w-[360px] ' +
        (hiddenOnMobile ? 'hidden md:flex' : 'flex')
      }
    >
      <div className="border-b border-slate-200/90 px-4 pb-4 pt-6 dark:border-slate-800">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">{t('inbox.title')}</h2>
            {totalUnread > 0 && (
              <span className="shrink-0 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-700 dark:bg-brand-900/50 dark:text-brand-200">
                {t('inbox.newCount', { n: totalUnread })}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => {
                if (muted) {
                  setMuted(false);
                  playNotification();
                } else {
                  // Single click on an un-muted bell = quick "test"; double-click mutes.
                  playNotification();
                }
              }}
              onDoubleClick={() => setMuted(true)}
              aria-pressed={!muted}
              title={muted ? t('inbox.soundUnmute') : t('inbox.soundTest')}
              className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              {muted ? <I.BellOff className="h-4 w-4" /> : <I.Bell className="h-4 w-4" />}
            </button>
            {/*
              The Filter pill row below already filters the list; the icon
              button was a duplicate placeholder. The "+" was a placeholder
              for "create new conversation," which doesn't make sense for an
              inbox seeded from real LINE/Meta threads. Removed both for now;
              add back if/when we add manual conversation creation.
            */}
          </div>
        </div>
        <div className="relative mt-4">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('inbox.searchPlaceholder')}
            className="w-full rounded-2xl border border-slate-200/90 bg-slate-50 py-2.5 pl-3 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:bg-slate-900 dark:focus:ring-brand-900/40"
          />
          <I.Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const isOn =
              f.mode === 'clear'
                ? selected.size === 0
                : selected.has(f.key);
            const isChannel = 'channel' in f;
            return (
              <button
                key={f.key}
                type="button"
                aria-pressed={isOn}
                aria-label={isChannel ? f.ariaLabel : undefined}
                title={isChannel ? f.ariaLabel : undefined}
                onClick={() => {
                  if (f.mode === 'clear') setSelected(new Set());
                  else toggleKey(f.key);
                }}
                className={
                  'shrink-0 rounded-full transition ' +
                  (isChannel
                    ? 'grid h-7 w-7 place-items-center '
                    : 'px-3 py-1 text-xs font-medium ') +
                  (isOn
                    ? 'bg-brand-600 text-white shadow-sm ring-2 ring-brand-200/80 dark:bg-brand-500 dark:ring-brand-800/60'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700')
                }
              >
                {isChannel ? (
                  <ChannelIcon channel={f.channel} className="h-4 w-4" />
                ) : (
                  f.label
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && conversations.length === 0 && (
          <div>
            {Array.from({ length: 6 }).map((_, i) => (
              <ConversationRowSkeleton key={i} />
            ))}
          </div>
        )}
        {pinnedRows.length > 0 && (
          <div>
            <div className="sticky top-0 z-[1] bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:bg-slate-900 dark:text-slate-500">
              {t('inbox.sectionPinned')}
            </div>
            {pinnedRows.map((c) => renderRow(c))}
          </div>
        )}
        <div>
          {pinnedRows.length > 0 && (
            <div className="sticky top-0 z-[1] bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:bg-slate-900 dark:text-slate-500">
              {t('inbox.sectionAll')}
            </div>
          )}
          {otherRows.map((c) => renderRow(c))}
        </div>

        {/* No-results state — search/filter returned nothing */}
        {!loading && filtered.length === 0 && conversations.length > 0 && (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <I.Search className="h-7 w-7 text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              ไม่พบแชทที่ตรงกัน
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              ลองเปลี่ยนคำค้นหาหรือล้างตัวกรอง
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
