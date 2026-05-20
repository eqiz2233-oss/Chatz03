import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  fetchOauthConfig,
  loginWithFacebookPopup,
  renderGoogleButton,
  type OauthConfig,
} from '../../lib/oauth';

/**
 * Shared building blocks used by both LoginView and RegisterView so the
 * two screens stay visually coherent and we don't duplicate error mapping
 * + OAuth setup code.
 */

// ─── Form classes ───────────────────────────────────────────────────────────

export const authInputClass =
  'w-full rounded-2xl border border-transparent bg-white px-5 py-3.5 text-[15px] text-slate-900 ' +
  'placeholder:text-slate-400 outline-none shadow-[0_1px_2px_rgba(15,23,42,0.04)] ' +
  'transition-all duration-300 ease-out ' +
  'focus:border-brand-300 focus:shadow-[0_0_0_4px_rgba(139,92,246,0.12)] ' +
  'dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-brand-700 dark:focus:shadow-[0_0_0_4px_rgba(139,92,246,0.2)]';

export const authSubmitClass =
  'inline-flex w-full items-center justify-center gap-2 rounded-2xl ' +
  'bg-gradient-to-r from-brand-600 to-pink-600 px-5 py-3.5 ' +
  'text-[15px] font-semibold text-white shadow-lg shadow-brand-600/25 ' +
  'transition-all duration-300 ease-out ' +
  'hover:shadow-xl hover:shadow-brand-600/35 hover:-translate-y-[1px] ' +
  'active:translate-y-0 active:scale-[0.99] ' +
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-md disabled:hover:translate-y-0';

// ─── Error mappers ──────────────────────────────────────────────────────────

export function mapSigninError(code: string): string {
  if (code === 'invalid_credentials') return 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
  if (code === 'oauth_only') return 'บัญชีนี้สร้างผ่าน Google/Facebook — ใช้ปุ่มด้านล่างเพื่อเข้าสู่ระบบ';
  return `เข้าสู่ระบบไม่สำเร็จ (${code})`;
}

export function mapSignupError(code: string): string {
  if (code === 'username_taken') return 'ชื่อผู้ใช้นี้ถูกใช้แล้ว ลองชื่ออื่น';
  if (code === 'email_taken') return 'อีเมลนี้ถูกใช้แล้ว';
  if (code === 'bad_username') return 'ชื่อผู้ใช้ใช้ได้แค่ a-z, 0-9, . _ - (2-32 ตัว)';
  if (code === 'password_too_short') return 'รหัสผ่านต้องอย่างน้อย 6 ตัวอักษร';
  if (code === 'bad_email') return 'รูปแบบอีเมลไม่ถูกต้อง';
  return `สร้างบัญชีไม่สำเร็จ (${code})`;
}

export function mapOauthError(code: string): string {
  if (code === 'google_not_configured')
    return 'Google Sign-In ยังไม่ได้ตั้งค่า — ตั้ง GOOGLE_CLIENT_ID ใน Railway Variables';
  if (code === 'facebook_not_configured')
    return 'Facebook Login ยังไม่ได้ตั้งค่า — ตั้ง FB_APP_ID + FB_APP_SECRET ใน Railway Variables';
  if (code === 'line_not_configured')
    return 'LINE Login ยังไม่ได้ตั้งค่า — ตั้ง LINE_LOGIN_CHANNEL_ID + LINE_LOGIN_CHANNEL_SECRET ใน Railway Variables';
  if (code === 'invalid_google_token' || code === 'wrong_audience') return 'Google ปฏิเสธ token — ลองอีกครั้ง';
  if (code === 'invalid_fb_token') return 'Facebook ปฏิเสธ token — ลองอีกครั้ง';
  if (code === 'email_not_verified') return 'อีเมล Google ยังไม่ได้ยืนยัน';
  if (code === 'not_authorized') return 'คุณยังไม่ได้อนุญาตให้แอปเข้าถึงข้อมูล Facebook';
  if (code === 'gsi_not_loaded' || code === 'fb_sdk_not_loaded') return 'โหลด SDK ของผู้ให้บริการไม่สำเร็จ ลองรีเฟรชหน้า';
  if (code === 'fb_popup_timeout')
    return 'หน้าต่าง Facebook ไม่ตอบสนอง — ตรวจว่าเบราว์เซอร์ไม่บล็อก popup แล้วลองอีกครั้ง';
  if (code === 'cancelled') return ''; // user closed — no error toast
  return `OAuth error: ${code}`;
}

