import { useEffect, useState } from 'react';
import type { Conversation } from '../types';

/**
 * Tab-title + audible notifications for the inbox.
 *
 * State lives at MODULE level, not in a useRef, so it survives navigating
 * away from <InboxView /> and back. (Earlier version reset the seen-counts
 * on every remount, which made the first customer message after switching
 * tabs silent.)
 *
 * Approach:
 *   - `lastSeen`: per-conversation customer-message count from the previous
 *     render. Used to detect "a new message arrived" (dings).
 *   - `acked`: customer-message count at the moment the user last had that
 *     conversation open (activeId === c.id). Drives the title badge —
 *     anything past this count is "unread."
 *   - On the very first hook fire (per browser tab), every existing
 *     conversation is treated as already-read so the badge doesn't open
 *     with a huge count for chats the user already looked at before.
 *
 * Web Audio requires a user gesture before audio plays. We keep the
 * pointer/key/touch listeners armed for the lifetime of the tab and
 * call `ctx.resume()` on every gesture — that way long-idle tabs whose
 * audio context drifted back to "suspended" wake up before the next ding.
 */

const BASE_TITLE_KEY = '__chatzBaseTitle__';
const MUTE_KEY = 'chatz-mute-sound';

const lastSeen = new Map<string, number>();
const acked = new Map<string, number>();
let initialAckDone = false;

function getBaseTitle(): string {
  const w = window as unknown as Record<string, string>;
  if (typeof w[BASE_TITLE_KEY] !== 'string') {
    w[BASE_TITLE_KEY] = document.title || 'Chatz';
  }
  return w[BASE_TITLE_KEY];
}

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean) {
  try {
    if (muted) localStorage.setItem(MUTE_KEY, '1');
    else localStorage.removeItem(MUTE_KEY);
  } catch {
    /* ignore */
  }
}

// ─── Audio plumbing ───────────────────────────────────────────────────────────

let sharedCtx: AudioContext | null = null;
let unlockInstalled = false;

function getCtx(): AudioContext | null {
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!sharedCtx) {
    try {
      sharedCtx = new AC();
    } catch {
      return null;
    }
  }
  return sharedCtx;
}

/**
 * Keep audio armed for the lifetime of the tab. Every pointerdown / keydown /
 * touchstart resumes the context if it has drifted to "suspended" (some
 * browsers do this aggressively to save battery on idle tabs). We do NOT
 * remove the listeners after the first hit; the cost is one no-op call per
 * gesture, which is negligible.
 */
function installAudioUnlock() {
  if (unlockInstalled) return;
  unlockInstalled = true;
  const wake = () => {
    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
  };
  window.addEventListener('pointerdown', wake, true);
  window.addEventListener('keydown', wake, true);
  window.addEventListener('touchstart', wake, true);
  // Also wake when the tab regains visibility — common case for "I was in
  // another tab, came back, expected the next ding to work."
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wake();
  });
}

/** Public: play the standard ding once. Used by the auto-trigger and the
 *  "test sound" bell button. */
export function playNotification() {
  if (isMuted()) return;
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    // Best-effort resume — works after the gesture-unlock pass.
    void ctx.resume();
  }
  try {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    // Two-tone soft ding ~140ms.
    o.type = 'sine';
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.12);
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.18);
  } catch {
    /* node creation can throw if the context is closed; just skip */
  }
}

// ─── React hook ───────────────────────────────────────────────────────────────

function customerMessageCount(c: Conversation): number {
  let n = 0;
  for (const m of c.messages) if (m.sender === 'customer') n++;
  return n;
}

function ensureInitialAck(conversations: Conversation[]) {
  if (initialAckDone) return;
  // Wait for the first non-empty payload — otherwise we'd flip the "initial"
  // flag while still empty, and the first conv that arrives later would be
  // treated as a "new arrival" and ding on app load.
  if (conversations.length === 0) return;
  for (const c of conversations) {
    const n = customerMessageCount(c);
    acked.set(c.id, n);
    lastSeen.set(c.id, n);
  }
  initialAckDone = true;
}

export function useInboxNotifications(conversations: Conversation[], activeId: string) {
  // Compute unread for the title badge from per-conversation acks. Recompute
  // here (not in a useMemo) so the title stays in sync when conversations
  // OR activeId changes.
  useEffect(() => {
    installAudioUnlock();
    ensureInitialAck(conversations);

    let newArrival = false;

    for (const c of conversations) {
      const cur = customerMessageCount(c);
      const prev = lastSeen.get(c.id);
      if (initialAckDone) {
        // New conversation (never seen) with at least one customer message,
        // or an existing conversation whose count went up.
        if (prev === undefined && cur > 0) newArrival = true;
        else if (prev !== undefined && cur > prev) newArrival = true;
      }
      lastSeen.set(c.id, cur);
      // Looking at this chat right now → instantly ack any new arrivals
      // so the badge doesn't flash up only to immediately drop back.
      if (c.id === activeId) acked.set(c.id, cur);
    }

    // Drop ids that disappeared so the maps don't grow without bound.
    for (const id of Array.from(lastSeen.keys())) {
      if (!conversations.some((c) => c.id === id)) {
        lastSeen.delete(id);
        acked.delete(id);
      }
    }

    if (newArrival) playNotification();

    // Recompute total "unseen" for the title prefix.
    let totalUnseen = 0;
    for (const c of conversations) {
      const cur = customerMessageCount(c);
      const ack = acked.get(c.id) ?? cur; // unknown → already-seen
      const diff = cur - ack;
      if (diff > 0) totalUnseen += diff;
    }
    const base = getBaseTitle();
    document.title = totalUnseen > 0 ? `(${totalUnseen}) ${base}` : base;
  }, [conversations, activeId]);

  // On unmount of the very last consumer, reset the title. We can't tell
  // "last consumer" cheaply, so just leave the prefix — when the user signs
  // back in, ensureInitialAck flips counts back to zero anyway.
}

/** External React hook for the mute toggle UI. */
export function useMutedState(): [boolean, (v: boolean) => void] {
  const [muted, setMutedLocal] = useState<boolean>(isMuted);
  const set = (v: boolean) => {
    setMuted(v);
    setMutedLocal(v);
  };
  return [muted, set];
}
