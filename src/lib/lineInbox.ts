import type { Conversation, Message, MessageSender, SlipResult } from '../types';
import type { Locale } from '../i18n/messages';

/** Payload from `GET /api/line/conversations` (one item). */
export interface LineConversationDto {
  id: string;
  customerName: string;
  channel: 'line';
  avatar: string;
  lastSnippet: string;
  updatedAt: string;
  unread: number;
  online?: boolean;
  botEnabled?: boolean;
  messages: Array<{
    id: string;
    sender: string;
    text?: string;
    image?: string;
    video?: string;
    receivedAt: string;
    meta?: { slip?: SlipResult } | null;
  }>;
}

function asSender(s: string): MessageSender {
  if (s === 'agent' || s === 'ai') return s;
  return 'customer';
}

export function mapLineConversationDto(dto: LineConversationDto, listTime: (iso: string) => string): Conversation {
  return {
    id: dto.id,
    customerName: dto.customerName,
    channel: 'line',
    avatar: dto.avatar,
    lastSnippet: dto.lastSnippet,
    lastAt: listTime(dto.updatedAt),
    unread: dto.unread,
    online: dto.online,
    botEnabled: dto.botEnabled,
    messages: (dto.messages ?? []).map(
      (m): Message => ({
        id: m.id,
        sender: asSender(m.sender),
        text: m.text,
        image: m.image,
        video: m.video,
        at: formatMessageClock(m.receivedAt),
        meta: m.meta?.slip ? { slip: m.meta.slip } : undefined,
      }),
    ),
    joinedDays: 0,
    totalSpent: 0,
  };
}

export function formatMessageClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Bangkok',
  });
}

export function formatRelativeListTime(iso: string, locale: Locale, t: (key: string) => string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 50) return t('inbox.justNow');
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    return locale === 'th' ? `${m} นาที` : `${m}m`;
  }
  if (sec < 86400) {
    const h = Math.floor(sec / 3600);
    return locale === 'th' ? `${h} ชม.` : `${h}h`;
  }
  if (sec < 86400 * 7) {
    const d = Math.floor(sec / 86400);
    return locale === 'th' ? `${d} วัน` : `${d}d`;
  }
  return new Date(iso).toLocaleDateString(locale === 'th' ? 'th-TH' : 'en-GB', { month: 'short', day: 'numeric' });
}
