// Team / shop-member helpers for the Settings page.
//
// The "invite" flow is intentionally simple:
//   1. Owner POSTs /api/shops/:shopId/invites and gets back a shareable URL.
//   2. Owner pastes that URL into LINE / Messenger / whatever themselves.
//   3. Recipient opens it → /login?invite=<token>. After they finish
//      signing in or signing up, AuthContext detects the token and POSTs
//      /api/shops/invites/<token>/accept on their behalf.
//
// No SMTP / Sendgrid / Resend dependency.

export interface ShopMember {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: 'owner' | 'staff' | string;
  joinedAt: string | null;
}

export interface ShopInvite {
  token: string;
  shopId: string;
  role: string;
  expiresAt: string;
  url: string;
}

export interface InvitePreview {
  shopId: string;
  shopName: string | null;
  role: string;
  expiresAt: string;
}

export async function listShopMembers(shopId: string): Promise<ShopMember[]> {
  const r = await fetch(`/api/shops/${encodeURIComponent(shopId)}/members`, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as { members: ShopMember[] };
  return Array.isArray(j.members) ? j.members : [];
}

export async function createShopInvite(shopId: string, role: 'owner' | 'staff' = 'staff'): Promise<ShopInvite> {
  const r = await fetch(`/api/shops/${encodeURIComponent(shopId)}/invites`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `HTTP ${r.status}`);
  return (j as { invite: ShopInvite }).invite;
}

export async function removeShopMember(shopId: string, userId: string): Promise<void> {
  const r = await fetch(
    `/api/shops/${encodeURIComponent(shopId)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE', credentials: 'include' },
  );
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `HTTP ${r.status}`);
}

/** Fetch shop name + role for a not-yet-accepted invite. Public — no auth needed. */
export async function previewShopInvite(token: string): Promise<InvitePreview | null> {
  try {
    const r = await fetch(`/api/shops/invites/${encodeURIComponent(token)}`);
    if (!r.ok) return null;
    const j = (await r.json()) as { invite: InvitePreview };
    return j.invite || null;
  } catch {
    return null;
  }
}

/** Auth-required: current user joins the shop. Returns the joined shopId. */
export async function acceptShopInvite(token: string): Promise<string | null> {
  try {
    const r = await fetch(`/api/shops/invites/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      credentials: 'include',
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return null;
    return (j as { shopId?: string }).shopId || null;
  } catch {
    return null;
  }
}
