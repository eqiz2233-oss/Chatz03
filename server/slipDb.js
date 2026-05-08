// SQLite-backed slip + shop-account storage.
//
// Schema:
//   slips
//     - one row per slip image we received
//     - status: pending | verified | failed | duplicate
//     - layers: JSON capturing what each verification layer reported
//   shop_accounts
//     - bank accounts that the shop owns; verifier checks slip's `receiver` matches one
//   slip_messages
//     - records the auto-reply we sent back to the customer (for audit / re-show)

import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'slips.sqlite');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS slips (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    channel TEXT,
    customer_target_id TEXT,
    customer_name TEXT,
    image_url TEXT,
    image_sha256 TEXT,
    image_phash TEXT,
    trans_ref TEXT,
    amount REAL,
    bank TEXT,
    sender_name TEXT,
    sender_account TEXT,
    receiver_name TEXT,
    receiver_account TEXT,
    txn_at TEXT,
    status TEXT NOT NULL,
    reason TEXT,
    layers TEXT,
    order_id TEXT,
    reviewed_by TEXT,
    received_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_slips_received   ON slips(received_at DESC);
  CREATE INDEX IF NOT EXISTS idx_slips_sha256     ON slips(image_sha256);
  CREATE INDEX IF NOT EXISTS idx_slips_transref   ON slips(trans_ref);
  CREATE INDEX IF NOT EXISTS idx_slips_conv       ON slips(conversation_id);

  CREATE TABLE IF NOT EXISTS shop_accounts (
    id TEXT PRIMARY KEY,
    bank TEXT NOT NULL,
    account_no TEXT NOT NULL,
    account_name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
`);

function nowIso() {
  return new Date().toISOString();
}

function rowToSlip(r) {
  if (!r) return null;
  return {
    id: r.id,
    conversationId: r.conversation_id,
    channel: r.channel,
    customerTargetId: r.customer_target_id,
    customerName: r.customer_name,
    imageUrl: r.image_url,
    imageSha256: r.image_sha256,
    imagePhash: r.image_phash,
    transRef: r.trans_ref,
    amount: r.amount == null ? null : Number(r.amount),
    bank: r.bank,
    senderName: r.sender_name,
    senderAccount: r.sender_account,
    receiverName: r.receiver_name,
    receiverAccount: r.receiver_account,
    txnAt: r.txn_at,
    status: r.status,
    reason: r.reason,
    layers: r.layers ? JSON.parse(r.layers) : null,
    orderId: r.order_id,
    reviewedBy: r.reviewed_by,
    receivedAt: r.received_at,
    updatedAt: r.updated_at,
  };
}

const insertSlipStmt = db.prepare(`
  INSERT INTO slips
    (id, conversation_id, channel, customer_target_id, customer_name,
     image_url, image_sha256, image_phash,
     trans_ref, amount, bank, sender_name, sender_account, receiver_name, receiver_account,
     txn_at, status, reason, layers, order_id, reviewed_by, received_at, updated_at)
  VALUES
    (@id, @conversationId, @channel, @customerTargetId, @customerName,
     @imageUrl, @imageSha256, @imagePhash,
     @transRef, @amount, @bank, @senderName, @senderAccount, @receiverName, @receiverAccount,
     @txnAt, @status, @reason, @layers, @orderId, @reviewedBy, @receivedAt, @updatedAt)
`);

const updateSlipStmt = db.prepare(`
  UPDATE slips SET
    status = @status,
    reason = @reason,
    layers = @layers,
    reviewed_by = @reviewedBy,
    updated_at = @updatedAt
  WHERE id = @id
`);

export function insertSlip(s) {
  const row = {
    id: s.id || crypto.randomUUID(),
    conversationId: s.conversationId || null,
    channel: s.channel || null,
    customerTargetId: s.customerTargetId || null,
    customerName: s.customerName || null,
    imageUrl: s.imageUrl || null,
    imageSha256: s.imageSha256 || null,
    imagePhash: s.imagePhash || null,
    transRef: s.transRef || null,
    amount: s.amount == null ? null : Number(s.amount),
    bank: s.bank || null,
    senderName: s.senderName || null,
    senderAccount: s.senderAccount || null,
    receiverName: s.receiverName || null,
    receiverAccount: s.receiverAccount || null,
    txnAt: s.txnAt || null,
    status: s.status || 'pending',
    reason: s.reason || null,
    layers: s.layers ? JSON.stringify(s.layers) : null,
    orderId: s.orderId || null,
    reviewedBy: s.reviewedBy || null,
    receivedAt: s.receivedAt || nowIso(),
    updatedAt: nowIso(),
  };
  insertSlipStmt.run(row);
  return getSlipById(row.id);
}

export function updateSlipStatus(id, { status, reason, layers, reviewedBy }) {
  updateSlipStmt.run({
    id,
    status,
    reason: reason || null,
    layers: layers ? JSON.stringify(layers) : null,
    reviewedBy: reviewedBy || null,
    updatedAt: nowIso(),
  });
  return getSlipById(id);
}

export function getSlipById(id) {
  const r = db.prepare('SELECT * FROM slips WHERE id = ?').get(id);
  return rowToSlip(r);
}

export function listSlips({ limit = 200 } = {}) {
  const rows = db.prepare('SELECT * FROM slips ORDER BY received_at DESC LIMIT ?').all(Number(limit));
  return rows.map(rowToSlip);
}

export function findSlipByImageSha(sha) {
  if (!sha) return null;
  const r = db.prepare('SELECT * FROM slips WHERE image_sha256 = ? ORDER BY received_at ASC LIMIT 1').get(sha);
  return rowToSlip(r);
}

export function findSlipByTransRef(ref) {
  if (!ref) return null;
  const r = db
    .prepare('SELECT * FROM slips WHERE trans_ref = ? AND trans_ref IS NOT NULL ORDER BY received_at ASC LIMIT 1')
    .get(ref);
  return rowToSlip(r);
}

// ─── Shop accounts ────────────────────────────────────────────────────────

function rowToAccount(r) {
  if (!r) return null;
  return {
    id: r.id,
    bank: r.bank,
    accountNo: r.account_no,
    accountName: r.account_name,
    isActive: !!r.is_active,
    createdAt: r.created_at,
  };
}

export function listShopAccounts({ activeOnly = false } = {}) {
  const sql = activeOnly
    ? 'SELECT * FROM shop_accounts WHERE is_active = 1 ORDER BY created_at ASC'
    : 'SELECT * FROM shop_accounts ORDER BY created_at ASC';
  return db.prepare(sql).all().map(rowToAccount);
}

export function createShopAccount({ bank, accountNo, accountName }) {
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO shop_accounts (id, bank, account_no, account_name, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
  ).run(id, String(bank).trim(), String(accountNo).trim(), String(accountName).trim(), nowIso());
  return rowToAccount(db.prepare('SELECT * FROM shop_accounts WHERE id = ?').get(id));
}

export function updateShopAccount(id, { bank, accountNo, accountName, isActive }) {
  const cur = db.prepare('SELECT * FROM shop_accounts WHERE id = ?').get(id);
  if (!cur) return null;
  db.prepare(
    'UPDATE shop_accounts SET bank=?, account_no=?, account_name=?, is_active=? WHERE id=?',
  ).run(
    bank ?? cur.bank,
    accountNo ?? cur.account_no,
    accountName ?? cur.account_name,
    isActive == null ? cur.is_active : isActive ? 1 : 0,
    id,
  );
  return rowToAccount(db.prepare('SELECT * FROM shop_accounts WHERE id = ?').get(id));
}

export function deleteShopAccount(id) {
  return db.prepare('DELETE FROM shop_accounts WHERE id = ?').run(id).changes > 0;
}

export default db;
