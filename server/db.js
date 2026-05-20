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
  /** Every verifySlipBytes() call — webhook auto-verify + manual /api/slips/verify.
   *  Persistent audit trail so payment disputes can be reconstructed even after
   *  the in-memory `slipsById` cap (500) evicts the record. */
  slipVerifications: [],
  /** One row per (provider, sub) identity. A single user can have multiple
   *  rows (e.g. Google + LINE both linked to the same Chatz account).
   *  See db helpers findUserIdByOauthIdentity / addOauthIdentity below. */
  userOauthIdentities: [],
  /** 24-hour single-use email-verification tokens. */
  emailVerificationTokens: [],
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
    memo.shopInvites = Array.isArray(raw?.shopInvites) ? raw.shopInvites : [];
    memo.passwordResetTokens = Array.isArray(raw?.passwordResetTokens) ? raw.passwordResetTokens : [];
    memo.products = Array.isArray(raw?.products) ? raw.products : [];
    memo.orders = Array.isArray(raw?.orders) ? raw.orders : [];
    memo.slipActions = Array.isArray(raw?.slipActions) ? raw.slipActions : [];
    memo.slipVerifications = Array.isArray(raw?.slipVerifications) ? raw.slipVerifications : [];
    memo.userOauthIdentities = Array.isArray(raw?.userOauthIdentities) ? raw.userOauthIdentities : [];
    memo.emailVerificationTokens = Array.isArray(raw?.emailVerificationTokens) ? raw.emailVerificationTokens : [];
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
    -- Persistent slip-verification audit log. Every call to verifySlipBytes
    -- writes one row regardless of outcome, so we can reconstruct any payment
    -- dispute even after the in-memory slip ring has rolled.
    CREATE TABLE IF NOT EXISTS slip_verifications (
      id BIGSERIAL PRIMARY KEY,
      shop_id TEXT NOT NULL DEFAULT 'shop_default',
      source TEXT NOT NULL,
      channel TEXT,
      conv_id TEXT,
      image_url TEXT,
      status TEXT NOT NULL,
      amount NUMERIC,
      bank TEXT,
      ref TEXT,
      sender_name TEXT,
      receiver_name TEXT,
      reason TEXT,
      by_user TEXT,
      at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS slip_verifications_shop_idx ON slip_verifications(shop_id, at DESC);
    CREATE INDEX IF NOT EXISTS slip_verifications_ref_idx  ON slip_verifications(shop_id, ref) WHERE ref IS NOT NULL;
    -- Multi-OAuth identity table. A Chatz user can sign in via password
    -- AND multiple OAuth providers (Google + LINE + Facebook) simultane-
    -- ously. The legacy users.oauth_provider/oauth_sub columns are kept
    -- in place for read fallback during the transition; new writes go
    -- here. PK (provider, sub) prevents the same Google identity from
    -- being attached to two Chatz accounts.
    CREATE TABLE IF NOT EXISTS user_oauth_identities (
      user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      sub      TEXT NOT NULL,
      linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (provider, sub),
      UNIQUE (user_id, provider)
    );
    CREATE INDEX IF NOT EXISTS user_oauth_identities_user_idx ON user_oauth_identities(user_id);
    -- Email verification — one outstanding token per user. The token is
    -- random and ~250 bits of entropy; we still expire it after 24h.
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      token      TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email      TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx ON email_verification_tokens(user_id);
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
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
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

  // 4. Backfill user_oauth_identities from the legacy single-provider
  //    columns on the users table. Existing OAuth-linked accounts must
  //    keep working after we switch the read path to the new table.
  if (pool) {
    await pool.query(
      `INSERT INTO user_oauth_identities (user_id, provider, sub)
         SELECT id, oauth_provider, oauth_sub FROM users
         WHERE oauth_provider IS NOT NULL AND oauth_sub IS NOT NULL
       ON CONFLICT (provider, sub) DO NOTHING`,
    );
  } else {
    let dirty = false;
    for (const u of memo.users) {
      if (!u.oauth_provider || !u.oauth_sub) continue;
      const exists = memo.userOauthIdentities.some(
        (i) => i.provider === u.oauth_provider && String(i.sub) === String(u.oauth_sub),
      );
      if (!exists) {
        memo.userOauthIdentities.push({
          user_id: u.id,
          provider: u.oauth_provider,
          sub: String(u.oauth_sub),
          linked_at: u.created_at || new Date().toISOString(),
        });
        dirty = true;
      }
    }
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

/** List every user on this shop, joined with their public profile fields. */
export async function listShopMembers(shopId) {
  if (!shopId) return [];
  if (pool) {
    const { rows } = await pool.query(
      `SELECT m.user_id, m.role, m.joined_at,
              u.username, u.display_name, u.email, u.avatar_url
         FROM shop_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.shop_id = $1
        ORDER BY m.joined_at ASC`,
      [shopId],
    );
    return rows.map((r) => ({
      id: r.user_id,
      username: r.username,
      displayName: r.display_name,
      email: r.email,
      avatarUrl: r.avatar_url,
      role: r.role,
      joinedAt: r.joined_at,
    }));
  }
  return memo.shopMembers
    .filter((m) => m.shop_id === shopId)
    .map((m) => {
      const u = memo.users.find((x) => x.id === m.user_id);
      return u
        ? {
            id: u.id,
            username: u.username,
            displayName: u.display_name,
            email: u.email,
            avatarUrl: u.avatar_url,
            role: m.role,
            joinedAt: m.joined_at,
          }
        : null;
    })
    .filter(Boolean);
}

/** Kick a user out of a shop. No-op if they weren't a member. */
export async function removeShopMember(shopId, userId) {
  if (!shopId || !userId) return false;
  if (pool) {
    const r = await pool.query(
      'DELETE FROM shop_members WHERE shop_id=$1 AND user_id=$2',
      [shopId, userId],
    );
    return r.rowCount > 0;
  }
  const before = memo.shopMembers.length;
  memo.shopMembers = memo.shopMembers.filter(
    (m) => !(m.shop_id === shopId && m.user_id === userId),
  );
  const removed = memo.shopMembers.length < before;
  if (removed) scheduleJsonSave();
  return removed;
}

// --------------------------------------------------------------------------
// SHOP INVITES — short-lived tokens an owner generates to bring a teammate
// into their shop without needing the teammate to already exist as a user.
//
// Lifecycle: create → share URL → recipient signs up / logs in → accept →
// row deleted. Tokens expire after 7 days; daily prune keeps the table tidy.
// --------------------------------------------------------------------------

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function ensureShopInvitesTable() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shop_invites (
      token TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'staff',
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS shop_invites_shop_idx ON shop_invites(shop_id);
  `);
}

export async function createShopInvite({ shopId, token, role = 'staff', createdBy = null }) {
  if (!shopId || !token) throw new Error('createShopInvite requires shopId + token');
  await ensureShopInvitesTable();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  if (pool) {
    await pool.query(
      `INSERT INTO shop_invites (token, shop_id, role, created_by, expires_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [token, shopId, role, createdBy, expiresAt],
    );
    return { token, shopId, role, createdBy, expiresAt };
  }
  memo.shopInvites = memo.shopInvites || [];
  const row = { token, shop_id: shopId, role, created_by: createdBy, created_at: new Date().toISOString(), expires_at: expiresAt };
  memo.shopInvites.push(row);
  scheduleJsonSave();
  return { token, shopId, role, createdBy, expiresAt };
}

export async function findShopInvite(token) {
  if (!token) return null;
  await ensureShopInvitesTable();
  if (pool) {
    const { rows } = await pool.query(
      `SELECT i.token, i.shop_id, i.role, i.created_by, i.expires_at,
              s.name AS shop_name
         FROM shop_invites i
         JOIN shops s ON s.id = i.shop_id
        WHERE i.token = $1 LIMIT 1`,
      [token],
    );
    const r = rows[0];
    if (!r) return null;
    if (new Date(r.expires_at).getTime() < Date.now()) return null;
    return { token: r.token, shopId: r.shop_id, role: r.role, createdBy: r.created_by, expiresAt: r.expires_at, shopName: r.shop_name };
  }
  const memoRow = (memo.shopInvites || []).find((x) => x.token === token);
  if (!memoRow) return null;
  if (new Date(memoRow.expires_at).getTime() < Date.now()) return null;
  const shop = memo.shops.find((s) => s.id === memoRow.shop_id);
  return {
    token: memoRow.token,
    shopId: memoRow.shop_id,
    role: memoRow.role,
    createdBy: memoRow.created_by,
    expiresAt: memoRow.expires_at,
    shopName: shop?.name || null,
  };
}

export async function consumeShopInvite(token) {
  if (!token) return false;
  await ensureShopInvitesTable();
  if (pool) {
    const r = await pool.query('DELETE FROM shop_invites WHERE token=$1', [token]);
    return r.rowCount > 0;
  }
  const before = (memo.shopInvites || []).length;
  memo.shopInvites = (memo.shopInvites || []).filter((x) => x.token !== token);
  const removed = memo.shopInvites.length < before;
  if (removed) scheduleJsonSave();
  return removed;
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

// --------------------------------------------------------------------------
// MULTI-OAUTH IDENTITIES  (user_oauth_identities table)
// --------------------------------------------------------------------------
//
// Each row is one identity (provider, sub) → user. A single user can have
// many rows (one per linked provider). PK on (provider, sub) prevents the
// same identity from being attached to two different Chatz accounts.

/**
 * Resolve an OAuth identity to a Chatz user_id.
 * Checks the new identity table first, then falls back to the legacy
 * users.oauth_provider/oauth_sub columns so existing accounts created
 * before this migration still log in. (The runMigrations backfill copies
 * legacy identities into the new table so the fallback only matters
 * during the boot window of the upgrade deploy.)
 */
export async function findUserIdByOauthIdentity(provider, sub) {
  if (!provider || !sub) return null;
  if (pool) {
    const { rows } = await pool.query(
      'SELECT user_id FROM user_oauth_identities WHERE provider=$1 AND sub=$2 LIMIT 1',
      [provider, String(sub)],
    );
    if (rows[0]?.user_id) return rows[0].user_id;
    // Legacy fallback.
    const legacy = await pool.query(
      'SELECT id FROM users WHERE oauth_provider=$1 AND oauth_sub=$2 LIMIT 1',
      [provider, String(sub)],
    );
    return legacy.rows[0]?.id || null;
  }
  const row = memo.userOauthIdentities.find(
    (i) => i.provider === provider && String(i.sub) === String(sub),
  );
  if (row?.user_id) return row.user_id;
  const legacy = memo.users.find(
    (u) => u.oauth_provider === provider && String(u.oauth_sub) === String(sub),
  );
  return legacy?.id || null;
}

/**
 * Link an OAuth identity to an existing Chatz user. Idempotent — calling
 * twice with the same (userId, provider, sub) is a no-op. Returns false
 * if the identity is already attached to a *different* user (collision).
 */
export async function addOauthIdentity(userId, provider, sub) {
  if (!userId || !provider || !sub) return false;
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO user_oauth_identities (user_id, provider, sub)
           VALUES ($1, $2, $3)
           ON CONFLICT (provider, sub) DO NOTHING`,
        [userId, provider, String(sub)],
      );
      // Verify the row now belongs to *this* user (not a stale collision
      // from a different user_id we just no-op'd over).
      const { rows } = await pool.query(
        'SELECT user_id FROM user_oauth_identities WHERE provider=$1 AND sub=$2',
        [provider, String(sub)],
      );
      return rows[0]?.user_id === userId;
    } catch (e) {
      console.warn('[db] addOauthIdentity failed:', e?.message || e);
      return false;
    }
  }
  const existing = memo.userOauthIdentities.find(
    (i) => i.provider === provider && String(i.sub) === String(sub),
  );
  if (existing) return existing.user_id === userId;
  memo.userOauthIdentities.push({
    user_id: userId,
    provider,
    sub: String(sub),
    linked_at: new Date().toISOString(),
  });
  scheduleJsonSave();
  return true;
}

/** List every OAuth identity (provider + linked_at) attached to a user. */
export async function listOauthIdentitiesForUser(userId) {
  if (!userId) return [];
  if (pool) {
    const { rows } = await pool.query(
      'SELECT provider, sub, linked_at FROM user_oauth_identities WHERE user_id=$1 ORDER BY linked_at',
      [userId],
    );
    return rows;
  }
  return memo.userOauthIdentities
    .filter((i) => i.user_id === userId)
    .map((i) => ({ provider: i.provider, sub: i.sub, linked_at: i.linked_at }))
    .sort((a, b) => String(a.linked_at).localeCompare(String(b.linked_at)));
}

/** Unlink an OAuth identity from a user (used by Settings → Linked accounts). */
export async function removeOauthIdentity(userId, provider) {
  if (!userId || !provider) return false;
  if (pool) {
    const r = await pool.query(
      'DELETE FROM user_oauth_identities WHERE user_id=$1 AND provider=$2',
      [userId, provider],
    );
    return (r.rowCount || 0) > 0;
  }
  const before = memo.userOauthIdentities.length;
  memo.userOauthIdentities = memo.userOauthIdentities.filter(
    (i) => !(i.user_id === userId && i.provider === provider),
  );
  const changed = memo.userOauthIdentities.length !== before;
  if (changed) scheduleJsonSave();
  return changed;
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

// --------------------------------------------------------------------------
// PASSWORD RESET TOKENS — short-lived (1 hour), one-time-use links that let
// a user prove email ownership in exchange for setting a new password.
// Pattern matches every big platform (Facebook, LINE, Google Workspace).
// --------------------------------------------------------------------------

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

async function ensurePasswordResetTable() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx
      ON password_reset_tokens(user_id);
  `);
}

export async function createPasswordResetToken(userId, token) {
  if (!userId || !token) return null;
  await ensurePasswordResetTable();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString();
  if (pool) {
    // Invalidate any prior unused tokens for this user — only one valid
    // link at a time, so a stolen older email can't be redeemed later.
    await pool.query(
      'DELETE FROM password_reset_tokens WHERE user_id=$1 AND used_at IS NULL',
      [userId],
    );
    await pool.query(
      'INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES ($1,$2,$3)',
      [token, userId, expiresAt],
    );
    return { token, userId, expiresAt };
  }
  memo.passwordResetTokens = (memo.passwordResetTokens || []).filter((t) => !(t.user_id === userId && !t.used_at));
  memo.passwordResetTokens.push({ token, user_id: userId, expires_at: expiresAt, used_at: null });
  scheduleJsonSave();
  return { token, userId, expiresAt };
}

/** Look up a token. Returns null when missing, expired, or already used. */
export async function findPasswordResetToken(token) {
  if (!token) return null;
  await ensurePasswordResetTable();
  if (pool) {
    const { rows } = await pool.query(
      'SELECT token, user_id, expires_at, used_at FROM password_reset_tokens WHERE token=$1 LIMIT 1',
      [token],
    );
    const r = rows[0];
    if (!r) return null;
    if (r.used_at) return null;
    if (new Date(r.expires_at).getTime() < Date.now()) return null;
    return { token: r.token, userId: r.user_id, expiresAt: r.expires_at };
  }
  const r = (memo.passwordResetTokens || []).find((x) => x.token === token);
  if (!r) return null;
  if (r.used_at) return null;
  if (new Date(r.expires_at).getTime() < Date.now()) return null;
  return { token: r.token, userId: r.user_id, expiresAt: r.expires_at };
}

/** Mark a reset token as consumed so it can't be redeemed twice. */
export async function consumePasswordResetToken(token) {
  if (!token) return false;
  await ensurePasswordResetTable();
  if (pool) {
    const r = await pool.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE token=$1 AND used_at IS NULL',
      [token],
    );
    return r.rowCount > 0;
  }
  const r = (memo.passwordResetTokens || []).find((x) => x.token === token && !x.used_at);
  if (!r) return false;
  r.used_at = new Date().toISOString();
  scheduleJsonSave();
  return true;
}

