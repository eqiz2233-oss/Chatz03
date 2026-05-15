import { useCallback, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { InboxView } from './components/inbox/InboxView';
import { OrdersView } from './components/views/OrdersView';
import { CommissionView } from './components/views/CommissionView';
import { ShopBrainView } from './components/views/ShopBrainView';
import { AutoReplyView } from './components/views/AutoReplyView';
import { AnalyticsView } from './components/views/AnalyticsView';
import { SettingsView } from './components/views/SettingsView';
import { LoginView } from './components/views/LoginView';
import { useAuth } from './context/AuthContext';
import type { InboxFocusRequest, View } from './types';

export default function App() {
  const { user, loading } = useAuth();
  const [view, setView] = useState<View>('inbox');
  const [inboxFocus, setInboxFocus] = useState<InboxFocusRequest | null>(null);

  const clearInboxFocus = useCallback(() => setInboxFocus(null), []);

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
