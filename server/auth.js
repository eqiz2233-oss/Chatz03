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
  findUserIdByOauthIdentity,
  addOauthIdentity,
  listOauthIdentitiesForUser,
  removeOauthIdentity,
  countUsers,
  createUser,
  linkOauthToUser,
  ensureSeedOwner,
  addShopMember,
  updateUserPasswordHash,
  createPasswordResetToken,
  findPasswordResetToken,
  consumePasswordResetToken,
  createEmailVerificationToken,
  consumeEmailVerificationToken,
  isUserEmailVerified,
  kvGet,
  kvSet,
  listShopsForUser,
  isShopMember,
  DEFAULT_SHOP_ID,
} from './db.js';
import { sendEmail, passwordResetEmail, verifyEmailEmail, isEmailEnabled } from './email.js';

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
 *   - Email REQUIRED — used for password reset, verification, and so the
 *     account isn't a throwaway. We don't verify ownership at signup
 *     (the verification flow lives in Settings) but we do require a
 *     plausibly-formatted address that's unique in the system.
 * Returns the same shape as login() so callers can treat them uniformly.
 */
export async function signup({ username, password, displayName, email }) {
  const uRaw = String(username || '').trim().toLowerCase();
  const p = String(password || '');
  const dn = displayName ? String(displayName).trim().slice(0, 80) : null;
  const e = email ? String(email).trim().toLowerCase() : '';

  if (!USERNAME_REGEX.test(uRaw)) return { ok: false, reason: 'bad_username' };
  if (p.length < 6) return { ok: false, reason: 'password_too_short' };
  if (!e) return { ok: false, reason: 'email_required' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { ok: false, reason: 'bad_email' };

  if (await findUserByUsername(uRaw)) return { ok: false, reason: 'username_taken' };
  if (await findUserByEmail(e)) return { ok: false, reason: 'email_taken' };

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
  // Same defensive read as the rest of the codebase — strips a stray
  // "GOOGLE_CLIENT_ID=" prefix that Railway value fields sometimes carry.
  const raw = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const expectedClientId = raw.startsWith('GOOGLE_CLIENT_ID=')
    ? raw.slice('GOOGLE_CLIENT_ID='.length).trim()
    : raw;
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
  // Defensive env read — strips the common "FB_APP_ID=..." paste mistake
  // that would otherwise be forwarded to Facebook as the literal value.
  const rawId = String(process.env.FB_APP_ID || '').trim();
  const rawSec = String(process.env.FB_APP_SECRET || '').trim();
  const appId = rawId.startsWith('FB_APP_ID=') ? rawId.slice('FB_APP_ID='.length).trim() : rawId;
  const appSecret = rawSec.startsWith('FB_APP_SECRET=') ? rawSec.slice('FB_APP_SECRET='.length).trim() : rawSec;
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

// ─── OAuth: LINE ─────────────────────────────────────────────────────────────

/**
 * Establish a session for a user authenticated via LINE Login.
 *
 * Unlike Google (which we verify via tokeninfo) and Facebook (debug_token),
 * the LINE auth flow is fully server-side in this codebase: the callback
 * endpoint already exchanged the authorization code for tokens and fetched
 * the profile via Bearer auth. By the time this function runs, the (sub,
 * displayName, avatarUrl) tuple is trusted. We just route into the same
 * upsert path as the other providers so identity merging-by-email works
 * uniformly across Google / Facebook / LINE.
 */
export async function loginWithLine({ sub, displayName, avatarUrl, email }) {
  if (!sub) return { ok: false, reason: 'no_sub' };
  return await upsertOauthUser({
    provider: 'line',
    sub: String(sub),
    email: email || null,
    displayName: displayName || null,
    avatarUrl: avatarUrl || null,
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
  // 1. Returning user — this exact (provider, sub) already maps to a user.
  //    findUserIdByOauthIdentity checks the new identities table first and
  //    falls back to the legacy users.oauth_provider/sub columns, so accounts
  //    that pre-date the multi-identity migration still log in cleanly.
  const existingUserId = await findUserIdByOauthIdentity(provider, sub);
  if (existingUserId) {
    const user = await findUserById(existingUserId);
    if (user) {
      // Touch-migrate: ensure the new identities table has the row even if
      // the lookup hit the legacy fallback.
      await addOauthIdentity(user.id, provider, sub);
      return await establishSession(user);
    }
  }

  // 2. Email collision. DO NOT auto-link silently — that's a known account-
  //    takeover vector (attacker registers a password account using a
  //    victim's email; victim later signs in with their real Google and the
  //    accounts get merged). Instead we bounce the user back to /login and
  //    ask them to sign in with the original method, then link Google from
  //    Settings while authenticated. Matches Slack / Notion / Linear.
  if (email) {
    const byEmail = await findUserByEmail(email);
    if (byEmail) {
      const methods = await signInMethodsForUser(byEmail);
      return {
        ok: false,
        reason: 'email_in_use',
        // Give the UI enough context to compose a helpful banner. None of
        // these reveal anything Google didn't already tell us about the
        // user: the email was just verified by Google upstream.
        email,
        existingMethods: methods,
        existingUsername: byEmail.username || null,
      };
    }
  }

  // 3. Fresh account. Derive a username — start from email local-part or
  //    displayName, sanitize, then disambiguate with a random suffix.
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
  const user = await createUser({
    id,
    username,
    role: 'owner',
    displayName: displayName || null,
    email: email || null,
    // We still set the legacy columns on first-create for backwards-compat
    // reads. The identity table is the new source of truth for lookups.
    oauthProvider: provider,
    oauthSub: String(sub),
    avatarUrl: avatarUrl || null,
  });
  await addOauthIdentity(id, provider, sub);
  await addShopMember({ shopId: DEFAULT_SHOP_ID, userId: id, role: 'owner' });
  return await establishSession(user);
}

/**
 * Enumerate every way `user` can currently sign in. Used by:
 *   • the OAuth callback collision path to tell the redirect banner
 *     which method to suggest ("เข้าสู่ระบบด้วย Google");
 *   • Settings → Linked accounts to render the per-provider chips.
 */
export async function signInMethodsForUser(user) {
  const methods = [];
  if (user?.password_hash) methods.push('password');
  const identities = await listOauthIdentitiesForUser(user.id);
  for (const id of identities) {
    if (!methods.includes(id.provider)) methods.push(id.provider);
  }
  // Legacy single-provider column — usually superseded by the migration
  // backfill but kept as belt-and-braces.
  if (user?.oauth_provider && !methods.includes(user.oauth_provider)) {
    methods.push(user.oauth_provider);
  }
  return methods;
}

/**
 * Link a new OAuth identity onto an already-logged-in user. Used by the
 * Settings → Linked accounts UI: user authenticates first, then proves
 * ownership of (e.g.) a Google account that hasn't been associated yet.
 * Refuses if the OAuth identity is already attached to a different user
 * (returns reason='identity_in_use'), so we never silently steal a
 * provider's identity from another Chatz account.
 */
export async function linkOauthIdentityToCurrentUser(currentUserId, { provider, sub }) {
  if (!currentUserId || !provider || !sub) return { ok: false, reason: 'bad_input' };
  const owner = await findUserIdByOauthIdentity(provider, sub);
  if (owner && owner !== currentUserId) return { ok: false, reason: 'identity_in_use' };
  const ok = await addOauthIdentity(currentUserId, provider, sub);
  return ok ? { ok: true } : { ok: false, reason: 'link_failed' };
}

// ─── Email verification ──────────────────────────────────────────────────────
//
// Verification is opt-in and lives in Settings — the user can use Chatz
// fully unverified. The check exists to:
//   1. Cut down on throwaway-email signups when paired with the honeypot.
//   2. Let us trust the address before relying on it for password resets,
//      billing receipts, security notifications.
//   3. Earn the user a small "ยืนยันแล้ว ✓" badge they can show.
//
// Tokens are 32 random bytes (base64url) and expire after 24h. Tokens are
// single-use — consume clears the row.

/**
 * Issue a verification token and email the link.
 * Caller: Settings → "ส่งอีเมลยืนยัน". Always responds {ok:true} when the
 * email could plausibly be sent so we don't leak which addresses exist;
 * the actual provider-side success is logged but not surfaced.
 */
export async function sendVerificationEmail({ userId, baseUrl }) {
  if (!userId || !baseUrl) return { ok: false, reason: 'bad_input' };
  const user = await findUserById(userId);
  if (!user?.email) return { ok: false, reason: 'no_email' };
  if (isUserEmailVerified(user)) return { ok: false, reason: 'already_verified' };

  const token = crypto.randomBytes(32).toString('base64url');
  await createEmailVerificationToken(user.id, token, user.email);
  const verifyUrl = `${String(baseUrl).replace(/\/+$/, '')}/api/auth/email/verify/${encodeURIComponent(token)}`;
  const { text, html } = verifyEmailEmail({
    name: user.display_name || user.username || '',
    verifyUrl,
  });
  const r = await sendEmail({
    to: user.email,
    subject: 'ยืนยันอีเมลของคุณ — Chatz',
    text,
    html,
  });
  if (!isEmailEnabled() && r.dev) {
    // Surface the dev-mode log line as a hint to the operator that
    // RESEND_API_KEY isn't set yet. The HTTP response still claims OK so
    // the user-facing UX doesn't expose the absence of an email provider.
    console.warn('[auth] verification email logged to console (no RESEND_API_KEY set)');
  }
  return { ok: r.ok, provider: r.dev ? 'dev' : 'live' };
}

/**
 * Consume a verification token. On success returns {ok:true, userId, email};
 * on failure returns {ok:false, reason}. Reasons are intentionally generic
 * — the user-facing copy turns them into a single "expired or invalid"
 * line so this endpoint never confirms token-existence to a fishing call.
 */
export async function verifyEmailToken(token) {
  if (!token) return { ok: false, reason: 'invalid' };
  const consumed = await consumeEmailVerificationToken(String(token));
  if (!consumed) return { ok: false, reason: 'invalid' };
  return { ok: true, userId: consumed.userId, email: consumed.email };
}

/** Unlink an OAuth identity from the current user. We forbid removing the
 *  last sign-in method — without password + zero identities the user would
 *  be locked out forever. */
export async function unlinkOauthIdentity(currentUserId, provider) {
  if (!currentUserId || !provider) return { ok: false, reason: 'bad_input' };
  const user = await findUserById(currentUserId);
  if (!user) return { ok: false, reason: 'user_not_found' };
  const methods = await signInMethodsForUser(user);
  // Refuse if removing this provider would leave the user with nothing.
  const after = methods.filter((m) => m !== provider);
  if (after.length === 0) return { ok: false, reason: 'last_method' };
  const ok = await removeOauthIdentity(currentUserId, provider);
  return ok ? { ok: true } : { ok: false, reason: 'unlink_failed' };
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
  // Normalize the email-verified timestamp: DB returns email_verified_at
  // (snake_case from Postgres) in pool mode, or the same key from the
  // JSON memo fallback. Frontend reads camelCase, so we map once here.
  const verifiedAt =
    user.email_verified_at != null ? user.email_verified_at
    : user.emailVerifiedAt != null ? user.emailVerifiedAt
    : null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.display_name || user.displayName || null,
    email: user.email || null,
    emailVerifiedAt: verifiedAt,
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
