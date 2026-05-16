// Pluggable email sender.
//
// Real provider: Resend (resend.com). Set RESEND_API_KEY + EMAIL_FROM in env
// to enable. We use Resend because it's the cleanest indie/SaaS option
// (Sendgrid + Mailgun work the same way; if needed, branch on a different
// env var and add their REST calls — the interface here doesn't change).
//
// Fallback when no key is set: log the message to the server console.
// This keeps the rest of the codebase honest — every "send" call still
// works, even on a fresh local dev install — without forcing every dev
// to wire up an email provider before they can sign up. Production
// deployments without a key just won't deliver mail; the warning is
// loud enough that an operator will notice.

const RESEND_API_KEY = (process.env.RESEND_API_KEY || '').trim();
const EMAIL_FROM = (process.env.EMAIL_FROM || 'Chatz <onboarding@resend.dev>').trim();

export function isEmailEnabled() {
  return Boolean(RESEND_API_KEY);
}

/**
 * Send an email. Resolves with { ok, id } on success, { ok: false, error }
 * on failure. Never throws — the auth flows can degrade silently if the
 * provider is having an outage and we don't want a 500 leaking provider
 * details to the user.
 */
export async function sendEmail({ to, subject, html, text }) {
  if (!to || !subject || !(html || text)) {
    return { ok: false, error: 'missing_fields' };
  }
  if (!RESEND_API_KEY) {
    // Dev fallback: dump to logs so operator can manually relay.
    console.log('\n──── [email:dev] ────');
    console.log(`To:      ${to}`);
    console.log(`From:    ${EMAIL_FROM}`);
    console.log(`Subject: ${subject}`);
    if (text) console.log(`\n${text}\n`);
    else if (html) console.log(`\n${html.replace(/<[^>]+>/g, '')}\n`);
    console.log('───────────────────────\n');
    return { ok: true, id: 'dev-log', dev: true };
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: Array.isArray(to) ? to : [to],
        subject,
        html: html || undefined,
        text: text || undefined,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.warn('[email] Resend failure:', r.status, data?.message || data);
      return { ok: false, error: data?.message || `HTTP ${r.status}` };
    }
    return { ok: true, id: data?.id || null };
  } catch (e) {
    console.warn('[email] Resend exception:', e?.message || e);
    return { ok: false, error: String(e?.message || e) };
  }
}

/** Render a password-reset email body. Plain text + minimal HTML — works
 *  in every client and doesn't trigger spam filters. */
export function passwordResetEmail({ name, resetUrl }) {
  const display = name || 'there';
  const text = `Hi ${display},

We received a request to reset the password on your Chatz account.

Open this link to choose a new password (valid for 1 hour):
${resetUrl}

If you didn't request this, you can ignore this email — your account stays as it is.

— Chatz
`;
  const html = `<!doctype html><html><body style="font:15px/1.6 -apple-system,system-ui,sans-serif;color:#0f172a;max-width:520px;margin:0 auto;padding:24px">
<p>Hi ${escHtml(display)},</p>
<p>We received a request to reset the password on your Chatz account.</p>
<p style="margin:24px 0">
  <a href="${escHtml(resetUrl)}" style="background:#7c3aed;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Set a new password</a>
</p>
<p style="color:#64748b;font-size:13px">Or paste this link into your browser: <br><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:12px">${escHtml(resetUrl)}</code></p>
<p style="color:#64748b;font-size:13px">The link is valid for <b>1 hour</b>.</p>
<hr style="border:0;border-top:1px solid #e2e8f0;margin:24px 0">
<p style="color:#94a3b8;font-size:12px">If you didn't request this, you can safely ignore this email — your account stays as it is.</p>
<p style="color:#94a3b8;font-size:12px">— Chatz</p>
</body></html>`;
  return { text, html };
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}
