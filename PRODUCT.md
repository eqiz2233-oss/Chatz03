# Chatz — Product Context

## Product Purpose
Chatz is a multi-channel chat aggregation inbox for Thai online sellers — small and medium businesses selling on LINE OA, Facebook Messenger, and Instagram DM. It lets a single admin (or small team) reply to all channels from one interface, create orders, verify payment slips, and use AI auto-replies.

## Register
product

## Users
- **Primary:** Thai online sellers (solopreneurs, small shops). Not developers. Typically women aged 22-40 running a health/beauty/fashion shop. Chat volume: 30-200 conversations/day. Often managing the shop from mobile + desktop simultaneously.
- **Secondary:** Small team admins who handle overflow replies.
- Competing against: **zaapi**, **zwiz.ai**, and LINE OA official tools.

## Brand / Tone
- Friendly, fast, trustworthy
- Thai-first but not overly cutesy
- Clean and professional — sellers want to look professional to their own customers
- Anti-reference: cluttered, feature-cramped enterprise CRM feel

## Color strategy
Restrained — brand purple/violet accent (Tailwind `brand-600` ≈ violet/indigo), tinted slate neutrals, emerald for online/positive states, amber for warnings, fuchsia for notification badges.

## Current tech stack
- React + TypeScript + Vite
- Tailwind CSS (custom `brand-*` scale)
- No external component library — fully hand-rolled
- SSE for realtime, LINE/FB/IG APIs, Web Audio for notification sound
- Thai + English i18n

## Key screens
1. **Inbox** — ConversationList (360px left panel) + ChatThread (flex-1 right)
2. **Orders** — table layout with status tabs (pending/paid/shipped/cancelled)
3. **Settings** — LINE/FB config, AI brain, keyword rules
4. **Analytics, Slips, Shop** — supporting views

## Known UX problems (as of current version)
- Visual hierarchy inside conversation rows is flat
- No empty states that feel designed
- Input composer row is plain — feels like a textarea in a box
- Customer info panel (tags/notes) was always visible, now hidden behind button — good
- Quick replies were always visible, now hidden behind ⚡ — good
- No visible "loading" feedback beyond skeleton rows
- Sidebar navigation is functional but not delightful
- Mobile experience works but isn't optimized for thumb reach
- No consistent spacing rhythm (some sections too tight, others too loose)
- Chat bubble tails are rounded-br-md which is subtly mismatched with overall radius

## Anti-patterns to avoid
- Enterprise CRM feel (too many columns, too much data density)
- Overly gamified/cutesy (this is a work tool)
- Dark-pattern upsells
