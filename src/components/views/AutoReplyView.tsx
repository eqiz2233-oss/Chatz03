import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppPreferences } from '../../context/AppPreferencesContext';
import { I } from '../Icons';
import { SkeletonBar, SkeletonCircle } from '../Skeleton';

/**
 * Auto-reply settings — one combined card with two subsections:
 *   1. Persona picker (default / friendly / playful / formal)
 *   2. After-hours (toggle + open-close times + closed-shop message)
 *
 * Greeting and fallback live entirely inside the AI: the server's prompt
 * builder generates them from the chosen persona, so the shop owner
 * doesn't have to write copy. That's why this page has only one card —
 * the user sets *who the bot is*, not *what the bot says*.
 */

interface BotSettingsExt {
  botPersona: 'default' | 'friendly' | 'playful' | 'formal';
  greetingMessage: string;
  greetingEnabled: boolean;
  fallbackMessage: string;
  awayMessage: string;
  awayEnabled: boolean;
  awayStart: string;
  awayEnd: string;
  quickReplies: string[];
}

const DEFAULT_EXT: BotSettingsExt = {
  botPersona: 'default',
  greetingMessage: '',
  greetingEnabled: true,
  fallbackMessage: '',
  awayMessage: '',
  awayEnabled: false,
  awayStart: '22:00',
  awayEnd: '07:00',
  quickReplies: [],
};

/**
 * Each persona has a *distinct* voice — not just a different sample line.
 * The dialogue example (customer Q → bot A) is what really sells the
 * difference, because the user sees how the bot will actually answer a
 * real shop question, not just say hi.
 *
 * The persona id is sent verbatim to the server, which maps it onto a
 * matching tone-of-voice block inside the system prompt (see server/ai.js).
 */
const PERSONAS = [
  {
    id: 'default' as const,
    emoji: '✨',
    th: 'ค่าเริ่มต้น',
    en: 'Default',
    blurb_th: 'สุภาพ อ่านง่าย ปรับโทนตามลูกค้า',
    blurb_en: 'Polite, easy to read, adapts to the customer',
    greeting_th: 'สวัสดีค่ะ มีอะไรให้ช่วยไหมคะ',
    greeting_en: 'Hi, how can I help today?',
    answer_th: 'ตัวนี้ 250 บาทค่ะ ซื้อ 2 ชิ้นส่งฟรี EMS เลยนะคะ',
    answer_en: "This one's 250 THB. Free EMS if you order 2 or more.",
    tint: 'from-violet-50 to-pink-50 dark:from-violet-950/30 dark:to-pink-950/20',
    recommended: true,
  },
  {
    id: 'friendly' as const,
    emoji: '🌸',
    th: 'เป็นกันเอง',
    en: 'Friendly',
    blurb_th: 'เหมือนคนคุยจริงๆ ใช้คำง่ายๆ',
    blurb_en: 'Talks like a real person',
    greeting_th: 'หวัดดีค่ะ ทักมาเลยนะ มีอะไรถามได้เต็มที่',
    greeting_en: "Hey there! Ask me anything you'd like.",
    answer_th: 'ตัวนี้ราคา 250 ค่ะ ถ้าซื้อ 2 ชิ้นส่งฟรี EMS เลยน้า',
    answer_en: "It's 250 baht. Grab 2 and shipping's on us.",
    tint: 'from-rose-50 to-amber-50 dark:from-rose-950/30 dark:to-amber-950/20',
  },
  {
    id: 'playful' as const,
    emoji: '🎀',
    th: 'สนุกสนาน',
    en: 'Playful',
    blurb_th: 'สดใส ขี้เล่น ใส่อีโมจิได้',
    blurb_en: 'Cheerful, playful, emojis OK',
    greeting_th: 'หวัดดีค่าาา~ ดูตัวไหนอยู่บอกได้เลยน้า 💕',
    greeting_en: 'Heyyy~ which one caught your eye 💕',
    answer_th: '250 บาทค่าาา~ ซื้อ 2 ชิ้นส่งฟรีนะคะ คุ้มมากเลย ✨',
    answer_en: '250 baht~ free shipping when you grab 2 ✨',
    tint: 'from-fuchsia-50 to-purple-50 dark:from-fuchsia-950/30 dark:to-purple-950/20',
  },
  {
    id: 'formal' as const,
    emoji: '🎩',
    th: 'ทางการ',
    en: 'Formal',
    blurb_th: 'กระชับ ชัดเจน ดูน่าเชื่อถือ',
    blurb_en: 'Concise, clear, trustworthy',
    greeting_th: 'เรียนลูกค้า ทางร้านยินดีให้บริการค่ะ',
    greeting_en: 'Dear customer, our shop is at your service.',
    answer_th: 'สินค้าดังกล่าวราคา 250 บาทค่ะ จัดส่งฟรีเมื่อซื้อตั้งแต่ 2 ชิ้นขึ้นไป',
    answer_en: 'The item is priced at 250 THB. Free shipping on orders of 2 or more.',
    tint: 'from-slate-50 to-zinc-100 dark:from-slate-900/40 dark:to-zinc-900/40',
  },
];

