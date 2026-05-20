# Chatz — Launch Checklist

A linear walk-through to verify the production deployment before opening
to real shop owners. Each step has a **what to do**, a **what you should
see**, and a **what to do if it fails**.

Print this. Run through it on a fresh browser tab against
`https://chatz03-production.up.railway.app` (or whatever your prod
domain is). Should take **20–30 minutes** end-to-end.

---

## 0 · Pre-flight: Railway env

Open Railway → Variables. Compare against [`.env.example`](.env.example).
For LAUNCH, these are the must-haves:

- [ ] `DATABASE_URL` — Postgres (Railway add-on)
- [ ] `NODE_ENV=production`
- [ ] `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY` — at least one)
- [ ] `RESEND_API_KEY` + `EMAIL_FROM`
- [ ] `FB_APP_ID` (digits only — no `FB_APP_ID=` prefix)
- [ ] `FB_APP_SECRET`
- [ ] `FB_VERIFY_TOKEN` (random string you invent)
- [ ] `LINE_MODULE_CHANNEL_ID` + `LINE_MODULE_CHANNEL_SECRET`
- [ ] `LINE_LOGIN_CHANNEL_ID` + `LINE_LOGIN_CHANNEL_SECRET`
- [ ] `GOOGLE_CLIENT_ID`
- [ ] `EASYSLIP_TOKEN`

**Fix if missing:** add it in Railway, then Redeploy.

---

## 1 · Server boot summary

After your latest deploy, open **Railway → Logs**, scroll to the most
recent boot, and find this block:

```
═══ Chatz boot summary ═══
  ✓ Database                 Postgres (DATABASE_URL)
  ✓ NODE_ENV                 production (Secure cookies on)
  ✓ AI auto-reply            openai · gpt-4o-mini
  ✓ Email (Resend)           from Chatz <noreply@yourdomain.com>
  ✓ Facebook / Instagram     OAuth + webhook ready
  ✓ LINE OA messaging        Module Channel (one-click OAuth ready)
  ✓ LINE Login               sign-in with LINE enabled
  ✓ Google Sign-In           configured
  ✓ EasySlip verification    live verification

  Webhooks:
    LINE → https://<your-domain>/api/line/webhook
    FB   → https://<your-domain>/api/fb/webhook
    OAuth callbacks:
      FB:         https://<your-domain>/api/fb/oauth/callback
      LINE:       https://<your-domain>/api/line/oauth/callback
      LINE Login: https://<your-domain>/api/auth/oauth/line/callback
═══════════════════════════
```

- [ ] **All rows are `✓`.**
  - Any `⚠` or `✗` → fix the named env var, redeploy.

- [ ] **Copy the 5 webhook / callback URLs from this block.** You'll paste
      them into Meta / LINE / Google consoles.

---

## 2 · External console URLs (one-time)

Copy each URL from §1 into the right console:

### Meta for Developers → your app
- [ ] **Settings → Basic → App Domains:** add `<your-domain>`
- [ ] **Webhooks → Page → Callback URL:** the `FB → ...` URL
- [ ] **Webhooks → Page → Verify Token:** same string as `FB_VERIFY_TOKEN`
- [ ] **Facebook Login → Settings → Valid OAuth Redirect URIs:** the
      `FB OAuth callback` URL

### LINE Developers Console → your Module Channel
- [ ] **Callback URL:** the `LINE OAuth callback` URL

### LINE Developers Console → your Login Channel
- [ ] **Callback URL:** the `LINE Login callback` URL
- [ ] **Scopes:** `profile`, `openid` enabled

### Google Cloud Console → OAuth client
- [ ] **Authorized JavaScript origins:** `https://<your-domain>`
- [ ] **Authorized redirect URIs:** (none needed — GSI uses the JS lib)

---

## 3 · Signup flow

Open **incognito** browser → `https://<your-domain>/`

- [ ] Landing page is the login screen with **3 OAuth icons** (Google,
      Facebook, LINE) below the password form.
- [ ] Click **"สร้างบัญชี"** → land on `/register`.
- [ ] Fill the form:
  - Shop: `Test Shop`
  - Username: `testop`
  - Email: **your real email** (you need to receive the verification
    link)
  - Password: `TestPass!123`
- [ ] Click **"สร้างบัญชี"** → land on `/inbox`.

**If the button does nothing or shows "bot_detected":**
The form-age check thinks you're a script. You typed too fast — try
again with a 1–2 second pause between page-load and submit.

---

## 4 · AI provider verification

