import { useEffect, useMemo, useState } from 'react';
import { I } from '../Icons';
import { SlipCard } from '../inbox/SlipCard';
import type { SlipResult } from '../../types';
import { useAppPreferences } from '../../context/AppPreferencesContext';

interface SlipApiRow {
  id: string;
  channel: 'line' | 'fb' | 'ig';
  conversationId: string;
  messageId: string;
  customerName: string;
  customerAvatar: string;
  imageUrl: string | null;
  receivedAt: string; // ISO
  result: SlipResult;
}

interface SlipsApiResponse {
  slips: SlipApiRow[];
  stats: {
    total: number;
    today: number;
    verified: number;
    pending: number;
    flagged: number;
    enabled: boolean;
  };
}

function formatClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Bangkok',
    });
  } catch {
    return '';
  }
}

function channelLabel(ch: SlipApiRow['channel']): string {
  if (ch === 'line') return 'LINE';
  if (ch === 'ig') return 'Instagram';
  return 'Facebook';
}

type SlipAction = { slipId: string; action: 'confirm' | 'reject'; byUser: string | null; at: string };

export function SlipsView() {
  const { t } = useAppPreferences();
  const [data, setData] = useState<SlipsApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actions, setActions] = useState<Record<string, SlipAction>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reverifying, setReverifying] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2500);
  };

  const loadActions = async () => {
    try {
      const r = await fetch('/api/slips/actions', { credentials: 'include' });
      if (!r.ok) return;
      const j = (await r.json()) as { actions: Record<string, SlipAction> };
      setActions(j.actions || {});
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch('/api/slips', { credentials: 'include' });
        if (!r.ok) throw new Error(String(r.status));
        const json = (await r.json()) as SlipsApiResponse;
        if (cancelled) return;
        setData(json);
        setErr(null);
        setLoading(false);
        // Pick first slip on first load.
        setSelectedId((cur) => cur ?? json.slips[0]?.id ?? null);
      } catch (e) {
        if (cancelled) return;
        setErr(String((e as Error).message || e));
        setLoading(false);
      }
    };
    void load();
    void loadActions();
    const id = window.setInterval(() => {
      void load();
      void loadActions();
    }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const onConfirm = async (id: string) => {
    setBusyId(id);
    try {
      const r = await fetch(`/api/slips/${encodeURIComponent(id)}/confirm`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        showToast(t('slips.actionFailed', { msg: j?.error || `HTTP ${r.status}` }));
      } else {
        showToast(t('slips.confirmed'));
        await loadActions();
      }
    } finally {
      setBusyId(null);
    }
  };

  const onReject = async (id: string) => {
    setBusyId(id);
    try {
      const r = await fetch(`/api/slips/${encodeURIComponent(id)}/reject`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        showToast(t('slips.actionFailed', { msg: j?.error || `HTTP ${r.status}` }));
      } else {
        showToast(t('slips.rejected'));
        await loadActions();
      }
    } finally {
      setBusyId(null);
    }
  };

  const onReverifyAll = async () => {
    if (reverifying) return;
    setReverifying(true);
    try {
      const r = await fetch('/api/slips/reverify-all', {
        method: 'POST',
        credentials: 'include',
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        showToast(t('slips.actionFailed', { msg: j?.error || `HTTP ${r.status}` }));
      } else {
        const j = (await r.json()) as { attempted: number };
        showToast(t('slips.reverifyDone', { n: j.attempted }));
      }
    } finally {
      setReverifying(false);
    }
  };

  const slips = data?.slips ?? [];
  const stats = data?.stats;
  const selected = useMemo(
    () => slips.find((s) => s.id === selectedId) ?? slips[0] ?? null,
    [slips, selectedId],
  );

  return (
    <div className="relative flex h-screen flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      {toast && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-slate-900/90 px-4 py-2 text-xs font-medium text-white shadow-lg shadow-slate-900/30 backdrop-blur dark:bg-white/95 dark:text-slate-900">
          {toast}
        </div>
      )}
      <div className="border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">{t('slips.title')}</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('slips.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <ModeBadge enabled={stats?.enabled ?? false} t={t} />
            <button
              type="button"
              onClick={onReverifyAll}
              disabled={reverifying}
              className="btn-primary text-xs disabled:cursor-not-allowed disabled:opacity-60"
            >
              <I.Shield className="h-4 w-4" />
              {reverifying ? t('slips.reverifying') : t('slips.reverifyAll')}
            </button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-3">
          <Stat label={t('slips.statToday')} value={String(stats?.today ?? 0)} icon={<I.Receipt className="h-4 w-4" />} tone="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" />
          <Stat label={t('slips.statVerified')} value={String(stats?.verified ?? 0)} icon={<I.Check className="h-4 w-4" />} tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" />
          <Stat label={t('slips.statPending')} value={String(stats?.pending ?? 0)} icon={<I.Sparkle className="h-4 w-4" />} tone="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200" />
          <Stat label={t('slips.statFlagged')} value={String(stats?.flagged ?? 0)} icon={<I.Shield className="h-4 w-4" />} tone="bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" />
        </div>
      </div>

      {loading && !data ? (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-500 dark:text-slate-400">{t('slips.loading')}</div>
      ) : err ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-rose-600 dark:text-rose-300">
          {t('slips.errFetch', { msg: err })}
        </div>
      ) : slips.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-8 text-center">
          <div className="max-w-md text-sm text-slate-500 dark:text-slate-400">
            <div className="mb-3 grid h-12 w-12 mx-auto place-items-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
              <I.Receipt className="h-5 w-5" />
            </div>
            {t('slips.empty')}
          </div>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-[1.5fr,1fr] gap-0 overflow-hidden">
          <div className="overflow-y-auto p-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  <th className="px-3 pb-2 font-semibold">{t('slips.thCustomer')}</th>
                  <th className="px-3 pb-2 font-semibold">{t('slips.thChannel')}</th>
                  <th className="px-3 pb-2 font-semibold">{t('slips.thAmount')}</th>
                  <th className="px-3 pb-2 font-semibold">{t('slips.thBank')}</th>
                  <th className="px-3 pb-2 font-semibold">{t('slips.thTime')}</th>
                  <th className="px-3 pb-2 font-semibold">{t('slips.thStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {slips.map((s) => {
                  const isActive = selected?.id === s.id;
                  return (
                    <tr
                      key={s.id}
                      onClick={() => setSelectedId(s.id)}
                      className={
                        'cursor-pointer border-b border-slate-100 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50 ' +
                        (isActive ? 'bg-brand-50/40 dark:bg-brand-950/25' : '')
                      }
                    >
                      <td className="px-3 py-3 font-medium text-slate-900 dark:text-slate-100">{s.customerName}</td>
                      <td className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">{channelLabel(s.channel)}</td>
                      <td className="px-3 py-3 font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {typeof s.result.amount === 'number' ? `฿${s.result.amount.toLocaleString()}` : '—'}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">{s.result.bank ?? '—'}</td>
                      <td className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">{formatClock(s.receivedAt)}</td>
                      <td className="px-3 py-3">
                        <StatusPill status={s.result.status} t={t} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="overflow-y-auto border-l border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            {selected ? (
              <>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t('slips.preview')}</div>
                <div className="mt-3 flex justify-center">
                  {selected.imageUrl ? (
                    <img
                      src={selected.imageUrl}
                      alt=""
                      className="max-h-72 w-auto rounded-xl border border-slate-200 object-contain dark:border-slate-700"
                    />
                  ) : (
                    <SlipCard slip={selected.result} />
                  )}
                </div>
                <div className="mt-5 space-y-2 text-xs">
                  <Detail label={t('slips.detail.customer')} value={selected.customerName} />
                  <Detail label={t('slips.detail.channel')} value={channelLabel(selected.channel)} />
                  <Detail label={t('slips.detail.received')} value={formatClock(selected.receivedAt)} />
                  <Detail label={t('slips.detail.amount')} value={typeof selected.result.amount === 'number' ? `฿${selected.result.amount.toLocaleString()}` : '—'} />
                  <Detail label={t('slips.detail.bank')} value={selected.result.bank ?? '—'} />
                  <Detail label={t('slips.detail.ref')} value={selected.result.ref ?? '—'} mono />
                  {selected.result.senderName && <Detail label={t('slips.detail.sender')} value={selected.result.senderName} />}
                  {selected.result.receiverName && <Detail label={t('slips.detail.receiver')} value={selected.result.receiverName} />}
                </div>
                {selected.result.reason && (
                  <div className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
                    {selected.result.reason}
                  </div>
                )}
                {actions[selected.id] && (
                  <div
                    className={
                      'mt-4 rounded-lg px-3 py-2 text-xs ' +
                      (actions[selected.id].action === 'confirm'
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'
                        : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-200')
                    }
                  >
                    {actions[selected.id].action === 'confirm' ? t('slips.confirmed') : t('slips.rejected')}
                    {actions[selected.id].byUser ? ` • ${actions[selected.id].byUser}` : ''}
                  </div>
                )}
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onReject(selected.id)}
                    disabled={busyId === selected.id}
                    className="btn-secondary text-xs disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <I.X className="h-4 w-4" />
                    {t('slips.reject')}
                  </button>
                  <button
                    type="button"
                    onClick={() => onConfirm(selected.id)}
                    disabled={busyId === selected.id}
                    className="btn-primary text-xs disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <I.Check className="h-4 w-4" />
                    {t('slips.confirm')}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function ModeBadge({ enabled, t }: { enabled: boolean; t: (k: string) => string }) {
  const cls = enabled
    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
    : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200';
  return (
    <span
      title={enabled ? t('slips.modeReal') : t('slips.modeMock')}
      className={'hidden whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-medium sm:inline-flex ' + cls}
    >
      {enabled ? 'EasySlip' : 'Demo'}
    </span>
  );
}

function Stat({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center gap-2">
        <span className={'grid h-7 w-7 place-items-center rounded-md ' + tone}>{icon}</span>
        <div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">{label}</div>
          <div className="text-lg font-semibold leading-none tabular-nums text-slate-900 dark:text-white">{value}</div>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status, t }: { status: SlipResult['status']; t: (k: string) => string }) {
  const map = {
    verified: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200',
    failed: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    duplicate: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-200',
  } as const;
  const labelKey = `slips.status.${status}` as const;
  return <span className={'chip ' + map[status]}>{t(labelKey)}</span>;
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 pb-2 dark:border-slate-800">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className={(mono ? 'font-mono ' : '') + 'text-right font-medium text-slate-700 dark:text-slate-200'}>{value}</span>
    </div>
  );
}
