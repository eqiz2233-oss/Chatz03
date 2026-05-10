import { useCallback, useEffect, useState } from 'react';
import type { Locale } from '../../i18n/messages';
import type { Theme } from '../../context/AppPreferencesContext';
import { useAppPreferences } from '../../context/AppPreferencesContext';
import { ChannelIcon, I } from '../Icons';
import {
  fetchFbStatus,
  openFbConnectPopup,
  type FbIntegrationStatus,
} from '../../lib/fbIntegration';

type Tab = 'general' | 'connect' | 'bot';

export function SettingsView() {
  const { t, theme, setTheme, locale, setLocale } = useAppPreferences();
  const [tab, setTab] = useState<Tab>('general');

  const tabs: { key: Tab; label: string; emoji: string }[] = [
    { key: 'general', label: t('settings.tabGeneral'), emoji: '🎨' },
    { key: 'connect', label: t('settings.tabConnect'), emoji: '🔗' },
    { key: 'bot', label: t('settings.tabBot'), emoji: '🤖' },
  ];

  return (
    <div className="flex h-screen flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <div className="border-b border-slate-200 bg-white px-6 pt-5 pb-0 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">{t('settings.title')}</h1>
        <div className="mt-4 flex gap-1">
          {tabs.map((tb) => (
            <button
              key={tb.key}
              type="button"
              onClick={() => setTab(tb.key)}
              className={
                'flex items-center gap-1.5 rounded-t-xl px-4 py-2.5 text-sm font-semibold transition ' +
                (tab === tb.key
                  ? 'bg-slate-50 text-brand-700 shadow-[0_-1px_0_0_inset] shadow-brand-300 dark:bg-slate-950 dark:text-brand-300 dark:shadow-brand-600'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200')
              }
            >
              <span>{tb.emoji}</span>
              {tb.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {tab === 'general' && <GeneralTab t={t} theme={theme} setTheme={setTheme} locale={locale} setLocale={setLocale} />}
        {tab === 'connect' && <ConnectTab t={t} />}
        {tab === 'bot' && <BotTab t={t} />}
      </div>
    </div>
  );
}

function GeneralTab({
  t, theme, setTheme, locale, setLocale,
}: {
  t: (k: string) => string;
  theme: Theme;
  setTheme: (v: Theme) => void;
  locale: Locale;
  setLocale: (v: Locale) => void;
}) {
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <SectionCard
        emoji="🌗"
        title={t('settings.theme')}
        desc={t('settings.appearanceSub')}
      >
        <Segmented<Theme>
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'light', label: t('settings.themeLight') },
            { value: 'dark', label: t('settings.themeDark') },
          ]}
        />
      </SectionCard>

      <SectionCard
        emoji="🌐"
        title={t('settings.language')}
        desc={locale === 'th' ? 'ภาษาที่ใช้แสดงผลในแอป' : 'Display language for the app'}
      >
        <Segmented<Locale>
          value={locale}
          onChange={setLocale}
          options={[
            { value: 'th', label: t('settings.langTh') },
            { value: 'en', label: t('settings.langEn') },
          ]}
        />
      </SectionCard>
    </div>
  );
}

function ConnectTab({ t }: { t: (k: string) => string }) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <MetaIntegrationSection t={t} />
      <LineIntegrationCard t={t} />
      <EasySlipIntegrationCard t={t} />
    </div>
  );
}

function BotTab({ t }: { t: (k: string) => string }) {
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <SectionCard emoji="⚡" title={t('settings.aiEngine')} desc={locale === 'th' ? 'เปิด-ปิดฟีเจอร์บอทได้ตามต้องการ' : 'Turn each bot feature on or off'}>
        <div className="space-y-2">
          <ToggleRow title={t('settings.ai1t')} desc={t('settings.ai1d')} defaultOn />
          <ToggleRow title={t('settings.ai2t')} desc={t('settings.ai2d')} defaultOn />
          <ToggleRow title={t('settings.ai3t')} desc={t('settings.ai3d')} defaultOn />
          <ToggleRow title={t('settings.ai4t')} desc={t('settings.ai4d')} defaultOn />
          <ToggleRow title={t('settings.ai5t')} desc={t('settings.ai5d')} />
          <ToggleRow title={t('settings.ai6t')} desc={t('settings.ai6d')} defaultOn />
        </div>
      </SectionCard>

      <SectionCard emoji="💬" title={t('settings.brandVoice')} desc={null}>
        <textarea
          className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-900/30"
          rows={3}
          defaultValue={t('settings.brandVoicePlaceholder')}
        />
      </SectionCard>

      <SectionCard emoji="📄" title={t('settings.payment')} desc={null}>
        <div className="mb-3 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 dark:border-slate-700 dark:bg-slate-800/60">
          <div>
            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{t('settings.centralAccount')}</div>
            <div className="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">KBANK 123-4-56789-0</div>
          </div>
          <button className="btn-secondary text-xs">
            <I.Copy className="h-3.5 w-3.5" />
            {t('settings.copy')}
          </button>
        </div>
        <div className="space-y-2">
          <ToggleRow title={t('settings.ocr')} desc={t('settings.ocrD')} defaultOn />
          <ToggleRow title={t('settings.dedupe')} desc={t('settings.dedupeD')} defaultOn />
          <ToggleRow title={t('settings.bankApi')} desc={t('settings.bankApiD')} defaultOn />
          <ToggleRow title={t('settings.autoPaid')} desc={t('settings.autoPaidD')} defaultOn />
        </div>
      </SectionCard>
    </div>
  );
}

