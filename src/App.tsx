import { useCallback, useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { InboxView } from './components/inbox/InboxView';
import { OrdersView } from './components/views/OrdersView';
import { CommissionView } from './components/views/CommissionView';
import { ShopBrainView } from './components/views/ShopBrainView';
import { AutoReplyView } from './components/views/AutoReplyView';
import { AnalyticsView } from './components/views/AnalyticsView';
import { SettingsView } from './components/views/SettingsView';
import { LoginView } from './components/views/LoginView';
import { RegisterView } from './components/views/RegisterView';
import { useAuth } from './context/AuthContext';
import { useAuthRoute, useViewRoute } from './lib/router';
import type { InboxFocusRequest } from './types';

export default function App() {
  const { user, loading } = useAuth();
  // View ↔ URL is now bound — sidebar clicks push history, browser back/
  // forward work, and bookmarking /orders lands the user on Orders.
  const [view, setView] = useViewRoute();
  // Pre-auth: /login vs /register. Ignored once `user` is truthy.
  const [authRoute] = useAuthRoute();
  const [inboxFocus, setInboxFocus] = useState<InboxFocusRequest | null>(null);

  const clearInboxFocus = useCallback(() => setInboxFocus(null), []);

  // After auth succeeds, drop the user on /inbox if they're still sitting
  // on an auth URL — keeps the address bar honest and means the next
  // sidebar click doesn't try to "navigate" from /login to /orders.
  useEffect(() => {
    if (!user) return;
    const p = window.location.pathname;
    if (p === '/login' || p === '/register' || p === '/signup') {
      window.history.replaceState({}, '', '/inbox' + window.location.search + window.location.hash);
    }
  }, [user]);

  if (loading) {
    return (
      <div className="grid h-screen w-screen place-items-center bg-[#f3f1f8] text-slate-500 dark:bg-slate-950 dark:text-slate-400">
        <div className="flex items-center gap-2 text-sm">
          <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-brand-500" />
          กำลังโหลด…
        </div>
      </div>
    );
  }

  if (!user) {
    // ?reset=<token> always belongs to the login screen — the password
    // reset email points users there, and RegisterView has no place to
    // handle the token.
    const hasResetToken = new URLSearchParams(window.location.search).has('reset');
    if (authRoute === 'register' && !hasResetToken) return <RegisterView />;
    return <LoginView />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#f3f1f8] text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Sidebar active={view} onChange={setView} />
      {view === 'inbox' && (
        <InboxView focusRequest={inboxFocus} onFocusRequestConsumed={clearInboxFocus} />
      )}
      {view === 'orders' && (
        <OrdersView
          onGoToChat={(req) => {
            setInboxFocus(req);
            setView('inbox');
          }}
        />
      )}
      {view === 'shop' && <ShopBrainView />}
      {view === 'autoReply' && <AutoReplyView />}
      {view === 'commission' && <CommissionView />}
      {view === 'analytics' && <AnalyticsView />}
      {view === 'settings' && <SettingsView />}
    </div>
  );
}
