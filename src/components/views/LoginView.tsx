import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAppPreferences } from '../../context/AppPreferencesContext';
import {
  fetchOauthConfig,
  loginWithFacebookPopup,
  renderGoogleButton,
  type OauthConfig,
} from '../../lib/oauth';

type Mode = 'signin' | 'signup' | 'forgot' | 'reset';

interface ResetPreview {
  user: { username: string; displayName: string | null; email: string | null };
  expiresAt: string;
}

export function LoginView() {
  const { login, signup, loginWithGoogle, loginWithFacebook } = useAuth();
  const { t } = useAppPreferences();
  const [mode, setMode] = useState<Mode>('signin');
  const [oauth, setOauth] = useState<OauthConfig | null>(null);

  // Form fields (shared between sign-in and sign-up; sign-up uses more of them)
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');

  // Password reset state
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [resetPreview, setResetPreview] = useState<ResetPreview | null>(null);
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetDone, setResetDone] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const googleBtnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      setOauth(await fetchOauthConfig());
    })();
  }, []);

  // Detect ?reset=<token> in the URL — sent by the password reset email.
  // Pull the token, switch into reset mode, and prefetch the preview so
  // we can show the user's display name on the new-password form.
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

  // Render Google's official button into the container whenever the
  // OAuth config arrives or the mode switches (the GSI lib needs a fresh
  // render after layout changes).
  useEffect(() => {
    if (!oauth?.google.enabled || !oauth.google.clientId) return;
    const target = googleBtnRef.current;
    if (!target) return;
    target.innerHTML = ''; // clear any prior render
    void renderGoogleButton({
      container: target,
      clientId: oauth.google.clientId,
      width: 320,
      onCredential: async (credential) => {
        setErr(null);
        setBusy(true);
        const r = await loginWithGoogle(credential);
        setBusy(false);
        if (!r.ok) setErr(mapOauthError(r.error));
      },
    });
  }, [oauth, mode, loginWithGoogle]);

  const handleFacebook = useCallback(async () => {
    if (!oauth?.facebook.enabled || !oauth.facebook.appId) return;
    setErr(null);
    setBusy(true);
    const r = await loginWithFacebookPopup(oauth.facebook.appId);
    if (!r.ok) {
      setBusy(false);
      if (r.reason !== 'cancelled') setErr(mapOauthError(r.reason));
      return;
    }
    const auth = await loginWithFacebook(r.accessToken);
    setBusy(false);
    if (!auth.ok) setErr(mapOauthError(auth.error));
  }, [oauth, loginWithFacebook]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const result = mode === 'signin'
      ? await login(username.trim(), password)
      : await signup({
          username: username.trim(),
          password,
          displayName: displayName.trim() || undefined,
          email: email.trim() || undefined,
        });
    setBusy(false);
    if (!result.ok) setErr(mode === 'signin' ? mapSigninError(result.error) : mapSignupError(result.error));
  };

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setErr(null);
    setNotice(null);
    setPassword('');
    setForgotSent(false);
  };

  /** Step 1 of password reset: user enters email/username, we tell the
   *  server to send the reset email. We always show the same success
   *  message even if the identifier didn't match — same anti-enumeration
   *  pattern the backend uses. */
  const onSubmitForgot = async (e: React.FormEvent) => {
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
  };

  /** Step 2 of password reset: user (clicked the email link) sets the
   *  new password. After success, drop them on the sign-in screen with a
   *  banner — they need to log in once with the new password. */
  const onSubmitReset = async (e: React.FormEvent) => {
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
      // Done — clean the URL and bounce back to sign-in with a positive banner.
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
  };

  const submitLabel = mode === 'signin'
    ? (busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ')
    : (busy ? 'กำลังสร้างบัญชี…' : 'สร้างบัญชี');

  const oauthAvailable = oauth?.google.enabled || oauth?.facebook.enabled;

  return (
    <div className="grid min-h-screen w-screen place-items-center bg-gradient-to-br from-slate-50 via-white to-brand-50/50 px-6 py-10 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="w-full max-w-[420px]">

        {/* Brand mark */}
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/25">
            <svg className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <div>
            <div className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">Chatz</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{t('app.tagline')}</div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-900/[0.05] dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30">

          {/* ── Forgot password (step 1) ─────────────────────────────── */}
          {mode === 'forgot' && (
            <ForgotPanel
              identifier={forgotIdentifier}
              setIdentifier={setForgotIdentifier}
              sent={forgotSent}
              busy={busy}
              err={err}
              onSubmit={onSubmitForgot}
              onBack={() => switchMode('signin')}
            />
          )}

          {/* ── Reset password (step 2 — from email link) ────────────── */}
          {mode === 'reset' && (
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
          )}

          {/* ── Sign In / Sign Up — default views ────────────────────── */}
          {(mode === 'signin' || mode === 'signup') && (
            <>
          {/* Sign In / Sign Up segmented control */}
          <div className="mb-6 inline-flex w-full rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className={
                'flex-1 rounded-lg py-2 text-sm font-semibold transition ' +
                (mode === 'signin'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200')
              }
            >
              เข้าสู่ระบบ
            </button>
            <button
              type="button"
              onClick={() => switchMode('signup')}
              className={
                'flex-1 rounded-lg py-2 text-sm font-semibold transition ' +
                (mode === 'signup'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200')
              }
            >
              สร้างบัญชี
            </button>
          </div>

          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            {mode === 'signin' ? 'ยินดีต้อนรับกลับมา' : 'เริ่มใช้งาน Chatz'}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {mode === 'signin'
              ? 'เข้าสู่ระบบเพื่อจัดการแชทและออเดอร์ของคุณ'
              : 'สร้างบัญชีฟรี เชื่อมต่อ LINE / Facebook / IG ได้ทันที'}
          </p>

          {/* OAuth buttons */}
          {oauthAvailable && (
            <div className="mt-6 space-y-2.5">
              {oauth?.google.enabled && (
                <div ref={googleBtnRef} className="flex justify-center" />
              )}
              {oauth?.facebook.enabled && (
                <button
                  type="button"
                  onClick={handleFacebook}
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="#1877F2" xmlns="http://www.w3.org/2000/svg">
                    <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.018 4.388 11.012 10.125 11.927v-8.437H7.078v-3.49h3.047V9.413c0-3.026 1.792-4.697 4.533-4.697 1.312 0 2.686.235 2.686.235v2.971h-1.513c-1.49 0-1.953.93-1.953 1.886v2.265h3.328l-.532 3.49h-2.796v8.437C19.612 23.085 24 18.091 24 12.073" />
                  </svg>
                  เข้าสู่ระบบด้วย Facebook
                </button>
              )}
            </div>
          )}

          {/* Divider — only when there's an OAuth section above to separate */}
          {oauthAvailable && (
            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
              <span className="text-xs font-medium text-slate-400 dark:text-slate-500">หรือ</span>
              <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            </div>
          )}

          {/* Username/password form */}
          <form onSubmit={onSubmit} className={oauthAvailable ? '' : 'mt-6'}>
            <FieldLabel>ชื่อผู้ใช้</FieldLabel>
            <input
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={inputClass}
              placeholder={mode === 'signin' ? 'admin' : 'เช่น mintshop'}
              required
            />
            {mode === 'signup' && (
              <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                ตัวอักษรพิมพ์เล็ก ตัวเลข จุด ขีดล่าง 2-32 ตัว
              </p>
            )}

            {mode === 'signup' && (
              <>
                <FieldLabel className="mt-4">ชื่อร้าน / ชื่อที่แสดง <span className="font-normal text-slate-400">(ไม่บังคับ)</span></FieldLabel>
                <input
                  autoComplete="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className={inputClass}
                  placeholder="เช่น Mint Shop"
                />

                <FieldLabel className="mt-4">อีเมล <span className="font-normal text-slate-400">(ไม่บังคับ)</span></FieldLabel>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  placeholder="you@example.com"
                />
              </>
            )}

            <FieldLabel className="mt-4">รหัสผ่าน</FieldLabel>
            <input
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder="••••••••"
              minLength={mode === 'signup' ? 6 : undefined}
              required
            />
            {mode === 'signup' && (
              <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                อย่างน้อย 6 ตัวอักษร
              </p>
            )}

            {err && (
              <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-200">
                {err}
              </div>
            )}

            <button
              type="submit"
              disabled={busy || !username.trim() || password.length < (mode === 'signup' ? 6 : 1)}
              className="mt-5 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-500 dark:hover:bg-brand-400"
            >
              {submitLabel}
            </button>
          </form>

          <p className="mt-5 text-center text-xs text-slate-400 dark:text-slate-500">
            {mode === 'signin' ? (
              <>
                ยังไม่มีบัญชี?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  className="font-semibold text-brand-600 hover:underline dark:text-brand-400"
                >
                  สร้างบัญชีฟรี
                </button>
              </>
            ) : (
              <>
                มีบัญชีอยู่แล้ว?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  className="font-semibold text-brand-600 hover:underline dark:text-brand-400"
                >
                  เข้าสู่ระบบ
                </button>
              </>
            )}
          </p>

          {/* "Forgot password?" link — only on the sign-in tab. */}
          {mode === 'signin' && (
            <p className="mt-2 text-center text-xs">
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                className="font-medium text-slate-500 hover:text-brand-600 hover:underline dark:text-slate-400 dark:hover:text-brand-400"
              >
                ลืมรหัสผ่าน?
              </button>
            </p>
          )}
            </>
          )}

          {/* Success banner — shows after password reset finishes. */}
          {notice && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
              {notice}
            </div>
          )}
        </div>

        <p className="mt-5 text-center text-[11px] text-slate-400 dark:text-slate-500">
          การสร้างบัญชี = ยอมรับ <a href="/api/terms" target="_blank" rel="noopener noreferrer" className="hover:underline">เงื่อนไขการใช้งาน</a> และ <a href="/api/privacy" target="_blank" rel="noopener noreferrer" className="hover:underline">นโยบายความเป็นส่วนตัว</a>
        </p>
      </div>
    </div>
  );
}

