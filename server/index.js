import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import * as line from '@line/bot-sdk';
import {
  loadIntegrationsSync,
  upsertPage,
  clearAllPages,
  listPages,
  findPageByPageId,
  findPageByIgId,
} from './integrations.js';
import {
  verifySlipBytes,
  recordSlip,
  listSlips,
  getSlip,
  slipStats,
  isEasySlipEnabled,
} from './slips.js';
import {
  initDb,
  hasPg,
  listProducts as dbListProducts,
  upsertProduct as dbUpsertProduct,
  deleteProduct as dbDeleteProduct,
  listOrders as dbListOrders,
  upsertOrder as dbUpsertOrder,
  deleteOrder as dbDeleteOrder,
  recordSlipAction,
  listSlipActionsBySlipIds,
  recordSlipVerificationAttempt,
  listRecentSlipVerifications,
  logChatEvent,
  chatEventsByDay,
  kvGet,
  kvSet,
  listShops,
  listShopsForUser,
  findShopById,
  listShopMembers,
  removeShopMember,
  addShopMember,
  isShopMember,
  createShopInvite,
  findShopInvite,
  consumeShopInvite,
  updateUserProfile,
  deleteUserAccount,
  findUserByEmail,
  findUserByUsername,
  DEFAULT_SHOP_ID,
} from './db.js';
import {
  bootstrapAuth,
  login as authLogin,
  logout as authLogout,
  signup as authSignup,
  loginWithGoogle,
  loginWithFacebook,
  requestPasswordReset,
  previewPasswordReset,
  completePasswordReset,
  userFromRequest,
  setSessionCookie,
  clearSessionCookie,
  getCookieToken,
  requireAuth,
  changePassword,
  activeShopIdFromRequest,
  setActiveShopForRequest,
} from './auth.js';
import { isEmailEnabled } from './email.js';
import { isAiEnabled, aiModel, aiHealth, generateReply, generateSlipThankYou } from './ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const port = Number(process.env.PORT || process.env.BACKEND_PORT || 8787);

const savedIntegrations = loadIntegrationsSync();

// LINE channel config — env defaults can be overridden by the UI "Connect LINE"
// form, which persists `{ channelSecret, channelAccessToken }` to kv under
// `LINE_KV_KEY`. Hot-reloaded into `lineConfig` + `lineClient` so we never
// have to restart the server when a shop owner pastes their credentials.
// Legacy single-tenant key — still read on startup so existing installs
// upgrade cleanly to per-shop storage (we copy it to the default shop on
// first boot). New writes go to LINE_KV_PREFIX + shopId.
const LINE_KV_KEY = 'line.config.v1';
const LINE_KV_PREFIX = 'line.config.shop.';

/**
 * Per-shop LINE state. Each entry is its own credentials + bot info + index
 * pointer; Shop A connecting their OA doesn't touch Shop B's row.
 *   shopId -> { channelSecret, channelAccessToken, source, botInfo }
 */
const lineConfigByShop = new Map();
/**
 * Webhook routing index: OA userId -> shopId. Built whenever a shop's
 * config is loaded or updated. The LINE webhook payload has a `destination`
 * field equal to the receiving OA's userId, so this map is how we figure
 * out which shop a webhook belongs to.
 */
const lineOaToShop = new Map();

/**
 * Module-scope "active" config used by code paths that aren't yet
 * shop-aware (webhook signature check, push API, thread storage). It
 * mirrors the currently-loaded shop's config; per-shop endpoints flip it
 * before doing work, then any background read uses the right values.
 *
 * This is a compat shim — Phase 1B will replace the remaining global
 * references with explicit shopId lookups.
 */
const lineConfig = {
  channelSecret: (process.env.LINE_CHANNEL_SECRET || '').trim(),
  channelAccessToken: (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim(),
  source: null,
  botInfo: null,
};
if (lineConfig.channelSecret || lineConfig.channelAccessToken) {
  lineConfig.source = 'env';
}
function hasLineSecret() { return Boolean(lineConfig.channelSecret); }
function hasLineToken() { return Boolean(lineConfig.channelAccessToken); }

function lineKvKeyForShop(shopId) {
  return `${LINE_KV_PREFIX}${shopId}`;
}

/**
 * Lazy-load a shop's LINE config from KV into the in-memory map and rebuild
 * the OA-to-shop index. Returns the entry or null if the shop has never
 * connected LINE.
 */
async function loadLineConfigForShop(shopId) {
  if (!shopId) return null;
  const cached = lineConfigByShop.get(shopId);
  if (cached) return cached;
  const saved = await kvGet(lineKvKeyForShop(shopId), null);
  if (saved && (saved.channelSecret || saved.channelAccessToken)) {
    const entry = {
      channelSecret: String(saved.channelSecret || ''),
      channelAccessToken: String(saved.channelAccessToken || ''),
      source: saved.source || 'ui',
      botInfo: saved.botInfo || null,
    };
    lineConfigByShop.set(shopId, entry);
    if (entry.botInfo?.userId) lineOaToShop.set(String(entry.botInfo.userId), shopId);
    return entry;
  }
  return null;
}

/**
 * Persist a shop's LINE config (memory + KV + index). Also refreshes the
 * compat `lineConfig` so any background code that still reads the global
 * sees the newest values.
 */
async function setLineConfigForShop(shopId, { secret, token, source, botInfo = null }) {
  if (!shopId) throw new Error('setLineConfigForShop requires shopId');
  const entry = {
    channelSecret: (secret || '').trim(),
    channelAccessToken: (token || '').trim(),
    source: source || null,
    botInfo: botInfo || null,
  };
  // Refresh OA index — remove old mapping if the OA userId changed.
  const prev = lineConfigByShop.get(shopId);
  if (prev?.botInfo?.userId && prev.botInfo.userId !== entry.botInfo?.userId) {
    lineOaToShop.delete(String(prev.botInfo.userId));
  }
  if (entry.botInfo?.userId) lineOaToShop.set(String(entry.botInfo.userId), shopId);
  lineConfigByShop.set(shopId, entry);

  await kvSet(lineKvKeyForShop(shopId), {
    channelSecret: entry.channelSecret,
    channelAccessToken: entry.channelAccessToken,
    botInfo: entry.botInfo,
    source: entry.source,
    savedAt: new Date().toISOString(),
  });

  // Mirror to the compat global so legacy code paths see the active shop's creds.
  lineConfig.channelSecret = entry.channelSecret;
  lineConfig.channelAccessToken = entry.channelAccessToken;
  lineConfig.source = entry.source;
  lineConfig.botInfo = entry.botInfo;
  return entry;
}

/**
 * Wipe a shop's LINE config (used by /disconnect). Falls back to env vars
 * for the global compat only — the per-shop slot is fully removed.
 */
async function clearLineConfigForShop(shopId) {
  const prev = lineConfigByShop.get(shopId);
  if (prev?.botInfo?.userId) lineOaToShop.delete(String(prev.botInfo.userId));
  lineConfigByShop.delete(shopId);
  await kvSet(lineKvKeyForShop(shopId), null);
  // Reset compat global to env (so env-only deployments still work).
  lineConfig.channelSecret = (process.env.LINE_CHANNEL_SECRET || '').trim();
  lineConfig.channelAccessToken = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();
  lineConfig.source = lineConfig.channelSecret || lineConfig.channelAccessToken ? 'env' : null;
  lineConfig.botInfo = null;
}

/** Lookup which shop owns the OA that just sent a webhook event. */
function shopIdForLineDestination(destination) {
  if (!destination) return null;
  return lineOaToShop.get(String(destination)) || null;
}

/**
 * LINE Module Channel (OAuth-style connect, the same flow zwiz.ai uses).
 * Lets shop owners click "Connect with LINE" instead of pasting Channel
 * Secret + Access Token by hand. Requires both env vars to be set; without
 * them the Settings UI falls back to the manual paste form.
 */
const LINE_MODULE_CHANNEL_ID = (process.env.LINE_MODULE_CHANNEL_ID || '').trim();
const LINE_MODULE_CHANNEL_SECRET = (process.env.LINE_MODULE_CHANNEL_SECRET || '').trim();
function lineOauthAvailable() {
  return Boolean(LINE_MODULE_CHANNEL_ID && LINE_MODULE_CHANNEL_SECRET);
}
/** state → { userId, createdAt } — auto-pruned, max 5 min lifetime. */
const lineOauthStates = new Map();
function pruneLineOauthStates() {
  const now = Date.now();
  for (const [k, v] of lineOauthStates) {
    if (now - v.createdAt > 5 * 60 * 1000) lineOauthStates.delete(k);
  }
}

// App-level FB config (shared across all connected Pages). Re-read from process.env on each sync
// so Railway / Docker env changes after boot (or any load-order quirk) still match the live process.
const fbConfig = {
  appSecret: '',
  verifyToken: '',
  apiVersion: 'v21.0',
  appId: '',
  fallbackPageAccessToken: '',
};

let fbHasVerify = false;
let fbHasAppSecret = false;
let fbOauthAvailable = false;

// `fbConfigured` now means "webhook is set up at app level" — i.e. verify token present.
// `fbHasAnyPage` means at least one Page is connected and ready to send/receive.
let fbHasAnyPage = false;
let fbConfigured = false;

function syncFbConfigFromEnv() {
  fbConfig.appSecret = (process.env.FB_APP_SECRET || '').trim();
  fbConfig.verifyToken = (process.env.FB_VERIFY_TOKEN || '').trim();
  fbConfig.apiVersion = (process.env.FB_GRAPH_VERSION || 'v21.0').trim();
  fbConfig.appId = (process.env.FB_APP_ID || '').trim();
  fbConfig.fallbackPageAccessToken = (process.env.FB_PAGE_ACCESS_TOKEN || '').trim();
  fbHasVerify = Boolean(fbConfig.verifyToken);
  fbHasAppSecret = Boolean(fbConfig.appSecret);
  fbOauthAvailable = Boolean(fbConfig.appId && fbConfig.appSecret);
  fbConfigured = fbHasVerify;
  refreshFbState();
}

syncFbConfigFromEnv();

function refreshFbState() {
  fbHasAnyPage = listPages().length > 0 || Boolean(fbConfig.fallbackPageAccessToken);
}

function fbHasPageToken() {
  return listPages().some((p) => Boolean(p.pageAccessToken)) || Boolean(fbConfig.fallbackPageAccessToken);
}

/** Page access token: first OAuth-connected Page, else .env fallback. */
function primaryPageAccessToken() {
  const fromPage = listPages().find((p) => p.pageAccessToken)?.pageAccessToken;
  return String(fromPage || fbConfig.fallbackPageAccessToken || '').trim();
}

/** First connected page — shape used by Settings + OAuth popup (no secrets). */
function primaryFbPageForApi() {
  const p = listPages()[0];
  if (!p?.id) return null;
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    picture: typeof p.picture === 'string' ? p.picture : p.picture,
    instagram: p.instagram || null,
    connectedAt: p.connectedAt || null,
  };
}

/** Graph `/me` for FB_PAGE_ACCESS_TOKEN when no OAuth page — Settings shows real Page name. */
let envPageProfileCache = { at: 0, page: null };
const ENV_PAGE_PROFILE_TTL_MS = 5 * 60 * 1000;

async function fetchEnvFallbackPageProfile() {
  const tok = fbConfig.fallbackPageAccessToken;
  if (!tok || listPages().length > 0) return null;
  const now = Date.now();
  if (envPageProfileCache.page && now - envPageProfileCache.at < ENV_PAGE_PROFILE_TTL_MS) {
    return envPageProfileCache.page;
  }
  try {
    const url =
      `https://graph.facebook.com/${fbConfig.apiVersion}/me` +
      `?fields=id,name,category,picture.height(128).width(128){url}` +
      `&access_token=${encodeURIComponent(tok)}`;
    const r = await fetch(url);
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d?.error || !d?.id) {
      envPageProfileCache = { at: now, page: null };
      return null;
    }
    const page = {
      id: String(d.id),
      name: String(d.name || 'Facebook Page'),
      category: d.category || undefined,
      picture: d?.picture?.data?.url || undefined,
      instagram: null,
      connectedAt: null,
    };
    envPageProfileCache = { at: now, page };
    return page;
  } catch {
    envPageProfileCache = { at: now, page: null };
    return null;
  }
}

async function disconnectFb() {
  await clearAllPages();
  refreshFbState();
}

/** Page token resolver — returns null if we have no token for that page. */
function tokenForPageId(pageId) {
  const p = findPageByPageId(pageId);
  if (p?.pageAccessToken) return p.pageAccessToken;
  return fbConfig.fallbackPageAccessToken || null;
}
function tokenForIgId(igId) {
  const p = findPageByIgId(igId);
  if (p?.pageAccessToken) return p.pageAccessToken;
  return fbConfig.fallbackPageAccessToken || null;
}

const eventsBuffer = [];
const MAX_EVENTS = 200;
const CHAT_STORE_FILE = path.join(__dirname, 'chat-store.json');

/**
 * Per-conversation auto-reply (bot) toggle, scoped to the shop that owns
 * the thread. Conversations default to ON; the UI flips it off when a
 * human takes over. Storage key is `${shopId}::${conversationId}` so two
 * shops talking to the same customer (same LINE userId / FB PSID) keep
 * independent bot states.
 *
 * The legacy chat-store.json might contain unscoped keys (just
 * `line:user:Uxxx`); the loader rewrites those to DEFAULT_SHOP_ID at
 * boot, so existing single-tenant installs upgrade silently.
 */
const botStates = new Map(); // `${shopId}::${conversationId}` -> boolean
function botStateKey(conversationId, shopId) {
  return `${shopId || DEFAULT_SHOP_ID}::${String(conversationId || '')}`;
}
function isBotEnabled(conversationId, shopId) {
  if (!conversationId) return true;
  const v = botStates.get(botStateKey(conversationId, shopId));
  return v === undefined ? true : Boolean(v);
}
function setBotEnabled(conversationId, enabled, shopId) {
  botStates.set(botStateKey(conversationId, shopId), Boolean(enabled));
  markChatStateDirty();
}

/** Last webhook outcome (for /api/health + debugging). */
let lineWebhookDebug = {
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null,
  lastEventCount: 0,
};

let fbWebhookDebug = {
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null,
  lastEventCount: 0,
};

/** @type {Map<string, { kind: string; targetId: string; key: string; displayName: string | null; pictureUrl: string | null; messages: Array<{ id: string; receivedAt: string; sender: string; text?: string; image?: string }>; updatedAt: string }>} */
const fbThreads = new Map();
const fbProfileBackfillAttempts = new Map(); // threadKey -> unix ms
// Throttle re-tries for unresolved profiles. 30s is a good balance:
// long enough to avoid hammering the Graph API on every fetch, short
// enough that the seller's first conversation gets named within the
// span of reading the very first inbound message.
const FB_PROFILE_BACKFILL_COOLDOWN_MS = 30 * 1000;

/**
 * Get-or-create a Meta (Facebook / Instagram) thread. Each thread is
 * scoped to the shop that owns the receiving Page so two shops talking
 * to the same Messenger PSID get their own rows.
 *
 *   shopId — required for tenant isolation
 *   pageId — which Page received this message (used by the send path
 *            to look up the right Page Access Token; for IG threads
 *            this is the linked Page's id, not the IG account id).
 */
function getOrCreateFbThread(targetId, channel = 'fb', shopId, pageId = null) {
  const sid = shopId || DEFAULT_SHOP_ID;
  const key = `${sid}::${channel}:${targetId}`;
  if (!fbThreads.has(key)) {
    fbThreads.set(key, {
      shopId: sid,
      pageId: pageId || null,
      kind: 'user',
      channel, // 'fb' (Page DMs) or 'ig' (Instagram DMs)
      targetId,
      key,
      displayName: null,
      pictureUrl: null,
      messages: [],
      updatedAt: new Date().toISOString(),
    });
  }
  const thread = fbThreads.get(key);
  // Pin a previously-unknown pageId so reply routing can find it later.
  if (pageId && !thread.pageId) thread.pageId = pageId;
  return thread;
}

/**
 * Returns the epoch ms timestamp of the latest *customer* message in any
 * thread matching (channel, targetId) across all shops, or null when the
 * customer has never written to us. Used by sendMetaMessage to enforce
 * Meta's 24-hour reply window (see comment at the call site).
 */
function lastCustomerMessageAt(channel, targetId) {
  let latest = 0;
  for (const t of fbThreads.values()) {
    if (t.channel !== channel || t.targetId !== targetId) continue;
    for (let i = t.messages.length - 1; i >= 0; i--) {
      const m = t.messages[i];
      if (m?.sender !== 'customer') continue;
      const ms = new Date(m.receivedAt).getTime();
      if (Number.isFinite(ms) && ms > latest) latest = ms;
      break; // most recent customer turn in this thread — no need to scan further
    }
  }
  return latest > 0 ? latest : null;
}

function messengerDisplayNameFromGraph(d) {
  if (!d || typeof d !== 'object') return null;
  const fn = typeof d.first_name === 'string' ? d.first_name.trim() : '';
  const ln = typeof d.last_name === 'string' ? d.last_name.trim() : '';
  const combined = [fn, ln].filter(Boolean).join(' ').trim();
  if (combined) return combined;
  if (typeof d.name === 'string' && d.name.trim()) return d.name.trim();
  return null;
}

function messengerProfilePicFromGraph(d) {
  if (!d || typeof d !== 'object') return null;
  if (typeof d.profile_pic === 'string' && d.profile_pic) return d.profile_pic;
  const u = d?.picture?.data?.url;
  return typeof u === 'string' && u ? u : null;
}

/**
 * Resolve the Page ID we should query for this thread. Webhook caller passes
 * it explicitly; the periodic backfill loop doesn't have it, so we fall back
 * to the first OAuth-connected page.
 */
function resolvePageIdForBackfill(pageId) {
  if (pageId) return String(pageId);
  const first = listPages()[0];
  return first?.id ? String(first.id) : null;
}

/**
 * Fallback path that pulls user info from /PAGE_ID/conversations?user_id=PSID.
 * This endpoint returns `participants[].name` and works with the lighter
 * `pages_read_engagement` permission, so it succeeds for Pages whose app is
 * still in Development mode or whose review for `pages_messaging` hasn't
 * cleared yet.
 *
 * Does NOT return a profile picture — only the display name. The avatar
 * stays on the deterministic dicebear illustration until the regular
 * /{psid}?fields=profile_pic call also succeeds.
 */
async function enrichFbProfileViaConversations(psid, thread, pageId) {
  const tok = pageId ? tokenForPageId(String(pageId)) : primaryPageAccessToken();
  const targetPageId = resolvePageIdForBackfill(pageId);
  if (!tok || !targetPageId) return false;
  try {
    const url =
      `https://graph.facebook.com/${fbConfig.apiVersion}/${encodeURIComponent(targetPageId)}/conversations` +
      `?platform=messenger&user_id=${encodeURIComponent(psid)}` +
      `&fields=participants{id,name}` +
      `&access_token=${encodeURIComponent(tok)}`;
    const r = await fetch(url);
    const d = await r.json();
    if (d?.error) {
      const code = d.error.code;
      const msg = d.error.message || String(d.error);
      console.warn(`FB conversations lookup error [code=${code}] psid=${psid}:`, msg);
      // Don't overwrite an existing profileError from the primary path —
      // the user already has the more informative one.
      if (!thread.profileError) thread.profileError = `Conv#${code}: ${msg}`;
      return false;
    }
    const convs = Array.isArray(d?.data) ? d.data : [];
    for (const conv of convs) {
      const participants = conv?.participants?.data || [];
      // The page is also listed in participants; the customer is whoever isn't us.
      const customer = participants.find((p) => p?.id === psid)
        || participants.find((p) => p?.id !== targetPageId);
      if (customer?.name) {
        thread.displayName = customer.name;
        thread.profileError = null;
        thread.updatedAt = new Date().toISOString();
        markChatStateDirty();
        return true;
      }
    }
    return false;
  } catch (e) {
    console.warn('FB conversations lookup failed:', e?.message || e);
    return false;
  }
}

/**
 * Messenger Page inbox: PSID profile uses first_name/last_name (not always `name`).
 *
 * Two-step strategy because /{psid}?fields=name,profile_pic requires the
 * `pages_messaging` permission which is gated behind FB App Review:
 *   1. Try /{psid}?fields=… — succeeds for live apps, gives BOTH name + picture.
 *   2. If that fails (typical for new sellers whose app is in dev mode),
 *      fall back to /PAGE/conversations?user_id=PSID&fields=participants
 *      which works with the much easier `pages_read_engagement` scope and
 *      gives the display name (no picture).
 */
async function enrichFbProfile(psid, thread, pageId) {
  const tok = pageId ? tokenForPageId(String(pageId)) : primaryPageAccessToken();
  if (!tok) {
    thread.profileError = 'NO_PAGE_TOKEN';
    return;
  }
  try {
    const url =
      `https://graph.facebook.com/${fbConfig.apiVersion}/${encodeURIComponent(psid)}` +
      `?fields=first_name,last_name,name,profile_pic,picture.type(large){url}` +
      `&access_token=${encodeURIComponent(tok)}`;
    const r = await fetch(url);
    const d = await r.json();
    if (d?.error) {
      // Surface FB Graph error codes so the UI / Settings page can diagnose
      // why backfill is failing without needing server logs. Common codes:
      //   190 = invalid/expired access token
      //   100 = permission missing (`pages_messaging` or `pages_show_list`)
      //   200 = user hasn't messaged this page in 24h (Page-Scoped ID locked)
      const code = d.error.code;
      const msg = d.error.message || String(d.error);
      console.warn(`FB getProfile error [code=${code}] psid=${psid}:`, msg);
      thread.profileError = `FB#${code}: ${msg}`;
      // Conversations-endpoint fallback for the common case of permission denial.
      await enrichFbProfileViaConversations(psid, thread, pageId);
      return;
    }
    const display = messengerDisplayNameFromGraph(d);
    if (display) thread.displayName = display;
    const pic = messengerProfilePicFromGraph(d);
    if (pic) thread.pictureUrl = pic;
    // Clear any previous error now that we got real data.
    if (display || pic) thread.profileError = null;
    thread.updatedAt = new Date().toISOString();
    markChatStateDirty();

    // Even on a successful /{psid} call, if the picture didn't come through
    // (some apps return name only), still try the conversations endpoint —
    // doesn't help with the picture but ensures we have the best name.
    if (!display) {
      await enrichFbProfileViaConversations(psid, thread, pageId);
    }
  } catch (e) {
    console.warn('FB getProfile failed:', e?.message || e);
    thread.profileError = `network: ${e?.message || e}`;
    await enrichFbProfileViaConversations(psid, thread, pageId);
  }
}

