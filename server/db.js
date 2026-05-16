// Lightweight persistence layer.
//
// Uses Postgres when DATABASE_URL is set (Railway Postgres plugin), otherwise
// falls back to a single JSON file on disk. Same API either way so the rest of
// the app doesn't care.
//
// Schema (created lazily on boot):
//   users(id, username, password_hash, role, display_name, created_at)
//   shops(id, slug, name, created_at)
//   shop_members(shop_id, user_id, role, joined_at)
//   products(id, shop_id, data_json, updated_at)              — `data` is full Product object
//   orders(id, shop_id, data_json, updated_at)
//   slip_actions(slip_id, shop_id, action, by_user, at)        — confirm | reject log
//   chat_events(id, shop_id, channel, conv_id, direction, at)  — for analytics counts
//   kv(key, value_json)                                — bot settings, brand voice etc.
//
// MULTI-TENANCY (Phase 1): every "shop-owned" table now carries `shop_id`.
// Existing single-tenant installs are auto-migrated on boot: a "default" shop
// is created, all existing users become its owners, and all existing rows are
// stamped with that shop_id. Reads still default to the user's active shop so
// nothing visibly changes for the current operator.

import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
export const hasPg = Boolean(DATABASE_URL);

/** Stable id for the auto-created shop used during migration from single-tenant. */
export const DEFAULT_SHOP_ID = 'shop_default';
const DEFAULT_SHOP_SLUG = 'default';
const DEFAULT_SHOP_NAME = 'ร้านของฉัน';

