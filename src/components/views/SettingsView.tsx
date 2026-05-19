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
import {
  fetchLineStatus,
  connectLine,
  connectLineOAuth,
  disconnectLine,
  type LineIntegrationStatus,
} from '../../lib/lineIntegration';
import { useMutedState, playNotification } from '../../lib/inboxNotifications';
import {
  listShopMembers,
  createShopInvite,
  removeShopMember,
  type ShopMember,
} from '../../lib/team';

/**
 * The Settings page uses a vertical sidebar (left) + active section content
 * (right), matching the pattern of Linear/Notion/Slack. Scales better than
 * horizontal tabs and reads as a "real settings page" instead of a small
 * tab strip on a content area.
 *
 * Section ordering is by frequency of access for a small Thai seller:
 *   channels   → first thing to do (connect LINE/FB/IG)
 *   ai-bot     → second priority: teach the bot what to say
 *   notifications, appearance, account → infrequent / one-time
 */
type SettingsSection =
  | 'profile'      // display name, email, avatar, team
  | 'shop'         // shop name, hours, contact (Business profile)
  | 'channels'     // LINE / FB / IG / EasySlip
  | 'ai-bot'       // brand voice, keyword rules
  | 'notifications'
  | 'appearance'   // theme + language
  | 'safety'       // privacy + security merged (one trust pane)
  | 'about';       // version, privacy policy, terms

interface NavItem {
  key: SettingsSection;
  label: string;
  icon: React.ReactNode;
}

