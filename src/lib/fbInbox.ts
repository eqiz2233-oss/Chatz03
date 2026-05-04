import type { Conversation, Message, MessageSender } from '../types';
import { formatMessageClock } from './lineInbox';

/** Payload from `GET /api/fb/conversations` (one item). */
export interface FbConversationDto {
  id: string;
  customerName: string;
  channel: 'facebook';
  avatar: string;
  lastSnippet: string;
  updatedAt: string;
  unread: number;
  online?: boolean;
  messages: Array<{
    id: string;
    sender: string;
    text?: string;
    image?: string;
    receivedAt: string;
  }>;
}

function asSender(s: string): MessageSender {
  if (s === 'agent' || s === 'ai') return s;
  return 'customer';
}

export function mapFbConversationDto(dto: FbConversationDto, listTime: (iso: string) => string): Conversation {
  return {
    id: dto.id,
    customerName: dto.customerName,
    channel: 'facebook',
    avatar: dto.avatar,
    lastSnippet: dto.lastSnippet,
    lastAt: listTime(dto.updatedAt),
    unread: dto.unread,
    online: dto.online,
    messages: dto.messages.map(
      (m): Message => ({
        id: m.id,
        sender: asSender(m.sender),
        text: m.text,
        image: m.image,
        at: formatMessageClock(m.receivedAt),
      }),
    ),
    joinedDays: 0,
    totalSpent: 0,
  };
}
