export type Channel = 'line' | 'ig' | 'facebook';

export type MessageDirection = 'in' | 'out';
export type MessageSender = 'customer' | 'agent' | 'ai';

export interface Message {
  id: string;
  text?: string;
  /** Slip UI uses `'slip'`; LINE/media uses an `https://` image URL. */
  image?: string;
  /** Video message URL (e.g. LINE `contentProvider`). */
  video?: string;
  sender: MessageSender;
  at: string; // human readable
  meta?: {
    slip?: SlipResult;
    productSuggestion?: ProductSuggestion;
  };
}

export interface ProductSuggestion {
  name: string;
  price: number;
  stock: number;
}

export interface SlipResult {
  status: 'pending' | 'verified' | 'failed' | 'duplicate';
  amount?: number;
  bank?: string;
  ref?: string;
  date?: string;
  reason?: string;
  senderName?: string;
  receiverName?: string;
}

export interface Conversation {
  id: string;
  customerName: string;
  channel: Channel;
  avatar: string;
  lastSnippet: string;
  lastAt: string;
  unread: number;
  online?: boolean;
  tags?: string[];
  intent?: 'browsing' | 'asking_price' | 'ready_to_buy' | 'paid' | 'support';
  totalSpent?: number;
  joinedDays?: number;
  /** ร้านปักหมุดข้อความนี้ไว้ด้านบนของห้องแชท (ฝั่งร้านเท่านั้น) */
  pinnedMessageId?: string | null;
  /** Auto-reply bot toggle (default true). When false, AI cannot send into this thread. */
  botEnabled?: boolean;
  messages: Message[];
}

export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'cancelled';

export interface Order {
  id: string;
  customer: string;
  channel: Channel;
  product: string;
  qty: number;
  amount: number;
  status: OrderStatus;
  createdAt: string;
  shop: string;
  commissionPct: number;
  slipStatus?: SlipResult['status'];
}

export type View = 'inbox' | 'orders' | 'slips' | 'shop' | 'commission' | 'analytics' | 'settings';

/** Open Inbox from Orders: prefer known id, else match by customer + channel on current list. */
export interface InboxFocusRequest {
  conversationId: string | null;
  customer: string;
  channel: Channel;
}
