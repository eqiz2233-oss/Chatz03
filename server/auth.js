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
  findUserByEmail,
  findUserByOauth,
  countUsers,
  createUser,
  linkOauthToUser,
  ensureSeedOwner,
  addShopMember,
  updateUserPasswordHash,
  createPasswordResetToken,
  findPasswordResetToken,
  consumePasswordResetToken,
  kvGet,
  kvSet,
  listShopsForUser,
  isShopMember,
  DEFAULT_SHOP_ID,
} from './db.js';
import { sendEmail, passwordResetEmail, isEmailEnabled } from './email.js';

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
  if (!user.password_hash) {
    // OAuth-only account — no password to compare.
    return { ok: false, reason: 'oauth_only' };
  }
  const ok = await bcrypt.compare(String(password || ''), String(user.password_hash || ''));
  if (!ok) return { ok: false, reason: 'invalid' };
  return await establishSession(user);
}

/**
 * Create a session for a known user. Used by every successful-auth path
 * (password login, signup, Google, Facebook) so cookie + shop-binding logic
 * lives in one place.
 */
async function establishSession(user) {
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

// ─── Signup (password) ───────────────────────────────────────────────────────

const USERNAME_REGEX = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/;

/**
 * Create a new password-based account and auto-sign-in.
 *   - Username: 2-32 chars, lowercase alphanumeric + . _ -
 *   - Password: at least 6 chars
 *   - Email optional, but if given must be unique
 * Returns the same shape as login() so callers can treat them uniformly.
 */
export async function signup({ username, password, displayName, email }) {
  const uRaw = String(username || '').trim().toLowerCase();
  const p = String(password || '');
  const dn = displayName ? String(displayName).trim().slice(0, 80) : null;
  const e = email ? String(email).trim().toLowerCase() : null;

  if (!USERNAME_REGEX.test(uRaw)) return { ok: false, reason: 'bad_username' };
  if (p.length < 6) return { ok: false, reason: 'password_too_short' };
  if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { ok: false, reason: 'bad_email' };

  if (await findUserByUsername(uRaw)) return { ok: false, reason: 'username_taken' };
  if (e && (await findUserByEmail(e))) return { ok: false, reason: 'email_taken' };

  const hash = await bcrypt.hash(p, 10);
  const id = crypto.randomUUID();
  const user = await createUser({
    id,
    username: uRaw,
    passwordHash: hash,
    role: 'owner',
    displayName: dn,
    email: e,
  });
  // Every new account gets its own slot in the default shop. Multi-shop
  // is wired but the signup flow keeps it simple: one shop per account
  // until the user explicitly creates more.
  await addShopMember({ shopId: DEFAULT_SHOP_ID, userId: id, role: 'owner' });
  return await establishSession(user);
}

// ─── OAuth: Google ───────────────────────────────────────────────────────────

const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

/**
 * Verify a Google Identity Services credential (ID token) and either log the
 * user in (existing oauth or matching email) or create a new account.
 *
 * The tokeninfo endpoint does the JWT signature check + audience match for
 * us, so we don't need a JWT library on the server. The check requires
 * GOOGLE_CLIENT_ID to match.
 */
export async function loginWithGoogle(credential) {
  const expectedClientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  if (!expectedClientId) return { ok: false, reason: 'google_not_configured' };
  if (!credential) return { ok: false, reason: 'no_credential' };

  let profile;
  try {
    const r = await fetch(`${GOOGLE_TOKENINFO_URL}?id_token=${encodeURIComponent(credential)}`);
    profile = await r.json();
    if (!r.ok || profile?.error) {
      return { ok: false, reason: 'invalid_google_token' };
    }
  } catch (e) {
    console.warn('[auth] google tokeninfo failed:', e?.message || e);
    return { ok: false, reason: 'google_unreachable' };
  }

  // Audience must match our client id, otherwise this token wasn't meant for us.
  if (profile.aud !== expectedClientId) {
    return { ok: false, reason: 'wrong_audience' };
  }
  if (profile.email_verified !== 'true' && profile.email_verified !== true) {
    return { ok: false, reason: 'email_not_verified' };
  }

  return await upsertOauthUser({
    provider: 'google',
    sub: profile.sub,
    email: profile.email || null,
    displayName: profile.name || null,
    avatarUrl: profile.picture || null,
  });
}

// ─── OAuth: Facebook ─────────────────────────────────────────────────────────

/**
 * Verify a Facebook user access token (from FB.login on the client) and
 * either log the user in or create a new account.
 *
 * Two-step verification:
 *   1. debug_token confirms the token was issued for our app and not expired.
 *   2. /me?fields=id,name,email,picture returns the user profile.
 *
 * Requires FB_APP_ID and FB_APP_SECRET in env (same vars already used by
 * the Page-OAuth flow).
 */
export async function loginWithFacebook(accessToken) {
  const appId = (process.env.FB_APP_ID || '').trim();
  const appSecret = (process.env.FB_APP_SECRET || '').trim();
  if (!appId || !appSecret) return { ok: false, reason: 'facebook_not_configured' };
  if (!accessToken) return { ok: false, reason: 'no_token' };

  // 1. Sanity-check the token belongs to our app.
  try {
    const debugUrl =
      `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}` +
      `&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`;
    const dr = await fetch(debugUrl);
    const dd = await dr.json();
    if (!dr.ok || dd?.error || !dd?.data?.is_valid || String(dd.data.app_id) !== appId) {
      return { ok: false, reason: 'invalid_fb_token' };
    }
  } catch (e) {
    console.warn('[auth] FB debug_token failed:', e?.message || e);
    return { ok: false, reason: 'facebook_unreachable' };
  }

  // 2. Fetch profile.
  let profile;
  try {
    const r = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email,picture.type(large){url}` +
      `&access_token=${encodeURIComponent(accessToken)}`,
    );
    profile = await r.json();
    if (!r.ok || profile?.error || !profile?.id) {
      return { ok: false, reason: 'fb_profile_failed' };
    }
  } catch (e) {
    return { ok: false, reason: 'facebook_unreachable' };
  }

  return await upsertOauthUser({
    provider: 'facebook',
    sub: profile.id,
    email: profile.email || null,
    displayName: profile.name || null,
    avatarUrl: profile?.picture?.data?.url || null,
  });
}

// ─── OAuth: shared "find or create" ──────────────────────────────────────────

/**
 * Match an OAuth identity to a Chatz user, in priority order:
 *   1. Exact (provider, sub) match → returning OAuth user, just log in.
 *   2. Email match on an existing password user → link the OAuth identity
 *      to that account (so the user can use either method going forward).
 *   3. None → create a new account with a username derived from email/name.
 */
async function upsertOauthUser({ provider, sub, email, displayName, avatarUrl }) {
  let user = await findUserByOauth(provider, sub);
  if (user) {
    return await establishSession(user);
  }

  if (email) {
    const byEmail = await findUserByEmail(email);
    if (byEmail) {
      user = await linkOauthToUser(byEmail.id, {
        oauthProvider: provider,
        oauthSub: sub,
        email,
        avatarUrl,
      });
      return await establishSession(user || byEmail);
    }
  }

  // Fresh account. Derive a username — start from email local-part or
  // displayName, sanitize, then disambiguate with a random suffix on collision.
  const seed = (email && email.split('@')[0])
    || (displayName && displayName.toLowerCase().replace(/\s+/g, '.'))
    || provider;
  const baseUsername = String(seed)
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 24)
    || provider;
  let username = baseUsername;
  for (let i = 0; i < 10 && await findUserByUsername(username); i++) {
    username = `${baseUsername}.${crypto.randomBytes(2).toString('hex')}`;
  }

  const id = crypto.randomUUID();
  user = await createUser({
    id,
    username,
    role: 'owner',
    displayName: displayName || null,
    email: email || null,
    oauthProvider: provider,
    oauthSub: String(sub),
    avatarUrl: avatarUrl || null,
  });
  await addShopMember({ shopId: DEFAULT_SHOP_ID, userId: id, role: 'owner' });
  return await establishSession(user);
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
    email: user.email || null,
    avatarUrl: user.avatar_url || user.avatarUrl || null,
    oauthProvider: user.oauth_provider || user.oauthProvider || null,
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

// ─── Password reset (email-based, 1-hour token) ─────────────────────────────

/**
 * Kick off a password reset. ALWAYS returns { ok: true } even when the
 * identifier doesn't match — same shape as Google / Facebook / Apple —
 * so a stranger can't probe the user table to learn which emails exist.
 *
 * `identifier` is either the user's username OR their email address.
 * If they signed up with Google/Facebook only (no password), we still
 * accept the reset and let them set a password — the OAuth login keeps
 * working in parallel.
 */
export async function requestPasswordReset({ identifier, resetUrlBuilder }) {
  const id = String(identifier || '').trim().toLowerCase();
  if (!id) return { ok: true }; // silent — see comment above

  // Try username first, then email. Either is fine for identifying the user.
  const user = (await findUserByUsername(id)) || (await findUserByEmail(id));
  if (!user) {
    // Don't reveal that the identifier is unknown.
    console.log(`[auth] password reset requested for unknown identifier: ${id}`);
    return { ok: true };
  }
  if (!user.email) {
    console.log(`[auth] password reset blocked — user ${user.id} has no email on file`);
    return { ok: true, noEmail: true };
  }

  const token = crypto.randomBytes(24).toString('base64url');
  await createPasswordResetToken(user.id, token);
  const resetUrl = typeof resetUrlBuilder === 'function'
    ? resetUrlBuilder(token)
    : `/reset-password?token=${encodeURIComponent(token)}`;

  const { html, text } = passwordResetEmail({
    name: user.display_name || user.username,
    resetUrl,
  });
  const sent = await sendEmail({
    to: user.email,
    subject: 'Reset your Chatz password',
    html,
    text,
  });
  return { ok: true, delivered: sent.ok, devLog: sent.dev || false, emailConfigured: isEmailEnabled() };
}

/** Returns user metadata for a valid token — frontend uses this to greet
 *  the user by name on the reset page. Null = token unusable. */
export async function previewPasswordReset(token) {
  const row = await findPasswordResetToken(token);
  if (!row) return null;
  const user = await findUserById(row.userId);
  if (!user) return null;
  return {
    token: row.token,
    expiresAt: row.expiresAt,
    user: {
      username: user.username,
      displayName: user.display_name || null,
      email: user.email || null,
    },
  };
}

/** Set the new password using a valid reset token. Sets the bcrypt hash
 *  and burns the token in one DB transaction (well, two awaited calls). */
export async function completePasswordReset(token, newPassword) {
  const np = String(newPassword || '');
  if (np.length < 6) return { ok: false, reason: 'password_too_short' };
  const row = await findPasswordResetToken(token);
  if (!row) return { ok: false, reason: 'invalid_or_expired' };
  const hash = await bcrypt.hash(np, 10);
  await updateUserPasswordHash(row.userId, hash);
  await consumePasswordResetToken(token);
  return { ok: true, userId: row.userId };
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
