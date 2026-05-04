import type { Channel } from '../types';

/** Map mock order → inbox conversation id using seed list (same channel + name match). */
export function resolveConversationIdForOrder(
  order: { customer: string; channel: Channel },
  conversations: { id: string; customerName: string; channel: Channel }[],
): string | null {
  const oc = order.customer.trim();
  for (const c of conversations) {
    if (c.channel !== order.channel) continue;
    const cn = c.customerName.trim();
    if (cn === oc || cn.startsWith(oc)) return c.id;
    const head = cn.split(/[|│]/)[0].trim();
    if (head === oc || head.startsWith(oc) || oc.startsWith(head)) return c.id;
    if (oc.length >= 2 && cn.includes(oc)) return c.id;
  }
  return null;
}
