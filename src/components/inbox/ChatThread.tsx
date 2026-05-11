import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Conversation, Message } from '../../types';
import { ChannelIcon, I } from '../Icons';
import { SlipCard } from './SlipCard';
import { useAppPreferences } from '../../context/AppPreferencesContext';
import {
  addQuickReply,
  getQuickReplies,
  removeQuickReply,
  QUICK_REPLY_MAX_LENGTH,
  type QuickReply,
} from '../../lib/quickReplies';
import {
  addTag,
  getCustomerMeta,
  removeTag,
  setNote,
  TAG_MAX_LEN,
  NOTE_MAX_LEN,
  type CustomerMeta,
} from '../../lib/customerNotes';

interface Props {
  conversation: Conversation;
  onSend: (text: string, sender: 'agent' | 'ai') => void | Promise<void>;
  onPinMessage: (messageId: string | null) => void;
  onToggleBot?: (enabled: boolean) => void | Promise<void>;
  /** Mobile-only back action — when set, a chevron appears in the header. */
  onBack?: () => void;
}

type ChatMediaPreview = { type: 'image' | 'video'; src: string; poster?: string };

function ChatMediaLightbox({
  item,
  onClose,
  t,
}: {
  item: ChatMediaPreview;
  onClose: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.type === 'image' ? t('chat.pinnedMedia') : t('chat.pinnedVideo')}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/88 p-4 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <button
        type="button"
        className="absolute right-3 top-3 z-[201] grid h-11 w-11 place-items-center rounded-full bg-white/12 text-white ring-1 ring-white/35 transition hover:bg-white/22"
        aria-label={t('chat.closeMedia')}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <I.X className="h-6 w-6" />
      </button>
      <div
        className="flex max-h-[min(92vh,calc(100dvh-2rem))] max-w-[min(96vw,calc(100dvw-2rem))] items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {item.type === 'image' ? (
          <img src={item.src} alt="" className="max-h-[min(92vh,calc(100dvh-2rem))] max-w-full object-contain shadow-2xl" />
        ) : (
          <video
            key={item.src}
            src={item.src}
            poster={item.poster}
            controls
            playsInline
            preload="metadata"
            className="max-h-[min(92vh,calc(100dvh-2rem))] max-w-full rounded-lg bg-black shadow-2xl"
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

export function ChatThread({ conversation, onSend, onPinMessage, onToggleBot, onBack }: Props) {
  const { t } = useAppPreferences();
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [mediaLightbox, setMediaLightbox] = useState<ChatMediaPreview | null>(null);
  const botEnabled = conversation.botEnabled !== false;

  // Default replies stay as locked pills (you can't break the inbox by deleting
  // every preset). Custom ones come from localStorage and can be removed.
  const defaultReplies = useMemo(
    () => [t('chat.q1'), t('chat.q2'), t('chat.q3'), t('chat.q4')],
    [t],
  );
  const [customReplies, setCustomReplies] = useState<QuickReply[]>(() => getQuickReplies());
  const [qrEditing, setQrEditing] = useState(false);
  const [qrDraft, setQrDraft] = useState('');

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
    <>
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-white dark:bg-slate-900">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200/90 px-4 py-3 dark:border-slate-800 sm:gap-3 sm:px-5 sm:py-3.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label={t('chat.back')}
              className="-ml-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200 md:hidden"
            >
              <I.ChevronLeft className="h-5 w-5" />
            </button>
          )}
          <img src={conversation.avatar} className="h-11 w-11 shrink-0 rounded-full bg-slate-100 ring-2 ring-slate-100 dark:bg-slate-800 dark:ring-slate-800" alt="" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[16px] font-semibold text-slate-900 dark:text-slate-50">{conversation.customerName}</h1>
              <ChannelIcon channel={conversation.channel} className="h-4 w-4 shrink-0" />
              {conversation.online && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {t('chat.online')}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-1 sm:w-auto sm:justify-end">
          {onToggleBot && (
            <BotToggle
              enabled={botEnabled}
              onChange={(next) => void onToggleBot(next)}
              t={t}
            />
          )}
          {/*
            Phone / Video / "more" buttons removed for now — they were
            placeholders with no handlers, which read as broken on first use.
            Bring them back when voice/video infra is in place.
          */}
        </div>
      </header>

      {!botEnabled && (
        <div className="w-full shrink-0 border-b border-amber-200/80 bg-amber-50 px-4 py-2 text-[12px] text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-amber-500" />
          {t('chat.botOffBanner')}
        </div>
      )}

      <CustomerTagsBar conversationId={conversation.id} t={t} />

      {pinnedMessage && (
        <div className="w-full shrink-0 border-b border-slate-300/90 dark:border-slate-700/90">
          <PinnedBanner
            message={pinnedMessage}
            onJump={() => scrollToMessageAnchor(pinnedMessage.id)}
            onUnpin={() => {
              onPinMessage(null);
              setOpenMenuId(null);
            }}
            t={t}
          />
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-[#f5f4fa] px-4 py-5 dark:bg-slate-950/80 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-3">
          <div className="flex justify-center py-1">
            <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] font-medium text-slate-500 shadow-sm dark:bg-slate-800/90 dark:text-slate-400">
              {t('chat.today')}
            </span>
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
              onOpenMedia={setMediaLightbox}
              t={t}
            />
          ))}
        </div>
      </div>

      <footer className="shrink-0 border-t border-slate-200/90 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {defaultReplies.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setText(q)}
                className="rounded-full border border-slate-200/90 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-brand-300 hover:bg-white hover:text-brand-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-brand-500"
              >
                {q}
              </button>
            ))}
            {customReplies.map((q) => (
              <span
                key={q.id}
                className="group relative inline-flex items-stretch"
              >
                <button
                  type="button"
                  onClick={() => setText(q.text)}
                  className="rounded-full border border-brand-200 bg-brand-50/60 px-3 py-1 pr-7 text-xs font-medium text-brand-700 transition hover:border-brand-300 hover:bg-white dark:border-brand-700/60 dark:bg-brand-950/40 dark:text-brand-200 dark:hover:border-brand-500"
                  title={q.text}
                >
                  {q.text.length > 28 ? q.text.slice(0, 28) + '…' : q.text}
                </button>
                <button
                  type="button"
                  onClick={() => setCustomReplies(removeQuickReply(q.id))}
                  aria-label={t('chat.qrRemove')}
                  className="absolute right-1.5 top-1/2 grid h-4 w-4 -translate-y-1/2 place-items-center rounded-full text-brand-600/50 opacity-0 transition hover:bg-brand-100 hover:text-brand-700 group-hover:opacity-100 dark:text-brand-300/60 dark:hover:bg-brand-900/60 dark:hover:text-brand-100"
                >
                  <I.X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {qrEditing ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-brand-300 bg-white px-2 py-0.5 shadow-sm dark:border-brand-500 dark:bg-slate-900">
                <input
                  autoFocus
                  type="text"
                  value={qrDraft}
                  maxLength={QUICK_REPLY_MAX_LENGTH}
                  onChange={(e) => setQrDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const text = qrDraft.trim();
                      if (text) setCustomReplies(addQuickReply(text));
                      setQrDraft('');
                      setQrEditing(false);
                    } else if (e.key === 'Escape') {
                      // Bail without saving — match Esc semantics elsewhere
                      // in the app (filters, modals).
                      e.preventDefault();
                      setQrDraft('');
                      setQrEditing(false);
                    }
                  }}
                  onBlur={() => {
                    // Click-outside should commit, not discard. The user
                    // already typed a phrase; throwing it away on a stray
                    // click is the kind of papercut that erodes trust.
                    const text = qrDraft.trim();
                    if (text) setCustomReplies(addQuickReply(text));
                    setQrDraft('');
                    setQrEditing(false);
                  }}
                  placeholder={t('chat.qrAddPlaceholder')}
                  className="w-44 bg-transparent text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={() => {
                    const text = qrDraft.trim();
                    if (text) setCustomReplies(addQuickReply(text));
                    setQrDraft('');
                    setQrEditing(false);
                  }}
                  className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-400"
                >
                  {t('chat.qrAddSave')}
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setQrEditing(true)}
                title={t('chat.qrAddTitle')}
                aria-label={t('chat.qrAddTitle')}
                className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:border-brand-400 hover:text-brand-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-brand-500 dark:hover:text-brand-300"
              >
                <I.Plus className="h-3 w-3" />
                {t('chat.qrAdd')}
              </button>
            )}
          </div>
          <div className="flex items-end gap-2 rounded-2xl border border-slate-200/90 bg-slate-50/90 px-3 py-1.5 shadow-sm focus-within:border-brand-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-100 dark:border-slate-600 dark:bg-slate-800/80 dark:focus-within:border-brand-500 dark:focus-within:bg-slate-900 dark:focus-within:ring-brand-900/30">
            {/*
              Attach / Emoji / Voice buttons were placeholders with no
              handlers. Removed for now; bring them back as a unit when the
              file upload + emoji picker + voice message infra is in place.
            */}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={t('chat.writeMessage')}
              rows={1}
              className="max-h-32 min-h-[40px] min-w-0 flex-1 resize-none bg-transparent px-1 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
            />
            <div className="flex shrink-0 items-center gap-0.5 pb-0.5">
              <button
                type="button"
                onClick={() => void send()}
                disabled={!text.trim()}
                className="ml-1 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-600 text-white shadow-sm transition hover:bg-brand-700 active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:hover:bg-slate-300 dark:bg-brand-500 dark:hover:bg-brand-400 dark:disabled:bg-slate-700"
                aria-label={t('chat.send')}
              >
                <I.Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
    {mediaLightbox && <ChatMediaLightbox item={mediaLightbox} onClose={() => setMediaLightbox(null)} t={t} />}
    </>
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
      className="flex w-full cursor-pointer items-center gap-2.5 bg-slate-200/95 px-3 py-2.5 transition hover:bg-slate-200 dark:bg-slate-800/95 dark:hover:bg-slate-800 sm:gap-3 sm:px-4"
      onClick={onJump}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onJump();
        }
      }}
    >
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-300/90 text-slate-700 dark:bg-slate-600 dark:text-slate-100">
        <I.Pin className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[15px] font-semibold leading-snug text-slate-900 dark:text-slate-50">{raw}</p>
        <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-slate-400">{message.at}</p>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onUnpin();
        }}
        className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-300/70 dark:text-slate-200 dark:hover:bg-slate-600/80"
      >
        {t('chat.unpinChat')}
      </button>
    </div>
  );
}

