/**
 * User-defined quick reply templates, persisted to localStorage.
 *
 * The chat thread always renders four default replies (the i18n chat.q1–q4
 * strings) plus whatever the shop has saved here. Defaults are read-only so
 * the user can't end up with an empty list; custom ones can be removed
 * individually. v1 is per-browser; a future server-backed store can drop in
 * by swapping these helpers without touching the UI.
 */

const KEY = 'chatz-quick-replies-v1';
const MAX_REPLIES = 20;
const MAX_LENGTH = 200;

export interface QuickReply {
  id: string;
  text: string;
  /** Created at (ms epoch) — used only for stable sort order. */
  createdAt: number;
}

function read(): QuickReply[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (r): r is QuickReply =>
          r && typeof r.id === 'string' && typeof r.text === 'string' && typeof r.createdAt === 'number',
      )
      .slice(0, MAX_REPLIES);
  } catch {
    return [];
  }
}

function write(list: QuickReply[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* quota / private mode — silently ignore, UI keeps in-memory copy */
  }
}

export function getQuickReplies(): QuickReply[] {
  return read().sort((a, b) => a.createdAt - b.createdAt);
}

export function addQuickReply(text: string): QuickReply[] {
  const clean = text.trim().slice(0, MAX_LENGTH);
  if (!clean) return getQuickReplies();
  const list = read();
  // De-dupe: if the same text already exists, no-op.
  if (list.some((r) => r.text === clean)) return getQuickReplies();
  const next: QuickReply[] = [
    ...list,
    { id: `qr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text: clean, createdAt: Date.now() },
  ].slice(0, MAX_REPLIES);
  write(next);
  return next.sort((a, b) => a.createdAt - b.createdAt);
}

export function removeQuickReply(id: string): QuickReply[] {
  const next = read().filter((r) => r.id !== id);
  write(next);
  return next.sort((a, b) => a.createdAt - b.createdAt);
}

export const QUICK_REPLY_MAX_LENGTH = MAX_LENGTH;
