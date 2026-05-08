import { useCallback, useEffect, useMemo, useState } from 'react';
import { I } from '../Icons';
import { SlipCard } from '../inbox/SlipCard';
import type { SlipRecord, SlipResult } from '../../types';
import { useAppPreferences } from '../../context/AppPreferencesContext';
import { confirmSlip, fetchSlips, formatSlipClock, rejectSlip } from '../../lib/slips';

function recordToSlipResult(s: SlipRecord): SlipResult {
  return {
    id: s.id,
    status: s.status,
    amount: s.amount ?? undefined,
    bank: s.bank || (s.channel ? s.channel.toUpperCase() : '?'),
    ref: s.transRef || (s.imageSha256 ? s.imageSha256.slice(0, 12) : '?'),
    date: s.txnAt || s.receivedAt,
    reason: s.reason || undefined,
  };
}

export function SlipsView() {
  const { t } = useAppPreferences();
  const [slips, setSlips] = useState<SlipRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await fetchSlips();
      setSlips(s);
      if (!selectedId && s.length) setSelectedId(s[0].id);
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const selected = useMemo(() => slips.find((s) => s.id === selectedId) ?? slips[0] ?? null, [slips, selectedId]);

  const stats = useMemo(() => {
    return {
      today: slips.length,
      verified: slips.filter((s) => s.status === 'verified').length,
      pending: slips.filter((s) => s.status === 'pending').length,
      flagged: slips.filter((s) => s.status === 'failed' || s.status === 'duplicate').length,
    };
  }, [slips]);

  const onConfirm = async () => {
    if (!selected) return;
    setBusy('confirm');
    try {
      await confirmSlip(selected.id);
      await refresh();
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setBusy(null);
    }
  };

  const onReject = async () => {
    if (!selected) return;
    setBusy('reject');
    try {
      await rejectSlip(selected.id);
      await refresh();
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-screen flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <div className="border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">{t('slips.title')}</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('slips.subtitle')}</p>
          </div>
          <button onClick={() => void refresh()} disabled={loading} className="btn-secondary text-xs disabled:opacity-50">
            <I.Shield className="h-4 w-4" />
            {t('slips.reverifyAll')}
          </button>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-3">
          <Stat label={t('slips.statToday')} value={stats.today.toString()} icon={<I.Receipt className="h-4 w-4" />} tone="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" />
          <Stat label={t('slips.statVerified')} value={stats.verified.toString()} icon={<I.Check className="h-4 w-4" />} tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" />
          <Stat label={t('slips.statPending')} value={stats.pending.toString()} icon={<I.Sparkle className="h-4 w-4" />} tone="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200" />
          <Stat label={t('slips.statFlagged')} value={stats.flagged.toString()} icon={<I.Shield className="h-4 w-4" />} tone="bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" />
        </div>
        {err && (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
            {err}
          </div>
        )}
      </div>

      <div className="grid flex-1 grid-cols-[1.5fr,1fr] gap-0 overflow-hidden">
        <div className="overflow-y-auto p-5">
          {slips.length === 0 ? (
            <div className="grid h-full place-items-center text-sm text-slate-500 dark:text-slate-400">
              {loading ? t('slips.loading') : t('slips.empty')}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  <th className="px-3 pb-2 font-semibold">{t('slips.thCustomer')}</th>
                  <th className="px-3 pb-2 font-semibold">{t('slips.thOrder')}</th>
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
                      <td className="px-3 py-3 font-medium text-slate-900 dark:text-slate-100">
                        {s.customerName || (s.channel ? s.channel.toUpperCase() : '—')}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">{s.orderId || '—'}</td>
                      <td className="px-3 py-3 font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {s.amount != null ? `฿${s.amount.toLocaleString()}` : '—'}
                      </td>
                      <td className="px-3 py-3 text-xs uppercase text-slate-500 dark:text-slate-400">{s.bank || s.channel || '—'}</td>
                      <td className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">{formatSlipClock(s.receivedAt)}</td>
                      <td className="px-3 py-3">
                        <StatusPill status={s.status} t={t} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="overflow-y-auto border-l border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          {selected ? (
            <>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t('slips.preview')}</div>
              {selected.imageUrl && (
                <div className="mt-3 flex justify-center">
                  <img
                    src={selected.imageUrl}
                    alt="slip"
                    className="max-h-72 max-w-full rounded-xl border border-slate-200 object-contain dark:border-slate-700"
                  />
                </div>
              )}
              <div className="mt-3 flex justify-center">
                <SlipCard slip={recordToSlipResult(selected)} />
              </div>
              <div className="mt-5 space-y-2 text-xs">
                <Detail label={t('slips.detail.customer')} value={selected.customerName || '—'} />
                <Detail label={t('slips.detail.order')} value={selected.orderId || '—'} />
                <Detail label={t('slips.detail.received')} value={formatSlipClock(selected.receivedAt)} />
                <Detail label={t('slips.detail.ref')} value={selected.transRef || '—'} mono />
                <Detail
                  label="SHA-256"
                  value={selected.imageSha256 ? selected.imageSha256.slice(0, 16) + '…' : '—'}
                  mono
                />
                <Detail label={t('slips.detail.channel')} value={selected.channel?.toUpperCase() || '—'} />
                {selected.layers && (
                  <details className="rounded-md border border-slate-200 p-2 dark:border-slate-700">
                    <summary className="cursor-pointer text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      {t('slips.detail.layers')}
                    </summary>
                    <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">
{JSON.stringify(selected.layers, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button onClick={onReject} disabled={!!busy} className="btn-secondary text-xs disabled:opacity-50">
                  <I.X className="h-4 w-4" />
                  {busy === 'reject' ? '…' : t('slips.reject')}
                </button>
                <button onClick={onConfirm} disabled={!!busy} className="btn-primary text-xs disabled:opacity-50">
                  <I.Check className="h-4 w-4" />
                  {busy === 'confirm' ? '…' : t('slips.confirm')}
                </button>
              </div>
            </>
          ) : (
            <div className="grid h-full place-items-center text-sm text-slate-500 dark:text-slate-400">
              {t('slips.selectPrompt')}
            </div>
          )}
        </div>
      </div>
    </div>
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