// ─── OAuth icon row (Google + Facebook) ─────────────────────────────────────

/**
 * Hook + component pair. The hook centralizes config fetch + handler
 * wiring so both auth screens get identical behavior; the component
 * renders the icon row in the exact style used by both screens.
 */
/** Shape passed to onCollision when an OAuth login succeeds with the
 *  provider but the email already belongs to a Chatz account created
 *  through a different sign-in method. The UI uses this to render a
 *  banner instead of a flat error toast. */
export interface OauthCollisionInfo {
  /** Which provider the user just authenticated with. */
  provider: 'google' | 'facebook' | 'line';
  /** Existing account's email (the address Google / Facebook returned). */
  email?: string;
  /** Existing account's username — used to pre-fill the password form. */
  existingUsername?: string | null;
  /** Sign-in methods the existing account already supports. */
  existingMethods: string[];
}

export function useOauth(
  onError: (msg: string | null) => void,
  onBusy: (b: boolean) => void,
  onCollision?: (info: OauthCollisionInfo) => void,
) {
  const { loginWithGoogle, loginWithFacebook } = useAuth();
  const [oauth, setOauth] = useState<OauthConfig | null>(null);
  const googleBtnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      setOauth(await fetchOauthConfig());
    })();
  }, []);

  // Google's GSI lib renders into a div we own; re-render whenever config
  // arrives so the button is ready as soon as the page settles.
  useEffect(() => {
    if (!oauth?.google.enabled || !oauth.google.clientId) return;
    const target = googleBtnRef.current;
    if (!target) return;
    target.innerHTML = '';
    void renderGoogleButton({
      container: target,
      clientId: oauth.google.clientId,
      variant: 'icon',
      onCredential: async (credential) => {
        onError(null);
        onBusy(true);
        const r = await loginWithGoogle(credential);
        onBusy(false);
        if (!r.ok) {
          if (r.error === 'email_in_use' && onCollision && r.existingMethods) {
            onCollision({
              provider: 'google',
              email: r.email,
              existingUsername: r.existingUsername ?? null,
              existingMethods: r.existingMethods,
            });
          } else {
            onError(mapOauthError(r.error));
          }
        }
      },
    });
  }, [oauth, loginWithGoogle, onError, onBusy, onCollision]);

  const handleFacebook = useCallback(async () => {
    // When env isn't set we still want to react to the click — show a
    // toast explaining what to set on Railway. The OauthRow renders a
    // fallback button in that case and calls this same handler.
    if (!oauth?.facebook.enabled || !oauth.facebook.appId) {
      onError(mapOauthError('facebook_not_configured'));
      return;
    }
    onError(null);
    onBusy(true);
    const r = await loginWithFacebookPopup(oauth.facebook.appId);
    if (!r.ok) {
      onBusy(false);
      if (r.reason !== 'cancelled') onError(mapOauthError(r.reason));
      return;
    }
    const auth = await loginWithFacebook(r.accessToken);
    onBusy(false);
    if (!auth.ok) {
      if (auth.error === 'email_in_use' && onCollision && auth.existingMethods) {
        onCollision({
          provider: 'facebook',
          email: auth.email,
          existingUsername: auth.existingUsername ?? null,
          existingMethods: auth.existingMethods,
        });
      } else {
        onError(mapOauthError(auth.error));
      }
    }
  }, [oauth, loginWithFacebook, onError, onBusy, onCollision]);

  /**
   * Click handler used by the always-rendered Google + LINE fallback
   * buttons when those providers aren't configured server-side. Picks the
   * right error code so `mapOauthError` produces a clear Thai message
   * instead of leaving the user staring at a dead button.
   */
  const handleProviderUnavailable = useCallback(
    (provider: 'google' | 'line' | 'facebook') => {
      const code =
        provider === 'google'    ? 'google_not_configured'
        : provider === 'line'    ? 'line_not_configured'
        :                          'facebook_not_configured';
      onError(mapOauthError(code));
    },
    [onError],
  );

  /** Triggered by the LINE chip when the server reports it's configured. */
  const handleLine = useCallback(() => {
    if (!oauth?.line.enabled) {
      handleProviderUnavailable('line');
      return;
    }
    // Server-side redirect flow — leave the page entirely.
    window.location.href = '/api/auth/oauth/line/start';
  }, [oauth, handleProviderUnavailable]);

  return { oauth, googleBtnRef, handleFacebook, handleLine, handleProviderUnavailable };
}