/** Slider switch in the chat header for toggling the AI auto-reply bot. */
function BotToggle({
  enabled,
  onChange,
  t,
}: {
  enabled: boolean;
  onChange: (next: boolean) => void;
  t: TFn;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={t('chat.botToggleLabel')}
      onClick={() => onChange(!enabled)}
      className={
        'group/bot ml-1 mr-1 flex items-center gap-2 rounded-full border px-2 py-1 text-[11px] font-semibold transition ' +
        (enabled
          ? 'border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100 dark:border-brand-700/60 dark:bg-brand-950/50 dark:text-brand-200'
          : 'border-slate-200 bg-slate-100 text-slate-500 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400')
      }
    >
      <span className="hidden sm:inline">{t('chat.botToggleLabel')}</span>
      <span
        aria-hidden
        className={
          'relative inline-block h-4 w-7 rounded-full transition ' +
          (enabled ? 'bg-brand-500 dark:bg-brand-400' : 'bg-slate-300 dark:bg-slate-600')
        }
      >
        <span
          className={
            'absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ' +
            (enabled ? 'left-3.5' : 'left-0.5')
          }
        />
      </span>
      <span className={enabled ? '' : 'text-slate-500 dark:text-slate-400'}>
        {enabled ? t('chat.botOn') : t('chat.botOff')}
      </span>
    </button>
  );
}

