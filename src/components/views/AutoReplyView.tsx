import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppPreferences } from '../../context/AppPreferencesContext';
import type { Locale } from '../../i18n/messages';
import { I } from '../Icons';

/**
 * Auto-reply settings — separate page from "Settings".
 *
 * Why a new top-level page (not a Settings tab)?
 *   • Shop owners tweak bot copy daily as products/promos change.
 *   • Settings reads as "one-time setup"; auto-reply is content work.
 *   • Mirrors how zwiz.ai / ManyChat / Page Inbox surface canned-reply tools
 *     as a first-class menu item, not buried inside preferences.
 *
 * Sections (top → bottom = least-touched → most-touched):
 *   1. บุคลิกของบอท (persona presets)
 *   2. น้ำเสียงของแบรนด์ (free-form brand voice)
 *   3. ข้อความทักทาย (greeting message — sent on first customer contact)
 *   4. ข้อความเมื่อไม่เข้าใจ (fallback message — bot can't answer)
 *   5. ข้อความเมื่อไม่อยู่ (away message — outside business hours)
 *   6. คำตอบสำเร็จรูป (quick replies — chips owner can tap to send)
 *   7. ตอบอัตโนมัติด้วยคำสำคัญ (keyword rules — first match wins, no AI tokens)
 */