// Needed for BotTab's desc where locale isn't available as a prop — just pick from the t() calls
const locale = (typeof window !== 'undefined' && document.documentElement.lang === 'en') ? 'en' : 'th';

function SectionCard({
  emoji,
  title,
  desc,
  children,
}: {
  emoji: string;
  title: string;
  desc: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <span className="text-xl leading-none">{emoji}</span>
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</div>
            {desc && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{desc}</div>}
          </div>
        </div>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function ToggleRow({ title, desc, defaultOn }: { title: string; desc: string; defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn ?? false);
  return (
    <button
      type="button"
      onClick={() => setOn(!on)}
      className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{title}</div>
        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{desc}</div>
      </div>
      <span
        className={
          'relative inline-flex h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors duration-200 ' +
          (on ? 'bg-brand-600 dark:bg-brand-500' : 'bg-slate-200 dark:bg-slate-700')
        }
      >
        <span
          className={
            'block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ' +
            (on ? 'translate-x-4' : 'translate-x-0')
          }
        />
      </span>
    </button>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={
              'rounded-lg px-4 py-2 text-sm font-medium transition ' +
              (active
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200')
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Shared Meta (FB+IG) state ──────────────────────────────────────────────

function MetaIntegrationSection({ t }: { t: (k: string) => string }) {
  const [status, setStatus] = useState<FbIntegrationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await fetchFbStatus());
      setErr(null);
    }
    catch (e) { setErr(String((e as Error).message || e)); }
  }, []);
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 6000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const onConnect = async () => {
    setErr(null); setBusy(true);
    try {
      await openFbConnectPopup();
      await refresh();
      setTimeout(() => void refresh(), 3500);
    } catch (e) { setErr(String((e as Error).message || e)); }
    finally { setBusy(false); }
  };

  // Treat as connected when reply token exists OR page profile is present.
  // Some env-token setups can reply successfully even when page profile fetch is delayed.
  const isConnected = Boolean(status && (status.replyEnabled || status.page));
  const igAccount = status?.page?.instagram ?? null;

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Meta (Facebook &amp; Instagram)</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* ── Facebook Messenger card ── */}
        <IntegrationCard
          icon={<ChannelIcon channel="facebook" className="h-7 w-7" />}
          iconBg="bg-blue-50 dark:bg-blue-950/30"
          name="Facebook Messenger"
          desc={status?.page?.name ?? 'รับ-ส่งข้อความจาก Facebook Page'}
          connected={isConnected}
          action={
            isConnected
              ? <button type="button" onClick={onConnect} disabled={busy} className="btn-secondary text-xs disabled:opacity-50">{busy ? '…' : t('settings.reconnect')}</button>
              : <button type="button" onClick={onConnect} disabled={busy || !status?.oauthAvailable} className="btn-primary text-xs disabled:opacity-50">{busy ? 'กำลังเชื่อม…' : 'เชื่อมต่อ'}</button>
          }
        />
        {/* ── Instagram card ── */}
        <IntegrationCard
          icon={<ChannelIcon channel="ig" className="h-7 w-7" />}
          iconBg="bg-pink-50 dark:bg-pink-950/30"
          name="Instagram"
          desc={igAccount ? `@${igAccount.username}` : isConnected ? 'ไม่มี IG Business เชื่อมกับเพจนี้' : 'เชื่อมผ่าน Facebook Page'}
          connected={isConnected && Boolean(igAccount)}
          partial={isConnected && !igAccount}
          action={
            isConnected && igAccount
              ? <button type="button" onClick={onConnect} disabled={busy} className="btn-secondary text-xs disabled:opacity-50">{busy ? '…' : t('settings.reconnect')}</button>
              : <button type="button" onClick={onConnect} disabled={busy || !status?.oauthAvailable} className="btn-primary text-xs disabled:opacity-50">{busy ? '…' : 'เชื่อมต่อ'}</button>
          }
        />
      </div>

      {/* ── Shared action row ── */}
      {isConnected && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void refresh()} disabled={busy} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            รีเฟรช
          </button>
        </div>
      )}
      {err && (
        <div className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-950/30 dark:text-rose-300">{err}</div>
      )}
      {!status?.oauthAvailable && status !== null && (
        <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          ต้องตั้งค่า <code className="font-mono">FB_APP_ID</code> และ <code className="font-mono">FB_APP_SECRET</code> ใน Railway Variables ก่อน
        </div>
      )}
    </div>
  );
}

