import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import * as line from '@line/bot-sdk';
import { loadIntegrationsSync, setFbIntegration, clearFbIntegration } from './integrations.js';

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

const fbConfig = {
  // Page token may come from .env OR from OAuth-stored integrations.json (OAuth wins).
  pageAccessToken:
    (savedIntegrations?.fb?.pageAccessToken || process.env.FB_PAGE_ACCESS_TOKEN || '').trim(),
  appSecret: (process.env.FB_APP_SECRET || '').trim(),
  verifyToken: (process.env.FB_VERIFY_TOKEN || '').trim(),
  apiVersion: (process.env.FB_GRAPH_VERSION || 'v21.0').trim(),
  appId: (process.env.FB_APP_ID || '').trim(),
};

// Connected page metadata (id/name/picture) from OAuth — null if .env-only or not connected.
let fbConnectedPage = savedIntegrations?.fb?.page || null;

// These flags get re-evaluated whenever fbConfig.pageAccessToken changes (via setFbConnection).
let fbHasToken = Boolean(fbConfig.pageAccessToken);
let fbHasVerify = Boolean(fbConfig.verifyToken);
let fbHasAppSecret = Boolean(fbConfig.appSecret);
let fbConfigured = fbHasToken && fbHasVerify;
const fbOauthAvailable = Boolean(fbConfig.appId && fbConfig.appSecret);

async function setFbConnection({ pageAccessToken, page }) {
  fbConfig.pageAccessToken = (pageAccessToken || '').trim();
  fbConnectedPage = page || null;
  fbHasToken = Boolean(fbConfig.pageAccessToken);
  fbConfigured = fbHasToken && fbHasVerify;
  await setFbIntegration({ pageAccessToken: fbConfig.pageAccessToken, page: fbConnectedPage });
}