// --------------------------------------------------------------------------
// EMAIL VERIFICATION TOKENS
// --------------------------------------------------------------------------
//
// 24-hour single-use tokens that prove the user controls the email address
// on their account. Sent from Settings → Profile → "ส่งอีเมลยืนยัน". The
// click flow:
//
//   user types email at signup
//        ↓
//   logs in, uses Chatz immediately (no verification required)
//        ↓
//   Settings → "ส่งอีเมลยืนยัน" → server creates a token + emails it
//        ↓
//   user clicks /api/auth/email/verify/<token> in their inbox
//        ↓
//   server marks users.email_verified_at = NOW(), redirects to /settings

const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

/** Issue a single-use email-verification token. Replaces any prior token
 *  for the same (user, email) so the most recent "send" link is the only
 *  one that works. */
export async function createEmailVerificationToken(userId, token, email) {
  if (!userId || !token || !email) return null;
  const expiresAt = new Date(Date.now() + EMAIL_VERIFY_TTL_MS).toISOString();
  if (pool) {
    await pool.query(
      'DELETE FROM email_verification_tokens WHERE user_id=$1',
      [userId],
    );
    await pool.query(
      'INSERT INTO email_verification_tokens (token, user_id, email, expires_at) VALUES ($1,$2,$3,$4)',
      [token, userId, String(email).toLowerCase(), expiresAt],
    );
    return { token, userId, email, expiresAt };
  }
  memo.emailVerificationTokens = (memo.emailVerificationTokens || []).filter((t) => t.user_id !== userId);
  memo.emailVerificationTokens.push({
    token,
    user_id: userId,
    email: String(email).toLowerCase(),
    expires_at: expiresAt,
  });
  scheduleJsonSave();
  return { token, userId, email, expiresAt };
}

