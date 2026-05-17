import { useEffect, useState } from 'react';
import { useAppPreferences } from '../../context/AppPreferencesContext';
import type { Locale } from '../../i18n/messages';
import { I } from '../Icons';

/**
 * Auto-reply settings — separate page from "Settings".
 *
 * Design notes (2026-05 redesign):
 *   • Choice-first, not text-first. Shop owners pick from preset bubbles
 *     instead of staring at empty textareas. There's a tiny "แก้เอง" toggle
 *     for custom text when they want it.
 *   • Each persona shows the actual voice it produces in a chat-bubble
 *     preview, so the owner sees what they're choosing.
 *   • Quick-reply suggestions: a tap-to-add library of common Thai-shop
 *     replies so first-time owners aren't staring at an empty list.
 *
 * Data shape (BotSettingsExt) is unchanged — server still receives the same
 * string fields. The redesign only changes how we surface picking them.
 */

interface BotSettingsExt {
  botPersona: 'friendly' | 'formal' | 'playful' | 'professional';
  greetingMessage: string;
  greetingEnabled: boolean;
  fallbackMessage: string;
  awayMessage: string;
  awayEnabled: boolean;
  awayStart: string; // HH:MM
  awayEnd: string;   // HH:MM
  quickReplies: string[];
}

const DEFAULT_EXT: BotSettingsExt = {
  botPersona: 'friendly',
  greetingMessage: '',
  greetingEnabled: true,
  fallbackMessage: '',
  awayMessage: '',
  awayEnabled: false,
  awayStart: '22:00',
  awayEnd: '07:00',
  quickReplies: [],
};

// ─── Preset libraries ───────────────────────────────────────────────────────

const PERSONAS = [
  {
    id: 'friendly' as const,
    emoji: '🌸',
    th: 'เป็นกันเอง',
    en: 'Friendly',
    sample_th: 'สวัสดีค่ะ มีอะไรให้ช่วยไหมคะ 😊',
    sample_en: 'Hi there! How can I help today? 😊',
    tint: 'from-rose-50 to-pink-50 dark:from-rose-950/30 dark:to-pink-950/20',
  },
  {
    id: 'playful' as const,
    emoji: '🎀',
    th: 'สนุกสนาน',
    en: 'Playful',
    sample_th: 'หวัดดีจ้าาา~ มาดูอะไรดีคะวันนี้ 💖',
    sample_en: "Heyy~ what're we shopping for today 💖",
    tint: 'from-fuchsia-50 to-purple-50 dark:from-fuchsia-950/30 dark:to-purple-950/20',
  },
  {
    id: 'professional' as const,
    emoji: '💼',
    th: 'มืออาชีพ',
    en: 'Professional',
    sample_th: 'สวัสดีค่ะ ยินดีให้บริการ สอบถามได้เลยนะคะ',
    sample_en: 'Hello, happy to assist. Let me know what you need.',
    tint: 'from-sky-50 to-indigo-50 dark:from-sky-950/30 dark:to-indigo-950/20',
  },
  {
    id: 'formal' as const,
    emoji: '🎩',
    th: 'ทางการ',
    en: 'Formal',
    sample_th: 'เรียนลูกค้า ทางร้านยินดีต้อนรับและพร้อมให้บริการค่ะ',
    sample_en: 'Dear customer, our shop welcomes your inquiry.',
    tint: 'from-slate-50 to-zinc-50 dark:from-slate-900/40 dark:to-zinc-900/40',
  },
];

const GREETING_PRESETS = [
  { emoji: '🌷', th: 'สวัสดีค่ะ มีอะไรให้ช่วยไหมคะ 😊', en: 'Hi! How can we help today? 😊' },
  { emoji: '💕', th: 'หวัดดีจ้า~ ดูสินค้าตัวไหนอยู่คะ', en: "Hey~ which item caught your eye?" },
  { emoji: '🙏', th: 'ขอบคุณที่ทักร้านเรานะคะ สอบถามได้เลยค่ะ', en: 'Thanks for messaging us! Ask anything.' },
  { emoji: '✨', th: 'สวัสดีค่ะ ร้านเปิดอยู่ค่ะ ทักได้เลยนะคะ', en: "Hi! We're open — message away." },
];

