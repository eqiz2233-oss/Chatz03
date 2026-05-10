// Slip verification + storage.
//
// Real verification uses the EasySlip API v2 (https://api.easyslip.com/v2)
// when EASYSLIP_TOKEN is set. Without a token we fall back to a deterministic
// mock derived from the image bytes — useful for local dev and demos so the
// UI is never empty.
//
// Records are kept in-memory (same as the rest of the inbox state). They are
// keyed by transaction ref so duplicate slips show up as `duplicate` instead of
// being verified twice.

import crypto from 'node:crypto';

// v2 (recommended) — base64 in JSON body. v1 fallback used if EASYSLIP_API_VERSION=v1.
const EASYSLIP_V2_ENDPOINT = 'https://api.easyslip.com/v2/verify/bank';
const EASYSLIP_V1_ENDPOINT = 'https://developer.easyslip.com/api/v1/verify';
const MAX_SLIPS = 500;

const easyslipToken = (process.env.EASYSLIP_TOKEN || '').trim();
const easyslipVersion = ((process.env.EASYSLIP_API_VERSION || 'v2').trim().toLowerCase() === 'v1') ? 'v1' : 'v2';

/** @type {Map<string, SlipRecord>} id -> record */
const slipsById = new Map();
/** @type {Map<string, string>} transRef -> first slip id (for dedupe) */
const refToFirstId = new Map();

/**
 * @typedef {Object} SlipResult
 * @property {'pending'|'verified'|'failed'|'duplicate'} status
 * @property {number} [amount]
 * @property {string} [bank]
 * @property {string} [ref]
 * @property {string} [date]
 * @property {string} [reason]
 * @property {string} [senderName]
 * @property {string} [receiverName]
 *
 * @typedef {Object} SlipRecord
 * @property {string} id
 * @property {string} channel       'line' | 'fb' | 'ig'
 * @property {string} conversationId UI conversation id (e.g. line:user:Uxxx)
 * @property {string} messageId      The chat message this slip was attached to
 * @property {string} customerName
 * @property {string} customerAvatar
 * @property {string|null} imageUrl
 * @property {string} receivedAt    ISO
 * @property {SlipResult} result
 */

function trimAmount(v) {
  if (typeof v === 'number' && isFinite(v)) return Math.round(v * 100) / 100;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9.]/g, ''));
    return isFinite(n) ? n : undefined;
  }
  return undefined;
}

function formatDate(iso) {
  if (!iso) return undefined;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return undefined;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return undefined;
  }
}

function bankShortName(bank) {
  if (!bank) return undefined;
  if (typeof bank === 'string') return bank.toUpperCase().slice(0, 8);
  // EasySlip returns { id, name, short } shaped objects
  if (bank.short) return String(bank.short).toUpperCase();
  if (bank.name) return String(bank.name).slice(0, 8).toUpperCase();
  return undefined;
}

/**
 * Pull the localized name out of either a v1 plain-string `name` or a v2
 * `{ th, en }` object — preferring Thai when available.
 */
function nameFrom(account) {
  const n = account?.name;
  if (!n) return undefined;
  if (typeof n === 'string') return n;
  if (typeof n === 'object') return n.th || n.en || undefined;
  return undefined;
}

/**
 * Map an EasySlip success payload to our internal SlipResult shape.
 * Handles BOTH v1 ({status: 200, data: {...}}) and
 * v2 ({success: true, data: {rawSlip: {...}}}) response shapes.
 */
function fromEasySlip(payload) {
  // v2 wraps the slip under data.rawSlip; v1 puts it directly under data.
  const d = payload?.data?.rawSlip || payload?.data || {};
  return {
    status: 'verified',
    amount: trimAmount(d?.amount?.amount ?? d?.amount),
    bank: bankShortName(d?.sender?.bank ?? d?.receiver?.bank),
    ref: d?.transRef || d?.ref1 || undefined,
    date: formatDate(d?.date),
    senderName: nameFrom(d?.sender?.account),
    receiverName: nameFrom(d?.receiver?.account),
  };
}

/**
 * Best-effort mock when no token is set.  Produces a stable result for the same
 * image so the UI is consistent across reloads.
 */
function mockResult(imageHash) {
  const seed = parseInt(imageHash.slice(0, 8), 16);
  const banks = ['KBANK', 'SCB', 'KTB', 'BBL', 'BAY', 'TTB'];
  const bank = banks[seed % banks.length];
  const amount = 50 + (seed % 4950);
  const ref = imageHash.slice(0, 14).toUpperCase();
  return {
    status: 'verified',
    mock: true,
    amount,
    bank,
    ref,
    date: formatDate(new Date().toISOString()),
    senderName: 'นายลูกค้า ทดสอบ',
    receiverName: 'ร้านค้า ทดสอบ',
  };
}

