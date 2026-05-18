import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { AuthShell } from '../auth/AuthShell';
import {
  AuthError,
  OauthRow,
  PasswordInput,
  authInputClass,
  authSubmitClass,
  mapSigninError,
  useOauth,
} from '../auth/shared';

/**
 * Signin screen — the default unauthenticated landing.
 *
 * Three sub-modes live here because they all share the same form-on-left,
 * illustration-on-right shell:
 *   • signin (default)
 *   • forgot — request a reset link
 *   • reset  — set a new password (triggered by ?reset=<token> in the URL)
 *
 * Registration lives in RegisterView at /register. Linking between the
 * two pages uses real <a href> + history.pushState via the AuthShell's
 * route-aware nav, so the URL bar always reflects what's on screen.
 */

type Mode = 'signin' | 'forgot' | 'reset';

interface ResetPreview {
  user: { username: string; displayName: string | null; email: string | null };
  expiresAt: string;
}

export function LoginView() {
  const { login } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Forgot/reset state — only used when the user enters those flows.
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [resetPreview, setResetPreview] = useState<ResetPreview | null>(null);
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetDone, setResetDone] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { oauth, googleBtnRef, handleFacebook } = useOauth(setErr, setBusy);

  // Detect ?reset=<token> from the password-reset email and switch to
  // reset mode + prefetch a preview of which account the token belongs to.
  useEffect(() => {
    const url = new URL(window.location.href);
    const tok = url.searchParams.get('reset');
    if (!tok) return;
    setResetToken(tok);
    setMode('reset');
    void (async () => {
      try {
        const r = await fetch(`/api/auth/reset-password/${encodeURIComponent(tok)}`);
        if (!r.ok) {
          setErr('ลิงก์รีเซ็ตหมดอายุหรือไม่ถูกต้อง — ลองส่งคำขอใหม่');
          return;
        }
        const j = (await r.json()) as { preview: ResetPreview };
        setResetPreview(j.preview);
      } catch {
        setErr('โหลดข้อมูลรีเซ็ตไม่สำเร็จ');
      }
    })();
  }, []);

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setErr(null);
    setNotice(null);
    setPassword('');
    setForgotSent(false);
  };

  async function onSubmitSignin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const result = await login(username.trim(), password);
    setBusy(false);
    if (!result.ok) setErr(mapSigninError(result.error));
  }

  async function onSubmitForgot(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: forgotIdentifier.trim() }),
      });
      setForgotSent(true);
    } catch {
      setErr('ส่งคำขอไม่สำเร็จ ลองอีกครั้ง');
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitReset(e: React.FormEvent) {
    e.preventDefault();
    if (!resetToken) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/auth/reset-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, newPassword: resetNewPassword }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        const code = (j as { error?: string }).error;
        setErr(
          code === 'password_too_short' ? 'รหัสผ่านต้องอย่างน้อย 6 ตัว'
          : code === 'invalid_or_expired' ? 'ลิงก์รีเซ็ตหมดอายุ — ลองส่งคำขอใหม่'
          : 'รีเซ็ตรหัสผ่านไม่สำเร็จ',
        );
        return;
      }
      setResetDone(true);
      const url = new URL(window.location.href);
      url.searchParams.delete('reset');
      window.history.replaceState({}, '', url.pathname + (url.search || '') + url.hash);
      if (resetPreview?.user?.username) setUsername(resetPreview.user.username);
      setNotice('ตั้งรหัสผ่านใหม่สำเร็จ — เข้าสู่ระบบด้วยรหัสใหม่ได้เลย');
      setTimeout(() => {
        setMode('signin');
        setResetToken(null);
        setResetPreview(null);
        setResetNewPassword('');
        setResetDone(false);
      }, 1500);
    } catch {
      setErr('รีเซ็ตรหัสผ่านไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      {mode === 'forgot' ? (
        <ForgotPanel
          identifier={forgotIdentifier}
          setIdentifier={setForgotIdentifier}
          sent={forgotSent}
          busy={busy}
          err={err}
          onSubmit={onSubmitForgot}
          onBack={() => switchMode('signin')}
        />
      ) : mode === 'reset' ? (
        <ResetPanel
          preview={resetPreview}
          newPassword={resetNewPassword}
          setNewPassword={setResetNewPassword}
          busy={busy}
          done={resetDone}
          err={err}
          onSubmit={onSubmitReset}
          onBack={() => switchMode('signin')}
        />
      ) : (
        <>
          <h1 className="text-[28px] font-bold tracking-tight text-slate-900 dark:text-white md:text-[32px]">
            เข้าสู่ระบบ
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            ยินดีต้อนรับกลับ พร้อมเริ่มงานวันนี้
          </p>

          <form onSubmit={onSubmitSignin} className="mt-5 space-y-2.5">
            <input
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="ชื่อผู้ใช้"
              required
              className={authInputClass}
            />
            <PasswordInput
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              placeholder="รหัสผ่าน"
              required
            />

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                className="text-[12px] font-medium text-slate-500 transition-colors hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400"
              >
                ลืมรหัสผ่าน?
              </button>
            </div>

            <AuthError message={err} />

            <button
              type="submit"
              disabled={busy || !username.trim() || password.length < 1}
              className={authSubmitClass + ' mt-1'}
            >
              {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
            </button>
          </form>

          {notice && (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-[13px] text-emerald-800 motion-safe:animate-[fadeUp_300ms_ease-out] dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
              {notice}
            </div>
          )}

          <p className="mt-4 text-center text-[13px] text-slate-500 dark:text-slate-400">
            ยังไม่มีบัญชี?{' '}
            <a
              href="/register"
              onClick={(e) => {
                e.preventDefault();
                window.history.pushState({}, '', '/register');
                window.dispatchEvent(new PopStateEvent('popstate'));
              }}
              className="font-semibold text-brand-600 transition-colors hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
            >
              สร้างบัญชี
            </a>
          </p>

          {(oauth?.google.enabled || oauth?.facebook.enabled) && (
            <div className="mt-4">
              <div className="mb-3 flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                <span className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  หรือ
                </span>
                <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
              </div>
              <OauthRow
                oauth={oauth}
                googleBtnRef={googleBtnRef}
                onFacebook={handleFacebook}
                busy={busy}
              />
            </div>
          )}
        </>
      )}
    </AuthShell>
  );
}

