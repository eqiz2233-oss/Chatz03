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
import {
  createShopAccount,
  deleteShopAccount,
  fetchShopAccounts,
  updateShopAccount,
} from '../../lib/slips';
import type { ShopAccount } from '../../types';

export function SettingsView() {
  const { t, theme, setTheme, locale, setLocale } = useAppPreferences();

  return (
    <div className="flex h-screen flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <div className="border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-xl font-bold tracking-tight">{t('settings.title')}</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('settings.subtitle')}</p>
      </div>

      <div className="space-y-5 overflow-y-auto p-5">
        <section className="card p-5">
          <div className="mb-4">
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('settings.appearance')}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{t('settings.appearanceSub')}</div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{t('settings.theme')}</div>
              <Segmented<Theme>
                value={theme}
                onChange={setTheme}
                options={[
                  { value: 'light', label: t('settings.themeLight') },
                  { value: 'dark', label: t('settings.themeDark') },
                ]}
              />
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{t('settings.language')}</div>
              <Segmented<Locale>
                value={locale}
                onChange={setLocale}
                options={[
                  { value: 'th', label: t('settings.langTh') },
                  { value: 'en', label: t('settings.langEn') },
                ]}
              />
            </div>
          </div>
        </section>

        <section className="card p-5">
          <div className="mb-3">
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Integrations</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">เชื่อมต่อแชทแบบกดปุ่มเดียว — Chatz จะรับ-ส่งข้อความให้</div>
          </div>
          <div className="grid gap-2">
            <FacebookIntegrationCard />
            <LineStatusCard t={t} />
          </div>
        </section>

        <section className="card p-5">
          <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">{t('settings.aiEngine')}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Toggle title={t('settings.ai1t')} desc={t('settings.ai1d')} on />
            <Toggle title={t('settings.ai2t')} desc={t('settings.ai2d')} on />
            <Toggle title={t('settings.ai3t')} desc={t('settings.ai3d')} on />
            <Toggle title={t('settings.ai4t')} desc={t('settings.ai4d')} on />
            <Toggle title={t('settings.ai5t')} desc={t('settings.ai5d')} />
            <Toggle title={t('settings.ai6t')} desc={t('settings.ai6d')} on />
          </div>
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">{t('settings.brandVoice')}</div>
            <textarea
              className="mt-2 w-full resize-none rounded-md border border-slate-200 bg-white p-2.5 text-sm text-slate-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-900/40"
              rows={3}
              defaultValue={t('settings.brandVoicePlaceholder')}
            />
          </div>
        </section>

        <section className="card p-5">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('commission.payMethods')}</div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('commission.payMethodsSub')}</p>
          <div className="mt-3 space-y-2">
            <PayMethodRow icon="🏦" name={t('commission.method.bank')} status="active" t={t} />
            <PayMethodRow icon="📱" name={t('commission.method.pp')} status="active" t={t} />
            <PayMethodRow icon="💳" name={t('commission.method.card')} status="setup" t={t} />
            <PayMethodRow icon="🪙" name={t('commission.method.crypto')} status="off" t={t} />
          </div>
        </section>

        <section className="card p-5">
          <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">{t('settings.payment')}</div>
          <div className="space-y-3">
            <ShopAccountsCard t={t} />
            <Toggle title={t('settings.ocr')} desc={t('settings.ocrD')} on />
            <Toggle title={t('settings.dedupe')} desc={t('settings.dedupeD')} on />
            <Toggle title={t('settings.bankApi')} desc={t('settings.bankApiD')} on />
            <Toggle title={t('settings.autoPaid')} desc={t('settings.autoPaidD')} on />
          </div>
        </section>
      </div>
    </div>
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
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-600 dark:bg-slate-800">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={
              'rounded-md px-3 py-1.5 text-xs font-semibold transition ' +
              (active
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200')
            }
          >
            {o.label}
          </button>
        );
      })}
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
    return () => {
      alive = false;
    };
  }, []);
  const configured = !!health?.lineConfigured;
  const reply = !!health?.lineReplyEnabled;
  const count = health?.lineConversationsCount ?? 0;
  const fullyConnected = configured && reply;
  const subtitle = !health
    ? '…'
    : !configured
      ? 'LINE_CHANNEL_SECRET ไม่ถูกตั้งค่า'
      : !reply
        ? 'รับข้อความได้ แต่ส่งกลับยังไม่ได้ (ตั้ง LINE_CHANNEL_ACCESS_TOKEN)'
        : `${count} ห้องแชท`;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <ChannelIcon channel="line" className="h-7 w-7" />
      <div className="flex-1">
        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">LINE Official</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</div>
      </div>
      {fullyConnected ? (
        <span className="chip bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          <I.Check className="h-3 w-3" />
          {t('settings.connected')}
        </span>
      ) : configured ? (
        <span className="chip bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">Read-only</span>
      ) : (
        <span className="chip bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">Not configured</span>
      )}
    </div>
  );
}

