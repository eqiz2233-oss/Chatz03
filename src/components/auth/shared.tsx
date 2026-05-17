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
  if (code === 'google_not_configured') return 'Google Sign-In ยังไม่ได้ตั้งค่าฝั่งเซิร์ฟเวอร์';
  if (code === 'facebook_not_configured') return 'Facebook Login ยังไม่ได้ตั้งค่าฝั่งเซิร์ฟเวอร์';
  if (code === 'invalid_google_token' || code === 'wrong_audience') return 'Google ปฏิเสธ token — ลองอีกครั้ง';
  if (code === 'invalid_fb_token') return 'Facebook ปฏิเสธ token — ลองอีกครั้ง';
  if (code === 'email_not_verified') return 'อีเมล Google ยังไม่ได้ยืนยัน';
  if (code === 'not_authorized') return 'คุณยังไม่ได้อนุญาตให้แอปเข้าถึงข้อมูล Facebook';
  if (code === 'gsi_not_loaded' || code === 'fb_sdk_not_loaded') return 'โหลด SDK ของผู้ให้บริการไม่สำเร็จ ลองรีเฟรชหน้า';
  return `OAuth error: ${code}`;
}

// ─── OAuth icon row (Google + Facebook) ─────────────────────────────────────

/**
 * Hook + component pair. The hook centralizes config fetch + handler
 * wiring so both auth screens get identical behavior; the component
 * renders the icon row in the exact style used by both screens.
 */
export function useOauth(onError: (msg: string | null) => void, onBusy: (b: boolean) => void) {
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
        if (!r.ok) onError(mapOauthError(r.error));
      },
    });
  }, [oauth, loginWithGoogle, onError, onBusy]);

  const handleFacebook = useCallback(async () => {
    if (!oauth?.facebook.enabled || !oauth.facebook.appId) return;
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
    if (!auth.ok) onError(mapOauthError(auth.error));
  }, [oauth, loginWithFacebook, onError, onBusy]);

  return { oauth, googleBtnRef, handleFacebook };
}

export function OauthRow({
  oauth,
  googleBtnRef,
  onFacebook,
  busy,
}: {
  oauth: OauthConfig | null;
  googleBtnRef: React.RefObject<HTMLDivElement>;
  onFacebook: () => void;
  busy: boolean;
}) {
  const hasAny = oauth?.google.enabled || oauth?.facebook.enabled;
  if (!hasAny) return null;
  return (
    <div className="flex items-center justify-center gap-3">
      {oauth?.google.enabled && (
        // GSI library paints its own square icon button (40×40) here. We
        // give it a clean wrapper so it visually aligns with the FB chip.
        <div className="inline-flex items-center justify-center" ref={googleBtnRef} />
      )}
      {oauth?.facebook.enabled && (
        <button
          type="button"
          onClick={onFacebook}
          disabled={busy}
          aria-label="เข้าสู่ระบบด้วย Facebook"
          className="grid h-10 w-10 place-items-center rounded-md border border-slate-300 bg-white transition-all duration-300 ease-out hover:-translate-y-[1px] hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand-300 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5">
            <path
              fill="#1877F2"
              d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.018 4.388 11.012 10.125 11.927v-8.437H7.078v-3.49h3.047V9.413c0-3.026 1.792-4.697 4.533-4.697 1.312 0 2.686.235 2.686.235v2.971h-1.513c-1.49 0-1.953.93-1.953 1.886v2.265h3.328l-.532 3.49h-2.796v8.437C19.612 23.085 24 18.091 24 12.073"
            />
          </svg>
        </button>
      )}
    </div>
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
