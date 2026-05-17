import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppPreferences } from '../../context/AppPreferencesContext';
import { I } from '../Icons';
import { SkeletonBar, SkeletonCircle } from '../Skeleton';

/**
 * Auto-reply settings — persona picker + free-text messages.
 *
 * Persona picker and after-hours message only.
 */

interface BotSettingsExt {
  botPersona: 'friendly' | 'formal' | 'playful' | 'professional';
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
        const j = (await r.json()) as { settings: Partial<BotSettingsExt> };
        if (cancelled) return;
        const merged = { ...DEFAULT_EXT, ...(j.settings || {}) };
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
              <SectionCard
                icon="🎭"
                title={th ? 'บุคลิกของบอท' : 'Bot personality'}
                desc={th ? 'แตะการ์ดเพื่อเลือก' : 'Tap a card to pick'}
                info={th
                  ? 'บุคลิกจะกำหนดสไตล์การพูดของบอท เมื่อบอทตอบลูกค้าแบบ AI'
                  : 'Personality shapes the bot’s tone when it answers customers with AI.'}
              >
                <PersonaPicker
                  th={th}
                  value={settings.botPersona}
                  onChange={(v) => set('botPersona', v)}
                />
                <PreviewBubble th={th} persona={activePersona} />
              </SectionCard>

              <SectionCard
                icon="🌙"
                title={th ? 'นอกเวลาทำการ' : 'After hours'}
                desc={th ? 'ตั้งเวลาและข้อความเมื่อร้านปิด' : 'Set hours and after-hours reply'}
                info={th
                  ? 'บอทจะส่งข้อความนี้แทนคำตอบปกติเมื่ออยู่นอกช่วงเวลาที่เปิดร้าน'
                  : 'The bot sends this message instead of its usual reply during closed hours.'}
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
                    {th ? 'ปิดอยู่ — บอทจะตอบทุกข้อความตลอด 24 ชม.' : 'Off — the bot replies 24/7.'}
                  </div>
                ) : (
                  <div className="space-y-4">
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
              </SectionCard>
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

function SectionCard({
  icon,
  title,
  desc,
  info,
  accessory,
  children,
}: {
  icon?: string;
  title: string;
  desc?: string | null;
  info?: string;
  accessory?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/80 shadow-sm backdrop-blur-sm transition-shadow duration-500 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/80">
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
        <div className="flex min-w-0 items-start gap-2.5">
          {icon && <span className="mt-0.5 text-lg leading-none" aria-hidden>{icon}</span>}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
              {info && <InfoTooltip text={info} />}
            </div>
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

function PreviewBubble({ th, persona }: { th: boolean; persona: typeof PERSONAS[number] }) {
  return (
    <div className="mt-3 flex items-end gap-2 rounded-xl bg-slate-50/80 px-3 py-3 transition-colors duration-500 dark:bg-slate-800/40">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-pink-500 text-sm shadow-sm">
        {persona.emoji}
      </div>
      <div
        key={persona.id /* re-mount on persona change for fade-in */}
        className="relative max-w-[85%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2 text-[13px] text-slate-700 shadow-sm motion-safe:animate-[fadeUp_400ms_ease-out] dark:bg-slate-900 dark:text-slate-200"
      >
        {th ? persona.sample_th : persona.sample_en}
      </div>
      <span className="ml-auto text-[10px] text-slate-400 dark:text-slate-500">
        {th ? 'ตัวอย่าง' : 'preview'}
      </span>
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
            <div className="mt-2.5 rounded-xl bg-white/70 px-3 py-2 text-[12px] leading-relaxed text-slate-600 shadow-inner dark:bg-slate-950/40 dark:text-slate-300">
              <span className="italic">"{th ? p.sample_th : p.sample_en}"</span>
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