export function SettingsView() {
  const { t, theme, setTheme, locale, setLocale } = useAppPreferences();
  const [section, setSection] = useState<SettingsSection>('profile');

  // Identity → operational → trust → about. Privacy + Security collapse into
  // one "ความปลอดภัยและความเป็นส่วนตัว" pane: most of those rows were thin
  // (coming-soon chips) and the user couldn't tell them apart anyway.
  const nav: NavItem[] = [
    { key: 'profile',       label: locale === 'th' ? 'โปรไฟล์' : 'Profile',            icon: <I.User className="h-[18px] w-[18px]" /> },
    { key: 'shop',          label: locale === 'th' ? 'ข้อมูลร้าน' : 'Business profile', icon: <I.Store className="h-[18px] w-[18px]" /> },
    { key: 'channels',      label: locale === 'th' ? 'การเชื่อมต่อ' : 'Integrations',   icon: <I.Plug className="h-[18px] w-[18px]" /> },
    { key: 'ai-bot',        label: locale === 'th' ? 'การตั้งค่าบอท' : 'Bot settings',   icon: <I.Bot className="h-[18px] w-[18px]" /> },
    { key: 'notifications', label: locale === 'th' ? 'การแจ้งเตือน' : 'Notifications',  icon: <I.Bell className="h-[18px] w-[18px]" /> },
    { key: 'appearance',    label: locale === 'th' ? 'การแสดงผล' : 'Display',          icon: <I.Palette className="h-[18px] w-[18px]" /> },
    { key: 'safety',        label: locale === 'th' ? 'ความปลอดภัยและความเป็นส่วนตัว' : 'Privacy & security', icon: <I.Shield className="h-[18px] w-[18px]" /> },
    { key: 'about',         label: locale === 'th' ? 'เกี่ยวกับ' : 'About',             icon: <I.Info className="h-[18px] w-[18px]" /> },
  ];

  const activeNav = nav.find((n) => n.key === section);

  return (
    <div className="flex h-screen flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      {/* Page header — gradient brand chip + title gives the settings panel
          the "this is a real product" weight the user asked for. */}
      <header className="shrink-0 border-b border-slate-200/70 bg-white/80 px-6 py-3.5 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/80 md:px-8">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-pink-500 text-white shadow-md shadow-brand-500/25" aria-hidden>
            <I.Settings className="h-[18px] w-[18px]" />
          </span>
          <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
            {locale === 'th' ? 'ตั้งค่า' : 'Settings'}
          </h1>
        </div>
      </header>

      {/* Body: sidebar + content */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ── Left nav (desktop) — active row gets a brand-tinted background +
            a left accent bar so the eye locks on the current section. ── */}
        <aside className="hidden w-[240px] shrink-0 overflow-y-auto border-r border-slate-200/70 bg-white/60 py-3 dark:border-slate-800 dark:bg-slate-900/60 md:block">
          <nav className="px-2">
            {nav.map((it) => {
              const isActive = it.key === section;
              return (
                <button
                  key={it.key}
                  type="button"
                  onClick={() => setSection(it.key)}
                  className={
                    'relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-all duration-300 ease-out ' +
                    (isActive
                      ? 'bg-gradient-to-r from-brand-50 to-pink-50/70 text-slate-900 shadow-sm dark:from-brand-950/40 dark:to-pink-950/30 dark:text-white'
                      : 'text-slate-600 hover:bg-slate-100/70 dark:text-slate-300 dark:hover:bg-slate-800/60')
                  }
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-brand-500 to-pink-500" aria-hidden />
                  )}
                  <span className={isActive ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400 dark:text-slate-500'}>
                    {it.icon}
                  </span>
                  <span className="text-[13px] font-medium leading-tight">{it.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* ── Mobile: horizontal scroll tabs (LINE settings pattern) ── */}
        <div className="md:hidden border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex overflow-x-auto">
            {nav.map((it) => {
              const isActive = it.key === section;
              return (
                <button
                  key={it.key}
                  type="button"
                  onClick={() => setSection(it.key)}
                  className={
                    'shrink-0 border-b-2 px-4 py-3 text-sm font-medium transition ' +
                    (isActive
                      ? 'border-brand-600 text-slate-900 dark:border-brand-400 dark:text-white'
                      : 'border-transparent text-slate-500 dark:text-slate-400')
                  }
                >
                  {it.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Content. Section header up top with the active nav label so
            users always know which section they're in, even on mobile. ── */}
        <main className="min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-slate-50/60 to-slate-50 dark:from-slate-950 dark:to-slate-950">
          <div className="mx-auto max-w-2xl px-5 py-6 md:px-8 md:py-7">
            {activeNav && (
              <div className="mb-5 flex items-center gap-2.5">
                <span className="text-brand-500 dark:text-brand-400" aria-hidden>{activeNav.icon}</span>
                <h2 className="text-[22px] font-bold tracking-tight text-slate-900 dark:text-white">
                  {activeNav.label}
                </h2>
              </div>
            )}
            {section === 'profile' && <ProfileSection locale={locale} />}
            {section === 'shop' && <BusinessProfileSection locale={locale} />}
            {section === 'channels' && <ChannelsSection t={t} />}
            {section === 'ai-bot' && <AiBotSection t={t} />}
            {section === 'notifications' && <NotificationsSection locale={locale} />}
            {section === 'appearance' && <AppearanceSection t={t} theme={theme} setTheme={setTheme} locale={locale} setLocale={setLocale} />}
            {section === 'safety' && <SafetyPrivacySection t={t} locale={locale} />}
            {section === 'about' && <AboutSection locale={locale} />}
          </div>
        </main>
      </div>
    </div>
  );
}

/** Theme + Language — purely client-side preferences. */
function AppearanceSection({
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
      <SectionCard
        title={t('settings.theme')}
        desc={locale === 'th' ? 'เปลี่ยนระหว่างโหมดสว่างกับโหมดมืด' : 'Switch between light and dark mode'}
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

/** Account section — wraps the existing AccountCard + adds the Team card. */
/**
 * ─── Profile section ─────────────────────────────────────────────────────
 * Edit-in-place display name, email, and team membership. Profile is the
 * "who am I" pane that every chat app puts first; security (password) is
 * intentionally in a separate Security section so destructive actions
 * don't sit next to common edits.
 */
function ProfileSection({ locale }: { locale: Locale }) {
  const { user, updateProfile } = useAuth();
  const th = locale === 'th';
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    setDisplayName(user?.displayName || '');
    setEmail(user?.email || '');
  }, [user]);

  const dirty = (displayName.trim() !== (user?.displayName || '')) || (email.trim() !== (user?.email || ''));

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const r = await updateProfile({
      displayName: displayName.trim(),
      email: email.trim(),
    });
    setSaving(false);
    if (r.ok) {
      setMsg({ kind: 'ok', text: th ? 'บันทึกแล้ว' : 'Saved' });
    } else {
      const code = r.error;
      setMsg({
        kind: 'err',
        text: code === 'email_taken' ? (th ? 'อีเมลนี้ถูกใช้แล้ว' : 'Email already in use')
            : code === 'bad_email' ? (th ? 'รูปแบบอีเมลไม่ถูกต้อง' : 'Invalid email format')
            : (th ? 'บันทึกไม่สำเร็จ' : 'Save failed'),
      });
    }
  }

  const initials = (user?.displayName || user?.username || '?').slice(0, 2).toUpperCase();

  return (
    <div className="space-y-4">
      <SectionCard
        title={th ? 'โปรไฟล์ของฉัน' : 'My profile'}
        desc={th ? 'ข้อมูลที่แสดงในร้านและให้ทีมเห็น' : 'How you appear to your team and customers'}
      >
        <form onSubmit={onSave} className="space-y-4">
          {/* Avatar + initials. Real upload is on the roadmap; initials work as a
              deterministic stable identity in the meantime. */}
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-brand-600 text-base font-bold text-white">
              {initials}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {th
                ? 'รูปโปรไฟล์ปัจจุบันใช้ตัวอักษรย่อ — รองรับการอัปโหลดในเร็วๆ นี้'
                : 'Currently shown as initials — upload coming soon'}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
              {th ? 'ชื่อที่แสดง' : 'Display name'}
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={th ? 'เช่น คุณเอก' : 'e.g. Alex'}
              className={fieldInput}
              maxLength={80}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
              {th ? 'อีเมล' : 'Email'}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={fieldInput}
            />
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              {th
                ? 'ใช้สำหรับรีเซ็ตรหัสและรับแจ้งเตือนสำคัญ'
                : 'Used for password reset and important alerts'}
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
              {th ? 'ชื่อผู้ใช้' : 'Username'}
            </label>
            <div className="rounded-lg bg-slate-50 px-3.5 py-2.5 font-mono text-sm text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {user?.username}
            </div>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              {th ? 'เปลี่ยนชื่อผู้ใช้ไม่ได้' : 'Username cannot be changed'}
            </p>
          </div>

          {msg && (
            <div
              className={
                'rounded-lg px-3 py-2 text-xs ' +
                (msg.kind === 'ok'
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200'
                  : 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-200')
              }
            >
              {msg.text}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving || !dirty}
              className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-500 dark:hover:bg-brand-400"
            >
              {saving ? (th ? 'กำลังบันทึก…' : 'Saving…') : (th ? 'บันทึก' : 'Save')}
            </button>
          </div>
        </form>
      </SectionCard>

      <TeamCard locale={locale} />
    </div>
  );
}

const fieldInput =
  'w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-brand-500 dark:focus:ring-brand-900/40';

/**
 * ─── Business profile ────────────────────────────────────────────────────
 * Shop-level info the customer sees indirectly (AI uses these in replies)
 * and that staff use to recognize the shop in their workspace. Persists
 * via the existing bot.settings shop-scoped row.
 */
function BusinessProfileSection({ locale }: { locale: Locale }) {
  const th = locale === 'th';
  const [shopName, setShopName] = useState('');
  const [tagline, setTagline] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [hoursOpen, setHoursOpen] = useState('09:00');
  const [hoursClose, setHoursClose] = useState('21:00');
  const [hoursEnabled, setHoursEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch('/api/bot/settings', { credentials: 'include' });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as { settings: Record<string, unknown> };
        const s = j.settings || {};
        const sp = (s.shopProfile as Record<string, unknown>) || {};
        if (!cancelled) {
          setShopName(String(sp.shopName || ''));
          setTagline(String(sp.tagline || ''));
          setPhone(String(sp.phone || ''));
          setAddress(String(sp.address || ''));
          setHoursOpen(String(sp.hoursOpen || '09:00'));
          setHoursClose(String(sp.hoursClose || '21:00'));
          setHoursEnabled(Boolean(sp.hoursEnabled));
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Debounced save — same pattern as the bot/keyword cards above.
  useEffect(() => {
    if (!loaded) return;
    setSaveStatus('saving');
    const id = window.setTimeout(async () => {
      try {
        const r = await fetch('/api/bot/settings', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            settings: {
              shopProfile: {
                shopName: shopName.trim(),
                tagline: tagline.trim(),
                phone: phone.trim(),
                address: address.trim(),
                hoursOpen,
                hoursClose,
                hoursEnabled,
              },
            },
          }),
        });
        setSaveStatus(r.ok ? 'saved' : 'error');
      } catch {
        setSaveStatus('error');
      }
      window.setTimeout(() => setSaveStatus('idle'), 1500);
    }, 600);
    return () => window.clearTimeout(id);
  }, [shopName, tagline, phone, address, hoursOpen, hoursClose, hoursEnabled, loaded]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2 text-[11px] text-slate-400 dark:text-slate-500">
        {saveStatus === 'saving' && <span>{th ? 'กำลังบันทึก…' : 'Saving…'}</span>}
        {saveStatus === 'saved' && <span className="text-emerald-600 dark:text-emerald-400">{th ? 'บันทึกแล้ว ✓' : 'Saved ✓'}</span>}
        {saveStatus === 'error' && <span className="text-rose-500">{th ? 'บันทึกไม่สำเร็จ' : 'Save failed'}</span>}
      </div>

      <SectionCard
        title={th ? 'ข้อมูลร้าน' : 'Shop info'}
        desc={th ? 'AI จะใช้ข้อมูลนี้ตอบลูกค้าและเป็นชื่อร้านที่แสดงให้ทีม' : 'AI uses this when replying; staff see it as the shop label'}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
              {th ? 'ชื่อร้าน' : 'Shop name'}
            </label>
            <input value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder={th ? 'เช่น Mint Skincare' : 'e.g. Mint Skincare'} className={fieldInput} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
              {th ? 'คำโปรย' : 'Tagline'}
            </label>
            <input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder={th ? 'เช่น เครื่องสำอางออร์แกนิค 100%' : 'e.g. 100% organic skincare'} className={fieldInput} />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={th ? 'ติดต่อ' : 'Contact'}
        desc={th ? 'ลูกค้าและทีมเห็นข้อมูลนี้ในโปรไฟล์ร้าน' : 'Shown on your shop profile to customers and team'}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
              {th ? 'เบอร์โทร' : 'Phone'}
            </label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="081-234-5678" className={fieldInput} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
              {th ? 'ที่อยู่' : 'Address'}
            </label>
            <textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder={th ? 'เช่น 123 ถ.รัชดา กรุงเทพฯ 10310' : 'e.g. 123 Sukhumvit, Bangkok 10110'} rows={2} className={'resize-none ' + fieldInput} />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={th ? 'เวลาทำการ' : 'Business hours'}
        desc={th ? 'AI ส่งข้อความ "อยู่นอกเวลา" เมื่อลูกค้าทักนอกช่วงนี้' : 'AI tells customers "out of hours" when they message outside this window'}
      >
        <div className="space-y-4">
          <SettingRow
            label={th ? 'เปิดใช้งานเวลาทำการ' : 'Enable business hours'}
            hint={th ? 'ปิดไว้ = AI ตอบ 24 ชม.' : 'Off = AI replies 24/7'}
          >
            <Switch checked={hoursEnabled} onChange={setHoursEnabled} label="enable hours" />
          </SettingRow>
          {hoursEnabled && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {th ? 'เปิด' : 'Open'}
                </label>
                <input type="time" value={hoursOpen} onChange={(e) => setHoursOpen(e.target.value)} className={fieldInput} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {th ? 'ปิด' : 'Close'}
                </label>
                <input type="time" value={hoursClose} onChange={(e) => setHoursClose(e.target.value)} className={fieldInput} />
              </div>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

/**
 * ─── Privacy ─────────────────────────────────────────────────────────────
 * Soft-launched: read-receipt toggle + data export placeholder. These are
 * the trust-level controls every messenger app surfaces (LINE: "Provide
 * read receipts", Messenger: "Active status"). Full implementation
 * follows the public-API parity work.
 */
function ComingSoonChip({ locale }: { locale: Locale }) {
  return (
    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
      {locale === 'th' ? 'เร็วๆ นี้' : 'Coming soon'}
    </span>
  );
}

/**
 * ─── Privacy & Security (merged) ─────────────────────────────────────────
 * The old screens were two thin panes mostly full of coming-soon chips. One
 * merged pane is easier to trust: bot account, sessions, 2FA on the top;
 * visibility + data underneath; account deletion at the very bottom inside
 * a destructive card. Three cards total instead of eight.
 */
function SafetyPrivacySection({ t, locale }: { t: (k: string) => string; locale: Locale }) {
  const { user, deleteAccount } = useAuth();
  const th = locale === 'th';
  const [deleting, setDeleting] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  async function onDelete() {
    const phrase = th ? 'ลบบัญชี' : 'DELETE';
    const typed = window.prompt(
      th
        ? `การลบบัญชีจะลบข้อมูลของคุณถาวร พิมพ์ "${phrase}" เพื่อยืนยัน`
        : `Deleting your account is permanent. Type "${phrase}" to confirm.`,
    );
    if (typed !== phrase) return;
    setDeleting(true);
    setDelErr(null);
    const r = await deleteAccount();
    setDeleting(false);
    if (!r.ok) {
      setDelErr(
        r.error === 'last_owner_of'
          ? (th
              ? 'คุณเป็นเจ้าของร้านเพียงคนเดียว — โอนความเป็นเจ้าของให้คนอื่นก่อน'
              : 'You are the only owner of a shop — transfer ownership first')
          : (th ? 'ลบบัญชีไม่สำเร็จ' : 'Account deletion failed'),
      );
    }
  }

  return (
    <div className="space-y-4">
      {/* 1. ความปลอดภัยของบัญชี — password (AccountCard) + sessions + 2FA */}
      <AccountCard t={t} locale={locale} />

      <SectionCard
        title={th ? 'การลงชื่อเข้าใช้และการยืนยันตัวตน' : 'Sign-in & verification'}
        desc={th
          ? 'อุปกรณ์ที่ใช้งานบัญชีนี้ และตัวเลือกความปลอดภัยเพิ่มเติม'
          : 'Devices using this account and extra security options'}
      >
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          <SettingRow
            label={th ? 'อุปกรณ์ที่ลงชื่อเข้าใช้' : 'Active sessions'}
            hint={th ? 'ออกจากระบบจากอุปกรณ์อื่น' : 'Sign out other devices'}
          >
            <ComingSoonChip locale={locale} />
          </SettingRow>
          <SettingRow
            label={th ? 'ยืนยันตัวตน 2 ขั้นตอน (2FA)' : 'Two-factor authentication'}
            hint={th ? 'เพิ่มชั้นความปลอดภัยด้วยรหัสจาก Authenticator' : 'Add an extra layer with Authenticator codes'}
          >
            <ComingSoonChip locale={locale} />
          </SettingRow>
        </div>
      </SectionCard>

      {/* 2. ความเป็นส่วนตัว + ข้อมูล — read receipts, online status, blocked, data export */}
      <SectionCard
        title={th ? 'ความเป็นส่วนตัวและข้อมูล' : 'Privacy & data'}
        desc={th
          ? 'ลูกค้าเห็นอะไรเกี่ยวกับคุณบ้าง และวิธีจัดการข้อมูลของคุณ'
          : 'What customers see about you, and how to manage your data'}
      >
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          <SettingRow
            label={th ? 'แจ้งสถานะ "อ่านแล้ว"' : 'Send read receipts'}
            hint={th ? 'ลูกค้าจะเห็นว่าคุณอ่านข้อความแล้ว' : 'Customers see "read" on their messages'}
          >
            <ComingSoonChip locale={locale} />
          </SettingRow>
          <SettingRow
            label={th ? 'แสดงสถานะออนไลน์' : 'Show online status'}
            hint={th ? 'ลูกค้าเห็นจุดเขียวเมื่อคุณออนไลน์อยู่' : 'Customers see a green dot when you are online'}
          >
            <ComingSoonChip locale={locale} />
          </SettingRow>
          <SettingRow
            label={th ? 'รายชื่อบล็อก' : 'Blocked customers'}
            hint={th ? 'ยังไม่มีลูกค้าที่บล็อก' : 'No blocked customers yet'}
          >
            <ComingSoonChip locale={locale} />
          </SettingRow>
          <SettingRow
            label={th ? 'ดาวน์โหลดข้อมูลของฉัน' : 'Download my data'}
            hint={th ? 'ขอสำเนาข้อมูลทั้งหมดในรูปแบบ JSON' : 'Get a copy of all your data as JSON'}
          >
            <ComingSoonChip locale={locale} />
          </SettingRow>
        </div>
      </SectionCard>

      {/* 3. ลบบัญชี — destructive, kept in its own card and visually separated */}
      <SectionCard
        title={th ? 'ลบบัญชี' : 'Delete account'}
        desc={th
          ? 'ลบบัญชีและข้อมูลของคุณถาวร — กู้คืนไม่ได้'
          : 'Permanently delete your account and data — cannot be undone'}
      >
        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
          {th
            ? `แชทเก่า แม่แบบ และการตั้งค่าทั้งหมดของ ${user?.displayName || user?.username || ''} จะถูกลบ ถ้าคุณเป็นเจ้าของร้านเพียงคนเดียว ต้องโอนความเป็นเจ้าของให้คนอื่นก่อน`
            : `All chats, templates, and settings for ${user?.displayName || user?.username || 'this account'} will be removed. If you're the only owner of a shop, transfer ownership first.`}
        </p>
        {delErr && (
          <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/50 dark:text-rose-200">
            {delErr}
          </div>
        )}
        <button
          type="button"
          onClick={() => void onDelete()}
          disabled={deleting}
          className="rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900/60 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-950/40"
        >
          {deleting ? (th ? 'กำลังลบ…' : 'Deleting…') : (th ? 'ลบบัญชีถาวร' : 'Permanently delete account')}
        </button>
      </SectionCard>
    </div>
  );
}

/**
 * ─── About ───────────────────────────────────────────────────────────────
 * Version + legal links + support. Required for FB / Google app review
 * (privacy policy + terms URLs).
 */
function AboutSection({ locale }: { locale: Locale }) {
  const th = locale === 'th';
  // Version is baked at build-time; for now this is the marketing string
  // until we wire it to package.json via Vite define.
  const version = '0.9.0-beta';
  return (
    <div className="space-y-4">
      <SectionCard
        title={th ? 'เกี่ยวกับ Chatz' : 'About Chatz'}
        desc={th ? 'ข้อมูลแอปและเวอร์ชัน' : 'App info and version'}
      >
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500 dark:text-slate-400">{th ? 'เวอร์ชัน' : 'Version'}</dt>
            <dd className="font-mono text-slate-700 dark:text-slate-200">{version}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500 dark:text-slate-400">{th ? 'ช่องทาง' : 'Channels'}</dt>
            <dd className="text-slate-700 dark:text-slate-200">LINE · Facebook · Instagram</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500 dark:text-slate-400">{th ? 'AI' : 'AI'}</dt>
            <dd className="text-slate-700 dark:text-slate-200">Anthropic Claude</dd>
          </div>
        </dl>
      </SectionCard>

      <SectionCard
        title={th ? 'นโยบายและเงื่อนไข' : 'Legal'}
        desc={th ? 'นโยบายความเป็นส่วนตัวและเงื่อนไขการใช้งาน' : 'Privacy policy and terms of service'}
      >
        <ul className="space-y-3 text-sm">
          <li>
            <a href="/api/privacy" target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
              {th ? 'นโยบายความเป็นส่วนตัว →' : 'Privacy Policy →'}
            </a>
          </li>
          <li>
            <a href="/api/terms" target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
              {th ? 'เงื่อนไขการใช้งาน →' : 'Terms of Service →'}
            </a>
          </li>
          <li>
            <a href="https://github.com/eqiz2233-oss/Chatz03" target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
              {th ? 'ซอร์สโค้ดบน GitHub →' : 'Source code on GitHub →'}
            </a>
          </li>
        </ul>
      </SectionCard>

      <SectionCard
        title={th ? 'ความช่วยเหลือ' : 'Support'}
        desc={th ? 'มีปัญหา? ติดต่อทีมงาน' : 'Need help? Reach out'}
      >
        <SettingRow label={th ? 'ติดต่อทีมสนับสนุน' : 'Contact support'}>
          <ComingSoonChip locale={locale} />
        </SettingRow>
      </SectionCard>
    </div>
  );
}

/**
 * Team / shop-member management. An owner can:
 *  - see who else has access to this shop
 *  - generate a shareable invite URL (paste anywhere — LINE, IG, SMS)
 *  - remove a teammate (the last owner is protected)
 * A staff member sees the list and can leave the shop.
 */
function TeamCard({ locale }: { locale: Locale }) {
  const { user, activeShop } = useAuth();
  const th = locale === 'th';
  const shopId = activeShop?.id || null;

  const [members, setMembers] = useState<ShopMember[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    if (!shopId) return;
    try {
      setMembers(await listShopMembers(shopId));
    } catch (e) {
      setErr(String((e as Error).message || e));
    }
  }, [shopId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const me = members?.find((m) => m.id === user?.id) || null;
  const isOwner = me?.role === 'owner';

  async function onInvite() {
    if (!shopId) return;
    setErr(null);
    setInviteUrl(null);
    setBusy(true);
    try {
      const invite = await createShopInvite(shopId, 'staff');
      setInviteUrl(invite.url);
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }

  async function onCopy() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* user can still select the text manually */
    }
  }

  async function onRemove(targetUserId: string) {
    if (!shopId) return;
    const target = members?.find((m) => m.id === targetUserId);
    const isSelf = targetUserId === user?.id;
    const msg = isSelf
      ? (th ? 'ออกจากร้านนี้?' : 'Leave this shop?')
      : (th
          ? `เอา ${target?.displayName || target?.username || 'สมาชิก'} ออกจากร้านนี้?`
          : `Remove ${target?.displayName || target?.username || 'member'} from this shop?`);
    if (!window.confirm(msg)) return;
    setErr(null);
    setBusy(true);
    try {
      await removeShopMember(shopId, targetUserId);
      await refresh();
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      title={th ? 'ทีมงาน' : 'Team'}
      desc={th
        ? 'เชิญแอดมินคนอื่นเข้ามาช่วยตอบลูกค้าในร้านนี้'
        : 'Invite teammates to help reply on this shop'}
    >
      {members === null ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{th ? 'กำลังโหลด…' : 'Loading…'}</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{th ? 'ไม่มีสมาชิก' : 'No members'}</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-2.5">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
                {(m.displayName || m.username || '?').slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {m.displayName || m.username}
                  {m.id === user?.id && (
                    <span className="ml-1.5 text-xs font-normal text-slate-400">({th ? 'คุณ' : 'you'})</span>
                  )}
                </div>
                <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {m.role === 'owner' ? (th ? 'เจ้าของร้าน' : 'Owner') : (th ? 'แอดมิน' : 'Staff')}
                  {m.email ? ` · ${m.email}` : ''}
                </div>
              </div>
              {(isOwner || m.id === user?.id) && (
                <button
                  type="button"
                  onClick={() => void onRemove(m.id)}
                  disabled={busy}
                  className="text-xs font-medium text-slate-400 transition hover:text-rose-600 disabled:opacity-50 dark:hover:text-rose-400"
                >
                  {m.id === user?.id
                    ? (th ? 'ออก' : 'Leave')
                    : (th ? 'เอาออก' : 'Remove')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {isOwner && (
        <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
          {inviteUrl ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {th ? 'คัดลอกลิงก์นี้แล้วส่งให้ทีม (อายุ 7 วัน)' : 'Copy this link and send it to your teammate (valid for 7 days)'}
              </p>
              <div className="flex items-center gap-2">
                <code className="block min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                  {inviteUrl}
                </code>
                <button
                  type="button"
                  onClick={onCopy}
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-400"
                >
                  {copied ? '✓' : (th ? 'คัดลอก' : 'Copy')}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setInviteUrl(null)}
                className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                {th ? 'สร้างลิงก์ใหม่' : 'Generate another'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void onInvite()}
              disabled={busy}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 dark:bg-brand-500 dark:hover:bg-brand-400"
            >
              {th ? 'สร้างลิงก์เชิญทีม' : 'Create invite link'}
            </button>
          )}
        </div>
      )}

      {err && (
        <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/50 dark:text-rose-200">
          {err}
        </div>
      )}
    </SectionCard>
  );
}

/**
 * Notifications: sound toggle (uses the shared mute state from
 * inboxNotifications so it stays in sync with the bell button in the inbox
 * header). Also explains the tab-title badge so the seller knows what
 * "(3) Chatz" in the browser tab means.
 */
function NotificationsSection({ locale }: { locale: Locale }) {
  const [muted, setMuted] = useMutedState();
  const th = locale === 'th';
  const soundOn = !muted;

  return (
    <div className="space-y-4">
      <SectionCard title={th ? 'เสียง' : 'Sound'}>
        <SettingRow
          label={th ? 'เสียงแจ้งเตือนข้อความใหม่' : 'New message sound'}
          hint={th ? 'เล่นเสียงเมื่อมีข้อความใหม่' : 'Play a sound when a new message arrives'}
        >
          <Switch
            checked={soundOn}
            onChange={(v) => setMuted(!v)}
            label={th ? 'เสียงแจ้งเตือน' : 'Notification sound'}
          />
        </SettingRow>
        {soundOn && (
          <div className="border-t border-slate-100 px-0 pt-3 dark:border-slate-800">
            <button
              type="button"
              onClick={() => playNotification()}
              className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
            >
              {th ? 'ทดสอบเสียง' : 'Test sound'}
            </button>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/**
 * Settings list row — label + optional sublabel on the left, control on the right.
 * Mirrors the row pattern used by LINE / IG / iOS settings.
 */
function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</div>}
      </div>
      <div className="shrink-0 self-center">{children}</div>
    </div>
  );
}

/** Simple iOS-style on/off switch. */
function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={
        'relative inline-flex h-6 w-10 shrink-0 rounded-full p-0.5 transition-colors ' +
        (checked ? 'bg-brand-600 dark:bg-brand-500' : 'bg-slate-300 dark:bg-slate-700')
      }
    >
      <span
        className={
          'block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ' +
          (checked ? 'translate-x-4' : 'translate-x-0')
        }
      />
    </button>
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
      title={locale === 'th' ? 'บัญชี' : 'Account'}
      desc={user ? `${user.displayName || user.username} · ${user.role}` : null}
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

function ChannelsSection({ t }: { t: (k: string) => string }) {
  const { locale } = useAppPreferences();
  const title = locale === 'th' ? 'การเชื่อมต่อ' : 'Integrations';
  const [metaHeader, setMetaHeader] = useState<{
    isConnected: boolean;
    busy: boolean;
    refresh: () => void;
  } | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
        {metaHeader?.isConnected && (
          <button
            type="button"
            onClick={() => metaHeader.refresh()}
            disabled={metaHeader.busy}
            className="shrink-0 text-xs text-slate-400 hover:text-slate-600 disabled:opacity-50 dark:hover:text-slate-200"
          >
            {t('settings.refresh')}
          </button>
        )}
      </div>
      <MetaIntegrationSection t={t} onHeaderState={setMetaHeader} />
      <LineIntegrationCard t={t} />
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
  hasApiKey: boolean;
  lastError: { code: string; message: string; at: string } | null;
  lastSuccessAt: string | null;
  totalCalls: number;
  totalFailures: number;
}

/** Map a server-side error code to a short Thai explanation + how-to-fix. */
function aiErrorExplain(code: string): { th: string; fix: string } {
  switch (code) {
    case 'invalid_api_key':
      return {
        th: 'API key ไม่ถูกต้องหรือหมดอายุ',
        fix: 'ตรวจสอบ ANTHROPIC_API_KEY ใน Railway → Variables',
      };
    case 'rate_limited':
      return {
        th: 'ถูกจำกัดอัตราการเรียกชั่วคราว',
        fix: 'รอสักครู่ ระบบจะกลับมาทำงานเอง',
      };
    case 'bad_request':
      return {
        th: 'คำสั่งที่ส่งให้ AI ไม่ถูกต้อง',
        fix: 'แจ้งทีมงานพร้อมรายละเอียดด้านล่าง',
      };
    default:
      return {
        th: 'เกิดข้อผิดพลาด',
        fix: 'แจ้งทีมงาน',
      };
  }
}

function AiBotSection({ t }: { t: (k: string) => string }) {
  const [settings, setSettings] = useState<BotSettings>(DEFAULT_BOT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [ai, setAi] = useState<AiStatus | null>(null);

  // Probe AI health on mount + poll every 60s so the shop owner sees status
  // changes (e.g. rate-limited → recovered) without refreshing.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const r = await fetch('/api/ai/health', { credentials: 'include' });
        if (!r.ok) return;
        const j = (await r.json()) as Partial<AiStatus>;
        if (cancelled) return;
        setAi({
          enabled: Boolean(j.enabled),
          model: j.model ?? null,
          hasApiKey: Boolean(j.hasApiKey),
          lastError: j.lastError ?? null,
          lastSuccessAt: j.lastSuccessAt ?? null,
          totalCalls: j.totalCalls ?? 0,
          totalFailures: j.totalFailures ?? 0,
        });
      } catch {
        /* offline ok */
      }
    };
    void refresh();
    const id = window.setInterval(refresh, 60_000);
    return () => { cancelled = true; window.clearInterval(id); };
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
    <div className="space-y-4">
      <div className="-mb-1 flex items-center justify-end gap-2 text-[11px] text-slate-400 dark:text-slate-500">
        {saveStatus === 'saving' && <span>กำลังบันทึก…</span>}
        {saveStatus === 'saved' && <span className="text-emerald-600 dark:text-emerald-400">บันทึกแล้ว ✓</span>}
        {saveStatus === 'error' && <span className="text-rose-500">บันทึกไม่สำเร็จ</span>}
      </div>

      {ai && (
        // Three states:
        //   1. Has key + last call ok  → green "พร้อมใช้งาน"
        //   2. Has key + last error    → red "ขัดข้อง" with the specific code
        //   3. No key at all           → amber "ยังไม่ทำงาน" (config issue)
        ai.enabled && !ai.lastError ? (
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900/50 dark:bg-emerald-950/40">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-500 text-white">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-semibold text-emerald-900 dark:text-emerald-100">AI ปิดการขาย พร้อมใช้งาน</div>
              <div className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-300">
                ใช้โมเดล <span className="font-mono">{ai.model}</span>
                {ai.totalCalls > 0 && (
                  <> · ตอบไปแล้ว <b>{ai.totalCalls.toLocaleString()}</b> ครั้ง</>
                )}
              </div>
            </div>
            <span className="relative grid h-2.5 w-2.5 place-items-center" aria-hidden>
              <span className="absolute inset-0 rounded-full bg-emerald-400/60 motion-safe:animate-ping" />
              <span className="relative h-2 w-2 rounded-full bg-emerald-500" />
            </span>
          </div>
        ) : ai.enabled && ai.lastError ? (
          (() => {
            const { th: errTh, fix } = aiErrorExplain(ai.lastError.code);
            return (
              <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 dark:border-rose-900/50 dark:bg-rose-950/40">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-rose-500 text-white">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-semibold text-rose-900 dark:text-rose-100">
                    AI ขัดข้อง — {errTh}
                  </div>
                  <div className="mt-0.5 text-xs text-rose-800 dark:text-rose-200">
                    {fix}
                  </div>
                  <div className="mt-1 text-[11px] text-rose-700/80 dark:text-rose-300/80">
                    ครั้งล่าสุด: {new Date(ai.lastError.at).toLocaleString('th-TH')}
                    {ai.totalFailures > 0 && (
                      <> · พลาด <b>{ai.totalFailures}</b>/{ai.totalCalls} ครั้ง</>
                    )}
                  </div>
                </div>
              </div>
            );
          })()
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

      <SectionCard title={locale === 'th' ? 'การตอบกลับอัตโนมัติ' : 'Auto-reply'} desc={locale === 'th' ? 'เลือกเปิด-ปิดแต่ละฟีเจอร์ที่จะให้บอทช่วยตอบ' : 'Choose which auto-reply features the bot handles'}>
        <div className="space-y-2">
          <ToggleRow title={t('settings.ai1t')} desc={t('settings.ai1d')} on={settings.autoGreet} onChange={(v) => set('autoGreet', v)} />
          <ToggleRow title={t('settings.ai2t')} desc={t('settings.ai2d')} on={settings.autoFaq} onChange={(v) => set('autoFaq', v)} />
          <ToggleRow title={t('settings.ai3t')} desc={t('settings.ai3d')} on={settings.autoSlipConfirm} onChange={(v) => set('autoSlipConfirm', v)} />
          <ToggleRow title={t('settings.ai4t')} desc={t('settings.ai4d')} on={settings.ocr} onChange={(v) => set('ocr', v)} />
          <ToggleRow title={t('settings.ai5t')} desc={t('settings.ai5d')} on={settings.ai5} onChange={(v) => set('ai5', v)} />
          <ToggleRow title={t('settings.ai6t')} desc={t('settings.ai6d')} on={settings.ai6} onChange={(v) => set('ai6', v)} />
        </div>
      </SectionCard>

      <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-xs text-brand-800 dark:border-brand-900/40 dark:bg-brand-950/30 dark:text-brand-200">
        {locale === 'th'
          ? 'การตอบอัตโนมัติด้วยคำสำคัญ ย้ายไปที่เมนู "ตอบกลับอัตโนมัติ" แล้ว'
          : 'Keyword auto-reply has moved to the "Auto-reply" menu.'}
      </div>

      <SectionCard title={locale === 'th' ? 'ตรวจสลิปการโอนเงิน' : 'Slip verification'} desc={locale === 'th' ? 'ตั้งค่าบัญชีรับเงินและการตรวจสลิปอัตโนมัติ' : 'Bank account and automatic slip checking'}>
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

// Read the current locale from the document for places that don't have it via prop.
const locale = (typeof window !== 'undefined' && document.documentElement.lang === 'en') ? 'en' : 'th';

/**
 * Plain settings card — title + optional description + content.
 * Matches the visual pattern used by Facebook/LINE/IG settings:
 * no decorative emoji, no chip, just a clear hierarchy.
 */
function SectionCard({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-shadow duration-500 ease-out hover:shadow-[0_8px_24px_-12px_rgba(15,23,42,0.12)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
      <header className="border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
        <h3 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
        {desc && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{desc}</p>}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
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

function MetaIntegrationSection({
  t,
  onHeaderState,
}: {
  t: (k: string) => string;
  onHeaderState?: (state: { isConnected: boolean; busy: boolean; refresh: () => void }) => void;
}) {
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

  // Surface the redirect-back error from /api/fb/oauth/start when env
  // values are missing or malformed. The user sees a clear Thai message
  // instead of Facebook's generic "Invalid App ID" wrench page.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('fbConnect');
    if (!code) return;
    const msg =
      code === 'bad_app_id'      ? 'FB_APP_ID ตั้งค่าผิดรูป — ดูคำแนะนำในกล่องเหลืองด้านล่าง'
      : code === 'missing_app_id'     ? 'ยังไม่ได้ตั้ง FB_APP_ID ใน Railway Variables'
      : code === 'missing_app_secret' ? 'ยังไม่ได้ตั้ง FB_APP_SECRET ใน Railway Variables'
      : null;
    if (msg) setErr(msg);
    // Strip the query so it doesn't reappear on reload.
    const url = new URL(window.location.href);
    url.searchParams.delete('fbConnect');
    window.history.replaceState({}, '', url.pathname + (url.search || '') + url.hash);
  }, []);

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

  useEffect(() => {
    onHeaderState?.({
      isConnected,
      busy,
      refresh: () => void refresh(),
    });
  }, [isConnected, busy, refresh, onHeaderState]);

  return (
    <div className="space-y-3">
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

      {err && (
        <div className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-950/30 dark:text-rose-300">{err}</div>
      )}
      {/* Env-value problem banner — surfaces malformed FB_APP_ID etc.
          BEFORE the user clicks "Connect" and ends up on Facebook's
          "Invalid App ID" wrench page. The single most-common cause is
          pasting the entire ".env" line ("FB_APP_ID=1620...") into the
          Railway value field instead of just the value. */}
      {status?.envProblems && status.envProblems.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 motion-safe:animate-[fadeUp_300ms_ease-out] dark:border-amber-900/50 dark:bg-amber-950/40">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-500 text-white">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-semibold text-amber-900 dark:text-amber-100">
              ค่า Environment ตั้งผิด — เชื่อม Facebook ไม่ได้
            </div>
            {status.envProblems.map((p) => (
              <div key={p.key} className="mt-1 text-xs text-amber-800 dark:text-amber-200">
                <code className="font-mono">{p.key}</code>: {p.message}
              </div>
            ))}
            <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
              วิธีแก้: เปิด Railway → Variables → คลิก {`{`}<code className="font-mono">FB_APP_ID</code>{`}`} →
              ใส่ <b>เฉพาะตัวเลข</b> (เช่น <code className="font-mono">1620000000</code>) ไม่ต้องใส่ชื่อตัวแปรนำหน้า
            </div>
          </div>
        </div>
      )}
      {/* Token-broken banner — shown when the last send to Facebook or
          Instagram failed with a revoked / expired access-token error.
          Without this the shop owner only finds out from a customer
          complaint, because the server returns 200 to the agent UI and
          then quietly drops the reply. */}
      {status?.needsReconnect && (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 motion-safe:animate-[fadeUp_300ms_ease-out] dark:border-rose-900/50 dark:bg-rose-950/40">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-rose-500 text-white">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-semibold text-rose-900 dark:text-rose-100">
              ส่งข้อความ Facebook ไม่ได้ — Token หมดอายุ
            </div>
            <div className="mt-0.5 text-xs text-rose-800 dark:text-rose-200">
              ลูกค้าจะไม่ได้รับข้อความที่ตอบไป กดเชื่อม Facebook ใหม่เพื่อแก้
            </div>
            {Object.entries(status.pageHealth ?? {}).slice(0, 3).map(([pid, h]) => (
              <div key={pid} className="mt-1 text-[11px] text-rose-700/80 dark:text-rose-300/80">
                Page {pid.slice(0, 12)}… · {new Date(h.at).toLocaleString('th-TH')}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={onConnect}
            disabled={busy}
            className="self-center rounded-full bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-all duration-300 hover:-translate-y-[1px] hover:bg-rose-700 hover:shadow-md active:translate-y-0 disabled:opacity-50"
          >
            {busy ? '…' : 'เชื่อมใหม่'}
          </button>
        </div>
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

function LineIntegrationCard(_props: { t: (k: string) => string }) {
  const [status, setStatus] = useState<LineIntegrationStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Single disclosure that gates everything manual: webhook URL display,
   *  the 4-step guide, and the Channel Secret + Access Token paste form.
   *  Default closed so the page looks like a single "Connect with LINE"
   *  button — no tokens, no copy/paste fields visible. */
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [secret, setSecret] = useState('');
  const [token, setToken] = useState('');
  const [copied, setCopied] = useState(false);
  /** Surface the post-OAuth redirect result so users see a clear message
   *  instead of having to read the URL bar. Banner clears itself after 8s. */
  const [oauthBanner, setOauthBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await fetchLineStatus());
    } catch (e) {
      setErr(String((e as Error).message || e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Detect /settings?lineConnect=... from the OAuth callback.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('lineConnect');
    if (!code) return;
    const map: Record<string, { kind: 'ok' | 'err'; text: string }> = {
      ok:                 { kind: 'ok',  text: 'เชื่อมต่อ LINE สำเร็จ' },
      denied:             { kind: 'err', text: 'ผู้ใช้ปฏิเสธการเชื่อมต่อ' },
      bad_request:        { kind: 'err', text: 'การเชื่อมต่อล้มเหลว (พารามิเตอร์ไม่ครบ)' },
      bad_state:          { kind: 'err', text: 'การเชื่อมต่อหมดอายุ ลองเชื่อมต่อใหม่' },
      token_failed:       { kind: 'err', text: 'แลก token ไม่สำเร็จ ลองอีกครั้ง' },
      bot_info_failed:    { kind: 'err', text: 'อ่านข้อมูล OA ไม่สำเร็จ' },
      error:              { kind: 'err', text: 'เกิดข้อผิดพลาดในการเชื่อมต่อ' },
    };
    if (map[code]) {
      setOauthBanner(map[code]);
      void refresh();
      // Strip the query string so the banner doesn't reappear on reload.
      window.history.replaceState({}, '', window.location.pathname);
      const id = window.setTimeout(() => setOauthBanner(null), 8000);
      return () => window.clearTimeout(id);
    }
  }, [refresh]);

  const connected = !!status?.configured && !!status?.replyEnabled;
  const partial = !!status?.configured && !status?.replyEnabled;
  const oa = status?.botInfo;
  const oauthAvailable = !!status?.oauthAvailable;
  const isOauthConnected = status?.source === 'oauth';

  async function onCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setErr('คัดลอกไม่สำเร็จ ลองเลือกข้อความแล้วกด Ctrl/Cmd+C');
    }
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const next = await connectLine({ channelSecret: secret.trim(), channelAccessToken: token.trim() });
      setStatus(next);
      setSecret('');
      setToken('');
      setAdvancedOpen(false);
    } catch (e2) {
      setErr(String((e2 as Error).message || e2));
    } finally {
      setBusy(false);
    }
  }

  async function onDisconnect() {
    if (!window.confirm('ยืนยันการยกเลิกการเชื่อมต่อ LINE? ห้องแชทเดิมจะยังอยู่ แต่ระบบจะหยุดรับ-ส่งข้อความ')) return;
    setErr(null);
    setBusy(true);
    try {
      setStatus(await disconnectLine());
    } catch (e2) {
      setErr(String((e2 as Error).message || e2));
    } finally {
      setBusy(false);
    }
  }

  const desc =
    !status ? '…'
    : connected
      ? oa?.displayName ? `เชื่อมแล้ว · ${oa.displayName}${oa.basicId ? ` (@${oa.basicId})` : ''}`
      : `เชื่อมแล้ว · ${status.threadCount} ห้องแชท`
    : partial ? 'ตั้งค่าบางส่วน — เปิดเมนู "ตั้งค่าขั้นสูง" เพื่อกรอกข้อมูลให้ครบ'
    : oauthAvailable
      ? 'กดปุ่มแล้วเลือก OA ของร้าน ไม่ต้องคัดลอกอะไรเอง'
      : 'เชื่อม LINE Official Account ของร้านเพื่อตอบลูกค้าผ่าน LINE';

  // Show the advanced disclosure only when the user is *not* connected via
  // OAuth. OAuth-connected shops never need to see tokens or webhook URLs.
  const showAdvancedToggle = !isOauthConnected;

  return (
    <div className="space-y-3">
      {oauthBanner && (
        <div
          role="status"
          className={
            'rounded-2xl border px-4 py-3 text-sm ' +
            (oauthBanner.kind === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200'
              : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200')
          }
        >
          {oauthBanner.text}
        </div>
      )}

      <IntegrationCard
        icon={<ChannelIcon channel="line" className="h-7 w-7" />}
        iconBg="bg-green-50 dark:bg-green-950/30"
        name="LINE Official Account"
        desc={desc}
        connected={connected}
        partial={partial}
        action={
          <div className="flex flex-wrap gap-2">
            {connected ? (
              <button
                type="button"
                onClick={onDisconnect}
                disabled={busy}
                className="rounded-full border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:border-rose-700/60 dark:bg-slate-900 dark:text-rose-400 dark:hover:bg-rose-950/40"
              >
                ยกเลิกการเชื่อม
              </button>
            ) : oauthAvailable ? (
              <button
                type="button"
                onClick={() => connectLineOAuth()}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-full bg-[#06C755] px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#05b048] disabled:opacity-50"
              >
                <ChannelIcon channel="line" className="h-4 w-4" />
                เชื่อมต่อด้วย LINE
              </button>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-1.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <I.Clock className="h-3.5 w-3.5" />
                การเชื่อมต่ออัตโนมัติยังไม่พร้อม
              </span>
            )}
          </div>
        }
      />

      {isOauthConnected && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          ✓ เชื่อมต่อผ่าน LINE — webhook ตั้งให้อัตโนมัติแล้ว
        </p>
      )}

      {/* When OAuth isn't wired up at the server (LINE Module Channel env
          missing) tell the operator EXACTLY what to do, instead of just
          saying "ยังไม่พร้อม" and leaving them stuck. */}
      {!connected && !oauthAvailable && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900 motion-safe:animate-[fadeUp_300ms_ease-out] dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
          <div className="font-semibold">เปิดบริการเชื่อมต่อ LINE อัตโนมัติ</div>
          <p className="mt-1 text-amber-800 dark:text-amber-200">
            ทีมงานต้องสมัคร <b>LINE Module Channel</b> ที่ developers.line.biz แล้วใส่ค่า 2 ตัวนี้ใน Railway Variables:
          </p>
          <ul className="mt-2 space-y-1 font-mono text-[11px]">
            <li>• <code>LINE_MODULE_CHANNEL_ID</code></li>
            <li>• <code>LINE_MODULE_CHANNEL_SECRET</code></li>
          </ul>
          <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
            หลังตั้งค่าเสร็จ ปุ่ม "เชื่อมต่อด้วย LINE" จะใช้งานได้ทันที — ผู้ใช้แต่ละร้านไม่ต้องกรอก token ใดๆ
          </p>
        </div>
      )}

      {/* One disclosure gates everything technical: webhook URL display,
          4-step guide, and the Channel Secret/Token paste form. Hidden by
          default so the default UX is a single OAuth button. */}
      {showAdvancedToggle && (
        <div>
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            aria-expanded={advancedOpen}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 transition-colors hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
          >
            <I.ChevronRight
              className={'h-3 w-3 transition-transform duration-300 ' + (advancedOpen ? 'rotate-90' : '')}
            />
            ตั้งค่าขั้นสูง (สำหรับผู้ใช้ที่ต้องการตั้งค่าด้วยตัวเอง)
          </button>

          {advancedOpen && (
            <div className="mt-3 space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-3 motion-safe:animate-[fadeUp_300ms_ease-out] dark:border-slate-700 dark:bg-slate-900/40">
              <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                เมนูนี้สำหรับกรณีที่คุณมี LINE Messaging API channel ของตัวเอง และต้องการกรอกข้อมูลด้วยตนเอง
                ผู้ใช้ทั่วไปไม่จำเป็นต้องใช้ — รอให้ปุ่ม "เชื่อมต่อด้วย LINE" พร้อมใช้งานก็เพียงพอ
              </p>

              {/* Webhook URL */}
              {status && (
                <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
                  <div className="mb-1.5 font-semibold text-slate-600 dark:text-slate-300">
                    Webhook URL (ใส่ในหน้า LINE Developers)
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="block min-w-0 flex-1 truncate rounded-lg bg-slate-50 px-2.5 py-1.5 font-mono text-[11px] text-slate-700 dark:bg-slate-950 dark:text-slate-200">
                      {status.webhookUrl}
                    </code>
                    <button
                      type="button"
                      onClick={() => void onCopy(status.webhookUrl)}
                      className="rounded-lg bg-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      title="คัดลอก"
                    >
                      {copied ? '✓' : 'คัดลอก'}
                    </button>
                  </div>
                </div>
              )}

              {/* 4-step guide */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowSteps((v) => !v)}
                  className="text-xs font-semibold text-brand-600 underline-offset-2 hover:underline dark:text-brand-400"
                >
                  {showSteps ? 'ซ่อนขั้นตอน' : 'ดูขั้นตอน 4 ขั้น →'}
                </button>
              </div>
              {showSteps && (
                <ol className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  <li>
                    <b>1.</b> เปิด{' '}
                    <a
                      href="https://developers.line.biz/console/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-brand-600 hover:underline dark:text-brand-400"
                    >
                      LINE Developers Console
                    </a>
                    {' '}เลือก Provider ของร้าน แล้วกดสร้าง <b>Messaging API channel</b> ใหม่ (ถ้ายังไม่มี)
                  </li>
                  <li>
                    <b>2.</b> ในแท็บ <b>Basic settings</b> คัดลอก <b>Channel secret</b> มาวางช่องด้านล่าง
                  </li>
                  <li>
                    <b>3.</b> ในแท็บ <b>Messaging API</b> เลื่อนลงไปที่ Channel access token (long-lived) แล้วกด <b>Issue</b> → คัดลอกมาวางช่องด้านล่าง
                  </li>
                  <li>
                    <b>4.</b> ในหน้าเดียวกัน ใส่ Webhook URL ด้านบนลงในช่อง <b>Webhook URL</b> และเปิด <b>Use webhook</b> ON
                  </li>
                  <li className="pt-1 text-slate-400 dark:text-slate-500">
                    *แนะนำ: ปิด Auto-reply messages ของ LINE OA เพื่อให้ AI ของ Chatz ตอบแทน
                  </li>
                </ol>
              )}

              {/* Paste form */}
              <form
                onSubmit={onSave}
                className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
              >
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Channel Secret
                  </label>
                  <input
                    type="password"
                    autoComplete="off"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder="ตัวเลข+ตัวอักษร 32 ตัว"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-700 outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Channel Access Token (long-lived)
                  </label>
                  <textarea
                    rows={3}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="วาง access token จากแท็บ Messaging API ที่นี่"
                    className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-700 outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="submit"
                    disabled={busy || !secret.trim() || !token.trim()}
                    className="btn-primary text-xs disabled:opacity-50"
                  >
                    {busy ? 'กำลังตรวจสอบ…' : 'บันทึกและเชื่อมต่อ'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {err && (
        <div className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {err}
        </div>
      )}
    </div>
  );
}

