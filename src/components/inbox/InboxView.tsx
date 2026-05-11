import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { conversations as seed } from '../../data/mockData';
import type { Conversation, InboxFocusRequest, Message } from '../../types';
import { useAppPreferences } from '../../context/AppPreferencesContext';
import { useToast } from '../../context/ToastContext';
import { ConversationList } from './ConversationList';
import { ChatThread } from './ChatThread';
import { formatRelativeListTime, mapLineConversationDto, type LineConversationDto } from '../../lib/lineInbox';
import { mapFbConversationDto, type FbConversationDto } from '../../lib/fbInbox';
import { useInboxNotifications } from '../../lib/inboxNotifications';

interface LineWebhookInfo {
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  lastEventCount: number;
}

type FbWebhookInfo = LineWebhookInfo;

interface HealthJson {
  lineConfigured?: boolean;
  lineWebhook?: LineWebhookInfo;
  /** Threads that have at least one message (same as GET /api/line/conversations length). */
  lineConversationsCount?: number;
  fbConfigured?: boolean;
  fbWebhook?: FbWebhookInfo;
  fbConversationsCount?: number;
}

interface InboxViewProps {
  focusRequest?: InboxFocusRequest | null;
  onFocusRequestConsumed?: () => void;
}

export function InboxView({ focusRequest = null, onFocusRequestConsumed }: InboxViewProps) {
  const { t, locale } = useAppPreferences();
  const toast = useToast();
  const onFocusConsumedRef = useRef(onFocusRequestConsumed);
  onFocusConsumedRef.current = onFocusRequestConsumed;
  const [health, setHealth] = useState<{
    loaded: boolean;
    fetchFailed: boolean;
    lineConfigured: boolean;
    lineWebhook: LineWebhookInfo | null;
    lineConversationsCount: number;
    fbConfigured: boolean;
    fbWebhook: FbWebhookInfo | null;
    fbConversationsCount: number;
  }>({
    loaded: false,
    fetchFailed: false,
    lineConfigured: false,
    lineWebhook: null,
    lineConversationsCount: 0,
    fbConfigured: false,
    fbWebhook: null,
    fbConversationsCount: 0,
  });
  const [lineConversations, setLineConversations] = useState<Conversation[]>([]);
  const [fbConversations, setFbConversations] = useState<Conversation[]>([]);
  /** กัน merge ด้วย [] ก่อน fetch ครั้งแรกเสร็จ — ไม่งั้น seed หายแล้วหน้าว่าง */
  const [lineInboxFetched, setLineInboxFetched] = useState(false);
  const [fbInboxFetched, setFbInboxFetched] = useState(false);
  const [list, setList] = useState<Conversation[]>(seed);
  const [activeId, setActiveId] = useState(() => seed[0]?.id ?? '');
  /** ปักหมุดแชทต่อห้อง (ร้านเท่านั้น) — override ค่า pinnedMessageId จาก seed/API */
  const [pinOverrides, setPinOverrides] = useState<Record<string, string | null>>({});
  /** Tracks whether the user has drilled into a chat on mobile (< md). On
   *  desktop both panels are always visible so this flag is ignored. */
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');

  const lineBackend = health.loaded && health.lineConfigured && !health.fetchFailed;
  const fbBackend = health.loaded && health.fbConfigured && !health.fetchFailed;

  useEffect(() => {
    if (!lineBackend) setLineInboxFetched(false);
  }, [lineBackend]);

  useEffect(() => {
    if (!fbBackend) setFbInboxFetched(false);
  }, [fbBackend]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch('/api/health')
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json();
        })
        .then((h: HealthJson) => {
          if (cancelled) return;
          setHealth({
            loaded: true,
            fetchFailed: false,
            lineConfigured: Boolean(h.lineConfigured),
            lineWebhook: h.lineWebhook ?? null,
            lineConversationsCount: typeof h.lineConversationsCount === 'number' ? h.lineConversationsCount : 0,
            fbConfigured: Boolean(h.fbConfigured),
            fbWebhook: h.fbWebhook ?? null,
            fbConversationsCount: typeof h.fbConversationsCount === 'number' ? h.fbConversationsCount : 0,
          });
        })
        .catch(() => {
          if (cancelled) return;
          setHealth({
            loaded: true,
            fetchFailed: true,
            lineConfigured: false,
            lineWebhook: null,
            lineConversationsCount: 0,
            fbConfigured: false,
            fbWebhook: null,
            fbConversationsCount: 0,
          });
        });
    };
    load();
    const id = window.setInterval(load, 6000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const refetchLine = useCallback(async () => {
    if (!lineBackend) return;
    try {
      const r = await fetch('/api/line/conversations');
      const d = (await r.json()) as { conversations?: LineConversationDto[]; count?: number };
      const raw = Array.isArray(d.conversations) ? d.conversations : [];
      const mapped = raw.map((c) =>
        mapLineConversationDto(c, (iso) => formatRelativeListTime(iso, locale, t)),
      );
      setLineConversations(mapped);
    } catch {
      setLineConversations([]);
    } finally {
      setLineInboxFetched(true);
    }
  }, [lineBackend, locale, t]);

  useEffect(() => {
    if (!lineBackend) return;
    void refetchLine();
    // SSE pushes drive realtime refreshes; this interval is the safety net
    // for dropped streams (proxy timeouts, sleeping laptops, flaky wifi).
    const id = window.setInterval(() => void refetchLine(), 15000);
    return () => clearInterval(id);
  }, [lineBackend, refetchLine]);

  const refetchFb = useCallback(async () => {
    if (!fbBackend) return;
    try {
      const r = await fetch('/api/fb/conversations');
      const d = (await r.json()) as { conversations?: FbConversationDto[]; count?: number };
      const raw = Array.isArray(d.conversations) ? d.conversations : [];
      const mapped = raw.map((c) => mapFbConversationDto(c, (iso) => formatRelativeListTime(iso, locale, t)));
      setFbConversations(mapped);
    } catch {
      setFbConversations([]);
    } finally {
      setFbInboxFetched(true);
    }
  }, [fbBackend, locale, t]);

  useEffect(() => {
    if (!fbBackend) return;
    void refetchFb();
    const id = window.setInterval(() => void refetchFb(), 15000);
    return () => clearInterval(id);
  }, [fbBackend, refetchFb]);

  /**
   * Realtime push from /api/inbox/stream — any thread mutation (incoming
   * message, send, profile backfill, bot toggle) triggers a tiny SSE event;
   * we react by re-fetching whichever channels are configured. EventSource
   * reconnects automatically on drop, so we just open it once per session.
   */
  useEffect(() => {
    if (!lineBackend && !fbBackend) return;
    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/inbox/stream');
    } catch {
      return;
    }
    const onMessage = () => {
      if (lineBackend) void refetchLine();
      if (fbBackend) void refetchFb();
    };
    es.addEventListener('message', onMessage);
    return () => {
      es?.removeEventListener('message', onMessage);
      es?.close();
    };
  }, [lineBackend, fbBackend, refetchLine, refetchFb]);

  useEffect(() => {
    setList((prev) => {
      let next = prev;
      /** แทนที่ seed เฉพาะเมื่อ API มีรายการ — ถ้า [] ยังใช้ seed ต่อ (กัน race FB ว่างก่อนแล้วตัด ig/fb พอ LINE ว่างทีหลังจน list หายหมด) */
      if (lineBackend && lineInboxFetched && lineConversations.length > 0) {
        const nonLine = next.filter((c) => c.channel !== 'line');
        next = [...lineConversations, ...nonLine];
      }
      if (fbBackend && fbInboxFetched && fbConversations.length > 0) {
        const nonMeta = next.filter((c) => c.channel !== 'facebook' && c.channel !== 'ig');
        next = [...fbConversations, ...nonMeta];
      }
      if (next.length === 0 && prev.length > 0) return prev;
      return next;
    });
  }, [lineBackend, lineInboxFetched, lineConversations, fbBackend, fbInboxFetched, fbConversations]);

  useEffect(() => {
    if (!list.length) {
      setActiveId('');
      return;
    }
    if (!list.some((c) => c.id === activeId)) {
      setActiveId(list[0].id);
    }
  }, [list, activeId]);

  useEffect(() => {
    if (!focusRequest) return undefined;

    const { conversationId, customer, channel } = focusRequest;
    const cu = customer.trim();

    const matchByCustomer = () =>
      list.find((c) => {
        if (c.channel !== channel) return false;
        const name = c.customerName.trim();
        if (name === cu || name.startsWith(cu)) return true;
        const head = name.split(/[|│]/)[0].trim();
        if (head === cu || head.startsWith(cu) || cu.startsWith(head)) return true;
        return cu.length >= 2 && name.includes(cu);
      });

    let nextId: string | null =
      conversationId && list.some((c) => c.id === conversationId) ? conversationId : null;
    if (!nextId) nextId = matchByCustomer()?.id ?? null;

    if (nextId) {
      setActiveId(nextId);
      // When coming in from Orders → "ไปที่แชท", drill into the chat panel on
      // mobile too so the user doesn't have to tap a second time.
      setMobileView('chat');
      onFocusConsumedRef.current?.();
      return undefined;
    }

    const hasRemoteLine = list.some((c) => c.id.startsWith('line:'));
    if (channel === 'line' && lineBackend && !hasRemoteLine) {
      const tid = window.setTimeout(() => {
        toast.error(t('orders.chatNotFound'));
        onFocusConsumedRef.current?.();
      }, 12000);
      return () => clearTimeout(tid);
    }

    toast.error(t('orders.chatNotFound'));
    onFocusConsumedRef.current?.();
    return undefined;
  }, [focusRequest, list, lineBackend, t, toast]);

  const active = useMemo(() => {
    if (!list.length) return null;
    return list.find((c) => c.id === activeId) ?? list[0];
  }, [list, activeId]);

  /** Drives the (N) prefix on the tab title and the soft ding when a new
   * customer message lands. Detection is based on per-conversation message
   * counts, so it works even before the server starts tracking `unread`. */
  useInboxNotifications(list, activeId);

  /**
   * J/K keyboard navigation — like Gmail/Linear. Ignored while the user is
   * typing in an input/textarea/contenteditable so it never eats keystrokes
   * inside the chat reply box or the search field.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase() || '';
      const editable = (e.target as HTMLElement | null)?.isContentEditable;
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || editable) return;
      if (list.length === 0) return;
      const i = list.findIndex((c) => c.id === activeId);
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = list[(i === -1 ? 0 : i + 1) % list.length];
        if (next) setActiveId(next.id);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = list[(i <= 0 ? list.length : i) - 1];
        if (prev) setActiveId(prev.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [list, activeId]);

  const conversationForThread = useMemo(() => {
    if (!active) return null;
    const pinned = Object.prototype.hasOwnProperty.call(pinOverrides, active.id) ? pinOverrides[active.id] : (active.pinnedMessageId ?? null);
    return { ...active, pinnedMessageId: pinned };
  }, [active, pinOverrides]);

  const handlePinMessage = useCallback(
    (messageId: string | null) => {
      if (!active) return;
      setPinOverrides((prev) => ({ ...prev, [active.id]: messageId }));
    },
    [active],
  );

  const handleToggleBot = useCallback(
    async (next: boolean) => {
      if (!active) return;
      const id = active.id;
      // Optimistic: flip locally first so the switch feels instant.
      setList((prev) => prev.map((c) => (c.id === id ? { ...c, botEnabled: next } : c)));
      try {
        const r = await fetch('/api/bot/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: id, enabled: next }),
        });
        if (!r.ok) throw new Error(String(r.status));
      } catch {
        // Roll back on failure.
        setList((prev) => prev.map((c) => (c.id === id ? { ...c, botEnabled: !next } : c)));
        toast.error(t('chat.botToggleFailed'));
      }
    },
    [active, t, toast],
  );

  const notice = useMemo(() => {
    if (!health.loaded) return null;
    if (health.fetchFailed) return t('inbox.lineApiUnreachable');
    if (!health.lineConfigured && !health.fbConfigured) return t('inbox.lineSecretMissing');
    if (health.lineWebhook?.lastError) return t('inbox.lineWebhookErr', { msg: health.lineWebhook.lastError });
    if (health.fbWebhook?.lastError) return t('inbox.fbWebhookErr', { msg: health.fbWebhook.lastError });
    return null;
  }, [health, lineBackend, fbBackend, t]);

  const handleSend = async (text: string, sender: 'agent' | 'ai') => {
    if (!active) return;

    const isLine = active.id.startsWith('line:');
    const isMeta = active.id.startsWith('fb:') || active.id.startsWith('ig:');
    if (isLine || isMeta) {
      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: active.id, text, asAi: sender === 'ai' }),
      });
      let errMsg = '';
      try {
        const data = (await res.json()) as { error?: string };
        if (!res.ok) errMsg = data?.error || res.statusText;
      } catch {
        if (!res.ok) errMsg = res.statusText;
      }
      if (!res.ok) {
        toast.error(errMsg || (isLine ? t('chat.sendFailed') : t('chat.fbSendFailed')));
        throw new Error(errMsg || 'send failed');
      }
      if (isLine) await refetchLine();
      else await refetchFb();
      return;
    }

    const now = new Date();
    const at = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const newMsg: Message = { id: 'm' + Date.now(), text, sender, at };
    setList((prev) =>
      prev.map((c) =>
        c.id === activeId ? { ...c, messages: [...c.messages, newMsg], lastSnippet: text, lastAt: t('inbox.justNow'), unread: 0 } : c,
      ),
    );
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {notice && (
        <div
          role="status"
          className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100"
        >
          {notice}
        </div>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <ConversationList
          conversations={list}
          activeId={activeId}
          onSelect={(id) => {
            setActiveId(id);
            setMobileView('chat');
          }}
          loading={
            // Either backend is configured + we haven't received first payload yet,
            // and we have no items to show — that's the only moment the user
            // actually waits. After first paint, polling/SSE updates are silent.
            (lineBackend && !lineInboxFetched) ||
            (fbBackend && !fbInboxFetched)
          }
          hiddenOnMobile={mobileView === 'chat'}
        />
        {conversationForThread ? (
          <div className={'flex min-h-0 min-w-0 flex-1 ' + (mobileView === 'chat' ? 'flex' : 'hidden md:flex')}>
            <ChatThread
              conversation={conversationForThread}
              onSend={handleSend}
              onPinMessage={handlePinMessage}
              onToggleBot={handleToggleBot}
              onBack={() => setMobileView('list')}
            />
          </div>
        ) : (
          <div className="hidden min-h-0 min-w-0 flex-1 flex-col items-center justify-center bg-[#f5f4fa] px-6 text-center text-sm text-slate-500 dark:bg-slate-950/80 dark:text-slate-400 md:flex">
            {t('inbox.empty')}
          </div>
        )}
      </div>
    </div>
  );
}