function PayMethodRow({
  icon,
  name,
  status,
  t,
}: {
  icon: string;
  name: string;
  status: 'active' | 'setup' | 'off';
  t: (k: string) => string;
}) {
  const tone =
    status === 'active'
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
      : status === 'setup'
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
        : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';
  const label = status === 'active' ? t('commission.method.active') : status === 'setup' ? t('commission.method.setup') : t('commission.method.off');
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
      <div className="flex items-center gap-2 text-sm text-slate-900 dark:text-slate-100">
        <span className="text-base">{icon}</span>
        {name}
      </div>
      <span className={'chip ' + tone}>{label}</span>
    </div>
  );
}

function Toggle({ title, desc, on }: { title: string; desc: string; on?: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 transition hover:border-brand-300 dark:border-slate-700 dark:hover:border-brand-500">
      <div className="flex-1">
        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{title}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">{desc}</div>
      </div>
      <span
        className={
          'mt-1 inline-block h-5 w-9 shrink-0 rounded-full p-0.5 transition ' +
          (on ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-600')
        }
      >
        <span className={'block h-4 w-4 rounded-full bg-white shadow transition ' + (on ? 'translate-x-4' : '')} />
      </span>
    </label>
  );
}

const THAI_BANKS: { value: string; label: string }[] = [
  { value: 'KBANK', label: 'กสิกรไทย (KBANK)' },
  { value: 'SCB', label: 'ไทยพาณิชย์ (SCB)' },
  { value: 'BBL', label: 'กรุงเทพ (BBL)' },
  { value: 'KTB', label: 'กรุงไทย (KTB)' },
  { value: 'BAY', label: 'กรุงศรี (BAY/Krungsri)' },
  { value: 'TTB', label: 'ทีทีบี (TTB)' },
  { value: 'GSB', label: 'ออมสิน (GSB)' },
  { value: 'BAAC', label: 'ธ.ก.ส. (BAAC)' },
  { value: 'CIMB', label: 'CIMB Thai' },
  { value: 'UOB', label: 'UOB' },
  { value: 'TISCO', label: 'TISCO' },
  { value: 'KKP', label: 'เกียรตินาคินภัทร (KKP)' },
  { value: 'LH', label: 'LH Bank' },
  { value: 'TRUEMONEY', label: 'TrueMoney Wallet' },
  { value: 'PROMPTPAY', label: 'PromptPay' },
];

function ShopAccountsCard({ t }: { t: (k: string) => string }) {
  const [accounts, setAccounts] = useState<ShopAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ bank: 'KBANK', accountNo: '', accountName: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setAccounts(await fetchShopAccounts());
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onAdd = async () => {
    if (!form.accountNo.trim() || !form.accountName.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await createShopAccount(form);
      setForm({ bank: form.bank, accountNo: '', accountName: '' });
      await load();
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const onToggle = async (acc: ShopAccount) => {
    setBusy(true);
    try {
      await updateShopAccount(acc.id, { isActive: !acc.isActive });
      await load();
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (acc: ShopAccount) => {
    if (!confirm(t('settings.shopAccount.confirmDelete'))) return;
    setBusy(true);
    try {
      await deleteShopAccount(acc.id);
      await load();
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text);
  };

  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t('settings.shopAccount.title')}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">{t('settings.shopAccount.subtitle')}</div>
        </div>
      </div>

      {loading ? (
        <div className="py-4 text-center text-xs text-slate-400">…</div>
      ) : accounts.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {t('settings.shopAccount.empty')}
        </div>
      ) : (
        <ul className="space-y-2">
          {accounts.map((a) => (
            <li
              key={a.id}
              className={
                'flex items-center justify-between gap-3 rounded-md border px-3 py-2 ' +
                (a.isActive
                  ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/20'
                  : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40')
              }
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{a.accountName}</div>
                <div className="font-mono text-xs text-slate-500 dark:text-slate-400">
                  {a.bank} • {a.accountNo}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => copy(a.accountNo)} className="btn-ghost text-xs" title={t('settings.copy')}>
                  <I.Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => void onToggle(a)}
                  disabled={busy}
                  className={
                    'chip text-xs ' +
                    (a.isActive
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300')
                  }
                >
                  {a.isActive ? t('settings.shopAccount.active') : t('settings.shopAccount.inactive')}
                </button>
                <button onClick={() => void onDelete(a)} disabled={busy} className="btn-ghost text-xs text-rose-600 dark:text-rose-400">
                  <I.X className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr,1fr,1fr,auto]">
        <select
          value={form.bank}
          onChange={(e) => setForm({ ...form, bank: e.target.value })}
          className="rounded-md border border-slate-200 bg-white px-2 py-2 text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        >
          {THAI_BANKS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
        <input
          value={form.accountNo}
          onChange={(e) => setForm({ ...form, accountNo: e.target.value })}
          placeholder={t('settings.shopAccount.placeholderNo')}
          className="rounded-md border border-slate-200 bg-white px-2 py-2 font-mono text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        />
        <input
          value={form.accountName}
          onChange={(e) => setForm({ ...form, accountName: e.target.value })}
          placeholder={t('settings.shopAccount.placeholderName')}
          className="rounded-md border border-slate-200 bg-white px-2 py-2 text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        />
        <button onClick={() => void onAdd()} disabled={busy} className="btn-primary text-xs disabled:opacity-50">
          {t('settings.shopAccount.add')}
        </button>
      </div>

      {err && (
        <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
          {err}
        </div>
      )}
    </div>
  );
}

function FacebookIntegrationCard() {
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

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onConnect = async () => {
    setErr(null);
    setBusy(true);
    try {
      await openFbConnectPopup();
      await refresh();
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = async () => {
    setErr(null);
    setBusy(true);
    try {
      await disconnectFbPage();
      await refresh();
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const isConnected = status?.connected && status.page;

  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex items-start gap-3">
        <div className="flex shrink-0 -space-x-1.5">
          <ChannelIcon channel="facebook" className="h-7 w-7" />
          <ChannelIcon channel="ig" className="h-7 w-7" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">Facebook & Instagram</div>
            {isConnected ? (
              <span className="chip bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                <I.Check className="h-3 w-3" />
                Connected
              </span>
            ) : status?.oauthAvailable ? (
              <span className="chip bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">Not connected</span>
            ) : (
              <span className="chip bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">Setup required</span>
            )}
          </div>

          {isConnected && status?.page ? (
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center gap-2.5 rounded-md bg-slate-50 p-2 dark:bg-slate-800/60">
                <ChannelIcon channel="facebook" className="h-4 w-4 shrink-0" />
                {status.page.picture ? (
                  <img src={status.page.picture} alt="" className="h-9 w-9 rounded-full object-cover" />
                ) : (
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-blue-100 text-blue-700">FB</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{status.page.name}</div>
                  <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {status.page.category || 'Page'} • ID {status.page.id}
                  </div>
                </div>
              </div>
              {status.page.instagram ? (
                <div className="flex items-center gap-2.5 rounded-md bg-slate-50 p-2 dark:bg-slate-800/60">
                  <ChannelIcon channel="ig" className="h-4 w-4 shrink-0" />
                  {status.page.instagram.picture ? (
                    <img src={status.page.instagram.picture} alt="" className="h-9 w-9 rounded-full object-cover" />
                  ) : (
                    <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-pink-500 to-amber-400 text-[10px] font-bold text-white">IG</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">@{status.page.instagram.username}</div>
                    <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                      Instagram Business • ID {status.page.instagram.id}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
                  ไม่มี Instagram Business linked กับเพจนี้ — ต้องไปเชื่อม IG กับเพจใน Meta Business Suite ก่อน แล้วกด Refresh
                </div>
              )}
            </div>
          ) : (
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              กด <b>Connect Facebook & Instagram</b> → login → เลือกเพจ → จบ! ระบบจะ subscribe webhook ทั้ง FB+IG ให้อัตโนมัติ
            </div>
          )}

          {!status?.oauthAvailable && (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              ต้องตั้ง <code className="font-mono">FB_APP_ID</code> และ <code className="font-mono">FB_APP_SECRET</code> ใน <code className="font-mono">.env</code> ก่อน — แล้ว restart{' '}
              <code className="font-mono">npm run dev:server</code>
              <br />
              (เอามาจาก Meta App ของคุณ → Settings → Basic)
            </div>
          )}

          {status?.needsVerifyToken && (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              ต้องตั้ง <code className="font-mono">FB_VERIFY_TOKEN</code> และวาง webhook URL ที่ Meta App console (ทำครั้งเดียว)
            </div>
          )}

          {err && (
            <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 p-2.5 text-[11px] text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
              {err}
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {isConnected ? (
              <>
                <button type="button" onClick={onConnect} disabled={busy} className="btn-secondary text-xs disabled:opacity-50">
                  เปลี่ยนเพจ
                </button>
                <button type="button" onClick={onDisconnect} disabled={busy} className="btn-secondary text-xs text-rose-600 disabled:opacity-50 dark:text-rose-400">
                  Disconnect
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onConnect}
                disabled={busy || !status?.oauthAvailable}
                className="btn-primary text-xs disabled:opacity-50"
              >
                <ChannelIcon channel="facebook" className="h-4 w-4" />
                <ChannelIcon channel="ig" className="h-4 w-4" />
                {busy ? 'Connecting…' : 'Connect Facebook & Instagram'}
              </button>
            )}
            <button type="button" onClick={() => void refresh()} disabled={busy} className="btn-ghost text-xs disabled:opacity-50">
              Refresh
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