// ─── Forgot / reset sub-panels ──────────────────────────────────────────────

function ForgotPanel({
  identifier, setIdentifier, sent, busy, err, onSubmit, onBack,
}: {
  identifier: string;
  setIdentifier: (v: string) => void;
  sent: boolean;
  busy: boolean;
  err: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
}) {
  if (sent) {
    return (
      <div>
        <div className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
          ตรวจสอบอีเมลของคุณ
        </h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          ถ้ามีบัญชีตรงกับชื่อผู้ใช้หรืออีเมลนี้ เราส่งลิงก์รีเซ็ตให้แล้ว — ลิงก์อายุ 1 ชั่วโมง
        </p>
        <button
          type="button"
          onClick={onBack}
          className={authSubmitClass + ' mt-7'}
        >
          กลับไปเข้าสู่ระบบ
        </button>
        <p className="mt-3 text-center text-[11px] text-slate-400 dark:text-slate-500">
          ไม่เจออีเมล? ลองดูใน Spam / Junk
        </p>
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="-ml-1 mb-2 inline-flex items-center gap-1 text-[12px] font-medium text-slate-500 transition-colors hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400"
      >
        ← กลับ
      </button>
      <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white md:text-4xl">
        ลืมรหัสผ่าน?
      </h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        ใส่ชื่อผู้ใช้หรืออีเมล เราจะส่งลิงก์ตั้งรหัสใหม่ให้
      </p>
      <form onSubmit={onSubmit} className="mt-8 space-y-3">
        <input
          autoFocus
          type="text"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="ชื่อผู้ใช้ หรือ อีเมล"
          required
          className={authInputClass}
        />
        <AuthError message={err} />
        <button
          type="submit"
          disabled={busy || !identifier.trim()}
          className={authSubmitClass + ' mt-2'}
        >
          {busy ? 'กำลังส่ง…' : 'ส่งลิงก์รีเซ็ต'}
        </button>
      </form>
    </>
  );
}

function ResetPanel({
  preview, newPassword, setNewPassword, busy, done, err, onSubmit, onBack,
}: {
  preview: ResetPreview | null;
  newPassword: string;
  setNewPassword: (v: string) => void;
  busy: boolean;
  done: boolean;
  err: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
}) {
  if (done) {
    return (
      <div>
        <div className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
          ตั้งรหัสผ่านใหม่สำเร็จ
        </h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          กำลังพากลับไปเข้าสู่ระบบ…
        </p>
      </div>
    );
  }
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white md:text-4xl">
        ตั้งรหัสผ่านใหม่
      </h1>
      {preview ? (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          สำหรับบัญชี{' '}
          <b className="text-slate-700 dark:text-slate-200">
            {preview.user.displayName || preview.user.username}
          </b>
        </p>
      ) : (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">กำลังตรวจสอบลิงก์…</p>
      )}
      <form onSubmit={onSubmit} className="mt-8 space-y-3">
        <PasswordInput
          autoFocus
          value={newPassword}
          onChange={setNewPassword}
          autoComplete="new-password"
          placeholder="รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)"
          minLength={6}
          required
        />
        <AuthError message={err} />
        <button
          type="submit"
          disabled={busy || newPassword.length < 6 || !preview}
          className={authSubmitClass + ' mt-2'}
        >
          {busy ? 'กำลังตั้งรหัสใหม่…' : 'ตั้งรหัสใหม่'}
        </button>
      </form>
      <button
        type="button"
        onClick={onBack}
        className="mt-6 w-full text-center text-[12px] font-medium text-slate-500 transition-colors hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400"
      >
        ← กลับไปเข้าสู่ระบบ
      </button>
    </>
  );
}