const FALLBACK_PRESETS = [
  { emoji: '🙏', th: 'ขอโทษนะคะ จะเรียกแอดมินมาช่วยนะคะ', en: 'Sorry — let me get a human to help.' },
  { emoji: '🕐', th: 'อันนี้ขอเช็คให้สักครู่นะคะ', en: 'One moment, let me check on this.' },
  { emoji: '💌', th: 'รอแอดมินสักครู่นะคะ จะรีบตอบให้ค่ะ', en: "Hold on — admin will reply shortly." },
  { emoji: '✨', th: 'ขอบคุณค่ะ มีคนช่วยตอบให้ในไม่ช้านะคะ', en: 'Thanks! Someone will reply soon.' },
];

const AWAY_PRESETS = [
  { emoji: '🌙', th: 'ตอนนี้ปิดร้านแล้วค่ะ จะรีบตอบในเช้าวันถัดไปนะคะ', en: "We're closed — we'll reply first thing tomorrow." },
  { emoji: '💤', th: 'นอกเวลาทำการค่ะ พรุ่งนี้เช้าจะตอบกลับนะคะ', en: 'Outside hours — reply tomorrow morning.' },
  { emoji: '☕', th: 'ร้านพักผ่อนอยู่ค่ะ จะกลับมาเช้านะคะ', en: 'Shop is resting — back in the morning.' },
];

const QUICK_REPLY_SUGGESTIONS = [
  { th: 'ราคา 250 บาทค่ะ', en: "It's 250 THB" },
  { th: 'ส่งฟรี EMS เมื่อซื้อครบ 2 ชิ้น', en: 'Free EMS on 2+ items' },
  { th: 'มีของพร้อมส่งค่ะ', en: 'In stock, ready to ship' },
  { th: 'ส่งของวันนี้ก่อน 16:00 ค่ะ', en: 'Ship today before 4pm' },
  { th: 'สอบถามไซส์ได้นะคะ', en: 'Ask me about sizing' },
  { th: 'รบกวนส่งหลักฐานการโอนด้วยนะคะ', en: 'Please send the payment slip' },
  { th: 'ขอเลขที่อยู่จัดส่งด้วยนะคะ', en: 'Could you share the shipping address?' },
  { th: 'ขอบคุณที่อุดหนุนนะคะ 💕', en: 'Thank you for your order! 💕' },
];

// ─── Main view ──────────────────────────────────────────────────────────────