interface BotSettingsExt {
  brandVoice: string;
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
  brandVoice: '',
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

export function AutoReplyView() {
  const { t, locale } = useAppPreferences();
  const [settings, setSettings] = useState<BotSettingsExt>(DEFAULT_EXT);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Load once. We share the existing /api/bot/settings endpoint; server merges
  // unknown fields into the KV store as long as they pass through DEFAULT_BOT_SETTINGS spread.
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

  // Debounced auto-save (matches Settings page behavior so the two pages
  // don't fight over the same KV entry).
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

  return (
    <div className="flex h-screen flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      {/* Page header */}
      <header className="shrink-0 border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900 md:px-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white">
              {th ? 'ตอบกลับอัตโนมัติ' : 'Auto-reply'}
            </h1>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {th
                ? 'ตั้งค่าบุคลิก คำพูด และกฎการตอบของบอท เพื่อให้ลูกค้าได้รับคำตอบทันที'
                : 'Set bot persona, scripts, and rules so customers get instant answers.'}
            </p>
          </div>
          <div className="text-[11px] text-slate-400 dark:text-slate-500">
            {saveStatus === 'saving' && <span>{th ? 'กำลังบันทึก…' : 'Saving…'}</span>}
            {saveStatus === 'saved' && <span className="text-emerald-600 dark:text-emerald-400">{th ? 'บันทึกแล้ว ✓' : 'Saved ✓'}</span>}
            {saveStatus === 'error' && <span className="text-rose-500">{th ? 'บันทึกไม่สำเร็จ' : 'Save failed'}</span>}
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-4 px-5 py-6 md:px-8 md:py-8">
          {/* 1. บุคลิกของบอท */}
          <SectionCard
            title={th ? 'บุคลิกของบอท' : 'Bot persona'}
            desc={th
              ? 'เลือกโทนพื้นฐานที่บอทจะใช้คุยกับลูกค้า'
              : 'Pick the baseline tone the bot uses with customers'}
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  { id: 'friendly',     th: 'เป็นกันเอง',   en: 'Friendly' },
                  { id: 'playful',      th: 'สนุกสนาน',     en: 'Playful' },
                  { id: 'professional', th: 'มืออาชีพ',     en: 'Professional' },
                  { id: 'formal',       th: 'ทางการ',       en: 'Formal' },
                ] as const
              ).map((opt) => {
                const active = settings.botPersona === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => set('botPersona', opt.id)}
                    className={
                      'rounded-xl border px-3 py-3 text-center text-sm font-medium transition ' +
                      (active
                        ? 'border-brand-500 bg-brand-50 text-brand-700 ring-2 ring-brand-100 dark:border-brand-400 dark:bg-brand-950/40 dark:text-brand-200 dark:ring-brand-900/40'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/60')
                    }
                  >
                    {th ? opt.th : opt.en}
                  </button>
                );
              })}
            </div>
          </SectionCard>

          {/* 2. น้ำเสียงของแบรนด์ */}
          <SectionCard
            title={th ? 'น้ำเสียงของแบรนด์' : 'Brand voice'}
            desc={th
              ? 'อธิบายโทนการพูดและคำพูดที่อยากให้บอทใช้ (เพิ่มเติมจากบุคลิก)'
              : 'Describe the brand-specific voice on top of the persona'}
          >
            <textarea
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-900/30"
              rows={3}
              value={settings.brandVoice}
              onChange={(e) => set('brandVoice', e.target.value)}
              placeholder={t('settings.brandVoicePlaceholder')}
            />
          </SectionCard>

          {/* 3. ข้อความทักทาย */}
          <SectionCard
            title={th ? 'ข้อความทักทาย' : 'Greeting message'}
            desc={th
              ? 'ข้อความแรกที่บอทส่งหาลูกค้าเมื่อเริ่มแชท'
              : 'First message the bot sends when a customer starts a chat'}
            accessory={
              <Switch
                checked={settings.greetingEnabled}
                onChange={(v) => set('greetingEnabled', v)}
                label="enable greeting"
              />
            }
          >
            <textarea
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-900/30 disabled:opacity-50"
              rows={3}
              disabled={!settings.greetingEnabled}
              value={settings.greetingMessage}
              onChange={(e) => set('greetingMessage', e.target.value)}
              placeholder={th
                ? 'สวัสดีค่ะ ขอบคุณที่ทักเข้ามานะคะ มีอะไรให้ช่วยไหมคะ 😊'
                : 'Hi! Thanks for reaching out — how can we help today? 😊'}
            />
          </SectionCard>

          {/* 4. ข้อความเมื่อไม่เข้าใจ */}
          <SectionCard
            title={th ? 'ข้อความเมื่อไม่เข้าใจ' : 'Fallback message'}
            desc={th
              ? 'ใช้เมื่อบอทไม่เข้าใจคำถามและจะส่งต่อให้แอดมิน'
              : 'Used when the bot cannot answer and is handing off to a human'}
          >
            <textarea
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-900/30"
              rows={2}
              value={settings.fallbackMessage}
              onChange={(e) => set('fallbackMessage', e.target.value)}
              placeholder={th
                ? 'ขอโทษนะคะ ขอเรียกแอดมินมาตอบให้นะคะ รอสักครู่ค่ะ 🙏'
                : "I'll bring in a human to help you with that — one moment please 🙏"}
            />
          </SectionCard>

          {/* 5. ข้อความเมื่อไม่อยู่ */}
          <SectionCard
            title={th ? 'ข้อความนอกเวลาทำการ' : 'Away message'}
            desc={th
              ? 'ส่งให้ลูกค้าทราบว่าตอนนี้นอกเวลา จะตอบกลับเมื่อไหร่'
              : 'Tell customers when they will hear back after-hours'}
            accessory={
              <Switch
                checked={settings.awayEnabled}
                onChange={(v) => set('awayEnabled', v)}
                label="enable away"
              />
            }
          >
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {th ? 'เริ่ม' : 'From'}
                  </div>
                  <input
                    type="time"
                    disabled={!settings.awayEnabled}
                    value={settings.awayStart}
                    onChange={(e) => set('awayStart', e.target.value)}
                    className="input text-sm disabled:opacity-50"
                  />
                </label>
                <label className="block">
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {th ? 'ถึง' : 'To'}
                  </div>
                  <input
                    type="time"
                    disabled={!settings.awayEnabled}
                    value={settings.awayEnd}
                    onChange={(e) => set('awayEnd', e.target.value)}
                    className="input text-sm disabled:opacity-50"
                  />
                </label>
              </div>
              <textarea
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-900/30 disabled:opacity-50"
                rows={2}
                disabled={!settings.awayEnabled}
                value={settings.awayMessage}
                onChange={(e) => set('awayMessage', e.target.value)}
                placeholder={th
                  ? 'ตอนนี้แอดมินยังไม่อยู่ค่ะ จะรีบกลับมาตอบในเช้าวันถัดไปนะคะ 🌙'
                  : "We're away right now. We'll get back first thing in the morning 🌙"}
              />
            </div>
          </SectionCard>

          {/* 6. คำตอบสำเร็จรูป */}
          <QuickRepliesCard
            value={settings.quickReplies}
            onChange={(v) => set('quickReplies', v)}
            locale={locale}
          />

          {/* 7. ตอบอัตโนมัติด้วยคำสำคัญ */}
          <KeywordRulesCard locale={locale} />
        </div>
      </main>
    </div>
  );
}

