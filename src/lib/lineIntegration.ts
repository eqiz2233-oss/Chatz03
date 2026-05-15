// LINE integration client helpers (status check + connect / disconnect).
//
// Mirrors the FB helpers so the Settings UI can drive the LINE connect flow
// without ever asking the shop owner to touch server env vars.

export interface LineBotInfo {
  userId: string;
  basicId?: string | null;
  displayName?: string | null;
  pictureUrl?: string | null;
  chatMode?: string | null;
  markAsReadMode?: string | null;
}

export interface LineEnvPresent {
  LINE_CHANNEL_SECRET: boolean;
  LINE_CHANNEL_ACCESS_TOKEN: boolean;
}

export interface LineIntegrationStatus {
  /** Webhook signature secret present — webhook can verify Meta signatures. */
  configured: boolean;
  /** Channel access token present — we can call LINE push API. */
  replyEnabled: boolean;
  /** 'env' when from server env vars, 'ui' when saved via this page, null when neither. */
  source: 'env' | 'ui' | null;
  botInfo: LineBotInfo | null;
  /** Full webhook URL to copy into LINE Developers console. */
  webhookUrl: string;
  /** How many inbox threads we already have on disk. */
  threadCount: number;
  envPresent: LineEnvPresent;
}

export async function fetchLineStatus(): Promise<LineIntegrationStatus> {
  const r = await fetch('/api/line/integration/status');
  if (!r.ok) throw new Error(`status ${r.status}`);
  return (await r.json()) as LineIntegrationStatus;
}

export async function connectLine(input: {
  channelSecret: string;
  channelAccessToken: string;
}): Promise<LineIntegrationStatus> {
  const r = await fetch('/api/line/integration/connect', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error((data as { error?: string }).error || `status ${r.status}`);
  }
  return (data as { status: LineIntegrationStatus }).status;
}

export async function disconnectLine(): Promise<LineIntegrationStatus> {
  const r = await fetch('/api/line/integration/disconnect', {
    method: 'POST',
    credentials: 'include',
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error((data as { error?: string }).error || `status ${r.status}`);
  }
  return (data as { status: LineIntegrationStatus }).status;
}
