# Chatz — Product Context

## Product Purpose
Chatz is a multi-channel chat hub for Thai online shops (Instagram, Facebook, and LINE) with AI that helps close sales end-to-end—by answering questions and verifying payment slips on your behalf.

It helps a solo admin or a small team:
- Reply on every channel from one screen
- Create orders
- Auto-verify payment slips
- Use AI to reply to customers and close sales

## Document Type
product

## Users
- **Primary:** Thai online shop owners (solo or small team), not developers. Mostly women around 22–40 selling health, beauty, and fashion products.
- Roughly 30–200 chat rooms per day
- Often use both mobile and desktop at the same time

- **Secondary:** Admin staff who help reply during peak traffic

Main competitors:
- Zaapi
- zwiz.ai
- LINE OA tools
- Facebook messenger
- Line 

## Personality / Brand Tone
- Friendly, approachable
- Fast
- Trustworthy
- Thai-first language
- Easy to use
- Clean, professional look

What we avoid:
- Dense, enterprise CRM feel with too much data on screen

## Color Direction
Use a restrained palette:
- Primary violet/purple (`brand-600`)
- Slate blue-gray for surfaces
- Emerald for online/success states
- Amber for warnings
- Fuchsia for notification badges

## Current Tech Stack
- React + TypeScript + Vite
- Tailwind CSS (custom `brand-*`)
- No external component library
- SSE for realtime
- LINE / FB / IG API integrations
- Web Audio for notification sounds
- Thai and English support

## Main Screens
1. **Inbox**
   - ConversationList on the left (360px)
   - ChatThread on the right (flex-1)

2. **Orders**
   - Order table
   - Status tabs:
     pending / paid / shipped / cancelled

3. **Settings**
   - LINE / FB setup
   - AI
   - Keyword rules
   - And other options that feel like real settings—not “AI-generated” filler

4. **Analytics / Slips / Shop**
   - Other supporting screens

## Current UX Issues
- Visual hierarchy in conversation rows is still too flat
- Empty states don’t feel designed yet
- Message input still looks like a plain textarea
- Customer info panel used to show always; now hidden behind a button (good)
- Quick replies used to show always; now hidden behind ⚡ (good)
- Loading feedback is still mostly skeletons
- Sidebar works but doesn’t feel delightful yet
- Mobile works but isn’t thumb-optimized
- Spacing is still inconsistent
- Chat bubble tails still use `rounded-br-md`, which doesn’t match the system’s main radius

## Things to Avoid
- Enterprise CRM feel
- Overly dense information
- Over-gamified or overly cute UI
- Dark-pattern upsell
