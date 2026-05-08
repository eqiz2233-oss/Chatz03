import type { Channel, Conversation, Message, MessageSender, SlipResult } from '../types';
import { formatMessageClock } from './lineInbox';

/** Payload from `GET /api/fb/conversations` (one item). */
export interface FbConversationDto {
  id: string;
  customerName: string;
  channel: 'facebook' | 'ig';
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
    video?: string;
    receivedAt: string;
    meta?: { slip?: SlipResult };
  }>;
}

function asSender(s: string): MessageSender {
  if (s === 'agent' || s === 'ai') return s;
  return 'customer';
}

export function mapFbConversationDto(dto: FbConversationDto, listTime: (iso: string) => string): Conversation {
  const ch: Channel = dto.channel === 'ig' ? 'ig' : 'facebook';
  return {
    id: dto.id,
    customerName: dto.customerName,
    channel: ch,
    avatar: dto.avatar,
    lastSnippet: dto.lastSnippet,
    lastAt: listTime(dto.updatedAt),
    unread: dto.unread,
    online: dto.online,
    messages: (dto.messages ?? []).map(
      (m): Message => ({
        id: m.id,
        sender: asSender(m.sender),
        text: m.text,
        image: m.image,
        video: m.video,
        at: formatMessageClock(m.receivedAt),
        meta: m.meta as Message['meta'],
      }),
    ),
    joinedDays: 0,
    totalSpent: 0,
  };
}
