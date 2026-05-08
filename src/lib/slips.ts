import type { ShopAccount, SlipRecord } from '../types';

async function asJson<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = await r.json();
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

export async function fetchSlips(): Promise<SlipRecord[]> {
  const r = await fetch('/api/slips');
  const data = await asJson<{ slips: SlipRecord[] }>(r);
  return data.slips;
}

export async function confirmSlip(id: string, reviewedBy = 'agent'): Promise<SlipRecord> {
  const r = await fetch(`/api/slips/${encodeURIComponent(id)}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewedBy }),
  });
  const data = await asJson<{ slip: SlipRecord }>(r);
  return data.slip;
}

export async function rejectSlip(id: string, reason?: string, reviewedBy = 'agent'): Promise<SlipRecord> {
  const r = await fetch(`/api/slips/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason, reviewedBy }),
  });
  const data = await asJson<{ slip: SlipRecord }>(r);
  return data.slip;
}

export async function fetchShopAccounts(): Promise<ShopAccount[]> {
  const r = await fetch('/api/shop-accounts');
  const data = await asJson<{ accounts: ShopAccount[] }>(r);
  return data.accounts;
}

export async function createShopAccount(input: {
  bank: string;
  accountNo: string;
  accountName: string;
}): Promise<ShopAccount> {
  const r = await fetch('/api/shop-accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await asJson<{ account: ShopAccount }>(r);
  return data.account;
}

export async function updateShopAccount(
  id: string,
  patch: Partial<{ bank: string; accountNo: string; accountName: string; isActive: boolean }>,
): Promise<ShopAccount> {
  const r = await fetch(`/api/shop-accounts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await asJson<{ account: ShopAccount }>(r);
  return data.account;
}

export async function deleteShopAccount(id: string): Promise<void> {
  const r = await fetch(`/api/shop-accounts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  await asJson<{ ok: true }>(r);
}

/** UI-friendly time ("HH:MM") */
export function formatSlipClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Bangkok',
  });
}