In the new logged-in session, go to **Settings → การตั้งค่าบอท**.

- [ ] You see the **green banner**:
      `ChatGPT (OpenAI) พร้อมใช้งาน · โมเดล gpt-4o-mini`
      (or `Claude (Anthropic)` if you set the other key)

**If amber "ยังไม่ทำงาน":**
- `OPENAI_API_KEY` is missing or malformed (still has `OPENAI_API_KEY=`
  prefix). Re-check Railway. Redeploy.

**If red "AI ขัดข้อง":**
- Token is invalid or rate-limited. The banner will say which. Fix the
  key, save, the banner should turn green within 60 s (auto-poll).

---

## 5 · Email verification

Settings → **โปรไฟล์** → email field.

- [ ] You see the **amber "ยังไม่ยืนยัน" pill** next to the email label.
- [ ] You see the **"ส่งอีเมลยืนยัน" button** below the email input.
- [ ] Click it → blue "ส่งอีเมลยืนยันแล้ว — ตรวจกล่องจดหมายของคุณ" notice.
- [ ] Check your inbox (and spam) for an email titled
      **"ยืนยันอีเมลของคุณ — Chatz"**.
- [ ] Click the link in the email.
- [ ] You're redirected back to `/settings?verifyEmail=ok` — the badge
      flips to **green "ยืนยันแล้ว ✓"** within a second.

**If no email arrives within 2 min:**
- Check Railway logs for `[email] Resend failure:` lines. Most common
  causes:
  - `EMAIL_FROM` domain isn't verified at resend.com → Resend rejects.
  - `RESEND_API_KEY` is wrong / revoked.

**If link redirects to "ลิงก์ยืนยันหมดอายุ":**
- Token > 24h old, or you clicked an old link. Just hit "ส่งอีเมลยืนยัน"
  again.

---

## 6 · LINE Login (sign-in with LINE)

Open another incognito window → `/login` → click the **green LINE chip**.

- [ ] Browser redirects to `access.line.me`. You're asked to authorize.
- [ ] After authorizing → redirect back lands you on `/inbox`. A brand
      new account was created using your LINE display name.

**If clicking the chip shows toast "LINE Login ยังไม่ได้ตั้งค่า":**
- `LINE_LOGIN_CHANNEL_ID` or `_SECRET` missing in Railway.

**If LINE shows "Invalid app ID" or similar:**
- Callback URL in LINE Developers Console doesn't match exactly. Copy
  again from the boot summary in §1.

---

## 7 · Google Sign-In

Open another incognito window → `/login`. Click the **Google G icon**.

- [ ] Google account picker appears.
- [ ] Pick an account → redirected to `/inbox` as that user.

**If clicking the chip does NOTHING:**
- `GOOGLE_CLIENT_ID` malformed or missing. Re-check Railway.
- OR: your domain isn't in **Authorized JavaScript origins** in Google
  Cloud Console. GSI silently fails to render the popup in this case.

**If you see the "ChatGPT-tinted" collision banner — "มีบัญชีอยู่แล้วด้วย รหัสผ่าน":**
- That's NOT a bug. You signed up with that email + password in §3,
  and now Google is offering to sign in with the same email. The pro-
  pattern correctly refuses to auto-merge. Sign in with the password
  instead, then link Google from Settings → Linked accounts (read-only
  for now; full link UI is on the roadmap).

---

## 8 · Connect LINE OA

Logged in as your first user, go to **Settings → การเชื่อมต่อ → LINE**.

- [ ] You see the **green "เชื่อมต่อด้วย LINE"** button.
- [ ] Click it → popup to LINE Manager → pick the OA you own.
- [ ] Popup closes → after ~3 s the LINE card shows **"เชื่อมแล้ว ·
      <OA display name>"**.

**If button says "การเชื่อมต่ออัตโนมัติยังไม่พร้อม":**
- Module Channel env not set. Boot summary in §1 would say
  `paste-token mode` or `disabled`.

---

## 9 · Connect Facebook + IG

Settings → **การเชื่อมต่อ → Facebook**.

- [ ] Click **"เชื่อมต่อ"** → Facebook OAuth popup → pick your test
      page → close.
- [ ] FB card shows **"เชื่อมแล้ว · <Page name>"**.
- [ ] If that Page has an Instagram Business account linked, the IG
      card auto-flips to "เชื่อมแล้ว" too.

