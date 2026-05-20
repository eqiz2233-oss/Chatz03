#!/usr/bin/env node
// Seed 10 realistic Thai-shop test users into a running Chatz deployment.
//
// Usage:
//
//   # against local dev
//   node scripts/seed-test-users.mjs
//
//   # against production
//   BASE_URL=https://chatz03-production.up.railway.app node scripts/seed-test-users.mjs
//
//   # custom shape
//   BASE_URL=...  USER_COUNT=20  PASSWORD=mypass  node scripts/seed-test-users.mjs
//
// What it does, per user (sequentially — we don't want to trip the 5/min
// signup rate-limit by hammering in parallel):
//   1. POST /api/auth/signup        → creates the account, gets a session
//      cookie + auto-logs-in
//   2. POST /api/products           ×3, with realistic Thai-shop product
//      data and a generated picsum thumbnail URL
//   3. GET  /api/auth/me            → sanity-check that the session works
//
// Output: a clean table of (username, email, password, products created,
// status) you can copy/paste to share with QA testers.
//
// What this does NOT do:
//   • verify email (Settings flow, not at signup)
//   • connect LINE/FB/IG channels (requires the human OAuth dance)
//   • upload real images (uses picsum.photos URLs)
//
// If signups get 429-rate-limited it's because the auth-signup bucket is
// 5/min/IP. The script paces itself with PAUSE_MS=14000 by default so 10
// users land cleanly. Bump that if your test deploy uses a tighter limit.