/** Look up a verification token. Returns null when missing or expired. */
export async function findEmailVerificationToken(token) {
  if (!token) return null;
  if (pool) {
    const { rows } = await pool.query(
      'SELECT token, user_id, email, expires_at FROM email_verification_tokens WHERE token=$1 LIMIT 1',
      [token],
    );
    const r = rows[0];
    if (!r) return null;
    if (new Date(r.expires_at).getTime() < Date.now()) return null;
    return { token: r.token, userId: r.user_id, email: r.email, expiresAt: r.expires_at };
  }
  const r = (memo.emailVerificationTokens || []).find((x) => x.token === token);
  if (!r) return null;
  if (new Date(r.expires_at).getTime() < Date.now()) return null;
  return { token: r.token, userId: r.user_id, email: r.email, expiresAt: r.expires_at };
}

/** One-shot: delete the token and stamp users.email_verified_at.
 *  Returns the consumed token *only if the user's current email still
 *  matches what the token was issued against*. If the user changed their
 *  email between "send link" and "click link", we want the caller to see
 *  null so the UI shows "ลิงก์หมดอายุ" instead of falsely saying
 *  "verified" when the email_verified_at column wasn't actually stamped. */
export async function consumeEmailVerificationToken(token) {
  const found = await findEmailVerificationToken(token);
  if (!found) return null;
  if (pool) {
    // Atomic delete first so two parallel callbacks can't both succeed.
    const del = await pool.query(
      'DELETE FROM email_verification_tokens WHERE token=$1',
      [token],
    );
    if (del.rowCount === 0) return null;
    // Only flip the verified flag if the email on the user record still
    // matches what we sent the token to. The UPDATE's rowCount tells us
    // whether the WHERE clause hit — 0 means the email changed and this
    // token is moot.
    const upd = await pool.query(
      `UPDATE users
          SET email_verified_at = NOW()
        WHERE id = $1 AND LOWER(COALESCE(email, '')) = $2`,
      [found.userId, found.email],
    );
    if (upd.rowCount === 0) return null;
    return found;
  }
  memo.emailVerificationTokens = (memo.emailVerificationTokens || []).filter((x) => x.token !== token);
  const u = memo.users.find((x) => x.id === found.userId);
  if (!u || (u.email || '').toLowerCase() !== found.email) {
    // Email diverged — token is moot. Token row is already deleted; the
    // user can request a fresh link from Settings.
    scheduleJsonSave();
    return null;
  }
  u.email_verified_at = new Date().toISOString();
  scheduleJsonSave();
  return found;
}