**If popup lands on FB's "Invalid App ID" wrench page:**
- `FB_APP_ID` has the `FB_APP_ID=` prefix mistake. The newer code
  detects this and redirects you back to Settings with a yellow banner
  — fix the Railway value, redeploy.

**If FB returns "App not active":**
- Your app is still in **Development Mode**. Non-admin users (and
  Pages they don't own) can't OAuth until App Review is approved.
  This is the biggest external blocker for a public launch.

---

## 10 · Send a real test message

From your phone (a different LINE account), send "ราคาเท่าไหร่คะ" to
your connected OA.

- [ ] Within 2 s the message appears in the Chatz inbox.
- [ ] Within 5–10 s the bot replies (ChatGPT pulls in your product
      catalog).
- [ ] On your phone you receive the bot's reply on LINE.

**If the inbox shows the message but the bot stays silent:**
- Check Settings → AI status. If green and "ตอบไปแล้ว N ครั้ง" counter
  bumps, the bot answered — but the LINE push failed. Look in Railway
  logs for `[ai] reply failed` or `LINE push failed`.
- If counter is at 0, the AI was never called. Open the conversation
  in the inbox — is the bot toggle ON? (The little 🤖 toggle).

**If you wait 30 s and the conversation never shows the bot reply on
LINE:**
- The bot might be off for that conversation. Toggle it on.

---

## 11 · Slip verification

Get any payment slip image (or use a screenshot from your own bank app)
and send it to the OA.

- [ ] Slip appears in the inbox with a verification card showing amount,
      bank, and ref.
- [ ] If the slip is recognized, the bot replies with a thank-you (using
      ChatGPT to phrase it according to the persona) and asks for
      shipping info.
- [ ] **Settings → การตั้งค่าบอท → AI status** counter is now +1.

**If a non-slip image (selfie, product photo) was sent and got verified:**
- That's a bug — file an issue.

**If a real slip wasn't verified:**
- Check `EASYSLIP_TOKEN` in Railway. Boot summary §1 should show
  `EasySlip verification: live verification`.

---

## 12 · Seed 10 test users (optional)

If you want a populated demo deployment:

```bash
BASE_URL=https://<your-domain> node scripts/seed-test-users.mjs
```

- [ ] Output ends with `Done. 10/10 succeeded.`
- [ ] Any `signup-failed` rows? Most likely the form-age check rejected
      them because the script paced too aggressively. Set
      `PAUSE_MS=18000` and retry.

---

## 13 · Production safety spot-checks

- [ ] Open browser devtools → Application → Cookies. The `chatz_sid`
      cookie should be:
        ✓ HttpOnly
        ✓ Secure          ← only if NODE_ENV=production
        ✓ SameSite=Lax
- [ ] Try `https://<your-domain>/api/auth/me` in an incognito tab (no
      session). Expect HTTP 200 with `{user: null, ...}`.
- [ ] Try `https://<your-domain>/api/products` in incognito. Expect
      HTTP 401 (not the products list).
- [ ] Open the Network tab during a normal session. Look for any
      requests with status ≥ 400. There shouldn't be any except expected
      ones (404 for an avatar, 401 on initial /api/auth/me before
      login, etc.).
- [ ] Open Network tab → headers on any `POST` from your browser. Look
      at the `Set-Cookie` response on `/api/auth/login` or signup.
      It should include `Secure` in production.

---

## 14 · Open issues to know about

These are documented in the audit and *not blockers* for a single-shop
or small beta, but worth knowing:

- **Multi-shop bugs (#1, #2, #9 from earlier audit)** — affect a SaaS
  hosting 2+ unrelated shops on the same Railway deploy. Single-shop
  use is unaffected.
- **No CAPTCHA on signup** — honeypot + form-age check stop dumb bots;
  determined bots need Cloudflare Turnstile (env var slot exists,
  follow-up work).
- **2FA, active-sessions list** — shown as "Coming soon" chips in
  Settings.
- **Linked-accounts UI is read-only** — once a user is signed in with
  one method, they can't yet add a second from Settings (only on the
  initial signup). The badge accurately shows what they have.

---

## ✅ When all 13 sections pass

You're cleared to open beta to real shop owners. Pace it:

1. **First 24 h:** invite 1–2 friendly shops by direct DM. Watch Railway
   logs for anything red. Iterate.
2. **Week 1:** 5–10 shops. Confirm Resend isn't getting rate-limited,
   OpenAI cost stays sane (gpt-4o-mini at ~$0.15 per 1M input tokens
   means even busy shops cost cents per day).
3. **Week 2+:** public.

Good luck. 🚀
