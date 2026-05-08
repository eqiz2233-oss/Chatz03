import { useMemo } from 'react';
import { conversations as seedConversations, orders as seed } from '../../data/mockData';
import type { InboxFocusRequest, Order, OrderStatus } from '../../types';
import { ChannelIcon, I } from '../Icons';
import { useAppPreferences } from '../../context/AppPreferencesContext';
import { resolveConversationIdForOrder } from '../../lib/orderInbox';

const COLUMN_KEYS: {
  key: OrderStatus;
  labelKey: string;
  emoji: string;
  headTint: string;
  topAccent: string;
}[] = [
  {
    key: 'paid',
    labelKey: 'orders.col.paid',
    emoji: '💰',
    headTint: 'bg-amber-50/95 dark:bg-amber-950/35',
    topAccent: 'border-t-2 border-t-amber-400',
  },
  {
    key: 'pending',
    labelKey: 'orders.col.pending',
    emoji: '⏳',
    headTint: 'bg-sky-50/90 dark:bg-sky-950/35',
    topAccent: 'border-t-2 border-t-sky-400',
  },
  {
    key: 'shipped',
    labelKey: 'orders.col.shipped',
    emoji: '📦',
    headTint: 'bg-emerald-50/90 dark:bg-emerald-950/35',
    topAccent: 'border-t-2 border-t-emerald-400',
  },
  {
    key: 'cancelled',
    labelKey: 'orders.col.cancelled',
    emoji: '✕',
    headTint: 'bg-rose-50/90 dark:bg-rose-950/35',
    topAccent: 'border-t-2 border-t-rose-400',
  },
];

export function OrdersView({ onGoToChat }: { onGoToChat: (req: InboxFocusRequest) => void }) {
  const { t } = useAppPreferences();
  const list = seed;

  const columns = useMemo(
    () => COLUMN_KEYS.map((c) => ({ ...c, label: t(c.labelKey) })),
    [t],
  );

  const goToChat = (o: Order) => {
    const conversationId = resolveConversationIdForOrder(o, seedConversations);
    onGoToChat({ conversationId, customer: o.customer, channel: o.channel });
  };

  return (
    <div className="flex h-screen flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <Header t={t} />
      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto overflow-x-hidden p-5 pb-10">
        {columns.map((col) => {
          const items = list.filter((o) => o.status === col.key);
          const total = items.reduce((s, o) => s + o.amount, 0);
          return (
            <section
              key={col.key}
              role="region"
              aria-label={col.label}
              className={
                'flex shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-md ring-1 ring-slate-900/[0.04] dark:border-slate-700 dark:bg-slate-900 dark:shadow-none dark:ring-white/[0.06] ' +
                col.topAccent
              }
            >
              <div
                className={
                  'flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 px-4 py-3 dark:border-slate-800 ' +
                  col.headTint
                }
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-lg leading-none" aria-hidden>
                    {col.emoji}
                  </span>
                  <span className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">{col.label}</span>
                  <span className="rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-700 shadow-sm ring-1 ring-slate-200/80 dark:bg-slate-800/90 dark:text-slate-200 dark:ring-slate-600">
                    {items.length}
                  </span>
                </div>
                <div className="text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-300">฿{total.toLocaleString()}</div>
              </div>
              <div className="flex min-h-[7.5rem] min-w-0 flex-row items-stretch gap-2 overflow-x-auto overflow-y-hidden bg-slate-50/60 p-3 pb-2 dark:bg-slate-950/50 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5">
                {items.map((o) => (
                  <div
                    key={o.id}
                    className="group flex min-h-[9.5rem] w-[220px] shrink-0 flex-col rounded-lg border border-slate-200 p-2.5 transition hover:border-brand-300 hover:shadow-sm dark:border-slate-700 dark:hover:border-brand-500"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">{o.id}</span>
                      <ChannelIcon channel={o.channel} className="h-3.5 w-3.5" />
                    </div>
                    <div className="mt-1 text-sm font-medium leading-tight text-slate-900 dark:text-slate-100">{o.product}</div>
                    <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      x{o.qty} • {o.customer}
                    </div>
                    <div className="mt-2 flex items-end justify-between">
                      <div>
                        <div className="text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100">฿{o.amount.toLocaleString()}</div>
                        <div className="text-[10px] text-slate-400 dark:text-slate-500">
                          {o.shop} • {t('orders.commission')} {o.commissionPct}%
                        </div>
                      </div>
                      {o.slipStatus === 'verified' && (
                        <span className="chip bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                          <I.Check className="h-3 w-3" />
                          {t('orders.slipVerified')}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => goToChat(o)}
                      className="mt-auto w-full rounded-md border border-slate-200 bg-slate-50 py-1.5 text-[11px] font-medium text-slate-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-brand-500 dark:hover:bg-brand-950/40 dark:hover:text-brand-300"
                    >
                      {t('orders.goToChat')}
                    </button>
                  </div>
                ))}
                {items.length === 0 && (
                  <div className="flex min-h-[6rem] min-w-full flex-1 items-center justify-center text-center text-xs text-slate-400 dark:text-slate-500">
                    {t('orders.empty')}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Header({ t }: { t: (k: string) => string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">{t('orders.title')}</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('orders.subtitle')}</p>
      </div>
      <div className="flex items-center gap-2">
        <button className="btn-secondary text-xs">
          <I.Filter className="h-3.5 w-3.5" />
          {t('orders.filter')}
        </button>
        <button className="btn-primary text-xs">
          <I.Plus className="h-4 w-4" />
          {t('orders.create')}
        </button>
      </div>
    </div>
  );
}
