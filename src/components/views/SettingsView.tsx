import { useCallback, useEffect, useState } from 'react';
import type { Locale } from '../../i18n/messages';
import type { Theme } from '../../context/AppPreferencesContext';
import { useAppPreferences } from '../../context/AppPreferencesContext';
import { useAuth } from '../../context/AuthContext';
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

      <AccountCard t={t} locale={locale} />
    </div>
  );
}

function AccountCard({ t, locale }: { t: (k: string) => string; locale: Locale }) {
  const { user, logout } = useAuth();
  const [showPw, setShowPw] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/auth/change-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        const reason = j?.error;
        const text =
          reason === 'invalid_current'
            ? locale === 'th' ? 'รหัสผ่านปัจจุบันไม่ถูกต้อง' : 'Current password is wrong'
            : reason === 'too_short'
            ? locale === 'th' ? 'รหัสผ่านใหม่ต้องอย่างน้อย 6 ตัว' : 'New password must be at least 6 chars'
            : reason || `HTTP ${r.status}`;
        setMsg({ kind: 'err', text });
      } else {
        setMsg({ kind: 'ok', text: locale === 'th' ? 'เปลี่ยนรหัสผ่านสำเร็จ' : 'Password changed' });
        setCurrent('');
        setNext('');
        setShowPw(false);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      emoji="👤"
      title={locale === 'th' ? 'บัญชี' : 'Account'}
      desc={user ? `${user.displayName || user.username} • ${user.role}` : null}
    >
      {!showPw ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {locale === 'th' ? 'เปลี่ยนรหัสผ่านหรือออกจากระบบได้ที่นี่' : 'Change password or sign out here.'}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowPw(true)} className="btn-secondary text-xs">
              {locale === 'th' ? 'เปลี่ยนรหัสผ่าน' : 'Change password'}
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200 dark:hover:bg-rose-900/50"
            >
              {t('login.logout')}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-2 text-sm">
          <input
            type="password"
            placeholder={locale === 'th' ? 'รหัสผ่านปัจจุบัน' : 'Current password'}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="input"
            required
            autoFocus
          />
          <input
            type="password"
            placeholder={locale === 'th' ? 'รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)' : 'New password (min 6 chars)'}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="input"
            minLength={6}
            required
          />
          {msg && (
            <div
              className={
                'rounded-lg px-3 py-1.5 text-xs ' +
                (msg.kind === 'ok'
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200'
                  : 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-200')
              }
            >
              {msg.text}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setShowPw(false); setMsg(null); }} className="btn-secondary text-xs">
              {locale === 'th' ? 'ยกเลิก' : 'Cancel'}
            </button>
            <button type="submit" disabled={busy} className="btn-primary text-xs disabled:opacity-60">
              {busy ? '…' : locale === 'th' ? 'บันทึก' : 'Save'}
            </button>
          </div>
        </form>
      )}
    </SectionCard>
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

interface BotSettings {
  brandVoice: string;
  paymentInfo: { kbankAccount: string; promptPay: string };
  autoGreet: boolean;
  autoFaq: boolean;
  autoSlipConfirm: boolean;
  ocr: boolean;
  dedupe: boolean;
  bankApi: boolean;
  autoPaid: boolean;
  ai5: boolean;
  ai6: boolean;
}

const DEFAULT_BOT_SETTINGS: BotSettings = {
  brandVoice: '',
  paymentInfo: { kbankAccount: '', promptPay: '' },
  autoGreet: true,
  autoFaq: true,
  autoSlipConfirm: true,
  ocr: true,
  dedupe: true,
  bankApi: true,
  autoPaid: true,
  ai5: false,
  ai6: true,
};

interface AiStatus {
  enabled: boolean;
  model: string | null;
}

