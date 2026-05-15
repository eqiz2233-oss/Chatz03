// Password login + cookie-based session.
//
// Single-tenant for now: the first user becomes the "owner" (auto-seeded from
// OWNER_USERNAME / OWNER_PASSWORD env vars on first boot, or "admin" / "admin"
// if neither is set — the UI nags the user to change it).
//
// Sessions live in-memory + persist to KV so they survive restarts when DB is
// available. Token = random opaque string in an httpOnly cookie.

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  findUserByUsername,
  findUserById,
  countUsers,
  ensureSeedOwner,
  updateUserPasswordHash,
  kvGet,
  kvSet,
  listShopsForUser,
  isShopMember,
  DEFAULT_SHOP_ID,
} from './db.js';

const COOKIE_NAME = 'chatz_sid';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_KV_KEY = 'auth.sessions.v1';

/** @type {Map<string, { userId: string; createdAt: number; lastUsedAt: number; activeShopId?: string|null }>} */
const sessions = new Map();

let loadedSessionsOnce = false;
async function lazyLoadSessions() {
  if (loadedSessionsOnce) return;
  loadedSessionsOnce = true;
  try {
    const raw = await kvGet(SESSION_KV_KEY, null);
    if (raw && typeof raw === 'object') {
      for (const [tok, s] of Object.entries(raw)) {
        if (s?.userId && s?.createdAt) sessions.set(tok, s);
      }
    }
  } catch (e) {
    console.warn('[auth] load sessions failed:', e?.message || e);
  }
}

let saveTimer = null;
function scheduleSaveSessions() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await kvSet(SESSION_KV_KEY, Object.fromEntries(sessions.entries()));
    } catch (e) {
      console.warn('[auth] save sessions failed:', e?.message || e);
    }
  }, 1000);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join('=') || '');
  }
  return out;
}

function genToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export async function bootstrapAuth() {
  // Seed the first owner on boot if the users table is empty.
  if ((await countUsers()) > 0) return;
  const password = (process.env.OWNER_PASSWORD || 'admin').trim() || 'admin';
  const hash = await bcrypt.hash(password, 10);
  const u = await ensureSeedOwner({ hash });
  if (u) {
    console.log(
      `[auth] seeded owner user "${u.username}" (set OWNER_USERNAME / OWNER_PASSWORD env to override before first boot)`,
    );
    if (password === 'admin') {
      console.warn('[auth] WARNING: default password is "admin" — change it after first login.');
    }
  }
}

export async function login(username, password) {
  const user = await findUserByUsername(username);
  if (!user) return { ok: false, reason: 'invalid' };
  const ok = await bcrypt.compare(String(password || ''), String(user.password_hash || ''));
  if (!ok) return { ok: false, reason: 'invalid' };
  await lazyLoadSessions();
  const token = genToken();
  const now = Date.now();
  // Pick the user's first shop as their active shop by default. New users
  // typically have exactly one (the default shop they were seeded into).
  const shops = await listShopsForUser(user.id);
  const activeShopId = shops[0]?.id || DEFAULT_SHOP_ID;
  sessions.set(token, { userId: user.id, createdAt: now, lastUsedAt: now, activeShopId });
  scheduleSaveSessions();
  return { ok: true, token, user: publicUser(user), activeShopId };
}

export async function logout(token) {
  if (!token) return;
  await lazyLoadSessions();
  sessions.delete(token);
  scheduleSaveSessions();
}

export async function userFromRequest(req) {
  await lazyLoadSessions();
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    scheduleSaveSessions();
    return null;
  }
  s.lastUsedAt = Date.now();
  const user = await findUserById(s.userId);
  if (!user) return null;
  return publicUser(user, { activeShopId: s.activeShopId || null });
}

/** Return the active shop id from the session cookie (or null). */
export async function activeShopIdFromRequest(req) {
  await lazyLoadSessions();
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.activeShopId) return s.activeShopId;
  // Lazy backfill if older sessions never recorded one.
  const shops = await listShopsForUser(s.userId);
  s.activeShopId = shops[0]?.id || DEFAULT_SHOP_ID;
  scheduleSaveSessions();
  return s.activeShopId;
}

/** Switch the session's active shop, after checking membership. */
export async function setActiveShopForRequest(req, shopId) {
  await lazyLoadSessions();
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return { ok: false, reason: 'no_session' };
  const s = sessions.get(token);
  if (!s) return { ok: false, reason: 'no_session' };
  const member = await isShopMember(shopId, s.userId);
  if (!member) return { ok: false, reason: 'not_a_member' };
  s.activeShopId = shopId;
  scheduleSaveSessions();
  return { ok: true, activeShopId: shopId };
}

export function publicUser(user, extras = {}) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.display_name || user.displayName || null,
    ...extras,
  };
}

export function setSessionCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}

export function getCookieToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[COOKIE_NAME] || null;
}

/**
 * Express middleware factory. Pass in the list of unauthenticated path
 * prefixes (webhooks, login endpoint, health check, static frontend).
 */
export function requireAuth({ allowList }) {
  const list = (allowList || []).map((s) => String(s));
  return async (req, res, next) => {
    const p = req.path || '';
    if (!p.startsWith('/api')) return next(); // static SPA + webhooks (/-prefixed already)
    if (list.some((prefix) => p === prefix || p.startsWith(prefix))) return next();
    const u = await userFromRequest(req);
    if (!u) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    req.user = u;
    next();
  };
}

export async function changePassword(userId, currentPassword, newPassword) {
  const user = await findUserById(userId);
  if (!user) return { ok: false, reason: 'not_found' };
  const ok = await bcrypt.compare(String(currentPassword || ''), String(user.password_hash || ''));
  if (!ok) return { ok: false, reason: 'invalid_current' };
  const np = String(newPassword || '');
  if (np.length < 6) return { ok: false, reason: 'too_short' };
  const hash = await bcrypt.hash(np, 10);
  await updateUserPasswordHash(userId, hash);
  return { ok: true };
}
