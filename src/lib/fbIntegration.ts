// Facebook + Instagram integration client helpers (status check + Connect-popup orchestration).

export interface FbConnectedInstagram {
  id: string;
  username: string;
  name?: string | null;
  picture?: string | null;
}

export interface FbConnectedPage {
  id: string;
  name: string;
  category?: string;
  picture?: string;
  instagram?: FbConnectedInstagram | null;
  connectedAt?: string;
}

export interface FbIntegrationEnvPresent {
  FB_APP_ID: boolean;
  FB_APP_SECRET: boolean;
  FB_PAGE_ACCESS_TOKEN: boolean;
  FB_VERIFY_TOKEN: boolean;
}

export interface FbIntegrationStatus {
  /** True when webhook verify token and/or a Page token is present (channel can be live). */
  connected: boolean;
  /** FB_VERIFY_TOKEN set — Meta can deliver webhook events to this server. */
  webhookReady: boolean;
  /** OAuth Page token or FB_PAGE_ACCESS_TOKEN — required to send replies and resolve some attachments. */
  replyEnabled: boolean;
  page: FbConnectedPage | null;
  /** How the Page token was obtained, when known. */
  tokenSource?: 'oauth' | 'env' | null;
  oauthAvailable: boolean;
  appId: string | null;
  needsAppSecret: boolean;
  needsVerifyToken: boolean;
  apiVersion: string;
  /** Which env vars the running server sees (never includes secret values). */
  envPresent?: FbIntegrationEnvPresent | null;
}

export async function fetchFbStatus(): Promise<FbIntegrationStatus> {
  const r = await fetch('/api/fb/integration/status');
  if (!r.ok) throw new Error(`status ${r.status}`);
  return (await r.json()) as FbIntegrationStatus;
}

export async function disconnectFbPage(): Promise<void> {
  const r = await fetch('/api/fb/integration/disconnect', { method: 'POST' });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `status ${r.status}`);
  }
}

/**
 * Open the Facebook OAuth popup. Returns when the popup posts back the chosen Page,
 * or rejects on user-close / timeout. Caller should refetch status afterwards.
 */
export function openFbConnectPopup(): Promise<FbConnectedPage> {
  return new Promise((resolve, reject) => {
    const w = 540;
    const h = 720;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    const popup = window.open(
      '/api/fb/oauth/start',
      'chatz-fb-connect',
      `width=${w},height=${h},left=${left},top=${top},popup=yes`,
    );
    if (!popup) {
      reject(new Error('Browser blocked popup. Allow popups for this site and try again.'));
      return;
    }

    let resolved = false;
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data as { type?: string; page?: FbConnectedPage } | undefined;
      if (!data || data.type !== 'chatz:fb-connected' || !data.page) return;
      resolved = true;
      window.removeEventListener('message', onMessage);
      clearInterval(closedPoll);
      resolve(data.page);
    };
    window.addEventListener('message', onMessage);

    const closedPoll = window.setInterval(() => {
      if (popup.closed && !resolved) {
        window.removeEventListener('message', onMessage);
        clearInterval(closedPoll);
        reject(new Error('Connect window was closed before finishing.'));
      }
    }, 600);
  });
}