export function AutoReplyView() {
  const { locale } = useAppPreferences();
  const [settings, setSettings] = useState<BotSettingsExt>(DEFAULT_EXT);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch('/api/bot/settings', { credentials: 'include' });
        if (!r.ok) return;
        const j = (await r.json()) as { settings: Partial<BotSettingsExt> };
        if (cancelled) return;
        setSettings({ ...DEFAULT_EXT, ...(j.settings || {}) });
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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

  const set = <K extends keyof BotSettingsExt>(key: K, value: BotSettingsExt[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));

  const th = locale === 'th';
  const activePersona = PERSONAS.find((p) => p.id === settings.botPersona) ?? PERSONAS[0];

  return (
    <div className="flex h-screen flex-1 flex-col bg-gradient-to-b from-violet-50/60 via-white to-rose-50/30 dark:from-slate-950 dark:via-slate-950 dark:to-slate-950">
      {/* Page header */}
      <header className="shrink-0 border-b border-slate-200/70 bg-white/70 px-6 py-4 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/70 md:px-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-pink-500 text-lg shadow-md shadow-brand-500/20">
              <span aria-hidden>🤖</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                {th ? 'ตอบกลับอัตโนมัติ' : 'Auto-reply'}
              </h1>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {th ? 'แตะเลือกสไตล์ ไม่ต้องพิมพ์เอง 💜' : 'Tap to pick a style — no typing needed 💜'}
              </p>
            </div>
          </div>
          <SaveBadge status={saveStatus} th={th} />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-5 px-5 py-6 md:px-8 md:py-8">
          {/* 1. Persona — visual cards with preview bubble */}
          <SectionCard
            icon="🎭"
            title={th ? 'บุคลิกของบอท' : 'Bot personality'}
            desc={th ? 'แตะการ์ดเพื่อเลือกสไตล์การพูด' : 'Tap a card to pick the speaking style'}
          >
            <div className="grid grid-cols-2 gap-3">
              {PERSONAS.map((p) => {
                const active = settings.botPersona === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => set('botPersona', p.id)}
                    className={
                      'group relative overflow-hidden rounded-2xl border p-3.5 text-left transition-all duration-200 ' +
                      (active
                        ? 'border-brand-400 bg-gradient-to-br ' + p.tint + ' shadow-lg shadow-brand-500/10 ring-2 ring-brand-300/50 dark:ring-brand-500/40'
                        : 'border-slate-200 bg-white hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-800')
                    }
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-2xl transition-transform group-hover:scale-110">{p.emoji}</span>
                      <span className={'text-sm font-semibold ' + (active ? 'text-brand-700 dark:text-brand-200' : 'text-slate-800 dark:text-slate-100')}>
                        {th ? p.th : p.en}
                      </span>
                      {active && (
                        <span className="ml-auto grid h-5 w-5 place-items-center rounded-full bg-brand-500 text-white shadow-sm">
                          <I.Check className="h-3 w-3" />
                        </span>
                      )}
                    </div>
                    <div className="mt-2.5 rounded-xl bg-white/70 px-3 py-2 text-[12px] leading-relaxed text-slate-600 shadow-inner dark:bg-slate-950/40 dark:text-slate-300">
                      <span className="italic">"{th ? p.sample_th : p.sample_en}"</span>
                    </div>
                  </button>
                );
              })}
            </div>
            {/* Live preview bubble */}
            <PreviewBubble th={th} persona={activePersona} />
          </SectionCard>

          {/* 2. Greeting message */}
          <PresetMessageCard
            icon="👋"
            title={th ? 'ข้อความต้อนรับ' : 'Greeting'}
            desc={th ? 'ส่งทันทีเมื่อลูกค้าทักครั้งแรก' : 'Sent when a customer first messages'}
            th={th}
            presets={GREETING_PRESETS}
            value={settings.greetingMessage}
            onChange={(v) => set('greetingMessage', v)}
            enabled={settings.greetingEnabled}
            onToggle={(v) => set('greetingEnabled', v)}
          />

          {/* 3. Fallback */}
          <PresetMessageCard
            icon="🤔"
            title={th ? 'ข้อความเมื่อบอทตอบไม่ได้' : 'When the bot is stuck'}
            desc={th ? 'ส่งเมื่อบอทไม่เข้าใจคำถาม' : "Sent when the bot can't answer"}
            th={th}
            presets={FALLBACK_PRESETS}
            value={settings.fallbackMessage}
            onChange={(v) => set('fallbackMessage', v)}
          />

          {/* 4. Business hours */}
          <SectionCard
            icon="🌙"
            title={th ? 'นอกเวลาทำการ' : 'After hours'}
            desc={th ? 'ตั้งเวลาและข้อความเมื่อร้านปิด' : 'Set hours and an after-hours reply'}
            accessory={
              <Switch
                checked={settings.awayEnabled}
                onChange={(v) => set('awayEnabled', v)}
                label="enable away"
              />
            }
          >
            {!settings.awayEnabled ? (
              <div className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
                {th ? '💤 ปิดอยู่ — บอทจะตอบทุกข้อความตลอด 24 ชม.' : '💤 Off — the bot replies 24/7.'}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <TimeField
                    label={th ? '☀️ เปิดร้าน' : '☀️ Open'}
                    value={settings.awayEnd}
                    onChange={(v) => set('awayEnd', v)}
                  />
                  <TimeField
                    label={th ? '🌙 ปิดร้าน' : '🌙 Close'}
                    value={settings.awayStart}
                    onChange={(v) => set('awayStart', v)}
                  />
                </div>
                <PresetGrid
                  th={th}
                  presets={AWAY_PRESETS}
                  value={settings.awayMessage}
                  onChange={(v) => set('awayMessage', v)}
                />
              </div>
            )}
          </SectionCard>

          {/* 5. Quick replies */}
          <QuickRepliesCard
            value={settings.quickReplies}
            onChange={(v) => set('quickReplies', v)}
            locale={locale}
          />
        </div>
      </main>
    </div>
  );
}

// ─── Building blocks ────────────────────────────────────────────────────────