// ─── Sub-panels for the forgot / reset flows ─────────────────────────────────

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
      <div className="text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">ตรวจสอบอีเมลของคุณ</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          ถ้ามีบัญชีที่ตรงกับชื่อผู้ใช้หรืออีเมลนี้ เราได้ส่งลิงก์รีเซ็ตรหัสผ่านให้แล้ว — ลิงก์อายุ 1 ชั่วโมง
        </p>
        <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
          ไม่เจออีเมล? ดูใน Spam / Junk หรือลองส่งใหม่อีก 1 นาที
        </p>
        <button
          type="button"
          onClick={onBack}
          className="mt-6 w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          กลับไปหน้าเข้าสู่ระบบ
        </button>
      </div>
    );
  }
  return (
    <>
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">ลืมรหัสผ่าน?</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        ใส่ชื่อผู้ใช้หรืออีเมลที่ใช้สมัครไว้ — เราจะส่งลิงก์ตั้งรหัสใหม่ให้
      </p>
      <form onSubmit={onSubmit} className="mt-6">
        <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-200">ชื่อผู้ใช้หรืออีเมล</label>
        <input
          autoFocus
          type="text"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="admin หรือ you@example.com"
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:bg-slate-900 dark:focus:ring-brand-900/40"
          required
        />
        {err && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-200">
            {err}
          </div>
        )}
        <button
          type="submit"
          disabled={busy || !identifier.trim()}
          className="mt-5 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-500 dark:hover:bg-brand-400"
        >
          {busy ? 'กำลังส่ง…' : 'ส่งลิงก์รีเซ็ต'}
        </button>
      </form>
      <p className="mt-4 text-center text-xs text-slate-400">
        <button type="button" onClick={onBack} className="font-medium text-slate-500 hover:text-brand-600 hover:underline dark:hover:text-brand-400">
          ← กลับไปเข้าสู่ระบบ
        </button>
      </p>
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
      <div className="text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">ตั้งรหัสผ่านใหม่สำเร็จ</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">กำลังพากลับไปเข้าสู่ระบบ…</p>
      </div>
    );
  }
  return (
    <>
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">ตั้งรหัสผ่านใหม่</h1>
      {preview ? (
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          สำหรับบัญชี <b className="text-slate-700 dark:text-slate-200">{preview.user.displayName || preview.user.username}</b>
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          กำลังตรวจสอบลิงก์…
        </p>
      )}

      <form onSubmit={onSubmit} className="mt-6">
        <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-200">รหัสผ่านใหม่</label>
        <input
          autoFocus
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="••••••••"
          minLength={6}
          required
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:bg-slate-900 dark:focus:ring-brand-900/40"
        />
        <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">อย่างน้อย 6 ตัวอักษร</p>
        {err && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-200">
            {err}
          </div>
        )}
        <button
          type="submit"
          disabled={busy || newPassword.length < 6 || !preview}
          className="mt-5 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-500 dark:hover:bg-brand-400"
        >
          {busy ? 'กำลังตั้งรหัสใหม่…' : 'ตั้งรหัสใหม่'}
        </button>
      </form>
      <p className="mt-4 text-center text-xs">
        <button type="button" onClick={onBack} className="font-medium text-slate-500 hover:text-brand-600 hover:underline dark:hover:text-brand-400">
          ← กลับไปเข้าสู่ระบบ
        </button>
      </p>
    </>
  );
}

