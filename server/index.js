import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
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
import { verifySlipFromUrl, buildCustomerReplyText } from './slipVerifier.js';
import {
  listSlips,
  getSlipById,
  updateSlipStatus,
  listShopAccounts,
  createShopAccount,
  updateShopAccount,
  deleteShopAccount,
} from './slipDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const port = Number(process.env.PORT || process.env.BACKEND_PORT || 8787);

const savedIntegrations = loadIntegrationsSync();

const lineConfig = {
  channelSecret: (process.env.LINE_CHANNEL_SECRET || '').trim(),
  channelAccessToken: (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim(),
};

const hasSecret = Boolean(lineConfig.channelSecret);
const hasToken = Boolean(lineConfig.channelAccessToken);

// App-level FB config (shared across all connected Pages).
const fbConfig = {
  appSecret: (process.env.FB_APP_SECRET || '').trim(),
  verifyToken: (process.env.FB_VERIFY_TOKEN || '').trim(),
  apiVersion: (process.env.FB_GRAPH_VERSION || 'v21.0').trim(),
  appId: (process.env.FB_APP_ID || '').trim(),
  // Optional fallback Page token from .env (used if no Pages were OAuth-connected yet —
  // mostly for initial dev setup; the OAuth flow is the recommended path).
  fallbackPageAccessToken: (process.env.FB_PAGE_ACCESS_TOKEN || '').trim(),
};

const fbHasVerify = Boolean(fbConfig.verifyToken);
const fbHasAppSecret = Boolean(fbConfig.appSecret);
const fbOauthAvailable = Boolean(fbConfig.appId && fbConfig.appSecret);

// `fbConfigured` now means "webhook is set up at app level" — i.e. verify token present.
// `fbHasAnyPage` means at least one Page is connected and ready to send/receive.
let fbHasAnyPage = listPages().length > 0 || Boolean(fbConfig.fallbackPageAccessToken);
let fbConfigured = fbHasVerify;

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

function getOrCreateFbThread(targetId, channel = 'fb') {
  const key = `${channel}:${targetId}`;
  if (!fbThreads.has(key)) {
    fbThreads.set(key, {
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
  return fbThreads.get(key);
}

async function enrichFbProfile(psid, thread, pageId) {
  const tok = pageId ? tokenForPageId(String(pageId)) : primaryPageAccessToken();
  if (!tok) return;
  try {
    const url = `https://graph.facebook.com/${fbConfig.apiVersion}/${encodeURIComponent(psid)}?fields=name,profile_pic&access_token=${encodeURIComponent(tok)}`;
    const r = await fetch(url);
    const d = await r.json();
    if (d?.error) {
      console.warn('FB getProfile error:', d.error?.message || d.error);
      return;
    }
    if (d?.name) thread.displayName = d.name;
    if (d?.profile_pic) thread.pictureUrl = d.profile_pic;
    thread.updatedAt = new Date().toISOString();
  } catch (e) {
    console.warn('FB getProfile failed:', e?.message || e);
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
  for (const att of msg?.attachments || []) {
    const u = att?.payload?.url;
    if (typeof u === 'string' && /^https?:\/\//i.test(u)) {
      const t = String(att.type || '').toLowerCase();
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
  return { textOut, imageUrl, videoUrl };
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
  const fallback = isIg
    ? `IG • ${String(thread.targetId).slice(-8)}`
    : `FB • ${String(thread.targetId).slice(-8)}`;
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

function pushEvent(item) {
  eventsBuffer.unshift(item);
  if (eventsBuffer.length > MAX_EVENTS) eventsBuffer.length = MAX_EVENTS;
}

const lineClient = hasToken
  ? new line.messagingApi.MessagingApiClient({ channelAccessToken: lineConfig.channelAccessToken })
  : null;

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

function getOrCreateThread(kind, targetId) {
  const key = `${kind}:${targetId}`;
  if (!lineThreads.has(key)) {
    lineThreads.set(key, {
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

async function enrichUserProfile(userId, thread) {
  if (!lineClient) return;
  try {
    const p = await lineClient.getProfile(userId);
    thread.displayName = p.displayName;
    thread.pictureUrl = p.pictureUrl;
    thread.updatedAt = new Date().toISOString();
  } catch (e) {
    console.warn('LINE getProfile failed:', e?.message || e);
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

// ─────────────────────────────────────────────────────────────────────────────
// Slip verification — kicked off whenever a customer sends an image attachment.
// The verifier writes a row to SQLite, attaches the result onto the chat message
// (so the SlipCard renders in the inbox), and pushes a status reply back to the
// same channel the slip arrived on.
// ─────────────────────────────────────────────────────────────────────────────

const slipReplyState = new Map(); // conversationId -> last reply timestamp; cheap throttle

function shouldSendSlipReply(conversationId) {
  const last = slipReplyState.get(conversationId) || 0;
  if (Date.now() - last < 1500) return false; // collapse double-fires
  slipReplyState.set(conversationId, Date.now());
  return true;
}

async function downloadLineContent(messageId) {
  if (!hasToken || !messageId) return null;
  const url = `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`;
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${lineConfig.channelAccessToken}` },
    });
    if (!r.ok) {
      console.warn('[LINE content] download failed:', r.status);
      return null;
    }
    return Buffer.from(await r.arrayBuffer());
  } catch (e) {
    console.warn('[LINE content] error:', e?.message || e);
    return null;
  }
}

/**
 * Run slip verification for a single inbound image, then auto-reply.
 *
 * @param {object} args
 * @param {{ messages: any[] }} args.thread     The mutable in-memory thread row
 * @param {{ id: string }} args.msgRow          The message we just appended
 * @param {string} args.conversationId          API id (line:user:..., fb:user:..., ig:user:...)
 * @param {string} args.channel                 line | fb | ig
 * @param {string} args.customerTargetId
 * @param {string|null} args.customerName
 * @param {string|null=} args.imageUrl          HTTP URL we can fetch directly
 * @param {Buffer|null=} args.imageBuffer       Pre-fetched bytes (LINE-internal media)
 */
async function runSlipCheck(args) {
  const { thread, msgRow, conversationId, channel, customerTargetId, customerName, imageUrl, imageBuffer } = args;
  try {
    const slip = await verifySlipFromUrl({
      imageUrl: imageUrl || null,
      imageBuffer: imageBuffer || null,
      conversationId,
      channel,
      customerTargetId,
      customerName,
    });

    // Attach the result onto the customer's message so the chat renders the SlipCard.
    const target = thread.messages.find((m) => m.id === msgRow.id);
    if (target) {
      target.meta = { ...(target.meta || {}), slip: slipToUiResult(slip) };
      thread.updatedAt = new Date().toISOString();
    }

    // Auto-reply on the same channel.
    if (shouldSendSlipReply(conversationId)) {
      const text = buildCustomerReplyText(slip);
      try {
        if (channel === 'line') {
          await sendLineMessage({ conversationId, text, asAi: true });
        } else if (channel === 'fb' || channel === 'ig') {
          await sendMetaMessage({ conversationId, text, asAi: true });
        }
      } catch (e) {
        console.warn('[slip reply] send failed:', e?.message || e);
      }
    }
  } catch (e) {
    console.error('[slip verify] error:', e?.message || e);
  }
}

function slipToUiResult(slip) {
  if (!slip) return null;
  return {
    id: slip.id,
    status: slip.status,
    amount: slip.amount,
    bank: slip.bank || (slip.layers?.qr?.transRef ? 'QR' : '?'),
    ref: slip.transRef || (slip.imageSha256 ? slip.imageSha256.slice(0, 12) : '?'),
    date: slip.txnAt || slip.receivedAt,
    reason: slip.reason || undefined,
  };
}

app.use(cors());

app.get('/api/health', (_req, res) => {
  const lineConversationsCount = Array.from(lineThreads.values()).filter((t) => t.messages.length > 0).length;
  const fbConversationsCount = Array.from(fbThreads.values()).filter((t) => t.messages.length > 0).length;
  res.json({
    ok: true,
    lineConfigured: hasSecret,
    lineReplyEnabled: hasToken,
    eventsBuffered: eventsBuffer.length,
    lineThreads: lineThreads.size,
    lineConversationsCount,
    lineWebhook: lineWebhookDebug,
    fbConfigured,
    fbReplyEnabled: fbHasPageToken(),
    fbAppSecretSet: fbHasAppSecret,
    fbOauthAvailable,
    fbConnectedPage: (() => {
      const p = primaryFbPageForApi();
      return p ? { id: p.id, name: p.name, category: p.category, picture: p.picture } : null;
    })(),
    fbThreads: fbThreads.size,
    fbConversationsCount,
    fbWebhook: fbWebhookDebug,
    envPath: path.join(__dirname, '..', '.env'),
  });
});

app.get('/api/line/events', (_req, res) => {
  res.json({ events: eventsBuffer });
});

app.get('/api/line/conversations', (_req, res) => {
  const arr = Array.from(lineThreads.values())
    .filter((t) => t.messages.length > 0)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .map(threadToApiConversation);
  res.json({ conversations: arr, count: arr.length });
});

app.post('/api/line/send', express.json({ limit: '50kb' }), async (req, res) => {
  if (!lineClient) {
    return res.status(503).json({ error: 'LINE_CHANNEL_ACCESS_TOKEN is missing (push disabled)' });
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
    await lineClient.pushMessage({
      to: targetId,
      messages: [{ type: 'text', text: body }],
    });
    const thread = getOrCreateThread(kind, targetId);
    const now = new Date().toISOString();
    thread.messages.push({
      id: crypto.randomUUID(),
      receivedAt: now,
      sender,
      text: body,
    });
    thread.updatedAt = now;
    return res.json({ ok: true });
  } catch (e) {
    console.error('LINE pushMessage failed:', e?.message || e);
    return res.status(502).json({ error: String(e?.message || e) });
  }
});

app.post(
  '/api/line/webhook',
  hasSecret ? line.middleware({ channelSecret: lineConfig.channelSecret }) : (_req, _res, next) => next(),
  async (req, res) => {
    if (!hasSecret) {
      return res.status(500).json({ error: 'LINE_CHANNEL_SECRET is missing' });
    }

    const events = req.body?.events || [];
    console.log('[LINE webhook]', new Date().toISOString(), 'events=', events.length, events.map((e) => e.type).join(',') || '(none)');

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
          const thread = getOrCreateThread(src.kind, src.targetId);
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

            // Image attachment in a 1:1 LINE chat → run slip check.
            if (event.message.type === 'image' && src.kind === 'user') {
              const conversationId = `line:${src.kind}:${src.targetId}`;
              const lineMsgId = event.message.id;
              void (async () => {
                let imageBuffer = null;
                let imageUrl = media.image || null;
                if (lineMsgId && hasToken) {
                  imageBuffer = await downloadLineContent(lineMsgId);
                }
                if (!imageBuffer && !imageUrl) return;
                await runSlipCheck({
                  thread,
                  msgRow: row,
                  conversationId,
                  channel: 'line',
                  customerTargetId: src.targetId,
                  customerName: thread.displayName || null,
                  imageUrl,
                  imageBuffer,
                });
              })();
            }
          }
          if (src.kind === 'user' && lineClient) {
            void enrichUserProfile(src.targetId, thread);
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
// Facebook Messenger
// =====================================================================

app.get('/api/fb/conversations', (_req, res) => {
  const arr = Array.from(fbThreads.values())
    .filter((t) => t.messages.length > 0)
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
  express.raw({ type: '*/*', limit: '1mb' }),
  async (req, res) => {
    if (!fbConfigured) {
      return res.status(500).json({ error: 'FB_PAGE_ACCESS_TOKEN or FB_VERIFY_TOKEN missing' });
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
      console.warn('[FB webhook] FB_APP_SECRET not set — skipping signature check (NOT recommended)');
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
          const thread = getOrCreateFbThread(psid, isInstagram ? 'ig' : 'fb');
          let textOut = null;
          let imageUrl = null;
          let videoUrl = null;
          if (ev?.message) {
            const parsed = metaMessagingMediaFromEvent(ev);
            textOut = parsed.textOut;
            imageUrl = parsed.imageUrl;
            videoUrl = parsed.videoUrl;
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
            thread.messages.push(row);
            thread.updatedAt = new Date().toISOString();

            // Image attachment from the customer → kick off slip check.
            if (imageUrl) {
              const channel = isInstagram ? 'ig' : 'fb';
              const conversationId = `${channel}:user:${psid}`;
              void runSlipCheck({
                thread,
                msgRow: row,
                conversationId,
                channel,
                customerTargetId: psid,
                customerName: thread.displayName || null,
                imageUrl,
                imageBuffer: null,
              });
            }
          }

          // FB Page DMs use Graph user-profile lookup; IG profile lookup needs a different
          // endpoint (skip enrichment for IG for now — name will fall back to "IG • <id-tail>").
          if (!thread.displayName && !isInstagram) {
            void enrichFbProfile(psid, thread, entry.id);
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

async function sendLineMessage({ conversationId, text, asAi }) {
  if (!lineClient) {
    return { status: 503, error: 'LINE_CHANNEL_ACCESS_TOKEN is missing (push disabled)' };
  }
  const body = typeof text === 'string' ? text.trim() : '';
  if (!conversationId || !body) return { status: 400, error: 'conversationId and text are required' };
  const m = /^line:(user|group|room):(.+)$/.exec(String(conversationId));
  if (!m) return { status: 400, error: 'invalid conversationId (expected line:user|group|room:<id>)' };
  const kind = m[1];
  const targetId = m[2];
  const sender = asAi ? 'ai' : 'agent';
  try {
    await lineClient.pushMessage({ to: targetId, messages: [{ type: 'text', text: body }] });
    const thread = getOrCreateThread(kind, targetId);
    const now = new Date().toISOString();
    thread.messages.push({ id: crypto.randomUUID(), receivedAt: now, sender, text: body });
    thread.updatedAt = now;
    return { status: 200, ok: true };
  } catch (e) {
    console.error('LINE pushMessage failed:', e?.message || e);
    return { status: 502, error: String(e?.message || e) };
  }
}

async function sendMetaMessage({ conversationId, text, asAi }) {
  if (!fbHasPageToken()) {
    return { status: 503, error: 'No connected Page. Connect Facebook in Settings → Integrations.' };
  }
  const pageToken = primaryPageAccessToken();
  const body = typeof text === 'string' ? text.trim() : '';
  if (!conversationId || !body) return { status: 400, error: 'conversationId and text are required' };
  const m = /^(fb|ig):user:(.+)$/.exec(String(conversationId));
  if (!m) return { status: 400, error: 'invalid conversationId (expected fb:user:<PSID> or ig:user:<IGSID>)' };
  const channel = m[1];
  const targetId = m[2];
  const sender = asAi ? 'ai' : 'agent';
  try {
    const url = `https://graph.facebook.com/${fbConfig.apiVersion}/me/messages?access_token=${encodeURIComponent(pageToken)}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: targetId }, messaging_type: 'RESPONSE', message: { text: body } }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data?.error) {
      const msg = data?.error?.message || `HTTP ${r.status}`;
      console.error(`${channel.toUpperCase()} send failed:`, msg);
      return { status: 502, error: msg };
    }
    const thread = getOrCreateFbThread(targetId, channel);
    const now = new Date().toISOString();
    thread.messages.push({ id: data?.message_id || crypto.randomUUID(), receivedAt: now, sender, text: body });
    thread.updatedAt = now;
    return { status: 200, ok: true };
  } catch (e) {
    console.error('FB/IG send exception:', e?.message || e);
    return { status: 502, error: String(e?.message || e) };
  }
}

app.post('/api/messages/send', express.json({ limit: '50kb' }), async (req, res) => {
  const { conversationId } = req.body || {};
  const id = String(conversationId || '');
  let result;
  if (id.startsWith('line:')) result = await sendLineMessage(req.body || {});
  else if (id.startsWith('fb:') || id.startsWith('ig:')) result = await sendMetaMessage(req.body || {});
  else result = { status: 400, error: 'unknown conversationId prefix (expected line:/fb:/ig:)' };
  if (result.status >= 400) return res.status(result.status).json({ error: result.error });
  return res.json({ ok: true });
});

app.post('/api/fb/send', express.json({ limit: '50kb' }), async (req, res) => {
  const result = await sendMetaMessage(req.body || {});
  if (result.status >= 400) return res.status(result.status).json({ error: result.error });
  return res.json({ ok: true });
});

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

app.get('/api/fb/integration/status', (_req, res) => {
  const page = primaryFbPageForApi();
  res.json({
    connected: fbHasPageToken() && Boolean(page),
    page,
    oauthAvailable: fbOauthAvailable,
    appId: fbConfig.appId || null,
    needsAppSecret: !fbHasAppSecret,
    needsVerifyToken: !fbHasVerify,
    apiVersion: fbConfig.apiVersion,
  });
});

app.get('/api/fb/oauth/start', (req, res) => {
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

app.post('/api/fb/integration/connect', express.json({ limit: '20kb' }), async (req, res) => {
  const { id, name, category, picture, access_token, instagram } = req.body || {};
  if (!id || !access_token) {
    return res.status(400).json({ error: 'id and access_token are required' });
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
    });
    refreshFbState();
    return res.json({ ok: true, page: primaryFbPageForApi() });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/privacy', (_req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html><html><head><meta charset="utf-8"><title>Chatz Privacy Policy</title>
<style>body{font:15px/1.6 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#0f172a}h1{font-size:24px}h2{font-size:17px;margin-top:28px}code{background:#f1f5f9;padding:1px 6px;border-radius:4px}</style></head><body>
<h1>Chatz — Privacy Policy</h1>
<p><b>Effective date:</b> ${new Date().toISOString().slice(0, 10)}</p>
<h2>What we collect</h2>
<p>When you connect Facebook Pages or Instagram Business accounts to Chatz, we receive: your Page id/name/picture, the linked Instagram username/id, the messages your customers send to you, and the access tokens needed to reply. We do not collect your personal Facebook profile beyond your name and id used to authenticate.</p>
<h2>How we use it</h2>
<p>Solely to display your inbox and let you reply. We do not sell or share your data with third parties.</p>
<h2>Storage</h2>
<p>Tokens and messages are stored on the server you deploy. Disconnecting from <i>Settings → Integrations</i> deletes the stored token immediately.</p>
<h2>Data deletion</h2>
<p>To request deletion, disconnect from Settings, or send a request to the data-deletion endpoint at <code>/api/fb/data-deletion</code> (configured in your Meta App Settings → Data Deletion Callback URL).</p>
<h2>Contact</h2>
<p>support@chatz.local</p>
</body></html>`);
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

// ─────────────────────────────────────────────────────────────────────────────
// Slip + shop-account REST API
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/slips', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const slips = listSlips({ limit });
  res.json({ slips, count: slips.length });
});

app.get('/api/slips/:id', (req, res) => {
  const s = getSlipById(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  res.json({ slip: s });
});

app.post('/api/slips/:id/confirm', express.json({ limit: '20kb' }), async (req, res) => {
  const s = getSlipById(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  const reviewedBy = String(req.body?.reviewedBy || 'agent');
  const updated = updateSlipStatus(s.id, {
    status: 'verified',
    reason: 'อนุมัติด้วยตนเองโดยแอดมิน',
    layers: { ...(s.layers || {}), manual: { ok: true, by: reviewedBy } },
    reviewedBy,
  });
  // Notify the customer on the original channel.
  try {
    if (s.conversationId?.startsWith('line:')) {
      await sendLineMessage({
        conversationId: s.conversationId,
        text: buildCustomerReplyText(updated),
        asAi: true,
      });
    } else if (s.conversationId?.startsWith('fb:') || s.conversationId?.startsWith('ig:')) {
      await sendMetaMessage({
        conversationId: s.conversationId,
        text: buildCustomerReplyText(updated),
        asAi: true,
      });
    }
  } catch (e) {
    console.warn('manual confirm reply failed:', e?.message || e);
  }
  res.json({ slip: updated });
});

app.post('/api/slips/:id/reject', express.json({ limit: '20kb' }), async (req, res) => {
  const s = getSlipById(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  const reviewedBy = String(req.body?.reviewedBy || 'agent');
  const reason = String(req.body?.reason || 'ไม่ผ่านการตรวจสอบโดยแอดมิน');
  const updated = updateSlipStatus(s.id, {
    status: 'failed',
    reason,
    layers: { ...(s.layers || {}), manual: { ok: false, by: reviewedBy, reason } },
    reviewedBy,
  });
  try {
    if (s.conversationId?.startsWith('line:')) {
      await sendLineMessage({
        conversationId: s.conversationId,
        text: buildCustomerReplyText(updated),
        asAi: true,
      });
    } else if (s.conversationId?.startsWith('fb:') || s.conversationId?.startsWith('ig:')) {
      await sendMetaMessage({
        conversationId: s.conversationId,
        text: buildCustomerReplyText(updated),
        asAi: true,
      });
    }
  } catch (e) {
    console.warn('manual reject reply failed:', e?.message || e);
  }
  res.json({ slip: updated });
});

app.get('/api/shop-accounts', (_req, res) => {
  res.json({ accounts: listShopAccounts() });
});

app.post('/api/shop-accounts', express.json({ limit: '5kb' }), (req, res) => {
  const { bank, accountNo, accountName } = req.body || {};
  if (!bank || !accountNo || !accountName) {
    return res.status(400).json({ error: 'bank, accountNo, accountName required' });
  }
  const acc = createShopAccount({ bank, accountNo, accountName });
  res.status(201).json({ account: acc });
});

app.patch('/api/shop-accounts/:id', express.json({ limit: '5kb' }), (req, res) => {
  const acc = updateShopAccount(req.params.id, req.body || {});
  if (!acc) return res.status(404).json({ error: 'not found' });
  res.json({ account: acc });
});

app.delete('/api/shop-accounts/:id', (req, res) => {
  const ok = deleteShopAccount(req.params.id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
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

app.listen(port, '0.0.0.0', () => {
  const base = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '') || `http://localhost:${port}`;
  console.log(`Backend listening on http://0.0.0.0:${port}`);
  console.log(`Public base URL : ${base}${process.env.PUBLIC_BASE_URL ? '' : '  (set PUBLIC_BASE_URL in .env for production OAuth)'}`);
  console.log(`LINE Webhook URL: ${base}/api/line/webhook`);
  console.log(`FB   Webhook URL: ${base}/api/fb/webhook`);
  console.log(`FB OAuth start  : ${base}/api/fb/oauth/start`);
  console.log(`FB OAuth callback (whitelist this in Meta App): ${base}/api/fb/oauth/callback`);
  console.log(`Loaded .env from: ${path.join(__dirname, '..', '.env')}`);
  if (!hasSecret) console.warn('Missing LINE_CHANNEL_SECRET (LINE webhook + inbox sync disabled)');
  if (!hasToken) console.warn('Missing LINE_CHANNEL_ACCESS_TOKEN (LINE push + profile disabled)');
  if (!fbHasPageToken()) console.warn('No connected Page yet — user must click Connect Facebook in Settings.');
  if (!fbHasVerify) console.warn('Missing FB_VERIFY_TOKEN (FB webhook subscription will fail)');
  if (!fbHasAppSecret) console.warn('Missing FB_APP_SECRET (FB webhook signature check disabled — NOT recommended for production)');
  if (!fbConfig.appId) console.warn('Missing FB_APP_ID (Connect Facebook button will be disabled)');
});