/** Has the user verified their current email address? */
export function isUserEmailVerified(user) {
  if (!user) return false;
  return Boolean(user.email && user.email_verified_at);
}

/** Partial-update the public profile fields a user can edit themselves.
 *  Changing the email address clears `email_verified_at` — the new
 *  address hasn't been confirmed yet, so the badge resets and the user
 *  has to send a fresh verification link. */
export async function updateUserProfile(userId, { displayName, email, avatarUrl } = {}) {
  if (!userId) return null;
  if (pool) {
    const newEmail = email !== undefined ? (email ? String(email).toLowerCase() : null) : undefined;
    if (newEmail !== undefined) {
      // Two-step so we know whether to clear verification status.
      await pool.query(
        `UPDATE users SET
           display_name = COALESCE($1, display_name),
           email        = $2,
           avatar_url   = COALESCE($3, avatar_url),
           email_verified_at = CASE
             WHEN LOWER(COALESCE(email, '')) = LOWER(COALESCE($2, ''))
               THEN email_verified_at
             ELSE NULL
           END
         WHERE id = $4`,
        [displayName ?? null, newEmail, avatarUrl ?? null, userId],
      );
    } else {
      await pool.query(
        `UPDATE users SET
           display_name = COALESCE($1, display_name),
           avatar_url   = COALESCE($2, avatar_url)
         WHERE id = $3`,
        [displayName ?? null, avatarUrl ?? null, userId],
      );
    }
    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1 LIMIT 1', [userId]);
    return rows[0] || null;
  }
  const u = memo.users.find((x) => x.id === userId);
  if (!u) return null;
  if (displayName !== undefined) u.display_name = displayName;
  if (email !== undefined) {
    const newE = email ? String(email).toLowerCase() : null;
    if (newE !== (u.email || null)) {
      // Email changed — invalidate any prior verification badge.
      u.email_verified_at = null;
    }
    u.email = newE;
  }
  if (avatarUrl !== undefined) u.avatar_url = avatarUrl;
  scheduleJsonSave();
  return u;
}

