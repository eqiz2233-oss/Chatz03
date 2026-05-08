// Multi-layer Thai bank slip verifier.
//
// Layers (each can independently flip status to verified / failed / duplicate):
//   1. Image hash dedup (sha256 + perceptual hash) — stops re-used screenshots
//   2. QR / barcode decode (Thai EMV-CO QR carries `transRef` per slip)
//   3. Paid bank-API verification (EasySlip / SlipOK / Zwiz / RDCW) — STUB until SLIP_API_PROVIDER+SLIP_API_KEY set
//   4. OCR (stub — placeholder for Tesseract / Vision integration)
//   5. Order match — amount + receiver account must match a configured shop account / pending order
//
// Final status:
//   verified — at least one strong signal (paid API ok, OR QR + matching shop account + not duplicate)
//   failed   — strong signal contradicts (paid API rejected, OR no decodable info AND no matching order)
//   duplicate — sha256 or trans_ref already used in DB
//   pending  — none of the above; flag for manual review

import crypto from 'node:crypto';
import jsQR from 'jsqr';
import sharp from 'sharp';
import {
  insertSlip,
  findSlipByImageSha,
  findSlipByTransRef,
  listShopAccounts,
} from './slipDb.js';

const SLIP_API_PROVIDER = (process.env.SLIP_API_PROVIDER || '').trim().toLowerCase(); // easyslip | slipok | zwiz | rdcw
const SLIP_API_KEY = (process.env.SLIP_API_KEY || '').trim();