/**
 * Three OAuth icon chips — Google, Facebook, LINE — *always* rendered, in
 * that order. Pre-launch operators almost always see one or two providers
 * disabled because their Railway env isn't wired up yet; hiding the chips
 * leaves them wondering "why doesn't Google show?". Showing all three and
 * surfacing the missing env on click is much clearer.
 *
 * Behaviour per provider:
 *   • enabled  — chip is the real OAuth entry point (GSI button / FB
 *     popup / LINE full-page redirect).
 *   • disabled — chip still renders identically; clicking shows a Thai
 *     toast naming the exact Railway var to set.
 */
export function OauthRow({
  oauth,
  googleBtnRef,
  onFacebook,
  onLine,
  onUnavailable,
  busy,
}: {
  oauth: OauthConfig | null;
  googleBtnRef: React.RefObject<HTMLDivElement>;
  onFacebook: () => void;
  onLine: () => void;
  onUnavailable: (provider: 'google' | 'facebook' | 'line') => void;
  busy: boolean;
}) {
  const chipCls =
    'grid h-10 w-10 place-items-center rounded-md border border-slate-300 bg-white transition-all duration-300 ease-out hover:-translate-y-[1px] hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand-300 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900';
  return (
    <div className="flex items-center justify-center gap-3">
      {/* Google */}
      {oauth?.google.enabled ? (
        // GSI library paints its own square icon button (40×40) into this
        // ref div. Outer span gives it a clean slot that lines up with the
        // FB + LINE chips below.
        <div className="inline-flex items-center justify-center" ref={googleBtnRef} />
      ) : (
        <button
          type="button"
          onClick={() => onUnavailable('google')}
          aria-label="เข้าสู่ระบบด้วย Google (ยังไม่ได้ตั้งค่า)"
          className={chipCls}
        >
          <GoogleIcon />
        </button>
      )}

      {/* Facebook */}
      <button
        type="button"
        onClick={onFacebook}
        disabled={busy}
        aria-label="เข้าสู่ระบบด้วย Facebook"
        className={chipCls}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5">
          <path
            fill="#1877F2"
            d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.018 4.388 11.012 10.125 11.927v-8.437H7.078v-3.49h3.047V9.413c0-3.026 1.792-4.697 4.533-4.697 1.312 0 2.686.235 2.686.235v2.971h-1.513c-1.49 0-1.953.93-1.953 1.886v2.265h3.328l-.532 3.49h-2.796v8.437C19.612 23.085 24 18.091 24 12.073"
          />
        </svg>
      </button>

      {/* LINE */}
      <button
        type="button"
        onClick={onLine}
        aria-label="เข้าสู่ระบบด้วย LINE"
        className={chipCls}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5">
          <path
            fill="#06C755"
            d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zM15.61 12.99a.626.626 0 0 1-.627.629.616.616 0 0 1-.51-.252l-2.443-3.317v2.94c0 .344-.282.629-.63.629a.628.628 0 0 1-.628-.629V8.108c0-.27.174-.51.434-.595.058-.022.124-.034.192-.034.197 0 .375.105.495.272l2.462 3.33V8.108c0-.345.282-.63.63-.63.346 0 .627.285.627.63v4.882zM9.116 13.62a.627.627 0 0 1-.629-.629V8.108c0-.345.282-.63.63-.63.345 0 .628.285.628.63v4.883c0 .344-.282.629-.629.629zm-2.249 0H4.481a.628.628 0 0 1-.629-.629V8.108c0-.345.283-.63.63-.63.347 0 .628.285.628.63v4.252h1.757c.345 0 .626.283.626.63 0 .344-.281.629-.626.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"
          />
        </svg>
      </button>
    </div>
  );
}

