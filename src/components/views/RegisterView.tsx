import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { AuthShell } from '../auth/AuthShell';
import {
  AuthError,
  OauthRow,
  PasswordInput,
  authInputClass,
  authSubmitClass,
  mapSignupError,
  useOauth,
} from '../auth/shared';

/**
 * Registration screen — lives at /register, separate from /login.
 *
 * Kept intentionally short: name (optional display name), email
 * (optional), password. Username is auto-derived from the form on
 * submit if empty — but for now we still ask for one because the auth
 * API requires it. The "display name" field doubles as the shop name
 * since most signups happen from a single shop owner.
 */
export function RegisterView() {
  const { signup } = useAuth();

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { oauth, googleBtnRef, handleFacebook, handleLine, handleProviderUnavailable } = useOauth(setErr, setBusy);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const result = await signup({
      username: username.trim(),
      password,
      displayName: displayName.trim() || undefined,
      email: email.trim() || undefined,
    });
    setBusy(false);
    if (!result.ok) setErr(mapSignupError(result.error));
  }

  const canSubmit = username.trim().length >= 2 && password.length >= 6;

  return (
    <AuthShell>
      <h1 className="text-[28px] font-bold tracking-tight text-slate-900 dark:text-white md:text-[32px]">
        สร้างบัญชี
      </h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        เริ่มใช้งานฟรี — เชื่อม LINE / Facebook / IG ได้ทันที
      </p>

      <form onSubmit={onSubmit} className="mt-5 space-y-2.5">
        <input
          autoFocus
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="ชื่อร้าน"
          className={authInputClass}
        />
        <input
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="ชื่อผู้ใช้ (a-z, 0-9)"
          required
          className={authInputClass}
        />
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="อีเมล (ไม่บังคับ)"
          className={authInputClass}
        />
        <PasswordInput
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          placeholder="รหัสผ่าน (อย่างน้อย 6 ตัว)"
          minLength={6}
          required
        />

        <AuthError message={err} />

        <button
          type="submit"
          disabled={busy || !canSubmit}
          className={authSubmitClass + ' mt-1'}
        >
          {busy ? 'กำลังสร้างบัญชี…' : 'สร้างบัญชี'}
        </button>
      </form>

      <p className="mt-4 text-center text-[13px] text-slate-500 dark:text-slate-400">
        มีบัญชีอยู่แล้ว?{' '}
        <a
          href="/login"
          onClick={(e) => {
            e.preventDefault();
            window.history.pushState({}, '', '/login');
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
          className="font-semibold text-brand-600 transition-colors hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
        >
          เข้าสู่ระบบ
        </a>
      </p>

      {/* OAuth row always renders — disabled providers still show a chip
          so the operator knows which env to wire up next. */}
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
          onLine={handleLine}
          onUnavailable={handleProviderUnavailable}
          busy={busy}
        />
      </div>

      <p className="mt-4 text-center text-[10px] leading-relaxed text-slate-400 dark:text-slate-500">
        การสร้างบัญชี = ยอมรับ{' '}
        <a href="/api/terms" target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:text-slate-600 hover:underline dark:hover:text-slate-300">
          เงื่อนไข
        </a>{' '}และ{' '}
        <a href="/api/privacy" target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:text-slate-600 hover:underline dark:hover:text-slate-300">
          นโยบายความเป็นส่วนตัว
        </a>
      </p>
    </AuthShell>
  );
}