// ─── Zaapi-style integration card shell ─────────────────────────────────────

function IntegrationCard({
  icon, iconBg, name, desc, connected, partial, action,
}: {
  icon: React.ReactNode;
  iconBg: string;
  name: string;
  desc: string;
  connected: boolean;
  partial?: boolean;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-2">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${iconBg}`}>{icon}</div>
        {connected ? (
          <span className="chip bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            <I.Check className="h-3 w-3" /> เชื่อมแล้ว
          </span>
        ) : partial ? (
          <span className="chip bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">บางส่วน</span>
        ) : (
          <span className="chip bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">ยังไม่ได้เชื่อม</span>
        )}
      </div>
      <div>
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{name}</div>
        <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{desc}</div>
      </div>
      <div className="mt-auto">{action}</div>
    </div>
  );
}

// ─── LINE integration card ───────────────────────────────────────────────────

interface HealthSnapshot {
  ok?: boolean;
  lineConfigured?: boolean;
  lineReplyEnabled?: boolean;
  lineConversationsCount?: number;
  slipChecker?: { enabled?: boolean };
}

function useHealthSnapshot() {
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch('/api/health')
        .then((r) => r.json())
        .then((d: HealthSnapshot) => alive && setHealth(d))
        .catch(() => alive && setHealth({}));
    };
    load();
    const id = window.setInterval(load, 6000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);
  return health;
}

function LineIntegrationCard({ t }: { t: (k: string) => string }) {
  const health = useHealthSnapshot();
  const configured = !!health?.lineConfigured;
  const reply = !!health?.lineReplyEnabled;
  const count = health?.lineConversationsCount ?? 0;
  const connected = configured && reply;
  const partial = configured && !reply;

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">LINE</p>
      <IntegrationCard
        icon={<ChannelIcon channel="line" className="h-7 w-7" />}
        iconBg="bg-green-50 dark:bg-green-950/30"
        name="LINE Official Account"
        desc={
          !health ? '…'
          : connected ? `${count} ห้องแชท`
          : partial ? 'รับข้อความได้แล้ว แต่ยังตอบกลับไม่ได้'
          : 'ตั้งค่า LINE_CHANNEL_SECRET ใน Railway Variables'
        }
        connected={connected}
        partial={partial}
        action={
          <a
            href="https://developers.line.biz/console/"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary text-xs"
          >
            เปิด LINE Developers →
          </a>
        }
      />
    </div>
  );
}

// ─── EasySlip card ───────────────────────────────────────────────────────────

function EasySlipIntegrationCard({ t: _t }: { t: (k: string) => string }) {
  const health = useHealthSnapshot();
  const enabled = health ? Boolean(health?.slipChecker?.enabled) : null;

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">ตรวจสลิป</p>
      <IntegrationCard
        icon={<span className="text-2xl leading-none">📄</span>}
        iconBg="bg-violet-50 dark:bg-violet-950/30"
        name="EasySlip API"
        desc={
          enabled === null ? '…'
          : enabled ? 'ตรวจสลิปกับธนาคารจริง — เชื่อมอยู่'
          : 'โหมดสาธิต — ตั้งค่า EASYSLIP_TOKEN เพื่อใช้งานจริง'
        }
        connected={enabled === true}
        action={
          <a
            href="https://developer.easyslip.com"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary text-xs"
          >
            สมัคร EasySlip →
          </a>
        }
      />
    </div>
  );
}