/** @type {import('pg').Pool|null} */
let pool = null;
if (hasPg) {
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
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

/** @type {{ users: any[]; shops: any[]; shopMembers: any[]; products: any[]; orders: any[]; slipActions: any[]; chatEvents: any[]; kv: Record<string, any> }} */
const memo = {
  users: [],
  shops: [],
  shopMembers: [],
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
    memo.shops = Array.isArray(raw?.shops) ? raw.shops : [];
    memo.shopMembers = Array.isArray(raw?.shopMembers) ? raw.shopMembers : [];
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
    await runMigrations();
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'owner',
      display_name TEXT,
      email TEXT,
      oauth_provider TEXT,
      oauth_sub TEXT,
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS shops (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS shop_members (
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'owner',
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (shop_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS shop_members_user_idx ON shop_members(user_id);
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

  // Phase 1 migration: add shop_id columns to existing shop-owned tables.
  await pool.query(`
    ALTER TABLE products     ADD COLUMN IF NOT EXISTS shop_id TEXT;
    ALTER TABLE orders       ADD COLUMN IF NOT EXISTS shop_id TEXT;
    ALTER TABLE slip_actions ADD COLUMN IF NOT EXISTS shop_id TEXT;
    ALTER TABLE chat_events  ADD COLUMN IF NOT EXISTS shop_id TEXT;
    CREATE INDEX IF NOT EXISTS products_shop_idx     ON products(shop_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS orders_shop_idx       ON orders(shop_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS slip_actions_shop_idx ON slip_actions(shop_id);
    CREATE INDEX IF NOT EXISTS chat_events_shop_idx  ON chat_events(shop_id, at DESC);
  `);

  // Phase 2 migration: OAuth + email fields on users.
  // password_hash is now nullable (OAuth users don't have a password).
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_sub TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
    ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS users_oauth_unique_idx
      ON users(oauth_provider, oauth_sub)
      WHERE oauth_provider IS NOT NULL AND oauth_sub IS NOT NULL;
    CREATE INDEX IF NOT EXISTS users_email_idx
      ON users(email)
      WHERE email IS NOT NULL;
  `);

  await runMigrations();
}

/** Auto-create the "default" shop and backfill all unscoped rows + memberships. */
async function runMigrations() {
  // 1. Ensure default shop exists.
  if (pool) {
    await pool.query(
      `INSERT INTO shops (id, slug, name) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
      [DEFAULT_SHOP_ID, DEFAULT_SHOP_SLUG, DEFAULT_SHOP_NAME],
    );
  } else if (!memo.shops.find((s) => s.id === DEFAULT_SHOP_ID)) {
    memo.shops.push({
      id: DEFAULT_SHOP_ID,
      slug: DEFAULT_SHOP_SLUG,
      name: DEFAULT_SHOP_NAME,
      created_at: new Date().toISOString(),
    });
    scheduleJsonSave();
  }

  // 2. Backfill all existing users → member of default shop with their current role.
  if (pool) {
    await pool.query(
      `INSERT INTO shop_members (shop_id, user_id, role)
         SELECT $1, u.id, u.role FROM users u
         ON CONFLICT (shop_id, user_id) DO NOTHING`,
      [DEFAULT_SHOP_ID],
    );
  } else {
    for (const u of memo.users) {
      if (!memo.shopMembers.find((m) => m.shop_id === DEFAULT_SHOP_ID && m.user_id === u.id)) {
        memo.shopMembers.push({
          shop_id: DEFAULT_SHOP_ID,
          user_id: u.id,
          role: u.role || 'owner',
          joined_at: new Date().toISOString(),
        });
      }
    }
    scheduleJsonSave();
  }

  // 3. Backfill `shop_id = default` on every legacy row.
  if (pool) {
    await pool.query(`UPDATE products     SET shop_id=$1 WHERE shop_id IS NULL`, [DEFAULT_SHOP_ID]);
    await pool.query(`UPDATE orders       SET shop_id=$1 WHERE shop_id IS NULL`, [DEFAULT_SHOP_ID]);
    await pool.query(`UPDATE slip_actions SET shop_id=$1 WHERE shop_id IS NULL`, [DEFAULT_SHOP_ID]);
    await pool.query(`UPDATE chat_events  SET shop_id=$1 WHERE shop_id IS NULL`, [DEFAULT_SHOP_ID]);
  } else {
    let dirty = false;
    for (const p of memo.products)    { if (!p.shopId) { p.shopId = DEFAULT_SHOP_ID; dirty = true; } }
    for (const o of memo.orders)      { if (!o.shopId) { o.shopId = DEFAULT_SHOP_ID; dirty = true; } }
    for (const s of memo.slipActions) { if (!s.shopId) { s.shopId = DEFAULT_SHOP_ID; dirty = true; } }
    for (const e of memo.chatEvents)  { if (!e.shopId) { e.shopId = DEFAULT_SHOP_ID; dirty = true; } }
    if (dirty) scheduleJsonSave();
  }
}

// --------------------------------------------------------------------------
// SHOPS + MEMBERSHIP
// --------------------------------------------------------------------------

export async function listShops() {
  if (pool) {
    const { rows } = await pool.query('SELECT id, slug, name, created_at FROM shops ORDER BY created_at ASC');
    return rows;
  }
  return [...memo.shops].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

export async function findShopById(id) {
  if (!id) return null;
  if (pool) {
    const { rows } = await pool.query('SELECT id, slug, name, created_at FROM shops WHERE id=$1', [id]);
    return rows[0] || null;
  }
  return memo.shops.find((s) => s.id === id) || null;
}

/** Returns shops the user is a member of, with their role on each. */
export async function listShopsForUser(userId) {
  if (!userId) return [];
  if (pool) {
    const { rows } = await pool.query(
      `SELECT s.id, s.slug, s.name, s.created_at, m.role
         FROM shops s
         JOIN shop_members m ON m.shop_id = s.id
        WHERE m.user_id = $1
        ORDER BY s.created_at ASC`,
      [userId],
    );
    return rows;
  }
  const memberships = memo.shopMembers.filter((m) => m.user_id === userId);
  return memberships
    .map((m) => {
      const s = memo.shops.find((x) => x.id === m.shop_id);
      return s ? { ...s, role: m.role } : null;
    })
    .filter(Boolean);
}

export async function createShop({ id, slug, name, ownerId }) {
  if (!id || !slug || !name) throw new Error('createShop requires id, slug, name');
  const row = { id, slug, name, created_at: new Date().toISOString() };
  if (pool) {
    await pool.query(
      'INSERT INTO shops (id, slug, name) VALUES ($1, $2, $3)',
      [id, slug, name],
    );
    if (ownerId) {
      await pool.query(
        `INSERT INTO shop_members (shop_id, user_id, role) VALUES ($1, $2, 'owner')
           ON CONFLICT (shop_id, user_id) DO NOTHING`,
        [id, ownerId],
      );
    }
  } else {
    memo.shops.push(row);
    if (ownerId) {
      memo.shopMembers.push({
        shop_id: id,
        user_id: ownerId,
        role: 'owner',
        joined_at: row.created_at,
      });
    }
    scheduleJsonSave();
  }
  return row;
}

export async function addShopMember({ shopId, userId, role = 'staff' }) {
  if (!shopId || !userId) throw new Error('addShopMember requires shopId, userId');
  if (pool) {
    await pool.query(
      `INSERT INTO shop_members (shop_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (shop_id, user_id) DO UPDATE SET role=$3`,
      [shopId, userId, role],
    );
  } else {
    const existing = memo.shopMembers.find((m) => m.shop_id === shopId && m.user_id === userId);
    if (existing) existing.role = role;
    else memo.shopMembers.push({ shop_id: shopId, user_id: userId, role, joined_at: new Date().toISOString() });
    scheduleJsonSave();
  }
}

export async function isShopMember(shopId, userId) {
  if (!shopId || !userId) return false;
  if (pool) {
    const { rows } = await pool.query(
      'SELECT 1 FROM shop_members WHERE shop_id=$1 AND user_id=$2 LIMIT 1',
      [shopId, userId],
    );
    return rows.length > 0;
  }
  return memo.shopMembers.some((m) => m.shop_id === shopId && m.user_id === userId);
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

export async function createUser({
  id,
  username,
  passwordHash = null,
  role = 'owner',
  displayName = null,
  email = null,
  oauthProvider = null,
  oauthSub = null,
  avatarUrl = null,
}) {
  const u = String(username || '').trim().toLowerCase();
  const e = email ? String(email).trim().toLowerCase() : null;
  const row = {
    id,
    username: u,
    password_hash: passwordHash,
    role,
    display_name: displayName,
    email: e,
    oauth_provider: oauthProvider,
    oauth_sub: oauthSub,
    avatar_url: avatarUrl,
    created_at: new Date().toISOString(),
  };
  if (pool) {
    await pool.query(
      `INSERT INTO users (id, username, password_hash, role, display_name, email, oauth_provider, oauth_sub, avatar_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, u, passwordHash, role, displayName, e, oauthProvider, oauthSub, avatarUrl],
    );
  } else {
    memo.users.push(row);
    scheduleJsonSave();
  }
  return row;
}

export async function findUserByEmail(email) {
  const e = email ? String(email).trim().toLowerCase() : '';
  if (!e) return null;
  if (pool) {
    const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(email)=$1 LIMIT 1', [e]);
    return rows[0] || null;
  }
  return memo.users.find((x) => (x.email || '').toLowerCase() === e) || null;
}

export async function findUserByOauth(provider, sub) {
  if (!provider || !sub) return null;
  if (pool) {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE oauth_provider=$1 AND oauth_sub=$2 LIMIT 1',
      [provider, String(sub)],
    );
    return rows[0] || null;
  }
  return memo.users.find((x) => x.oauth_provider === provider && String(x.oauth_sub) === String(sub)) || null;
}

/** Attach OAuth identity to an existing password user (e.g. linking Google to an existing account). */
export async function linkOauthToUser(userId, { oauthProvider, oauthSub, email = null, avatarUrl = null }) {
  if (!userId || !oauthProvider || !oauthSub) return null;
  if (pool) {
    await pool.query(
      `UPDATE users
         SET oauth_provider=$1, oauth_sub=$2,
             email=COALESCE($3, email),
             avatar_url=COALESCE($4, avatar_url)
       WHERE id=$5`,
      [oauthProvider, String(oauthSub), email, avatarUrl, userId],
    );
    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1 LIMIT 1', [userId]);
    return rows[0] || null;
  }
  const u = memo.users.find((x) => x.id === userId);
  if (!u) return null;
  u.oauth_provider = oauthProvider;
  u.oauth_sub = String(oauthSub);
  if (email && !u.email) u.email = email;
  if (avatarUrl && !u.avatar_url) u.avatar_url = avatarUrl;
  scheduleJsonSave();
  return u;
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
// PRODUCTS  (shop-scoped — defaults to DEFAULT_SHOP_ID for backward compat)
// --------------------------------------------------------------------------

export async function listProducts(shopId = DEFAULT_SHOP_ID) {
  if (pool) {
    const { rows } = await pool.query(
      'SELECT data FROM products WHERE shop_id=$1 ORDER BY updated_at DESC LIMIT 500',
      [shopId],
    );
    return rows.map((r) => r.data);
  }
  return memo.products
    .filter((p) => (p.shopId || DEFAULT_SHOP_ID) === shopId)
    .sort((a, b) => String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')));
}

export async function upsertProduct(product, shopId = DEFAULT_SHOP_ID) {
  if (!product?.id) throw new Error('product.id required');
  const data = { ...product, updatedAt: new Date().toISOString() };
  if (pool) {
    await pool.query(
      `INSERT INTO products (id, shop_id, data, updated_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET shop_id=$2, data=$3, updated_at=NOW()`,
      [data.id, shopId, data],
    );
  } else {
    const tagged = { ...data, shopId };
    const i = memo.products.findIndex((p) => p.id === data.id);
    if (i >= 0) memo.products[i] = tagged;
    else memo.products.push(tagged);
    scheduleJsonSave();
  }
  return data;
}

export async function deleteProduct(id, shopId = DEFAULT_SHOP_ID) {
  if (pool) {
    await pool.query('DELETE FROM products WHERE id=$1 AND shop_id=$2', [id, shopId]);
  } else {
    memo.products = memo.products.filter(
      (p) => !(p.id === id && (p.shopId || DEFAULT_SHOP_ID) === shopId),
    );
    scheduleJsonSave();
  }
}

// --------------------------------------------------------------------------
// ORDERS  (shop-scoped)
// --------------------------------------------------------------------------

export async function listOrders(shopId = DEFAULT_SHOP_ID) {
  if (pool) {
    const { rows } = await pool.query(
      'SELECT data FROM orders WHERE shop_id=$1 ORDER BY updated_at DESC LIMIT 1000',
      [shopId],
    );
    return rows.map((r) => r.data);
  }
  return memo.orders
    .filter((o) => (o.shopId || DEFAULT_SHOP_ID) === shopId)
    .sort((a, b) => String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')));
}

export async function upsertOrder(order, shopId = DEFAULT_SHOP_ID) {
  if (!order?.id) throw new Error('order.id required');
  const data = { ...order, updatedAt: new Date().toISOString() };
  if (pool) {
    await pool.query(
      `INSERT INTO orders (id, shop_id, data, updated_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET shop_id=$2, data=$3, updated_at=NOW()`,
      [data.id, shopId, data],
    );
  } else {
    const tagged = { ...data, shopId };
    const i = memo.orders.findIndex((o) => o.id === data.id);
    if (i >= 0) memo.orders[i] = tagged;
    else memo.orders.push(tagged);
    scheduleJsonSave();
  }
  return data;
}

export async function deleteOrder(id, shopId = DEFAULT_SHOP_ID) {
  if (pool) {
    await pool.query('DELETE FROM orders WHERE id=$1 AND shop_id=$2', [id, shopId]);
  } else {
    memo.orders = memo.orders.filter(
      (o) => !(o.id === id && (o.shopId || DEFAULT_SHOP_ID) === shopId),
    );
    scheduleJsonSave();
  }
}

// --------------------------------------------------------------------------
// SLIP ACTIONS (confirm/reject log) — shop-scoped
// --------------------------------------------------------------------------

export async function recordSlipAction({ slipId, action, byUser, shopId = DEFAULT_SHOP_ID }) {
  const at = new Date().toISOString();
  if (pool) {
    await pool.query(
      'INSERT INTO slip_actions (slip_id, shop_id, action, by_user, at) VALUES ($1,$2,$3,$4,$5)',
      [slipId, shopId, action, byUser || null, at],
    );
  } else {
    memo.slipActions.push({ slipId, shopId, action, byUser: byUser || null, at });
    scheduleJsonSave();
  }
  return { slipId, shopId, action, byUser: byUser || null, at };
}

export async function lastSlipAction(slipId, shopId = DEFAULT_SHOP_ID) {
  if (pool) {
    const { rows } = await pool.query(
      'SELECT * FROM slip_actions WHERE slip_id=$1 AND shop_id=$2 ORDER BY at DESC LIMIT 1',
      [slipId, shopId],
    );
    return rows[0] || null;
  }
  const all = memo.slipActions.filter(
    (a) => a.slipId === slipId && (a.shopId || DEFAULT_SHOP_ID) === shopId,
  );
  return all.length ? all[all.length - 1] : null;
}

export async function listSlipActionsBySlipIds(slipIds, shopId = DEFAULT_SHOP_ID) {
  if (!slipIds?.length) return new Map();
  if (pool) {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (slip_id) slip_id, action, by_user, at
       FROM slip_actions
       WHERE slip_id = ANY($1::text[]) AND shop_id = $2
       ORDER BY slip_id, at DESC`,
      [slipIds, shopId],
    );
    const m = new Map();
    for (const r of rows) m.set(r.slip_id, r);
    return m;
  }
  const m = new Map();
  for (const id of slipIds) {
    const last = await lastSlipAction(id, shopId);
    if (last) m.set(id, last);
  }
  return m;
}

// --------------------------------------------------------------------------
// CHAT EVENTS (analytics) — shop-scoped
// --------------------------------------------------------------------------

export async function logChatEvent({ channel, convId, direction, shopId = DEFAULT_SHOP_ID }) {
  const at = new Date().toISOString();
  if (pool) {
    await pool.query(
      'INSERT INTO chat_events (channel, conv_id, direction, at, shop_id) VALUES ($1,$2,$3,$4,$5)',
      [channel, convId, direction, at, shopId],
    );
  } else {
    memo.chatEvents.push({ channel, convId, direction, at, shopId });
    scheduleJsonSave();
  }
}

/** Returns counts of events grouped by day for the last `days` days, for one shop. */
export async function chatEventsByDay(days = 30, shopId = DEFAULT_SHOP_ID) {
  const since = new Date(Date.now() - days * 86400_000);
  if (pool) {
    const { rows } = await pool.query(
      `SELECT to_char(at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS day,
              channel, direction, COUNT(*)::int AS n
         FROM chat_events
        WHERE at >= $1 AND shop_id = $2
        GROUP BY day, channel, direction
        ORDER BY day ASC`,
      [since.toISOString(), shopId],
    );
    return rows;
  }
  const out = new Map();
  for (const e of memo.chatEvents) {
    if (new Date(e.at) < since) continue;
    if ((e.shopId || DEFAULT_SHOP_ID) !== shopId) continue;
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
// KV (bot settings, brand voice, payment info, integrations)
//
// Keys can be globally scoped (just a string) or shop-scoped via
// kvGetShop/kvSetShop, which prefix the key with `s:<shopId>:`. The plain
// kvGet/kvSet remain for backward compatibility with the few legacy global
// keys (bot.* etc.) that Phase 2 will fully scope.
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
    if (value === null || value === undefined) {
      await pool.query('DELETE FROM kv WHERE key=$1', [key]);
      return;
    }
    await pool.query(
      `INSERT INTO kv (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value=$2::jsonb, updated_at=NOW()`,
      [key, JSON.stringify(value)],
    );
  } else {
    if (value === null || value === undefined) {
      delete memo.kv[key];
    } else {
      memo.kv[key] = value;
    }
    scheduleJsonSave();
  }
}

function shopKey(shopId, key) {
  return `s:${shopId || DEFAULT_SHOP_ID}:${key}`;
}

export async function kvGetShop(shopId, key, fallback = null) {
  return kvGet(shopKey(shopId, key), fallback);
}

export async function kvSetShop(shopId, key, value) {
  return kvSet(shopKey(shopId, key), value);
}

// --------------------------------------------------------------------------
// Bootstrap: ensure at least one owner user exists, seeded from env if needed.
// --------------------------------------------------------------------------

export async function ensureSeedOwner({ hash, defaultUsername = 'admin' }) {
  const existing = await countUsers();
  if (existing > 0) return null;
  const username = (process.env.OWNER_USERNAME || defaultUsername).trim().toLowerCase();
  const user = await createUser({
    id: 'usr_' + Math.random().toString(36).slice(2, 10),
    username,
    passwordHash: hash,
    role: 'owner',
    displayName: process.env.OWNER_NAME || 'Owner',
  });
  // Seed owner is automatically a member of the default shop.
  await addShopMember({ shopId: DEFAULT_SHOP_ID, userId: user.id, role: 'owner' });
  return user;
}