/** Resolve the IG Business Account ID for backfill when caller didn't pass one. */
function resolveIgAccountIdForBackfill(igBusinessAccountId) {
  if (igBusinessAccountId) return String(igBusinessAccountId);
  for (const p of listPages()) {
    const ig = p?.instagram;
    if (ig?.id) return String(ig.id);
  }
  return null;
}

/**
 * Same trick as enrichFbProfileViaConversations but for Instagram —
 * participants[].name + participants[].username gives us "Display Name (@handle)".
 */
async function enrichIgProfileViaConversations(igsid, thread, igAccountId) {
  const tok = igAccountId
    ? tokenForIgId(String(igAccountId)) || primaryPageAccessToken()
    : primaryPageAccessToken();
  const targetIgId = resolveIgAccountIdForBackfill(igAccountId);
  if (!tok || !targetIgId) return false;
  try {
    const url =
      `https://graph.facebook.com/${fbConfig.apiVersion}/${encodeURIComponent(targetIgId)}/conversations` +
      `?platform=instagram&user_id=${encodeURIComponent(igsid)}` +
      `&fields=participants{id,name,username}` +
      `&access_token=${encodeURIComponent(tok)}`;
    const r = await fetch(url);
    const d = await r.json();
    if (d?.error) {
      const code = d.error.code;
      const msg = d.error.message || String(d.error);
      console.warn(`IG conversations lookup error [code=${code}] igsid=${igsid}:`, msg);
      if (!thread.profileError) thread.profileError = `Conv#${code}: ${msg}`;
      return false;
    }
    const convs = Array.isArray(d?.data) ? d.data : [];
    for (const conv of convs) {
      const participants = conv?.participants?.data || [];
      const customer = participants.find((p) => p?.id === igsid)
        || participants.find((p) => p?.id !== targetIgId);
      if (!customer) continue;
      const nm = typeof customer.name === 'string' ? customer.name.trim() : '';
      const un = typeof customer.username === 'string' ? customer.username.trim() : '';
      let name = null;
      if (nm && un) name = `${nm} (@${un})`;
      else if (un) name = `@${un}`;
      else if (nm) name = nm;
      if (name) {
        thread.displayName = name;
        thread.profileError = null;
        thread.updatedAt = new Date().toISOString();
        markChatStateDirty();
        return true;
      }
    }
    return false;
  } catch (e) {
    console.warn('IG conversations lookup failed:', e?.message || e);
    return false;
  }
}

/** Instagram Messaging: sender id is IGSID — different fields than Messenger PSID. */
async function enrichIgProfile(igsid, thread, igBusinessAccountId) {
  const tok = igBusinessAccountId
    ? tokenForIgId(String(igBusinessAccountId)) || primaryPageAccessToken()
    : primaryPageAccessToken();
  if (!tok) {
    thread.profileError = 'NO_PAGE_TOKEN';
    return;
  }
  try {
    const url =
      `https://graph.facebook.com/${fbConfig.apiVersion}/${encodeURIComponent(igsid)}` +
      `?fields=name,username,profile_picture_url` +
      `&access_token=${encodeURIComponent(tok)}`;
    const r = await fetch(url);
    const d = await r.json();
    if (d?.error) {
      const code = d.error.code;
      const msg = d.error.message || String(d.error);
      console.warn(`IG getProfile error [code=${code}] igsid=${igsid}:`, msg);
      thread.profileError = `IG#${code}: ${msg}`;
      await enrichIgProfileViaConversations(igsid, thread, igBusinessAccountId);
      return;
    }
    const un = typeof d.username === 'string' ? d.username.trim() : '';
    const nm = typeof d.name === 'string' ? d.name.trim() : '';
    if (nm && un) thread.displayName = `${nm} (@${un})`;
    else if (un) thread.displayName = `@${un}`;
    else if (nm) thread.displayName = nm;
    const pic = typeof d.profile_picture_url === 'string' ? d.profile_picture_url : null;
    if (pic) thread.pictureUrl = pic;
    if (thread.displayName || pic) thread.profileError = null;
    thread.updatedAt = new Date().toISOString();
    markChatStateDirty();

    if (!thread.displayName) {
      await enrichIgProfileViaConversations(igsid, thread, igBusinessAccountId);
    }
  } catch (e) {
    console.warn('IG getProfile failed:', e?.message || e);
    thread.profileError = `network: ${e?.message || e}`;
    await enrichIgProfileViaConversations(igsid, thread, igBusinessAccountId);
  }
}

function fbLastSnippet(m) {
  if (!m) return '';
  if (m.text) return String(m.text).slice(0, 120);
  if (m.video) return 'Video';
  if (m.image) return 'Photo';
  return '';
}

/** Messenger + Instagram DM: attachments often include payload.url; otherwise resolve via Graph (see fetchMessengerAttachmentsFromMid). */
function metaMessagingMediaFromEvent(ev) {
  const msg = ev?.message;
  let textOut = typeof msg?.text === 'string' ? msg.text.trim() : '';
  if (!textOut) textOut = null;
  let imageUrl = null;
  let videoUrl = null;
  // Detect stickers: explicit sticker_id field OR any attachment with type='sticker'
  let isSticker = Boolean(msg?.sticker_id);
  for (const att of msg?.attachments || []) {
    const u = att?.payload?.url;
    const t = String(att.type || '').toLowerCase();
    if (t === 'sticker') isSticker = true;
    if (typeof u === 'string' && /^https?:\/\//i.test(u)) {
      if (t === 'image' || t === 'sticker' || t === 'story_mention') {
        if (!imageUrl) imageUrl = u;
      } else if (t === 'video' || t === 'ig_reel' || t === 'reel') {
        if (!videoUrl) videoUrl = u;
      } else if (t === 'audio') {
        if (!videoUrl) videoUrl = u;
      } else if (t === 'file') {
        if (/\.(jpe?g|png|gif|webp)(\?|$)/i.test(u)) {
          if (!imageUrl) imageUrl = u;
        } else if (!videoUrl) {
          videoUrl = u;
        }
      } else if (t === 'share' || t === 'fallback') {
        if (!imageUrl) imageUrl = u;
      }
      continue;
    }
  }
  if (!textOut && !imageUrl && !videoUrl && msg?.attachments?.length) {
    textOut = `[${msg.attachments[0].type || 'attachment'}]`;
  }
  return { textOut, imageUrl, videoUrl, isSticker };
}

/**
 * Some Meta stickers arrive as regular "image" attachments (without explicit
 * `type=sticker`), so we need URL/payload heuristics to avoid slip checks.
 */
function looksLikeMetaStickerAttachment(ev, imageUrl) {
  const msg = ev?.message;
  if (!msg) return false;
  if (msg?.sticker_id) return true;
  for (const att of msg?.attachments || []) {
    const t = String(att?.type || '').toLowerCase();
    if (t === 'sticker') return true;
    const payloadSticker = att?.payload?.sticker_id;
    if (payloadSticker) return true;
    const payloadType = String(att?.payload?.type || '').toLowerCase();
    if (payloadType === 'sticker') return true;
  }
  const u = String(imageUrl || '').toLowerCase();
  if (!u) return false;
  // Common CDN/path hints for sticker assets.
  if (u.includes('sticker') || u.includes('/stickers/') || u.includes('emoji')) return true;
  return false;
}

/**
 * When webhook attachments omit payload.url (common for Instagram), Meta still provides message `mid`.
 * Pages API: GET /{mid}/attachments → data[].file_url + mime_type.
 */
async function fetchMessengerAttachmentsFromMid(pageAccessToken, messageMid) {
  const out = { imageUrl: null, videoUrl: null };
  if (!pageAccessToken || !messageMid) return out;
  const url = `https://graph.facebook.com/${fbConfig.apiVersion}/${encodeURIComponent(messageMid)}/attachments?access_token=${encodeURIComponent(pageAccessToken)}`;
  try {
    const r = await fetch(url);
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data?.error) {
      console.warn('[Meta] GET .../attachments failed:', messageMid, data?.error?.message || r.status);
      return out;
    }
    const list = Array.isArray(data?.data) ? data.data : [];
    for (const a of list) {
      const fu = a?.file_url;
      if (typeof fu !== 'string' || !/^https?:\/\//i.test(fu)) continue;
      const mt = String(a.mime_type || '').toLowerCase();
      if (mt.startsWith('video/')) {
        if (!out.videoUrl) out.videoUrl = fu;
      } else if (mt.startsWith('image/')) {
        if (!out.imageUrl) out.imageUrl = fu;
      } else if (mt.startsWith('audio/')) {
        if (!out.videoUrl) out.videoUrl = fu;
      } else if (!out.imageUrl && !out.videoUrl) {
        if (!out.imageUrl) out.imageUrl = fu;
      }
    }
  } catch (e) {
    console.warn('[Meta] attachments fetch error:', messageMid, e?.message || e);
  }
  return out;
}

const META_PLACEHOLDER_TEXT = /^\[(image|video|audio|file|attachment|ig_reel|reel|story_mention|sticker|photo|share|fallback)\]$/i;

function stripMetaMediaPlaceholderText(textOut, imageUrl, videoUrl) {
  if (!(imageUrl || videoUrl) || textOut == null) return textOut;
  const s = String(textOut).trim();
  if (META_PLACEHOLDER_TEXT.test(s)) return null;
  return textOut;
}

function fbThreadToApiConversation(thread) {
  const isIg = thread.channel === 'ig';
  const id = isIg ? `ig:user:${thread.targetId}` : `fb:user:${thread.targetId}`;
  const last = thread.messages[thread.messages.length - 1];
  // Friendly fallback when the Graph API hasn't returned a real name yet.
  // Old format "FB • 21015838" read as a raw system ID to sellers; the new
  // form uses Thai user-friendly wording with just the last 4 digits — short
  // enough to read at a glance, unique enough to distinguish two pending
  // backfills. looksFallbackDisplayName() matches BOTH formats for back-compat
  // with persisted chat-store data.
  const fallback = isIg
    ? `ลูกค้า Instagram #${String(thread.targetId).slice(-4)}`
    : `ลูกค้า Facebook #${String(thread.targetId).slice(-4)}`;
  const seedColor = isIg ? 'E4405F' : '1877F2';
  const name = thread.displayName || fallback;
  const avatar =
    thread.pictureUrl ||
    `https://api.dicebear.com/7.x/notionists/svg?seed=${encodeURIComponent(thread.targetId)}&backgroundColor=${seedColor}`;
  return {
    id,
    customerName: name,
    channel: isIg ? 'ig' : 'facebook',
    avatar,
    lastSnippet: fbLastSnippet(last),
    updatedAt: thread.updatedAt,
    unread: 0,
    online: false,
    botEnabled: isBotEnabled(id, thread.shopId),
    messages: thread.messages.map((m) => ({
      id: m.id,
      sender: m.sender,
      text: m.text,
      image: m.image,
      video: m.video,
      receivedAt: m.receivedAt,
      meta: m.meta,
    })),
  };
}

function looksFallbackDisplayName(name, channel) {
  if (!name || typeof name !== 'string') return true;
  const s = name.trim();
  if (!s) return true;
  if (channel === 'ig') {
    // Matches both old "IG • 21015838" and new "ลูกค้า Instagram #5838".
    return /^IG\s+•\s+/i.test(s) || /^ลูกค้า\s+Instagram\s+#/i.test(s);
  }
  return /^FB\s+•\s+/i.test(s) || /^ลูกค้า\s+Facebook\s+#/i.test(s);
}

function scheduleFbProfileBackfill() {
  const now = Date.now();
  for (const thread of fbThreads.values()) {
    const missingName = looksFallbackDisplayName(thread.displayName, thread.channel);
    if (!missingName) continue;
    const lastTryAt = fbProfileBackfillAttempts.get(thread.key) || 0;
    if (now - lastTryAt < FB_PROFILE_BACKFILL_COOLDOWN_MS) continue;
    fbProfileBackfillAttempts.set(thread.key, now);
    if (thread.channel === 'ig') {
      void enrichIgProfile(thread.targetId, thread, null);
    } else {
      void enrichFbProfile(thread.targetId, thread, null);
    }
  }
}

function verifyFbSignature(rawBody, signatureHeader) {
  if (!fbHasAppSecret) return null; // skipped
  if (!signatureHeader || typeof signatureHeader !== 'string') return false;
  const m = signatureHeader.match(/^sha256=([0-9a-f]+)$/i);
  if (!m) return false;
  const expected = crypto.createHmac('sha256', fbConfig.appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(m[1], 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** @type {Map<string, { kind: string; targetId: string; key: string; displayName: string | null; pictureUrl: string | null; messages: Array<{ id: string; receivedAt: string; sender: string; text?: string; image?: string; video?: string }>; updatedAt: string }>} */
const lineThreads = new Map();
let chatStateSaveTimer = null;
let chatStateSaveInFlight = false;

function toIsoOrNow(v) {
  if (typeof v === 'string' && !Number.isNaN(new Date(v).getTime())) return v;
  return new Date().toISOString();
}

function normalizeThreadMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((m) => {
    // Strip legacy `meta.slip` with status === 'failed' — those were
    // attached to non-slip images (product photos etc.) by the old
    // maybeAttachSlip behavior. The fixed version no longer attaches
    // failed results, so loading old chat-store.json data should drop them.
    let meta = m?.meta && typeof m.meta === 'object' ? m.meta : undefined;
    if (meta?.slip?.status === 'failed') {
      const { slip: _drop, ...rest } = meta;
      meta = Object.keys(rest).length ? rest : undefined;
    }
    return {
      id: String(m?.id || crypto.randomUUID()),
      receivedAt: toIsoOrNow(m?.receivedAt),
      sender: m?.sender === 'agent' || m?.sender === 'ai' ? m.sender : 'customer',
      text: typeof m?.text === 'string' ? m.text : undefined,
      image: typeof m?.image === 'string' ? m.image : undefined,
      video: typeof m?.video === 'string' ? m.video : undefined,
      meta,
    };
  });
}

function serializeChatState() {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    lineThreads: Array.from(lineThreads.values()),
    fbThreads: Array.from(fbThreads.values()),
    botStates: Object.fromEntries(botStates.entries()),
  };
}

function ensureServerDir() {
  if (!existsSync(__dirname)) mkdirSync(__dirname, { recursive: true });
}

function loadPersistedChatStateSync() {
  try {
    if (!existsSync(CHAT_STORE_FILE)) return;
    const raw = JSON.parse(readFileSync(CHAT_STORE_FILE, 'utf8'));
    const line = Array.isArray(raw?.lineThreads) ? raw.lineThreads : [];
    for (const t of line) {
      const kind = t?.kind === 'group' || t?.kind === 'room' ? t.kind : 'user';
      const targetId = String(t?.targetId || '');
      if (!targetId) continue;
      // Existing snapshots predate per-shop thread keys — default them to the
      // legacy single shop so they keep showing up after upgrade.
      const shopId = typeof t?.shopId === 'string' && t.shopId ? t.shopId : DEFAULT_SHOP_ID;
      const key = `${shopId}::${kind}:${targetId}`;
      lineThreads.set(key, {
        shopId,
        kind,
        targetId,
        key,
        displayName: typeof t?.displayName === 'string' ? t.displayName : null,
        pictureUrl: typeof t?.pictureUrl === 'string' ? t.pictureUrl : null,
        messages: normalizeThreadMessages(t?.messages),
        updatedAt: toIsoOrNow(t?.updatedAt),
      });
    }

    const fb = Array.isArray(raw?.fbThreads) ? raw.fbThreads : [];
    for (const t of fb) {
      const channel = t?.channel === 'ig' ? 'ig' : 'fb';
      const targetId = String(t?.targetId || '');
      if (!targetId) continue;
      // Pre-v3 snapshots have no shopId on the thread — default to the
      // legacy single shop so old data stays visible after upgrade.
      const shopId = typeof t?.shopId === 'string' && t.shopId ? t.shopId : DEFAULT_SHOP_ID;
      const pageId = typeof t?.pageId === 'string' && t.pageId ? t.pageId : null;
      const key = `${shopId}::${channel}:${targetId}`;
      fbThreads.set(key, {
        shopId,
        pageId,
        kind: 'user',
        channel,
        targetId,
        key,
        displayName: typeof t?.displayName === 'string' ? t.displayName : null,
        pictureUrl: typeof t?.pictureUrl === 'string' ? t.pictureUrl : null,
        messages: normalizeThreadMessages(t?.messages),
        updatedAt: toIsoOrNow(t?.updatedAt),
      });
    }

    const botObj = raw?.botStates && typeof raw.botStates === 'object' ? raw.botStates : null;
    if (botObj) {
      for (const [k, v] of Object.entries(botObj)) {
        // Pre-shop snapshots stored keys like 'line:user:Uxxx' directly.
        // Auto-migrate by prepending DEFAULT_SHOP_ID so existing single-tenant
        // installs keep their bot toggles after upgrade.
        const key = k.includes('::') ? k : botStateKey(k, DEFAULT_SHOP_ID);
        botStates.set(key, Boolean(v));
      }
    }
    console.log(
      '[chat-store] loaded',
      `line=${lineThreads.size}`,
      `fb=${fbThreads.size}`,
      `botStates=${botStates.size}`,
    );
  } catch (e) {
    console.warn('[chat-store] load failed:', e?.message || e);
  }
}

/**
 * Chat-state persistence — durable when Postgres is wired up, file-only
 * otherwise. The KV-backed write is the durable path: on Railway and
 * similar platforms the filesystem is ephemeral (wiped on every deploy /
 * crash), so a JSON-only setup loses all chat history on restart.
 *
 * Write strategy:
 *   - Always serialize once per debounce tick.
 *   - Best-effort write to `chat.store.v1` via kvSet (no-op if no DB).
 *   - Best-effort write to the JSON file (so single-tenant dev still
 *     works without Postgres + so local backup exists).
 * The two writes are independent — one failing doesn't block the other.
 *
 * Read strategy (loadPersistedChatStateSync still runs sync at boot;
 * loadPersistedChatStateFromKv runs once asynchronously after that to
 * pick up anything KV had that the file didn't).
 */
const CHAT_STATE_KV_KEY = 'chat.store.v1';

async function persistChatStateNow() {
  if (chatStateSaveInFlight) return;
  chatStateSaveInFlight = true;
  try {
    const snapshot = serializeChatState();
    // Durable write first — single source of truth when Postgres is set up.
    try {
      await kvSet(CHAT_STATE_KV_KEY, snapshot);
    } catch (e) {
      console.warn('[chat-store] kv save failed:', e?.message || e);
    }
    // File write as a local cache / dev fallback. Failure here is fine
    // when running on a read-only or ephemeral filesystem.
    try {
      ensureServerDir();
      await writeFile(CHAT_STORE_FILE, JSON.stringify(snapshot, null, 2), 'utf8');
    } catch (e) {
      if (!process.env.SUPPRESS_CHAT_STORE_FILE_WARN) {
        console.warn('[chat-store] file save failed:', e?.message || e);
      }
    }
  } finally {
    chatStateSaveInFlight = false;
  }
}

/**
 * One-shot async loader: if KV has a fresher snapshot than what the sync
 * file load brought in (typical after a redeploy where the file is gone),
 * merge it into memory. Called once at boot, after the sync load.
 */
async function loadPersistedChatStateFromKv() {
  try {
    const raw = await kvGet(CHAT_STATE_KV_KEY, null);
    if (!raw || typeof raw !== 'object') return;
    // Only hydrate if memory is still empty — file load wins if both are
    // present and consistent, since the file is more recent on a hot box.
    if (lineThreads.size > 0 || fbThreads.size > 0) return;

    const lineArr = Array.isArray(raw.lineThreads) ? raw.lineThreads : [];
    for (const t of lineArr) {
      const kind = t?.kind === 'group' || t?.kind === 'room' ? t.kind : 'user';
      const targetId = String(t?.targetId || '');
      if (!targetId) continue;
      const shopId = typeof t?.shopId === 'string' && t.shopId ? t.shopId : DEFAULT_SHOP_ID;
      const key = `${shopId}::${kind}:${targetId}`;
      lineThreads.set(key, {
        shopId,
        kind,
        targetId,
        key,
        displayName: typeof t?.displayName === 'string' ? t.displayName : null,
        pictureUrl: typeof t?.pictureUrl === 'string' ? t.pictureUrl : null,
        messages: normalizeThreadMessages(t?.messages),
        updatedAt: toIsoOrNow(t?.updatedAt),
      });
    }
    const fbArr = Array.isArray(raw.fbThreads) ? raw.fbThreads : [];
    for (const t of fbArr) {
      const channel = t?.channel === 'ig' ? 'ig' : 'fb';
      const targetId = String(t?.targetId || '');
      if (!targetId) continue;
      const shopId = typeof t?.shopId === 'string' && t.shopId ? t.shopId : DEFAULT_SHOP_ID;
      const pageId = typeof t?.pageId === 'string' && t.pageId ? t.pageId : null;
      const key = `${shopId}::${channel}:${targetId}`;
      fbThreads.set(key, {
        shopId,
        pageId,
        kind: 'user',
        channel,
        targetId,
        key,
        displayName: typeof t?.displayName === 'string' ? t.displayName : null,
        pictureUrl: typeof t?.pictureUrl === 'string' ? t.pictureUrl : null,
        messages: normalizeThreadMessages(t?.messages),
        updatedAt: toIsoOrNow(t?.updatedAt),
      });
    }
    if (lineThreads.size + fbThreads.size > 0) {
      console.log(`[chat-store] hydrated from KV (line=${lineThreads.size}, fb=${fbThreads.size})`);
    }
  } catch (e) {
    console.warn('[chat-store] kv load failed:', e?.message || e);
  }
}

function markChatStateDirty() {
  if (chatStateSaveTimer) clearTimeout(chatStateSaveTimer);
  chatStateSaveTimer = setTimeout(() => {
    chatStateSaveTimer = null;
    void persistChatStateNow();
  }, 450);
  scheduleInboxBroadcast();
}

/**
 * Server-Sent Events fan-out for the inbox. Any thread mutation calls
 * markChatStateDirty(), which schedules a coalesced broadcast (≤120ms) to all
 * connected `/api/inbox/stream` clients. Clients react by re-fetching the
 * conversation lists — that keeps the wire format trivial (no diff payload)
 * while still giving sub-second feel vs the 2.5s polling we used before.
 */
const inboxSubscribers = new Set();
let inboxBroadcastTimer = null;
let inboxVersion = 0;

/**
 * In-memory sliding-window rate limiter — keyed by (bucket, identifier).
 * Designed for webhook endpoints where the identifier is the requester IP.
 * We deliberately don't pull in `express-rate-limit` because we want zero new
 * deps + transparent behaviour during incident response. For multi-instance
 * deployments this should be replaced with Redis or a managed gateway.
 */
const rateLimitBuckets = new Map(); // bucket => Map<ip, number[]>
function rateLimit({ bucket, limit, windowMs }) {
  return (req, res, next) => {
    // Prefer X-Forwarded-For when behind Railway/Cloudflare so real IPs are
    // counted (not the proxy's single shared IP). Fall back to req.ip.
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = xff || req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `${ip}`;
    let store = rateLimitBuckets.get(bucket);
    if (!store) {
      store = new Map();
      rateLimitBuckets.set(bucket, store);
    }
    const now = Date.now();
    const cutoff = now - windowMs;
    const hits = (store.get(key) || []).filter((t) => t > cutoff);
    if (hits.length >= limit) {
      const oldest = hits[0];
      const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      res.set('Retry-After', String(retryAfterSec));
      res.status(429).json({ error: 'rate_limited', retryAfter: retryAfterSec });
      return;
    }
    hits.push(now);
    store.set(key, hits);
    // Periodic cheap GC: every ~200 calls per bucket, drop empty entries.
    if (hits.length === 1 && store.size > 200) {
      for (const [k, arr] of Array.from(store.entries())) {
        if (arr.every((t) => t <= cutoff)) store.delete(k);
      }
    }
    next();
  };
}

function scheduleInboxBroadcast() {
  if (inboxBroadcastTimer) return;
  inboxBroadcastTimer = setTimeout(() => {
    inboxBroadcastTimer = null;
    inboxVersion += 1;
    const payload = `data: ${JSON.stringify({ v: inboxVersion, at: Date.now() })}\n\n`;
    for (const res of inboxSubscribers) {
      try {
        res.write(payload);
      } catch {
        inboxSubscribers.delete(res);
      }
    }
  }, 120);
}

function pushEvent(item) {
  eventsBuffer.unshift(item);
  if (eventsBuffer.length > MAX_EVENTS) eventsBuffer.length = MAX_EVENTS;
}

loadPersistedChatStateSync();
// KV is async — fire-and-forget after the sync file load. Threads loaded
// from file are kept; KV only fills the gap on a fresh box where the JSON
// file got wiped (ephemeral disk on redeploy).
void loadPersistedChatStateFromKv();

let lineClient = lineConfig.channelAccessToken
  ? new line.messagingApi.MessagingApiClient({ channelAccessToken: lineConfig.channelAccessToken })
  : null;

/** Rebuild the LINE messaging client when channelAccessToken changes. */
function rebuildLineClient() {
  if (lineConfig.channelAccessToken) {
    lineClient = new line.messagingApi.MessagingApiClient({
      channelAccessToken: lineConfig.channelAccessToken,
    });
  } else {
    lineClient = null;
  }
}

/** Ask LINE who the bot is (basicId + displayName + pictureUrl), to verify the
 *  channel access token and to show the OA name in the UI. Returns null on failure. */
async function fetchLineBotInfo(token) {
  try {
    const r = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j?.userId) return null;
    return {
      userId: j.userId,
      basicId: j.basicId || null,
      displayName: j.displayName || null,
      pictureUrl: j.pictureUrl || null,
      chatMode: j.chatMode || null,
      markAsReadMode: j.markAsReadMode || null,
    };
  } catch (e) {
    console.warn('[LINE] fetchLineBotInfo failed:', e?.message || e);
    return null;
  }
}

