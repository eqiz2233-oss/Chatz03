import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { createPortal } from 'react-dom';
import { conversations as seedConversations, orders as seed } from '../../data/mockData';
import type { Channel, InboxFocusRequest, Order, OrderStatus } from '../../types';
import { ChannelIcon, I } from '../Icons';
import { useAppPreferences } from '../../context/AppPreferencesContext';
import { resolveConversationIdForOrder } from '../../lib/orderInbox';

const COLUMN_KEYS: {
  key: OrderStatus;
  labelKey: string;
  emoji: string;
  headTint: string;
  topAccent: string;
  /** pending/paid = primary workflow; shipped/cancelled = de-emphasized archive */
  tier: 'focus' | 'archive';
}[] = [
  {
    key: 'pending',
    labelKey: 'orders.col.pending',
    emoji: '⏳',
    headTint: 'bg-sky-50/90 dark:bg-sky-950/35',
    topAccent: 'border-t-2 border-t-sky-400',
    tier: 'focus',
  },
  {
    key: 'paid',
    labelKey: 'orders.col.paid',
    emoji: '💰',
    headTint: 'bg-amber-50/95 dark:bg-amber-950/35',
    topAccent: 'border-t-2 border-t-amber-400',
    tier: 'focus',
  },
  {
    key: 'shipped',
    labelKey: 'orders.col.shipped',
    emoji: '📦',
    headTint: 'bg-slate-50/90 dark:bg-slate-900/80',
    topAccent: 'border-t border-t-slate-200/95 dark:border-t-slate-600',
    tier: 'archive',
  },
  {
    key: 'cancelled',
    labelKey: 'orders.col.cancelled',
    emoji: '✕',
    headTint: 'bg-slate-50/90 dark:bg-slate-900/80',
    topAccent: 'border-t border-t-slate-200/95 dark:border-t-slate-600',
    tier: 'archive',
  },
];

type SlipFilterMode = 'all' | 'with_slip' | 'no_slip';

type OrderFiltersState = {
  product: string;
  customer: string;
  shop: string;
  channel: 'all' | Channel;
  minAmount: string;
  maxAmount: string;
  dateFrom: string;
  dateTo: string;
  slip: SlipFilterMode;
};

const DEFAULT_ORDER_FILTERS: OrderFiltersState = {
  product: '',
  customer: '',
  shop: '',
  channel: 'all',
  minAmount: '',
  maxAmount: '',
  dateFrom: '',
  dateTo: '',
  slip: 'all',
};

function hasSlipEvidence(o: Order) {
  return Boolean(o.slipImageUrl?.trim() || o.slipStatus);
}

function orderMatchesFilters(o: Order, f: OrderFiltersState): boolean {
  const pq = f.product.trim().toLowerCase();
  if (pq && !o.product.toLowerCase().includes(pq)) return false;
  const cq = f.customer.trim().toLowerCase();
  if (cq) {
    const hay = `${o.customer} ${o.id}`.toLowerCase();
    if (!hay.includes(cq)) return false;
  }
  if (f.shop && o.shop !== f.shop) return false;
  if (f.channel !== 'all' && o.channel !== f.channel) return false;
  if (f.minAmount.trim() !== '') {
    const n = Number(f.minAmount.replace(/,/g, ''));
    if (!Number.isNaN(n) && o.amount < n) return false;
  }
  if (f.maxAmount.trim() !== '') {
    const n = Number(f.maxAmount.replace(/,/g, ''));
    if (!Number.isNaN(n) && o.amount > n) return false;
  }
  if (o.orderDate) {
    if (f.dateFrom && o.orderDate < f.dateFrom) return false;
    if (f.dateTo && o.orderDate > f.dateTo) return false;
  }
  if (f.slip === 'with_slip' && !hasSlipEvidence(o)) return false;
  if (f.slip === 'no_slip' && hasSlipEvidence(o)) return false;
  return true;
}