/** Heuristic: looks like a Thai bank slip image worth verifying. */
function looksSlipLikely({ mime, byteLength }) {
  if (mime && !/^image\//i.test(mime)) return false;
  // Most Thai slips are between ~30 KB and ~3 MB. Reject obvious non-slips.
  if (byteLength != null && (byteLength < 5_000 || byteLength > 6_000_000)) return false;
  return true;
}

async function downloadImage(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return { buf, mime: r.headers.get('content-type') || 'image/jpeg' };
}

/**
 * Verify a slip by either a public URL or an explicit Buffer (LINE images need
 * the channel token to be downloaded server-side).
 *
 * @param {{ imageUrl?: string|null, buffer?: Buffer|null, mime?: string|null }} opts
 * @returns {Promise<SlipResult>}
 */
export async function verifySlipBytes(opts) {
  let buf = opts?.buffer || null;
  let mime = opts?.mime || null;
  if (!buf && opts?.imageUrl) {
    try {
      const dl = await downloadImage(opts.imageUrl);
      buf = dl.buf;
      mime = mime || dl.mime;
    } catch (e) {
      return { status: 'failed', reason: `Cannot download image: ${e?.message || e}` };
    }
  }
  if (!buf || !buf.length) {
    return { status: 'failed', reason: 'No image bytes' };
  }
  if (!looksSlipLikely({ mime, byteLength: buf.length })) {
    return { status: 'failed', reason: 'Image does not look like a transfer slip' };
  }

  const hash = crypto.createHash('sha256').update(buf).digest('hex');

  if (!easyslipToken) {
    // Local/dev fallback: deterministic verified result so the dashboard works.
    return mockResult(hash);
  }

  // v2 uses multipart 'file' field; v1 used base64 in JSON body.
  // We default to v2 because it has better error handling and richer responses.
  try {
    if (easyslipVersion === 'v2') {
      const form = new FormData();
      form.append(
        'file',
        new Blob([buf], { type: mime || 'image/jpeg' }),
        'slip.jpg',
      );
      const r = await fetch(EASYSLIP_V2_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${easyslipToken}` },
        body: form,
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data?.success && data?.data) {
        return fromEasySlip(data);
      }
      const msg = data?.error?.message || data?.message || `HTTP ${r.status}`;
      const code = data?.error?.code ? ` [${data.error.code}]` : '';
      return { status: 'failed', reason: `EasySlip${code}: ${msg}` };
    }

    // v1 legacy
    const r = await fetch(EASYSLIP_V1_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${easyslipToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image: buf.toString('base64') }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && (data?.status === 200 || data?.status === undefined) && data?.data) {
      return fromEasySlip(data);
    }
    const msg = data?.message || data?.error || `HTTP ${r.status}`;
    return { status: 'failed', reason: `EasySlip: ${msg}` };
  } catch (e) {
    return { status: 'failed', reason: `EasySlip error: ${e?.message || e}` };
  }
}

/**
 * Apply duplicate detection against previously seen refs and persist the slip.
 * Returns the (possibly mutated) result that should be attached to the chat.
 *
 * @param {SlipResult} verified
 * @param {Object} ctx
 * @param {string} ctx.channel
 * @param {string} ctx.conversationId
 * @param {string} ctx.messageId
 * @param {string} ctx.customerName
 * @param {string} ctx.customerAvatar
 * @param {string|null} ctx.imageUrl
 */
export function recordSlip(verified, ctx) {
  let result = { ...verified };
  if (result.status === 'verified' && result.ref) {
    const firstId = refToFirstId.get(result.ref);
    if (firstId && firstId !== ctx.messageId) {
      const original = slipsById.get(firstId);
      result = {
        ...result,
        status: 'duplicate',
        reason: original
          ? `พบสลิปเดียวกันส่งโดย ${original.customerName} (${original.receivedAt.slice(0, 10)})`
          : 'พบสลิปเดียวกันก่อนหน้านี้',
      };
    } else {
      refToFirstId.set(result.ref, ctx.messageId);
    }
  }

  const record = {
    id: ctx.messageId,
    channel: ctx.channel,
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
    customerName: ctx.customerName,
    customerAvatar: ctx.customerAvatar,
    imageUrl: ctx.imageUrl ?? null,
    receivedAt: new Date().toISOString(),
    result,
  };
  slipsById.set(record.id, record);

  // Cap memory.
  if (slipsById.size > MAX_SLIPS) {
    const oldest = Array.from(slipsById.keys())[0];
    if (oldest) slipsById.delete(oldest);
  }
  return result;
}

export function getSlip(id) {
  return slipsById.get(id) || null;
}

export function listSlips() {
  return Array.from(slipsById.values()).sort(
    (a, b) => new Date(b.receivedAt) - new Date(a.receivedAt),
  );
}

export function slipStats() {
  const all = listSlips();
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = all.filter((s) => s.receivedAt.slice(0, 10) === today).length;
  return {
    total: all.length,
    today: todayCount,
    verified: all.filter((s) => s.result.status === 'verified').length,
    pending: all.filter((s) => s.result.status === 'pending').length,
    flagged: all.filter((s) => s.result.status === 'failed' || s.result.status === 'duplicate').length,
    enabled: Boolean(easyslipToken),
  };
}

export function isEasySlipEnabled() {
  return Boolean(easyslipToken);
}
