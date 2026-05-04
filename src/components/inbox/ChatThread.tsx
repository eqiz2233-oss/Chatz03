import { useEffect, useMemo, useRef, useState } from 'react';
import type { Conversation, Message } from '../../types';
import { ChannelIcon, I } from '../Icons';
import { SlipCard } from './SlipCard';
import { useAppPreferences } from '../../context/AppPreferencesContext';

interface Props {
  conversation: Conversation;
  onSend: (text: string, sender: 'agent' | 'ai') => void | Promise<void>;
  onPinMessage: (messageId: string | null) => void;
}

export function ChatThread({ conversation, onSend, onPinMessage }: Props) {
  const { t } = useAppPreferences();
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const quickReplies = useMemo(() => [t('chat.q1'), t('chat.q2'), t('chat.q3'), t('chat.q4')], [t]);

  const pinnedMessage = useMemo(() => {
    const id = conversation.pinnedMessageId;
    if (!id) return null;
    return conversation.messages.find((m) => m.id === id) ?? null;
  }, [conversation.pinnedMessageId, conversation.messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [conversation.id, conversation.messages.length]);

  const scrollToMessageAnchor = (messageId: string) => {
    const root = scrollRef.current;
    if (!root) return;
    const el = root.querySelector(`[data-message-anchor="${messageId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  useEffect(() => {
    if (!openMenuId) return;
    const close = (ev: PointerEvent) => {
      const el = ev.target as HTMLElement;
      if (el.closest('[data-msg-actions]')) return;
      setOpenMenuId(null);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [openMenuId]);

  const send = async () => {
    if (!text.trim()) return;
    const payload = text;
    try {
      await Promise.resolve(onSend(payload, 'agent'));
      setText('');
    } catch {
      /* keep draft; LINE send errors surface via alert in parent */
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3">
          <img src={conversation.avatar} className="h-10 w-10 rounded-full bg-slate-100 dark:bg-slate-800" alt="" />
          <div>
            <div className="flex items-center gap-2">
              <div className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">{conversation.customerName}</div>
              <ChannelIcon channel={conversation.channel} className="h-4 w-4" />
              {conversation.online && (
                <span className="chip bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {t('chat.online')}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className="btn-secondary text-xs">
            <I.Tag className="h-3.5 w-3.5" />
            {t('chat.tag')}
          </button>
          <button type="button" className="btn-secondary text-xs">
            <I.Box className="h-3.5 w-3.5" />
            {t('chat.createOrder')}
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-3xl space-y-3">
          {pinnedMessage && (
            <PinnedBanner
              message={pinnedMessage}
              onJump={() => scrollToMessageAnchor(pinnedMessage.id)}
              onUnpin={() => {
                onPinMessage(null);
                setOpenMenuId(null);
              }}
              t={t}
            />
          )}
          <div className="flex justify-center">
            <span className="rounded-full bg-slate-200/60 px-3 py-1 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">{t('chat.today')}</span>
          </div>
          {conversation.messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              avatar={conversation.avatar}
              isPinned={m.id === conversation.pinnedMessageId}
              onPin={() => {
                onPinMessage(m.id);
                setOpenMenuId(null);
              }}
              onUnpin={() => {
                onPinMessage(null);
                setOpenMenuId(null);
              }}
              openMenuId={openMenuId}
              setOpenMenuId={setOpenMenuId}
              t={t}
            />
          ))}
        </div>
      </div>

      <div className="border-t border-slate-200 bg-white px-6 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto max-w-3xl">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {quickReplies.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setText(q)}
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:border-brand-300 hover:text-brand-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-brand-500 dark:hover:text-brand-300"
              >
                {q}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-white p-2 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:focus-within:border-brand-500 dark:focus-within:ring-brand-900/40">
            <button type="button" className="btn-ghost p-1.5">
              <I.Image className="h-4 w-4" />
            </button>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={t('chat.placeholder')}
              rows={1}
              className="min-w-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm text-slate-900 focus:outline-none dark:text-slate-100"
            />
            <button type="button" onClick={() => void send()} className="btn-primary text-xs">
              <I.Send className="h-4 w-4" /> {t('chat.send')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type TFn = (key: string, vars?: Record<string, string | number>) => string;

function PinnedBanner({
  message,
  onJump,
  onUnpin,
  t,
}: {
  message: Message;
  onJump: () => void;
  onUnpin: () => void;
  t: TFn;
}) {
  const raw =
    message.text?.replace(/\s+/g, ' ').trim() ||
    (message.image ? `[${t('chat.pinnedMedia')}]` : message.video ? `[${t('chat.pinnedVideo')}]` : '…');

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t('chat.jumpToMessage')}
      className="sticky top-0 z-10 cursor-pointer rounded-lg border border-amber-200/90 bg-amber-50/95 px-2.5 py-1 shadow-sm backdrop-blur-sm transition hover:bg-amber-100/90 dark:border-amber-900/50 dark:bg-amber-950/90 dark:hover:bg-amber-900/80"
      onClick={onJump}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onJump();
        }
      }}
    >
      <div className="flex items-stretch gap-1.5">
        <div className="flex w-6 shrink-0 flex-col items-center gap-0.5 self-start pt-0.5">
          <div className="grid h-6 w-6 place-items-center rounded-md bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
            <I.Pin className="h-3.5 w-3.5" />
          </div>
          <span className="text-center text-xs tabular-nums leading-none text-amber-900/80 dark:text-amber-200/85">{message.at}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 truncate text-sm font-semibold leading-tight text-amber-900 dark:text-amber-100">{t('chat.pinnedBanner')}</div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onUnpin();
              }}
              className="shrink-0 rounded-md border border-amber-300/80 bg-white/80 px-2 py-0.5 text-xs font-medium text-amber-900 hover:bg-white dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-100 dark:hover:bg-amber-900/70"
            >
              {t('chat.unpinChat')}
            </button>
          </div>
          <p className="mt-0.5 line-clamp-2 text-sm leading-snug text-amber-950 dark:text-amber-50">{raw}</p>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  avatar,
  isPinned,
  onPin,
  onUnpin,
  openMenuId,
  setOpenMenuId,
  t,
}: {
  message: Message;
  avatar: string;
  isPinned: boolean;
  onPin: () => void;
  onUnpin: () => void;
  openMenuId: string | null;
  setOpenMenuId: (id: string | null) => void;
  t: TFn;
}) {
  const isCustomer = message.sender === 'customer';
  const isAI = message.sender === 'ai';
  const menuOpen = openMenuId === message.id;

  const menu = (
    <div className={'relative shrink-0 ' + (isCustomer ? 'order-3' : 'order-1')} data-msg-actions>
      <button
        type="button"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          setOpenMenuId(menuOpen ? null : message.id);
        }}
        className="rounded-lg p-1 text-slate-400 opacity-80 hover:bg-slate-200/80 hover:text-slate-700 group-hover/message:opacity-100 dark:hover:bg-slate-700 dark:hover:text-slate-200 md:opacity-0 md:transition-opacity"
      >
        <I.MoreVertical className="h-4 w-4" />
      </button>
      {menuOpen && (
        <ul
          role="menu"
          className="absolute bottom-full z-20 mb-1 min-w-[9.5rem] rounded-lg border border-slate-200 bg-white py-1 text-left text-xs shadow-lg dark:border-slate-600 dark:bg-slate-800"
          style={isCustomer ? { left: 0 } : { right: 0 }}
        >
          <li>
            <button
              type="button"
              role="menuitem"
              className="flex w-full px-3 py-2 text-left text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700/80"
              onClick={() => (isPinned ? onUnpin() : onPin())}
            >
              {isPinned ? t('chat.unpinChat') : t('chat.pinChat')}
            </button>
          </li>
        </ul>
      )}
    </div>
  );

  const bubbleColumn = (
    <div className={'flex max-w-[75%] flex-col ' + (isCustomer ? 'items-start' : 'items-end') + ' ' + (isCustomer ? 'order-2' : 'order-2')}>
      {message.text && (
        <div
          className={
            'whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm shadow-sm ' +
            (isCustomer
              ? 'rounded-bl-sm bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-100'
              : isAI
                ? 'rounded-br-sm bg-gradient-to-br from-brand-600 to-fuchsia-600 text-white'
                : 'rounded-br-sm bg-slate-900 text-white dark:bg-slate-700')
          }
        >
          {message.text}
        </div>
      )}
      {message.video && /^https?:\/\//i.test(message.video) && (
        <div
          className={
            'mt-1 overflow-hidden rounded-2xl border border-slate-200 shadow-sm dark:border-slate-600 ' +
            (isCustomer ? 'rounded-bl-sm' : 'rounded-br-sm')
          }
        >
          <video
            src={message.video}
            poster={message.image && /^https?:\/\//i.test(message.image) ? message.image : undefined}
            controls
            className="max-h-64 max-w-full"
            playsInline
            preload="metadata"
          />
        </div>
      )}
      {message.image && /^https?:\/\//i.test(message.image) && !message.video && (
        <div
          className={
            'mt-1 overflow-hidden rounded-2xl border border-slate-200 shadow-sm dark:border-slate-600 ' +
            (isCustomer ? 'rounded-bl-sm' : 'rounded-br-sm')
          }
        >
          <img src={message.image} alt="" className="max-h-64 max-w-full object-contain" loading="lazy" />
        </div>
      )}
      {message.meta?.slip && <SlipCard slip={message.meta.slip} />}
      {message.meta?.productSuggestion && (
        <div className="mt-1 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-gradient-to-br from-pink-100 to-amber-100 text-base dark:from-pink-900/50 dark:to-amber-900/50">
            🧴
          </div>
          <div>
            <div className="font-semibold text-slate-900 dark:text-slate-100">{message.meta.productSuggestion.name}</div>
            <div className="text-slate-500 dark:text-slate-400">
              ฿{message.meta.productSuggestion.price.toLocaleString()} • {t('product.left', { n: message.meta.productSuggestion.stock })}
            </div>
          </div>
        </div>
      )}
      <div className={'mt-1 flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 ' + (isCustomer ? '' : 'justify-end')}>
        {isPinned && <span title={t('chat.pinnedBanner')}>📌</span>}
        {isAI && <span className="chip bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">AI</span>}
        <span>{message.at}</span>
      </div>
    </div>
  );

  return (
    <div
      data-message-anchor={message.id}
      className={'group/message flex animate-fade-in items-end gap-1 ' + (isCustomer ? 'justify-start' : 'justify-end')}
    >
      {isCustomer && <img src={avatar} className="order-1 h-6 w-6 shrink-0 rounded-full bg-slate-100 dark:bg-slate-800" alt="" />}
      {isCustomer ? (
        <>
          {bubbleColumn}
          {menu}
        </>
      ) : (
        <>
          {menu}
          {bubbleColumn}
          <div
            className={
              'order-3 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ' +
              (isAI ? 'bg-gradient-to-br from-brand-600 to-fuchsia-600' : 'bg-slate-700 dark:bg-slate-600')
            }
          >
            {isAI ? 'AI' : 'A'}
          </div>
        </>
      )}
    </div>
  );
}
