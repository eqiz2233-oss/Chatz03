import { useEffect, useMemo, useRef, useState } from 'react';
import type { Conversation } from '../types';

/**
 * Tab-title + audible notifications driven by inbox state.
 *
 *  - title: when there's at least one new customer message since you last
 *    looked, prepend `(N) ` to document.title (and restore on cleanup).
 *  - sound: a soft 880Hz "tick" plays whenever a NEW customer message
 *    arrives in any conversation. Skipped only when (the message landed in
 *    the conversation you're already viewing) AND (the tab is focused) —
 *    that's the one case where the user is already aware. Anything else
 *    plays the ding (background tab, other conversation, etc).
 *
 * The detection compares the per-conversation customer-message count
 * across renders, so it doesn't depend on a server-side `unread` field
 * being maintained (ours isn't yet).
 *
 * Web Audio requires a user gesture before the first sound, so we install
 * a one-time pointer/key listener that creates and unlocks an
 * AudioContext on the very first click/tap/keypress.
 */

const BASE_TITLE_KEY = '__chatzBaseTitle__';
const MUTE_KEY = 'chatz-mute-sound';

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
let unlocked = false;

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

/** Browsers refuse to start audio without a user gesture; arm the context the
 *  first time the user interacts with the page so the first real ding plays. */
function installAudioUnlock() {
  if (unlocked) return;
  const unlock = () => {
    if (unlocked) return;
    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    // Play a near-silent tone to fully wake the audio graph on iOS/Safari.
    try {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.01);
    } catch {
      /* ignore */
    }
    unlocked = true;
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
    window.removeEventListener('touchstart', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  window.addEventListener('touchstart', unlock, true);
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

export function useInboxNotifications(conversations: Conversation[], activeId: string) {
  /** Per-conversation customer message count from the previous render. */
  const lastCountsRef = useRef<Map<string, number>>(new Map());
  /** Skip sound on the very first paint — we don't want a ding when the
   *  initial fetch lands. */
  const primedRef = useRef(false);

  // Sum unread badges (where available) + fallback to "new messages we
  // haven't acknowledged yet" so the title badge still increments on shops
  // whose server hasn't started tracking unread.
  const titleCount = useMemo(() => {
    let total = 0;
    for (const c of conversations) {
      total += Math.max(0, c.unread || 0);
    }
    return total;
  }, [conversations]);

  // Title prefix
  useEffect(() => {
    const base = getBaseTitle();
    document.title = titleCount > 0 ? `(${titleCount}) ${base}` : base;
  }, [titleCount]);

  // Install the gesture-unlock listener once.
  useEffect(() => {
    installAudioUnlock();
  }, []);

  // Sound on new customer message arrival.
  useEffect(() => {
    const lastCounts = lastCountsRef.current;
    const isFirstPass = !primedRef.current;

    let newArrival = false;

    for (const c of conversations) {
      const n = customerMessageCount(c);
      const prev = lastCounts.get(c.id);
      if (!isFirstPass && prev !== undefined && n > prev) {
        newArrival = true;
      }
      lastCounts.set(c.id, n);
    }

    // Drop ids that disappeared so the map doesn't grow forever.
    for (const id of Array.from(lastCounts.keys())) {
      if (!conversations.some((c) => c.id === id)) lastCounts.delete(id);
    }

    primedRef.current = true;
    if (!newArrival) return;

    // Messenger-style: ding on EVERY incoming customer message, including the
    // one in the chat you're currently looking at. Mute via the bell icon if
    // it gets annoying for very active chats.
    playNotification();
  }, [conversations, activeId]);
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