/** Apply a new pair of secret + token, rebuild client. Also kicks an async
 *  /bot/info fetch (non-blocking) so UI status reflects the OA identity. */
async function applyLineConfig({ secret, token, source }) {
  lineConfig.channelSecret = (secret || '').trim();
  lineConfig.channelAccessToken = (token || '').trim();
  lineConfig.source = source || null;
  rebuildLineClient();
  if (lineConfig.channelAccessToken) {
    lineConfig.botInfo = await fetchLineBotInfo(lineConfig.channelAccessToken);
  } else {
    lineConfig.botInfo = null;
  }
}

/**
 * On boot, populate the per-shop config cache from KV and build the OA-to-shop
 * webhook routing index. Handles a one-time migration: if the legacy
 * single-tenant key (line.config.v1) is present and the default shop has no
 * per-shop key yet, copy it over so existing installs upgrade cleanly.
 */
async function loadPersistedLineConfig() {
  // 1. Migration step — legacy global key → DEFAULT_SHOP per-shop key.
  try {
    const legacy = await kvGet(LINE_KV_KEY, null);
    const defaultShopKey = lineKvKeyForShop(DEFAULT_SHOP_ID);
    const existing = await kvGet(defaultShopKey, null);
    if (
      legacy &&
      typeof legacy === 'object' &&
      (legacy.channelSecret || legacy.channelAccessToken) &&
      !existing
    ) {
      await kvSet(defaultShopKey, {
        channelSecret: legacy.channelSecret,
        channelAccessToken: legacy.channelAccessToken,
        botInfo: legacy.botInfo || null,
        source: legacy.source || 'ui',
        savedAt: new Date().toISOString(),
      });
      console.log('[LINE] migrated legacy global config to default shop');
    }
  } catch (e) {
    console.warn('[LINE] legacy migration failed:', e?.message || e);
  }

  // 2. Load the default shop's config into memory + compat globals so
  //    code paths that still read the singleton work out of the box.
  try {
    const entry = await loadLineConfigForShop(DEFAULT_SHOP_ID);
    if (entry) {
      lineConfig.channelSecret = entry.channelSecret;
      lineConfig.channelAccessToken = entry.channelAccessToken;
      lineConfig.source = entry.source;
      lineConfig.botInfo = entry.botInfo;
      return;
    }
  } catch (e) {
    console.warn('[LINE] load default shop config failed:', e?.message || e);
  }

  // 3. env-only fallback for fresh installs.
  if (lineConfig.channelAccessToken) {
    lineConfig.botInfo = await fetchLineBotInfo(lineConfig.channelAccessToken);
  }
}

function sourceKey(source) {
  if (!source) return null;
  if (source.type === 'user' && source.userId) {
    return { kind: 'user', targetId: source.userId, key: `user:${source.userId}` };
  }
  if (source.type === 'group' && source.groupId) {
    return { kind: 'group', targetId: source.groupId, key: `group:${source.groupId}` };
  }
  if (source.type === 'room' && source.roomId) {
    return { kind: 'room', targetId: source.roomId, key: `room:${source.roomId}` };
  }
  return null;
}

/**
 * Get-or-create a LINE thread. `shopId` is required so threads stay isolated
 * between tenants — two shops talking to the same person (same LINE userId)
 * each get their own thread row, and the inbox API filters by the caller's
 * active shop.
 *
 * Key format intentionally embeds shopId so a JSON snapshot of `lineThreads`
 * round-trips correctly without us having to remember to set thread.shopId
 * on every write site.
 */
function getOrCreateThread(kind, targetId, shopId) {
  const sid = shopId || DEFAULT_SHOP_ID;
  const key = `${sid}::${kind}:${targetId}`;
  if (!lineThreads.has(key)) {
    lineThreads.set(key, {
      shopId: sid,
      kind,
      targetId,
      key,
      displayName: null,
      pictureUrl: null,
      messages: [],
      updatedAt: new Date().toISOString(),
    });
  }
  return lineThreads.get(key);
}

/** ASCII-only so the file never breaks on non-UTF8 shells. */
function labelForNonText(message) {
  if (!message) return null;
  switch (message.type) {
    case 'image':
      return '[Photo]';
    case 'sticker':
      return '[Sticker]';
    case 'video':
      return '[Video]';
    case 'audio':
      return '[Audio]';
    case 'location':
      return '[Location]';
    case 'file':
      return '[File]';
    default:
      return `[${message.type}]`;
  }
}

/** LINE webhook image/video URLs (contentProvider or top-level fields). */
function extractLineMedia(message) {
  if (!message || typeof message !== 'object') return { image: null, video: null };
  const cp = message.contentProvider;
  const orig = (cp && cp.originalContentUrl) || message.originalContentUrl;
  const prev = (cp && cp.previewImageUrl) || message.previewImageUrl;
  if (message.type === 'image') {
    const url = orig || prev;
    return { image: typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null, video: null };
  }
  if (message.type === 'video') {
    const vid = orig;
    const poster = prev;
    return {
      image: typeof poster === 'string' && /^https?:\/\//i.test(poster) ? poster : null,
      video: typeof vid === 'string' && /^https?:\/\//i.test(vid) ? vid : null,
    };
  }
  return { image: null, video: null };
}

function lastSnippetFromMessage(m) {
  if (!m) return '';
  if (m.text) return String(m.text).slice(0, 120);
  if (m.video) return '[Video]';
  if (m.image) return '[Photo]';
  return '';
}

/**
 * Build a Messaging API client for the THREAD'S shop, not whichever shop
 * the global compat happens to hold right now. With multiple shops on one
 * deployment, the global token could be Shop A's while a Shop B webhook is
 * being processed — that would hit /getProfile with the wrong OA's token
 * and return 401 (or worse, leak Shop A's customer data).
 */
async function lineClientForShop(shopId) {
  const entry = await loadLineConfigForShop(shopId || DEFAULT_SHOP_ID);
  const token = entry?.channelAccessToken || lineConfig.channelAccessToken;
  if (!token) return null;
  return new line.messagingApi.MessagingApiClient({ channelAccessToken: token });
}

async function enrichUserProfile(userId, thread) {
  const client = await lineClientForShop(thread.shopId);
  if (!client) return;
  try {
    const p = await client.getProfile(userId);
    thread.displayName = p.displayName;
    thread.pictureUrl = p.pictureUrl;
    thread.updatedAt = new Date().toISOString();
    markChatStateDirty();
  } catch (e) {
    console.warn('LINE getProfile failed:', e?.message || e);
  }
}

async function enrichGroupSummary(groupId, thread) {
  const client = await lineClientForShop(thread.shopId);
  if (!client) return;
  try {
    const p = await client.getGroupSummary(groupId);
    if (p?.groupName) thread.displayName = p.groupName;
    if (p?.pictureUrl) thread.pictureUrl = p.pictureUrl;
    thread.updatedAt = new Date().toISOString();
    markChatStateDirty();
  } catch (e) {
    console.warn('LINE getGroupSummary failed:', e?.message || e);
  }
}

const lineProfileBackfillAttempts = new Map(); // threadKey -> unix ms
const LINE_PROFILE_BACKFILL_COOLDOWN_MS = 90 * 1000;

function looksFallbackLineDisplayName(name) {
  if (!name || typeof name !== 'string') return true;
  const s = name.trim();
  if (!s) return true;
  // Exact shapes produced by threadToApiConversation when displayName is null.
  return /^LINE [A-Za-z0-9]{8}$/.test(s) || /^LINE group [A-Za-z0-9]{6}$/.test(s);
}

/**
 * Periodic name/avatar backfill for LINE threads that still show fallback
 * ids — mirrors scheduleFbProfileBackfill. Runs whenever the UI hits
 * /api/line/conversations, with a per-thread cooldown so we don't hammer the
 * Messaging API on every poll. Rooms have no name endpoint in the LINE SDK,
 * so we skip them and accept the "LINE room XXXXXX" fallback.
 */
function scheduleLineProfileBackfill() {
  if (!lineClient) return;
  const now = Date.now();
  for (const thread of lineThreads.values()) {
    if (!looksFallbackLineDisplayName(thread.displayName)) continue;
    const lastTryAt = lineProfileBackfillAttempts.get(thread.key) || 0;
    if (now - lastTryAt < LINE_PROFILE_BACKFILL_COOLDOWN_MS) continue;
    lineProfileBackfillAttempts.set(thread.key, now);
    if (thread.kind === 'user') {
      void enrichUserProfile(thread.targetId, thread);
    } else if (thread.kind === 'group') {
      void enrichGroupSummary(thread.targetId, thread);
    }
  }
}

/**
 * LINE images: the public URL is only available for "external" content providers.
 * For LINE-hosted media we must call the data-api with our channel token.
 */
async function fetchLineMessageBytes(messageId) {
  if (!lineClient || !messageId) return null;
  try {
    const blobClient = new line.messagingApi.MessagingApiBlobClient({
      channelAccessToken: lineConfig.channelAccessToken,
    });
    const stream = await blobClient.getMessageContent(messageId);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  } catch (e) {
    console.warn('LINE getMessageContent failed:', messageId, e?.message || e);
    return null;
  }
}

/**
 * Run slip verification for a freshly-received image, persist the record, and
 * mutate the chat message in place so it carries `meta.slip`. Errors are
 * swallowed — the chat keeps working even if slip checking is down.
 *
 * IMPORTANT: A `failed` result is NOT attached to the message anymore.
 * Customers send all kinds of images (product photos, Pokémon cards, selfies)
 * and EasySlip returns VALIDATION_ERROR for anything that isn't a transfer
 * slip. Attaching a "slip failed" card to every non-slip image was misleading
 * sellers into thinking real customers were trying to cheat. Now: if the API
 * can't extract a slip, the image just renders as a normal photo.
 *
 * The record is still persisted in the slips store for the admin's Slips
 * page, so they can audit verification attempts and retry manually if needed.
 */
async function maybeAttachSlip({
  channel,
  conversationId,
  message,           // pushed-onto-thread row, mutated in place
  thread,            // owning thread, used for customer name/avatar
  imageUrl,          // public URL if we have one
  buffer,            // raw bytes (for LINE)
  mime,
}) {
  if (!message || !(imageUrl || buffer)) return;
  try {
    const verified = await verifySlipBytes({ imageUrl, buffer, mime });
    const result = recordSlip(verified, {
      channel,
      conversationId,
      messageId: message.id,
      customerName: thread.displayName || conversationId,
      customerAvatar: thread.pictureUrl || '',
      imageUrl: imageUrl || null,
      // Stamp the receiving shop so /api/slips can filter and slip pages
      // never leak between tenants.
      shopId: thread.shopId || DEFAULT_SHOP_ID,
    });
    // Persist the verification attempt to the audit table — including
    // `failed` results that we deliberately DON'T surface as slip cards.
    // The shop owner can audit "is anyone trying to send fake slips?" later
    // even though those images render as normal photos in the chat.
    void recordSlipVerificationAttempt({
      source: 'webhook',
      shopId: thread.shopId || DEFAULT_SHOP_ID,
      channel,
      convId: conversationId,
      imageUrl: imageUrl || null,
      result: verified,
      userId: null,
    });
    // Only attach the slip card to the chat message when verification
    // actually produced useful info. `failed` = it wasn't a slip → leave
    // the image as a regular photo.
    if (result?.status === 'verified' || result?.status === 'duplicate' || result?.status === 'pending') {
      message.meta = { ...(message.meta || {}), slip: result };
    }
    thread.updatedAt = new Date().toISOString();
    markChatStateDirty();

    // AI thank-you + ask for shipping info — only when:
    //   * slip verified by EasySlip (not mock, not failed/duplicate)
    //   * autoSlipConfirm is on in Settings → Bot
    //   * bot is enabled for this conversation
    if (
      result?.status === 'verified' &&
      !result?.mock &&
      isAiEnabled() &&
      isBotEnabled(conversationId, thread.shopId)
    ) {
      void (async () => {
        try {
          // Use the THREAD'S shop, not whatever shop the global compat has
          // loaded — slip thank-yous must follow the OA that received the slip.
          const settings = await getBotSettingsForShop(thread.shopId || DEFAULT_SHOP_ID);
          if (settings && settings.autoSlipConfirm === false) return;
          const text = await generateSlipThankYou({
            customerName: thread.displayName || '',
            amount: result.amount,
            bank: result.bank,
            botSettings: settings || {},
          });
          if (!text) return;
          if (channel === 'line') {
            await sendLineMessage({ conversationId, text, asAi: true });
          } else {
            await sendMetaMessage({ conversationId, text, asAi: true });
          }
        } catch (e) {
          console.warn('[ai] slip thank-you failed:', e?.message || e);
        }
      })();
    }
  } catch (e) {
    console.warn('[slip] verify failed:', e?.message || e);
  }
}

function threadToApiConversation(thread) {
  const id = `line:${thread.kind}:${thread.targetId}`;
  const last = thread.messages[thread.messages.length - 1];
  const name =
    thread.displayName ||
    (thread.kind === 'group'
      ? `LINE group ${String(thread.targetId).slice(-6)}`
      : `LINE ${String(thread.targetId).slice(-8)}`);
  const avatar =
    thread.pictureUrl ||
    `https://api.dicebear.com/7.x/notionists/svg?seed=${encodeURIComponent(thread.targetId)}&backgroundColor=06C755`;
  return {
    id,
    customerName: name,
    channel: 'line',
    avatar,
    lastSnippet: lastSnippetFromMessage(last),
    updatedAt: thread.updatedAt,
    unread: 0,
    online: false,
    botEnabled: isBotEnabled(id, thread.shopId),
    messages: thread.messages.map((m) => ({
      id: m.id,
      sender: m.sender,
      text: m.text,
      image: m.image,
      video: m.video,
      receivedAt: m.receivedAt,
      meta: m.meta,
    })),
  };
}

app.use(cors({ origin: true, credentials: true }));

// ---------------------------------------------------------------------------
// Auth gate. Webhooks, OAuth callbacks, health check, login, and the public
// privacy/data-deletion endpoints stay open. Everything else under /api needs
// a valid session cookie.
// ---------------------------------------------------------------------------
const AUTH_ALLOWLIST = [
  '/api/health',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/auth/signup',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/oauth-config',
  '/api/auth/oauth/google',
  '/api/auth/oauth/facebook',
  '/api/shops/invites/', // GET preview is public; POST accept still checks req.user
  '/invite/',            // SPA route — frontend renders the accept screen

  '/api/line/webhook',
  '/api/line/oauth/start',
  '/api/line/oauth/callback',
  '/api/fb/webhook',
  '/api/fb/oauth/start',
  '/api/fb/oauth/callback',
  '/api/privacy',
  '/api/terms',
  '/api/fb/data-deletion',
  '/api/fb/data-deletion/status',
  // Client error reports: errors can happen on /login or /register too,
  // before the user has a session. The endpoint is already rate-limited.
  '/api/log/client-error',
];
app.use(requireAuth({ allowList: AUTH_ALLOWLIST }));

app.get('/api/health', (_req, res) => {
  syncFbConfigFromEnv();
  const lineConversationsCount = Array.from(lineThreads.values()).filter((t) => t.messages.length > 0).length;
  const fbConversationsCount = Array.from(fbThreads.values()).filter((t) => t.messages.length > 0).length;
  res.json({
    ok: true,
    lineConfigured: hasLineSecret(),
    lineReplyEnabled: hasLineToken(),
    eventsBuffered: eventsBuffer.length,
    lineThreads: lineThreads.size,
    lineConversationsCount,
    lineWebhook: lineWebhookDebug,
    fbConfigured,
    fbReplyEnabled: fbHasPageToken(),
    fbAppSecretSet: fbHasAppSecret,
    fbOauthAvailable,
    fbEnvPresent: {
      FB_APP_ID: Boolean(fbConfig.appId),
      FB_APP_SECRET: Boolean(fbHasAppSecret),
      FB_PAGE_ACCESS_TOKEN: Boolean(fbConfig.fallbackPageAccessToken),
      FB_VERIFY_TOKEN: Boolean(fbConfig.verifyToken),
    },
    fbConnectedPage: (() => {
      const p = primaryFbPageForApi();
      return p ? { id: p.id, name: p.name, category: p.category, picture: p.picture } : null;
    })(),
    fbThreads: fbThreads.size,
    fbConversationsCount,
    fbWebhook: fbWebhookDebug,
    slipChecker: { enabled: isEasySlipEnabled(), ...slipStats() },
    ai: {
      enabled: isAiEnabled(),
      model: isAiEnabled() ? aiModel() : null,
    },
    envPath: path.join(__dirname, '..', '.env'),
  });
});

/**
 * AI health — surfaced in Settings → Bot. Tells the shop owner whether
 * the bot is actually able to reply right now (key set + last call
 * succeeded), so they don't only find out from a customer complaint.
 */
app.get('/api/ai/health', (_req, res) => {
  res.json(aiHealth());
});

/**
 * Client-side error sink. The browser bundle posts uncaught errors,
 * unhandled rejections, and ErrorBoundary catches here. We just log
 * structurally to stdout — Railway / our log aggregator picks them up
 * from there. When we wire Sentry later, this endpoint becomes the
 * place we forward to Sentry too.
 *
 * Rate-limited per IP so a stuck client looping a bad render can't
 * flood the log stream.
 */
