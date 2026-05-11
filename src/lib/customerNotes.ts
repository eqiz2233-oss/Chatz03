/**
 * Per-conversation tags + free-form note, persisted to localStorage.
 *
 * v1 is browser-local so it never blocks on a server round-trip; the schema
 * is intentionally tiny so a future server endpoint can slurp it directly
 * (`POST /api/customer-notes/:conversationId`) without UI changes.
 *
 * Key shape: { conversationId: { tags: string[], note: string, updatedAt } }
 */

const KEY = 'chatz-customer-notes-v1';
const MAX_TAG_LEN = 24;
const MAX_NOTE_LEN = 1000;
const MAX_TAGS_PER_CUSTOMER = 12;

export interface CustomerMeta {
  tags: string[];
  note: string;
  updatedAt: number;
}

type Store = Record<string, CustomerMeta>;

function readAll(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Store;
  } catch {
    return {};
  }
}

function writeAll(store: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* ignore quota / private mode */
  }
}

export function getCustomerMeta(conversationId: string): CustomerMeta {
  const all = readAll();
  const m = all[conversationId];
  return m && Array.isArray(m.tags) && typeof m.note === 'string'
    ? { tags: m.tags, note: m.note, updatedAt: m.updatedAt || 0 }
    : { tags: [], note: '', updatedAt: 0 };
}

export function addTag(conversationId: string, tag: string): CustomerMeta {
  const clean = tag.trim().slice(0, MAX_TAG_LEN);
  if (!clean) return getCustomerMeta(conversationId);
  const all = readAll();
  const cur = all[conversationId] || { tags: [], note: '', updatedAt: 0 };
  if (cur.tags.includes(clean)) return cur;
  const next: CustomerMeta = {
    tags: [...cur.tags, clean].slice(0, MAX_TAGS_PER_CUSTOMER),
    note: cur.note,
    updatedAt: Date.now(),
  };
  all[conversationId] = next;
  writeAll(all);
  return next;
}

export function removeTag(conversationId: string, tag: string): CustomerMeta {
  const all = readAll();
  const cur = all[conversationId];
  if (!cur) return { tags: [], note: '', updatedAt: 0 };
  const next: CustomerMeta = {
    tags: cur.tags.filter((x) => x !== tag),
    note: cur.note,
    updatedAt: Date.now(),
  };
  all[conversationId] = next;
  writeAll(all);
  return next;
}

export function setNote(conversationId: string, note: string): CustomerMeta {
  const clean = note.slice(0, MAX_NOTE_LEN);
  const all = readAll();
  const cur = all[conversationId] || { tags: [], note: '', updatedAt: 0 };
  const next: CustomerMeta = { tags: cur.tags, note: clean, updatedAt: Date.now() };
  all[conversationId] = next;
  writeAll(all);
  return next;
}

export const TAG_MAX_LEN = MAX_TAG_LEN;
export const NOTE_MAX_LEN = MAX_NOTE_LEN;