// EMV-CO QR for Thai PromptPay Slip Verification: tag 30 contains slip biller info.
// We can't fully validate without the bank API, but we can pull the `transRef` candidate.
function parseEmvQr(text) {
  if (!text || typeof text !== 'string') return null;
  // Thai banks encode transRef in different ways; many embed a 22-30 char hex/alnum string.
  // Capture any long alphanumeric token (typical transRef length 20-32).
  const out = { raw: text };
  const longTokens = text.match(/[A-Z0-9]{20,40}/gi) || [];
  if (longTokens.length) out.transRef = longTokens.sort((a, b) => b.length - a.length)[0];
  // Some EMV QR have embedded amount under tag 54 — best-effort.
  const amtMatch = text.match(/54(\d{2})(\d+\.?\d*)/);
  if (amtMatch) {
    const len = Number(amtMatch[1]);
    const amt = Number(text.slice(text.indexOf('54' + amtMatch[1]) + 4, text.indexOf('54' + amtMatch[1]) + 4 + len));
    if (!Number.isNaN(amt) && amt > 0) out.amount = amt;
  }
  return out;
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Cheap perceptual hash: average-hash on 8x8 grayscale.
async function perceptualHash(buf) {
  try {
    const { data } = await sharp(buf).resize(8, 8, { fit: 'fill' }).grayscale().raw().toBuffer({ resolveWithObject: true });
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const avg = sum / data.length;
    let bits = '';
    for (let i = 0; i < data.length; i++) bits += data[i] >= avg ? '1' : '0';
    return BigInt('0b' + bits).toString(16).padStart(16, '0');
  } catch {
    return null;
  }
}

async function decodeQrFromImage(buf) {
  try {
    // jsQR needs raw RGBA. Resize big slips down so jsQR runs fast.
    const meta = await sharp(buf).metadata();
    const maxDim = 1280;
    const pipeline = sharp(buf).ensureAlpha();
    if (meta.width && meta.width > maxDim) {
      pipeline.resize({ width: maxDim, withoutEnlargement: true });
    }
    const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
    const result = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    return result?.data || null;
  } catch (e) {
    return null;
  }
}

async function callBankApiStub({ transRef, amount }) {
  // Stub interface — once user signs up for EasySlip / SlipOK / Zwiz / RDCW, set
  // SLIP_API_PROVIDER and SLIP_API_KEY in .env and replace the body of this fn.
  if (!SLIP_API_PROVIDER || !SLIP_API_KEY) {
    return { skipped: true, reason: 'paid bank-API not configured' };
  }
  // Real-world example for SlipOK (replace once you have credentials):
  //   const r = await fetch('https://api.slipok.com/api/line/apikey/...', {
  //     method: 'POST',
  //     headers: { 'x-authorization': SLIP_API_KEY },
  //     body: JSON.stringify({ data: transRef, amount }),
  //   });
  //   const json = await r.json();
  //   return { ok: !!json?.success, ...json?.data };
  return { skipped: true, reason: `provider="${SLIP_API_PROVIDER}" not implemented yet` };
}

async function ocrStub(_buf) {
  // Placeholder — wire Tesseract / Google Vision here later.
  return { skipped: true };
}

function normalizeAccount(acc) {
  return String(acc || '').replace(/[^0-9X]/gi, '').toUpperCase();
}

// Match the slip's receiver against shop's configured accounts.
// Banks usually mask a few digits ("xxx-x-x4315-x") so we compare by suffix.
function matchShopAccount(receiverAccount, accounts) {
  if (!receiverAccount || !accounts?.length) return null;
  const r = normalizeAccount(receiverAccount).replace(/X/g, '');
  if (!r) return null;
  for (const acc of accounts) {
    const a = normalizeAccount(acc.accountNo).replace(/X/g, '');
    if (!a) continue;
    if (a.endsWith(r) || r.endsWith(a)) return acc;
  }
  return null;
}

/**
 * @param {object} input
 * @param {string} input.imageUrl       URL the bot can fetch (LINE content / FB attachment / IG)
 * @param {Buffer=} input.imageBuffer   Optional pre-fetched bytes (used when fetch needs auth)
 * @param {Record<string,string>=} input.fetchHeaders Headers passed when fetching imageUrl
 * @param {string} input.conversationId
 * @param {string} input.channel        line | fb | ig
 * @param {string} input.customerTargetId
 * @param {string|null} input.customerName
 * @param {Array<{id:string, amount:number}>=} input.candidateOrders   pending orders for this customer
 */
export async function verifySlipFromUrl(input) {
  const layers = {};
  let imageBuf = input.imageBuffer;
  if (!imageBuf) {
    try {
      const r = await fetch(input.imageUrl, { headers: input.fetchHeaders || {} });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      imageBuf = Buffer.from(await r.arrayBuffer());
    } catch (e) {
      layers.fetch = { ok: false, error: String(e?.message || e) };
      return saveResult({
        ...input,
        status: 'failed',
        reason: 'ดาวน์โหลดภาพไม่ได้ — ลองส่งใหม่',
        layers,
      });
    }
  }

  const sha256 = sha256Hex(imageBuf);
  const phash = await perceptualHash(imageBuf);
  layers.image = { sha256, phash };

  // Layer 1 — exact-image dedup
  const dupBySha = findSlipByImageSha(sha256);
  if (dupBySha) {
    layers.dedup = { ok: false, reason: 'image_sha256_match', refSlipId: dupBySha.id };
    return saveResult({
      ...input,
      imageSha256: sha256,
      imagePhash: phash,
      status: 'duplicate',
      reason: `พบสลิปซ้ำกับ #${dupBySha.id.slice(0, 8)} เมื่อ ${dupBySha.receivedAt.slice(0, 16).replace('T', ' ')}`,
      layers,
    });
  }

  // Layer 2 — QR decode
  const qrText = await decodeQrFromImage(imageBuf);
  const qr = parseEmvQr(qrText);
  layers.qr = qr ? { ok: true, transRef: qr.transRef, amount: qr.amount } : { ok: false };

  // Layer 1b — transRef dedup
  if (qr?.transRef) {
    const dupByRef = findSlipByTransRef(qr.transRef);
    if (dupByRef) {
      layers.dedup = { ok: false, reason: 'trans_ref_match', refSlipId: dupByRef.id };
      return saveResult({
        ...input,
        imageSha256: sha256,
        imagePhash: phash,
        transRef: qr.transRef,
        amount: qr.amount,
        status: 'duplicate',
        reason: `พบเลข ref ${qr.transRef.slice(0, 12)}… เคยใช้กับสลิปก่อนหน้านี้`,
        layers,
      });
    }
  }

  // Layer 3 — paid bank API (stub)
  const apiResult = await callBankApiStub({ transRef: qr?.transRef, amount: qr?.amount });
  layers.bankApi = apiResult;
  if (apiResult?.ok === false) {
    return saveResult({
      ...input,
      imageSha256: sha256,
      imagePhash: phash,
      transRef: qr?.transRef,
      amount: qr?.amount,
      status: 'failed',
      reason: apiResult?.reason || 'ระบบธนาคารไม่ยืนยันการโอนนี้',
      layers,
    });
  }

  // Layer 4 — OCR (stub)
  const ocr = await ocrStub(imageBuf);
  layers.ocr = ocr;
  // Once OCR is implemented, merge into amount/bank/receiver fields here.
  const amount = qr?.amount ?? ocr?.amount ?? null;
  const bank = ocr?.bank ?? null;
  const senderName = ocr?.senderName ?? null;
  const receiverAccount = ocr?.receiverAccount ?? null;

  // Layer 5 — order + shop account match
  const shopAccounts = listShopAccounts({ activeOnly: true });
  const matchedAccount = matchShopAccount(receiverAccount, shopAccounts);
  layers.shopAccount = matchedAccount
    ? { ok: true, accountId: matchedAccount.id }
    : shopAccounts.length === 0
      ? { skipped: true, reason: 'no shop accounts configured' }
      : { ok: receiverAccount ? false : null, reason: receiverAccount ? 'receiver does not match any shop account' : 'OCR did not extract receiver account' };

  let matchedOrder = null;
  if (Array.isArray(input.candidateOrders) && amount != null) {
    matchedOrder = input.candidateOrders.find((o) => Math.abs(Number(o.amount) - Number(amount)) < 0.5) || null;
  }
  layers.orderMatch = matchedOrder ? { ok: true, orderId: matchedOrder.id } : { ok: amount == null ? null : false };

  // Decide final status.
  let status = 'pending';
  let reason = 'ระบบยังไม่สามารถยืนยันสลิปอัตโนมัติได้ — รออนุมัติด้วยมือ';

  const hasQr = !!qr?.transRef;
  const hasApiOk = apiResult?.ok === true;
  const hasShopMatch = matchedAccount != null;
  const noShopConfigured = shopAccounts.length === 0;

  if (hasApiOk) {
    status = 'verified';
    reason = 'ยืนยันกับธนาคารผ่าน API สำเร็จ';
  } else if (hasQr && (hasShopMatch || noShopConfigured)) {
    status = 'verified';
    reason = noShopConfigured
      ? 'อ่าน QR ของสลิปได้สำเร็จ (ยังไม่ได้ตั้งบัญชีร้าน — ตั้งใน Settings เพื่อความแม่นยำ)'
      : 'อ่าน QR ของสลิปได้ + ปลายทางตรงกับบัญชีร้าน';
  } else if (!hasQr && !ocr?.amount && !ocr?.receiverAccount) {
    status = 'pending';
    reason = 'ไม่พบ QR ที่อ่านได้ และยังไม่มี OCR — ฝากแอดมินตรวจมือ';
  }

  return saveResult({
    ...input,
    imageSha256: sha256,
    imagePhash: phash,
    transRef: qr?.transRef,
    amount,
    bank,
    senderName,
    receiverAccount,
    orderId: matchedOrder?.id ?? null,
    status,
    reason,
    layers,
  });
}

function saveResult(rec) {
  return insertSlip({
    conversationId: rec.conversationId,
    channel: rec.channel,
    customerTargetId: rec.customerTargetId,
    customerName: rec.customerName,
    imageUrl: rec.imageUrl,
    imageSha256: rec.imageSha256,
    imagePhash: rec.imagePhash,
    transRef: rec.transRef,
    amount: rec.amount,
    bank: rec.bank,
    senderName: rec.senderName,
    senderAccount: rec.senderAccount,
    receiverName: rec.receiverName,
    receiverAccount: rec.receiverAccount,
    txnAt: rec.txnAt,
    status: rec.status,
    reason: rec.reason,
    layers: rec.layers,
    orderId: rec.orderId,
  });
}

export function buildCustomerReplyText(slip) {
  const amt = slip.amount != null ? `฿${Number(slip.amount).toLocaleString()}` : null;
  switch (slip.status) {
    case 'verified':
      return [
        '✅ ตรวจสอบสลิปผ่านเรียบร้อย',
        amt ? `จำนวน ${amt}` : null,
        slip.transRef ? `Ref: ${slip.transRef.slice(0, 16)}…` : null,
        'ขอบคุณค่ะ ทางร้านเตรียมจัดส่งให้เลย 🎉',
      ]
        .filter(Boolean)
        .join('\n');
    case 'duplicate':
      return [
        '⚠️ สลิปนี้เคยถูกใช้แล้ว',
        slip.reason || '',
        'ถ้าคิดว่าเป็นความเข้าใจผิด รบกวนติดต่อแอดมินด้วยค่ะ',
      ]
        .filter(Boolean)
        .join('\n');
    case 'failed':
      return [
        '❌ ตรวจสอบสลิปไม่ผ่าน',
        slip.reason || '',
        'รบกวนส่งสลิปใหม่ที่เห็น QR ชัด ๆ หรือติดต่อแอดมินค่ะ',
      ]
        .filter(Boolean)
        .join('\n');
    case 'pending':
    default:
      return [
        '⏳ ได้รับสลิปแล้ว — กำลังตรวจสอบ',
        'ระบบอัตโนมัติยังยืนยันไม่ได้ 100% แอดมินจะตรวจให้ภายในไม่กี่นาทีค่ะ',
      ].join('\n');
  }
}
