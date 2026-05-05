import { useMemo } from 'react';
import { useAppPreferences } from '../../context/AppPreferencesContext';

const HOURS = Array.from({ length: 12 }, (_, i) => 8 + i);
const DATA = [4, 8, 12, 9, 15, 18, 22, 17, 14, 19, 24, 21];
const MAX = Math.max(...DATA);

export function AnalyticsView() {
  const { t } = useAppPreferences();

  const channelMixRows = useMemo(
    () => [
      { key: 'line', label: 'LINE', pct: 48, color: 'from-emerald-500 to-teal-600' },
      { key: 'ig', label: 'Instagram', pct: 31, color: 'from-pink-500 to-fuchsia-600' },
      { key: 'fb', label: 'Facebook', pct: 21, color: 'from-blue-500 to-indigo-600' },
    ],
    [],
  );

  return (
    <div className="flex h-screen flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <div className="border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">{t('analytics.title')}</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('analytics.subtitle')}</p>
      </div>

      <div className="space-y-5 overflow-y-auto p-5">
        <div className="grid grid-cols-3 gap-4">
          <KPI
            label={t('analytics.kpi.revenue')}
            value="฿182,490"
            delta="+24.1%"
            up
            tone="from-slate-700 to-slate-900"
          />
          <KPI
            label={t('analytics.kpi.orders')}
            value="248"
            delta="+12.8%"
            up
            tone="from-brand-600 to-fuchsia-600"
          />
          <KPI
            label={t('analytics.kpi.conv')}
            value="12.6%"
            delta="+1.4 pp"
            up
            tone="from-emerald-600 to-teal-600"
          />
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('analytics.hourly')}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{t('analytics.hourlySub')}</div>
            </div>
            <div className="flex items-center gap-1 text-xs">
              <span className="chip bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">{t('analytics.rangeToday')}</span>
              <span className="chip bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t('analytics.range7')}</span>
              <span className="chip bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t('analytics.range30')}</span>
            </div>
          </div>
          <div className="mt-4 flex h-48 items-end gap-2">
            {DATA.map((v, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-md bg-gradient-to-t from-brand-500 to-fuchsia-500 shadow-sm transition hover:opacity-80"
                  style={{ height: `${(v / MAX) * 100}%` }}
                  title={`${v}`}
                />
                <div className="text-[10px] text-slate-400 dark:text-slate-500">{HOURS[i]}:00</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('analytics.channelMix')}</div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('analytics.channelMixSub')}</p>
          <div className="mt-4 space-y-2">
            {channelMixRows.map((row) => (
              <div key={row.key} className="flex items-center gap-3">
                <div className="w-44 shrink-0 text-sm text-slate-700 dark:text-slate-200">{row.label}</div>
                <div className="relative h-9 flex-1 overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800">
                  <div className={'h-full rounded-md bg-gradient-to-r ' + row.color} style={{ width: `${row.pct}%` }} />
                  <div className="absolute inset-0 flex items-center px-3 text-xs font-semibold text-white mix-blend-difference">
                    {row.pct}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function KPI({ label, value, delta, up = false, tone }: { label: string; value: string; delta: string; tone: string; up?: boolean }) {
  return (
    <div className={'relative overflow-hidden rounded-xl bg-gradient-to-br p-4 text-white shadow-sm ' + tone}>
      <div className="text-[11px] font-medium uppercase tracking-wider text-white/70">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      <div className={'mt-1 text-xs font-medium ' + (up ? 'text-emerald-200' : 'text-rose-200')}>
        {up ? '▲' : '▼'} {delta}
      </div>
      <div className="absolute -bottom-6 -right-6 h-20 w-20 rounded-full bg-white/10" />
    </div>
  );
}
