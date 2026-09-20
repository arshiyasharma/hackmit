# Room III — the product, in the landing's design system

Room III of the landing (`/landing`, chapter index 2) **is** PIXX-AR. Rooms I and II
are the tour, room IV is About us. Everything Visa, everything that buys, lives
here and nowhere else.

This document is the contract for the re-skin. It adapts the previous iteration's
motion sheet (`VISA-landing-page-motion-sheet.pdf`, "Nine beats in a room") from a
scrolling landing page to the running product.

## 0. Hard rules

1. **Frontend only.** Never edit `app/api/**`, `lib/checkout/**`, `lib/tap/**`,
   `lib/visa/**`, `lib/visaAcceptance/**`, `lib/sourcing/**`, `lib/elastic/**`,
   `lib/fit.ts`, `lib/placeholder.ts`, `lib/money.ts`, `data/**`, `scripts/**`,
   `env.example`. Read them; do not touch them. Request and response shapes stay
   exactly as they are.
2. **Nothing is lost.** Every behaviour that exists today survives: the store
   contract, every string a test asserts, haptics, undo toasts, honesty labels
   ("estimated", "assumed", "No size on the listing"), the test-mode chip, empty
   and failed states, reduced motion, keyboard access, 44px touch targets.
3. **No invented numbers.** A price, a dimension, a saving or an identity that the
   backend did not give is shown as a dash or not shown. Never a made-up value.
4. **Navigate with `useAppNav()` / `<AppLink>`** from `lib/nav.tsx`, never with
   `next/navigation` or `next/link` directly. Inside room III a push swaps the
   screen in place; standalone it is the Next router.
5. **Light only.** No dark theme, no neon, no harsh shadows, no low-contrast text.
   Body text is ≥ 4.5:1 on whatever it sits on, including glass over a photo.
6. **Laptop first.** PIXX-AR is a website used on a laptop. The design target is
   a landscape window from 1280x720 to 1728x1117, mouse and keyboard. There is
   no phone-shaped column any more: no `max-w-md` frame around a screen, nothing
   that reads as a vertical app stretched onto a monitor. Hover states, visible
   focus rings, keyboard paths (Tab, arrows, Enter, Escape) and `cursor: pointer`
   are part of the work. See section 1b for the layout contracts.
7. **Desktop only. One structure.** There is no separate mobile arrangement to
   keep or to build: no bottom sheets, no swipe rails, no `useDesktop()` forks
   that render a second layout. Every screen has ONE structure, the laptop one.
   A narrow window only has to stay usable through CSS (the panel narrows, then
   drops under the stage; grids collapse to one column) — never a second code
   path. `lib/useDesktop.ts` exists for the rare behavioural switch (hover vs
   tap), not for layout.

## 1. Design system

> **The accent is the room's colour.** The product lives in room III, the tomato
> room, and the owner asked that it match: "why is this blue when the room that
> we enter is red? make it match." So the one accent is room III's red, and the
> glass stays clear and frosted, warmed by the room behind it. Anywhere an older
> note or class name says *blue* (`glass-blue`, "blueprint", "accent-blue line")
> read *the accent*: always use the token names (`accent`, `accent-pale`,
> `accent-wash`, `glass-accent`), never a hex, and the colour follows.

### Colour (tokens in `app/globals.css`; use the Tailwind names, never raw hex)

| token | value | use |
|---|---|---|
| `background` | `#FAF7F0` | paper, every ground |
| `surface` | `#FFFFFF` | solid cards, sheets |
| `surface-muted` (`bg-muted`, `bg-secondary`) | `#F1ECE0` | paper-2, wells, skeletons |
| `foreground` | `#111111` | ink |
| `muted-foreground` | `#5F646E` | secondary text (5.6:1 on paper) |
| `accent` | `#C2391F` | ROOM III'S RED (the facade's tomato `#E0462E`, deepened to 5:1 for text). One accent. Actions, links, the linked state. `accent-bright` `#E0462E` is for fills and large marks only |
| `accent-pale` | `#F0C6BA` | fills, ghost/preview states, the stand-in's tint |
| `accent-wash` | `#FBEBE5` | drafting-paper ground for the fit drawing, quiet highlights |
| `line` | `#E4DFD2` | hairlines on paper |
| `ok` | `#25734A` | fits, measured, placed |
| `warn` | `#8A5A00` | AMBER, so the alarm is never mistaken for the accent: over budget, estimated, will not fit, failed |

