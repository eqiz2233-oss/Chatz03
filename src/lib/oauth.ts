// Browser-side OAuth helpers for the Login / Sign Up screen.
//
// We use the SDKs already loaded in index.html (Google Identity Services
// and Facebook JS SDK). Both expose globals on `window`; this file wraps
// them with thin promise-based APIs and waits for the scripts to finish
// loading before resolving.

export interface OauthConfig {
  google: { enabled: boolean; clientId: string | null };
  facebook: { enabled: boolean; appId: string | null };
  /** LINE Login uses a full-page redirect flow, so the frontend only
   *  needs to know whether the server is wired up — never the secret. */
  line: { enabled: boolean };
}

const EMPTY_OAUTH_CONFIG: OauthConfig = {
  google: { enabled: false, clientId: null },
  facebook: { enabled: false, appId: null },
  line: { enabled: false },
};

/**
 * Pull the public OAuth config (which providers the server has env vars for)
 * so the Login screen can hide buttons that wouldn't work anyway.
 */
export async function fetchOauthConfig(): Promise<OauthConfig> {
  try {
    const r = await fetch('/api/auth/oauth-config', { credentials: 'include' });
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as Partial<OauthConfig>;
    return {
      google: j.google ?? EMPTY_OAUTH_CONFIG.google,
      facebook: j.facebook ?? EMPTY_OAUTH_CONFIG.facebook,
      line: j.line ?? EMPTY_OAUTH_CONFIG.line,
    };
  } catch {
    return EMPTY_OAUTH_CONFIG;
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
  // Defensive client-side check. If the server's config call returned a
  // malformed appId (e.g. still carrying "FB_APP_ID=" prefix because of a
  // Railway paste mistake) we'd otherwise hand it to FB.init and the
  // login dialog would either silently fail or open onto Facebook's
  // "Invalid App ID" wrench page with no way back. Better to short-
  // circuit here so the calling component can show a clear toast.
  if (!appId || !/^\d{8,20}$/.test(appId)) {
    return { ok: false, reason: 'facebook_not_configured' };
  }

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

  // Wrap FB.login in a 45s timeout. The Facebook SDK has a history of
  // never invoking the callback when the popup is blocked, when the
  // user closes it via the OS chrome (not the FB UI), or when the
  // embedded login frame fails to load. Without this timeout the agent
  // would see nothing on click — "FB ไม่ขึ้นอะไรเลย" — and never know
  // why. 45s comfortably exceeds a normal login round-trip.
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: { ok: true; accessToken: string } | { ok: false; reason: string }) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(v);
    };
    const timer = window.setTimeout(() => {
      finish({ ok: false, reason: 'fb_popup_timeout' });
    }, 45_000);
    try {
      FB.login(
        (resp) => {
          if (resp.status === 'connected' && resp.authResponse?.accessToken) {
            finish({ ok: true, accessToken: resp.authResponse.accessToken });
          } else {
            finish({
              ok: false,
              reason: resp.status === 'not_authorized' ? 'not_authorized' : 'cancelled',
            });
          }
        },
        { scope: 'public_profile,email' },
      );
    } catch (e) {
      finish({ ok: false, reason: String((e as Error)?.message || e) });
    }
  });
}