const BASE_URL = (process.env.BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
const USER_COUNT = Math.max(1, Math.min(100, Number(process.env.USER_COUNT) || 10));
const PASSWORD = process.env.PASSWORD || 'TestPass!123';
const PAUSE_MS = Number(process.env.PAUSE_MS) || 14_000;
const TAG = process.env.SEED_TAG || `t${Date.now().toString(36).slice(-5)}`;

const SHOPS = [
  { name: 'Mint Closet',       category: 'เสื้อผ้าผู้หญิง',  emoji: '👗' },
  { name: 'Banpu Bakery',      category: 'เบเกอรี่',          emoji: '🍞' },
  { name: 'Soi Sneaker',       category: 'รองเท้าผ้าใบ',      emoji: '👟' },
  { name: 'Lampang Crafts',    category: 'ของฝาก งานคราฟต์', emoji: '🪴' },
  { name: 'Phuket Cosmetics',  category: 'เครื่องสำอาง',      emoji: '💄' },
  { name: 'Korat Pet Shop',    category: 'สัตว์เลี้ยง',        emoji: '🐶' },
  { name: 'Nimman Coffee',     category: 'กาแฟ',              emoji: '☕' },
  { name: 'Trang Tea House',   category: 'ชา',                emoji: '🍵' },
  { name: 'Chiang Rai Plants', category: 'ต้นไม้',            emoji: '🌱' },
  { name: 'Issan Honey Farm',  category: 'น้ำผึ้ง',           emoji: '🍯' },
];

const PRODUCTS_BY_CATEGORY = {
  'เสื้อผ้าผู้หญิง': [
    { name: 'เดรสยาว Linen',       price: 690,  desc: 'ผ้าลินิน 100% ใส่สบาย ระบายอากาศดี' },
    { name: 'เสื้อเชิ้ต Cotton Oversize', price: 450, desc: 'ผ้าฝ้ายฟอกนุ่ม ใส่สบาย ทุกโอกาส' },
    { name: 'กระโปรง Pleated',     price: 590,  desc: 'ทรงพลีท ใส่ทำงานหรือเที่ยวก็ได้' },
  ],
  'เบเกอรี่': [
    { name: 'ครัวซองต์ Butter',    price: 65,   desc: 'อบสดทุกเช้า เนยแท้ฝรั่งเศส' },
    { name: 'Banana Cake',         price: 180,  desc: 'กล้วยน้ำว้าหวานหอม' },
    { name: 'Sourdough Loaf',      price: 220,  desc: 'หมัก 24 ชม. กรอบนอกนุ่มใน' },
  ],
  'รองเท้าผ้าใบ': [
    { name: 'Everyday Canvas',     price: 890,  desc: 'รองเท้าผ้าใบเดินทุกวัน น้ำหนักเบา' },
    { name: 'Court Classic',       price: 1190, desc: 'ทรง court สไตล์เรียบ' },
    { name: 'Trail Running',       price: 1490, desc: 'พื้น grip ดี สำหรับวิ่งเทรล' },
  ],
  'ของฝาก งานคราฟต์': [
    { name: 'กระเป๋าผ้า handmade', price: 350,  desc: 'ทอมือจากอำเภอแม่จัน' },
    { name: 'เซรามิคใส่ของ',       price: 480,  desc: 'ปั้นมือทุกใบ' },
    { name: 'สบู่กลิ่นมะลิ',       price: 120,  desc: 'สบู่ธรรมชาติ ไม่ผสมสารเคมี' },
  ],
  'เครื่องสำอาง': [
    { name: 'Sunscreen SPF50',     price: 390,  desc: 'กันแดดผิวบางใส ไม่เหนียว' },
    { name: 'Lip Tint #07 Rose',   price: 250,  desc: 'ติดทนทั้งวัน' },
    { name: 'Vitamin C Serum',     price: 690,  desc: 'ผิวกระจ่างใส ใช้ทุกวัน' },
  ],
  'สัตว์เลี้ยง': [
    { name: 'อาหารแมว Premium 1kg', price: 380, desc: 'โปรตีนสูง เหมาะกับแมวทุกวัย' },
    { name: 'ของเล่นเชือกขัดฟัน',  price: 150,  desc: 'สำหรับสุนัขเล็ก-กลาง' },
    { name: 'ปลอกคอ Adjustable',   price: 220,  desc: 'หนัง PU ทนทาน' },
  ],
  'กาแฟ': [
    { name: 'Arabica Doi Chang',   price: 280,  desc: 'เมล็ดคั่วกลาง คั่วใหม่ทุกสัปดาห์' },
    { name: 'Cold Brew Concentrate', price: 220, desc: 'สกัดเย็น 24 ชม. ทำได้ทันที' },
    { name: 'V60 Drip Bag',        price: 120,  desc: 'แพ็ค 10 ซอง พกพาสะดวก' },
  ],
  'ชา': [
    { name: 'ชาดอกไม้ฤดูใบไม้ผลิ', price: 290,  desc: 'ดอกไม้ 6 ชนิด หอมละมุน' },
    { name: 'Earl Grey Premium',   price: 350,  desc: 'ใบชาซีลอนแท้ ผสมเปลือกส้ม' },
    { name: 'ชาเขียวมัทฉะ',        price: 480,  desc: 'มัทฉะ Uji คุณภาพพิธี' },
  ],
  'ต้นไม้': [
    { name: 'มอนสเตอร่า S',        price: 350,  desc: 'ใบสวย เลี้ยงง่าย ในร่มได้' },
    { name: 'ฟิโลเดนดรอน',         price: 290,  desc: 'ฟอกอากาศ ใบมัน' },
    { name: 'กระบองเพชรมินิ',      price: 80,   desc: 'แพ็ค 3 ต้น พกพาสะดวก' },
  ],
  'น้ำผึ้ง': [
    { name: 'น้ำผึ้งดอกลำไย 500ml', price: 380, desc: 'น้ำผึ้งดอกลำไย เก็บจากเชียงราย' },
    { name: 'น้ำผึ้งดอกป่า 250ml',  price: 220, desc: 'รสเข้ม กลิ่นป่า' },
    { name: 'รวงผึ้งสด 100g',       price: 290, desc: 'ทานได้ทั้งรวง' },
  ],
};

// ─── HTTP helpers ──────────────────────────────────────────────────────────

/**
 * Minimal cookie jar — just enough to carry the chatz_sid cookie across
 * the signup → product creation chain. Reset between users.
 */
function makeJar() {
  let cookie = '';
  return {
    set(headerOrHeaders) {
      const list = Array.isArray(headerOrHeaders) ? headerOrHeaders : (headerOrHeaders ? [headerOrHeaders] : []);
      for (const h of list) {
        const [head] = String(h).split(';');
        if (head) cookie = head; // last write wins; we only ever care about the session
      }
    },
    header() { return cookie || null; },
  };
}

async function call(jar, method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const c = jar.header();
  if (c) headers.Cookie = c;
  const res = await fetch(BASE_URL + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  // Node 18+ exposes res.headers.getSetCookie(); older runtimes use .raw().
  const set = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.raw?.()['set-cookie'] || []);
  jar.set(set);
  let data = null;
  try { data = await res.json(); } catch { /* non-json */ }
  return { status: res.status, ok: res.ok, data };
}

// ─── Per-user flow ─────────────────────────────────────────────────────────

async function seedOneUser(shop, idx) {
  const jar = makeJar();
  const username = `${shop.name.toLowerCase().replace(/[^a-z]+/g, '')}.${TAG}.${idx}`;
  const email = `${username}@example.test`;
  const displayName = shop.name;

  // 1. Signup. The form-age check rejects submits < 800ms after the form
  //    renders; we don't render a form here, so we set formAgeMs to a
  //    plausible 12s and skip the honeypot (empty string).
  const signup = await call(jar, 'POST', '/api/auth/signup', {
    username,
    password: PASSWORD,
    displayName,
    email,
    botCheck: { companyWebsite: '', formAgeMs: 12_000 },
  });
  if (!signup.ok) {
    return { username, email, status: `signup-failed:${signup.status}:${signup.data?.error || ''}` };
  }

  // 2. Add 3 sample products. The server endpoint expects {product:{...}}.
  const seeds = PRODUCTS_BY_CATEGORY[shop.category] || [];
  let products = 0;
  for (let i = 0; i < seeds.length; i++) {
    const p = seeds[i];
    const productId = `seed-${TAG}-${idx}-${i}`;
    const r = await call(jar, 'POST', '/api/products', {
      product: {
        id: productId,
        name: p.name,
        price: p.price,
        imageEmoji: shop.emoji,
        imageUrl: `https://picsum.photos/seed/${productId}/400/400`,
        description: p.desc,
        sellingPoints: '',
        stock: 30,
        optionGroups: [],
        aiReady: true,
      },
    });
    if (r.ok) products += 1;
  }

  // 3. Sanity check — session works, /me returns the user.
  const me = await call(jar, 'GET', '/api/auth/me', null);
  const sessionOk = me.ok && me.data?.user?.username === username.toLowerCase();

  return {
    username,
    email,
    status: sessionOk ? `ok (+${products} products)` : 'session-broken',
  };
}

// ─── Driver ───────────────────────────────────────────────────────────────

function fmtRow(cols, widths) {
  return cols.map((c, i) => String(c).padEnd(widths[i])).join('  ');
}

async function main() {
  console.log('Seeding %d users against %s', USER_COUNT, BASE_URL);
  console.log('TAG: %s  PASSWORD: %s', TAG, PASSWORD);
  console.log('');
  const widths = [38, 42, 28];
  console.log(fmtRow(['username', 'email', 'status'], widths));
  console.log('-'.repeat(widths.reduce((a, b) => a + b + 2, 0)));

  const results = [];
  for (let i = 0; i < USER_COUNT; i++) {
    const shop = SHOPS[i % SHOPS.length];
    let row;
    try {
      row = await seedOneUser(shop, i + 1);
    } catch (e) {
      row = { username: '(error)', email: '', status: String(e?.message || e).slice(0, 40) };
    }
    results.push(row);
    console.log(fmtRow([row.username, row.email, row.status], widths));
    // Pace the signups so we don't trip the 5/min rate limit.
    if (i < USER_COUNT - 1) await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  console.log('');
  const ok = results.filter((r) => r.status.startsWith('ok')).length;
  console.log('Done. %d/%d succeeded.', ok, results.length);
  if (ok < results.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('Seed script crashed:', e);
  process.exit(1);
});
