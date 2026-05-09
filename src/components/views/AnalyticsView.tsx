import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppPreferences } from '../../context/AppPreferencesContext';
import type { Locale } from '../../i18n/messages';

/** Daily counts for the chart — replace with API data when available. */
const CHATS_PER_DAY_30 = Array.from({ length: 30 }, () => 0);

function rollingDayLabels(count: number, locale: Locale): string[] {
  const locTag = locale === 'th' ? 'th-TH' : 'en-US';
  const out: string[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    out.push(
      count <= 7
        ? d.toLocaleDateString(locTag, { weekday: 'short' })
        : d.toLocaleDateString(locTag, { month: 'numeric', day: 'numeric' }),
    );
  }
  return out;
}

type KpiSlide = { periodLabel: string; value: string; delta: string; up: boolean };

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return reduced;
}

function FlipKPI({
  title,
  slides,
  tone,
  t,
}: {
  title: string;
  slides: readonly KpiSlide[];
  tone: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [transitionOn, setTransitionOn] = useState(true);
  const busyRef = useRef(false);

  const n = slides.length;
  const front = slides[idx % n];
  const back = slides[(idx + 1) % n];

  const cycle = useCallback(() => {
    if (busyRef.current) return;
    if (reducedMotion) {
      setIdx((i) => (i + 1) % n);
      return;
    }
    busyRef.current = true;
    setTransitionOn(true);
    setFlipped(true);
  }, [n, reducedMotion]);

  const onTransitionEnd = useCallback(
    (e: React.TransitionEvent<HTMLDivElement>) => {
      if (reducedMotion) return;
      if (e.target !== e.currentTarget) return;
      if (!String(e.propertyName).includes('transform')) return;
      if (!flipped) return;
      setIdx((i) => (i + 1) % n);
      setTransitionOn(false);
      setFlipped(false);
      busyRef.current = false;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setTransitionOn(true));
      });
    },
    [flipped, n, reducedMotion],
  );

  const faceBase =
    'absolute inset-0 flex flex-col justify-center overflow-hidden rounded-xl bg-gradient-to-br p-4 text-white shadow-sm [backface-visibility:hidden] ' +
    tone;

  return (
    <div className="min-h-[7.25rem] [perspective:1100px]">
      <button
        type="button"
        onClick={cycle}
        aria-label={t('analytics.kpiTapCycle')}
        className="relative h-[7.25rem] w-full cursor-pointer rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900/20"
      >
        {/* inner — rotates the whole card */}
        <div
          role="presentation"
          onTransitionEnd={onTransitionEnd}
          className={
            'relative h-full w-full [transform-style:preserve-3d] ' +
            (transitionOn ? 'transition-transform duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]' : '') +
            (flipped ? ' [transform:rotateY(180deg)]' : '')
          }
        >
          {/* front face — normal orientation */}
          <div className={faceBase}>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-white/80">{front.periodLabel}</div>
            <div className="text-[10px] font-medium text-white/55">{title}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{front.value}</div>
            <div className={'mt-1 text-xs font-medium ' + (front.up ? 'text-emerald-200' : 'text-rose-200')}>
              {front.up ? '▲' : '▼'} {front.delta}
            </div>
            <div className="pointer-events-none absolute -bottom-6 -right-6 h-20 w-20 rounded-full bg-white/10" />
          </div>
          {/* back face — pre-rotated 180° so it shows correctly after parent flips */}
          <div className={faceBase + ' [transform:rotateY(180deg)]'}>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-white/80">{back.periodLabel}</div>
            <div className="text-[10px] font-medium text-white/55">{title}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{back.value}</div>
            <div className={'mt-1 text-xs font-medium ' + (back.up ? 'text-emerald-200' : 'text-rose-200')}>
              {back.up ? '▲' : '▼'} {back.delta}
            </div>
            <div className="pointer-events-none absolute -bottom-6 -right-6 h-20 w-20 rounded-full bg-white/10" />
          </div>
        </div>
      </button>
    </div>
  );
}

