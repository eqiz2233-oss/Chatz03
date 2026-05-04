import { useState } from 'react';
import { I } from '../Icons';
import { SlipCard } from '../inbox/SlipCard';
import type { SlipResult } from '../../types';
import { useAppPreferences } from '../../context/AppPreferencesContext';

interface SlipRow {
  id: string;
  customer: string;
  order: string;
  slip: SlipResult;
  receivedAt: string;
}

const SLIPS: SlipRow[] = [
  { id: 's1', customer: 'คุณนิดา', order: '#A1029', receivedAt: '09:32', slip: { status: 'verified', amount: 930, bank: 'KBANK', ref: '20260503093114', date: '03/05/2026 09:31' } },
  { id: 's2', customer: 'May', order: '#A1028', receivedAt: '09:18', slip: { status: 'pending', amount: 690, bank: 'KBANK', ref: '20260503091833', date: '03/05/2026 09:18' } },
  { id: 's3', customer: 'Praewa', order: '#A1026', receivedAt: '08:45', slip: { status: 'verified', amount: 4500, bank: 'KBANK', ref: '20260503084555', date: '03/05/2026 08:45' } },
  { id: 's4', customer: 'Earth', order: '#A1025', receivedAt: '07:55', slip: { status: 'duplicate', amount: 1290, bank: 'SCB', ref: '20260503075501', date: '03/05/2026 07:55', reason: 'พบสลิปเดียวกันใน #A0991 (เมื่อ 28/04)' } },
  { id: 's5', customer: 'Anonymous', order: '—', receivedAt: '07:11', slip: { status: 'failed', amount: 350, bank: '?', ref: '?', date: '?', reason: 'ภาพไม่ชัด / ไม่พบเลข Ref ที่ฝั่งธนาคาร' } },
];

export function SlipsView() {
  const { t } = useAppPreferences();
  const [selected, setSelected] = useState<SlipRow>(SLIPS[0]);

  const stats = {
    today: SLIPS.length,
    verified: SLIPS.filter((s) => s.slip.status === 'verified').length,
    pending: SLIPS.filter((s) => s.slip.status === 'pending').length,
    flagged: SLIPS.filter((s) => s.slip.status === 'failed' || s.slip.status === 'duplicate').length,
  };

  return (
    <div className="flex h-screen flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <div className="border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">{t('slips.title')}</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('slips.subtitle')}</p>
          </div>
          <button className="btn-primary text-xs">
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
      </div>

      <div className="grid flex-1 grid-cols-[1.5fr,1fr] gap-0 overflow-hidden">
        <div className="overflow-y-auto p-5">
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
              {SLIPS.map((s) => {
                const isActive = selected.id === s.id;
                return (
                  <tr
                    key={s.id}
                    onClick={() => setSelected(s)}
                    className={
                      'cursor-pointer border-b border-slate-100 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50 ' +
                      (isActive ? 'bg-brand-50/40 dark:bg-brand-950/25' : '')
                    }
                  >
                    <td className="px-3 py-3 font-medium text-slate-900 dark:text-slate-100">{s.customer}</td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">{s.order}</td>
                    <td className="px-3 py-3 font-semibold tabular-nums text-slate-900 dark:text-slate-100">฿{s.slip.amount?.toLocaleString()}</td>
                    <td className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">{s.slip.bank}</td>
                    <td className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">{s.receivedAt}</td>
                    <td className="px-3 py-3">
                      <StatusPill status={s.slip.status} t={t} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-l border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{t('slips.preview')}</div>
          <div className="mt-3 flex justify-center">
            <SlipCard slip={selected.slip} />
          </div>
          <div className="mt-5 space-y-2 text-xs">
            <Detail label={t('slips.detail.customer')} value={selected.customer} />
            <Detail label={t('slips.detail.order')} value={selected.order} />
            <Detail label={t('slips.detail.received')} value={selected.receivedAt} />
            <Detail label={t('slips.detail.ref')} value={selected.slip.ref ?? '-'} mono />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button className="btn-secondary text-xs">
              <I.X className="h-4 w-4" />
              {t('slips.reject')}
            </button>
            <button className="btn-primary text-xs">
              <I.Check className="h-4 w-4" />
              {t('slips.confirm')}
            </button>
          </div>
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
