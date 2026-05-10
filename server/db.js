// Lightweight persistence layer.
//
// Uses Postgres when DATABASE_URL is set (Railway Postgres plugin), otherwise
// falls back to a single JSON file on disk. Same API either way so the rest of
// the app doesn't care.
//
// Schema (created lazily on boot):
//   users(id, username, password_hash, role, created_at)
//   products(id, data_json, updated_at)              — `data` is full Product object
//   orders(id, data_json, updated_at)
//   slip_actions(slip_id, action, by_user, at)        — confirm | reject log
//   chat_events(id, channel, conv_id, direction, at)  — for analytics counts
//   kv(key, value_json)                                — bot settings, brand voice etc.

import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
export const hasPg = Boolean(DATABASE_URL);

/** @type {import('pg').Pool|null} */
let pool = null;
if (hasPg) {
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    // Railway / Heroku-style Postgres requires SSL but no custom CA
    ssl: /sslmode=require/i.test(DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });
  pool.on('error', (e) => console.error('[pg] pool error:', e?.message || e));
}

// --------------------------------------------------------------------------
// JSON fallback store
// --------------------------------------------------------------------------

const STORE_DIR =
  (process.env.RAILWAY_VOLUME_MOUNT_PATH || '').trim() || __dirname;
const STORE_FILE = path.join(STORE_DIR, 'app-store.json');

/** @type {{ users: any[]; products: any[]; orders: any[]; slipActions: any[]; chatEvents: any[]; kv: Record<string, any> }} */
const memo = {
  users: [],
  products: [],
  orders: [],
  slipActions: [],
  chatEvents: [],
  kv: {},
};

function ensureDir() {
  if (!existsSync(STORE_DIR)) {
    try { mkdirSync(STORE_DIR, { recursive: true }); } catch {}
  }
}

function loadJsonSync() {
  ensureDir();
  if (!existsSync(STORE_FILE)) return;
  try {
    const raw = JSON.parse(readFileSync(STORE_FILE, 'utf8'));
    memo.users = Array.isArray(raw?.users) ? raw.users : [];
    memo.products = Array.isArray(raw?.products) ? raw.products : [];
    memo.orders = Array.isArray(raw?.orders) ? raw.orders : [];
    memo.slipActions = Array.isArray(raw?.slipActions) ? raw.slipActions : [];
    memo.chatEvents = Array.isArray(raw?.chatEvents) ? raw.chatEvents : [];
    memo.kv = raw?.kv && typeof raw.kv === 'object' ? raw.kv : {};
  } catch (e) {
    console.warn('[db] load json store failed:', e?.message || e);
  }
}

let saveTimer = null;
function scheduleJsonSave() {
  if (hasPg) return;
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      ensureDir();
      // Trim chat_events to last 5000 to bound disk size.
      if (memo.chatEvents.length > 5000) {
        memo.chatEvents = memo.chatEvents.slice(-5000);
      }
      await writeFile(STORE_FILE, JSON.stringify(memo, null, 2));
    } catch (e) {
      console.warn('[db] save json store failed:', e?.message || e);
    }
  }, 500);
}

// --------------------------------------------------------------------------
// Init + schema
// --------------------------------------------------------------------------

