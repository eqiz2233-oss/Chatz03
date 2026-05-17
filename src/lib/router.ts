// Tiny client-side router — no library, just window.history + popstate.
//
// Why not React Router? For a 7-screen SPA the dependency isn't worth it.
// All we need is:
//   1. URL → View name mapping (and a default for /)
//   2. View name → URL (canonical) for sidebar clicks
//   3. A hook that keeps a React state in sync with the URL
//
// The server already serves index.html for any non-/api GET (see the
// SPA-fallback middleware in server/index.js), so /chat, /orders, /store
// all reach the SPA in both dev (Vite) and prod (express.static).

import { useEffect, useState } from 'react';
import type { View } from '../types';

/**
 * Path → View table. Multiple paths can map to the same view so we can
 * expose a memorable alias (`/chat`) alongside the canonical one (`/inbox`).
 * The first entry whose `path` matches the current location wins.
 */
const ROUTES: ReadonlyArray<{ path: string; view: View; canonical?: boolean }> = [
  { path: '/',          view: 'inbox',     canonical: false },
  { path: '/inbox',     view: 'inbox',     canonical: true },
  { path: '/chat',      view: 'inbox' },   // friendly alias
  { path: '/orders',    view: 'orders',    canonical: true },
  { path: '/store',     view: 'shop',      canonical: true },
  { path: '/shop',      view: 'shop' },    // legacy alias — keep working
  { path: '/autoreply', view: 'autoReply', canonical: true },
  { path: '/auto-reply',view: 'autoReply' },
  { path: '/analytics', view: 'analytics', canonical: true },
  { path: '/settings',  view: 'settings',  canonical: true },
];

/** View → canonical path used when the sidebar / router pushes new history. */
const VIEW_PATH: Record<View, string> = (() => {
  const map = {} as Record<View, string>;
  for (const r of ROUTES) {
    if (r.canonical) map[r.view] = r.path;
  }
  // Fallback for views the canonical table missed (e.g. legacy 'slips').
  if (!map.slips) map.slips = '/slips';
  if (!map.commission) map.commission = '/commission';
  return map;
})();

export function viewToPath(view: View): string {
  return VIEW_PATH[view] || '/';
}

export function pathToView(pathname: string): View {
  // Strip trailing slash (but keep root '/').
  const p = pathname !== '/' && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const match = ROUTES.find((r) => r.path === p);
  return match?.view || 'inbox';
}

/**
 * Two-way bind a React view-state to the URL.
 *   - Reads window.location on mount → initial view.
 *   - Listens to popstate (browser back/forward).
 *   - When the caller flips view via setView, pushes a new history entry
 *     IF the URL would change, so /inbox → /orders updates the address bar
 *     and adds to the history stack.
 *
 * Auxiliary URL params (e.g. ?invite=…, ?reset=…, ?lineConnect=…) are
 * preserved across the navigation so feature-specific handlers (AuthContext,
 * LoginView, Settings) still see them.
 */
/**
 * Pre-auth routing. Login / register / reset all live at distinct URLs so
 * the user (and the browser) can bookmark or navigate between them. Once
 * the user is logged in this hook is irrelevant — the main `useViewRoute`
 * takes over.
 *
 * We keep this separate from `useViewRoute` because the View union is for
 * post-auth screens only; mixing auth screens into it would force every
 * authenticated route check to handle "what if the view is 'login'?"
 */
export type AuthRoute = 'login' | 'register';

export function pathToAuthRoute(pathname: string): AuthRoute {
  const p = pathname !== '/' && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (p === '/register' || p === '/signup') return 'register';
  return 'login';
}

export function authRouteToPath(route: AuthRoute): string {
  return route === 'register' ? '/register' : '/login';
}

export function useAuthRoute(): [AuthRoute, (next: AuthRoute) => void] {
  const [route, setRouteState] = useState<AuthRoute>(() =>
    typeof window === 'undefined' ? 'login' : pathToAuthRoute(window.location.pathname),
  );

  useEffect(() => {
    const onPop = () => setRouteState(pathToAuthRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const setRoute = (next: AuthRoute) => {
    setRouteState(next);
    const target = authRouteToPath(next);
    const url = new URL(window.location.href);
    if (url.pathname !== target) {
      window.history.pushState({}, '', target + (url.search || '') + url.hash);
    }
  };

  return [route, setRoute];
}

export function useViewRoute(): [View, (next: View) => void] {
  const [view, setViewState] = useState<View>(() =>
    typeof window === 'undefined' ? 'inbox' : pathToView(window.location.pathname),
  );

  useEffect(() => {
    const onPop = () => setViewState(pathToView(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const setView = (next: View) => {
    setViewState(next);
    const target = viewToPath(next);
    const url = new URL(window.location.href);
    if (url.pathname !== target) {
      // Keep ?invite=, ?reset=, ?lineConnect= around — those are consumed
      // by other effects that haven't fired yet.
      window.history.pushState({}, '', target + (url.search || '') + url.hash);
    }
  };

  return [view, setView];
}