// ─── shared section card (kept local so this view stands alone) ─────────────

function SectionCard({
  title,
  desc,
  accessory,
  children,
}: {
  title: string;
  desc?: string | null;
  accessory?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
          {desc && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{desc}</p>}
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

// ─── Quick replies ──────────────────────────────────────────────────────────
// Stored as a simple string[] inside bot.settings. Owner taps a chip in the
// inbox composer to insert the text (composer hookup lives in the inbox view).

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

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    if (value.includes(text)) {
      setDraft('');
      return;
    }
    onChange([...value, text].slice(0, 30));
    setDraft('');
  };

  const remove = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  return (
    <SectionCard
      title={th ? 'คำตอบสำเร็จรูป' : 'Quick replies'}
      desc={th
        ? 'ปุ่มคำตอบที่ใช้บ่อย แอดมินกดส่งได้เร็วในกล่องข้อความ (สูงสุด 30)'
        : 'Canned replies the admin can send with one tap from the inbox (max 30)'}
    >
      <div className="space-y-3">
        {value.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
            {th
              ? 'ยังไม่มี — ลองเพิ่ม เช่น "ราคา 250 บาทค่ะ" หรือ "ส่งฟรี EMS ถ้าซื้อ 2 ชิ้น"'
              : 'No quick replies yet — try "It\'s 250 THB" or "Free EMS on orders of 2+"'}
          </div>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {value.map((q, i) => (
              <li
                key={`${q}-${i}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-1 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200"
              >
                <span className="max-w-[260px] truncate">{q}</span>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="grid h-5 w-5 place-items-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                  aria-label={th ? 'ลบ' : 'Remove'}
                >
                  <I.X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder={th ? 'พิมพ์คำตอบที่ใช้บ่อย แล้วกด Enter' : 'Type a quick reply, press Enter'}
            className="input flex-1 text-sm"
          />
          <button
            type="button"
            onClick={add}
            disabled={!draft.trim() || value.length >= 30}
            className="btn-primary text-xs disabled:opacity-50"
          >
            <I.Plus className="h-3.5 w-3.5" />
            {th ? 'เพิ่ม' : 'Add'}
          </button>
        </div>
      </div>
    </SectionCard>
  );
}

// ─── Keyword auto-reply (moved here from Settings) ──────────────────────────

interface KeywordRule {
  id: string;
  keywords: string[];
  reply: string;
  enabled: boolean;
}

function KeywordRulesCard({ locale }: { locale: Locale }) {
  const [rules, setRules] = useState<KeywordRule[] | null>(null);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<KeywordRule[] | null>(null);
  const th = locale === 'th';

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch('/api/bot/keyword-rules', { credentials: 'include' });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as { rules: KeywordRule[] };
        if (!cancelled) setRules(Array.isArray(j.rules) ? j.rules : []);
      } catch {
        if (!cancelled) setRules([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const payload = pendingRef.current;
      if (payload) {
        void fetch('/api/bot/keyword-rules', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rules: payload }),
          keepalive: true,
        });
      }
    };
  }, []);

  const writeServer = useCallback(async (payload: KeywordRule[]) => {
    setSaving(true);
    try {
      await fetch('/api/bot/keyword-rules', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: payload }),
      });
    } catch {
      /* user can retry */
    } finally {
      setSaving(false);
    }
  }, []);

  const saveImmediate = useCallback(
    (next: KeywordRule[]) => {
      setRules(next);
      pendingRef.current = null;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      void writeServer(next);
    },
    [writeServer],
  );

  const saveDebounced = useCallback(
    (next: KeywordRule[]) => {
      setRules(next);
      pendingRef.current = next;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        const payload = pendingRef.current;
        if (!payload) return;
        pendingRef.current = null;
        void writeServer(payload);
      }, 600);
    },
    [writeServer],
  );

  const addRule = () => {
    if (!rules) return;
    const fresh: KeywordRule = {
      id: `kr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      keywords: [],
      reply: '',
      enabled: true,
    };
    saveImmediate([...rules, fresh]);
  };

  const updateRule = (id: string, patch: Partial<KeywordRule>, immediate = false) => {
    if (!rules) return;
    const next = rules.map((r) => (r.id === id ? { ...r, ...patch } : r));
    if (immediate) saveImmediate(next);
    else saveDebounced(next);
  };

  const removeRule = (id: string) => {
    if (!rules) return;
    saveImmediate(rules.filter((r) => r.id !== id));
  };

  return (
    <SectionCard
      title={th ? 'ตอบอัตโนมัติด้วยคำสำคัญ' : 'Keyword auto-reply'}
      desc={
        th
          ? 'ถ้าข้อความลูกค้าตรงกับคีย์เวิร์ดที่ตั้งไว้ ระบบจะตอบให้ทันที (ไม่ใช้ AI)'
          : 'When a customer message contains any keyword, the bot replies instantly (no AI tokens used).'
      }
    >
      <div className="space-y-3">
        {rules === null && (
          <div className="text-xs text-slate-400 dark:text-slate-500">
            {th ? 'กำลังโหลด…' : 'Loading…'}
          </div>
        )}
        {rules && rules.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
            {th
              ? 'ยังไม่มีกฎ — ลองเพิ่มกฎแรก เช่น keyword: "ราคา" → ตอบ: "ราคา 250 บาทค่ะ"'
              : "No rules yet — try one like keyword: \"price\" → reply: \"It's 250 THB\""}
          </div>
        )}
        {rules?.map((rule) => (
          <KeywordRuleRow
            key={rule.id}
            rule={rule}
            onChange={(patch, immediate) => updateRule(rule.id, patch, immediate)}
            onRemove={() => removeRule(rule.id)}
            locale={locale}
          />
        ))}
        <div className="flex items-center justify-between">
          <button type="button" onClick={addRule} className="btn-secondary text-xs">
            <I.Plus className="h-3.5 w-3.5" />
            {th ? 'เพิ่มกฎ' : 'Add rule'}
          </button>
          {saving && (
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              {th ? 'กำลังบันทึก…' : 'Saving…'}
            </span>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

function KeywordRuleRow({
  rule,
  onChange,
  onRemove,
  locale,
}: {
  rule: KeywordRule;
  onChange: (patch: Partial<KeywordRule>, immediate?: boolean) => void;
  onRemove: () => void;
  locale: Locale;
}) {
  const th = locale === 'th';
  const kwInput = rule.keywords.join(', ');

  return (
    <div
      className={
        'rounded-xl border bg-white p-3 transition dark:bg-slate-900 ' +
        (rule.enabled
          ? 'border-slate-200 dark:border-slate-700'
          : 'border-slate-200/60 opacity-60 dark:border-slate-800')
      }
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked }, true)}
            className="h-3.5 w-3.5 rounded accent-brand-600"
          />
          {th ? 'ใช้งาน' : 'Enabled'}
        </label>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
          aria-label={th ? 'ลบกฎ' : 'Remove rule'}
        >
          <I.X className="h-3.5 w-3.5" />
        </button>
      </div>
      <label className="mb-2 block">
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {th ? 'คีย์เวิร์ด (คั่นด้วย , )' : 'Keywords (comma-separated)'}
        </div>
        <input
          type="text"
          value={kwInput}
          onChange={(e) =>
            onChange({
              keywords: e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder={th ? 'ราคา, เท่าไหร่, ค่าส่ง' : 'price, how much, shipping'}
          className="input text-sm"
        />
      </label>
      <label className="block">
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {th ? 'ข้อความตอบกลับ' : 'Reply'}
        </div>
        <textarea
          rows={2}
          value={rule.reply}
          onChange={(e) => onChange({ reply: e.target.value })}
          placeholder={
            th
              ? 'ราคา 250 บาทค่ะ ส่งฟรีถ้าซื้อ 2 ชิ้นขึ้นไป'
              : "It's 250 THB. Free shipping when you order 2+."
          }
          className="input resize-y text-sm"
        />
      </label>
    </div>
  );
}