app.post(
  '/api/log/client-error',
  rateLimit({ bucket: 'client-error', limit: 30, windowMs: 60_000 }),
  express.json({ limit: '16kb' }),
  (req, res) => {
    const r = req.body || {};
    const safe = {
      kind: String(r.kind || 'unknown').slice(0, 20),
      name: String(r.name || '').slice(0, 100),
      message: String(r.message || '').slice(0, 500),
      stack: String(r.stack || '').slice(0, 2000),
      componentStack: r.componentStack ? String(r.componentStack).slice(0, 2000) : undefined,
      url: String(r.url || '').slice(0, 500),
      userAgent: String(r.userAgent || '').slice(0, 300),
      at: String(r.at || new Date().toISOString()),
    };
    // Single-line so log aggregators can grep on prefix.
    console.error('[client-error]', JSON.stringify(safe));
    // 204 = no body, no caching, lowest overhead.
    res.sendStatus(204);
  },
);

app.get('/api/line/events', (_req, res) => {
  res.json({ events: eventsBuffer });
});

app.get('/api/line/conversations', async (req, res) => {
  // Scope to the caller's active shop so admin of Shop A only sees Shop A's
  // threads, not the merged firehose of every shop on this deployment.
  const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
  scheduleLineProfileBackfill();
  const arr = Array.from(lineThreads.values())
    .filter((t) => (t.shopId || DEFAULT_SHOP_ID) === shopId && t.messages.length > 0)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .map(threadToApiConversation);
  res.json({ conversations: arr, count: arr.length });
});

/**
 * Realtime inbox stream. The browser opens one EventSource per tab; we keep
 * the connection open and write a heartbeat every 25s so reverse proxies
 * (Railway / Cloudflare / nginx default 30–60s idle) don't drop it. Each
 * conversation mutation triggers a tiny `{v, at}` payload — the client treats
 * any payload as "go re-fetch /api/{line,fb}/conversations" so we don't have
 * to ship full thread state through the stream.
 */
app.get('/api/inbox/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write(`retry: 3000\n\n`);
  res.write(`data: ${JSON.stringify({ v: inboxVersion, at: Date.now(), hello: true })}\n\n`);
  inboxSubscribers.add(res);
  // Heartbeat sent as a *named* SSE event so the browser's `addEventListener
  // ('heartbeat', …)` fires but `addEventListener('message', …)` does not.
  // That lets the client reset its stale-connection watchdog without
  // triggering a needless re-fetch of every conversation list. Crucially,
  // SSE comments (`: ping`) do not fire any JS event at all, so they can't
  // serve that purpose — hence the switch.
  const heartbeat = setInterval(() => {
    try {
      res.write(`event: heartbeat\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
    } catch {
      /* will be cleaned up on close */
    }
  }, 25000);
  const cleanup = () => {
    clearInterval(heartbeat);
    inboxSubscribers.delete(res);
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
});

app.post('/api/line/send', express.json({ limit: '50kb' }), async (req, res) => {
  const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
  // Per-shop token: pull the active shop's LINE config and build a temporary
  // client so Shop A's reply never goes out from Shop B's OA.
  const entry = await loadLineConfigForShop(shopId);
  const accessToken = entry?.channelAccessToken || lineConfig.channelAccessToken;
  if (!accessToken) {
    return res.status(503).json({ error: 'LINE not connected for this shop yet — go to Settings → Channels.' });
  }
  const { conversationId, text, asAi } = req.body || {};
  const body = typeof text === 'string' ? text.trim() : '';
  if (!conversationId || !body) {
    return res.status(400).json({ error: 'conversationId and text are required' });
  }
  const m = /^line:(user|group|room):(.+)$/.exec(String(conversationId));
  if (!m) {
    return res.status(400).json({ error: 'invalid conversationId' });
  }
  const kind = m[1];
  const targetId = m[2];
  const sender = asAi ? 'ai' : 'agent';
  try {
    const shopClient = new line.messagingApi.MessagingApiClient({ channelAccessToken: accessToken });
    await shopClient.pushMessage({
      to: targetId,
      messages: [{ type: 'text', text: body }],
    });
    const thread = getOrCreateThread(kind, targetId, shopId);
    const now = new Date().toISOString();
    thread.messages.push({
      id: crypto.randomUUID(),
      receivedAt: now,
      sender,
      text: body,
    });
    thread.updatedAt = now;
    void logChatEvent({ channel: 'line', convId: `line:${kind}:${targetId}`, direction: 'out' });
    markChatStateDirty();
    return res.json({ ok: true });
  } catch (e) {
    console.error('LINE pushMessage failed:', e?.message || e);
    return res.status(502).json({ error: String(e?.message || e) });
  }
});

/** Dynamic LINE middleware — re-reads `lineConfig.channelSecret` on every
 *  request so credentials pasted in the UI take effect without a restart. */
function lineWebhookMiddleware(req, res, next) {
  if (!lineConfig.channelSecret) {
    // Allow request through; the handler will respond with 500 explaining
    // that LINE isn't configured yet (clearer than a silent 401).
    return next();
  }
  return line.middleware({ channelSecret: lineConfig.channelSecret })(req, res, next);
}

app.post(
  '/api/line/webhook',
  rateLimit({ bucket: 'line-webhook', limit: 120, windowMs: 60_000 }),
  lineWebhookMiddleware,
  async (req, res) => {
    if (!hasLineSecret()) {
      return res.status(500).json({ error: 'LINE channel secret not configured yet — go to Settings → Connect → LINE.' });
    }

    const events = req.body?.events || [];
    // LINE puts the receiving OA's userId on the top-level body — every event
    // in this batch belongs to the same OA. Look that up to figure out which
    // shop owns this webhook so each event lands in the right tenant's inbox.
    const destination = req.body?.destination ? String(req.body.destination) : null;
    const eventShopId = shopIdForLineDestination(destination) || DEFAULT_SHOP_ID;
    console.log('[LINE webhook]', new Date().toISOString(), 'shop=', eventShopId, 'events=', events.length, events.map((e) => e.type).join(',') || '(none)');

    try {
      for (const event of events) {
        const record = {
          id: crypto.randomUUID(),
          receivedAt: new Date().toISOString(),
          type: event.type,
          sourceType: event.source?.type || 'unknown',
          userId: event.source?.userId || null,
          replyToken: event.replyToken || null,
          messageType: event.message?.type || null,
          text: event.message?.type === 'text' ? event.message.text : null,
          raw: event,
        };
        pushEvent(record);

        const src = sourceKey(event.source);
        if (event.type === 'message' && src && event.message) {
          const thread = getOrCreateThread(src.kind, src.targetId, eventShopId);
          const mid = event.message.id || crypto.randomUUID();
          const media = extractLineMedia(event.message);
          let textOut = null;
          if (event.message.type === 'text') {
            textOut = event.message.text;
          } else if (media.image || media.video) {
            textOut = null;
          } else {
            textOut = labelForNonText(event.message);
          }
          if (textOut || media.image || media.video) {
            const row = {
              id: mid,
              receivedAt: new Date().toISOString(),
              sender: 'customer',
            };
            if (textOut) row.text = textOut;
            if (media.image) row.image = media.image;
            if (media.video) row.video = media.video;
            thread.messages.push(row);
            thread.updatedAt = new Date().toISOString();
            markChatStateDirty();
            void logChatEvent({ channel: 'line', convId: `line:${kind}:${targetId}`, direction: 'in' });

            // AI auto-reply for text-only customer messages. Image-bearing
            // messages flow through the slip path below — that path posts its
            // own AI thank-you when the slip verifies.
            if (textOut && !media.image && !media.video && event.message.type === 'text') {
              void tryAutoReply({
                channel: 'line',
                conversationId: `line:${src.kind}:${src.targetId}`,
                thread,
                customerText: textOut,
              });
            }

            // Slip auto-verify: any image arriving from a customer is treated
            // as a candidate slip. LINE-hosted images need a channel-token
            // download; external (contentProvider=external) ones we can fetch
            // directly via URL.
            if (event.message.type === 'image') {
              void (async () => {
                let buffer = null;
                if (event.message.contentProvider?.type !== 'external') {
                  buffer = await fetchLineMessageBytes(event.message.id);
                }
                await maybeAttachSlip({
                  channel: 'line',
                  conversationId: `line:${src.kind}:${src.targetId}`,
                  message: row,
                  thread,
                  imageUrl: media.image || null,
                  buffer,
                  mime: 'image/jpeg',
                });
              })();
            }
          }
          if (lineClient && looksFallbackLineDisplayName(thread.displayName)) {
            if (src.kind === 'user') void enrichUserProfile(src.targetId, thread);
            else if (src.kind === 'group') void enrichGroupSummary(src.targetId, thread);
          }
        }
      }

      lineWebhookDebug = {
        lastSuccessAt: new Date().toISOString(),
        lastErrorAt: lineWebhookDebug.lastErrorAt,
        lastError: null,
        lastEventCount: events.length,
      };

      return res.json({ ok: true });
    } catch (e) {
      lineWebhookDebug = {
        ...lineWebhookDebug,
        lastErrorAt: new Date().toISOString(),
        lastError: String(e?.message || e),
      };
      console.error('[LINE webhook] handler error:', e);
      return res.status(500).json({ error: String(e?.message || e) });
    }
  },
);

// =====================================================================
// LINE integration (Settings UI: paste channel secret + token, no env edit)
// =====================================================================

function lineWebhookUrlFor(req) {
  return `${publicBaseUrl(req)}/api/line/webhook`;
}

/** Public-safe view of `lineConfig` — never includes the secret values. */
function lineIntegrationStatusPayload(req) {
  return {
    configured: hasLineSecret(),
    replyEnabled: hasLineToken(),
    source: lineConfig.source,
    botInfo: lineConfig.botInfo,
    webhookUrl: lineWebhookUrlFor(req),
    threadCount: lineThreads.size,
    /** When true, the Settings UI can show a "Connect with LINE" button
     *  instead of (or alongside) the manual paste form. */
    oauthAvailable: lineOauthAvailable(),
    // Hint which env vars are present so the UI can show "using server env"
    // vs "saved from Settings".
    envPresent: {
      LINE_CHANNEL_SECRET: Boolean((process.env.LINE_CHANNEL_SECRET || '').trim()),
      LINE_CHANNEL_ACCESS_TOKEN: Boolean((process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()),
    },
  };
}

app.get('/api/line/integration/status', async (req, res) => {
  // Load the active shop's config into the compat global before computing
  // the status payload so the response reflects THIS shop, not whichever
  // one was last touched by a request.
  const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
  const entry = await loadLineConfigForShop(shopId);
  if (entry) {
    lineConfig.channelSecret = entry.channelSecret;
    lineConfig.channelAccessToken = entry.channelAccessToken;
    lineConfig.source = entry.source;
    lineConfig.botInfo = entry.botInfo;
  } else {
    // Fresh shop, never connected — reset compat to env so the UI shows
    // "not configured" rather than another shop's leftover state.
    lineConfig.channelSecret = (process.env.LINE_CHANNEL_SECRET || '').trim();
    lineConfig.channelAccessToken = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();
    lineConfig.source = lineConfig.channelSecret || lineConfig.channelAccessToken ? 'env' : null;
    lineConfig.botInfo = null;
  }
  res.json(lineIntegrationStatusPayload(req));
});

app.post(
  '/api/line/integration/connect',
  express.json({ limit: '8kb' }),
  async (req, res) => {
    const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
    const channelSecret = String(req.body?.channelSecret || '').trim();
    const channelAccessToken = String(req.body?.channelAccessToken || '').trim();
    if (!channelSecret || !channelAccessToken) {
      return res.status(400).json({
        error: 'ต้องกรอกทั้ง Channel Secret และ Channel Access Token',
      });
    }
    if (channelSecret.length < 16 || channelAccessToken.length < 40) {
      return res.status(400).json({
        error: 'ข้อมูลที่กรอกดูสั้นเกินไป ตรวจสอบ Channel Secret และ Access Token อีกครั้ง',
      });
    }
    const botInfo = await fetchLineBotInfo(channelAccessToken);
    if (!botInfo) {
      return res.status(400).json({
        error: 'เชื่อมไม่สำเร็จ — LINE ปฏิเสธ Access Token นี้ ตรวจสอบว่าคัดลอกมาจาก Channel ที่ถูกต้องและยัง active อยู่',
      });
    }
    // Guard: another shop can't grab an OA that's already wired to a
    // different shop (would silently steal their inbox routing).
    const owner = lineOaToShop.get(String(botInfo.userId));
    if (owner && owner !== shopId) {
      return res.status(409).json({
        error: 'OA นี้ถูกเชื่อมกับร้านอื่นแล้ว — ตัดการเชื่อมที่ร้านเดิมก่อน',
      });
    }
    try {
      await setLineConfigForShop(shopId, {
        secret: channelSecret,
        token: channelAccessToken,
        source: 'ui',
        botInfo,
      });
      return res.json({ ok: true, status: lineIntegrationStatusPayload(req) });
    } catch (e) {
      console.error('[LINE] connect failed:', e);
      return res.status(500).json({ error: String(e?.message || e) });
    }
  },
);

app.post('/api/line/integration/disconnect', async (req, res) => {
  try {
    const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
    await clearLineConfigForShop(shopId);
    return res.json({ ok: true, status: lineIntegrationStatusPayload(req) });
  } catch (e) {
    console.error('[LINE] disconnect failed:', e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

// ─── LINE Module Channel OAuth (zwiz-style "Connect with LINE") ──────────────

/**
 * Kick off the Module Channel OAuth flow. We redirect the user's browser to
 * LINE Manager's authorize URL with our Module Channel client_id; LINE then
 * shows the user a "select OA → grant permissions" UI and bounces back to
 * /api/line/oauth/callback with an authorization code.
 *
 * The shop owner never has to copy/paste a Channel Secret or Access Token.
 */
app.get('/api/line/oauth/start', async (req, res) => {
  if (!lineOauthAvailable()) {
    return res.status(503).send('LINE OAuth is not configured on this server.');
  }
  if (!req.user) {
    return res.redirect('/?lineConnect=login_required');
  }
  pruneLineOauthStates();
  const state = crypto.randomBytes(16).toString('base64url');
  // Remember which shop this connect attempt belongs to so the callback can
  // write the credentials to the right per-shop slot.
  const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
  lineOauthStates.set(state, { userId: req.user.id, shopId, createdAt: Date.now() });

  const redirectUri = `${publicBaseUrl(req)}/api/line/oauth/callback`;
  // Scopes mirror what zwiz / vbot request: read+send messages, get user
  // profiles, manage webhook endpoint, basic account info. LINE silently
  // ignores scopes our Module Channel isn't registered for, so being
  // generous here doesn't hurt.
  const scope = [
    'account:basic_info',
    'bot:read',
    'bot:write',
    'bot:webhook',
    'bot:profile',
    'message:send',
    'message:receive',
  ].join(' ');
  const url =
    `https://manager.line.biz/module/auth/v1/authorize` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(LINE_MODULE_CHANNEL_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&state=${encodeURIComponent(state)}`;
  res.redirect(url);
});

/**
 * Exchange the authorization code for an access token, validate it by
 * calling /v2/bot/info, attempt to set the webhook URL on the user's behalf
 * (so they don't have to paste it into LINE Developers either), then save
 * the result to KV and redirect to /settings with a success flag.
 */
app.get('/api/line/oauth/callback', async (req, res) => {
  const code = String(req.query?.code || '');
  const state = String(req.query?.state || '');
  const error = String(req.query?.error || '');

  if (error) {
    console.warn('[LINE OAuth] user denied:', error);
    return res.redirect('/settings?lineConnect=denied');
  }
  if (!code || !state) {
    return res.redirect('/settings?lineConnect=bad_request');
  }
  pruneLineOauthStates();
  const stored = lineOauthStates.get(state);
  if (!stored) {
    return res.redirect('/settings?lineConnect=bad_state');
  }
  lineOauthStates.delete(state);
  const shopId = stored.shopId || DEFAULT_SHOP_ID;

  const redirectUri = `${publicBaseUrl(req)}/api/line/oauth/callback`;

  try {
    // 1. Exchange code → access_token.
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: LINE_MODULE_CHANNEL_ID,
      client_secret: LINE_MODULE_CHANNEL_SECRET,
    });
    const tr = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
    });
    const td = await tr.json().catch(() => ({}));
    if (!tr.ok || !td?.access_token) {
      console.error('[LINE OAuth] token exchange failed:', td);
      return res.redirect('/settings?lineConnect=token_failed');
    }
    const accessToken = String(td.access_token);

    // 2. Confirm the token by fetching the OA profile.
    const botInfo = await fetchLineBotInfo(accessToken);
    if (!botInfo) {
      return res.redirect('/settings?lineConnect=bot_info_failed');
    }

    // Guard: don't let one shop steal another shop's already-connected OA.
    const owner = lineOaToShop.get(String(botInfo.userId));
    if (owner && owner !== shopId) {
      return res.redirect('/settings?lineConnect=already_connected');
    }

    // 3. Try to set the webhook URL automatically. Best-effort: if the
    //    Module Channel doesn't have bot:webhook scope, this silently
    //    fails and the user can still set it manually.
    const webhookEndpoint = `${publicBaseUrl(req)}/api/line/webhook`;
    try {
      await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ endpoint: webhookEndpoint }),
      });
    } catch (e) {
      console.warn('[LINE OAuth] webhook endpoint update failed:', e?.message || e);
    }

    // 4. Persist to the SHOP's per-shop slot (not the legacy global key).
    //    The Module Channel secret doubles as the webhook signature secret
    //    because LINE signs all routed webhooks with the Module Channel's
    //    own secret, not the per-OA channel secret.
    await setLineConfigForShop(shopId, {
      secret: LINE_MODULE_CHANNEL_SECRET,
      token: accessToken,
      source: 'oauth',
      botInfo,
    });

    return res.redirect('/settings?lineConnect=ok');
  } catch (e) {
    console.error('[LINE OAuth] callback failed:', e);
    return res.redirect('/settings?lineConnect=error');
  }
});

// =====================================================================
// Facebook Messenger
// =====================================================================

// =====================================================================
// Bot on/off (per-conversation auto-reply switch)
// =====================================================================

app.get('/api/bot/state', async (req, res) => {
  const id = String(req.query?.conversationId || '').trim();
  if (!id) return res.status(400).json({ error: 'conversationId required' });
  const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
  res.json({ conversationId: id, enabled: isBotEnabled(id, shopId) });
});

app.post('/api/bot/state', express.json({ limit: '4kb' }), async (req, res) => {
  const id = String(req.body?.conversationId || '').trim();
  if (!id) return res.status(400).json({ error: 'conversationId required' });
  const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
  const enabled = req.body?.enabled !== false; // default true if not boolean
  setBotEnabled(id, enabled, shopId);
  res.json({ conversationId: id, enabled: isBotEnabled(id, shopId) });
});

// =====================================================================
// Slip verification dashboard
// =====================================================================

/**
 * Persistent verification audit — every EasySlip call (webhook + manual)
 * stored in the DB. The Slips admin pulls this so the owner can audit
 * "failed" attempts (potential fraud / wrong-image uploads) that don't
 * appear in the in-memory `slipsById` cache.
 */
app.get('/api/slips/verifications', async (req, res) => {
  const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
  const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || 50));
  try {
    const rows = await listRecentSlipVerifications(shopId, limit);
    res.json({ verifications: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/slips', async (req, res) => {
  const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
  res.json({
    slips: listSlips(shopId),
    stats: slipStats(shopId),
  });
});

app.get('/api/slips/:id', async (req, res) => {
  const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
  const s = getSlip(String(req.params.id || ''), shopId);
  if (!s) return res.status(404).json({ error: 'not found' });
  res.json({ slip: s });
});

/**
 * Manually re-verify by URL — useful when an EasySlip token is added later
 * or the owner wants a second opinion. EasySlip charges per call, so this
 * endpoint is rate-limited tighter than chat endpoints — a stuck client or
 * malicious caller can't bleed the slip-API quota.
 */
app.post(
  '/api/slips/verify',
  rateLimit({ bucket: 'slip-verify', limit: 20, windowMs: 60_000 }),
  express.json({ limit: '50kb' }),
  async (req, res) => {
    const url = String(req.body?.imageUrl || '').trim();
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'imageUrl required' });
    }
    try {
      const result = await verifySlipBytes({ imageUrl: url });
      // Audit every manual verification so we can trace disputes back to who
      // re-ran a check and what EasySlip said at that moment.
      void recordSlipVerificationAttempt({
        source: 'manual',
        imageUrl: url,
        result,
        shopId: (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID,
        userId: req.user?.id || null,
      });
      res.json({ result, easyslipEnabled: isEasySlipEnabled() });
    } catch (e) {
      void recordSlipVerificationAttempt({
        source: 'manual',
        imageUrl: url,
        result: { status: 'failed', reason: String(e?.message || e) },
        shopId: (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID,
        userId: req.user?.id || null,
      });
      res.status(500).json({ error: String(e?.message || e) });
    }
  },
);

app.get('/api/fb/conversations', async (req, res) => {
  // Scope to caller's active shop — same pattern as /api/line/conversations.
  const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
  scheduleFbProfileBackfill();
  const arr = Array.from(fbThreads.values())
    .filter((t) => (t.shopId || DEFAULT_SHOP_ID) === shopId && t.messages.length > 0)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .map(fbThreadToApiConversation);
  res.json({ conversations: arr, count: arr.length });
});

/**
 * Meta sends hub.mode, hub.verify_token, hub.challenge as dotted query keys.
 * Express's qs parser often nests them under req.query.hub — so req.query['hub.mode'] is undefined
 * and verification always returns 403. Parse from the raw URL instead.
 */
function readMetaWebhookVerifyParams(req) {
  try {
    const pathAndQuery = req.originalUrl || req.url || '/';
    const u = new URL(pathAndQuery, 'http://meta-webhook-verify.local');
    return {
      mode: u.searchParams.get('hub.mode'),
      token: (u.searchParams.get('hub.verify_token') || '').trim(),
      challenge: u.searchParams.get('hub.challenge'),
    };
  } catch {
    return { mode: null, token: '', challenge: null };
  }
}

