// Lightweight JSON-file storage for connected integrations (FB Page tokens, etc).
// Kept out of .env so users don't have to edit files after OAuth.
import { promises as fs, readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, 'integrations.json');

let cache = null;

function ensureDir() {
  if (!existsSync(__dirname)) mkdirSync(__dirname, { recursive: true });
}

export function loadIntegrationsSync() {
  if (cache) return cache;
  try {
    if (!existsSync(FILE)) {
      cache = {};
      return cache;
    }
    cache = JSON.parse(readFileSync(FILE, 'utf8'));
  } catch (e) {
    console.warn('integrations.json read failed:', e?.message || e);
    cache = {};
  }
  return cache;
}

export async function saveIntegrations(next) {
  cache = next;
  ensureDir();
  await fs.writeFile(FILE, JSON.stringify(next, null, 2), 'utf8');
}

export async function setFbIntegration(fb) {
  const cur = loadIntegrationsSync();
  cur.fb = fb;
  await saveIntegrations(cur);
}

export async function clearFbIntegration() {
  const cur = loadIntegrationsSync();
  delete cur.fb;
  await saveIntegrations(cur);
}