### Type — three families, as the motion sheet asks

- **Display: Cormorant Garamond** (`font-display`), weights 300–600, line-height
  0.95–1.05, letter-spacing 0.01–0.03em. Headlines and names only. Cormorant has
  a small x-height: never below 20px, and use weight 500 under 28px.
- **Body: Instrument Sans** (`font-sans`). All UI text and every button label.
- **Numbers and labels: Sometype Mono** (`font-mono`). **Every number that can
  change is mono, `tabular-nums`, and never reflows.** Eyebrows are mono 11px,
  0.18em tracking, uppercase: class `eyebrow`.

### Liquid glass (classes in `app/globals.css`)

Soft, frosted, clear, lit from above, warmed by the red room behind it. Use it for chrome that floats over the
room (camera, photo) or over the paper backdrop. It is never stacked more than two
deep and never used for long-form reading.

- `glass` — thin frosted panel over paper or soft imagery.
- `glass-thick` — over a camera feed or photograph, where what is behind is
  unknown. Opaque enough that ink text holds 4.5:1 on a black or white room.
- `glass-accent` (older alias: `glass-blue`) — the accent as glass: the user's own bubble, the primary action.
  Text on it is white.
- `glass-pill` — a `glass-thick` capsule: chips, the ask, the budget.
- `glass-sheen` — one specular sweep across a panel as it arrives. One shot.
- Radii: panels 28px, cards 22px, pills 999px. Shadows are soft and blue-tinted
  (`--glass-shadow`), never a hard black drop.

## 1b. Layout — the laptop workspace

`desk` = 900px, available as the `desk:` Tailwind variant for the few places a
narrow window needs a different measure. The structure never forks.

**The room screen is a workspace, not a column** (`app/room/page.tsx`):

```
+---------------------------------------------------------+------------------+
| (chip) [ palette . style tags ]                         |  PIXX-AR         |
|                                                         |  THE NUMBER      |
|                 THE ROOM, full bleed                    |  ..............  |
|            (photo + the things standing in it)          |  conversation    |
|                                                         |  ..............  |
|  +---------------- listing tray (when open) ---------+  |  in the room     |
|  | 01  02  03  04  05   real listings, hover = try on |  |  [ ask pill  > ] |
|  +----------------------------------------------------+  |                  |
+---------------------------------------------------------+------------------+
```

- The scene fills the whole window. Everything else is glass floating over it.
- **The agent panel**: `<aside>`, `glass-thick`, 28px radius, `absolute` 16px from
  the top, right and bottom, width `--panel-w` (26.5rem). Top to bottom: eyebrow
  header, `<BudgetHud docked />`, `<AgentThread />` (`flex-1 min-h-0`, scrolls,
  newest at the bottom), `<ItemsStrip />` (wraps, does not scroll sideways),
  `<AskInput />` pinned to the foot. At `desk` the panel NEVER hides — not while
  the tray is open, not while asking.
- **The tray**: at `desk` `OptionSheet` is not a modal bottom sheet. It is a
  docked, non-modal `glass-thick` tray inside the stage: `absolute`, 16px from
  the left and bottom, its right edge at `var(--stage-right)`, about
  `min(44dvh, 26rem)` tall, with a close button and Escape. All five cards are
  visible in one row. **Hover or keyboard focus on a card = preview** (the thing
  in the room tries that size on); leaving the rail clears it. Click = link.
- **The free area.** The page sets these on `<main>`, and they are the whole
  contract between the page, the tray and the scene:
  `--panel-w` (26.5rem), `--tray-h` (`min(44dvh, 26rem)`),
  `--stage-right` (`calc(var(--panel-w) + 32px)` at `desk`, `0px` below) and
  `--stage-bottom` (at `desk`: `calc(var(--tray-h) + 32px)` while the tray is
  open and `0px` when it is not; below `desk`: `var(--room-bottom-chrome)`).
  The scene fits and centres the photo inside the free area those two leave and
  glides there (`DUR.element`, `EASE.inOut`) when they change, so the object is
  never under the panel or the tray. Its own floating controls measure from the
  same two variables.
- The account chip (room III draws it) owns the top-left 56px corner; the context
  strip starts after it (`--room-chip`).
- **Dialogs, not bottom sheets.** At `desk`, `components/ui/Sheet.tsx` renders a
  centred dialog: `role="dialog"`, `aria-modal`, focus moved in and restored,
  Escape and backdrop click close it, `glass-thick`, max-width 46rem (a caller's
  `className` may widen it), max-height 86dvh, scrolls inside. Same props.
