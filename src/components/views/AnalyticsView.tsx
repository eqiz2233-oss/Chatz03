import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppPreferences } from '../../context/AppPreferencesContext';
import type { Locale } from '../../i18n/messages';

interface AnalyticsSummary {
  range: { days: number; today: string };
  chatsPerDay: { day: string; count: number }[];
  channelMix: { channel: 'line' | 'facebook' | 'ig'; count: number; pct: number }[];
  kpis: {
    chatsTotal: number;
    slipsVerified: number;
    verifiedAmountToday: number;
    ordersTotal: number;
    ordersToday: number;
    revenue: number;
  };
}

function fmtBaht(n: number): string {
  if (!Number.isFinite(n)) return '฿0';
  return '฿' + Math.round(n).toLocaleString('en-US');
}

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
            (transitionOn ? 'transition-transform duration-1000 ease-in-out' : '') +
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
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch('/api/analytics/summary?days=30', { credentials: 'include' });
        if (!r.ok) return;
        const j = (await r.json()) as AnalyticsSummary;
        if (!cancelled) setSummary(j);
      } catch {
        /* ignore */
      }
    };
    void load();
    const id = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const chart = useMemo(() => {
    const days = summary?.chatsPerDay ?? [];
    const values = days.length > 0 ? days.map((d) => d.count) : Array.from({ length: 30 }, () => 0);
    const n = values.length;
    const lineValues = values;
    const igValues = Array.from({ length: n }, () => 0);
    const fbValues = Array.from({ length: n }, () => 0);
    const max = Math.max(...lineValues, ...igValues, ...fbValues, 1);
    const raw = rollingDayLabels(values.length || 30, locale);
    const labels = raw.map((lab, i) => (i % 5 === 0 || i === raw.length - 1 ? lab : ''));
    const count = raw.length;
    const stepX = 28;
    const width = Math.max(760, (count - 1) * stepX + 24);
    const height = 152;
    const toPoints = (arr: number[]) =>
      arr
        .map((v, i) => {
          const x = 12 + i * stepX;
          const y = height - (v / max) * (height - 14);
          return `${x},${Number.isFinite(y) ? y.toFixed(2) : height}`;
        })
        .join(' ');

    return {
      lineValues,
      igValues,
      fbValues,
      linePoints: toPoints(lineValues),
      igPoints: toPoints(igValues),
      fbPoints: toPoints(fbValues),
      labels,
      width,
      height,
      titleKey: 'analytics.chartTitle30d' as const,
      subKey: 'analytics.chartSub30d' as const,
      barTipKey: 'analytics.dailyBarTip' as const,
      ariaKey: 'analytics.chartAria30d' as const,
    };
  }, [locale, summary]);

  const chartMonthLabel = useMemo(() => {
    const loc = locale === 'th' ? 'th-TH' : 'en-US';
    return new Date().toLocaleDateString(loc, { month: 'long', year: 'numeric' });
  }, [locale]);

  const channelMixRows = useMemo(() => {
    const map = new Map(summary?.channelMix?.map((c) => [c.channel, c.pct]) ?? []);
    return [
      { key: 'line', label: 'LINE', pct: map.get('line') ?? 0, color: 'from-emerald-500 to-teal-600' },
      { key: 'ig', label: 'Instagram', pct: map.get('ig') ?? 0, color: 'from-pink-500 to-fuchsia-600' },
      { key: 'fb', label: 'Facebook', pct: map.get('facebook') ?? 0, color: 'from-blue-500 to-indigo-600' },
    ];
  }, [summary]);

  const todayRevenue = summary?.kpis.verifiedAmountToday ?? 0;
  const monthRevenue = summary?.kpis.revenue ?? 0;
  const ordersToday = summary?.kpis.ordersToday ?? 0;
  const ordersTotal = summary?.kpis.ordersTotal ?? 0;
  const slipsVerified = summary?.kpis.slipsVerified ?? 0;
  const chatsTotal = summary?.kpis.chatsTotal ?? 0;
  const convPct = chatsTotal > 0 ? Math.round((ordersTotal / chatsTotal) * 100) : 0;

  const revenueSlides = useMemo<KpiSlide[]>(
    () => [
      { periodLabel: t('analytics.rangeToday'), value: fmtBaht(todayRevenue), delta: `${slipsVerified} verified slips`, up: true },
      { periodLabel: t('analytics.kpiPeriodMonth'), value: fmtBaht(monthRevenue), delta: `${ordersTotal} orders`, up: true },
    ],
    [t, todayRevenue, monthRevenue, slipsVerified, ordersTotal],
  );

  const orderSlides = useMemo<KpiSlide[]>(
    () => [
      { periodLabel: t('analytics.rangeToday'), value: String(ordersToday), delta: `${chatsTotal} chats / 30d`, up: true },
      { periodLabel: t('analytics.kpiPeriodMonth'), value: String(ordersTotal), delta: `${chatsTotal} chats`, up: true },
    ],
    [t, ordersToday, ordersTotal, chatsTotal],
  );

  const convSlides = useMemo<KpiSlide[]>(
    () => [
      { periodLabel: t('analytics.rangeToday'), value: `${convPct}%`, delta: `${ordersTotal} / ${chatsTotal || 0}`, up: convPct >= 0 },
      { periodLabel: t('analytics.kpiPeriodMonth'), value: `${convPct}%`, delta: t('analytics.kpiAwaitingData'), up: true },
    ],
    [t, convPct, ordersTotal, chatsTotal],
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
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {t(chart.subKey, { month: chartMonthLabel })}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] font-medium">
            <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <span className="h-1.5 w-4 rounded-full bg-emerald-500" />
              LINE
            </span>
            <span className="inline-flex items-center gap-1.5 text-fuchsia-600 dark:text-fuchsia-400">
              <span className="h-1.5 w-4 rounded-full bg-fuchsia-500" />
              Instagram
            </span>
            <span className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
              <span className="h-1.5 w-4 rounded-full bg-blue-500" />
              Facebook
            </span>
          </div>
          <div className="mt-3 overflow-x-auto pb-1" role="img" aria-label={t(chart.ariaKey)}>
            <div className="min-w-[760px]" style={{ width: `${chart.width}px` }}>
              <svg width={chart.width} height={chart.height} className="block">
                <line x1="0" y1={chart.height - 1} x2={chart.width} y2={chart.height - 1} className="stroke-slate-200 dark:stroke-slate-700" />
                <polyline points={chart.linePoints} fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points={chart.igPoints} fill="none" stroke="#d946ef" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points={chart.fbPoints} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="mt-1 grid" style={{ gridTemplateColumns: `repeat(${chart.labels.length}, minmax(0, 1fr))` }}>
                {chart.labels.map((lab, i) => (
                  <div key={i} className="text-center text-[10px] tabular-nums leading-tight text-slate-400 dark:text-slate-500">
                    {lab || '\u00a0'}
                  </div>
                ))}
              </div>
            </div>
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