/**
 * Hard-delete a user and their direct rows (shop_members, sessions). Shop
 * data isn't cascaded — owner has to either transfer or hand over their
 * shops first. This function will refuse to delete users who are the
 * last owner of any shop, with a `last_owner_of` payload so the UI can
 * tell them which shop is blocking.
 */
export async function deleteUserAccount(userId) {
  if (!userId) return { ok: false, reason: 'no_user' };
  if (pool) {
    // Find shops where this user is the only owner.
    const blocked = await pool.query(
      `SELECT m.shop_id
         FROM shop_members m
        WHERE m.user_id = $1 AND m.role = 'owner'
          AND (SELECT COUNT(*) FROM shop_members m2
                WHERE m2.shop_id = m.shop_id AND m2.role = 'owner') = 1`,
      [userId],
    );
    if (blocked.rows.length > 0) {
      return { ok: false, reason: 'last_owner_of', shopIds: blocked.rows.map((r) => r.shop_id) };
    }
    await pool.query('DELETE FROM shop_members WHERE user_id=$1', [userId]);
    await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    return { ok: true };
  }
  // Memo path
  const ownedSolo = memo.shopMembers
    .filter((m) => m.user_id === userId && m.role === 'owner')
    .filter((m) =>
      memo.shopMembers.filter((x) => x.shop_id === m.shop_id && x.role === 'owner').length === 1,
    )
    .map((m) => m.shop_id);
  if (ownedSolo.length > 0) {
    return { ok: false, reason: 'last_owner_of', shopIds: ownedSolo };
  }
  memo.shopMembers = memo.shopMembers.filter((m) => m.user_id !== userId);
  memo.users = memo.users.filter((u) => u.id !== userId);
  scheduleJsonSave();
  return { ok: true };
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
// SLIP VERIFICATIONS (raw audit log of every EasySlip call)
// --------------------------------------------------------------------------

/**
 * Persist one EasySlip verification attempt. We never throw from here —
 * even if the DB is unreachable, the calling code should never lose a
 * customer's slip just because we can't write an audit row.
 *
 * @param {Object} v
 * @param {'webhook'|'manual'} v.source
 * @param {string} [v.shopId]
 * @param {string} [v.channel]
 * @param {string} [v.convId]
 * @param {string} [v.imageUrl]
 * @param {{ status: string; amount?: number; bank?: string; ref?: string; senderName?: string; receiverName?: string; reason?: string }} v.result
 * @param {string|null} [v.userId]   user who triggered (manual only)
 */
export async function recordSlipVerificationAttempt(v) {
  const r = v.result || {};
  const row = {
    shopId: v.shopId || DEFAULT_SHOP_ID,
    source: v.source || 'webhook',
    channel: v.channel || null,
    convId: v.convId || null,
    imageUrl: v.imageUrl || null,
    status: r.status || 'unknown',
    amount: typeof r.amount === 'number' ? r.amount : null,
    bank: r.bank || null,
    ref: r.ref || null,
    senderName: r.senderName || null,
    receiverName: r.receiverName || null,
    reason: r.reason || null,
    byUser: v.userId || null,
    at: new Date().toISOString(),
  };
  try {
    if (pool) {
      await pool.query(
        `INSERT INTO slip_verifications
           (shop_id, source, channel, conv_id, image_url, status,
            amount, bank, ref, sender_name, receiver_name, reason, by_user, at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [row.shopId, row.source, row.channel, row.convId, row.imageUrl, row.status,
         row.amount, row.bank, row.ref, row.senderName, row.receiverName, row.reason,
         row.byUser, row.at],
      );
    } else {
      memo.slipVerifications.push(row);
      // Cap the JSON-mode log so dev mode doesn't grow unbounded.
      if (memo.slipVerifications.length > 2000) {
        memo.slipVerifications = memo.slipVerifications.slice(-2000);
      }
      scheduleJsonSave();
    }
  } catch (e) {
    console.warn('[db] recordSlipVerificationAttempt failed:', e?.message || e);
  }
  return row;
}

/**
 * List recent verification attempts for a shop. Used by the Slips admin UI
 * to show "failed" / "duplicate" attempts that wouldn't appear in the
 * normal `slipsById` cache after eviction.
 */
export async function listRecentSlipVerifications(shopId = DEFAULT_SHOP_ID, limit = 100) {
  if (pool) {
    const { rows } = await pool.query(
      `SELECT * FROM slip_verifications WHERE shop_id=$1 ORDER BY at DESC LIMIT $2`,
      [shopId, limit],
    );
    return rows;
  }
  return memo.slipVerifications
    .filter((r) => (r.shopId || DEFAULT_SHOP_ID) === shopId)
    .slice(-limit)
    .reverse();
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