function countActiveFilters(f: OrderFiltersState): number {
  let n = 0;
  if (f.product.trim()) n++;
  if (f.customer.trim()) n++;
  if (f.shop) n++;
  if (f.channel !== 'all') n++;
  if (f.minAmount.trim()) n++;
  if (f.maxAmount.trim()) n++;
  if (f.dateFrom) n++;
  if (f.dateTo) n++;
  if (f.slip !== 'all') n++;
  return n;
}

function SlipImageLightbox({
  src,
  onClose,
  t,
}: {
  src: string;
  onClose: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('orders.slipImageAria')}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/88 p-4 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <button
        type="button"
        className="absolute right-3 top-3 z-[201] grid h-11 w-11 place-items-center rounded-full bg-white/12 text-white ring-1 ring-white/35 transition hover:bg-white/22"
        aria-label={t('chat.closeMedia')}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <I.X className="h-6 w-6" />
      </button>
      <div
        className="flex max-h-[min(92vh,calc(100dvh-2rem))] max-w-[min(96vw,calc(100dvw-2rem))] items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img src={src} alt="" className="max-h-[min(92vh,calc(100dvh-2rem))] max-w-full object-contain shadow-2xl" />
      </div>
    </div>,
    document.body,
  );
}

export function OrdersView({ onGoToChat }: { onGoToChat: (req: InboxFocusRequest) => void }) {
  const { t } = useAppPreferences();
  const list = seed;
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<OrderFiltersState>(DEFAULT_ORDER_FILTERS);
  const filterWrapRef = useRef<HTMLDivElement>(null);

  const filteredList = useMemo(() => list.filter((o) => orderMatchesFilters(o, filters)), [list, filters]);
  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters]);
  const shops = useMemo(() => [...new Set(list.map((o) => o.shop))].sort(), [list]);

  const columns = useMemo(
    () => COLUMN_KEYS.map((c) => ({ ...c, label: t(c.labelKey) })),
    [t],
  );

  useEffect(() => {
    if (!filterOpen) return;
    const close = (ev: PointerEvent) => {
      const el = ev.target as Node;
      if (filterWrapRef.current?.contains(el)) return;
      setFilterOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [filterOpen]);

  const goToChat = useCallback(
    (o: Order) => {
      const conversationId = resolveConversationIdForOrder(o, seedConversations);
      onGoToChat({ conversationId, customer: o.customer, channel: o.channel });
    },
    [onGoToChat],
  );

  const clearFilters = useCallback(() => {
    setFilters({ ...DEFAULT_ORDER_FILTERS });
  }, []);

  return (
    <div className="flex h-screen flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      {slipPreview && <SlipImageLightbox src={slipPreview} onClose={() => setSlipPreview(null)} t={t} />}
      <Header
        t={t}
        filterOpen={filterOpen}
        onToggleFilter={() => setFilterOpen((v) => !v)}
        filterWrapRef={filterWrapRef}
        filters={filters}
        setFilters={setFilters}
        onClearFilters={clearFilters}
        activeFilterCount={activeFilterCount}
        shops={shops}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto overflow-x-hidden p-5 pb-10">
        {columns.map((col) => {
          const items = filteredList.filter((o) => o.status === col.key);
          const total = items.reduce((s, o) => s + o.amount, 0);
          const focus = col.tier === 'focus';
          return (
            <section
              key={col.key}
              role="region"
              aria-label={col.label}
              className={
                'flex shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white ring-1 dark:border-slate-700 dark:bg-slate-900 dark:shadow-none ' +
                (focus
                  ? 'shadow-md ring-slate-900/[0.04] dark:ring-white/[0.06] '
                  : 'shadow-sm ring-slate-900/[0.025] dark:ring-white/[0.04] ') +
                col.topAccent
              }
            >
              <div
                className={
                  'flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-800 ' +
                  (focus ? 'px-4 py-3.5 ' : 'px-3 py-2 ') +
                  col.headTint
                }
              >
                <div className={focus ? 'flex items-center gap-2.5' : 'flex items-center gap-2'}>
                  <span className={focus ? 'text-xl leading-none' : 'text-base leading-none'} aria-hidden>
                    {col.emoji}
                  </span>
                  <span
                    className={
                      focus
                        ? 'text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100'
                        : 'text-xs font-medium tracking-tight text-slate-600 dark:text-slate-400'
                    }
                  >
                    {col.label}
                  </span>
                  <span
                    className={
                      focus
                        ? 'rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-700 shadow-sm ring-1 ring-slate-200/80 dark:bg-slate-800/90 dark:text-slate-200 dark:ring-slate-600'
                        : 'rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-slate-500 ring-1 ring-slate-200/70 dark:bg-slate-800/70 dark:text-slate-400 dark:ring-slate-600'
                    }
                  >
                    {items.length}
                  </span>
                </div>
                <div
                  className={
                    focus
                      ? 'text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-300'
                      : 'text-[10px] font-medium tabular-nums text-slate-400 dark:text-slate-500'
                  }
                >
                  ฿{total.toLocaleString()}
                </div>
              </div>
              <div
                className={
                  'flex min-w-0 flex-row items-stretch gap-2 overflow-x-auto overflow-y-hidden bg-slate-50/60 pb-2 dark:bg-slate-950/50 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 ' +
                  (focus ? 'min-h-[8.5rem] gap-2.5 p-3.5 ' : 'min-h-[5.75rem] gap-1.5 p-2 ')
                }
              >
                {items.map((o) => {
                  const hasSlipImg = Boolean(o.slipImageUrl?.trim());
                  return (
                    <div
                      key={o.id}
                      className={
                        'group flex shrink-0 rounded-lg border border-slate-200 transition dark:border-slate-700 ' +
                        (focus
                          ? 'min-h-[11rem] hover:border-brand-300 hover:shadow-md dark:hover:border-brand-500 ' +
                            (hasSlipImg ? 'flex w-[min(100%,288px)] min-w-[268px] flex-row gap-3 p-3.5' : 'flex w-[min(100%,252px)] min-w-[236px] flex-col p-3.5')
                          : 'min-h-[7.25rem] opacity-95 hover:border-slate-300 hover:shadow-sm dark:hover:border-slate-600 ' +
                            (hasSlipImg ? 'flex w-[min(100%,208px)] min-w-[196px] flex-row gap-1.5 p-2' : 'flex w-[min(100%,188px)] min-w-[176px] flex-col p-2'))
                      }
                    >
                      {hasSlipImg && (
                        <button
                          type="button"
                          onClick={() => setSlipPreview(o.slipImageUrl!)}
                          title={t('orders.slipImageAria')}
                          aria-label={t('orders.slipImageAria')}
                          className={
                            'relative h-auto shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100 ring-brand-400/0 transition hover:ring-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:hover:ring-brand-400 ' +
                            (focus ? 'min-h-[6.25rem] w-[4.25rem]' : 'min-h-[4.5rem] w-12')
                          }
                        >
                          <img src={o.slipImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                          <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 to-transparent opacity-0 transition group-hover:opacity-100" />
                          <span
                            className={
                              'pointer-events-none absolute bottom-0.5 left-0.5 right-0.5 rounded bg-black/55 py-0.5 font-medium text-white opacity-0 transition group-hover:opacity-100 ' +
                              (focus ? 'text-[10px]' : 'text-[8px]')
                            }
                          >
                            {t('orders.slipImageAria')}
                          </span>
                        </button>
                      )}
                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex items-center justify-between">
                          <span
                            className={
                              focus
                                ? 'font-mono text-[13px] font-semibold text-slate-700 dark:text-slate-200'
                                : 'font-mono text-[11px] font-medium text-slate-500 dark:text-slate-400'
                            }
                          >
                            {o.id}
                          </span>
                          <ChannelIcon channel={o.channel} className={focus ? 'h-4 w-4' : 'h-3 w-3'} />
                        </div>
                        <div
                          className={
                            focus
                              ? 'mt-1 text-[15px] font-semibold leading-snug text-slate-900 dark:text-slate-100'
                              : 'mt-0.5 text-xs font-medium leading-tight text-slate-700 dark:text-slate-300'
                          }
                        >
                          {o.product}
                        </div>
                        <div
                          className={
                            focus ? 'mt-1 text-[13px] text-slate-500 dark:text-slate-400' : 'mt-0.5 text-[10px] text-slate-500 dark:text-slate-500'
                          }
                        >
                          x{o.qty} • {o.customer}
                        </div>
                        <div className={focus ? 'mt-2.5 flex items-end justify-between gap-1' : 'mt-1.5 flex items-end justify-between gap-1'}>
                          <div className="min-w-0">
                            <div
                              className={
                                focus
                                  ? 'text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100'
                                  : 'text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200'
                              }
                            >
                              ฿{o.amount.toLocaleString()}
                            </div>
                            <div
                              className={
                                focus ? 'text-[11px] text-slate-400 dark:text-slate-500' : 'text-[9px] text-slate-400 dark:text-slate-500'
                              }
                            >
                              {o.shop} • {t('orders.commission')} {o.commissionPct}%
                            </div>
                          </div>
                          {o.slipStatus === 'verified' && (
                            <span
                              className={
                                'chip shrink-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 ' +
                                (focus ? 'text-[11px]' : 'scale-90 text-[9px]')
                              }
                            >
                              <I.Check className={focus ? 'h-3 w-3' : 'h-2.5 w-2.5'} />
                              {t('orders.slipVerified')}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => goToChat(o)}
                          className={
                            'mt-auto w-full rounded-md border font-medium transition dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 ' +
                            (focus
                              ? 'border-slate-200 bg-slate-50 py-2 text-xs text-slate-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 dark:hover:border-brand-500 dark:hover:bg-brand-950/40 dark:hover:text-brand-300'
                              : 'border-slate-200/90 bg-slate-50/80 py-1 text-[10px] text-slate-600 hover:border-slate-300 hover:bg-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800')
                          }
                        >
                          {t('orders.goToChat')}
                        </button>
                      </div>
                    </div>
                  );
                })}
                {items.length === 0 && (
                  <div
                    className={
                      'flex min-w-full flex-1 items-center justify-center text-center text-slate-400 dark:text-slate-500 ' +
                      (focus ? 'min-h-[7rem] text-xs' : 'min-h-[4.5rem] text-[10px]')
                    }
                  >
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

function Header({
  t,
  filterOpen,
  onToggleFilter,
  filterWrapRef,
  filters,
  setFilters,
  onClearFilters,
  activeFilterCount,
  shops,
}: {
  t: (k: string, vars?: Record<string, string | number>) => string;
  filterOpen: boolean;
  onToggleFilter: () => void;
  filterWrapRef: RefObject<HTMLDivElement>;
  filters: OrderFiltersState;
  setFilters: Dispatch<SetStateAction<OrderFiltersState>>;
  onClearFilters: () => void;
  activeFilterCount: number;
  shops: string[];
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">{t('orders.title')}</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('orders.subtitle')}</p>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative" ref={filterWrapRef} data-order-filter="">
          <button
            type="button"
            onClick={onToggleFilter}
            aria-expanded={filterOpen}
            className="btn-secondary relative text-xs"
          >
            <I.Filter className="h-3.5 w-3.5" />
            {t('orders.filter')}
            {activeFilterCount > 0 && (
              <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white dark:bg-brand-500">
                {activeFilterCount > 9 ? '9+' : activeFilterCount}
              </span>
            )}
          </button>
          {filterOpen && (
            <div
              className="absolute right-0 z-[120] mt-2 w-[min(calc(100vw-2rem),20rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-600 dark:bg-slate-900"
              role="dialog"
              aria-label={t('orders.filter')}
            >
              <div className="max-h-[min(70vh,28rem)] space-y-2.5 overflow-y-auto pr-0.5">
                <label className="block">
                  <span className="mb-0.5 block text-[11px] font-medium text-slate-500 dark:text-slate-400">{t('orders.filter.product')}</span>
                  <input
                    type="search"
                    value={filters.product}
                    onChange={(e) => setFilters((f) => ({ ...f, product: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-900 outline-none ring-brand-400/0 focus:border-brand-400 focus:ring-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[11px] font-medium text-slate-500 dark:text-slate-400">{t('orders.filter.customer')}</span>
                  <input
                    type="search"
                    value={filters.customer}
                    onChange={(e) => setFilters((f) => ({ ...f, customer: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-brand-400 focus:ring-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[11px] font-medium text-slate-500 dark:text-slate-400">{t('orders.filter.shop')}</span>
                  <select
                    value={filters.shop}
                    onChange={(e) => setFilters((f) => ({ ...f, shop: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-brand-400 focus:ring-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="">{t('orders.filter.shopAll')}</option>
                    {shops.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[11px] font-medium text-slate-500 dark:text-slate-400">{t('orders.filter.channel')}</span>
                  <select
                    value={filters.channel}
                    onChange={(e) => setFilters((f) => ({ ...f, channel: e.target.value as 'all' | Channel }))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-brand-400 focus:ring-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="all">{t('orders.filter.channelAll')}</option>
                    <option value="line">{t('orders.filter.chLine')}</option>
                    <option value="facebook">{t('orders.filter.chFb')}</option>
                    <option value="ig">{t('orders.filter.chIg')}</option>
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] font-medium text-slate-500 dark:text-slate-400">{t('orders.filter.amountMin')}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={filters.minAmount}
                      onChange={(e) => setFilters((f) => ({ ...f, minAmount: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs tabular-nums text-slate-900 outline-none focus:border-brand-400 focus:ring-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] font-medium text-slate-500 dark:text-slate-400">{t('orders.filter.amountMax')}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={filters.maxAmount}
                      onChange={(e) => setFilters((f) => ({ ...f, maxAmount: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs tabular-nums text-slate-900 outline-none focus:border-brand-400 focus:ring-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] font-medium text-slate-500 dark:text-slate-400">{t('orders.filter.dateFrom')}</span>
                    <input
                      type="date"
                      value={filters.dateFrom}
                      onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-1.5 py-1.5 text-[11px] text-slate-900 outline-none focus:border-brand-400 focus:ring-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] font-medium text-slate-500 dark:text-slate-400">{t('orders.filter.dateTo')}</span>
                    <input
                      type="date"
                      value={filters.dateTo}
                      onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-1.5 py-1.5 text-[11px] text-slate-900 outline-none focus:border-brand-400 focus:ring-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="mb-0.5 block text-[11px] font-medium text-slate-500 dark:text-slate-400">{t('orders.filter.slip')}</span>
                  <select
                    value={filters.slip}
                    onChange={(e) => setFilters((f) => ({ ...f, slip: e.target.value as SlipFilterMode }))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-brand-400 focus:ring-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="all">{t('orders.filter.slipAll')}</option>
                    <option value="with_slip">{t('orders.filter.slipWith')}</option>
                    <option value="no_slip">{t('orders.filter.slipWithout')}</option>
                  </select>
                </label>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
                <button type="button" onClick={onClearFilters} className="btn-ghost text-xs text-slate-600 dark:text-slate-300">
                  {t('orders.filter.reset')}
                </button>
                <button type="button" onClick={onToggleFilter} className="btn-primary text-xs">
                  {t('orders.filter.close')}
                </button>
              </div>
            </div>
          )}
        </div>
        <button className="btn-primary text-xs">
          <I.Plus className="h-4 w-4" />
          {t('orders.create')}
        </button>
      </div>
    </div>
  );
}