// Webhook verification (FB calls this once when you set the URL)
app.get('/api/fb/webhook', (req, res) => {
  const { mode, token, challenge } = readMetaWebhookVerifyParams(req);
  if (mode === 'subscribe' && token && fbConfig.verifyToken && token === fbConfig.verifyToken) {
    console.log('[FB webhook] verified');
    return res.status(200).send(String(challenge ?? ''));
  }
  const reason =
    mode !== 'subscribe'
      ? 'hub.mode not subscribe'
      : !fbConfig.verifyToken
        ? 'FB_VERIFY_TOKEN missing on server'
        : !token
          ? 'hub.verify_token missing in request'
          : 'verify token mismatch (check Railway FB_VERIFY_TOKEN vs Meta)';
  console.warn('[FB webhook] verify failed:', reason);
  return res.sendStatus(403);
});

// Webhook events — raw body so we can verify X-Hub-Signature-256
app.post(
  '/api/fb/webhook',
  rateLimit({ bucket: 'fb-webhook', limit: 120, windowMs: 60_000 }),
  express.raw({ type: '*/*', limit: '1mb' }),
  async (req, res) => {
    syncFbConfigFromEnv();
    if (!fbConfigured) {
      return res.status(500).json({ error: 'FB_VERIFY_TOKEN is missing (Meta webhook cannot be used without it)' });
    }

    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const sigHeader = req.get('x-hub-signature-256') || req.get('X-Hub-Signature-256');
    const sigOk = verifyFbSignature(raw, sigHeader);
    if (sigOk === false) {
      fbWebhookDebug = {
        ...fbWebhookDebug,
        lastErrorAt: new Date().toISOString(),
        lastError: 'invalid X-Hub-Signature-256',
      };
      console.warn('[FB webhook] bad signature');
      return res.sendStatus(401);
    }
    if (sigOk === null) {
      // FB_APP_SECRET not configured → we *cannot* verify the request came
      // from Meta. Refuse all webhook bodies in that state — accepting them
      // unverified means any external caller can inject fake customer
      // messages into the inbox.
      fbWebhookDebug = {
        ...fbWebhookDebug,
        lastErrorAt: new Date().toISOString(),
        lastError: 'FB_APP_SECRET not set — webhook refused (cannot verify signature)',
      };
      console.error('[FB webhook] FB_APP_SECRET not set — refusing unsigned webhook request');
      return res.sendStatus(401);
    }

    let payload;
    try {
      payload = JSON.parse(raw.toString('utf8') || '{}');
    } catch (e) {
      fbWebhookDebug = { ...fbWebhookDebug, lastErrorAt: new Date().toISOString(), lastError: 'invalid JSON' };
      return res.status(400).json({ error: 'invalid JSON' });
    }

    // Accept both: object=page (Facebook DMs) AND object=instagram (Instagram DMs).
    // Both deliver entries with the same `entry[].messaging[]` shape.
    if (payload?.object !== 'page' && payload?.object !== 'instagram') {
      return res.sendStatus(200);
    }
    const isInstagram = payload?.object === 'instagram';
    console.log(
      '[Meta webhook]',
      new Date().toISOString(),
      'object=',
      payload?.object,
      'entries=',
      Array.isArray(payload?.entry) ? payload.entry.length : 0,
    );

    let total = 0;
    try {
      for (const entry of payload.entry || []) {
        // entry.id is the Page ID (or IG account id when object=instagram).
        // Look up which shop owns this Page so each event routes to the
        // right tenant's inbox and uses that tenant's reply token.
        const entryOwnerId = entry?.id ? String(entry.id) : null;
        const page = isInstagram
          ? (entryOwnerId ? findPageByIgId(entryOwnerId) : null)
          : (entryOwnerId ? findPageByPageId(entryOwnerId) : null);
        const eventShopId = page?.shopId || DEFAULT_SHOP_ID;
        const eventPageId = page?.id || entryOwnerId; // remember the receiving Page for send routing

        const events = entry.messaging || [];
        total += events.length;
        for (const ev of events) {
          const psid = ev?.sender?.id;
          if (!psid) continue;

          // Skip page-echoed messages (when the page itself sends — would loop forever)
          if (ev?.message?.is_echo) continue;

          pushEvent({
            id: crypto.randomUUID(),
            receivedAt: new Date().toISOString(),
            type: ev.message ? 'fb:message' : ev.postback ? 'fb:postback' : 'fb:other',
            sourceType: 'fb-user',
            userId: psid,
            text: ev?.message?.text || ev?.postback?.title || null,
            raw: ev,
          });

          // Tag thread by channel: page DMs vs IG DMs are stored separately so the UI
          // can render them with the correct channel icon and so PSID/IGSID don't collide.
          const thread = getOrCreateFbThread(psid, isInstagram ? 'ig' : 'fb', eventShopId, eventPageId);
          let textOut = null;
          let imageUrl = null;
          let videoUrl = null;
          let isSticker = false;
          if (ev?.message) {
            const parsed = metaMessagingMediaFromEvent(ev);
            textOut = parsed.textOut;
            imageUrl = parsed.imageUrl;
            videoUrl = parsed.videoUrl;
            isSticker = parsed.isSticker;
            const mid = ev.message.mid;
            const attCount = Array.isArray(ev.message.attachments) ? ev.message.attachments.length : 0;
            if (mid && attCount > 0 && !imageUrl && !videoUrl) {
              const pageTok = isInstagram
                ? tokenForIgId(String(entry.id)) || primaryPageAccessToken()
                : tokenForPageId(String(entry.id)) || primaryPageAccessToken();
              const g = await fetchMessengerAttachmentsFromMid(pageTok, mid);
              if (g.imageUrl) imageUrl = g.imageUrl;
              if (g.videoUrl) videoUrl = g.videoUrl;
              textOut = stripMetaMediaPlaceholderText(textOut, imageUrl, videoUrl);
            }
          } else if (ev?.postback?.title) {
            textOut = `[postback] ${ev.postback.title}`;
          }
          if (textOut || imageUrl || videoUrl) {
            const row = {
              id: ev?.message?.mid || crypto.randomUUID(),
              receivedAt: new Date().toISOString(),
              sender: 'customer',
            };
            if (textOut) row.text = textOut;
            if (imageUrl) row.image = imageUrl;
            if (videoUrl) row.video = videoUrl;
            if (isSticker) row.isSticker = true;
            thread.messages.push(row);
            thread.updatedAt = new Date().toISOString();
            markChatStateDirty();
            const convIdForChannel = thread.channel === 'ig'
              ? `ig:user:${thread.targetId}`
              : `fb:user:${thread.targetId}`;
            void logChatEvent({
              channel: thread.channel === 'ig' ? 'ig' : 'fb',
              convId: convIdForChannel,
              direction: 'in',
            });

            // AI auto-reply for plain text messages (no image, no sticker).
            // Image-bearing messages go through the slip path below.
            if (textOut && !imageUrl && !videoUrl && !isSticker) {
              void tryAutoReply({
                channel: thread.channel === 'ig' ? 'ig' : 'fb',
                conversationId: convIdForChannel,
                thread,
                customerText: textOut,
              });
            }

            // Slip auto-verify on inbound images — but NEVER on stickers/emoji.
            const stickerLike = isSticker || looksLikeMetaStickerAttachment(ev, imageUrl);
            if (imageUrl && !videoUrl && !stickerLike) {
              const channel = isInstagram ? 'ig' : 'fb';
              const conversationId = `${channel}:user:${psid}`;
              void maybeAttachSlip({
                channel,
                conversationId,
                message: row,
                thread,
                imageUrl,
                buffer: null,
                mime: null,
              });
            }
          }

          if (!thread.displayName && !isInstagram) {
            void enrichFbProfile(psid, thread, entry.id);
          }
          if (!thread.displayName && isInstagram) {
            void enrichIgProfile(psid, thread, entry.id);
          }
        }
      }
      fbWebhookDebug = {
        lastSuccessAt: new Date().toISOString(),
        lastErrorAt: fbWebhookDebug.lastErrorAt,
        lastError: null,
        lastEventCount: total,
      };
      console.log('[FB webhook]', new Date().toISOString(), 'messaging events=', total);
      return res.sendStatus(200);
    } catch (e) {
      fbWebhookDebug = {
        ...fbWebhookDebug,
        lastErrorAt: new Date().toISOString(),
        lastError: String(e?.message || e),
      };
      console.error('[FB webhook] handler error:', e);
      return res.sendStatus(200); // ack so FB doesn't retry-storm
    }
  },
);

/**
 * Retry an upstream API call with exponential backoff. Used by the LINE and
 * Meta send paths so a transient 5xx from upstream doesn't drop the message
 * on first try. Only retries when `shouldRetry(err)` returns true — 4xx-style
 * errors (bad token, bad recipient) are returned immediately so the user sees
 * them in the UI and can fix them, instead of waiting through pointless retries.
 *
 *   attempt 0 → immediate
 *   attempt 1 → 500ms delay
 *   attempt 2 → 1500ms delay
 */
