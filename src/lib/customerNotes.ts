/**
 * Per-conversation tags + free-form note, persisted to localStorage.
 *
 * v1 is browser-local so it never blocks on a server round-trip; the schema
 * is intentionally tiny so a future server endpoint can slurp it directly
 * (`POST /api/customer-notes/:conversationId`) without UI changes.
 *
 * Storage key includes the active shopId so a single admin running two
 * shops in the same browser sees independent notes for the same customer.
 * The legacy v1 keys (just conversationId) are migrated to the default
 * shop the first time they're read after upgrade.
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

/** Build the storage key. shopId is optional so call-sites without a shop
 *  in scope still work (they fall into a shared `_default_` bucket). */
function k(conversationId: string, shopId?: string | null): string {
  const sid = shopId || '_default_';
  return `${sid}::${conversationId}`;
}

/** Migrate legacy unscoped keys ('line:user:Uxxx') to the default-shop
 *  bucket so notes written before this change don't disappear. Runs the
 *  first time we read after upgrade, then becomes a no-op. */
function migrateLegacyOnce(store: Store): Store {
  let mutated = false;
  for (const key of Object.keys(store)) {
    if (key.includes('::')) continue; // already shop-scoped
    const next = k(key, null);
    if (!store[next]) {
      store[next] = store[key];
      delete store[key];
      mutated = true;
    }
  }
  if (mutated) writeAll(store);
  return store;
}

export function getCustomerMeta(conversationId: string, shopId?: string | null): CustomerMeta {
  const all = migrateLegacyOnce(readAll());
  const m = all[k(conversationId, shopId)];
  return m && Array.isArray(m.tags) && typeof m.note === 'string'
    ? { tags: m.tags, note: m.note, updatedAt: m.updatedAt || 0 }
    : { tags: [], note: '', updatedAt: 0 };
}

export function addTag(conversationId: string, tag: string, shopId?: string | null): CustomerMeta {
  const clean = tag.trim().slice(0, MAX_TAG_LEN);
  if (!clean) return getCustomerMeta(conversationId, shopId);
  const all = migrateLegacyOnce(readAll());
  const key = k(conversationId, shopId);
  const cur = all[key] || { tags: [], note: '', updatedAt: 0 };
  if (cur.tags.includes(clean)) return cur;
  const next: CustomerMeta = {
    tags: [...cur.tags, clean].slice(0, MAX_TAGS_PER_CUSTOMER),
    note: cur.note,
    updatedAt: Date.now(),
  };
  all[key] = next;
  writeAll(all);
  return next;
}

export function removeTag(conversationId: string, tag: string, shopId?: string | null): CustomerMeta {
  const all = migrateLegacyOnce(readAll());
  const key = k(conversationId, shopId);
  const cur = all[key];
  if (!cur) return { tags: [], note: '', updatedAt: 0 };
  const next: CustomerMeta = {
    tags: cur.tags.filter((x) => x !== tag),
    note: cur.note,
    updatedAt: Date.now(),
  };
  all[key] = next;
  writeAll(all);
  return next;
}

export function setNote(conversationId: string, note: string, shopId?: string | null): CustomerMeta {
  const clean = note.slice(0, MAX_NOTE_LEN);
  const all = migrateLegacyOnce(readAll());
  const key = k(conversationId, shopId);
  const cur = all[key] || { tags: [], note: '', updatedAt: 0 };
  const next: CustomerMeta = { tags: cur.tags, note: clean, updatedAt: Date.now() };
  all[key] = next;
  writeAll(all);
  return next;
}

export const TAG_MAX_LEN = MAX_TAG_LEN;
export const NOTE_MAX_LEN = MAX_NOTE_LEN;
