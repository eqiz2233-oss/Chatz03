import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type Ref,
  type SetStateAction,
} from 'react';
import { createPortal } from 'react-dom';
import { conversations as seedConversations, orders as seed } from '../../data/mockData';
import type { Channel, InboxFocusRequest, Order, OrderStatus } from '../../types';
import { ChannelIcon, I } from '../Icons';
import { useAppPreferences } from '../../context/AppPreferencesContext';
import { resolveConversationIdForOrder } from '../../lib/orderInbox';

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<OrderStatus, { labelKey: string; pillCls: string }> = {
  pending: {
    labelKey: 'orders.col.pending',
    pillCls:
      'bg-amber-500 text-white shadow-md ring-2 ring-amber-200/90 dark:bg-amber-500 dark:text-white dark:ring-amber-400/60',
  },
  paid: {
    labelKey: 'orders.col.paid',
    pillCls:
      'bg-blue-600 text-white shadow-md ring-2 ring-blue-200/90 dark:bg-blue-500 dark:text-white dark:ring-blue-400/60',
  },
  shipped: {
    labelKey: 'orders.col.shipped',
    pillCls:
      'bg-emerald-600 text-white shadow-md ring-2 ring-emerald-200/90 dark:bg-emerald-500 dark:text-white dark:ring-emerald-400/60',
  },
  cancelled: {
    labelKey: 'orders.col.cancelled',
    pillCls:
      'bg-slate-600 text-white shadow-md ring-2 ring-slate-300/80 dark:bg-slate-500 dark:text-white dark:ring-slate-400/50',
  },
};

