import { useEffect, useRef } from 'react';

/**
 * Tab-title + audible notifications driven by the inbox unread total.
 *
 *  - title: when unread > 0, prepend `(N) ` to document.title (and restore on
 *    cleanup). Stays in sync as the badge changes; no flicker because we only
 *    write when the prefix actually changes.
 *  - sound: a soft 880Hz "tick" plays whenever the unread total *increases*,
 *    skipping the very first render and any growth while the user is actively
 *    looking at the tab (document.visibilityState === 'visible' AND focused).
 *    We use Web Audio so there's no audio asset to bundle/load.
 *
 * The mute toggle is read from localStorage at every potential play so the
 * SettingsView (or any other surface) can flip it without re-mounting the hook.
 */

const BASE_TITLE_KEY = '__chatzBaseTitle__';
const MUTE_KEY = 'chatz-mute-sound';

function getBaseTitle(): string {
  // Capture the original page title once per session so badges don't double-prefix.
  const w = window as unknown as Record<string, string>;
  if (typeof w[BASE_TITLE_KEY] !== 'string') {
    w[BASE_TITLE_KEY] = document.title || 'Chatz';
  }
  return w[BASE_TITLE_KEY];
}

function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function playTick() {
  if (isMuted()) return;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  try {
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    // Soft two-tone ding — high then a touch lower, ~120ms total.
    o.type = 'sine';
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.12);
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.16);
    // Close the context shortly after so we don't leak audio nodes.
    setTimeout(() => void ctx.close(), 250);
  } catch {
    /* audio not allowed yet (no user gesture); silently ignore */
  }
}

export function useInboxNotifications(totalUnread: number) {
  const previousRef = useRef<number | null>(null);

  // Title prefix
  useEffect(() => {
    const base = getBaseTitle();
    document.title = totalUnread > 0 ? `(${totalUnread}) ${base}` : base;
  }, [totalUnread]);

  // Sound on increase, but only when the user isn't actively looking
  useEffect(() => {
    const prev = previousRef.current;
    previousRef.current = totalUnread;
    if (prev === null) return; // skip first render
    if (totalUnread <= prev) return;
    const focused = document.hasFocus() && document.visibilityState === 'visible';
    if (focused) return; // user is already on the tab — no ding
    playTick();
  }, [totalUnread]);
}

export function getSoundMuted(): boolean {
  return isMuted();
}

export function setSoundMuted(muted: boolean) {
  try {
    if (muted) localStorage.setItem(MUTE_KEY, '1');
    else localStorage.removeItem(MUTE_KEY);
  } catch {
    /* ignore */
  }
}