/** Multi-color Google "G" mark — used in the fallback chip when GSI is
 *  not configured (the GSI library would otherwise inject a styled
 *  button, but it can't without a clientId). */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

// ─── Eye-toggle for password fields ─────────────────────────────────────────

export function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete,
  minLength,
  required,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  minLength?: number;
  required?: boolean;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'รหัสผ่าน'}
        minLength={minLength}
        required={required}
        autoFocus={autoFocus}
        className={authInputClass + ' pr-12'}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-700 focus:outline-none focus-visible:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
      >
        {visible ? (
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}

// ─── Error banner (compact) ─────────────────────────────────────────────────

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] text-rose-700 motion-safe:animate-[fadeUp_300ms_ease-out] dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-200">
      {message}
    </div>
  );
}

// ─── Collision banner ──────────────────────────────────────────────────────
//
// Surfaced when the user authenticated with an OAuth provider, but their
// email already maps to a Chatz account that was created through a
// different sign-in method. We refuse to silently merge (account-takeover
// risk) and instead tell them which method to use.

const PROVIDER_TH: Record<string, string> = {
  password: 'รหัสผ่าน',
  google: 'Google',
  facebook: 'Facebook',
  line: 'LINE',
};

export function CollisionBanner({
  info,
  onDismiss,
}: {
  info: OauthCollisionInfo;
  onDismiss: () => void;
}) {
  const triedTh = PROVIDER_TH[info.provider] || info.provider;
  const existingTh = info.existingMethods.map((m) => PROVIDER_TH[m] || m).join(' / ');
  const emailMasked = info.email
    ? info.email.replace(/(^.).+(@.*$)/, '$1***$2')
    : null;
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] motion-safe:animate-[fadeUp_300ms_ease-out] dark:border-amber-900/50 dark:bg-amber-950/40">
      <div className="flex items-start gap-3">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-500 text-white">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-amber-900 dark:text-amber-100">
            มีบัญชีอยู่แล้วด้วย {existingTh}
          </div>
          <p className="mt-0.5 text-amber-800 dark:text-amber-200">
            {emailMasked ? (
              <>
                บัญชี <b className="font-mono">{emailMasked}</b> สมัครไว้แล้วโดยใช้ <b>{existingTh}</b> —
                ไม่ใช่ <b>{triedTh}</b>
              </>
            ) : (
              <>บัญชีนี้สมัครไว้แล้วโดยใช้ <b>{existingTh}</b></>
            )}
          </p>
          <p className="mt-2 text-[12px] text-amber-700 dark:text-amber-300">
            เข้าสู่ระบบด้วย <b>{existingTh}</b> ก่อน
            แล้วเชื่อม {triedTh} เข้ากับบัญชีของคุณได้ที่ Settings → ความปลอดภัยและความเป็นส่วนตัว
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="ปิด"
          className="shrink-0 rounded-md p-1 text-amber-700 transition-colors hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