- **Capture** at `desk`: a two-column hero on paper — the three-line headline and
  sub-line on the left, a large `glass` drop zone (drag and drop, Upload, Use the
  camera) on the right; the live camera, once on, is full bleed.
- **Checkout** at `desk`: header across the top; content max-width 74rem in two
  columns — the basket by shop on the left, a sticky order summary (test-mode
  chip, total, mode, the one button) on the right. During the run the accent
  band spans the full width and the shops run side by side as glass threads.
- **Sign-in** at `desk`: split — wordmark, deck and the three steps on the left,
  the glass sign-in card on the right.

### Motion (`lib/motion.ts` — if a number is not in this table it does not belong in a component)

| token | value | used for |
|---|---|---|
| `EASE.out` | `cubic-bezier(0.16, 1, 0.3, 1)` | every entrance |
| `EASE.inOut` | `cubic-bezier(0.65, 0, 0.35, 1)` | two-way changes, the cover |
| `EASE.in` | `cubic-bezier(0.7, 0, 0.84, 0)` | exits |
| `DUR.micro` | 0.24s | chips, hovers, caret |
| `DUR.element` | 0.60s | one element arriving |
| `DUR.scene` | 1.20s | a whole screen changing |
| `SPRING` | 220 / 26 / 1 | **the resize, and nothing else** (~400ms, one overshoot) |
| `COUNT` | 140 / 24 | the budget counter — slower, so digits stay readable |
| `SCRUB` | 120 / 30 | the listing rail and anything drag-linked |
| `STAGGER.line` | 80ms | headline lines |
| `STAGGER.chip` | 40ms | list items, chips, bubbles |

Headlines arrive as lines: a clipping wrapper, the child from `y: 110%` to `0`,
`DUR.element`, `EASE.out`, 80ms apart. **Put the trigger on the unclipped parent**
— a masked child parked outside its clip rect never intersects. Every animation
honours `prefers-reduced-motion` (opacity only, ≤ 0.15s).

## 2. The flow — nine beats, as a product

| beat | motion sheet | in the product | owner |
|---|---|---|---|
| 00 | — | **The door.** Paper floods, the product lifts out. Google sign-in on glass. | `components/room3/*` |
| 01 | The room, empty | **Capture.** "Shop for the room you are standing in." | `Capture.tsx` |
| 02 | The ask | "One thing at a time." A glass pill, a 2px caret, and **the conversation**. | `AskInput`, `AgentThread` |
| 03 | It appears | The stand-in at size, blurred ellipse shadow, leader line + mono mm chip. | `PhotoMode`, `PlaceholderSprite` |
| 04 | Five real things | The tray: five 3:4 cards in one row under the room, real listings only. | `OptionSheet`, `ProductCard` |
| 05 | Pick another one | **Cannot be cut.** Hover a listing and the thing in the room tries its size on; link it and it stays. The size moves on `SPRING`; the label counts on the same spring. | tray + sprite |
| 06 | The number | The budget: mono, tabular, `COUNT` spring, deltas that rise and fall. | `BudgetHud`, `Delta`, `ItemsStrip` |
| 07 | Nobody measures the stairwell | The fit check as a drawing: blueprint register, 1px lines, verified figures, never rounded. | `FitSheet`, `FitBadge` |
| 08 | Shops, one button | Accent at full bleed **once**: the agent's run, as a glass conversation. Test-mode chip from the first frame. | `CheckoutRun`, checkout screen |
| 09 | Close | "The room was always the shop." Receipts, and one button back to the room. | `Confirmation` |

### The conversation

The ask, the wait and the agent's buying are one conversation, in glass: on the
room screen it is the body of the agent panel. The shopper's words are `glass-blue` bubbles on the right; the agent's are
`glass-thick` on the left, with a mono eyebrow saying who is speaking. It is
derived from state that already exists (items, statuses, fit, the checkout
stream) — it never invents a message the backend did not cause. In the panel it
keeps the whole exchange for the room (one short exchange per thing asked for)
and scrolls; it never covers the object it is talking about.

## 3. What each screen must keep

See the subsystem maps the build was planned from (store and budget game, ask and
listings, room/AR/fit, checkout/Visa/TAP). The short version: if it is on screen
today, it is on screen after, in the new language.