/** Coerce any legacy / unknown persona value into one of the four current ids. */
function normalizePersona(v: unknown): BotSettingsExt['botPersona'] {
  if (v === 'friendly' || v === 'playful' || v === 'formal' || v === 'default') return v;
  // The old 'professional' persona has been merged into 'default' (smart polite).
  return 'default';
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const eq = (a: BotSettingsExt, b: BotSettingsExt) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Roving-focus arrow-key navigation for a horizontal/grid radiogroup. */
function useRovingFocus<T extends string>(
  ids: readonly T[],
  activeId: T,
  onSelect: (id: T) => void,
) {
  const ref = useRef<HTMLDivElement>(null);
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const idx = ids.indexOf(activeId);
      let next = idx;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          next = (idx + 1) % ids.length;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          next = (idx - 1 + ids.length) % ids.length;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = ids.length - 1;
          break;
        case ' ':
        case 'Enter':
          // Already selected by click handler; just prevent scroll on space.
          e.preventDefault();
          return;
        default:
          return;
      }
      e.preventDefault();
      onSelect(ids[next]);
      const btn = ref.current?.querySelector<HTMLElement>(`[data-roving-id="${ids[next]}"]`);
      btn?.focus();
    },
    [ids, activeId, onSelect],
  );
  return { ref, handleKeyDown };
}

// ─── Main view ──────────────────────────────────────────────────────────────

