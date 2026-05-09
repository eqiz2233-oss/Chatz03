import { useCallback, useEffect, useState } from 'react';
import type { Locale } from '../../i18n/messages';
import type { Theme } from '../../context/AppPreferencesContext';
import { useAppPreferences } from '../../context/AppPreferencesContext';
import { ChannelIcon, I } from '../Icons';
import {
  disconnectFbPage,
  fetchFbStatus,
  openFbConnectPopup,
  type FbIntegrationStatus,
} from '../../lib/fbIntegration';

type Nav = 'general' | 'integrations' | 'bot';

type NavItem = { key: Nav; label: string; icon: React.ReactNode };
type NavGroup = { label: string; items: NavItem[] };

export function SettingsView() {
  const { t, theme, setTheme, locale, setLocale } = useAppPreferences();
  const [nav, setNav] = useState<Nav>('general');

  const groups: NavGroup[] = [
    {
      label: t('settings.groupAccount'),
      items: [
        { key: 'general', label: t('settings.navGeneral'), icon: <I.Settings className="h-4 w-4" /> },
      ],
    },
    {
      label: t('settings.groupSystem'),
      items: [
        { key: 'integrations', label: t('settings.navIntegrations'), icon: <I.Plug className="h-4 w-4" /> },
        { key: 'bot', label: t('settings.navBot'), icon: <I.Sparkles className="h-4 w-4" /> },
      ],
    },
  ];

  const currentLabel =
    groups.flatMap((g) => g.items).find((i) => i.key === nav)?.label ?? '';

  return (
    <div className="flex h-screen flex-1 bg-slate-50 dark:bg-slate-950">
      {/* Settings sub-sidebar */}
      <aside className="w-60 shrink-0 border-r border-slate-200 bg-white px-4 py-5 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="px-2 text-base font-bold tracking-tight text-slate-900 dark:text-white">
          {t('settings.title')}
        </h1>
        <nav className="mt-5 space-y-5">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {g.label}
              </div>
              <div className="space-y-0.5">
                {g.items.map((it) => {
                  const active = nav === it.key;
                  return (
                    <button
                      key={it.key}
                      type="button"
                      onClick={() => setNav(it.key)}
                      className={
                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition ' +
                        (active
                          ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100')
                      }
                    >
                      <span className={active ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400 dark:text-slate-500'}>
                        {it.icon}
                      </span>
                      {it.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-6">
          {/* Breadcrumb */}
          <div className="mb-6 flex items-center gap-1.5 text-sm">
            <span className="text-slate-400 dark:text-slate-500">{t('settings.title')}</span>
            <I.ChevronRight className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600" />
            <span className="font-semibold text-slate-900 dark:text-slate-100">{currentLabel}</span>
          </div>

          {nav === 'general' && (
            <GeneralPanel t={t} theme={theme} setTheme={setTheme} locale={locale} setLocale={setLocale} />
          )}
          {nav === 'integrations' && <IntegrationsPanel t={t} />}
          {nav === 'bot' && <BotPanel t={t} locale={locale} />}
        </div>
      </div>
    </div>
  );
}

function PanelHeader({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{title}</h2>
      {desc && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{desc}</p>}
    </div>
  );
}

function GeneralPanel({
  t, theme, setTheme, locale, setLocale,
}: {
  t: (k: string) => string;
  theme: Theme;
  setTheme: (v: Theme) => void;
  locale: Locale;
  setLocale: (v: Locale) => void;
}) {
  return (
    <div className="space-y-4">
      <PanelHeader title={t('settings.navGeneral')} desc={t('settings.appearanceSub')} />

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

function IntegrationsPanel({ t }: { t: (k: string) => string }) {
  return (
    <div className="space-y-4">
      <PanelHeader title={t('settings.navIntegrations')} desc={t('settings.channelsSub')} />
      <FacebookIntegrationCard t={t} />
      <LineStatusCard t={t} />
      <SlipCheckerCard t={t} />
    </div>
  );
}

function BotPanel({ t, locale }: { t: (k: string) => string; locale: Locale }) {
  return (
    <div className="space-y-4">
      <PanelHeader title={t('settings.navBot')} />

      <SectionCard
        emoji="⚡"
        title={t('settings.aiEngine')}
        desc={locale === 'th' ? 'เปิด-ปิดฟีเจอร์บอทได้ตามต้องการ' : 'Turn each bot feature on or off'}
      >
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

function SlipCheckerCard({ t: _t }: { t: (k: string) => string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setEnabled(Boolean(d?.slipChecker?.enabled)))
      .catch(() => setEnabled(false));
  }, []);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <span className="text-xl">📄</span>
        <div className="flex-1">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">EasySlip API</div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">ตรวจสลิปกับธนาคารจริง</div>
        </div>
        {enabled === null ? (
          <span className="chip bg-slate-100 text-slate-400 dark:bg-slate-800">...</span>
        ) : enabled ? (
          <span className="chip bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            <I.Check className="h-3 w-3" /> เชื่อมแล้ว
          </span>
        ) : (
          <span className="chip bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">ทดลองใช้</span>
        )}
      </div>
      <div className="px-5 py-4 text-xs text-slate-500 dark:text-slate-400">
        {enabled
          ? 'ระบบกำลังตรวจสลิปกับข้อมูลธนาคารจริงผ่าน EasySlip API'
          : 'ตั้งค่า EASYSLIP_TOKEN ใน .env เพื่อเปิดใช้การตรวจกับธนาคารจริง ตอนนี้ใช้โหมดทดลองอยู่'}
      </div>
    </div>
  );
}

interface HealthSnapshot {
  ok?: boolean;
  lineConfigured?: boolean;
  lineReplyEnabled?: boolean;
  lineConversationsCount?: number;
}

function LineStatusCard({ t }: { t: (k: string) => string }) {
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/health')
      .then((r) => r.json())
      .then((d: HealthSnapshot) => alive && setHealth(d))
      .catch(() => alive && setHealth({}));
    return () => { alive = false; };
  }, []);
  const configured = !!health?.lineConfigured;
  const reply = !!health?.lineReplyEnabled;
  const count = health?.lineConversationsCount ?? 0;
  const fullyConnected = configured && reply;
  const subtitle = !health
    ? '...'
    : !configured
      ? 'ยังไม่ได้ตั้งค่า — ใส่ LINE_CHANNEL_SECRET ใน .env'
      : !reply
        ? 'รับข้อความได้แล้ว แต่ยังส่งกลับไม่ได้'
        : `${count} ห้องแชท`;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <ChannelIcon channel="line" className="h-8 w-8" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">LINE Official Account</div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</div>
        </div>
        {fullyConnected ? (
          <span className="chip bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            <I.Check className="h-3 w-3" /> {t('settings.connected')}
          </span>
        ) : configured ? (
          <span className="chip bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">รับอย่างเดียว</span>
        ) : (
          <span className="chip bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{t('settings.notConnected')}</span>
        )}
      </div>
      {!configured && (
        <div className="px-5 py-3 text-xs text-slate-500 dark:text-slate-400">
          ใส่ <code className="rounded bg-slate-100 px-1 py-0.5 font-mono dark:bg-slate-800">LINE_CHANNEL_SECRET</code> และ <code className="rounded bg-slate-100 px-1 py-0.5 font-mono dark:bg-slate-800">LINE_CHANNEL_ACCESS_TOKEN</code> ใน .env แล้ว restart
        </div>
      )}
    </div>
  );
}

function FacebookIntegrationCard({ t }: { t: (k: string) => string }) {
  const [status, setStatus] = useState<FbIntegrationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await fetchFbStatus();
      setStatus(s);
    } catch (e) {
      setErr(String((e as Error).message || e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const onConnect = async () => {
    setErr(null);
    setBusy(true);
    try { await openFbConnectPopup(); await refresh(); }
    catch (e) { setErr(String((e as Error).message || e)); }
    finally { setBusy(false); }
  };

  const onDisconnect = async () => {
    setErr(null);
    setBusy(true);
    try { await disconnectFbPage(); await refresh(); }
    catch (e) { setErr(String((e as Error).message || e)); }
    finally { setBusy(false); }
  };

  const isConnected = status?.connected && status.page;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <div className="flex shrink-0 -space-x-2">
          <ChannelIcon channel="facebook" className="h-8 w-8 ring-2 ring-white dark:ring-slate-900" />
          <ChannelIcon channel="ig" className="h-8 w-8 ring-2 ring-white dark:ring-slate-900" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Facebook & Instagram</div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {isConnected ? status!.page!.name : 'เชื่อมต่อด้วยการกดปุ่มด้านล่าง'}
          </div>
        </div>
        {isConnected ? (
          <span className="chip bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            <I.Check className="h-3 w-3" /> {t('settings.connected')}
          </span>
        ) : (
          <span className="chip bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{t('settings.notConnected')}</span>
        )}
      </div>

      {isConnected && status?.page && (
        <div className="space-y-2 px-5 py-3">
          <PageRow
            icon={<ChannelIcon channel="facebook" className="h-4 w-4" />}
            picture={status.page.picture}
            name={status.page.name}
            sub={status.page.category || 'Facebook Page'}
            color="blue"
          />
          {status.page.instagram ? (
            <PageRow
              icon={<ChannelIcon channel="ig" className="h-4 w-4" />}
              picture={status.page.instagram.picture}
              name={`@${status.page.instagram.username}`}
              sub="Instagram Business"
              color="pink"
            />
          ) : (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              ไม่มี Instagram Business เชื่อมกับเพจนี้ — เชื่อมใน Meta Business Suite แล้วกด{' '}
              <button type="button" onClick={() => void refresh()} className="text-brand-600 underline dark:text-brand-400">{t('settings.refresh')}</button>
            </p>
          )}
        </div>
      )}

      {!status?.oauthAvailable && (
        <div className="mx-5 mb-3 rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          ต้องใส่ <code className="font-mono">FB_APP_ID</code> และ <code className="font-mono">FB_APP_SECRET</code> ใน .env ก่อน
        </div>
      )}

      {err && (
        <div className="mx-5 mb-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-200">{err}</div>
      )}

      <div className="flex gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
        {isConnected ? (
          <>
            <button type="button" onClick={onConnect} disabled={busy} className="btn-secondary text-xs disabled:opacity-50">{t('settings.reconnect')}</button>
            <button type="button" onClick={onDisconnect} disabled={busy} className="btn-secondary text-xs text-rose-600 disabled:opacity-50 dark:text-rose-400">{t('settings.disconnect')}</button>
          </>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            disabled={busy || !status?.oauthAvailable}
            className="btn-primary text-sm disabled:opacity-50"
          >
            <ChannelIcon channel="facebook" className="h-4 w-4" />
            <ChannelIcon channel="ig" className="h-4 w-4" />
            {busy ? 'กำลังเชื่อมต่อ…' : 'เชื่อมต่อ Facebook & Instagram'}
          </button>
        )}
        <button type="button" onClick={() => void refresh()} disabled={busy} className="btn-ghost text-xs disabled:opacity-50">{t('settings.refresh')}</button>
      </div>
    </div>
  );
}

function PageRow({
  icon, picture, name, sub, color,
}: {
  icon: React.ReactNode;
  picture: string | null | undefined;
  name: string;
  sub: string;
  color: 'blue' | 'pink';
}) {
  const placeholder = color === 'blue' ? 'bg-blue-100 text-blue-600' : 'bg-pink-100 text-pink-600';
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/60">
      {picture ? (
        <img src={picture} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
      ) : (
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold ${placeholder}`}>
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{name}</div>
        <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">{sub}</div>
      </div>
    </div>
  );
}
