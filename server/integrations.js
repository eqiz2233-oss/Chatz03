// JSON-file storage for connected integrations.
//
// Schema (v2): {
//   pages: [
//     {
//       id: '<page-id>',
//       name: '...',
//       category: '...',
//       picture: '<url>',
//       pageAccessToken: '<long-lived-page-token>',
//       instagram: { id, username, name?, picture? } | null,
//       connectedAt: '<iso>',
//       connectedBy?: { name, id }   // reserved for multi-user
//     },
//     ...
//   ]
// }
//
// Backwards-compatible with v1 ({ fb: { pageAccessToken, page } }) — auto-migrates on read.
//
// Note: file lives at server/integrations.json. On Railway, the filesystem is ephemeral —
// switch to a real DB (or Railway Volumes) before going to multi-tenant production.

import { promises as fs, readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, 'integrations.json');

let cache = null;

function ensureDir() {
  if (!existsSync(__dirname)) mkdirSync(__dirname, { recursive: true });
}

function migrate(raw) {
  if (!raw || typeof raw !== 'object') return { pages: [] };
  if (Array.isArray(raw.pages)) return raw; // already v2
  // v1 → v2
  if (raw.fb && raw.fb.page && raw.fb.pageAccessToken) {
    return {
      pages: [
        {
          ...raw.fb.page,
          pageAccessToken: raw.fb.pageAccessToken,
        },
      ],
    };
  }
  return { pages: [] };
}

export function loadIntegrationsSync() {
  if (cache) return cache;
  try {
    if (!existsSync(FILE)) {
      cache = { pages: [] };
      return cache;
    }
    cache = migrate(JSON.parse(readFileSync(FILE, 'utf8')));
  } catch (e) {
    console.warn('integrations.json read failed:', e?.message || e);
    cache = { pages: [] };
  }
  return cache;
}

async function persist() {
  ensureDir();
  await fs.writeFile(FILE, JSON.stringify(cache, null, 2), 'utf8');
}

/** Add OR update a page (matched by id). Returns the stored page. */
export async function upsertPage(page) {
  const cur = loadIntegrationsSync();
  const i = cur.pages.findIndex((p) => p.id === page.id);
  const next = { ...cur.pages[i], ...page };
  if (i >= 0) cur.pages[i] = next;
  else cur.pages.push(next);
  await persist();
  return next;
}

/** Remove a page by id. Returns true if removed. */
export async function removePage(pageId) {
  const cur = loadIntegrationsSync();
  const before = cur.pages.length;
  cur.pages = cur.pages.filter((p) => p.id !== pageId);
  if (cur.pages.length === before) return false;
  await persist();
  return true;
}

/** Clear all connected Pages (used by Disconnect + Meta data-deletion). */
export async function clearAllPages() {
  const cur = loadIntegrationsSync();
  cur.pages.length = 0;
  await persist();
}

/** All connected pages. */
export function listPages() {
  return loadIntegrationsSync().pages;
}

/** Lookup helpers used by the webhook router and send route. */
export function findPageByPageId(pageId) {
  return listPages().find((p) => p.id === pageId) || null;
}
export function findPageByIgId(igId) {
  return listPages().find((p) => p.instagram?.id === igId) || null;
}