export function AutoReplyView() {
  const { locale } = useAppPreferences();
  const [settings, setSettings] = useState<BotSettingsExt>(DEFAULT_EXT);
  const [loaded, setLoaded] = useState(false);

  // Undo support — track the "before" snapshot so the latest save can be reverted.
  const beforeChangeRef = useRef<BotSettingsExt>(DEFAULT_EXT);
  const [undoTarget, setUndoTarget] = useState<BotSettingsExt | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch('/api/bot/settings', { credentials: 'include' });
        if (!r.ok) return;
        const j = (await r.json()) as { settings: Partial<BotSettingsExt> & { botPersona?: unknown } };
        if (cancelled) return;
        const merged: BotSettingsExt = {
          ...DEFAULT_EXT,
          ...(j.settings || {}),
          botPersona: normalizePersona((j.settings || {}).botPersona),
        };
        setSettings(merged);
        beforeChangeRef.current = merged;
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Debounced auto-save. On a successful save, surface an undo-toast with the
  // pre-change snapshot — but only when the change is a real edit, not the
  // server bouncing back the same value.
  useEffect(() => {
    if (!loaded) return;
    if (eq(settings, beforeChangeRef.current)) return;
    const id = window.setTimeout(async () => {
      const before = beforeChangeRef.current;
      try {
        const r = await fetch('/api/bot/settings', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings }),
        });
        if (r.ok) {
          beforeChangeRef.current = settings;
          setUndoTarget(before);
          setSaveFailed(false);
        } else {
          setSaveFailed(true);
        }
      } catch {
        setSaveFailed(true);
      }
    }, 600);
    return () => window.clearTimeout(id);
  }, [settings, loaded]);

  const set = useCallback(<K extends keyof BotSettingsExt>(key: K, value: BotSettingsExt[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
  }, []);

  const handleUndo = () => {
    if (!undoTarget) return;
    const reverted = undoTarget;
    setUndoTarget(null);
    setSettings(reverted);
  };

  const th = locale === 'th';
  const activePersona = PERSONAS.find((p) => p.id === settings.botPersona) ?? PERSONAS[0];

  return (
    <div className="flex h-screen flex-1 flex-col bg-gradient-to-b from-violet-50/50 via-white to-rose-50/30 dark:from-slate-950 dark:via-slate-950 dark:to-slate-950">
      <header className="shrink-0 border-b border-slate-200/70 bg-white/70 px-6 py-4 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/70 md:px-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              {th ? 'ตอบกลับอัตโนมัติ' : 'Auto-reply'}
            </h1>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {th ? 'ตั้งค่าให้บอทตอบลูกค้าแทนคุณ' : 'Set up automatic replies for your customers'}
            </p>
          </div>
          {saveFailed && (
            <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
              {th ? 'บันทึกไม่สำเร็จ' : 'Save failed'}
            </span>
          )}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-5 px-5 py-6 md:px-8 md:py-8">
          {!loaded ? (
            <SkeletonView />
          ) : (
            <>
              {/* One combined card: persona picker + dialogue preview + business
                  hours, separated by a subtle inner divider. */}
              <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/80 shadow-sm backdrop-blur-sm transition-shadow duration-500 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/80">
                {/* Persona */}
                <header className="flex items-start gap-2.5 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
                  <span className="mt-0.5 text-lg leading-none" aria-hidden>🎭</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">
                        {th ? 'บุคลิกของบอท' : 'Bot personality'}
                      </h3>
                      <InfoTooltip text={th
                        ? 'บุคลิกจะกำหนดสไตล์การพูดของบอทเวลาตอบลูกค้า'
                        : 'Personality shapes the bot’s tone when it answers customers.'} />
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {th ? 'แตะการ์ดเพื่อเลือก' : 'Tap a card to pick'}
                    </p>
                  </div>
                </header>
                <div className="px-5 py-4">
                  <PersonaPicker
                    th={th}
                    value={settings.botPersona}
                    onChange={(v) => set('botPersona', v)}
                  />
                  <DialoguePreview th={th} persona={activePersona} />
                </div>

                {/* Business hours — same card, soft tinted header to read as
                    a subsection rather than a separate panel. */}
                <header className="flex items-start justify-between gap-3 border-y border-slate-100 bg-slate-50/40 px-5 py-3.5 dark:border-slate-800 dark:bg-slate-900/40">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span className="mt-0.5 text-lg leading-none" aria-hidden>🌙</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">
                          {th ? 'นอกเวลาทำการ' : 'After hours'}
                        </h3>
                        <InfoTooltip text={th
                          ? 'บอทจะส่งข้อความนี้แทนคำตอบปกติเมื่ออยู่นอกช่วงเวลาที่เปิดร้าน'
                          : 'The bot sends this message instead of its usual reply during closed hours.'} />
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {th ? 'ตั้งเวลาและข้อความเมื่อร้านปิด' : 'Set hours and after-hours reply'}
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={settings.awayEnabled}
                    onChange={(v) => set('awayEnabled', v)}
                    label="enable away"
                  />
                </header>
                <div className="px-5 py-4">
                  {!settings.awayEnabled ? (
                    <div className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
                      {th ? 'ปิดอยู่ — บอทจะตอบทุกข้อความตลอด 24 ชม.' : 'Off — the bot replies 24/7.'}
                    </div>
                  ) : (
                    <div className="space-y-4 motion-safe:animate-[fadeUp_300ms_ease-out]">
                      <div className="grid grid-cols-2 gap-3">
                        <TimeField
                          label={th ? 'เปิดร้าน' : 'Open'}
                          value={settings.awayEnd}
                          onChange={(v) => set('awayEnd', v)}
                        />
                        <TimeField
                          label={th ? 'ปิดร้าน' : 'Close'}
                          value={settings.awayStart}
                          onChange={(v) => set('awayStart', v)}
                        />
                      </div>
                      <MessageField
                        th={th}
                        value={settings.awayMessage}
                        onChange={(v) => set('awayMessage', v)}
                        placeholder={th
                          ? 'ตอนนี้ปิดร้านแล้วค่ะ จะรีบตอบในเช้าวันถัดไปนะคะ 🌙'
                          : "We're closed — we'll reply first thing tomorrow 🌙"}
                      />
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </main>

      <UndoToast
        target={undoTarget}
        onUndo={handleUndo}
        onClose={() => setUndoTarget(null)}
        th={th}
      />
    </div>
  );
}

// ─── Building blocks ────────────────────────────────────────────────────────

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
        'relative inline-flex h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors duration-300 ease-out ' +
        (checked
          ? 'bg-gradient-to-r from-brand-500 to-pink-500'
          : 'bg-slate-300 dark:bg-slate-700')
      }
    >
      <span
        className={
          'block h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-300 ease-out ' +
          (checked ? 'translate-x-5' : 'translate-x-0')
        }
      />
    </button>
  );
}

function MessageField({
  th,
  value,
  onChange,
  placeholder,
}: {
  th: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      className="w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors duration-300 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-900/30"
      rows={2}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
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
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors duration-300 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-brand-900/40"
      />
    </label>
  );
}

/**
 * Two-bubble dialogue preview so the user sees the persona's *answering*
 * style, not just a greeting. The bot's reply on the right is what really
 * sells the difference between personas.
 */
function DialoguePreview({ th, persona }: { th: boolean; persona: typeof PERSONAS[number] }) {
  const customerQ = th ? 'ราคาเท่าไหร่คะ?' : 'How much is this?';
  return (
    <div
      key={persona.id /* re-mount on persona switch for the entry animation */}
      className="mt-4 space-y-2 rounded-2xl bg-slate-50/70 p-3 transition-colors duration-500 motion-safe:animate-[fadeUp_400ms_ease-out] dark:bg-slate-800/40"
    >
      {/* Customer bubble */}
      <div className="flex items-end gap-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-300 text-[10px] font-semibold text-white dark:bg-slate-600" aria-hidden>
          {th ? 'ล' : 'C'}
        </span>
        <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-white px-3 py-1.5 text-[13px] text-slate-700 shadow-sm dark:bg-slate-900 dark:text-slate-200">
          {customerQ}
        </div>
      </div>
      {/* Bot reply */}
      <div className="flex items-end justify-end gap-2">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-r from-brand-500 to-pink-500 px-3 py-1.5 text-[13px] text-white shadow-sm">
          {th ? persona.answer_th : persona.answer_en}
        </div>
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-pink-500 text-sm shadow-sm" aria-hidden>
          {persona.emoji}
        </span>
      </div>
      <div className="flex justify-end pr-1">
        <span className="text-[10px] text-slate-400 dark:text-slate-500">
          {th ? 'ตัวอย่างคำตอบจริง' : 'sample reply'}
        </span>
      </div>
    </div>
  );
}

// ─── Persona picker (radiogroup, carousel on mobile, grid on desktop) ────────

function PersonaPicker({
  th,
  value,
  onChange,
}: {
  th: boolean;
  value: BotSettingsExt['botPersona'];
  onChange: (v: BotSettingsExt['botPersona']) => void;
}) {
  const ids = useMemo(() => PERSONAS.map((p) => p.id), []);
  const { ref, handleKeyDown } = useRovingFocus(ids, value, onChange);

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={th ? 'บุคลิกของบอท' : 'Bot personality'}
      onKeyDown={handleKeyDown}
      className="-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 md:pb-0"
    >
      {PERSONAS.map((p) => {
        const active = value === p.id;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            data-roving-id={p.id}
            onClick={() => onChange(p.id)}
            className={
              'group relative min-w-[78%] shrink-0 snap-center overflow-hidden rounded-2xl border p-3.5 text-left transition-all duration-300 ease-out focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950 md:min-w-0 ' +
              (active
                ? 'border-brand-400 bg-gradient-to-br ' + p.tint + ' shadow-lg shadow-brand-500/10 ring-2 ring-brand-300/50 dark:ring-brand-500/40'
                : 'border-slate-200 bg-white hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-800')
            }
          >
            {p.recommended && (
              <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-brand-500 to-pink-500 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white shadow-sm">
                ★ {th ? 'แนะนำ' : 'recommended'}
              </span>
            )}
            <div className="flex items-center gap-2">
              <span className="text-2xl transition-transform duration-500 ease-out group-hover:scale-110">{p.emoji}</span>
              <span className={'text-sm font-semibold transition-colors duration-300 ' + (active ? 'text-brand-700 dark:text-brand-200' : 'text-slate-800 dark:text-slate-100')}>
                {th ? p.th : p.en}
              </span>
              {active && (
                <span className="ml-auto grid h-5 w-5 place-items-center rounded-full bg-brand-500 text-white shadow-sm motion-safe:animate-[fadeIn_300ms_ease-out]">
                  <I.Check className="h-3 w-3" />
                </span>
              )}
            </div>
            <p className={'mt-1.5 text-[11px] leading-relaxed transition-colors duration-300 ' + (active ? 'text-brand-700/80 dark:text-brand-200/80' : 'text-slate-500 dark:text-slate-400')}>
              {th ? p.blurb_th : p.blurb_en}
            </p>
            <div className="mt-2.5 rounded-xl bg-white/70 px-3 py-2 text-[12px] leading-relaxed text-slate-600 shadow-inner dark:bg-slate-950/40 dark:text-slate-300">
              <span className="italic">"{th ? p.greeting_th : p.greeting_en}"</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── InfoTooltip ────────────────────────────────────────────────────────────

function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label="More info"
        className="grid h-4 w-4 place-items-center rounded-full text-slate-400 transition-colors duration-300 hover:text-brand-500 focus:outline-none focus-visible:text-brand-500 focus-visible:ring-2 focus-visible:ring-brand-300 dark:text-slate-500 dark:hover:text-brand-400"
      >
        <I.Info className="h-3.5 w-3.5" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 w-56 max-w-[80vw] -translate-x-1/2 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] leading-relaxed text-white opacity-0 shadow-lg transition-opacity duration-300 ease-out group-hover:opacity-100 group-focus-within:opacity-100 dark:bg-slate-100 dark:text-slate-900"
      >
        {text}
      </span>
    </span>
  );
}

// ─── UndoToast ──────────────────────────────────────────────────────────────

function UndoToast({
  target,
  onUndo,
  onClose,
  th,
}: {
  target: BotSettingsExt | null;
  onUndo: () => void;
  onClose: () => void;
  th: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!target) {
      setVisible(false);
      const id = window.setTimeout(() => setMounted(false), 350);
      return () => window.clearTimeout(id);
    }
    setMounted(true);
    // next frame -> trigger transition in
    const raf = requestAnimationFrame(() => setVisible(true));
    const auto = window.setTimeout(onClose, 5000);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(auto);
    };
  }, [target, onClose]);

  if (!mounted) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center px-4">
      <div
        role="status"
        className={
          'pointer-events-auto flex items-center gap-3 rounded-full bg-slate-900 px-4 py-2 text-sm text-white shadow-xl transition-all duration-500 ease-out dark:bg-slate-100 dark:text-slate-900 ' +
          (visible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0')
        }
      >
        <span className="flex items-center gap-1.5">
          <span className="grid h-4 w-4 place-items-center rounded-full bg-emerald-500/90 text-white">
            <I.Check className="h-2.5 w-2.5" />
          </span>
          <span>{th ? 'บันทึกแล้ว' : 'Saved'}</span>
        </span>
        <span className="h-3 w-px bg-white/20 dark:bg-slate-400/40" aria-hidden />
        <button
          type="button"
          onClick={onUndo}
          className="rounded-full px-2 py-0.5 text-sm font-semibold text-brand-300 transition-colors duration-300 hover:bg-white/10 hover:text-brand-200 dark:text-brand-700 dark:hover:bg-slate-900/10 dark:hover:text-brand-800"
        >
          {th ? 'เลิกทำ' : 'Undo'}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={th ? 'ปิด' : 'dismiss'}
          className="grid h-5 w-5 place-items-center rounded-full text-white/60 transition-colors duration-300 hover:bg-white/10 hover:text-white dark:text-slate-500 dark:hover:bg-slate-900/10 dark:hover:text-slate-900"
        >
          <I.X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ─── Skeleton (first-load) ──────────────────────────────────────────────────

function SkeletonView() {
  return (
    <>
      <SkeletonSection lines={2}>
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2">
                <SkeletonCircle className="h-6 w-6" />
                <SkeletonBar className="h-3 w-20" />
              </div>
              <SkeletonBar className="mt-3 h-8 w-full" />
            </div>
          ))}
        </div>
      </SkeletonSection>
      <SkeletonSection lines={4} />
    </>
  );
}

function SkeletonSection({ lines, children }: { lines: number; children?: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/80 p-5 dark:border-slate-800 dark:bg-slate-900/80">
      <SkeletonBar className="h-4 w-32" />
      <SkeletonBar className="mt-2 h-2.5 w-48" />
      <div className="mt-4 space-y-2">
        {children ?? Array.from({ length: lines }).map((_, i) => (
          <SkeletonBar key={i} className="h-10 w-full" />
        ))}
      </div>
    </section>
  );
}