export function AnalyticsView() {
  const { t, locale } = useAppPreferences();

  const chart = useMemo(() => {
    const values = CHATS_PER_DAY_30;
    const max = Math.max(...values, 1);
    const raw = rollingDayLabels(30, locale);
    const labels = raw.map((lab, i) => (i % 5 === 0 || i === raw.length - 1 ? lab : ''));
    return {
      values,
      labels,
      max,
      titleKey: 'analytics.chartTitle30d' as const,
      subKey: 'analytics.chartSub30d' as const,
      barTipKey: 'analytics.dailyBarTip' as const,
      ariaKey: 'analytics.chartAria30d' as const,
    };
  }, [locale]);

  const channelMixRows = useMemo(
    () => [
      { key: 'line', label: 'LINE', pct: 0, color: 'from-emerald-500 to-teal-600' },
      { key: 'ig', label: 'Instagram', pct: 0, color: 'from-pink-500 to-fuchsia-600' },
      { key: 'fb', label: 'Facebook', pct: 0, color: 'from-blue-500 to-indigo-600' },
    ],
    [],
  );

  const revenueSlides = useMemo<KpiSlide[]>(
    () => [
      { periodLabel: t('analytics.rangeToday'), value: '฿0', delta: t('analytics.kpiAwaitingData'), up: true },
      { periodLabel: t('analytics.kpiPeriodMonth'), value: '฿0', delta: t('analytics.kpiAwaitingData'), up: true },
    ],
    [t],
  );

  const orderSlides = useMemo<KpiSlide[]>(
    () => [
      { periodLabel: t('analytics.rangeToday'), value: '0', delta: t('analytics.kpiAwaitingData'), up: true },
      { periodLabel: t('analytics.kpiPeriodMonth'), value: '0', delta: t('analytics.kpiAwaitingData'), up: true },
    ],
    [t],
  );

  const convSlides = useMemo<KpiSlide[]>(
    () => [
      { periodLabel: t('analytics.rangeToday'), value: '0%', delta: t('analytics.kpiAwaitingData'), up: true },
      { periodLabel: t('analytics.kpiPeriodMonth'), value: '0%', delta: t('analytics.kpiAwaitingData'), up: true },
    ],
    [t],
  );

  return (
    <div className="flex h-screen flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <div className="border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">{t('analytics.title')}</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('analytics.subtitle')}</p>
      </div>

      <div className="space-y-5 overflow-y-auto p-5">
        <div className="grid grid-cols-3 gap-4">
          <FlipKPI title={t('analytics.kpi.revenue')} slides={revenueSlides} tone="from-slate-700 to-slate-900" t={t} />
          <FlipKPI title={t('analytics.kpi.orders')} slides={orderSlides} tone="from-brand-600 to-fuchsia-600" t={t} />
          <FlipKPI title={t('analytics.kpi.conv')} slides={convSlides} tone="from-emerald-600 to-teal-600" t={t} />
        </div>

        <div className="card p-5">
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t(chart.titleKey)}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{t(chart.subKey)}</div>
          </div>
          <div className="mt-4 flex h-48 gap-1.5 overflow-x-auto pb-1 sm:gap-2" role="img" aria-label={t(chart.ariaKey)}>
            {chart.values.map((count, i) => (
              <div key={i} className="flex h-full w-4 min-h-0 shrink-0 flex-col sm:w-5">
                <div className="flex min-h-0 flex-1 flex-col justify-end">
                  <div
                    className="w-full min-w-[4px] rounded-md bg-gradient-to-t from-brand-500 to-fuchsia-500 shadow-sm transition hover:opacity-80"
                    style={{
                      height: `${(count / chart.max) * 100}%`,
                      minHeight: count > 0 ? 4 : 0,
                      maxHeight: '100%',
                    }}
                    title={t(chart.barTipKey, { n: count })}
                  />
                </div>
                <div className="min-h-[0.875rem] max-w-full shrink-0 text-center text-[10px] tabular-nums leading-tight text-slate-400 dark:text-slate-500">
                  {chart.labels[i] ? (
                    <span className="inline-block max-w-[2.75rem] truncate align-top" title={chart.labels[i]}>
                      {chart.labels[i]}
                    </span>
                  ) : (
                    '\u00a0'
                  )}
                </div>
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