export async function initDb() {
  if (!pool) {
    loadJsonSync();
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner',
      display_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS slip_actions (
      slip_id TEXT NOT NULL,
      action TEXT NOT NULL,
      by_user TEXT,
      at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (slip_id, at)
    );
    CREATE TABLE IF NOT EXISTS chat_events (
      id BIGSERIAL PRIMARY KEY,
      channel TEXT NOT NULL,
      conv_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS chat_events_at_idx ON chat_events(at DESC);
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

// --------------------------------------------------------------------------
// USERS
// --------------------------------------------------------------------------

export async function findUserByUsername(username) {
  const u = String(username || '').trim().toLowerCase();
  if (!u) return null;
  if (pool) {
    const { rows } = await pool.query('SELECT * FROM users WHERE username=$1 LIMIT 1', [u]);
    return rows[0] || null;
  }
  return memo.users.find((x) => x.username === u) || null;
}

export async function findUserById(id) {
  if (!id) return null;
  if (pool) {
    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1 LIMIT 1', [id]);
    return rows[0] || null;
  }
  return memo.users.find((x) => x.id === id) || null;
}

export async function createUser({ id, username, passwordHash, role = 'owner', displayName = null }) {
  const u = String(username || '').trim().toLowerCase();
  const row = {
    id,
    username: u,
    password_hash: passwordHash,
    role,
    display_name: displayName,
    created_at: new Date().toISOString(),
  };
  if (pool) {
    await pool.query(
      'INSERT INTO users (id, username, password_hash, role, display_name) VALUES ($1,$2,$3,$4,$5)',
      [id, u, passwordHash, role, displayName],
    );
  } else {
    memo.users.push(row);
    scheduleJsonSave();
  }
  return row;
}

export async function updateUserPasswordHash(userId, passwordHash) {
  if (pool) {
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [passwordHash, userId]);
  } else {
    const u = memo.users.find((x) => x.id === userId);
    if (u) {
      u.password_hash = passwordHash;
      scheduleJsonSave();
    }
  }
}

export async function countUsers() {
  if (pool) {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
    return rows[0]?.n || 0;
  }
  return memo.users.length;
}

// --------------------------------------------------------------------------
// PRODUCTS
// --------------------------------------------------------------------------

export async function listProducts() {
  if (pool) {
    const { rows } = await pool.query('SELECT data FROM products ORDER BY updated_at DESC LIMIT 500');
    return rows.map((r) => r.data);
  }
  return [...memo.products].sort((a, b) =>
    String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')),
  );
}

export async function upsertProduct(product) {
  if (!product?.id) throw new Error('product.id required');
  const data = { ...product, updatedAt: new Date().toISOString() };
  if (pool) {
    await pool.query(
      `INSERT INTO products (id, data, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET data=$2, updated_at=NOW()`,
      [data.id, data],
    );
  } else {
    const i = memo.products.findIndex((p) => p.id === data.id);
    if (i >= 0) memo.products[i] = data;
    else memo.products.push(data);
    scheduleJsonSave();
  }
  return data;
}

export async function deleteProduct(id) {
  if (pool) {
    await pool.query('DELETE FROM products WHERE id=$1', [id]);
  } else {
    memo.products = memo.products.filter((p) => p.id !== id);
    scheduleJsonSave();
  }
}

// --------------------------------------------------------------------------
// ORDERS
// --------------------------------------------------------------------------

export async function listOrders() {
  if (pool) {
    const { rows } = await pool.query('SELECT data FROM orders ORDER BY updated_at DESC LIMIT 1000');
    return rows.map((r) => r.data);
  }
  return [...memo.orders].sort((a, b) =>
    String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')),
  );
}

export async function upsertOrder(order) {
  if (!order?.id) throw new Error('order.id required');
  const data = { ...order, updatedAt: new Date().toISOString() };
  if (pool) {
    await pool.query(
      `INSERT INTO orders (id, data, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET data=$2, updated_at=NOW()`,
      [data.id, data],
    );
  } else {
    const i = memo.orders.findIndex((o) => o.id === data.id);
    if (i >= 0) memo.orders[i] = data;
    else memo.orders.push(data);
    scheduleJsonSave();
  }
  return data;
}

export async function deleteOrder(id) {
  if (pool) {
    await pool.query('DELETE FROM orders WHERE id=$1', [id]);
  } else {
    memo.orders = memo.orders.filter((o) => o.id !== id);
    scheduleJsonSave();
  }
}

// --------------------------------------------------------------------------
// SLIP ACTIONS (confirm/reject log)
// --------------------------------------------------------------------------

export async function recordSlipAction({ slipId, action, byUser }) {
  const at = new Date().toISOString();
  if (pool) {
    await pool.query(
      'INSERT INTO slip_actions (slip_id, action, by_user, at) VALUES ($1,$2,$3,$4)',
      [slipId, action, byUser || null, at],
    );
  } else {
    memo.slipActions.push({ slipId, action, byUser: byUser || null, at });
    scheduleJsonSave();
  }
  return { slipId, action, byUser: byUser || null, at };
}

export async function lastSlipAction(slipId) {
  if (pool) {
    const { rows } = await pool.query(
      'SELECT * FROM slip_actions WHERE slip_id=$1 ORDER BY at DESC LIMIT 1',
      [slipId],
    );
    return rows[0] || null;
  }
  const all = memo.slipActions.filter((a) => a.slipId === slipId);
  return all.length ? all[all.length - 1] : null;
}

export async function listSlipActionsBySlipIds(slipIds) {
  if (!slipIds?.length) return new Map();
  if (pool) {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (slip_id) slip_id, action, by_user, at
       FROM slip_actions WHERE slip_id = ANY($1::text[])
       ORDER BY slip_id, at DESC`,
      [slipIds],
    );
    const m = new Map();
    for (const r of rows) m.set(r.slip_id, r);
    return m;
  }
  const m = new Map();
  for (const id of slipIds) {
    const last = await lastSlipAction(id);
    if (last) m.set(id, last);
  }
  return m;
}

// --------------------------------------------------------------------------
// CHAT EVENTS (analytics)
// --------------------------------------------------------------------------

export async function logChatEvent({ channel, convId, direction }) {
  const at = new Date().toISOString();
  if (pool) {
    await pool.query(
      'INSERT INTO chat_events (channel, conv_id, direction, at) VALUES ($1,$2,$3,$4)',
      [channel, convId, direction, at],
    );
  } else {
    memo.chatEvents.push({ channel, convId, direction, at });
    scheduleJsonSave();
  }
}

/** Returns counts of events grouped by day for the last `days` days. */
export async function chatEventsByDay(days = 30) {
  const since = new Date(Date.now() - days * 86400_000);
  if (pool) {
    const { rows } = await pool.query(
      `SELECT to_char(at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS day,
              channel, direction, COUNT(*)::int AS n
         FROM chat_events
        WHERE at >= $1
        GROUP BY day, channel, direction
        ORDER BY day ASC`,
      [since.toISOString()],
    );
    return rows;
  }
  const out = new Map();
  for (const e of memo.chatEvents) {
    if (new Date(e.at) < since) continue;
    const day = new Date(e.at).toISOString().slice(0, 10);
    const key = `${day}|${e.channel}|${e.direction}`;
    out.set(key, (out.get(key) || 0) + 1);
  }
  return [...out.entries()].map(([k, n]) => {
    const [day, channel, direction] = k.split('|');
    return { day, channel, direction, n };
  });
}

// --------------------------------------------------------------------------
// KV (bot settings, brand voice, payment info)
// --------------------------------------------------------------------------

export async function kvGet(key, fallback = null) {
  if (pool) {
    const { rows } = await pool.query('SELECT value FROM kv WHERE key=$1', [key]);
    return rows[0]?.value ?? fallback;
  }
  return memo.kv[key] ?? fallback;
}

export async function kvSet(key, value) {
  if (pool) {
    await pool.query(
      `INSERT INTO kv (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value=$2::jsonb, updated_at=NOW()`,
      [key, JSON.stringify(value)],
    );
  } else {
    memo.kv[key] = value;
    scheduleJsonSave();
  }
}

// --------------------------------------------------------------------------
// Bootstrap: ensure at least one owner user exists, seeded from env if needed.
// --------------------------------------------------------------------------

export async function ensureSeedOwner({ hash, defaultUsername = 'admin' }) {
  // Caller passes a pre-computed bcrypt hash so we don't import bcryptjs here.
  const existing = await countUsers();
  if (existing > 0) return null;
  const username = (process.env.OWNER_USERNAME || defaultUsername).trim().toLowerCase();
  return await createUser({
    id: 'usr_' + Math.random().toString(36).slice(2, 10),
    username,
    passwordHash: hash,
    role: 'owner',
    displayName: process.env.OWNER_NAME || 'Owner',
  });
}
