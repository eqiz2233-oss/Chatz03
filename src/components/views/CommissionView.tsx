import { useMemo } from 'react';
import { orders } from '../../data/mockData';
import { I } from '../Icons';
import { useAppPreferences } from '../../context/AppPreferencesContext';

export function CommissionView() {
  const { t } = useAppPreferences();
  const paid = orders.filter((o) => o.status === 'paid' || o.status === 'shipped');
  const gross = paid.reduce((s, o) => s + o.amount, 0);
  const commission = paid.reduce((s, o) => s + o.amount * (o.commissionPct / 100), 0);
  const payout = gross - commission;

  const byShop = useMemo(
    () =>
      Object.values(
        paid.reduce(
          (acc, o) => {
            if (!acc[o.shop]) acc[o.shop] = { shop: o.shop, gross: 0, commission: 0, payout: 0, orders: 0 };
            acc[o.shop].gross += o.amount;
            acc[o.shop].commission += o.amount * (o.commissionPct / 100);
            acc[o.shop].payout += o.amount * (1 - o.commissionPct / 100);
            acc[o.shop].orders += 1;
            return acc;
          },
          {} as Record<string, { shop: string; gross: number; commission: number; payout: number; orders: number }>,
        ),
      ),
    [paid],
  );

  return (
    <div className="flex h-screen flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <div className="border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">{t('commission.title')}</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('commission.subtitle')}</p>
      </div>

      <div className="space-y-5 overflow-y-auto p-5">
        <div className="grid grid-cols-3 gap-4">
          <BigStat label={t('commission.gross')} value={`฿${gross.toLocaleString()}`} delta={t('commission.delta1')} tone="from-slate-700 to-slate-900" />
          <BigStat label={t('commission.deducted')} value={`฿${Math.round(commission).toLocaleString()}`} delta={t('commission.delta2')} tone="from-brand-600 to-fuchsia-600" />
          <BigStat label={t('commission.payout')} value={`฿${Math.round(payout).toLocaleString()}`} delta={t('commission.delta3')} tone="from-emerald-600 to-teal-600" />
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-slate-800">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('commission.byShop')}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{t('commission.byShopSub')}</div>
            </div>
            <button className="btn-primary text-xs">
              <I.Wallet className="h-4 w-4" />
              {t('commission.runPayout')}
            </button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500 dark:bg-slate-800/80 dark:text-slate-400">
              <tr>
                <th className="px-5 py-2 font-semibold">{t('commission.thShop')}</th>
                <th className="px-5 py-2 font-semibold">{t('commission.thOrders')}</th>
                <th className="px-5 py-2 font-semibold">{t('commission.thGross')}</th>
                <th className="px-5 py-2 font-semibold">{t('commission.thComm')}</th>
                <th className="px-5 py-2 font-semibold">{t('commission.thPayShop')}</th>
                <th className="px-5 py-2 font-semibold">{t('commission.thStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {byShop.map((row) => (
                <tr key={row.shop} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-brand-100 to-fuchsia-100 text-[10px] font-bold text-brand-700 dark:from-brand-900/50 dark:to-fuchsia-900/40 dark:text-brand-300">
                        {row.shop
                          .split(' ')
                          .map((p) => p[0])
                          .join('')
                          .slice(0, 2)}
                      </div>
                      <span className="font-medium text-slate-900 dark:text-slate-100">{row.shop}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-slate-600 dark:text-slate-300">{row.orders}</td>
                  <td className="px-5 py-3 font-semibold tabular-nums text-slate-900 dark:text-slate-100">฿{row.gross.toLocaleString()}</td>
                  <td className="px-5 py-3 font-semibold tabular-nums text-brand-700 dark:text-brand-400">฿{Math.round(row.commission).toLocaleString()}</td>
                  <td className="px-5 py-3 font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">฿{Math.round(row.payout).toLocaleString()}</td>
                  <td className="px-5 py-3">
                    <span className="chip bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">{t('commission.statusPending')}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card p-5">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('commission.policy')}</div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('commission.policySub')}</p>
          <div className="mt-3 space-y-2 text-sm">
            {byShop.map((s) => (
              <div key={s.shop} className="flex items-center gap-3">
                <div className="w-32 truncate text-slate-700 dark:text-slate-200">{s.shop}</div>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className="h-full bg-gradient-to-r from-brand-500 to-fuchsia-500" style={{ width: `${(s.commission / s.gross) * 100 * 5}%` }} />
                </div>
                <div className="w-12 text-right text-xs font-semibold tabular-nums text-brand-700 dark:text-brand-400">{Math.round((s.commission / s.gross) * 100)}%</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function BigStat({ label, value, delta, tone }: { label: string; value: string; delta: string; tone: string }) {
  return (
    <div className={'relative overflow-hidden rounded-xl bg-gradient-to-br p-5 text-white shadow-sm ' + tone}>
      <div className="text-xs font-medium uppercase tracking-wider text-white/70">{label}</div>
      <div className="mt-1 text-3xl font-bold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-white/80">{delta}</div>
      <div className="absolute -bottom-6 -right-6 h-24 w-24 rounded-full bg-white/10" />
    </div>
  );
}