function SaveBadge({ status, th }: { status: 'idle' | 'saving' | 'saved' | 'error'; th: boolean }) {
  if (status === 'idle') return null;
  const map = {
    saving: { text: th ? 'กำลังบันทึก…' : 'Saving…', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
    saved:  { text: th ? 'บันทึกแล้ว ✓'   : 'Saved ✓',  cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' },
    error:  { text: th ? 'บันทึกไม่สำเร็จ' : 'Failed',   cls: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' },
  } as const;
  const v = map[status];
  return <span className={'rounded-full px-2.5 py-1 text-[11px] font-medium ' + v.cls}>{v.text}</span>;
}

function SectionCard({
  icon,
  title,
  desc,
  accessory,
  children,
}: {
  icon?: string;
  title: string;
  desc?: string | null;
  accessory?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/80 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
        <div className="flex min-w-0 items-start gap-2.5">
          {icon && <span className="mt-0.5 text-lg leading-none" aria-hidden>{icon}</span>}
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
            {desc && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{desc}</p>}
          </div>
        </div>
        {accessory && <div className="shrink-0">{accessory}</div>}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

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
        'relative inline-flex h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors ' +
        (checked
          ? 'bg-gradient-to-r from-brand-500 to-pink-500'
          : 'bg-slate-300 dark:bg-slate-700')
      }
    >
      <span
        className={
          'block h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-200 ' +
          (checked ? 'translate-x-5' : 'translate-x-0')
        }
      />
    </button>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-brand-900/40"
      />
    </label>
  );
}

// Preview chat bubble for persona
function PreviewBubble({ th, persona }: { th: boolean; persona: typeof PERSONAS[number] }) {
  return (
    <div className="mt-3 flex items-end gap-2 rounded-xl bg-slate-50/80 px-3 py-3 dark:bg-slate-800/40">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-pink-500 text-sm shadow-sm">
        {persona.emoji}
      </div>
      <div className="relative max-w-[85%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2 text-[13px] text-slate-700 shadow-sm dark:bg-slate-900 dark:text-slate-200">
        {th ? persona.sample_th : persona.sample_en}
      </div>
      <span className="ml-auto text-[10px] text-slate-400 dark:text-slate-500">
        {th ? 'ตัวอย่าง' : 'preview'}
      </span>
    </div>
  );
}

// ─── Preset message card (greeting / fallback) ───────────────────────────────
// Users tap a preset; the chosen text becomes the saved string. A discreet
// "✏️ แก้เอง" button reveals a textarea for full custom text — kept hidden
// by default so the page doesn't look like a form.

function PresetMessageCard({
  icon,
  title,
  desc,
  th,
  presets,
  value,
  onChange,
  enabled,
  onToggle,
}: {
  icon: string;
  title: string;
  desc: string;
  th: boolean;
  presets: { emoji: string; th: string; en: string }[];
  value: string;
  onChange: (v: string) => void;
  enabled?: boolean;
  onToggle?: (v: boolean) => void;
}) {
  const showToggle = typeof enabled === 'boolean' && typeof onToggle === 'function';
  const disabled = showToggle && !enabled;

  return (
    <SectionCard
      icon={icon}
      title={title}
      desc={desc}
      accessory={
        showToggle ? (
          <Switch checked={!!enabled} onChange={onToggle!} label={title} />
        ) : undefined
      }
    >
      {disabled ? (
        <div className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
          {th ? '💤 ปิดอยู่ — ไม่ส่งข้อความนี้' : '💤 Off — this message is not sent.'}
        </div>
      ) : (
        <PresetGrid th={th} presets={presets} value={value} onChange={onChange} />
      )}
    </SectionCard>
  );
}

function PresetGrid({
  th,
  presets,
  value,
  onChange,
}: {
  th: boolean;
  presets: { emoji: string; th: string; en: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  const matched = presets.some((p) => (th ? p.th : p.en) === value);
  const [customOpen, setCustomOpen] = useState(!!value && !matched);

  return (
    <div className="space-y-2.5">
      <div className="grid gap-2">
        {presets.map((p, i) => {
          const text = th ? p.th : p.en;
          const active = value === text;
          return (
            <button
              key={i}
              type="button"
              onClick={() => {
                onChange(text);
                setCustomOpen(false);
              }}
              className={
                'group flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-[13px] transition-all ' +
                (active
                  ? 'border-brand-400 bg-gradient-to-r from-brand-50 to-pink-50 text-brand-900 shadow-sm ring-1 ring-brand-200 dark:from-brand-950/40 dark:to-pink-950/30 dark:text-brand-100 dark:ring-brand-800'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-brand-200 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/60')
              }
            >
              <span className="text-lg transition-transform group-hover:scale-110">{p.emoji}</span>
              <span className="flex-1">{text}</span>
              {active && (
                <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-500 text-white shadow-sm">
                  <I.Check className="h-3 w-3" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Custom override */}
      {!customOpen ? (
        <button
          type="button"
          onClick={() => setCustomOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 transition hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400"
        >
          <I.Pencil className="h-3 w-3" />
          {th ? 'แก้เป็นข้อความของฉันเอง' : 'Write my own'}
        </button>
      ) : (
        <div className="space-y-1.5 rounded-xl border border-dashed border-brand-200 bg-brand-50/40 p-3 dark:border-brand-800 dark:bg-brand-950/20">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-brand-700 dark:text-brand-300">
              {th ? '✏️ ข้อความของฉัน' : '✏️ My text'}
            </span>
            <button
              type="button"
              onClick={() => setCustomOpen(false)}
              className="text-[11px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              {th ? 'ยกเลิก' : 'cancel'}
            </button>
          </div>
          <textarea
            autoFocus
            className="w-full resize-none rounded-lg border border-slate-200 bg-white p-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            rows={2}
            value={matched ? '' : value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={th ? 'พิมพ์ข้อความของคุณ...' : 'Type your message...'}
          />
        </div>
      )}
    </div>
  );
}

// ─── Quick replies (suggestion-first) ────────────────────────────────────────

function QuickRepliesCard({
  value,
  onChange,
  locale,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  locale: Locale;
}) {
  const th = locale === 'th';
  const [draft, setDraft] = useState('');

  const add = (raw: string) => {
    const text = raw.trim();
    if (!text || value.includes(text)) return;
    onChange([...value, text].slice(0, 30));
  };

  const addDraft = () => {
    add(draft);
    setDraft('');
  };

  const remove = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  const suggestions = QUICK_REPLY_SUGGESTIONS
    .map((s) => (th ? s.th : s.en))
    .filter((s) => !value.includes(s));

  return (
    <SectionCard
      icon="⚡"
      title={th ? 'คำตอบสำเร็จรูป' : 'Quick replies'}
      desc={th
        ? 'ปุ่มที่แอดมินกดส่งได้เร็วในกล่องข้อความ (สูงสุด 30)'
        : 'Tap-to-send chips for the admin inbox (max 30)'}
    >
      <div className="space-y-3.5">
        {/* Active list */}
        {value.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {value.map((q, i) => (
              <li
                key={`${q}-${i}`}
                className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-gradient-to-r from-brand-50 to-pink-50 py-1 pl-3 pr-1 text-[13px] text-brand-800 shadow-sm dark:border-brand-800 dark:from-brand-950/40 dark:to-pink-950/30 dark:text-brand-100"
              >
                <span className="max-w-[260px] truncate">{q}</span>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="grid h-5 w-5 place-items-center rounded-full text-brand-500 transition hover:bg-rose-100 hover:text-rose-600 dark:text-brand-300 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                  aria-label={th ? 'ลบ' : 'Remove'}
                >
                  <I.X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Suggestion library */}
        {suggestions.length > 0 && value.length < 30 && (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-3 dark:border-slate-700 dark:bg-slate-800/30">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              <span>💡</span>
              <span>{th ? 'แตะเพื่อเพิ่ม' : 'Tap to add'}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => add(s)}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[12px] text-slate-600 transition hover:-translate-y-0.5 hover:border-brand-300 hover:text-brand-700 hover:shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-brand-700 dark:hover:text-brand-200"
                >
                  <I.Plus className="h-3 w-3" />
                  <span>{s}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Custom input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addDraft();
              }
            }}
            placeholder={th ? 'พิมพ์เองแล้วกด Enter…' : 'Type your own, press Enter…'}
            className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
          <button
            type="button"
            onClick={addDraft}
            disabled={!draft.trim() || value.length >= 30}
            className="inline-flex items-center gap-1 rounded-xl bg-gradient-to-r from-brand-500 to-pink-500 px-3.5 text-sm font-medium text-white shadow-sm transition hover:shadow-md active:scale-[0.98] disabled:opacity-40 disabled:hover:shadow-sm"
          >
            <I.Plus className="h-3.5 w-3.5" />
            {th ? 'เพิ่ม' : 'Add'}
          </button>
        </div>

        {value.length === 0 && suggestions.length === QUICK_REPLY_SUGGESTIONS.length && (
          <p className="text-center text-[11px] text-slate-400 dark:text-slate-500">
            {th ? '✨ ลองแตะข้อความข้างบนเพื่อเริ่มได้เลยค่ะ' : '✨ Tap a suggestion above to get started'}
          </p>
        )}
      </div>
    </SectionCard>
  );
}