// ─── Small helpers ───────────────────────────────────────────────────────────

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:bg-slate-900 dark:focus:ring-brand-900/40';

function FieldLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <label className={'mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-200 ' + className}>
      {children}
    </label>
  );
}

function mapSigninError(code: string): string {
  if (code === 'invalid_credentials') return 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
  if (code === 'oauth_only') return 'บัญชีนี้สร้างผ่าน Google/Facebook — ใช้ปุ่มด้านบนเพื่อเข้าสู่ระบบ';
  return `เข้าสู่ระบบไม่สำเร็จ (${code})`;
}

function mapSignupError(code: string): string {
  if (code === 'username_taken') return 'ชื่อผู้ใช้นี้ถูกใช้แล้ว ลองชื่ออื่น';
  if (code === 'email_taken') return 'อีเมลนี้ถูกใช้แล้ว';
  if (code === 'bad_username') return 'ชื่อผู้ใช้ใช้ได้แค่ a-z, 0-9, . _ - (2-32 ตัว)';
  if (code === 'password_too_short') return 'รหัสผ่านต้องอย่างน้อย 6 ตัวอักษร';
  if (code === 'bad_email') return 'รูปแบบอีเมลไม่ถูกต้อง';
  return `สร้างบัญชีไม่สำเร็จ (${code})`;
}

function mapOauthError(code: string): string {
  if (code === 'google_not_configured') return 'Google Sign-In ยังไม่ได้ตั้งค่าฝั่งเซิร์ฟเวอร์';
  if (code === 'facebook_not_configured') return 'Facebook Login ยังไม่ได้ตั้งค่าฝั่งเซิร์ฟเวอร์';
  if (code === 'invalid_google_token' || code === 'wrong_audience') return 'Google ปฏิเสธ token — ลองอีกครั้ง';
  if (code === 'invalid_fb_token') return 'Facebook ปฏิเสธ token — ลองอีกครั้ง';
  if (code === 'email_not_verified') return 'อีเมล Google ยังไม่ได้ยืนยัน';
  if (code === 'not_authorized') return 'คุณยังไม่ได้อนุญาตให้แอปเข้าถึงข้อมูล Facebook';
  if (code === 'gsi_not_loaded' || code === 'fb_sdk_not_loaded') return 'โหลด SDK ของผู้ให้บริการไม่สำเร็จ ลองรีเฟรชหน้า';
  return `OAuth error: ${code}`;
}