async function disconnectFb() {
  fbConfig.pageAccessToken = '';
  fbConnectedPage = null;
  fbHasToken = false;
  fbConfigured = false;
  await clearFbIntegration();
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

async function enrichFbProfile(psid, thread) {
  if (!fbHasToken) return;
  try {
    const url = `https://graph.facebook.com/${fbConfig.apiVersion}/${encodeURIComponent(psid)}?fields=name,profile_pic&access_token=${encodeURIComponent(fbConfig.pageAccessToken)}`;
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
    lastSnippet: last?.text ? String(last.text).slice(0, 120) : '',
    updatedAt: thread.updatedAt,
    unread: 0,
    online: false,
    messages: thread.messages.map((m) => ({
      id: m.id,
      sender: m.sender,
      text: m.text,
      image: m.image,
      receivedAt: m.receivedAt,
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
    })),
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
    fbReplyEnabled: fbHasToken,
    fbAppSecretSet: fbHasAppSecret,
    fbOauthAvailable,
    fbConnectedPage: fbConnectedPage
      ? { id: fbConnectedPage.id, name: fbConnectedPage.name, category: fbConnectedPage.category, picture: fbConnectedPage.picture }
      : null,
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

// Webhook verification (FB calls this once when you set the URL)
app.get('/api/fb/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token && token === fbConfig.verifyToken) {
    console.log('[FB webhook] verified');
    return res.status(200).send(String(challenge ?? ''));
  }
  console.warn('[FB webhook] verify failed: token mismatch or missing');
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
          if (ev?.message?.text) {
            textOut = ev.message.text;
          } else if (Array.isArray(ev?.message?.attachments) && ev.message.attachments.length > 0) {
            const a = ev.message.attachments[0];
            textOut = a?.type === 'image' ? '[image]' : a?.type === 'video' ? '[video]' : a?.type === 'audio' ? '[audio]' : a?.type === 'file' ? '[file]' : `[${a?.type || 'attachment'}]`;
          } else if (ev?.postback?.title) {
            textOut = `[postback] ${ev.postback.title}`;
          }
          if (textOut) {
            thread.messages.push({
              id: ev?.message?.mid || crypto.randomUUID(),
              receivedAt: new Date().toISOString(),
              sender: 'customer',
              text: textOut,
            });
            thread.updatedAt = new Date().toISOString();
          }

          // FB Page DMs use Graph user-profile lookup; IG profile lookup needs a different
          // endpoint (skip enrichment for IG for now — name will fall back to "IG • <id-tail>").
          if (!thread.displayName && !isInstagram) {
            void enrichFbProfile(psid, thread);
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

app.post('/api/fb/send', express.json({ limit: '50kb' }), async (req, res) => {
  if (!fbHasToken) {
    return res.status(503).json({ error: 'No connected Page. Connect Facebook in Settings → Integrations.' });
  }
  const { conversationId, text, asAi } = req.body || {};
  const body = typeof text === 'string' ? text.trim() : '';
  if (!conversationId || !body) {
    return res.status(400).json({ error: 'conversationId and text are required' });
  }
  // Accept both fb:user:<PSID> and ig:user:<IGSID>. The Page Access Token works for both
  // because the connected IG Business account is linked to the same Page.
  const m = /^(fb|ig):user:(.+)$/.exec(String(conversationId));
  if (!m) {
    return res.status(400).json({ error: 'invalid conversationId (expected fb:user:<PSID> or ig:user:<IGSID>)' });
  }
  const channel = m[1]; // 'fb' | 'ig'
  const targetId = m[2];
  const sender = asAi ? 'ai' : 'agent';
  try {
    const url = `https://graph.facebook.com/${fbConfig.apiVersion}/me/messages?access_token=${encodeURIComponent(fbConfig.pageAccessToken)}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: targetId },
        messaging_type: 'RESPONSE',
        message: { text: body },
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data?.error) {
      const msg = data?.error?.message || `HTTP ${r.status}`;
      console.error(`${channel.toUpperCase()} send failed:`, msg);
      return res.status(502).json({ error: msg });
    }
    const thread = getOrCreateFbThread(targetId, channel);
    const now = new Date().toISOString();
    thread.messages.push({
      id: data?.message_id || crypto.randomUUID(),
      receivedAt: now,
      sender,
      text: body,
    });
    thread.updatedAt = now;
    return res.json({ ok: true });
  } catch (e) {
    console.error('FB/IG send exception:', e?.message || e);
    return res.status(502).json({ error: String(e?.message || e) });
  }
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
  res.json({
    connected: fbHasToken && Boolean(fbConnectedPage),
    page: fbConnectedPage,
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
    await setFbConnection({
      pageAccessToken: access_token,
      page: {
        id,
        name,
        category,
        picture,
        instagram: instagram
          ? { id: instagram.id, username: instagram.username, name: instagram.name, picture: instagram.picture }
          : null,
        connectedAt: new Date().toISOString(),
      },
    });
    return res.json({ ok: true, page: fbConnectedPage });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/fb/integration/disconnect', async (_req, res) => {
  try {
    await disconnectFb();
    res.json({ ok: true });
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

app.listen(port, () => {
  const base = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '') || `http://localhost:${port}`;
  console.log(`Backend listening on http://localhost:${port}`);
  console.log(`Public base URL : ${base}${process.env.PUBLIC_BASE_URL ? '' : '  (set PUBLIC_BASE_URL in .env for production OAuth)'}`);
  console.log(`LINE Webhook URL: ${base}/api/line/webhook`);
  console.log(`FB   Webhook URL: ${base}/api/fb/webhook`);
  console.log(`FB OAuth start  : ${base}/api/fb/oauth/start`);
  console.log(`FB OAuth callback (whitelist this in Meta App): ${base}/api/fb/oauth/callback`);
  console.log(`Loaded .env from: ${path.join(__dirname, '..', '.env')}`);
  if (!hasSecret) console.warn('Missing LINE_CHANNEL_SECRET (LINE webhook + inbox sync disabled)');
  if (!hasToken) console.warn('Missing LINE_CHANNEL_ACCESS_TOKEN (LINE push + profile disabled)');
  if (!fbHasToken) console.warn('No connected Page yet — user must click Connect Facebook in Settings.');
  if (!fbHasVerify) console.warn('Missing FB_VERIFY_TOKEN (FB webhook subscription will fail)');
  if (!fbHasAppSecret) console.warn('Missing FB_APP_SECRET (FB webhook signature check disabled — NOT recommended for production)');
  if (!fbConfig.appId) console.warn('Missing FB_APP_ID (Connect Facebook button will be disabled)');
});