async function retryWithBackoff(fn, { tries = 3, shouldRetry = () => true, label = 'op' } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i === tries - 1 || !shouldRetry(e)) throw e;
      const delay = 500 * Math.pow(3, i); // 500, 1500ms
      console.warn(`[retry] ${label} attempt ${i + 1}/${tries} failed (${e?.message || e}); waiting ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/** LINE SDK throws errors with `.statusCode`. 4xx = client error (don't retry).
 *  5xx + network errors = upstream wobble, worth a retry. */
function isLineRetryable(e) {
  const code = e?.statusCode ?? e?.status;
  if (typeof code === 'number') return code >= 500;
  return true; // network error, no status — retry
}

async function sendLineMessage({ conversationId, text, asAi, shopId }) {
  // Resolve the OA whose token to use. Caller passes shopId from the request;
  // we fall back to whatever shop already owns this conversation thread.
  let sid = shopId || null;
  const body = typeof text === 'string' ? text.trim() : '';
  if (!conversationId || !body) return { status: 400, error: 'conversationId and text are required' };
  const m = /^line:(user|group|room):(.+)$/.exec(String(conversationId));
  if (!m) return { status: 400, error: 'invalid conversationId (expected line:user|group|room:<id>)' };
  const kind = m[1];
  const targetId = m[2];

  if (!sid) {
    // Find an existing thread for this customer to learn which shop owns it.
    for (const t of lineThreads.values()) {
      if (t.kind === kind && t.targetId === targetId) { sid = t.shopId; break; }
    }
    sid = sid || DEFAULT_SHOP_ID;
  }

  const entry = await loadLineConfigForShop(sid);
  const accessToken = entry?.channelAccessToken || lineConfig.channelAccessToken;
  if (!accessToken) {
    return { status: 503, error: 'LINE not connected for this shop yet.' };
  }
  if (asAi && !isBotEnabled(conversationId, sid)) {
    return { status: 409, error: 'Bot is turned off for this conversation' };
  }
  const sender = asAi ? 'ai' : 'agent';
  const shopClient = new line.messagingApi.MessagingApiClient({ channelAccessToken: accessToken });
  try {
    await retryWithBackoff(
      () => shopClient.pushMessage({ to: targetId, messages: [{ type: 'text', text: body }] }),
      { tries: 3, shouldRetry: isLineRetryable, label: `LINE push ${targetId.slice(-6)}` },
    );
    const thread = getOrCreateThread(kind, targetId, sid);
    const now = new Date().toISOString();
    thread.messages.push({ id: crypto.randomUUID(), receivedAt: now, sender, text: body });
    thread.updatedAt = now;
    markChatStateDirty();
    void logChatEvent({ channel: 'line', convId: `line:${kind}:${targetId}`, direction: 'out' });
    return { status: 200, ok: true };
  } catch (e) {
    console.error('LINE pushMessage failed after retries:', e?.message || e);
    return { status: 502, error: String(e?.message || e) };
  }
}

async function sendMetaMessage({ conversationId, text, asAi, shopId }) {
  syncFbConfigFromEnv();
  const body = typeof text === 'string' ? text.trim() : '';
  if (!conversationId || !body) return { status: 400, error: 'conversationId and text are required' };
  const m = /^(fb|ig):user:(.+)$/.exec(String(conversationId));
  if (!m) return { status: 400, error: 'invalid conversationId (expected fb:user:<PSID> or ig:user:<IGSID>)' };
  const channel = m[1];
  const targetId = m[2];

  // Resolve the receiving Page for THIS conversation, so we always reply via
  // the same Page the customer messaged. Lookup priority:
  //   1. The thread's own stored pageId (set when the webhook came in).
  //   2. A Page belonging to the caller's active shop (first match).
  //   3. Legacy global fallback — picks any connected Page (single-shop dev only).
  let pageToken = null;
  let resolvedPage = null;
  for (const t of fbThreads.values()) {
    if (t.channel === channel && t.targetId === targetId) {
      if (t.pageId) {
        const p = findPageByPageId(t.pageId) || findPageByIgId(t.pageId);
        if (p?.pageAccessToken) { pageToken = p.pageAccessToken; resolvedPage = p; }
      }
      break;
    }
  }
  if (!pageToken && shopId) {
    const owned = listPages().filter((p) => (p.shopId || DEFAULT_SHOP_ID) === shopId);
    if (owned[0]?.pageAccessToken) { pageToken = owned[0].pageAccessToken; resolvedPage = owned[0]; }
  }
  if (!pageToken) {
    if (!fbHasPageToken()) {
      return { status: 503, error: 'No connected Page. Connect Facebook in Settings → Integrations.' };
    }
    pageToken = primaryPageAccessToken();
  }
  // Resolve the shop the bot toggle should be checked against — fall back
  // to whatever shop the resolved page or thread says it belongs to.
  const botShopId = (resolvedPage?.shopId) || shopId || DEFAULT_SHOP_ID;
  if (asAi && !isBotEnabled(conversationId, botShopId)) {
    return { status: 409, error: 'Bot is turned off for this conversation' };
  }
  // ── Meta 24-hour messaging window check ──────────────────────────────
  // Meta's `messaging_type: 'RESPONSE'` only works when the customer has
  // sent a message in the last 24h. Past that window:
  //   • Facebook Messenger returns a 4xx error (codes 10 / 100).
  //   • Instagram is worse — it returns HTTP 200 but silently drops the
  //     message. Agents see "Sent ✓" but the customer never gets it.
  // Block the send up-front for both channels so the agent sees a clear
  // error instead of relying on Meta's inconsistent behaviour. Re-engaging
  // outside 24h needs a MESSAGE_TAG / human-agent flow that this app
  // doesn't yet implement (would require App Review).
  const lastCustomerAt = lastCustomerMessageAt(channel, targetId);
  if (lastCustomerAt !== null && Date.now() - lastCustomerAt > 24 * 60 * 60 * 1000) {
    return {
      status: 403,
      error: 'WINDOW_EXPIRED',
      errorCode: 'window_expired',
      friendlyMessage:
        channel === 'ig'
          ? 'ลูกค้าไม่ได้ทักมาในรอบ 24 ชม. — Instagram ไม่อนุญาตให้ส่งข้อความออก กรุณารอลูกค้าทักก่อน'
          : 'ลูกค้าไม่ได้ทักมาในรอบ 24 ชม. — Facebook ไม่อนุญาตให้ส่งข้อความออก กรุณารอลูกค้าทักก่อน',
      lastCustomerAt: new Date(lastCustomerAt).toISOString(),
    };
  }
  const sender = asAi ? 'ai' : 'agent';
  const url = `https://graph.facebook.com/${fbConfig.apiVersion}/me/messages?access_token=${encodeURIComponent(pageToken)}`;
  // Wrap fetch in retry: throw on non-OK so retryWithBackoff sees it as failure;
  // attach the raw HTTP status onto the thrown error so shouldRetry can decide.
  async function doCall() {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: targetId }, messaging_type: 'RESPONSE', message: { text: body } }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data?.error) {
      const msg = data?.error?.message || `HTTP ${r.status}`;
      const err = new Error(msg);
      err.statusCode = r.status;
      throw err;
    }
    return data;
  }
  try {
    const data = await retryWithBackoff(doCall, {
      tries: 3,
      shouldRetry: (e) => {
        const code = e?.statusCode;
        // Retry 5xx + network errors. Don't retry 4xx (bad token, expired
        // session, recipient outside 24h window) — those won't get better
        // with another try and would just block the request thread.
        return typeof code === 'number' ? code >= 500 : true;
      },
      label: `${channel.toUpperCase()} send ${String(targetId).slice(-6)}`,
    });
    const sid = (resolvedPage?.shopId) || shopId || DEFAULT_SHOP_ID;
    const thread = getOrCreateFbThread(targetId, channel, sid, resolvedPage?.id || null);
    const now = new Date().toISOString();
    thread.messages.push({ id: data?.message_id || crypto.randomUUID(), receivedAt: now, sender, text: body });
    thread.updatedAt = now;
    markChatStateDirty();
    void logChatEvent({
      channel: channel === 'ig' ? 'ig' : 'fb',
      convId: `${channel}:user:${targetId}`,
      direction: 'out',
    });
    // Send succeeded — clear any prior health flag on this Page so the
    // Settings badge stops showing "broken".
    if (resolvedPage?.id) markMetaPageHealthy(resolvedPage.id);
    return { status: 200, ok: true };
  } catch (e) {
    console.error(`${channel.toUpperCase()} send failed after retries:`, e?.message || e);
    // Classify the failure so the Settings UI can show "reconnect FB"
    // instead of an opaque error. Token-style failures are persistent —
    // the shop owner has to reconnect; we don't keep retrying.
    const classified = classifyMetaError(e);
    if (resolvedPage?.id && classified.kind === 'token') {
      markMetaPageUnhealthy(resolvedPage.id, classified);
    }
    return {
      status: classified.httpStatus,
      error: classified.message,
      errorCode: classified.code,
      pageId: resolvedPage?.id || null,
      needsReconnect: classified.kind === 'token',
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Meta Page health tracking.
//
// FB/IG access tokens get revoked all the time — admin change, app review
// flap, 60-day rotation, password reset. Before this map existed, a revoked
// token meant every customer reply silently failed with an opaque error
// and the shop owner had no idea until a customer complained.
//
// We record the last token-style failure per pageId. /api/fb/integration/
// status surfaces it so the Channels page can show a red "ตอบไม่ได้ — เชื่อม
// FB ใหม่" badge with a Reconnect button.
// ──────────────────────────────────────────────────────────────────────────
const metaPageHealth = new Map(); // pageId → { healthy: false, code, message, at }

function classifyMetaError(e) {
  const status = typeof e?.statusCode === 'number' ? e.statusCode : 0;
  const raw = String(e?.message || e || '').trim();
  // Graph API embeds the real code in the message string — e.g.
  //   "Error validating access token: ... (190)"
  //   "(#100) The user is not allowed to receive messages..."
  const codeMatch = raw.match(/\((?:#)?(\d{2,4})\)/);
  const fbCode = codeMatch ? Number(codeMatch[1]) : null;
  // Token-style: revoked, expired, app blocked. Owner action required.
  // FB error codes:
  //   190 = expired/invalid OAuth token
  //   102 = session expired
  //   200 = permissions error (revoked scope)
  //   458/459/460/463/464/467 = various Login-status errors
  if (fbCode === 190 || fbCode === 102 || fbCode === 200 ||
      (fbCode !== null && fbCode >= 458 && fbCode <= 467)) {
    return {
      kind: 'token',
      code: 'token_invalid',
      httpStatus: 401,
      message: 'Facebook token หมดอายุหรือถูกยกเลิก — กรุณาเชื่อม Facebook ใหม่ใน Settings',
    };
  }
  // Outside-24h-window etc. — different bug, different UI.
  if (fbCode === 10 || fbCode === 100) {
    return {
      kind: 'permission',
      code: 'recipient_unreachable',
      httpStatus: 403,
      message: 'ไม่สามารถส่งข้อความได้ — ลูกค้าอาจไม่ได้ทักมาในรอบ 24 ชม. หรือ Page ไม่มีสิทธิ์ตอบ',
    };
  }
  // 5xx → upstream wobble
  if (status >= 500) {
    return { kind: 'upstream', code: 'meta_5xx', httpStatus: 502, message: raw || 'Facebook ขัดข้องชั่วคราว ลองอีกครั้ง' };
  }
  return { kind: 'unknown', code: 'send_failed', httpStatus: 502, message: raw || 'ส่งข้อความไม่สำเร็จ' };
}

function markMetaPageUnhealthy(pageId, classified) {
  metaPageHealth.set(pageId, {
    healthy: false,
    code: classified.code,
    message: classified.message,
    at: new Date().toISOString(),
  });
}

function markMetaPageHealthy(pageId) {
  if (metaPageHealth.has(pageId)) metaPageHealth.delete(pageId);
}

function getMetaPageHealth(pageId) {
  return metaPageHealth.get(pageId) || { healthy: true };
}

/** Snapshot of every page that has ever been flagged unhealthy in this
 *  process. Surfaced via /api/fb/integration/status so the Settings UI
 *  can show "Reconnect FB" banners. */
function metaPageHealthSnapshot() {
  const out = {};
  for (const [pageId, h] of metaPageHealth) out[pageId] = h;
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// AI auto-reply.
//
// Called from the inbound webhook handlers right after a customer message is
// stored. We bail silently in any of these cases:
//   * Bot is turned off for this conversation (per-thread switch in the UI)
//   * autoFaq toggle is off in Settings → Bot
//   * No ANTHROPIC_API_KEY set (mock-only deploy)
//   * The customer message is empty / sticker-only / image-only
//   * Claude returns null (rate limit, error, refusal)
// On success, we push the reply through the same send path the human agent
// uses, tagged sender='ai' so it shows up with the AI badge in the inbox.
// ──────────────────────────────────────────────────────────────────────────
/**
 * Keyword auto-reply: matched BEFORE the AI path so simple FAQs (price,
 * shipping, return) don't burn API tokens. Each rule has 1+ keywords and a
 * fixed reply. Matching is case-insensitive substring, first match wins.
 * Returns true if a reply was sent so the caller can skip the AI step.
 */
async function tryKeywordReply({ channel, conversationId, customerText, shopId }) {
  if (!customerText || !String(customerText).trim()) return false;
  if (!isBotEnabled(conversationId, shopId)) return false;
  let rules;
  try {
    rules = await getKeywordRulesForShop(shopId || DEFAULT_SHOP_ID);
  } catch {
    rules = [];
  }
  if (!Array.isArray(rules) || rules.length === 0) return false;
  const hay = String(customerText).toLowerCase();
  const match = rules.find(
    (r) =>
      r &&
      r.enabled !== false &&
      typeof r.reply === 'string' &&
      r.reply.trim() &&
      Array.isArray(r.keywords) &&
      r.keywords.some((k) => typeof k === 'string' && k.trim() && hay.includes(k.toLowerCase().trim())),
  );
  if (!match) return false;
  try {
    if (channel === 'line') {
      await sendLineMessage({ conversationId, text: match.reply, asAi: true });
    } else {
      await sendMetaMessage({ conversationId, text: match.reply, asAi: true });
    }
    return true;
  } catch (e) {
    console.warn('[keyword] reply failed:', e?.message || e);
    return false;
  }
}

async function tryAutoReply({ channel, conversationId, thread, customerText, shopId }) {
  if (!customerText || !String(customerText).trim()) return;
  // Threads carry their shopId now — fall back to it if the caller didn't pass one.
  const sid = shopId || thread?.shopId || DEFAULT_SHOP_ID;
  if (!isBotEnabled(conversationId, sid)) return;

  // Keyword rules first — they're cheap, deterministic, and don't need an AI key.
  if (await tryKeywordReply({ channel, conversationId, customerText, shopId: sid })) return;

  // Fall through to AI for everything not covered by an explicit rule.
  if (!isAiEnabled()) return;
  let settings;
  try {
    settings = await getBotSettingsForShop(sid);
  } catch {
    settings = {};
  }
  if (settings && settings.autoFaq === false) return;

  let products = [];
  try {
    // AI needs the THIS shop's catalog, not the union of every shop's
    // products on the deployment. `sid` was resolved above from thread.shopId.
    products = await dbListProducts(sid);
  } catch {
    /* swallow — empty catalog is fine */
  }

  const reply = await generateReply({
    customerText,
    customerName: thread?.displayName || '',
    channel,
    threadMessages: thread?.messages || [],
    products,
    botSettings: settings || {},
    locale: 'th',
  });
  if (!reply) return;

  try {
    if (channel === 'line') {
      await sendLineMessage({ conversationId, text: reply, asAi: true });
    } else {
      await sendMetaMessage({ conversationId, text: reply, asAi: true });
    }
  } catch (e) {
    console.warn('[ai] send-back failed:', e?.message || e);
  }
}

app.post('/api/messages/send', express.json({ limit: '50kb' }), async (req, res) => {
  const { conversationId } = req.body || {};
  const id = String(conversationId || '');
  const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
  let result;
  if (id.startsWith('line:')) result = await sendLineMessage({ ...(req.body || {}), shopId });
  else if (id.startsWith('fb:') || id.startsWith('ig:')) result = await sendMetaMessage({ ...(req.body || {}), shopId });
  else result = { status: 400, error: 'unknown conversationId prefix (expected line:/fb:/ig:)' };
  if (result.status >= 400) return res.status(result.status).json(passThroughSendError(result));
  return res.json({ ok: true });
});

app.post('/api/fb/send', express.json({ limit: '50kb' }), async (req, res) => {
  const result = await sendMetaMessage(req.body || {});
  if (result.status >= 400) return res.status(result.status).json(passThroughSendError(result));
  return res.json({ ok: true });
});

/**
 * Shape the structured fields from sendMetaMessage / sendLineMessage into a
 * stable JSON payload the inbox composer can branch on. The composer reads
 * `errorCode` to decide which UI banner to show — 'window_expired' surfaces
 * the 24h-rule explanation, 'token_invalid' steers the user to Settings.
 */
function passThroughSendError(result) {
  const body = { error: result.error || 'send_failed' };
  if (result.errorCode) body.errorCode = result.errorCode;
  if (result.friendlyMessage) body.friendlyMessage = result.friendlyMessage;
  if (result.needsReconnect) body.needsReconnect = true;
  if (result.pageId) body.pageId = result.pageId;
  if (result.lastCustomerAt) body.lastCustomerAt = result.lastCustomerAt;
  return body;
}

// ─────────────────────────────────────────────────────────────────────────────
// Facebook "Connect" flow — Zaapi-style: one button, OAuth popup, page picker.
//
// Requires in .env:  FB_APP_ID, FB_APP_SECRET (+ FB_VERIFY_TOKEN for webhook).
// Stores chosen page token in server/integrations.json (NOT .env).
// ─────────────────────────────────────────────────────────────────────────────

// Permissions for Facebook Pages + Instagram Business messaging.
// Production: these need to be approved in Meta App Review before non-admin users can grant them.
const FB_SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'pages_read_engagement',
  'business_management',
  'instagram_basic',
  'instagram_manage_messages',
].join(',');

/**
 * Where Meta should redirect after OAuth.
 * Order: PUBLIC_BASE_URL env (preferred for production)
 *      → x-forwarded-host (behind Cloudflare/nginx/etc.)
 *      → req.host (works for localhost dev)
 * Trailing slashes are stripped so the registered redirect URI stays exact.
 */
function publicBaseUrl(req) {
  const env = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (env) return env;
  const proto = (req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http')).toString().split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().trim();
  return `${proto}://${host}`;
}

/** Map<state, { createdAt, returnTo }> for CSRF on the OAuth roundtrip. */
const fbOauthStates = new Map();

app.get('/api/fb/integration/status', async (_req, res) => {
  syncFbConfigFromEnv();
  const oauthPage = primaryFbPageForApi();
  const replyEnabled = fbHasPageToken();
  const webhookReady = fbHasVerify;
  let page = oauthPage;
  let tokenSource = oauthPage ? 'oauth' : null;
  if (!page && fbConfig.fallbackPageAccessToken) {
    const envPage = await fetchEnvFallbackPageProfile();
    if (envPage) {
      page = envPage;
      tokenSource = 'env';
    }
  }
  // Per-page health. `pageHealth` maps pageId → details if the last send
  // failed with a token-style error. Settings reads this to show a
  // "Reconnect FB" banner instead of a vague "send failed" message later.
  const pageHealth = metaPageHealthSnapshot();
  const allConnectedPages = listPages();
  const anyPageBroken = allConnectedPages.some((p) => pageHealth[p.id]?.healthy === false);

  res.json({
    connected: webhookReady || replyEnabled,
    webhookReady,
    replyEnabled,
    page,
    tokenSource,
    oauthAvailable: fbOauthAvailable,
    appId: fbConfig.appId || null,
    needsAppSecret: !fbHasAppSecret,
    needsVerifyToken: !fbHasVerify,
    apiVersion: fbConfig.apiVersion,
    pageHealth,
    needsReconnect: anyPageBroken,
    /** Booleans only — helps confirm Railway/production actually loaded each key (names must match exactly). */
    envPresent: {
      FB_APP_ID: Boolean(fbConfig.appId),
      FB_APP_SECRET: Boolean(fbHasAppSecret),
      FB_PAGE_ACCESS_TOKEN: Boolean(fbConfig.fallbackPageAccessToken),
      FB_VERIFY_TOKEN: Boolean(fbHasVerify),
    },
  });
});

app.get('/api/fb/oauth/start', (req, res) => {
  syncFbConfigFromEnv();
  if (!fbOauthAvailable) {
    return res
      .status(400)
      .send('FB_APP_ID and FB_APP_SECRET must be set in .env before using Connect Facebook.');
  }
  const state = crypto.randomBytes(16).toString('hex');
  fbOauthStates.set(state, { createdAt: Date.now() });
  // Garbage-collect old states (>10 min)
  for (const [k, v] of fbOauthStates) if (Date.now() - v.createdAt > 10 * 60 * 1000) fbOauthStates.delete(k);

  const redirectUri = `${publicBaseUrl(req)}/api/fb/oauth/callback`;
  const url =
    `https://www.facebook.com/${fbConfig.apiVersion}/dialog/oauth` +
    `?client_id=${encodeURIComponent(fbConfig.appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(FB_SCOPES)}`;
  res.redirect(302, url);
});

app.get('/api/fb/oauth/callback', async (req, res) => {
  const { code, state, error: oauthError, error_description } = req.query;
  if (oauthError) return res.status(400).send(`Facebook returned: ${oauthError} — ${error_description || ''}`);
  if (!code || !state || !fbOauthStates.has(String(state))) {
    return res.status(400).send('Missing or invalid OAuth state. Try again.');
  }
  fbOauthStates.delete(String(state));
  if (!fbOauthAvailable) return res.status(400).send('FB OAuth not configured.');

  const redirectUri = `${publicBaseUrl(req)}/api/fb/oauth/callback`;
  try {
    // 1. code → user access token
    const tokUrl =
      `https://graph.facebook.com/${fbConfig.apiVersion}/oauth/access_token` +
      `?client_id=${encodeURIComponent(fbConfig.appId)}` +
      `&client_secret=${encodeURIComponent(fbConfig.appSecret)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&code=${encodeURIComponent(String(code))}`;
    const tokRes = await fetch(tokUrl);
    const tokJson = await tokRes.json();
    if (tokJson?.error || !tokJson?.access_token) {
      return res.status(502).send(`OAuth exchange failed: ${tokJson?.error?.message || 'no token'}`);
    }
    const userToken = tokJson.access_token;

    // 2. user token → exchange for long-lived (60d)
    const longUrl =
      `https://graph.facebook.com/${fbConfig.apiVersion}/oauth/access_token` +
      `?grant_type=fb_exchange_token` +
      `&client_id=${encodeURIComponent(fbConfig.appId)}` +
      `&client_secret=${encodeURIComponent(fbConfig.appSecret)}` +
      `&fb_exchange_token=${encodeURIComponent(userToken)}`;
    const longRes = await fetch(longUrl);
    const longJson = await longRes.json();
    const longUserToken = longJson?.access_token || userToken;

    // 3. /me/accounts → list pages with their tokens (+ linked IG Business account in one call).
    const accountsUrl =
      `https://graph.facebook.com/${fbConfig.apiVersion}/me/accounts` +
      `?fields=id,name,category,picture{url},access_token,instagram_business_account{id,username,name,profile_picture_url}` +
      `&access_token=${encodeURIComponent(longUserToken)}`;
    const accRes = await fetch(accountsUrl);
    const accJson = await accRes.json();
    if (accJson?.error) {
      return res.status(502).send(`Failed to list pages: ${accJson.error?.message}`);
    }
    const pages = (Array.isArray(accJson?.data) ? accJson.data : []).map((p) => ({
      ...p,
      instagram: p.instagram_business_account
        ? {
            id: p.instagram_business_account.id,
            username: p.instagram_business_account.username,
            name: p.instagram_business_account.name,
            picture: p.instagram_business_account.profile_picture_url || null,
          }
        : null,
    }));

    // Render the combined Page + Instagram picker that lives inside the OAuth popup.
    const pickerHtml = renderPagePicker(pages);
    res.set('Content-Type', 'text/html; charset=utf-8').send(pickerHtml);
  } catch (e) {
    console.error('FB OAuth callback error:', e);
    res.status(500).send(`OAuth handler error: ${e?.message || e}`);
  }
});

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderPagePicker(pages) {
  // We pass page data via JSON in a script tag rather than data-* to keep tokens out of the DOM.
  const safePages = pages.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category || '',
    picture: p?.picture?.data?.url || '',
    access_token: p.access_token,
    instagram: p.instagram || null,
  }));

  const cards = safePages
    .map((p, idx) => {
      const pic = p.picture || `https://api.dicebear.com/7.x/notionists/svg?seed=${encodeURIComponent(p.id)}`;
      const igRow = p.instagram
        ? `<div class="ig"><span class="ig-dot"></span>IG: <b>@${escHtml(p.instagram.username)}</b>${p.instagram.name ? ` · ${escHtml(p.instagram.name)}` : ''}</div>`
        : '<div class="ig ig-none">No Instagram Business account linked to this Page</div>';
      return `
      <button class="page" data-idx="${idx}" type="button">
        <img src="${escHtml(pic)}" alt="" />
        <div class="meta">
          <div class="n">${escHtml(p.name)}</div>
          <div class="c">${escHtml(p.category || 'Facebook Page')}</div>
          ${igRow}
        </div>
        <span class="pick">Connect →</span>
      </button>`;
    })
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Connect Facebook & Instagram</title>
<style>
  *{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;background:linear-gradient(180deg,#0f172a,#1e1b4b);color:#f1f5f9;min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:32px 16px}
  .wrap{max-width:560px;width:100%}
  .brand{display:flex;align-items:center;gap:8px;margin-bottom:16px}
  .brand .logo{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#8b5cf6,#d946ef);display:grid;place-items:center;font-weight:700;font-size:14px}
  .brand b{font-size:13px;letter-spacing:.02em}
  h1{font-size:20px;margin:0 0 4px;font-weight:700;letter-spacing:-0.01em}
  p.sub{color:#94a3b8;margin:0 0 20px;font-size:13px}
  .pages{display:grid;gap:10px}
  .page{display:flex;gap:14px;align-items:flex-start;padding:14px;border-radius:14px;border:1px solid #334155;background:#1e293b;color:inherit;text-align:left;cursor:pointer;font:inherit;transition:.15s}
  .page:hover{border-color:#a78bfa;background:#27334a;transform:translateY(-1px)}
  .page:disabled{opacity:.6;cursor:wait}
  .page>img{width:44px;height:44px;border-radius:50%;background:#0f172a;object-fit:cover;flex-shrink:0}
  .meta{flex:1;min-width:0}
  .n{font-weight:600;font-size:15px;color:#f8fafc}
  .c{font-size:12px;color:#94a3b8;margin-top:2px}
  .ig{margin-top:6px;font-size:12px;color:#fbcfe8;display:flex;align-items:center;gap:6px}
  .ig-none{color:#64748b}
  .ig-dot{width:7px;height:7px;border-radius:50%;background:linear-gradient(135deg,#FFD600,#D62976)}
  .pick{margin-left:auto;font-size:12px;color:#a78bfa;font-weight:600;align-self:center;flex-shrink:0}
  .empty{padding:40px;text-align:center;color:#94a3b8;border:1px dashed #334155;border-radius:14px}
  .ok{padding:60px 20px;text-align:center}
  .ok .check{width:64px;height:64px;border-radius:50%;background:#16a34a;color:#fff;display:grid;place-items:center;font-size:32px;margin:0 auto 16px}
  .ok h1{font-size:22px;color:#86efac}
  .err{padding:14px 16px;background:#7f1d1d;border-radius:10px;color:#fecaca;margin-top:16px;font-size:12px;white-space:pre-wrap}
  .footer{margin-top:20px;font-size:11px;color:#64748b;line-height:1.6}
</style></head><body>
<div class="wrap">
  <div class="brand"><div class="logo">⚡</div><b>Chatz</b></div>
  <h1>Choose a Facebook Page to connect</h1>
  <p class="sub">Chatz will receive messages from this Page and its linked Instagram account, and can reply on your behalf.</p>
  <div class="pages">${pages.length ? cards : '<div class="empty">No Pages found on this Facebook account.<br>Make sure you have <b>admin access</b> to a Page and try again.</div>'}</div>
  <div id="err" style="display:none" class="err"></div>
  <div class="footer">By connecting, you allow Chatz to read &amp; reply to messages on the selected Page and its linked Instagram Business account. You can disconnect at any time from Settings → Integrations.</div>
</div>
<script>
  const PAGES = ${JSON.stringify(safePages)};
  document.querySelectorAll('.page').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.querySelector('.pick').textContent = 'Connecting…';
      const idx = Number(btn.dataset.idx);
      const p = PAGES[idx];
      try {
        const r = await fetch('/api/fb/integration/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: p.id, name: p.name, category: p.category, picture: p.picture,
            access_token: p.access_token, instagram: p.instagram,
          }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error || 'Failed to connect');
        document.body.innerHTML = '<div class="wrap"><div class="ok"><div class="check">✓</div><h1>Connected!</h1><p class="sub">Your Facebook Page' + (p.instagram ? ' and Instagram' : '') + ' is now linked to Chatz.<br>You can close this window.</p></div></div>';
        if (window.opener) {
          try { window.opener.postMessage({ type: 'chatz:fb-connected', page: data.page }, '*'); } catch (e) {}
          setTimeout(() => window.close(), 1200);
        }
      } catch (e) {
        const el = document.getElementById('err'); el.style.display = 'block'; el.textContent = String(e.message || e);
        btn.disabled = false; btn.querySelector('.pick').textContent = 'Try again';
      }
    });
  });
</script>
</body></html>`;
}

/**
 * Fetch the last ~25 Messenger conversations (and IG if igAccountId given)
 * and populate fbThreads with historical messages.  Runs after OAuth connect
 * so the inbox isn't empty on first load.
 */
async function syncFbConversationHistory(pageId, pageToken, igAccountId) {
  const api = fbConfig.apiVersion;

  // ── Facebook Messenger ──────────────────────────────────────────────────
  try {
    const url =
      `https://graph.facebook.com/${api}/${encodeURIComponent(pageId)}/conversations` +
      `?platform=messenger` +
      `&fields=participants,messages{id,message,from,created_time,attachments{mime_type,file_url}}` +
      `&limit=25` +
      `&access_token=${encodeURIComponent(pageToken)}`;
    const r = await fetch(url);
    const data = await r.json();
    if (data?.error) {
      console.warn('[FB History] conversations error:', data.error?.message || data.error);
    } else {
      const ownerPage = findPageByPageId(pageId);
      const ownerShopId = ownerPage?.shopId || DEFAULT_SHOP_ID;
      for (const convo of Array.isArray(data?.data) ? data.data : []) {
        const participants = convo?.participants?.data || [];
        const customer = participants.find((p) => p.id !== pageId);
        if (!customer) continue;
        const thread = getOrCreateFbThread(customer.id, 'fb', ownerShopId, pageId);
        if (customer.name && !thread.displayName) thread.displayName = customer.name;
        const existing = new Set(thread.messages.map((m) => m.id));
        const msgs = Array.isArray(convo?.messages?.data) ? [...convo.messages.data].reverse() : [];
        for (const msg of msgs) {
          if (existing.has(msg.id)) continue;
          const isPage = msg.from?.id === pageId;
          const row = {
            id: msg.id,
            receivedAt: msg.created_time || new Date().toISOString(),
            sender: isPage ? 'agent' : 'customer',
          };
          if (msg.message) row.text = msg.message;
          const atts = msg.attachments?.data || [];
          for (const att of atts) {
            const fu = att.file_url;
            if (typeof fu !== 'string') continue;
            if (att.mime_type?.startsWith('video/')) { if (!row.video) row.video = fu; }
            else if (att.mime_type?.startsWith('image/')) { if (!row.image) row.image = fu; }
          }
          thread.messages.push(row);
          existing.add(msg.id);
        }
        thread.messages.sort((a, b) => new Date(a.receivedAt) - new Date(b.receivedAt));
        if (thread.messages.length) thread.updatedAt = thread.messages.at(-1).receivedAt;
        markChatStateDirty();
        // Enrich display name from Graph API if participants didn't include it
        if (!thread.displayName) {
          void enrichFbProfile(customer.id, thread, pageId).catch(() => {});
        }
      }
    }
  } catch (e) {
    console.warn('[FB History] FB sync failed:', e?.message || e);
  }

  // ── Instagram ────────────────────────────────────────────────────────────
  if (!igAccountId) return;
  try {
    const url =
      `https://graph.facebook.com/${api}/${encodeURIComponent(igAccountId)}/conversations` +
      `?platform=instagram` +
      `&fields=participants,messages{id,text,from,timestamp,attachments{name}}` +
      `&limit=25` +
      `&access_token=${encodeURIComponent(pageToken)}`;
    const r = await fetch(url);
    const data = await r.json();
    if (data?.error) {
      console.warn('[IG History] conversations error:', data.error?.message || data.error);
    } else {
      const ownerPage = findPageByIgId(igAccountId) || findPageByPageId(pageId);
      const ownerShopId = ownerPage?.shopId || DEFAULT_SHOP_ID;
      for (const convo of Array.isArray(data?.data) ? data.data : []) {
        const participants = convo?.participants?.data || [];
        const customer = participants.find((p) => p.id !== igAccountId);
        if (!customer) continue;
        const thread = getOrCreateFbThread(customer.id, 'ig', ownerShopId, ownerPage?.id || null);
        if (customer.name && !thread.displayName) thread.displayName = customer.name;
        const existing = new Set(thread.messages.map((m) => m.id));
        const msgs = Array.isArray(convo?.messages?.data) ? [...convo.messages.data].reverse() : [];
        for (const msg of msgs) {
          if (existing.has(msg.id)) continue;
          const isIgAccount = msg.from?.id === igAccountId;
          const row = {
            id: msg.id,
            receivedAt: msg.timestamp || new Date().toISOString(),
            sender: isIgAccount ? 'agent' : 'customer',
          };
          if (msg.text) row.text = msg.text;
          thread.messages.push(row);
          existing.add(msg.id);
        }
        thread.messages.sort((a, b) => new Date(a.receivedAt) - new Date(b.receivedAt));
        if (thread.messages.length) thread.updatedAt = thread.messages.at(-1).receivedAt;
        markChatStateDirty();
      }
    }
  } catch (e) {
    console.warn('[IG History] IG sync failed:', e?.message || e);
  }
}

app.post('/api/fb/integration/connect', express.json({ limit: '20kb' }), async (req, res) => {
  const { id, name, category, picture, access_token, instagram } = req.body || {};
  if (!id || !access_token) {
    return res.status(400).json({ error: 'id and access_token are required' });
  }
  // Bind the Page to the caller's active shop. Without this, two shops
  // connecting different Pages would silently end up sharing one inbox.
  const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
  // Guard: another shop can't claim a Page that's already wired up elsewhere
  // (would silently steal its inbox routing).
  const existing = findPageByPageId(id);
  if (existing && existing.shopId && existing.shopId !== shopId) {
    return res.status(409).json({
      error: 'Page นี้ถูกเชื่อมกับร้านอื่นแล้ว — ตัดการเชื่อมที่ร้านเดิมก่อน',
    });
  }
  try {
    // Subscribe this Page to our app's webhook (this delivers BOTH FB Page DMs and IG DMs
    // for the linked Instagram Business account, as long as the App Dashboard has webhooks
    // enabled for both `Page` and `Instagram` products).
    const subUrl =
      `https://graph.facebook.com/${fbConfig.apiVersion}/${encodeURIComponent(id)}/subscribed_apps` +
      `?subscribed_fields=${encodeURIComponent('messages,messaging_postbacks,message_reads,messaging_handovers')}` +
      `&access_token=${encodeURIComponent(access_token)}`;
    const subRes = await fetch(subUrl, { method: 'POST' });
    const subJson = await subRes.json().catch(() => ({}));
    if (!subRes.ok || subJson?.error) {
      return res
        .status(502)
        .json({ error: `Page subscribe failed: ${subJson?.error?.message || subRes.statusText}` });
    }
    await upsertPage({
      id,
      name,
      category,
      picture,
      pageAccessToken: access_token,
      instagram: instagram
        ? { id: instagram.id, username: instagram.username, name: instagram.name, picture: instagram.picture }
        : null,
      connectedAt: new Date().toISOString(),
      shopId,
    });
    // Reconnect completed — clear any stale "token broken" flag from a
    // prior revoked-token failure so the Settings banner disappears.
    markMetaPageHealthy(id);
    if (instagram?.id) markMetaPageHealthy(instagram.id);
    refreshFbState();

    // Fire-and-forget: load conversation history so inbox is populated immediately.
    void syncFbConversationHistory(id, access_token, instagram?.id || null).catch((e) =>
      console.warn('[FB History] initial sync failed:', e?.message || e),
    );

    return res.json({ ok: true, page: primaryFbPageForApi() });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

/** Manual trigger: re-sync conversation history for all connected pages. */
app.post('/api/fb/sync-history', async (_req, res) => {
  const pages = listPages().filter((p) => p.pageAccessToken);
  if (!pages.length) return res.status(400).json({ error: 'No pages connected' });
  const results = [];
  for (const p of pages) {
    const before = fbThreads.size;
    await syncFbConversationHistory(p.id, p.pageAccessToken, p.instagram?.id || null).catch((e) =>
      console.warn('[FB History] manual sync failed:', e?.message || e),
    );
    results.push({ page: p.name, threadsAdded: fbThreads.size - before });
  }
  res.json({ ok: true, results, totalThreads: fbThreads.size });
});

/**
 * Static legal pages — rendered as HTML so they're indexable and the URL
 * can be plugged directly into Facebook / Google App Review forms and into
 * LINE Module Channel applications, all of which require these URLs.
 *
 * Both pages are intentionally one-file HTML rather than SPA routes so
 * crawlers and policy reviewers see real content even before the JS bundle
 * loads, and so they keep working if the SPA build is broken.
 */
function legalPage({ title, lastUpdated, body }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title} · Chatz</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font:15px/1.65 -apple-system,system-ui,sans-serif;max-width:760px;margin:0 auto;padding:48px 24px;color:#0f172a;background:#fafafa}
  .brand{display:flex;align-items:center;gap:10px;margin-bottom:32px}
  .brand .logo{width:36px;height:36px;border-radius:10px;background:#7c3aed;display:grid;place-items:center;color:#fff;font-weight:700}
  .brand b{font-size:18px}
  article{background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:36px 40px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
  h1{font-size:28px;font-weight:700;margin:0 0 6px}
  .meta{color:#64748b;font-size:13px;margin-bottom:28px}
  h2{font-size:18px;margin:32px 0 8px;font-weight:600}
  h3{font-size:15px;margin:20px 0 6px;font-weight:600;color:#334155}
  p,li{color:#1e293b}
  code{background:#f1f5f9;padding:1px 6px;border-radius:4px;font-size:13px}
  ul{padding-left:22px}
  a{color:#7c3aed}
  hr{border:0;border-top:1px solid #e2e8f0;margin:32px 0}
  .footer{text-align:center;color:#94a3b8;font-size:12px;margin-top:32px}
</style></head><body>
<div class="brand"><div class="logo">⚡</div><b>Chatz</b></div>
<article>
<h1>${title}</h1>
<p class="meta"><b>Last updated:</b> ${lastUpdated}</p>
${body}
</article>
<p class="footer">Questions? Reach us at support@chatz.app</p>
</body></html>`;
}

app.get('/api/privacy', (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', 'text/html; charset=utf-8').send(legalPage({
    title: 'Privacy Policy',
    lastUpdated: today,
    body: `
<p>This Privacy Policy describes how Chatz ("we", "us") collects, uses, and shares information when you create an account and use our multi-channel chat aggregator service.</p>

<h2>1. Information we collect</h2>

<h3>Account information</h3>
<ul>
  <li><b>You provide:</b> username, password (hashed with bcrypt), display name, and optionally an email address.</li>
  <li><b>From OAuth providers (Google, Facebook):</b> if you sign in with one of these, we receive a stable user id, display name, email address, and profile photo URL.</li>
</ul>

<h3>Connected channel data</h3>
<ul>
  <li><b>LINE:</b> Channel access token, Channel secret, Official Account profile (id, name, picture).</li>
  <li><b>Facebook Messenger / Instagram:</b> Page access token, Page id/name/picture, linked Instagram Business id/username, customer messages, message attachments (images, videos).</li>
  <li><b>Customer profile data</b> for the people who message your connected channels: their platform-scoped id (PSID / LINE userId), display name, profile photo URL, and the message content.</li>
</ul>

<h3>Business data you create in Chatz</h3>
<ul>
  <li>Products, orders, payment slip records, tags you assign to customers, brand voice settings, keyword auto-reply rules.</li>
</ul>

<h3>Automatic / technical data</h3>
<ul>
  <li>Session cookie used to keep you signed in (httpOnly, 30-day expiry).</li>
  <li>Request IP address for rate-limiting (not stored long-term).</li>
  <li>Server error logs containing API responses from connected platforms.</li>
</ul>

<h2>2. How we use the information</h2>
<p>We use the data <b>only</b> to provide the service:</p>
<ul>
  <li>Display your inbox and route replies to the correct channel.</li>
  <li>Generate AI auto-replies and verify payment slips when you opt in to those features.</li>
  <li>Authenticate you and remember which shop you're working on.</li>
  <li>Send transactional emails: password reset, team invite confirmations.</li>
</ul>
<p>We do <b>not</b> sell your data. We do not use your conversations to train AI models for other customers.</p>

<h2>3. Third-party processors</h2>
<p>Service-critical data is shared with these processors only to the extent necessary to operate Chatz:</p>
<ul>
  <li><b>LINE Corporation</b> — to send/receive LINE messages on your behalf.</li>
  <li><b>Meta Platforms (Facebook / Instagram)</b> — to send/receive Messenger and Instagram DMs.</li>
  <li><b>Anthropic</b> — when AI auto-reply is enabled, message text is sent to the Claude API to generate a response. Anthropic's API does not train on customer inputs by default.</li>
  <li><b>EasySlip</b> — when slip verification is enabled, payment slip images are sent to EasySlip's API to extract bank/amount/reference data.</li>
  <li><b>Resend</b> — for transactional email delivery (password reset).</li>
  <li><b>Hosting provider</b> (Railway / your chosen host) — runs the server and database.</li>
</ul>

<h2>4. Data retention</h2>
<ul>
  <li>Account data is retained until you delete your account (Settings → Security → Delete account).</li>
  <li>Connected-channel tokens are deleted immediately when you disconnect a channel in Settings → Integrations.</li>
  <li>Customer messages are retained as long as the corresponding chat thread exists in your inbox; deleting your account removes them.</li>
  <li>Server-side logs are kept for at most 30 days for debugging.</li>
</ul>

<h2>5. Your rights</h2>
<p>You can at any time:</p>
<ul>
  <li><b>Access &amp; export</b> your data via the API or by request to support@chatz.app.</li>
  <li><b>Correct</b> profile information from Settings → Profile.</li>
  <li><b>Delete</b> your account from Settings → Security → Delete account. This is irreversible.</li>
  <li><b>Withdraw OAuth consent</b> from each provider's account settings (e.g. Google Account → Security → Third-party apps).</li>
  <li><b>Request Meta data deletion</b> via <code>/api/fb/data-deletion</code> (the URL you registered in your Meta App Settings → Data Deletion Callback).</li>
</ul>

<h2>6. Security</h2>
<p>Passwords are stored as bcrypt hashes; we never see your plaintext password. OAuth tokens are stored encrypted at rest where supported by the hosting database. Session cookies are httpOnly + SameSite=Lax + Secure in production.</p>

<h2>7. Children</h2>
<p>Chatz is intended for business users aged 18 and over. We do not knowingly collect data from anyone under 13.</p>

<h2>8. Changes to this policy</h2>
<p>If we materially change how we handle data, we'll update the "Last updated" date above and notify active users via the in-app banner.</p>

<h2>9. Contact</h2>
<p>Privacy questions or data-deletion requests: <b>support@chatz.app</b></p>
    `,
  }));
});

app.get('/api/terms', (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', 'text/html; charset=utf-8').send(legalPage({
    title: 'Terms of Service',
    lastUpdated: today,
    body: `
<p>By creating a Chatz account and using the service, you ("you", "the user") agree to these terms.</p>

<h2>1. The service</h2>
<p>Chatz is a multi-channel chat aggregator. It connects to your LINE Official Account, Facebook Page, and/or Instagram Business account so you can read and reply to customer conversations from a single inbox. Optional features include AI-generated reply suggestions and payment slip verification.</p>

<h2>2. Account &amp; eligibility</h2>
<ul>
  <li>You must be at least 18 years old.</li>
  <li>You're responsible for keeping your password and OAuth-linked accounts secure.</li>
  <li>You may not create accounts using fraudulent information or impersonate another person or business.</li>
</ul>

<h2>3. Your content</h2>
<p>You retain ownership of every product, conversation, image, and configuration you put into Chatz. You grant us a limited license to store and process this content solely to provide the service to you and the teammates you invite.</p>
<p>You are responsible for ensuring you have the right to forward your customers' messages through Chatz (this is normally implicit when a customer messages your Page / LINE OA, but check your local data-protection laws).</p>

<h2>4. Acceptable use</h2>
<p>You agree NOT to use Chatz to:</p>
<ul>
  <li>Send unsolicited bulk messages or spam.</li>
  <li>Send messages that violate LINE's, Meta's, or any other connected platform's policies — they enforce, and a violation can get the OA/Page banned regardless of what we do.</li>
  <li>Send content that is illegal, harassing, deceptive, infringing, or harmful.</li>
  <li>Reverse-engineer or attempt to extract source code from the hosted service.</li>
  <li>Resell access to Chatz without our written permission.</li>
</ul>
<p>We may suspend or terminate accounts that violate these rules.</p>

<h2>5. Third-party services</h2>
<p>Chatz relies on LINE Corporation, Meta Platforms, Anthropic, EasySlip, and your hosting provider. Their terms also apply to your use of those features. Outages or policy changes on these platforms may affect Chatz functionality without notice.</p>

<h2>6. AI replies</h2>
<p>AI-generated reply suggestions are produced by a language model and may be inaccurate. <b>You are responsible for reviewing any AI-generated reply before sending it.</b> When you enable auto-reply, you accept that messages may be sent on your behalf without manual review.</p>

<h2>7. Payment slip verification</h2>
<p>Slip verification is a convenience tool, not a substitute for confirming payment yourself. Always verify high-value transactions against your bank account directly. Chatz is not a payment processor and does not handle funds.</p>

<h2>8. Pricing &amp; payment</h2>
<p>The current version of Chatz is offered as-is. If we introduce paid plans, we'll give you 30 days' notice before charging an account that wasn't on a paid plan before.</p>

<h2>9. Termination</h2>
<p>You can terminate your account at any time via Settings → Security → Delete account. We may terminate your account if you materially breach these terms; we'll try to give you notice and a chance to fix the issue first when reasonable.</p>

<h2>10. Disclaimer of warranties</h2>
<p>Chatz is provided "as is" without warranties of any kind. We don't guarantee that the service will be uninterrupted, that messages will always be delivered, or that AI replies will be correct.</p>

<h2>11. Limitation of liability</h2>
<p>To the maximum extent permitted by law, Chatz and its operators are not liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits, data, or revenue, arising from your use of the service.</p>

<h2>12. Changes</h2>
<p>We may update these terms; the updated version is posted at this URL with a new "Last updated" date. Continued use after a change means you accept the new terms.</p>

<h2>13. Governing law</h2>
<p>These terms are governed by the laws of Thailand. Disputes will be resolved in the courts of Bangkok, unless another forum is required by your local consumer-protection law.</p>

<h2>14. Contact</h2>
<p>Questions about these terms: <b>support@chatz.app</b></p>
    `,
  }));
});

app.post('/api/fb/data-deletion', express.urlencoded({ extended: false }), async (req, res) => {
  const signed = req.body?.signed_request || '';
  const confirmCode = crypto.randomBytes(8).toString('hex');
  try {
    await disconnectFb();
  } catch (e) {
    console.warn('data-deletion: disconnect failed:', e?.message || e);
  }
  console.log('[FB data-deletion] received signed_request len=', signed.length, 'code=', confirmCode);
  res.json({
    url: `${publicBaseUrl(req)}/api/fb/data-deletion/status?code=${confirmCode}`,
    confirmation_code: confirmCode,
  });
});

app.get('/api/fb/data-deletion/status', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html><html><body style="font:15px/1.6 system-ui;padding:40px;max-width:560px;margin:0 auto"><h2>Data deletion request received</h2><p>Reference code: <code>${escHtml(String(req.query?.code || ''))}</code></p><p>Your stored Page tokens and inbox cache have been removed from this server.</p></body></html>`);
});

app.post('/api/fb/integration/disconnect', async (_req, res) => {
  try {
    await disconnectFb();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// =====================================================================
// Auth: login / logout / current user
// =====================================================================

// Brute-force ceiling: 5 attempts/minute per IP. Real users with password
// autofill rarely exceed 2–3; bots scanning credentials hit this fast and
// get 429'd. Note this is per-IP only — a determined attacker rotating IPs
// would not be caught here; we still rely on bcrypt cost + (TODO) per-
// account lockout for that case.
app.post('/api/auth/login', rateLimit({ bucket: 'auth-login', limit: 5, windowMs: 60_000 }), express.json({ limit: '4kb' }), async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password) {
    return res.status(400).json({ error: 'username + password required' });
  }
  try {
    const result = await authLogin(username, password);
    if (!result.ok) return res.status(401).json({ error: 'invalid_credentials' });
    setSessionCookie(res, result.token);
    res.json({ user: result.user });
  } catch (e) {
    console.error('[auth] login failed:', e?.message || e);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * Public OAuth config — the frontend reads this to know whether to render
 * the "Sign in with Google / Facebook" buttons and what client IDs to use.
 * Client IDs are public; nothing sensitive returned.
 */
app.get('/api/auth/oauth-config', (_req, res) => {
  res.json({
    google: {
      enabled: Boolean((process.env.GOOGLE_CLIENT_ID || '').trim()),
      clientId: (process.env.GOOGLE_CLIENT_ID || '').trim() || null,
    },
    facebook: {
      enabled: Boolean((process.env.FB_APP_ID || '').trim() && (process.env.FB_APP_SECRET || '').trim()),
      appId: (process.env.FB_APP_ID || '').trim() || null,
    },
  });
});

/** Create a new password-based account. Auto-signs the user in on success. */
app.post('/api/auth/signup', rateLimit({ bucket: 'auth-signup', limit: 5, windowMs: 60_000 }), express.json({ limit: '4kb' }), async (req, res) => {
  try {
    const result = await authSignup({
      username: req.body?.username,
      password: req.body?.password,
      displayName: req.body?.displayName,
      email: req.body?.email,
    });
    if (!result.ok) {
      const code = result.reason === 'username_taken' || result.reason === 'email_taken' ? 409 : 400;
      return res.status(code).json({ error: result.reason });
    }
    setSessionCookie(res, result.token);
    res.json({ user: result.user });
  } catch (e) {
    console.error('[auth] signup failed:', e?.message || e);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * Kick off the password reset flow. Body: { identifier } where identifier
 * is either the user's username or email. Always returns 200 with the same
 * shape — never confirms whether the account exists (prevents user-table
 * enumeration). Rate-limited tightly so attackers can't brute-force.
 *
 * If RESEND_API_KEY is set, an email is sent. Otherwise the reset URL is
 * logged to the server console so an operator can relay it manually.
 */
app.post('/api/auth/forgot-password', rateLimit({ bucket: 'auth-forgot', limit: 3, windowMs: 60_000 }), express.json({ limit: '2kb' }), async (req, res) => {
  try {
    const identifier = String(req.body?.identifier || '').trim();
    if (!identifier) return res.json({ ok: true }); // silent on empty input
    await requestPasswordReset({
      identifier,
      resetUrlBuilder: (token) => `${publicBaseUrl(req)}/?reset=${encodeURIComponent(token)}`,
    });
    res.json({ ok: true, emailConfigured: isEmailEnabled() });
  } catch (e) {
    console.error('[auth] forgot-password failed:', e?.message || e);
    res.json({ ok: true }); // still don't leak the failure mode
  }
});

/** Preview a reset token before showing the new-password form. */
app.get('/api/auth/reset-password/:token', async (req, res) => {
  try {
    const preview = await previewPasswordReset(String(req.params.token || ''));
    if (!preview) return res.status(404).json({ error: 'invalid_or_expired' });
    res.json({ preview });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** Set the new password. Burns the token. */
app.post('/api/auth/reset-password', rateLimit({ bucket: 'auth-reset', limit: 10, windowMs: 60_000 }), express.json({ limit: '2kb' }), async (req, res) => {
  try {
    const token = String(req.body?.token || '');
    const newPassword = String(req.body?.newPassword || '');
    const result = await completePasswordReset(token, newPassword);
    if (!result.ok) {
      const code = result.reason === 'password_too_short' ? 400 : 401;
      return res.status(code).json({ error: result.reason });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[auth] reset-password failed:', e?.message || e);
    res.status(500).json({ error: 'server_error' });
  }
});

/** Sign in / sign up via Google Identity Services. Body: { credential }. */
app.post('/api/auth/oauth/google', rateLimit({ bucket: 'auth-oauth', limit: 10, windowMs: 60_000 }), express.json({ limit: '8kb' }), async (req, res) => {
  try {
    const credential = String(req.body?.credential || '');
    const result = await loginWithGoogle(credential);
    if (!result.ok) {
      const code = result.reason === 'google_not_configured' ? 503
        : result.reason === 'invalid_google_token' || result.reason === 'wrong_audience' ? 401
        : 400;
      return res.status(code).json({ error: result.reason });
    }
    setSessionCookie(res, result.token);
    res.json({ user: result.user });
  } catch (e) {
    console.error('[auth] google login failed:', e?.message || e);
    res.status(500).json({ error: 'server_error' });
  }
});

/** Sign in / sign up via Facebook Login. Body: { accessToken }. */
app.post('/api/auth/oauth/facebook', rateLimit({ bucket: 'auth-oauth', limit: 10, windowMs: 60_000 }), express.json({ limit: '8kb' }), async (req, res) => {
  try {
    const accessToken = String(req.body?.accessToken || '');
    const result = await loginWithFacebook(accessToken);
    if (!result.ok) {
      const code = result.reason === 'facebook_not_configured' ? 503
        : result.reason === 'invalid_fb_token' ? 401
        : 400;
      return res.status(code).json({ error: result.reason });
    }
    setSessionCookie(res, result.token);
    res.json({ user: result.user });
  } catch (e) {
    console.error('[auth] facebook login failed:', e?.message || e);
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const tok = getCookieToken(req);
    if (tok) await authLogout(tok);
  } finally {
    clearSessionCookie(res);
    res.json({ ok: true });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const u = await userFromRequest(req);
    if (!u) return res.json({ user: null, shops: [], activeShop: null });
    const shops = await listShopsForUser(u.id);
    const activeShopId = u.activeShopId || shops[0]?.id || DEFAULT_SHOP_ID;
    const activeShop = shops.find((s) => s.id === activeShopId) || shops[0] || null;
    res.json({ user: u, shops, activeShop });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** Switch the active shop for the current session. Body: { shopId }. */
app.post('/api/auth/active-shop', express.json({ limit: '1kb' }), async (req, res) => {
  const u = req.user;
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  const shopId = String(req.body?.shopId || '').trim();
  if (!shopId) return res.status(400).json({ error: 'shopId required' });
  const result = await setActiveShopForRequest(req, shopId);
  if (!result.ok) {
    const code = result.reason === 'not_a_member' ? 403 : 400;
    return res.status(code).json({ error: result.reason });
  }
  res.json({ ok: true, activeShopId: result.activeShopId });
});

/** Lightweight: list the current user's shops. */
app.get('/api/shops', async (req, res) => {
  const u = req.user;
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  try {
    const shops = await listShopsForUser(u.id);
    res.json({ shops });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ─── Team / member management ────────────────────────────────────────────────
//
// Membership lives in shop_members; this section adds the actions a shop owner
// needs to bring in collaborators (shareable invite link) and remove them
// later. Permissions:
//   - any member can list teammates (so they see who else has access)
//   - only owner can create invites or remove members
//   - members can leave themselves (remove their own row)

async function requireShopOwner(req, res, shopId) {
  const u = req.user;
  if (!u) { res.status(401).json({ error: 'unauthorized' }); return null; }
  const members = await listShopMembers(shopId);
  const me = members.find((m) => m.id === u.id);
  if (!me) { res.status(403).json({ error: 'not_a_member' }); return null; }
  if (me.role !== 'owner') { res.status(403).json({ error: 'owner_only' }); return null; }
  return { me, members };
}

app.get('/api/shops/:shopId/members', async (req, res) => {
  const u = req.user;
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  const shopId = String(req.params.shopId || '');
  if (!(await isShopMember(shopId, u.id))) return res.status(403).json({ error: 'not_a_member' });
  try {
    const members = await listShopMembers(shopId);
    res.json({ members });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * Owner generates a one-time invite token. Response includes the shareable
 * URL the owner can paste into LINE / IG / wherever — Chatz doesn't need to
 * send the email itself (avoids the SMTP provider dependency).
 */
app.post('/api/shops/:shopId/invites', express.json({ limit: '1kb' }), async (req, res) => {
  const shopId = String(req.params.shopId || '');
  const auth = await requireShopOwner(req, res, shopId);
  if (!auth) return; // response already written
  try {
    const role = req.body?.role === 'owner' ? 'owner' : 'staff';
    const token = crypto.randomBytes(24).toString('base64url');
    const created = await createShopInvite({
      shopId,
      token,
      role,
      createdBy: auth.me.id,
    });
    const url = `${publicBaseUrl(req)}/invite/${encodeURIComponent(token)}`;
    res.json({ invite: { ...created, url } });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * Public preview — anyone with the token can fetch shop name + role.
 * Caller's auth state doesn't matter (they might still be on the sign-up
 * page). Acceptance, however, is auth-required.
 */
app.get('/api/shops/invites/:token', async (req, res) => {
  try {
    const invite = await findShopInvite(String(req.params.token || ''));
    if (!invite) return res.status(404).json({ error: 'invalid_or_expired' });
    res.json({ invite: { shopId: invite.shopId, shopName: invite.shopName, role: invite.role, expiresAt: invite.expiresAt } });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * Current user accepts the invite — must be signed in first.
 *
 * Path lives under `/api/shops/invites/` which is in the auth allowlist
 * (so the public preview endpoint stays reachable without login). That
 * means req.user is NOT pre-populated; resolve the session by hand here.
 */
app.post('/api/shops/invites/:token/accept', async (req, res) => {
  const u = await userFromRequest(req);
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  try {
    const invite = await findShopInvite(String(req.params.token || ''));
    if (!invite) return res.status(404).json({ error: 'invalid_or_expired' });
    if (await isShopMember(invite.shopId, u.id)) {
      // Already a member — burn the token so it can't be reused.
      await consumeShopInvite(invite.token);
      return res.json({ ok: true, shopId: invite.shopId, alreadyMember: true });
    }
    await addShopMember({ shopId: invite.shopId, userId: u.id, role: invite.role });
    await consumeShopInvite(invite.token);
    res.json({ ok: true, shopId: invite.shopId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * Owner removes a teammate, OR a non-owner removes themselves (leave shop).
 * Last remaining owner can't be removed — guard against locking the shop out.
 */
app.delete('/api/shops/:shopId/members/:userId', async (req, res) => {
  const u = req.user;
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  const shopId = String(req.params.shopId || '');
  const targetUserId = String(req.params.userId || '');
  try {
    const members = await listShopMembers(shopId);
    const me = members.find((m) => m.id === u.id);
    if (!me) return res.status(403).json({ error: 'not_a_member' });
    const target = members.find((m) => m.id === targetUserId);
    if (!target) return res.status(404).json({ error: 'not_a_member' });

    // Permission: owner can remove anyone, members can only remove themselves.
    if (me.role !== 'owner' && me.id !== targetUserId) {
      return res.status(403).json({ error: 'owner_only' });
    }
    // Guard: can't remove the last owner (would lock the shop out).
    if (target.role === 'owner') {
      const otherOwners = members.filter((m) => m.role === 'owner' && m.id !== targetUserId);
      if (otherOwners.length === 0) {
        return res.status(409).json({ error: 'last_owner' });
      }
    }
    await removeShopMember(shopId, targetUserId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/auth/change-password', express.json({ limit: '4kb' }), async (req, res) => {
  const u = req.user;
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  const result = await changePassword(u.id, req.body?.currentPassword, req.body?.newPassword);
  if (!result.ok) return res.status(400).json({ error: result.reason });
  res.json({ ok: true });
});

/**
 * Update the public profile (display name + email + avatar). Email collisions
 * with other accounts are rejected so OAuth and password accounts on the same
 * inbox can't accidentally merge.
 */
app.patch('/api/auth/profile', express.json({ limit: '8kb' }), async (req, res) => {
  const u = req.user;
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  try {
    const body = req.body || {};
    const patch = {};
    if (typeof body.displayName === 'string') {
      const v = body.displayName.trim().slice(0, 80);
      patch.displayName = v;
    }
    if (typeof body.email === 'string') {
      const v = body.email.trim().toLowerCase();
      if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        return res.status(400).json({ error: 'bad_email' });
      }
      if (v) {
        const owner = await findUserByEmail(v);
        if (owner && owner.id !== u.id) {
          return res.status(409).json({ error: 'email_taken' });
        }
      }
      patch.email = v || null;
    }
    if (typeof body.avatarUrl === 'string') {
      patch.avatarUrl = body.avatarUrl.trim().slice(0, 2000) || null;
    }
    const updated = await updateUserProfile(u.id, patch);
    if (!updated) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[auth] profile update failed:', e?.message || e);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * Permanent account deletion — required by Google + Facebook policy and
 * generally expected by a user who wants out. We block the call if the
 * user is the only owner of any shop (they'd orphan that shop's data);
 * the response includes the shop IDs so the UI can suggest transferring
 * ownership first.
 */
app.delete('/api/auth/me', async (req, res) => {
  const u = req.user;
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  try {
    const result = await deleteUserAccount(u.id);
    if (!result.ok) {
      return res.status(409).json({ error: result.reason, shopIds: result.shopIds || [] });
    }
    const tok = getCookieToken(req);
    if (tok) await authLogout(tok);
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (e) {
    console.error('[auth] account deletion failed:', e?.message || e);
    res.status(500).json({ error: 'server_error' });
  }
});

// =====================================================================
// Products (server-persisted shop catalog)
// =====================================================================

// Products + Orders endpoints are now shop-scoped. db.js helpers already
// accept a shopId parameter and default to DEFAULT_SHOP_ID, but the
// endpoints were never passing it — so every shop's catalog merged into
// one. We resolve activeShopIdFromRequest and thread it through.

app.get('/api/products', async (req, res) => {
  try {
    const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
    const items = await dbListProducts(shopId);
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/products', express.json({ limit: '70mb' }), async (req, res) => {
  try {
    const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
    const p = req.body?.product;
    if (!p?.id) return res.status(400).json({ error: 'product.id required' });
    const saved = await dbUpsertProduct(p, shopId);
    res.json({ product: saved });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
    await dbDeleteProduct(String(req.params.id || ''), shopId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// =====================================================================
// Orders (CRUD) — same shop scoping as Products.
// =====================================================================

app.get('/api/orders', async (req, res) => {
  try {
    const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
    const items = await dbListOrders(shopId);
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/orders', express.json({ limit: '256kb' }), async (req, res) => {
  try {
    const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
    const o = req.body?.order;
    if (!o) return res.status(400).json({ error: 'order required' });
    if (!o.id) o.id = `ord_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    if (!o.createdAt) o.createdAt = new Date().toISOString();
    const saved = await dbUpsertOrder(o, shopId);
    res.json({ order: saved });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.patch('/api/orders/:id', express.json({ limit: '256kb' }), async (req, res) => {
  try {
    const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
    const id = String(req.params.id || '');
    if (!id) return res.status(400).json({ error: 'id required' });
    const all = await dbListOrders(shopId);
    const existing = all.find((o) => o?.id === id);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const merged = { ...existing, ...(req.body?.patch || {}), id };
    const saved = await dbUpsertOrder(merged, shopId);
    res.json({ order: saved });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.delete('/api/orders/:id', async (req, res) => {
  try {
    const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
    await dbDeleteOrder(String(req.params.id || ''), shopId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// =====================================================================
// Slip review actions (confirm / reject / re-verify)
// =====================================================================

app.post('/api/slips/:id/confirm', async (req, res) => {
  try {
    const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
    const id = String(req.params.id || '');
    const slip = getSlip(id, shopId);
    if (!slip) return res.status(404).json({ error: 'not_found' });
    const action = await recordSlipAction({
      slipId: id,
      action: 'confirm',
      byUser: req.user?.username || null,
    });
    res.json({ ok: true, action });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/slips/:id/reject', express.json({ limit: '4kb' }), async (req, res) => {
  try {
    const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
    const id = String(req.params.id || '');
    const slip = getSlip(id, shopId);
    if (!slip) return res.status(404).json({ error: 'not_found' });
    const action = await recordSlipAction({
      slipId: id,
      action: 'reject',
      byUser: req.user?.username || null,
    });
    res.json({ ok: true, action });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/slips/reverify-all', async (req, res) => {
  try {
    // Re-verify only the caller's shop slips. Otherwise one shop could
    // burn another shop's EasySlip API quota by triggering a global reverify.
    const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
    const all = listSlips(shopId);
    const targets = all.filter((s) => s?.imageUrl && s?.result?.status !== 'verified');
    const results = [];
    for (const s of targets) {
      try {
        const r = await verifySlipBytes({ imageUrl: s.imageUrl });
        results.push({ id: s.id, status: r.status });
      } catch (e) {
        results.push({ id: s.id, status: 'failed', error: String(e?.message || e) });
      }
    }
    res.json({ ok: true, attempted: results.length, results });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Annotate /api/slips list with last action so the dashboard can mark
// already-confirmed/rejected rows.
app.get('/api/slips/actions', async (req, res) => {
  try {
    const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
    const slips = listSlips(shopId);
    const ids = slips.map((s) => s.id);
    const m = await listSlipActionsBySlipIds(ids);
    const out = {};
    for (const [id, a] of m.entries()) out[id] = a;
    res.json({ actions: out });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// =====================================================================
// Bot / Shop settings (brand voice, payment info, auto-reply toggles)
// =====================================================================

// Legacy global keys — read once on migration, then writes go to the
// per-shop variant. New shops always write to *.shop.<shopId>.
const BOT_SETTINGS_KEY = 'bot.settings.v1';
const BOT_SETTINGS_KEY_PREFIX = 'bot.settings.v1.shop.';
function botSettingsKeyForShop(shopId) {
  return `${BOT_SETTINGS_KEY_PREFIX}${shopId}`;
}

/**
 * Read bot settings for a specific shop. Auto-migrates from the legacy
 * global key on first read for the default shop, so existing deployments
 * upgrade without losing their brand voice / payment info.
 */
async function getBotSettingsForShop(shopId) {
  const sid = shopId || DEFAULT_SHOP_ID;
  const key = botSettingsKeyForShop(sid);
  let v = await kvGet(key, null);
  if (!v && sid === DEFAULT_SHOP_ID) {
    // Migration: copy legacy global once.
    const legacy = await kvGet(BOT_SETTINGS_KEY, null);
    if (legacy && typeof legacy === 'object') {
      await kvSet(key, legacy);
      v = legacy;
    }
  }
  return { ...DEFAULT_BOT_SETTINGS, ...(v || {}) };
}

const DEFAULT_BOT_SETTINGS = {
  brandVoice: '',
  paymentInfo: { kbankAccount: '', promptPay: '' },
  autoGreet: true,
  autoFaq: true,
  autoSlipConfirm: true,
  shopProfile: { shopName: '', tagline: '' },
  // Auto-reply page (Settings → ตอบกลับอัตโนมัติ). Persona shapes the AI
  // tone (see server/ai.js PERSONA_TONE); after-hours messages cover the
  // closed-shop case.
  //
  // Valid personas: 'default' | 'friendly' | 'playful' | 'formal'. The
  // legacy 'professional' value is silently mapped to 'default' on read.
  //
  // Removed in this schema version (still tolerated as extra props on old
  // documents): greetingMessage, greetingEnabled, fallbackMessage,
  // quickReplies. The bot now decides greeting/fallback wording from the
  // persona prompt itself — owners stopped configuring these by hand.
  botPersona: 'default',
  awayMessage: '',
  awayEnabled: false,
  awayStart: '22:00',
  awayEnd: '07:00',
};

/** Strip the legacy fields when loading so we don't keep round-tripping them
 *  back into the DB on every save. */
function stripLegacyBotFields(s) {
  if (!s || typeof s !== 'object') return s;
  const { greetingMessage, greetingEnabled, fallbackMessage, quickReplies, ...rest } = s;
  // Reference the discards so eslint/tsc don't complain about unused vars.
  void greetingMessage; void greetingEnabled; void fallbackMessage; void quickReplies;
  return rest;
}

app.get('/api/bot/settings', async (req, res) => {
  try {
    const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
    const merged = await getBotSettingsForShop(shopId);
    res.json({ settings: stripLegacyBotFields(merged) });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.put('/api/bot/settings', express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
    const incomingRaw = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : {};
    const incoming = stripLegacyBotFields(incomingRaw);
    const current = stripLegacyBotFields(await getBotSettingsForShop(shopId));
    const merged = { ...DEFAULT_BOT_SETTINGS, ...current, ...incoming };
    await kvSet(botSettingsKeyForShop(shopId), merged);
    res.json({ settings: merged });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Keyword auto-reply rules — fast, deterministic FAQ responses.
// Stored as an ordered array; first matching rule wins. Each rule:
//   { id, keywords: string[], reply: string, enabled: boolean }
const KEYWORD_RULES_KEY = 'bot.keywordRules.v1';
const KEYWORD_RULES_KEY_PREFIX = 'bot.keywordRules.v1.shop.';
function keywordRulesKeyForShop(shopId) {
  return `${KEYWORD_RULES_KEY_PREFIX}${shopId}`;
}
async function getKeywordRulesForShop(shopId) {
  const sid = shopId || DEFAULT_SHOP_ID;
  const key = keywordRulesKeyForShop(sid);
  let v = await kvGet(key, null);
  if (v === null && sid === DEFAULT_SHOP_ID) {
    // One-time migration from the legacy global key.
    const legacy = await kvGet(KEYWORD_RULES_KEY, null);
    if (Array.isArray(legacy) && legacy.length > 0) {
      await kvSet(key, legacy);
      v = legacy;
    }
  }
  return Array.isArray(v) ? v : [];
}
const MAX_KEYWORD_RULES = 100;
const MAX_KEYWORDS_PER_RULE = 20;
const MAX_KEYWORD_LEN = 80;
const MAX_REPLY_LEN = 800;

function sanitizeKeywordRules(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw.slice(0, MAX_KEYWORD_RULES)) {
    if (!r || typeof r !== 'object') continue;
    const keywords = Array.isArray(r.keywords)
      ? r.keywords
          .map((k) => String(k || '').trim().slice(0, MAX_KEYWORD_LEN))
          .filter(Boolean)
          .slice(0, MAX_KEYWORDS_PER_RULE)
      : [];
    const reply = String(r.reply || '').trim().slice(0, MAX_REPLY_LEN);
    if (keywords.length === 0 || !reply) continue;
    out.push({
      id: typeof r.id === 'string' && r.id ? r.id : `kr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      keywords,
      reply,
      enabled: r.enabled !== false,
    });
  }
  return out;
}

app.get('/api/bot/keyword-rules', async (req, res) => {
  try {
    const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
    const rules = await getKeywordRulesForShop(shopId);
    res.json({ rules });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.put('/api/bot/keyword-rules', express.json({ limit: '128kb' }), async (req, res) => {
  try {
    const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
    const clean = sanitizeKeywordRules(req.body?.rules);
    await kvSet(keywordRulesKeyForShop(shopId), clean);
    res.json({ rules: clean });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// =====================================================================
// Analytics: real KPIs computed from chat events, slips, and orders.
// =====================================================================

app.get('/api/analytics/summary', async (req, res) => {
  try {
    const shopId = (await activeShopIdFromRequest(req)) || DEFAULT_SHOP_ID;
    const days = Math.max(1, Math.min(180, Number(req.query?.days || 30)));
    const events = await chatEventsByDay(days);
    const slips = listSlips(shopId);
    const orders = await dbListOrders(shopId);
    const today = new Date().toISOString().slice(0, 10);
    const sinceMs = Date.now() - days * 86400_000;

    // Build per-day chat counts.
    const days30 = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400_000);
      days30.push(d.toISOString().slice(0, 10));
    }
    const chatsPerDay = days30.map((day) => {
      const total = events
        .filter((e) => e.day === day)
        .reduce((sum, e) => sum + (e.n || 0), 0);
      return { day, count: total };
    });

    // Channel mix (last `days`).
    const channels = { line: 0, facebook: 0, ig: 0 };
    for (const e of events) {
      if (e.channel === 'line') channels.line += e.n || 0;
      else if (e.channel === 'fb' || e.channel === 'facebook') channels.facebook += e.n || 0;
      else if (e.channel === 'ig') channels.ig += e.n || 0;
    }
    const totalCh = channels.line + channels.facebook + channels.ig || 1;

    // Slip stats.
    const verifiedSlips = slips.filter((s) => s?.result?.status === 'verified');
    const todaySlips = slips.filter((s) => String(s?.receivedAt || '').slice(0, 10) === today);
    const verifiedAmountToday = todaySlips
      .filter((s) => s?.result?.status === 'verified')
      .reduce((sum, s) => sum + (Number(s?.result?.amount) || 0), 0);

    // Order stats (within window).
    const ordersInWindow = orders.filter((o) =>
      o?.createdAt ? new Date(o.createdAt).getTime() >= sinceMs : false,
    );
    const orderRevenue = ordersInWindow
      .filter((o) => o?.status === 'paid' || o?.status === 'shipped')
      .reduce((sum, o) => sum + (Number(o?.amount) || 0), 0);
    const ordersToday = orders.filter((o) =>
      String(o?.createdAt || '').slice(0, 10) === today,
    ).length;

    res.json({
      range: { days, today },
      chatsPerDay,
      channelMix: [
        { channel: 'line', count: channels.line, pct: Math.round((channels.line / totalCh) * 100) },
        { channel: 'facebook', count: channels.facebook, pct: Math.round((channels.facebook / totalCh) * 100) },
        { channel: 'ig', count: channels.ig, pct: Math.round((channels.ig / totalCh) * 100) },
      ],
      kpis: {
        chatsTotal: chatsPerDay.reduce((s, d) => s + d.count, 0),
        slipsVerified: verifiedSlips.length,
        verifiedAmountToday,
        ordersTotal: ordersInWindow.length,
        ordersToday,
        revenue: orderRevenue,
      },
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

const distIndex = path.join(__dirname, '..', 'dist', 'index.html');
if (existsSync(distIndex)) {
  const distDir = path.dirname(distIndex);
  app.use(express.static(distDir, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api')) return next();
    res.sendFile(distIndex, (err) => (err ? next(err) : undefined));
  });
}

app.use((err, req, res, _next) => {
  const p = req.path || '';
  if (p === '/api/line/webhook' || p.endsWith('/api/line/webhook')) {
    lineWebhookDebug = {
      ...lineWebhookDebug,
      lastErrorAt: new Date().toISOString(),
      lastError: String(err?.message || err),
    };
    console.error('[LINE webhook] rejected:', err?.name || '', err?.message || err);
    if (!res.headersSent) {
      const status = err.name === 'SignatureValidationFailed' ? 401 : 400;
      res.status(status).json({ error: String(err?.message || err) });
    }
    return;
  }
  console.error('[express]', req.method, p, err?.message || err);
  if (!res.headersSent) res.status(500).json({ error: 'server error' });
});

process.on('SIGINT', () => {
  void persistChatStateNow().finally(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void persistChatStateNow().finally(() => process.exit(0));
});

app.listen(port, '0.0.0.0', async () => {
  syncFbConfigFromEnv();
  try {
    await initDb();
    await bootstrapAuth();
    await loadPersistedLineConfig();
    console.log(`[db] persistence: ${hasPg ? 'Postgres (DATABASE_URL)' : 'JSON file (set DATABASE_URL for production)'}`);
  } catch (e) {
    console.error('[db] init failed:', e?.message || e);
  }
  const base = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '') || `http://localhost:${port}`;
  console.log(`Backend listening on http://0.0.0.0:${port}`);
  console.log(`Public base URL : ${base}${process.env.PUBLIC_BASE_URL ? '' : '  (set PUBLIC_BASE_URL in .env for production OAuth)'}`);
  console.log(`LINE Webhook URL: ${base}/api/line/webhook`);
  console.log(`FB   Webhook URL: ${base}/api/fb/webhook`);
  console.log(`FB OAuth start  : ${base}/api/fb/oauth/start`);
  console.log(`FB OAuth callback (whitelist this in Meta App): ${base}/api/fb/oauth/callback`);
  console.log(`Loaded .env from: ${path.join(__dirname, '..', '.env')}`);
  console.log(
    '[FB env]',
    `verify=${fbHasVerify ? 1 : 0} pageTok=${fbConfig.fallbackPageAccessToken ? 1 : 0} appId=${fbConfig.appId ? 1 : 0} appSecret=${fbHasAppSecret ? 1 : 0}`,
  );
  if (!hasLineSecret()) console.warn('LINE channel secret not set yet — webhook + inbox sync disabled until paste-and-save in Settings → Connect.');
  if (!hasLineToken()) console.warn('LINE channel access token not set yet — push + profile disabled until paste-and-save in Settings → Connect.');
  // Restored threads from chat-store may have null displayName — kick a
  // backfill pass so names show up before the first UI poll arrives.
  scheduleLineProfileBackfill();
  if (!fbHasPageToken()) console.warn('No connected Page yet — user must click Connect Facebook in Settings.');
  if (!fbHasVerify) console.warn('Missing FB_VERIFY_TOKEN (FB webhook subscription will fail)');
  if (!fbHasAppSecret) console.warn('Missing FB_APP_SECRET (FB webhook signature check disabled — NOT recommended for production)');
  if (!fbConfig.appId) console.warn('Missing FB_APP_ID (Connect Facebook button will be disabled)');
});
