// Browser-side OAuth helpers for the Login / Sign Up screen.
//
// We use the SDKs already loaded in index.html (Google Identity Services
// and Facebook JS SDK). Both expose globals on `window`; this file wraps
// them with thin promise-based APIs and waits for the scripts to finish
// loading before resolving.

export interface OauthConfig {
  google: { enabled: boolean; clientId: string | null };
  facebook: { enabled: boolean; appId: string | null };
}

/**
 * Pull the public OAuth config (which providers the server has env vars for)
 * so the Login screen can hide buttons that wouldn't work anyway.
 */
export async function fetchOauthConfig(): Promise<OauthConfig> {
  try {
    const r = await fetch('/api/auth/oauth-config', { credentials: 'include' });
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as OauthConfig;
  } catch {
    return { google: { enabled: false, clientId: null }, facebook: { enabled: false, appId: null } };
  }
}

// ─── Google Identity Services ────────────────────────────────────────────────

// Minimal TS shape of the bits of window.google we touch.
interface GoogleCredentialResponse {
  credential: string;
  select_by?: string;
}
interface GoogleIdConfig {
  client_id: string;
  callback: (resp: GoogleCredentialResponse) => void;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
  use_fedcm_for_prompt?: boolean;
}
interface GoogleAccountsId {
  initialize: (cfg: GoogleIdConfig) => void;
  prompt: (listener?: (notification: { isNotDisplayed: () => boolean; isSkippedMoment: () => boolean; getNotDisplayedReason: () => string }) => void) => void;
  renderButton: (
    parent: HTMLElement,
    options: { type?: 'standard' | 'icon'; theme?: 'outline' | 'filled_blue' | 'filled_black'; size?: 'large' | 'medium' | 'small'; width?: number | string; text?: 'signin_with' | 'signup_with' | 'continue_with'; shape?: 'rectangular' | 'pill' | 'circle' | 'square'; logo_alignment?: 'left' | 'center'; locale?: string },
  ) => void;
  disableAutoSelect: () => void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

/**
 * Wait up to 6 s for the GSI script tag in index.html to load. Returns
 * `null` if it never shows up (CSP, network failure, browser blocked).
 */
async function awaitGoogle(timeoutMs = 6000): Promise<GoogleAccountsId | null> {
  if (window.google?.accounts?.id) return window.google.accounts.id;
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (window.google?.accounts?.id) return resolve(window.google.accounts.id);
      if (Date.now() - start > timeoutMs) return resolve(null);
      setTimeout(tick, 80);
    };
    tick();
  });
}

/**
 * Render a real Google "Sign in with Google" button into the given element.
 * Triggers `onCredential` with the JWT id_token when the user completes the
 * flow. The button matches Google's branding rules (required for production).
 */
export async function renderGoogleButton({
  container,
  clientId,
  onCredential,
  width = 320,
  variant = 'standard',
}: {
  container: HTMLElement;
  clientId: string;
  onCredential: (credential: string) => void;
  width?: number;
  /**
   * 'standard' = full-width "Continue with Google" pill (the default,
   * Google's recommended). 'icon' = square 40×40 G-logo chip used in
   * the auth-shell OAuth row.
   */
  variant?: 'standard' | 'icon';
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const gsi = await awaitGoogle();
  if (!gsi) return { ok: false, reason: 'gsi_not_loaded' };
  try {
    gsi.initialize({
      client_id: clientId,
      callback: (resp) => {
        if (resp?.credential) onCredential(resp.credential);
      },
      cancel_on_tap_outside: true,
      use_fedcm_for_prompt: true,
    });
    if (variant === 'icon') {
      gsi.renderButton(container, {
        type: 'icon',
        theme: 'outline',
        size: 'large',
        shape: 'square',
      });
    } else {
      gsi.renderButton(container, {
        theme: 'outline',
        size: 'large',
        width,
        text: 'continue_with',
        shape: 'rectangular',
        logo_alignment: 'left',
      });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String((e as Error)?.message || e) };
  }
}

// ─── Facebook Login ──────────────────────────────────────────────────────────

interface FacebookLoginResponse {
  status: 'connected' | 'not_authorized' | 'unknown';
  authResponse: { accessToken: string; userID: string; expiresIn: number; signedRequest: string } | null;
}

interface FacebookSdk {
  init: (opts: { appId: string; version: string; cookie?: boolean; xfbml?: boolean }) => void;
  login: (
    cb: (resp: FacebookLoginResponse) => void,
    opts?: { scope?: string; return_scopes?: boolean; auth_type?: 'reauthenticate' | 'reauthorize' | 'rerequest' },
  ) => void;
  getLoginStatus: (cb: (resp: FacebookLoginResponse) => void) => void;
}

async function awaitFacebook(timeoutMs = 6000): Promise<FacebookSdk | null> {
  if (window.FB) return window.FB;
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (window.FB) return resolve(window.FB);
      if (Date.now() - start > timeoutMs) return resolve(null);
      setTimeout(tick, 80);
    };
    tick();
  });
}

let fbInitialized = false;

/**
 * Pop the Facebook Login dialog. Resolves with the user access token on
 * success, or a reason string on failure / cancellation.
 */
export async function loginWithFacebookPopup(appId: string): Promise<
  { ok: true; accessToken: string } | { ok: false; reason: string }
> {
  const FB = await awaitFacebook();
  if (!FB) return { ok: false, reason: 'fb_sdk_not_loaded' };

  if (!fbInitialized) {
    try {
      FB.init({ appId, version: 'v18.0', cookie: false, xfbml: false });
      fbInitialized = true;
    } catch (e) {
      return { ok: false, reason: String((e as Error)?.message || e) };
    }
  }

  return new Promise((resolve) => {
    FB.login(
      (resp) => {
        if (resp.status === 'connected' && resp.authResponse?.accessToken) {
          resolve({ ok: true, accessToken: resp.authResponse.accessToken });
        } else {
          resolve({ ok: false, reason: resp.status === 'not_authorized' ? 'not_authorized' : 'cancelled' });
        }
      },
      { scope: 'public_profile,email' },
    );
  });
}