function BotTab({ t }: { t: (k: string) => string }) {
  const [settings, setSettings] = useState<BotSettings>(DEFAULT_BOT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [ai, setAi] = useState<AiStatus | null>(null);

  // Probe whether the backend has ANTHROPIC_API_KEY wired so we can show the
  // shop owner whether AI replies are actually live or just toggled in the UI.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch('/api/health', { credentials: 'include' });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) setAi({ enabled: Boolean(j?.ai?.enabled), model: j?.ai?.model || null });
      } catch {
        /* offline ok */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load once
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch('/api/bot/settings', { credentials: 'include' });
        if (!r.ok) return;
        const j = (await r.json()) as { settings: Partial<BotSettings> };
        if (cancelled) return;
        setSettings({
          ...DEFAULT_BOT_SETTINGS,
          ...j.settings,
          paymentInfo: {
            ...DEFAULT_BOT_SETTINGS.paymentInfo,
            ...(j.settings?.paymentInfo || {}),
          },
        });
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced auto-save
  useEffect(() => {
    if (!loaded) return;
    setSaveStatus('saving');
    const id = window.setTimeout(async () => {
      try {
        const r = await fetch('/api/bot/settings', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings }),
        });
        setSaveStatus(r.ok ? 'saved' : 'error');
      } catch {
        setSaveStatus('error');
      }
      window.setTimeout(() => setSaveStatus('idle'), 1500);
    }, 600);
    return () => window.clearTimeout(id);
  }, [settings, loaded]);

  const set = <K extends keyof BotSettings>(key: K, value: BotSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));

  const setPayment = (patch: Partial<BotSettings['paymentInfo']>) =>
    setSettings((s) => ({ ...s, paymentInfo: { ...s.paymentInfo, ...patch } }));

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="-mb-1 flex items-center justify-end gap-2 text-[11px] text-slate-400 dark:text-slate-500">
        {saveStatus === 'saving' && <span>กำลังบันทึก…</span>}
        {saveStatus === 'saved' && <span className="text-emerald-600 dark:text-emerald-400">บันทึกแล้ว ✓</span>}
        {saveStatus === 'error' && <span className="text-rose-500">บันทึกไม่สำเร็จ</span>}
      </div>

      {ai && (
        ai.enabled ? (
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900/50 dark:bg-emerald-950/40">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-500 text-white">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-semibold text-emerald-900 dark:text-emerald-100">AI ปิดการขาย พร้อมใช้งาน</div>
              <div className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-300">
                ใช้โมเดล <span className="font-mono">{ai.model}</span> — บอทจะตอบลูกค้าตามแบรนด์และ catalog สินค้าโดยอัตโนมัติ
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/40">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-500 text-white">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-semibold text-amber-900 dark:text-amber-100">AI ปิดการขาย ยังไม่ทำงาน</div>
              <div className="mt-0.5 text-xs text-amber-800 dark:text-amber-200">
                ตั้งค่า <span className="font-mono">ANTHROPIC_API_KEY</span> ใน Railway → Variables เพื่อเปิดใช้งาน บอทจะตอบลูกค้าอัตโนมัติด้วยข้อมูลแบรนด์ + สินค้าของคุณ
              </div>
            </div>
          </div>
        )
      )}

      <SectionCard emoji="⚡" title={t('settings.aiEngine')} desc={locale === 'th' ? 'เปิด-ปิดฟีเจอร์บอทได้ตามต้องการ' : 'Turn each bot feature on or off'}>
        <div className="space-y-2">
          <ToggleRow title={t('settings.ai1t')} desc={t('settings.ai1d')} on={settings.autoGreet} onChange={(v) => set('autoGreet', v)} />
          <ToggleRow title={t('settings.ai2t')} desc={t('settings.ai2d')} on={settings.autoFaq} onChange={(v) => set('autoFaq', v)} />
          <ToggleRow title={t('settings.ai3t')} desc={t('settings.ai3d')} on={settings.autoSlipConfirm} onChange={(v) => set('autoSlipConfirm', v)} />
          <ToggleRow title={t('settings.ai4t')} desc={t('settings.ai4d')} on={settings.ocr} onChange={(v) => set('ocr', v)} />
          <ToggleRow title={t('settings.ai5t')} desc={t('settings.ai5d')} on={settings.ai5} onChange={(v) => set('ai5', v)} />
          <ToggleRow title={t('settings.ai6t')} desc={t('settings.ai6d')} on={settings.ai6} onChange={(v) => set('ai6', v)} />
        </div>
      </SectionCard>

      <SectionCard emoji="💬" title={t('settings.brandVoice')} desc={null}>
        <textarea
          className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-900/30"
          rows={3}
          value={settings.brandVoice}
          onChange={(e) => set('brandVoice', e.target.value)}
          placeholder={t('settings.brandVoicePlaceholder')}
        />
      </SectionCard>

      <SectionCard emoji="📄" title={t('settings.payment')} desc={null}>
        <div className="mb-3 grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
          <label className="block">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t('settings.centralAccount')} (KBANK)
            </div>
            <input
              value={settings.paymentInfo.kbankAccount}
              onChange={(e) => setPayment({ kbankAccount: e.target.value })}
              placeholder="123-4-56789-0"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
          <label className="block">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">PromptPay</div>
            <input
              value={settings.paymentInfo.promptPay}
              onChange={(e) => setPayment({ promptPay: e.target.value })}
              placeholder="0812345678"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
        </div>
        <div className="space-y-2">
          <ToggleRow title={t('settings.ocr')} desc={t('settings.ocrD')} on={settings.ocr} onChange={(v) => set('ocr', v)} />
          <ToggleRow title={t('settings.dedupe')} desc={t('settings.dedupeD')} on={settings.dedupe} onChange={(v) => set('dedupe', v)} />
          <ToggleRow title={t('settings.bankApi')} desc={t('settings.bankApiD')} on={settings.bankApi} onChange={(v) => set('bankApi', v)} />
          <ToggleRow title={t('settings.autoPaid')} desc={t('settings.autoPaidD')} on={settings.autoPaid} onChange={(v) => set('autoPaid', v)} />
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

function ToggleRow({
  title,
  desc,
  defaultOn,
  on: controlledOn,
  onChange,
}: {
  title: string;
  desc: string;
  defaultOn?: boolean;
  on?: boolean;
  onChange?: (v: boolean) => void;
}) {
  const [uOn, setUOn] = useState(defaultOn ?? false);
  const isControlled = typeof controlledOn === 'boolean';
  const on = isControlled ? Boolean(controlledOn) : uOn;
  const toggle = () => {
    const next = !on;
    if (isControlled) onChange?.(next);
    else setUOn(next);
  };
  return (
    <button
      type="button"
      onClick={toggle}
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