/** Webhook placeholder like [image] with no usable URL yet. */
function bareMediaPlaceholder(message: Message): 'image' | 'video' | null {
  if (message.meta?.slip || message.image === 'slip') return null;
  const hasHttpImage = typeof message.image === 'string' && /^https?:\/\//i.test(message.image);
  const hasHttpVideo = typeof message.video === 'string' && /^https?:\/\//i.test(message.video);
  if (hasHttpImage || hasHttpVideo) return null;
  const x = String(message.text || '').trim();
  if (/^\[(image|photo|sticker|ig_reel|reel|story_mention|share|fallback|file)\]$/i.test(x)) return 'image';
  if (/^\[(video|audio)\]$/i.test(x)) return 'video';
  return null;
}

function MediaFallbackCard({ kind, t }: { kind: 'image' | 'video'; t: TFn }) {
  const Icon = kind === 'video' ? I.VideoCam : I.Image;
  return (
    <div className="flex max-w-[280px] items-center gap-3 rounded-2xl border border-slate-200/90 bg-white px-3 py-2.5 shadow-sm dark:border-slate-600 dark:bg-slate-800">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{kind === 'video' ? t('chat.mediaCardVideo') : t('chat.mediaCardImage')}</div>
        <div className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{t('chat.mediaUnavailable')}</div>
        <div className="mt-1 text-[10px] leading-snug text-slate-400 dark:text-slate-500">{t('chat.mediaUnavailableHint')}</div>
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
  onOpenMedia,
  t,
}: {
  message: Message;
  avatar: string;
  isPinned: boolean;
  onPin: () => void;
  onUnpin: () => void;
  openMenuId: string | null;
  setOpenMenuId: (id: string | null) => void;
  onOpenMedia: (item: ChatMediaPreview) => void;
  t: TFn;
}) {
  const isCustomer = message.sender === 'customer';
  const isAI = message.sender === 'ai';
  const menuOpen = openMenuId === message.id;
  const bare = bareMediaPlaceholder(message);
  const textLooksLikeMediaPlaceholder =
    Boolean(message.text) &&
    /^\[(image|video|audio|file|attachment|photo|sticker|ig_reel|reel|share|fallback)\]$/i.test(String(message.text).trim()) &&
    (Boolean(message.image) || Boolean(message.video));
  const showTextBubble = Boolean(message.text) && !textLooksLikeMediaPlaceholder && !bare;

  const menu = (
    <div className="relative shrink-0" data-msg-actions>
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

  const outgoingBubble =
    'whitespace-pre-wrap rounded-2xl rounded-br-md px-3.5 py-2.5 text-sm text-white shadow-sm ' +
    (isAI ? 'bg-brand-700 dark:bg-brand-600' : 'bg-brand-600 dark:bg-brand-500');

  const bubbleColumn = (
    <div className={'flex max-w-[78%] flex-col ' + (isCustomer ? 'items-start' : 'items-end') + ' order-2'}>
      <div
        className={
          'flex min-w-0 gap-1 ' + (isCustomer ? 'flex-row items-center' : 'flex-row-reverse items-center')
        }
      >
        <div className={'flex min-w-0 flex-col ' + (isCustomer ? 'items-start' : 'items-end')}>
          {showTextBubble && (
            <div
              className={
                'whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ' +
                (isCustomer ? 'rounded-bl-md bg-slate-200/90 text-slate-900 dark:bg-slate-700 dark:text-slate-100' : outgoingBubble)
              }
            >
              {message.text}
            </div>
          )}
          {bare && (
            <div className={'mt-1 ' + (isCustomer ? '' : 'flex justify-end')}>
              <MediaFallbackCard kind={bare} t={t} />
            </div>
          )}
          {message.video && /^https?:\/\//i.test(message.video) && (
            <div
              className={
                'relative mt-1 max-w-full rounded-2xl border border-slate-200/90 bg-black shadow-sm dark:border-slate-600 ' +
                (isCustomer ? 'rounded-bl-md' : 'rounded-br-md')
              }
            >
              <button
                type="button"
                className={
                  'absolute top-2 z-[2] grid h-8 w-8 place-items-center rounded-full bg-black/55 text-white ring-1 ring-white/25 backdrop-blur-sm transition hover:bg-black/70 ' +
                  (isCustomer ? 'right-2' : 'left-2')
                }
                aria-label={t('chat.expandMedia')}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenMedia({
                    type: 'video',
                    src: message.video!,
                    poster:
                      message.image && /^https?:\/\//i.test(message.image) ? message.image : undefined,
                  });
                }}
              >
                <I.Maximize2 className="h-4 w-4" />
              </button>
              <video
                src={message.video}
                poster={message.image && /^https?:\/\//i.test(message.image) ? message.image : undefined}
                controls
                controlsList="nodownload"
                className="max-h-64 w-full rounded-xl object-contain"
                playsInline
                preload="metadata"
              />
            </div>
          )}
          {message.image && /^https?:\/\//i.test(message.image) && !message.video && (
            <button
              type="button"
              aria-label={t('chat.expandMedia')}
              onClick={() => onOpenMedia({ type: 'image', src: message.image! })}
              className={
                'mt-1 block w-full max-w-full cursor-zoom-in overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-0 text-left shadow-sm transition hover:opacity-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-600 ' +
                (isCustomer ? 'rounded-bl-md' : 'rounded-br-md')
              }
            >
              <img src={message.image} alt="" className="max-h-64 w-full object-contain" loading="lazy" />
            </button>
          )}
          {message.meta?.slip && <SlipCard slip={message.meta.slip} />}
          {message.meta?.productSuggestion && (
            <div className="mt-1 flex items-center gap-2 rounded-xl border border-slate-200/90 bg-white px-2.5 py-1.5 text-xs shadow-sm dark:border-slate-600 dark:bg-slate-800">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-pink-100 text-base dark:bg-pink-900/40">🧴</div>
              <div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">{message.meta.productSuggestion.name}</div>
                <div className="text-slate-500 dark:text-slate-400">
                  ฿{message.meta.productSuggestion.price.toLocaleString()} • {t('product.left', { n: message.meta.productSuggestion.stock })}
                </div>
              </div>
            </div>
          )}
        </div>
        {menu}
      </div>
      <div className={'mt-1 flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400 ' + (isCustomer ? '' : 'justify-end')}>
        {isPinned && <span title={t('chat.pinnedBanner')}>📌</span>}
        {isAI && <span className="chip bg-brand-100 text-brand-800 dark:bg-brand-900/50 dark:text-brand-200">AI</span>}
        <span>{message.at}</span>
      </div>
    </div>
  );

  return (
    <div
      data-message-anchor={message.id}
      className={'group/message flex animate-fade-in items-end gap-2 ' + (isCustomer ? 'justify-start' : 'justify-end')}
    >
      {isCustomer && <img src={avatar} className="order-1 h-7 w-7 shrink-0 rounded-full bg-slate-200 ring-2 ring-white dark:bg-slate-700 dark:ring-slate-900" alt="" />}
      {isCustomer ? (
        <>{bubbleColumn}</>
      ) : (
        <>
          {bubbleColumn}
          <div
            className={
              'order-3 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[9px] font-bold text-white ' +
              (isAI ? 'bg-brand-700 dark:bg-brand-600' : 'bg-brand-600 dark:bg-brand-500')
            }
          >
            {isAI ? 'AI' : 'A'}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Compact tags + optional note for the active conversation.
 *  - Tags render as small pills inline; click "+" to add, hover to remove.
 *  - The note is hidden behind a toggle so it doesn't clutter the chat for
 *    customers without notes; click the pencil to expand a small textarea.
 *  - All data lives in localStorage (see lib/customerNotes.ts).
 */
function CustomerTagsBar({ conversationId, t }: { conversationId: string; t: TFn }) {
  const [meta, setMeta] = useState<CustomerMeta>(() => getCustomerMeta(conversationId));
  const [tagDraft, setTagDraft] = useState('');
  const [tagEditing, setTagEditing] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

  // Re-load when the active conversation changes.
  useEffect(() => {
    setMeta(getCustomerMeta(conversationId));
    setTagDraft('');
    setTagEditing(false);
    setNoteOpen(false);
  }, [conversationId]);

  const commitTag = () => {
    const v = tagDraft.trim();
    if (v) setMeta(addTag(conversationId, v));
    setTagDraft('');
    setTagEditing(false);
  };

  const hasNote = Boolean(meta.note.trim());

  return (
    <div className="w-full shrink-0 border-b border-slate-200/90 bg-slate-50/70 px-4 py-2 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="flex flex-wrap items-center gap-1.5">
        {meta.tags.map((tag) => (
          <span
            key={tag}
            className="group inline-flex items-stretch overflow-hidden rounded-full bg-slate-200/70 text-[11px] font-medium text-slate-700 dark:bg-slate-700/70 dark:text-slate-200"
          >
            <span className="py-0.5 pl-2 pr-1.5">{tag}</span>
            <button
              type="button"
              onClick={() => setMeta(removeTag(conversationId, tag))}
              aria-label={t('chat.tagRemove')}
              className="grid place-items-center px-1 text-slate-500 transition hover:bg-slate-300/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-600 dark:hover:text-white"
            >
              <I.X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        {tagEditing ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-brand-300 bg-white px-2 py-0.5 shadow-sm dark:border-brand-500 dark:bg-slate-900">
            <input
              autoFocus
              type="text"
              value={tagDraft}
              maxLength={TAG_MAX_LEN}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitTag();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setTagDraft('');
                  setTagEditing(false);
                }
              }}
              onBlur={commitTag}
              placeholder={t('chat.tagAddPlaceholder')}
              className="w-28 bg-transparent text-[11px] text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
            />
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setTagEditing(true)}
            title={t('chat.tagAddTitle')}
            className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-500 transition hover:border-brand-400 hover:text-brand-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-brand-500 dark:hover:text-brand-300"
          >
            <I.Tag className="h-3 w-3" />
            {meta.tags.length === 0 ? t('chat.tagAddFirst') : t('chat.tagAdd')}
          </button>
        )}
        <span className="ml-auto inline-flex items-center">
          <button
            type="button"
            onClick={() => setNoteOpen((v) => !v)}
            className={
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition ' +
              (hasNote
                ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/40'
                : 'text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white')
            }
            title={t('chat.noteTitle')}
          >
            <I.Pencil className="h-3 w-3" />
            {hasNote ? t('chat.noteSaved') : t('chat.noteAdd')}
          </button>
        </span>
      </div>
      {noteOpen && (
        <div className="mt-2">
          <textarea
            value={meta.note}
            maxLength={NOTE_MAX_LEN}
            onChange={(e) => setMeta(setNote(conversationId, e.target.value))}
            rows={2}
            placeholder={t('chat.notePlaceholder')}
            className="w-full resize-y rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-900/30"
          />
          <div className="mt-0.5 flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500">
            <span>{t('chat.noteHint')}</span>
            <span className="tabular-nums">{meta.note.length}/{NOTE_MAX_LEN}</span>
          </div>
        </div>
      )}
    </div>
  );
}