// payment badge + fulfillment badge derived from single status
const PAYMENT_BADGE: Record<OrderStatus, { labelKey: string; cls: string }> = {
  pending:   { labelKey: 'orders.payment.pending',   cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800' },
  paid:      { labelKey: 'orders.payment.paid',      cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800' },
  shipped:   { labelKey: 'orders.payment.paid',      cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800' },
  cancelled: { labelKey: 'orders.payment.cancelled', cls: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700' },
};

const FULFILLMENT_BADGE: Record<OrderStatus, { labelKey: string; cls: string }> = {
  pending:   { labelKey: 'orders.fulfill.pending',   cls: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700' },
  paid:      { labelKey: 'orders.fulfill.unfulfilled', cls: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-800' },
  shipped:   { labelKey: 'orders.fulfill.fulfilled', cls: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-800' },
  cancelled: { labelKey: 'orders.fulfill.cancelled', cls: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700' },
};

// ─── Sort state ───────────────────────────────────────────────────────────────

type SortKey = 'product' | 'amount' | 'date' | 'customer' | 'status';
type SortDir = 'asc' | 'desc';

const STATUS_KEYS: OrderStatus[] = ['shipped', 'paid', 'pending', 'cancelled'];

// ─── Filter state ─────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function avatarColor(str: string) {
  const palette = [
    'bg-violet-500', 'bg-blue-500', 'bg-emerald-500',
    'bg-amber-500', 'bg-rose-500', 'bg-indigo-500', 'bg-teal-500',
  ];
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────

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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
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
        onClick={(e) => { e.stopPropagation(); onClose(); }}
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

// ─── Main view ────────────────────────────────────────────────────────────────

export function OrdersView({ onGoToChat }: { onGoToChat: (req: InboxFocusRequest) => void }) {
  const { t } = useAppPreferences();
  const [serverOrders, setServerOrders] = useState<Order[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const list = serverOrders ?? seed;
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<OrderFiltersState>(DEFAULT_ORDER_FILTERS);
  const [statusTab, setStatusTab] = useState<OrderStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const filterWrapRef = useRef<HTMLDivElement>(null);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const [filterPanelPos, setFilterPanelPos] = useState<{ top: number; right: number } | null>(null);

  const syncFilterPanelPos = useCallback(() => {
    const el = filterWrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setFilterPanelPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
  }, []);

  // Pull persisted orders from the backend on mount and after every create.
  const loadOrders = useCallback(async () => {
    try {
      const r = await fetch('/api/orders', { credentials: 'include' });
      if (!r.ok) return;
      const j = (await r.json()) as { items: Order[] };
      const items = Array.isArray(j.items) ? j.items : [];
      // Only override seed when the server actually has data
      if (items.length > 0) setServerOrders(items);
    } catch {
      /* offline or auth gate — fall back to seed */
    }
  }, []);

  useEffect(() => { void loadOrders(); }, [loadOrders]);

  const onCreateOrder = useCallback(
    async (draft: Omit<Order, 'id' | 'createdAt'>) => {
      const order: Order = { ...draft, id: '', createdAt: new Date().toISOString() } as Order;
      const r = await fetch('/api/orders', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error((j as { error?: string })?.error || `HTTP ${r.status}`);
      }
      await loadOrders();
    },
    [loadOrders],
  );

  const baseFiltered = useMemo(
    () => list.filter((o) => orderMatchesFilters(o, filters)),
    [list, filters],
  );

  const searchFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return baseFiltered;

    // Amount range: "500-1000" or ">500" or "<1000"
    const rangeMatch = q.match(/^([<>])\s*(\d[\d,]*)$/) ?? q.match(/^(\d[\d,]*)\s*-\s*(\d[\d,]*)$/);

    return baseFiltered.filter((o) => {
      // Order ID / customer / product text
      if (
        o.customer.toLowerCase().includes(q) ||
        o.product.toLowerCase().includes(q) ||
        o.id.toLowerCase().includes(q) ||
        o.shop.toLowerCase().includes(q)
      ) return true;

      // Exact amount or amount range  e.g. "890", ">500", "<2000", "500-1000"
      const amt = o.amount;
      const plain = q.replace(/[,฿\s]/g, '');
      if (/^\d+$/.test(plain) && amt === Number(plain)) return true;
      if (rangeMatch) {
        if (rangeMatch[1] === '>') return amt > Number(rangeMatch[2].replace(/,/g, ''));
        if (rangeMatch[1] === '<') return amt < Number(rangeMatch[2].replace(/,/g, ''));
        // "min-max"
        const lo = Number(rangeMatch[1].replace(/,/g, ''));
        const hi = Number(rangeMatch[2].replace(/,/g, ''));
        if (!Number.isNaN(lo) && !Number.isNaN(hi)) return amt >= lo && amt <= hi;
      }

      // Date: full "2026-05-10", partial month "05-10" or "05/10", or year "2026"
      const dateStr = o.orderDate ?? o.createdAt?.slice(0, 10) ?? '';
      if (dateStr && dateStr.includes(q.replace(/\//g, '-'))) return true;
      if (/^\d{4}$/.test(q) && dateStr.startsWith(q)) return true;

      return false;
    });
  }, [baseFiltered, search]);

  const displayed = useMemo(() => {
    const base = statusTab === 'all' ? searchFiltered : searchFiltered.filter((o) => o.status === statusTab);
    return [...base].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'product') cmp = a.product.localeCompare(b.product, 'th');
      else if (sortKey === 'amount') cmp = a.amount - b.amount;
      else if (sortKey === 'date') cmp = (a.orderDate ?? a.createdAt ?? '').localeCompare(b.orderDate ?? b.createdAt ?? '');
      else if (sortKey === 'customer') cmp = a.customer.localeCompare(b.customer);
      else if (sortKey === 'status') cmp = a.status.localeCompare(b.status);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [searchFiltered, statusTab, sortKey, sortDir]);

  const countByStatus = useMemo(() => {
    const m: Record<OrderStatus | 'all', number> = { all: 0, pending: 0, paid: 0, shipped: 0, cancelled: 0 };
    for (const o of searchFiltered) { m[o.status]++; m.all++; }
    return m;
  }, [searchFiltered]);

  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters]);
  const shops = useMemo(() => [...new Set(list.map((o) => o.shop))].sort(), [list]);

  useLayoutEffect(() => {
    if (!filterOpen) {
      setFilterPanelPos(null);
      return;
    }
    syncFilterPanelPos();
  }, [filterOpen, syncFilterPanelPos]);

  useEffect(() => {
    if (!filterOpen) return;
    const on = () => {
      syncFilterPanelPos();
    };
    window.addEventListener('resize', on);
    window.addEventListener('scroll', on, true);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('scroll', on, true);
    };
  }, [filterOpen, syncFilterPanelPos]);

  useEffect(() => {
    if (!filterOpen) return;
    const close = (ev: PointerEvent) => {
      const t = ev.target as Node;
      if (filterWrapRef.current?.contains(t)) return;
      if (filterPanelRef.current?.contains(t)) return;
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

  const clearFilters = useCallback(() => setFilters({ ...DEFAULT_ORDER_FILTERS }), []);

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); return key; }
      setSortDir('desc');
      return key;
    });
  }, []);

  const displayedIds = useMemo(() => displayed.map((o) => o.id), [displayed]);
  const allSelected = displayedIds.length > 0 && displayedIds.every((id) => selected.has(id));
  const someSelected = !allSelected && displayedIds.some((id) => selected.has(id));

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      if (allSelected) {
        const next = new Set(prev);
        displayedIds.forEach((id) => next.delete(id));
        return next;
      }
      const next = new Set(prev);
      displayedIds.forEach((id) => next.add(id));
      return next;
    });
  }, [allSelected, displayedIds]);

  const toggleSelectOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectedIds = useMemo(() => [...selected].filter((id) => displayedIds.includes(id)), [selected, displayedIds]);

  const bulkChangeStatus = useCallback((status: OrderStatus) => {
    if (serverOrders) {
      setServerOrders((prev) => prev!.map((o) => selectedIds.includes(o.id) ? { ...o, status } : o));
    }
    setSelected(new Set());
  }, [selectedIds, serverOrders]);

  const bulkDelete = useCallback(() => {
    const label = selectedIds.length === 1 ? '1 ออเดอร์' : `${selectedIds.length} ออเดอร์`;
    if (!window.confirm(`ลบ ${label} ที่เลือกทั้งหมดใช่หรือไม่?`)) return;
    if (serverOrders) {
      setServerOrders((prev) => prev!.filter((o) => !selectedIds.includes(o.id)));
    }
    setSelected(new Set());
  }, [selectedIds, serverOrders]);

  // Stat counts
  const paidShippedCount = useMemo(() => searchFiltered.filter((o) => o.status === 'shipped').length, [searchFiltered]);
  const pendingCount = countByStatus.pending;
  const cancelledCount = countByStatus.cancelled;
  const paidNotShippedCount = useMemo(() => searchFiltered.filter((o) => o.status === 'paid').length, [searchFiltered]);

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden bg-[#f4f3f8] dark:bg-slate-950">
      {slipPreview && (
        <SlipImageLightbox src={slipPreview} onClose={() => setSlipPreview(null)} t={t} />
      )}
      {createOpen && (
        <CreateOrderModal
          t={t}
          shops={shops}
          onClose={() => setCreateOpen(false)}
          onSubmit={async (draft) => { await onCreateOrder(draft); setCreateOpen(false); }}
        />
      )}

      {/* ── Top bar ── */}
      <div className="shrink-0 border-b border-slate-200/80 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              {t('orders.title')}
            </h1>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              {t('orders.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="btn-primary gap-2"
          >
            <I.Plus className="h-4 w-4" />
            {t('orders.create')}
          </button>
        </div>

        {/* Stat cards */}
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-3">
          <StatCard
            icon={<I.Receipt className="h-5 w-5 text-brand-600 dark:text-brand-400" />}
            iconBg="bg-brand-50 ring-brand-200/80 dark:bg-brand-950/40 dark:ring-brand-800"
            label="ออเดอร์ทั้งหมด"
            value={countByStatus.all}
            onClick={() => setStatusTab('all')}
          />
          <StatCard
            icon={<I.Truck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />}
            iconBg="bg-emerald-50 ring-emerald-200/80 dark:bg-emerald-950/40 dark:ring-emerald-800"
            label="จัดส่งแล้ว"
            value={paidShippedCount}
            valueClass="text-emerald-600 dark:text-emerald-400"
            onClick={() => setStatusTab('shipped')}
          />
          <StatCard
            icon={<I.Bell className="h-5 w-5 text-amber-600 dark:text-amber-400" />}
            iconBg="bg-amber-50 ring-amber-200/80 dark:bg-amber-950/40 dark:ring-amber-800"
            label="ยังไม่จัดส่ง"
            value={paidNotShippedCount}
            valueClass={paidNotShippedCount > 0 ? 'text-amber-600 dark:text-amber-400' : undefined}
            onClick={() => setStatusTab('paid')}
          />
        </div>
      </div>

      {/* ── Status tabs (own row, underline style) ── */}
      <div className="shrink-0 border-b border-slate-200/80 bg-white px-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-end gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(
            [
              { key: 'all' as const, label: t('orders.tab.all') },
              ...STATUS_KEYS.map((k) => ({ key: k, label: t(STATUS_CONFIG[k].labelKey) })),
            ] as { key: OrderStatus | 'all'; label: string }[]
          ).map(({ key, label }) => {
            const isActive = statusTab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setStatusTab(key)}
                className={
                  'flex shrink-0 items-center gap-2 border-b-2 px-4 pb-3 pt-3.5 text-sm font-medium transition-colors ' +
                  (isActive
                    ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200')
                }
              >
                {label}
                <span className={
                  'text-sm font-semibold tabular-nums ' +
                  (isActive ? 'text-brand-700 dark:text-brand-300' : 'text-slate-400 dark:text-slate-500')
                }>
                  {countByStatus[key]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Filter + search bar ── */}
      <div className="shrink-0 border-b border-slate-200/60 bg-white px-6 py-2.5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <I.Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('orders.search')}
                title={t('orders.search')}
                className="w-64 rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-slate-900 outline-none focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:bg-slate-900 dark:focus:ring-brand-900/40"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  aria-label="ล้างค้นหา"
                >
                  <I.X className="h-3 w-3" />
                </button>
              )}
            </div>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-500 transition hover:bg-slate-50 hover:text-rose-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-rose-400"
              >
                <I.X className="h-3 w-3" />
                {t('orders.filter.reset')}
              </button>
            )}
            <div className="relative shrink-0" ref={filterWrapRef}>
              <button
                type="button"
                onClick={() => setFilterOpen((v) => !v)}
                aria-expanded={filterOpen}
                className={
                  'relative flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ' +
                  (activeFilterCount > 0
                    ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800')
                }
              >
                <I.Filter className="h-3.5 w-3.5" />
                {t('orders.filter')}
                {activeFilterCount > 0 && (
                  <span className="grid h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
                    {activeFilterCount > 9 ? '9+' : activeFilterCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
      {filterOpen &&
        filterPanelPos != null &&
        createPortal(
          <FilterPanel
            panelRef={filterPanelRef}
            fixedStyle={filterPanelPos}
            t={t}
            filters={filters}
            setFilters={setFilters}
            onClear={clearFilters}
            onClose={() => setFilterOpen(false)}
            shops={shops}
          />,
          document.body,
        )}

      {/* ── Bulk action bar ── */}
      {selectedIds.length > 0 && (
        <div className="shrink-0 border-b border-brand-200 bg-brand-50 px-6 py-2.5 dark:border-brand-800 dark:bg-brand-950/40">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-brand-700 dark:text-brand-300">
              เลือก {selectedIds.length} รายการ
            </span>
            <span className="h-4 w-px bg-brand-300 dark:bg-brand-700" />
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">เปลี่ยนสถานะ:</span>
            {STATUS_KEYS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => bulkChangeStatus(s)}
                className={
                  'inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-bold transition hover:opacity-90 ' +
                  STATUS_CONFIG[s].pillCls
                }
              >
                {t(STATUS_CONFIG[s].labelKey)}
              </button>
            ))}
            <span className="h-4 w-px bg-brand-300 dark:bg-brand-700" />
            <button
              type="button"
              onClick={bulkDelete}
              className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 dark:border-rose-800 dark:bg-slate-900 dark:text-rose-400 dark:hover:bg-rose-950/40"
            >
              <I.Trash2 className="h-3.5 w-3.5" />
              ลบที่เลือก
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="ml-auto text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {/* ── Table ── */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[820px] border-collapse">
          <thead className="sticky top-0 z-10 bg-[#f0eff6] dark:bg-slate-900">
            <tr className="text-left">
              {/* Select-all checkbox */}
              <th className="w-12 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-brand-600 dark:border-slate-600"
                  aria-label="เลือกทั้งหมด"
                />
              </th>
              {(
                [
                  { key: 'customer' as SortKey, label: t('orders.th.customer'), cls: '' },
                  { key: 'product' as SortKey,  label: t('orders.th.product'),  cls: 'min-w-[14rem]' },
                  { key: 'status' as SortKey,   label: t('orders.th.status'),   cls: 'min-w-[10rem]' },
                  { key: 'amount' as SortKey,   label: t('orders.th.amount'),   cls: 'w-28 text-right' },
                  { key: 'date' as SortKey,     label: t('orders.th.date'),     cls: 'w-28' },
                ] as { key: SortKey | null; label: string; cls: string }[]
              ).map((col, i) => (
                <th
                  key={i}
                  onClick={col.key ? () => toggleSort(col.key!) : undefined}
                  className={
                    'border-b border-slate-200 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:text-slate-500 ' +
                    col.cls +
                    (col.key ? ' cursor-pointer select-none hover:text-slate-600 dark:hover:text-slate-300' : '')
                  }
                >
                  {col.label && (
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {col.key && <SortIcon active={sortKey === col.key} dir={sortDir} />}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800/60 dark:bg-slate-900">
            {displayed.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center text-sm text-slate-400 dark:text-slate-500">
                  {t('orders.empty')}
                </td>
              </tr>
            ) : (
              displayed.map((o) => (
                <OrderRow
                  key={o.id}
                  order={o}
                  isSelected={selected.has(o.id)}
                  onToggleSelect={() => toggleSelectOne(o.id)}
                  t={t}
                  onGoToChat={goToChat}
                  onSlipPreview={setSlipPreview}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  icon,
  iconBg,
  label,
  value,
  valueClass,
  onClick,
}: {
  icon: React.ReactNode;
  iconBg?: string;
  label: string;
  value: number;
  valueClass?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-slate-200/80 bg-slate-50/60 px-4 py-3 text-left transition-all hover:border-slate-300 hover:bg-white hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:bg-slate-800/70 dark:focus-visible:ring-brand-500 dark:focus-visible:ring-offset-slate-900"
    >
      <div className={'grid h-10 w-10 shrink-0 place-items-center rounded-xl shadow-sm ring-1 ' + (iconBg ?? 'bg-white ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-700')}>
        {icon}
      </div>
      <div>
        <div className={'text-2xl font-extrabold tabular-nums leading-tight ' + (valueClass ?? 'text-slate-900 dark:text-white')}>
          {value}
        </div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400">{label}</div>
      </div>
    </button>
  );
}

// ─── Sort icon ────────────────────────────────────────────────────────────────

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className="inline-flex flex-col leading-none">
      <svg width="7" height="5" viewBox="0 0 7 5" className={active && dir === 'asc' ? 'text-brand-500' : 'text-slate-300 dark:text-slate-600'}>
        <path d="M3.5 0L7 5H0L3.5 0z" fill="currentColor" />
      </svg>
      <svg width="7" height="5" viewBox="0 0 7 5" className={active && dir === 'desc' ? 'text-brand-500' : 'text-slate-300 dark:text-slate-600'}>
        <path d="M3.5 5L0 0H7L3.5 5z" fill="currentColor" />
      </svg>
    </span>
  );
}

// ─── Customer short-ID ────────────────────────────────────────────────────────

function shortId(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return `CST-${(h % 900) + 100}`;
}

function OrderProductThumb({ url }: { url?: string }) {
  const [ok, setOk] = useState(Boolean(url));
  useEffect(() => {
    setOk(Boolean(url));
  }, [url]);

  return (
    <div className="grid h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
      {url && ok ? (
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setOk(false)}
        />
      ) : (
        <span className="grid h-full w-full place-items-center text-slate-400 dark:text-slate-500" aria-hidden>
          <I.Box className="h-5 w-5" />
        </span>
      )}
    </div>
  );
}

// ─── Table row ────────────────────────────────────────────────────────────────

function OrderRow({
  order: o,
  isSelected,
  onToggleSelect,
  t,
  onGoToChat,
  onSlipPreview,
}: {
  order: Order;
  isSelected: boolean;
  onToggleSelect: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onGoToChat: (o: Order) => void;
  onSlipPreview: (url: string) => void;
}) {
  const hasSlipImg = Boolean(o.slipImageUrl?.trim());
  const cstId = shortId(o.customer + o.shop);
  const payBadge = PAYMENT_BADGE[o.status];

  return (
    <tr className={
      'group transition-colors ' +
      (isSelected ? 'bg-brand-50/60 dark:bg-brand-950/30' : 'hover:bg-brand-50/30 dark:hover:bg-brand-950/20')
    }>
      {/* Checkbox */}
      <td className="px-4 py-4">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-brand-600 dark:border-slate-600"
          aria-label={`เลือก ${o.customer}`}
        />
      </td>

      {/* Customer — channel icon opens chat */}
      <td className="px-4 py-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onGoToChat(o)}
            title={t('orders.goToChat')}
            aria-label={`${t('orders.goToChat')} — ${o.customer}`}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 transition hover:bg-brand-100 hover:ring-2 hover:ring-brand-300 dark:bg-slate-800 dark:hover:bg-brand-900/50 dark:hover:ring-brand-700"
          >
            <ChannelIcon channel={o.channel} className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{o.customer}</div>
            <div className="font-mono text-[11px] text-slate-400 dark:text-slate-500">{cstId}</div>
          </div>
        </div>
      </td>

      {/* Product + order ID — whole cell opens chat */}
      <td className="p-0">
        <button
          type="button"
          onClick={() => onGoToChat(o)}
          title={t('orders.goToChat')}
          aria-label={`${t('orders.goToChat')} — ${o.product}`}
          className="flex w-full min-w-0 items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-brand-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400 dark:hover:bg-brand-950/30 dark:focus-visible:ring-brand-500"
        >
          <OrderProductThumb url={o.productImageUrl} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
              {o.product}
              {o.qty > 1 ? (
                <span className="ml-1.5 font-normal text-slate-500 dark:text-slate-400">×{o.qty}</span>
              ) : null}
            </div>
            <div className="font-mono text-[11px] text-slate-400 dark:text-slate-500">{o.id}</div>
          </div>
        </button>
      </td>

      {/* Status — high-contrast pill (primary scan target) */}
      <td className="px-4 py-4">
        <div className="flex flex-col items-start gap-1.5">
          <span
            className={
              'inline-flex max-w-full items-center whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-bold leading-none tracking-tight ' +
              STATUS_CONFIG[o.status].pillCls
            }
          >
            {t(STATUS_CONFIG[o.status].labelKey)}
          </span>
          {hasSlipImg && (
            <button
              type="button"
              onClick={() => onSlipPreview(o.slipImageUrl!)}
              title={t('orders.slipImageAria')}
              className="inline-flex w-fit items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 transition hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-400"
            >
              <I.Image className="h-2.5 w-2.5" />
              {o.slipStatus === 'verified' ? t('orders.slipVerified') : 'สลิป'}
            </button>
          )}
        </div>
      </td>

      {/* Amount */}
      <td className="px-4 py-4 text-right">
        <div className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
          ฿{o.amount.toLocaleString()}
        </div>
        <div className="text-[11px] text-slate-400 dark:text-slate-500">
          {t(payBadge.labelKey)}
        </div>
      </td>

      {/* Date */}
      <td className="px-4 py-4">
        <span className="text-[12px] text-slate-600 dark:text-slate-400">
          {o.orderDate ?? o.createdAt?.slice(0, 10) ?? '—'}
        </span>
      </td>
    </tr>
  );
}

// ─── Advanced filter panel ────────────────────────────────────────────────────

function FilterPanel({
  panelRef,
  fixedStyle,
  t,
  filters,
  setFilters,
  onClear,
  onClose,
  shops,
}: {
  panelRef: Ref<HTMLDivElement>;
  fixedStyle: { top: number; right: number };
  t: (k: string, vars?: Record<string, string | number>) => string;
  filters: OrderFiltersState;
  setFilters: Dispatch<SetStateAction<OrderFiltersState>>;
  onClear: () => void;
  onClose: () => void;
  shops: string[];
}) {
  const inputCls =
    'w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-brand-400 focus:ring-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

  return (
    <div
      ref={panelRef}
      style={{ top: fixedStyle.top, right: fixedStyle.right }}
      className="fixed z-[195] w-[min(calc(100vw-2rem),20rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-600 dark:bg-slate-900"
      role="dialog"
      aria-label={t('orders.filter')}
    >
      <div className="max-h-[min(70vh,28rem)] space-y-2.5 overflow-y-auto pr-0.5">
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-slate-500 dark:text-slate-400">{t('orders.filter.product')}</span>
          <input type="search" value={filters.product} onChange={(e) => setFilters((f) => ({ ...f, product: e.target.value }))} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-slate-500 dark:text-slate-400">{t('orders.filter.customer')}</span>
          <input type="search" value={filters.customer} onChange={(e) => setFilters((f) => ({ ...f, customer: e.target.value }))} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-slate-500 dark:text-slate-400">{t('orders.filter.shop')}</span>
          <select value={filters.shop} onChange={(e) => setFilters((f) => ({ ...f, shop: e.target.value }))} className={inputCls}>
            <option value="">{t('orders.filter.shopAll')}</option>
            {shops.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-slate-500 dark:text-slate-400">{t('orders.filter.channel')}</span>
          <select value={filters.channel} onChange={(e) => setFilters((f) => ({ ...f, channel: e.target.value as 'all' | Channel }))} className={inputCls}>
            <option value="all">{t('orders.filter.channelAll')}</option>
            <option value="line">{t('orders.filter.chLine')}</option>
            <option value="facebook">{t('orders.filter.chFb')}</option>
            <option value="ig">{t('orders.filter.chIg')}</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-medium text-slate-500 dark:text-slate-400">{t('orders.filter.amountMin')}</span>
            <input type="number" inputMode="numeric" min={0} value={filters.minAmount} onChange={(e) => setFilters((f) => ({ ...f, minAmount: e.target.value }))} className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-medium text-slate-500 dark:text-slate-400">{t('orders.filter.amountMax')}</span>
            <input type="number" inputMode="numeric" min={0} value={filters.maxAmount} onChange={(e) => setFilters((f) => ({ ...f, maxAmount: e.target.value }))} className={inputCls} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-medium text-slate-500 dark:text-slate-400">{t('orders.filter.dateFrom')}</span>
            <input type="date" value={filters.dateFrom} onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} className={inputCls + ' text-[11px]'} />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-medium text-slate-500 dark:text-slate-400">{t('orders.filter.dateTo')}</span>
            <input type="date" value={filters.dateTo} onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} className={inputCls + ' text-[11px]'} />
          </label>
        </div>
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-slate-500 dark:text-slate-400">{t('orders.filter.slip')}</span>
          <select value={filters.slip} onChange={(e) => setFilters((f) => ({ ...f, slip: e.target.value as SlipFilterMode }))} className={inputCls}>
            <option value="all">{t('orders.filter.slipAll')}</option>
            <option value="with_slip">{t('orders.filter.slipWith')}</option>
            <option value="no_slip">{t('orders.filter.slipWithout')}</option>
          </select>
        </label>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
        <button type="button" onClick={onClear} className="btn-ghost text-xs text-slate-600 dark:text-slate-300">
          {t('orders.filter.reset')}
        </button>
        <button type="button" onClick={onClose} className="btn-primary text-xs">
          {t('orders.filter.close')}
        </button>
      </div>
    </div>
  );
}

// ─── Create order modal ───────────────────────────────────────────────────────

function CreateOrderModal({
  t,
  shops,
  onClose,
  onSubmit,
}: {
  t: (k: string, vars?: Record<string, string | number>) => string;
  shops: string[];
  onClose: () => void;
  onSubmit: (draft: Omit<Order, 'id' | 'createdAt'>) => Promise<void>;
}) {
  const [customer, setCustomer] = useState('');
  const [product, setProduct] = useState('');
  const [qty, setQty] = useState('1');
  const [amount, setAmount] = useState('');
  const [channel, setChannel] = useState<Channel>('line');
  const [shop, setShop] = useState(shops[0] || '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer.trim() || !product.trim() || !amount.trim()) {
      setErr(t('orders.create.required'));
      return;
    }
    const amt = Number(amount.replace(/,/g, ''));
    if (!Number.isFinite(amt) || amt < 0) {
      setErr(t('orders.create.required'));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onSubmit({
        customer: customer.trim(),
        product: product.trim(),
        qty: Math.max(1, Number(qty) || 1),
        amount: amt,
        channel,
        status: 'pending',
        shop: shop.trim() || 'My Shop',
        commissionPct: 0,
        orderDate: new Date().toISOString().slice(0, 10),
      });
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[200] grid place-items-center bg-slate-900/40 px-4 backdrop-blur-sm dark:bg-black/60">
      <form
        onSubmit={submit}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t('orders.create.title')}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <I.X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 p-5 text-sm">
          <Field label={t('orders.create.customer')}>
            <input autoFocus value={customer} onChange={(e) => setCustomer(e.target.value)} className="input" required />
          </Field>
          <Field label={t('orders.create.product')}>
            <input value={product} onChange={(e) => setProduct(e.target.value)} className="input" required />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Qty">
              <input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} className="input" />
            </Field>
            <Field label={t('orders.create.amount')}>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" required />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('orders.create.channel')}>
              <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)} className="input">
                <option value="line">LINE</option>
                <option value="facebook">Facebook</option>
                <option value="ig">Instagram</option>
              </select>
            </Field>
            <Field label={t('orders.create.shop')}>
              <input value={shop} onChange={(e) => setShop(e.target.value)} className="input" placeholder="My Shop" />
            </Field>
          </div>
          <Field label={t('orders.create.notes')}>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input" />
          </Field>
          {err && (
            <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{err}</div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-900/60">
          <button type="button" onClick={onClose} className="btn-secondary text-xs">{t('orders.create.cancel')}</button>
          <button type="submit" disabled={busy} className="btn-primary text-xs disabled:opacity-60">
            {busy ? '…' : t('orders.create.save')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      {children}
    </label>
  );
}
