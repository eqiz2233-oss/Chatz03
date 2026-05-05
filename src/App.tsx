import { useCallback, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { InboxView } from './components/inbox/InboxView';
import { OrdersView } from './components/views/OrdersView';
import { SlipsView } from './components/views/SlipsView';
import { CommissionView } from './components/views/CommissionView';
import { ShopBrainView } from './components/views/ShopBrainView';
import { AnalyticsView } from './components/views/AnalyticsView';
import { SettingsView } from './components/views/SettingsView';
import type { InboxFocusRequest, View } from './types';

export default function App() {
  const [view, setView] = useState<View>('inbox');
  const [inboxFocus, setInboxFocus] = useState<InboxFocusRequest | null>(null);

  const clearInboxFocus = useCallback(() => setInboxFocus(null), []);

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
      {view === 'slips' && <SlipsView />}
      {view === 'shop' && <ShopBrainView />}
      {view === 'commission' && <CommissionView />}
      {view === 'analytics' && <AnalyticsView />}
      {view === 'settings' && <SettingsView />}
    </div>
  );
}
