# Sense landing page: reference teardown, Higgsfield prompt pack, and Claude Code build prompt

Version 1, written Sept 19 2026 for the Visa track build. Reference studied: the Miu Miu immersive bag campaign site (desktop Chrome, viewports 966x695 and 1352x703). Nothing in this file reuses that site's images, copy, logo, audio, or code. It documents the interaction grammar and motion design, then rebuilds that grammar around Sense with original art direction.

## Part 0. How to use this file

1. Put this file in your repo at `docs/SENSE_LANDING_SPEC.md`.
2. Generate the visuals with the prompts in Part D. You can do that in the Higgsfield web app, or straight from Claude Code through the Higgsfield CLI (setup in D0).
3. Paste the kickoff prompt from Part E into Claude Code. The build starts with labelled placeholder images, so you do not have to wait for the visuals.
4. Follow the milestone prompts in Part E one at a time. Each one ends in something you can demo.

### The mental model

The reference behaves like a dollhouse you hold in your hands. Moving the mouse tilts the whole house. Poking an object inside it drops a page into a scrapbook. To change rooms you pull your head out through a window, slide along the outside wall, and push your head in through the next window. There is no page scroll at all in the main experience. Scroll only exists inside the scrapbook and the finale page.

Sense keeps that skeleton and changes what it means. The dollhouse is the shopper's own room. The scrapbook is the basket. The approval is its own scene in the last chapter, unlocked only when the basket is full. After it the shopper puts the phone down and software does the shopping at four shops.

```
TITLE CARD -> VOICE-OVER SHOT -> ROOM (tilt with mouse, hotspots)
                                   |
        +--------------------------+---------------------------+
        |                          |                           |
   FOUND OBJECT              MICRO-INTERACTION            PIECE VIEWER
   (blur + title)            (full-screen close-up)       (photo stack)
        |                          |                           |
        +------------> REWARD CARD -> BASKET PAGE <------------+
                                   |
ROOM -> FLY OUT THE WINDOW -> FACADE CAROUSEL -> FLY IN -> NEXT ROOM
                                   |
              basket full -> APPROVE ONCE -> FOUR RECEIPTS -> FINALE PAGE
```

### Legend for numbers in Part A

[M] means measured from the live page's DOM or stylesheet, so it is exact. [E] means estimated from captured frames. The capture rate was limited, so treat [E] values as good starting points and tune by eye.

---

## Part A. Frame-by-frame teardown of the reference

### A1. How it is built

One full-screen WebGL canvas sits behind a thin DOM layer that holds every piece of UI [M]. The body has overflow hidden, so the page never scrolls; only the scrapbook page and the finale page scroll, each inside its own smooth-scroll wrapper [M]. The canvas backing store was 1545x1112 for a 966x695 viewport on a 2x display, so the render pixel ratio is capped near 1.6 [M]. The html element carries device and quality classes (desktop, browser, OS, and a quality tier), which means effects are tiered by GPU [M].

Assets loaded during one session [M]: Draco compressed meshes and KTX2/Basis textures with their wasm decoders (so the rooms are real 3D geometry with baked textures), about 157 AVIF images, 15 m4a audio clips (voice-over lines, ambience, UI sounds), a webm video, and a JSON asset manifest driving a preloader. The JavaScript is split into per-view chunks: room view, scrapbook, piece viewer, instant-photo card, each micro-interaction, and a hotspot module [M]. Scoped style hashes show a Vue single-file-component build [M].

Fonts [M]: Work Sans 400 and 700 for all UI and titles, a ballpoint handwriting face for notes and the finale title, and a mono face registered for small details.

### A2. Scene 0, title card (0.0s to about 4.5s, then waits for a click)

| Frame | Time | On screen | Motion |
|---|---|---|---|
| 0 | 0.0s | Flat deep navy field (#0C0F60 [M]), full bleed, nothing else | None |
| 1 | 1.0s [E] | One row of type at the exact vertical center: brand word at the left edge of a narrow column, the word "presents" at the right edge | Fade in, about 0.6s |
| 2 | 2.0s [E] | That row has moved up. Three title rows sit under it in the same column. Row 1 and row 2 each hold two words pushed to opposite edges. Row 3 holds one word with its letters spread edge to edge. A two-line sound notice with a speaker icon appears at the top center | Row slides up about 8vh; title rows fade in top to bottom with a short stagger; notice fades with opacity 0.65s ease-in-out [M] |
| 3 | 4.0s [E] | Two centered lines of body copy under the title. A small spinner is replaced by the Enter button | Fade in |

Layout numbers [M]: the column is 386px wide at a 966px viewport (40vw). Eyebrow row is 3vh (20.85px at 695px tall), weight 700, letter-spacing 4px, uppercase. Title rows are 6vh (41.7px), weight 700, letter-spacing 4px, with a row pitch of about 12vh. Body copy and the sound notice are 1.9vh, weight 400. The Enter button is a white rectangle, 100x48px, padding 0 18px, a 15x20px line icon of an open door, label 14px black.

Hover on Enter: the top-right corner peels up like a paper dog-ear with a small soft shadow, and the button tilts about 2 degrees. Click: the title card dims to black while the 3D scene fades up from black behind it, about 2s in total [E]. The sound tile appears bottom right during the fade.

### A3. Scene 1, opening shot with voice-over (about 8.5s)

| Frame | Time after click | On screen | Motion |
|---|---|---|---|
| 4 | 0.0 to 2.0s | Frontal, symmetrical close shot: one painted door fills the middle third, a table with lamp at the left edge, a chair at the right edge. Light film grain, soft daylight | Exposure ramps up from black |
| 4b | 1.0 to 6.0s | Subtitles, one short line at a time, bottom center | Each line fades in and out, about 2.5s per line [E] |
| 5 | 6.0 to 8.5s | Same axis, wide shot of the whole room. A second colored door is revealed on the right wall | Straight dolly back, about 2.5s, strong ease in and out [E] |

Subtitles [M]: Work Sans 400, 18px, yellow #FFE100, 1px black outline made with text-shadow, centered, 40px above the bottom edge.

### A4. Scene 2, room idle state and onboarding

The camera is mouse driven. Mouse X adds yaw and sideways travel plus a strong roll, a Dutch tilt that reaches roughly 10 to 12 degrees at the screen edges [E]. Mouse Y adds a little pitch and vertical travel. The rig is heavily damped and takes 1 to 1.5s to settle [E]. The UI never tilts, only the world does. This roll is the single most recognizable part of the feel.

An onboarding toast rises at the bottom center [M]: cream card #FCF5E6, radius 4px, padding 12px 27px, rotated -2 degrees, shadow 0 0 4px rgba(0,0,0,0.25). Inside: a 62px white circle holding a hand-drawn line icon (circle shadow 0.7px 0.7px 1.41px rgba(0,0,0,0.25)) and two lines of 16px/19.2px text.

A hotspot sits on the target object [M]: a 46px white circle with a slightly irregular blob outline, a 36px hand-drawn icon, two 1px rings in rgba(255,255,255,0.6) that pulse from scale 1 to 2.2 while fading from 1 to 0 over 2s, and an invisible 93px hit area. Hotspots are DOM buttons repositioned every frame from projected 3D coordinates, so they stay glued to their object while the world tilts.

### A5. Scene 3, the found-object reveal (about 2.5s)

| Frame | Time after click | On screen | Motion |
|---|---|---|---|
| 7 | 0.0s | Toast and hotspot hide. Camera pushes toward the object. Heavy blur over the scene plus a dark veil | Blur is a shader post-process, not a CSS filter [M]. Veil is a vertical gradient from half-transparent black at the top to solid black at the bottom with the whole layer at 50% opacity [M], so roughly 25% dark at the top and 50% at the bottom |
| 8 | 0.4s [E] | Small eyebrow line at top center, then the object's name under it | Opacity fades, staggered about 0.3s |
| 9 | 0.9s [E] | The object floats at center, about 65% of viewport height, tilted about 15 degrees. It is a flat cut-out image, not 3D [M] | Opacity 0.55s [M] |
| 10 | 1.6s [E] | Reward card rises from the bottom edge: icon circle on top, two lines with key words in blue #265ADF, one white button | Slide up with slight overshoot |

Type [M]: eyebrow 12px, 700, letter-spacing 9px, uppercase, white. Name 24px, 700, letter-spacing 4px, line-height 36px. Card button: white, square corners, uppercase 14px, padding 0 18px, rotated -0.6 degrees, with a looping wiggle that swings to -5, +5, -5 degrees during the first 20% of the loop and rests for the remaining 80%.

### A6. Scene 4, the scrapbook page

On the card button click the screen floods with the navy field color, then a giant paper page slides in from the right with a strong ease in and out, about 1.2s, tilted about 4 degrees while it travels and flat when it lands [E]. A periwinkle strip runs down the left edge like a book cover.

The page [M]: cream paper with faint mirrored handwriting ghosted into the background, 5.5 viewports tall for 5 slots. Header: a title on a torn white paper label rotated about -5 degrees (48px regular), a 20px description with blue key words, and a counter chip that becomes sticky at the top left after you scroll. Five slots run in a zigzag (right, left, right, left, right), each 390 to 470px wide and 500 to 660px tall.

An empty slot shows its number, dashed placeholder lines where the handwriting will go, a dashed rectangle where the photo will go, and a small button inside the rectangle that jumps to the room where that slot is earned. A filled slot plays this sequence: the handwriting writes on, a hand-drawn underline draws left to right (background-size growing to 100% 2px [M]), a small curved arrow appears, then a white-bordered photo drops in rotated 3 to 6 degrees with a strip of translucent tape. Some photos carry a small shop tag on one corner.

Between slots sit loose doodles: black pen loops, a blue pen curl, a yellow highlighter zigzag, a blue brush smear. Handwriting and doodles have a line-boil jitter [M]: opacity steps 1, 0.8, 0.9, 0.7 with plus or minus 0.2px of translate and plus or minus 1 degree of rotation. Reward cards swap by sliding down and up with about a 1s gap, and later cards carry a small round close button on their top-right corner.

### A7. Scene 5, the heads-up display

Top left: a counter tile. Top right: a scrapbook tile. Bottom right: a sound tile, 50px square, 17px from both edges [M]. Bottom center: a labelled tile for changing rooms, 48px tall with padding 0 18px. Every tile is white paper with radius 4px, each rotated by its own small angle between about -10 and +3 degrees, each with the corner-peel hover. Tiles enter by sliding in from the nearest screen edge with a fade (the counter uses translateY(-100%) to 0 [M]). A collected hotspot turns into a small white check mark circle with no pulse.

### A8. Scene 6, fly out through the window (about 3s)

| Frame | Time | On screen | Motion |
|---|---|---|---|
| 12 | 0.0s | HUD fades out | 0.3s |
| 12b | 0.2 to 1.8s [E] | Camera races backwards. Colored window shutters enter from the left and right frame edges. Radial zoom blur grows from the edges toward the center | Dolly back with accelerating ease; blur peaks mid move |
| 13 | 1.8 to 3.0s [E] | Exterior: a pale stone block facade fills the frame with one window centered and the room visible inside it like a diorama. Soft tree shadows drift across the wall | Blur resolves over the last 0.6s |
| 14 | 2.6s [E] | Chapter eyebrow and room name at top center, round 46px arrow buttons at mid left and mid right, an entry tile at bottom center | Fades; the unavailable arrow sits at 40% opacity |

### A9. Scene 7, the room carousel

A click on an arrow trucks the camera sideways along the wall with horizontal motion blur, about 1.6s, ease in and out [E]. The labels and the entry tile are DOM elements attached to their window, so they slide off with it while the next window's label slides in. Each window has its own shutter color, and that color matches the accent color inside that room.

### A10. Scene 8, fly in (about 2.5s)

A short anticipation first: the world counter-rolls about 3 degrees and the UI fades. Then a fast dolly in through the window with zoom blur, landing on the wide shot with a trace of horizontal motion blur that clears in about 0.5s. The HUD tiles slide back in.

### A11. Scene 9, the piece viewer (photo stack)

On click the hotspot icon collapses into a solid white dot with a spinner ring while the view loads. The camera pushes in, the scene blurs and darkens, the HUD leaves. A stack of cards is dealt in from below the viewport; each card starts at translateY(100vh) [M] and lands with its own rotation between about -14 and +10 degrees [M].

The stack [M]: six cards in total. One is a text card (blue #265ADF, radius 0.4em, 56.5vh tall, aspect 375:477, white 3vh text rotated -5 degrees, a small hint with a curved arrow at the bottom left) and the rest are distressed white-bordered instant photos (48vh tall, aspect 900:1078, square image inset 4.5% from the top at 77.5% of the card height).

Tapping the stack sends the top card to the back and the z-order cycles. A shop tile at the top right crossfades its background color to match the colorway of whichever photo is on top (red, then blue, then green). A white square close tile sits at the bottom center. Closing pulls the camera back while the blur clears like a focus pull, and the hotspot becomes a check mark.

### A12. Scene 10, micro-interaction with a keypad code

The room is replaced by a full-screen top-down close-up (push in, blur, crossfade). A back tile sits top left and the scrapbook tile top right. A paper note overlaps the bottom of the frame with a handwritten code. Each correct key press turns that handwritten digit blue. On completion the note slides away, the UI hides, a voice line plays with yellow subtitles, and a reward reel plays: several full-screen instant photos lying on the table, about 4s each with a slow scale from 1 to 1.1 [M], then a short cinematic clip. The reward card follows.

### A13. Scene 11, micro-interaction with a stereo viewer

Full-screen interior of a toy slide viewer: two rounded windows show the same photo, a small round counter between them shows progress with a ring around it, and a wheel of slides peeks in at the top. Each click rotates the wheel, swaps both images, and plays one voice line with a subtitle. Six slides, then the reward card.

### A14. Scene 12, micro-interaction that unveils colors

This is the most reusable idea for Sense. The shot is a hero close-up of the product on a stack of books in front of a painted panel. The cursor becomes a 46px white dot with an icon and a progress ring. Around the cursor, a soft-edged liquid lens about 90px in radius, which leaves a short smeared trail when it moves, shows the next colorway of the entire scene: product, paint, books, and props all change together. A click expands the lens as a feathered radial wipe from the cursor until it covers the screen, about 0.9s [E]. The lens then previews the following colorway. Four colorways loop, and some props change with each palette.

### A15. Scene 13, the finale page

It slides in from the right as a second paper page. Section one [M]: a handwritten title in blue ink at 62px, the five collected lines restated in a zigzag at 24px with numbers, and five white-bordered photos scattered on the corners and bleeding off the edges at plus or minus 8 degrees, one of them a borderless material cut-out. Section two [M]: a large taped video poster on the left (white border, rotated -2 degrees, tape strip on top, a play tile at its bottom left that opens a full-screen video overlay with a backdrop and a close tile), and on the right a small handwritten title at 28px, a 12px paragraph, and two stacked paper tiles: a primary tile with a bag icon and a share tile whose label swaps to a confirmation after copying the link.

### A16. Motion tokens pulled from the stylesheet [M]

| Role | Value | Uses |
|---|---|---|
| Primary ease out | cubic-bezier(0.23, 1, 0.32, 1) | 39 |
| Page slides and wipes | cubic-bezier(0.55, 0, 0.1, 1) | 22 |
| Expo out | cubic-bezier(0.16, 1, 0.3, 1) | 20 |
| Quart out | cubic-bezier(0.25, 1, 0.5, 1) | 12 |
| Shake | cubic-bezier(0.36, 0.07, 0.19, 0.97) | 10 |
| Overshoot pop | cubic-bezier(0.19, 1.51, 0.29, 0.99) | 8 |
| Anticipation exit | cubic-bezier(0.71, 0.01, 0.81, -0.51) | 5 |
| Back out | cubic-bezier(0.34, 1.56, 0.64, 1) | 2 |

Durations by frequency: 0.5s (40 uses), 0.3s (24), 0.4s (14), 1s (13), 1.6s (12), 0.8s (11). Keyframes present: ring pulse, line-boil jitter, slow photo zoom, underline draw, button wiggle, counter enter and leave, horizontal shake, loading spin.

### A17. What could not be measured

The card shuffle in the piece viewer finishes faster than the capture rate, so its mid-flight frames were not seen; the shuffle values in Part C are recommendations. The camera rig constants are estimates from still frames at known mouse positions. The finale page was inspected by revealing it from the page structure instead of playing through all five notes, so its entrance timing is inferred from the scrapbook's entrance.

---
## Part B. The Sense adaptation

### B1. The product truth the page has to tell

You are in your room with your phone. You ask for a lamp, you see it at real size, you pick one. You do that four times until the room is full, and nothing has been bought yet. Then you tap one button. That tap is the only moment you agree to spend money, and your face or fingerprint confirms it is you. You put the phone down. Software buys the four things at four different shops, one after another. No shop receives your real card number. Each shop receives a stand-in number that only works for that one purchase.

Everything on the page serves one sentence: a person approves a basket once, then software does the shopping on their behalf at several shops.

### B2. Beat-for-beat mapping

| Reference beat | Sense beat |
|---|---|
| Title card with a justified three-row title | Same lockup: SENSE / PRESENTS, then FILL / THE, ROOM / TAP, and O N C E letter-spread |
| Voice-over over a close shot, then dolly back to the wide room | Voice-over over a close shot of an empty corner, then dolly back to an empty sunlit room on moving-in day |
| Pick up the notebook | Pick up your phone from the windowsill |
| Scrapbook with 5 notes | The Basket: a paper order sheet with a budget line and 4 slots, one per piece |
| Three rooms behind three shuttered windows | Three chapters of the same room behind three picture windows: I ASK, II CHOOSE, III APPROVE ONCE |
| Keypad micro-interaction | ASK: hold to speak, the lamp appears at real size with dimension lines |
| Unveil-the-colors micro-interaction | CHOOSE: click the sofa to unveil its fabrics with the liquid lens and radial wipe |
| Piece viewer photo stack | Piece viewer for the rug: instant photos, a facts card, and an add-to-basket tile that color-syncs |
| Reward reel of photos on the table | Four paper receipts sliding onto the windowsill, one per shop, each with its one-time number |
| Finale page with video poster and two tiles | Finale page: "One tap. The room is yours.", the four asks restated, demo video poster, Try the demo and Share tiles, and a three-stamp strip explaining the payment model |

The counter reads 0/4 to 4/4 pieces. The approve hotspot in Chapter III stays locked until 4/4. Clicking it early plays the horizontal shake and a toast that says how many pieces are left. That lock is the on-page proof that nothing is bought until the one approval.

### B3. Chapters, room states, and hotspots

All three chapters are the same room from the same camera, so the before and after story reads instantly. Hotspot positions are normalized image coordinates (u from the left, v from the top) on the full 16:9 room still. Because the page zooms the still by about 1.32 and tilts it, only the central part is ever on screen: every hotspot and every important object stays inside the safe area, u 0.18 to 0.82 and v 0.15 to 0.85. The outer margins are bleed.

| Chapter | Accent | Room still | Hotspot | Icon | Position u,v | Opens |
|---|---|---|---|---|---|---|
| I ASK | Cobalt | R1a empty room, then R1b after the lamp is placed | H1 phone on the windowsill | phone | 0.20, 0.55 | Found reveal "You found your phone", then the Basket opens at 0/4 with the budget line written in |
| I ASK | Cobalt | same | H2 empty back-left corner | mic | 0.30, 0.52 | ASK interaction, earns piece 1 (lamp) |
| II CHOOSE | Moss | R2 lamp, sofa, rug | H3 sofa | swatch | 0.50, 0.55 | Fabric lens interaction, earns piece 2 (sofa) |
| II CHOOSE | Moss | same | H4 rug | photo | 0.50, 0.70 | Piece viewer photo stack, earns piece 3 (rug) |
| III APPROVE ONCE | Tomato | R3 full room | H5 armchair | chair | 0.71, 0.62 | Found reveal "You chose the armchair", earns piece 4 |
| III APPROVE ONCE | Tomato | same | H6 phone on the windowsill | fingerprint | 0.20, 0.55 | APPROVE interaction, locked until 4/4, then the receipts reel and the finale |

Each u,v marks the visual center of the thing the hotspot points at, not its contact point with the floor. H2 floats at mid height in the empty corner on purpose. H4 sits on the far half of the rug so it never collides with the toast or the Change room tile at the bottom center. Re-measure all six positions from your locked stills and update the manifest. H1 and H6 never change the counter; only H2, H3, H4, and H5 earn pieces.

The safe area holds for viewport aspect ratios from about 1.5 to 1.92. Outside that range the page uses the edge pan rule in C4 so every hotspot can still be reached.

### B4. Screen wireframes

Title card:

```
+----------------------------------------------------------------+
|                  [))]  FOR THE FULL EXPERIENCE                 |
|                        TURN ON YOUR SOUND                      |
|                                                                |
|                   SENSE              PRESENTS                  |
|                   FILL                    THE                  |
|                   ROOM                    TAP                  |
|                   O        N        C        E                 |
|                                                                |
|                  Furnish your room at real size.               |
|                  Approve once. Software does the shopping.     |
|                                                                |
|                         [ door  Enter ]                        |
+----------------------------------------------------------------+
```

Room with HUD (the world tilts with the mouse, the tiles never do):

```
+----------------------------------------------------------------+
| [bag 0/4]                                            [ basket ]|
|                                                                |
|   (phone)                        ~ paint patch ~               |
|      o            (mic)                                        |
|                     o                                          |
|  windowsill                    empty floor                     |
|                                                                |
|      +--------------------------------------+                  |
|      | (icon)  Pick up your phone           |            [))]  |
|      |         and get started              |                  |
|      +--------------------------------------+                  |
+----------------------------------------------------------------+
```

Found reveal:

```
+----------------------------------------------------------------+
|                        Y O U   F O U N D                       |
|                        YOUR PHONE                              |
|                                                                |
|                      [ phone cut-out, tilted 15 deg ]          |
|                                                                |
|                 +------------------------------+               |
|                 |           ( icon )           |               |
|                 |  You set a budget. Sense     |               |
|                 |  will never spend past it.   |               |
|                 |         [ OPEN IT ]          |               |
|                 +------------------------------+               |
+----------------------------------------------------------------+
   background: the room, pushed in, blurred, under a dark veil
```

The Basket page (scrolls, about 4.5 viewports tall):

```
|cover|  [ torn label: Basket ]                                  [ X ]
|strip|  Ask for what the room needs. Nothing is
|     |  bought until you approve once.                 1. A lamp for the reading corner
|     |  [bag 1/4 pieces]  Budget: $2,500               ~~~~~~~~~~~~~~~~~~~~~~~~ (underline draws)
|     |                                                  +--------------------+
|     |   (pen doodle)                                   | taped instant photo|  [tag: shop, $189]
|     |                                                  +--------------------+
|     |  2. . . . . . . . . . . . .
|     |  +- - - - - - - - - -+                                      (blue pen curl)
|     |  |  [ Go to CHOOSE ] |
|     |  +- - - - - - - - - -+
|     |                                                 3. . . . . . . . . . . .
|     |   (yellow highlighter zigzag)                   +- - - - - - - - - -+
|     |                                                 |  [ Go to CHOOSE ] |
|     |  4. . . . . . . . . . . . .                     +- - - - - - - - - -+
|     |  +- - - - - - - - - -+
|     |  |[Go to APPROVE ONCE]|          TOTAL  $189 of $2,500 (mono, counts up as pieces land)
|     |  +- - - - - - - - - -+
```

Facade carousel:

```
+----------------------------------------------------------------+
|                         C H A P T E R   I I                    |
|                         CHOOSE                                 |
|                                                                |
|              ===== striped awning, moss =====                  |
|  (<-)        | leaf |   room seen inside   | leaf |       (->) |
|              |      |   wide 16:9 window   |      |            |
|              ==================================                |
|                                                                |
|                      [ door  Enter the room ]            [))]  |
+----------------------------------------------------------------+
   stucco wall with drifting tree shadows; trucks sideways with motion blur
```

Fabric lens:

```
+----------------------------------------------------------------+
| [<-]                                                  [ basket ]|
|                  paint patch (accent of this colorway)         |
|            +------------------------------------+              |
|            |          sofa, hero close-up       |              |
|            |        ( lens shows NEXT fabric )  |              |
|            +------------------------------------+              |
|      +----------------------------------+                      |
|      | (hand) Click the sofa,           |                [))]  |
|      |        unveil its fabrics        |                      |
|      +----------------------------------+                      |
+----------------------------------------------------------------+
```

Approve once (top-down close-up of the phone on the oak windowsill):

```
+----------------------------------------------------------------+
| [<-]                                                  [ basket ]|
|                 +---------------------+                        |
|                 |   phone, 6 deg tilt |                        |
|                 |                     |                        |
|                 |   4 pieces          |                        |
|                 |   4 shops           |                        |
|                 |   $2,214 of $2,500  |                        |
|                 |                     |                        |
|                 |  [  APPROVE ONCE  ] |   step 1: one tap      |
|                 |   ( fingerprint )   |   step 2: hold, ring fills
|                 +---------------------+                        |
|   +--------------------------------------------+               |
|   | paper note: handwritten basket summary     |         [))]  |
+----------------------------------------------------------------+
after the ring fills: phone flips face down, UI hides, four receipts slide in
```

Receipts reel (DOM receipts over the face-down phone still):

```
   +---------------+  +---------------+  +---------------+  +---------------+
   | SHOP 1        |  | SHOP 2        |  | SHOP 3        |  | SHOP 4        |
   | Arc lamp      |  | Sofa          |  | Wool rug      |  | Armchair      |
   | $189.00       |  | $1,240.00     |  | $420.00       |  | $365.00       |
   | one-time no.  |  | one-time no.  |  | one-time no.  |  | one-time no.  |
   | .... 4417     |  | .... 9052     |  | .... 1386     |  | .... 7720     |
   | [PAID stamp]  |  | [PAID stamp]  |  | [PAID stamp]  |  | [PAID stamp]  |
   +---------------+  +---------------+  +---------------+  +---------------+
   each slides in from a different edge, 0.9s apart, rotated -6 to +5 deg
```

Finale page:

```
|cover|                One tap. The room is yours.   (script, blue ink)
|     | [photo 1]   1. A lamp for the reading corner
|     |                         2. A sofa you can fall asleep on      [photo 2]
|     |             3. A rug that ties it together
|     | [photo 3]               4. A chair for the window             [photo 4]
|     |                                                          [fabric cut-out]
|     |  +----------------------------+     One approval, four shops.  (script)
|     |  | taped demo video poster    |     You approve the basket once with your
|     |  |                            |     face or fingerprint. Software then buys
|     |  | [play]                     |     each piece at its own shop. Every shop
|     |  +----------------------------+     gets a stand-in number that works once.
|     |                                     [ bag  Try the demo ]
|     |                                     [ arrow  Share ]
|     |
|     |   (stamp) Approve once    (stamp) One-time numbers    (stamp) Budget enforced
```

### B5. Copy deck (placeholder, swap freely)

Voice-over and subtitle lines, each short enough for one subtitle row. The number is also the audio file name.

| # | File | Moment | Line |
|---|---|---|---|
| 1 | vo_01 | Opening shot, line 1 | Every empty room is a question. |
| 2 | vo_02 | Opening shot, line 2 | Say what it needs. |
| 3 | vo_03 | Lamp appears | There it is. At real size. |
| 4 | vo_04 | First landing inside Chapter II | Choose as long as you like. |
| 5 | vo_05 | Right after line 4 | Nothing is bought yet. |
| 6 | vo_06 | Approve, right after the tap | One tap. That is the only yes. |
| 7 | vo_07 | Approve, when the ring completes | Now put the phone down. |
| 8 | vo_08 | Receipt 1 slides in | Four shops. |
| 9 | vo_09 | Receipt 2 slides in | Four one-time numbers. |
| 10 | vo_10 | Receipt 4 slides in | Your real card number stays with you. |

All on-screen strings. Together with the title lockup in the B4 wireframe, this is every word on the page. Put them all in the manifest.

| Where | String |
|---|---|
| Title card | SENSE / PRESENTS / FILL / THE / ROOM / TAP / ONCE. Notice: For the full experience turn on your sound. Body: Furnish your room at real size. Approve once. Software does the shopping. Button: Enter |
| Onboarding toast | Pick up your phone and get started |
| Found reveal H1 | Eyebrow: You found. Title: Your phone. Card: You set a budget. Sense will never spend past it. Button: Open it |
| Found reveal H5 | Eyebrow: You chose. Title: The armchair. Card: You added a piece. {n} left to fill the room. Button: See the basket |
| Reward card after a piece | You added a piece. {n} left to fill the room. Button: See the basket. When n is 0: The room is full. One approval is all that is left. Button: See the basket |
| Basket page | Label: Basket. Description: Ask for what the room needs. Nothing is bought until you approve once. Counter: {n}/4 pieces. Budget: $2,500. Total: TOTAL ${sum} of $2,500. Empty slot buttons: Go to ASK, Go to CHOOSE, Go to APPROVE ONCE |
| HUD | Change room. Enter the room |
| Chapter labels | Chapter I, ASK. Chapter II, CHOOSE. Chapter III, APPROVE ONCE |
| Ask interaction | Note: A lamp for this corner. Warm. Not too tall. Tile: Hold to ask. Dimension label: 152 cm, real size |
| Fabric lens | Toast: Click the sofa, unveil its fabrics. Tile: Pick this one. Fabric names: Oat boucle, Rust boucle, Cobalt boucle, Moss boucle |
| Piece viewer | Hint: Tap to explore. Facts card: Flat-woven wool, 200 by 300 cm. Four border colors. $420 from Shop 3. Tile: Add to basket |
| Locked approve hotspot | Fill the room first: {n} pieces to go |
| Approve scene | 4 pieces. 4 shops. $2,214 of $2,500. Button: Approve once. Ring caption: Hold to confirm it is you. Paper note: 4 pieces, 4 shops, under budget |
| Receipts | Shop name, piece name, price, caption: one-time number, masked digits, stamp: PAID |
| Card after the receipts | The room is yours. Four shops were paid and none of them saw your card. Button: See how it worked |
| Finale | Title: One tap. The room is yours. Section title: One approval, four shops. Paragraph: You approve the basket once with your face or fingerprint. Software then buys each piece at its own shop. Every shop gets a stand-in number that works once. Tiles: Try the demo, Share, Link copied. Stamps: Approve once, One-time numbers, Budget enforced |

The four asks written into the Basket in handwriting: 1. A lamp for the reading corner. 2. A sofa you can fall asleep on. 3. A rug that ties it together. 4. A chair for the window.

Demo numbers: lamp $189, sofa $1,240, rug $420, armchair $365, total $2,214, budget $2,500. Shop names are placeholders (Shop 1 to Shop 4); use your demo merchants. One-time numbers are shown masked with only four digits (4417, 9052, 1386, 7720), never as a full card-length number.

### B6. How the story maps to Visa Intelligent Commerce

This keeps the page's claims accurate. Visa's developer page describes four parts: tokenization (a payment token specific to agents), authentication (passkey setup and cardholder verification), payment instructions (the platform checks that each credential request matches what the user authenticated, and sets network-level controls), and signals (commerce data for disputes). On the page: the stand-in number is the agent token, the face or fingerprint moment is the passkey, and the budget line is a payment instruction. Visa also lists an MCP server for wiring these APIs into agent workflows.

Say "built with Visa Intelligent Commerce in sandbox" only if that is true for your demo. Do not draw or generate the Visa logo; if the track allows logo use, place the official file from Visa's brand resources in code, never from an image model.

---

## Part C. Design tokens and component specs for Sense

The roles match the reference. The colors and fonts are Sense's own. The easing curves are the standard quint, expo, quart, and back curves, which is also what the reference relies on. Paste this block into `src/styles/tokens.css`.

```css
:root {
  /* color roles */
  --field: #0D1457;        /* title card, floods, wipes */
  --paper-card: #FBF4E4;   /* toasts and reward cards */
  --paper-page: #EFE8CF;   /* basket and finale pages */
  --paper-tile: #FFFFFF;   /* HUD tiles, buttons */
  --cover: #8C9AE8;        /* book cover strip on pages */
  --ink: #111111;
  --highlight: #2457E6;    /* key words, script titles, progress */
  --subtitle: #FFE14A;
  --veil-top: rgba(0, 0, 0, 0.25);   /* veil gradient, top */
  --veil-bottom: rgba(0, 0, 0, 0.5);  /* veil gradient, bottom */
  --accent-ask: #2F5BD8;     /* chapter I, cobalt */
  --accent-choose: #2F9E4A;  /* chapter II, moss */
  --accent-approve: #E0462E; /* chapter III, tomato */
  --fabric-rust: #C4552D;
  --fabric-cobalt: #2F5BD8;
  --fabric-moss: #2F9E4A;
  --fabric-oat: #D9C9A8;

  /* type */
  --font-ui: "Work Sans", system-ui, sans-serif;      /* 400 and 700 */
  --font-script: "Reenie Beanie", "Caveat", cursive;  /* handwriting */
  --font-mono: "Sometype Mono", ui-monospace, monospace; /* receipts, totals */
  --track-title: 4px;
  --track-eyebrow: 9px;

  /* motion */
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-slide: cubic-bezier(0.55, 0, 0.1, 1);
  --ease-pop: cubic-bezier(0.19, 1.51, 0.29, 0.99);
  --ease-exit: cubic-bezier(0.71, 0.01, 0.81, -0.51);
  --ease-shake: cubic-bezier(0.36, 0.07, 0.19, 0.97);
  --t-fast: 0.3s;
  --t-base: 0.5s;
  --t-slow: 1s;
  --t-page: 1.2s;
  --t-truck: 1.6s;
}
```

### C1. Type scale

| Element | Size | Weight | Tracking | Notes |
|---|---|---|---|---|
| Title card rows | 6vh | 700 | 4px | Uppercase. Column 40vw, min 320px, max 560px. Rows 1 and 2 use justify-content: space-between on two words. Row 3 spreads letters with space-between. Row pitch 12vh |
| Title card eyebrow row | 3vh | 700 | 4px | SENSE at left, PRESENTS at right |
| Title card body, sound notice | 1.9vh | 400 | normal | Notice is uppercase |
| Chapter and reveal eyebrow | max(12px, 1.7vh) | 700 | 9px | Uppercase, white |
| Chapter and reveal title | max(24px, 3.45vh) | 700 | 4px | Line-height 1.5 |
| Card text | 16px / 19.2px | 400 | normal | Key words in --highlight |
| Tile and button labels | 14px | 400 | normal | Buttons inside cards are uppercase |
| Subtitles | 18px | 400 | normal | --subtitle, 1px black outline through four text-shadows, 40px from the bottom |
| Basket label | 48px | 400 | normal | On the torn label, rotated -5 deg |
| Basket description | 20px | 400 | normal | |
| Handwritten asks | 44px script | 400 | normal | Ink black, underline 2px |
| Finale script title | 62px script | 400 | normal | --highlight |
| Finale restated lines | 24px | 400 | normal | Numbered, zigzag |
| Receipts | 13px mono | 400 | normal | |

### C2. Components

Paper tile (HUD and buttons): white, radius 4px, no border, 47 to 50px square when it only holds an icon, 48px tall with padding 0 18px when it has a label, icon 24px with a 1.5px black hand-drawn stroke, gap 10px. Each instance takes its own rest rotation from this list: counter +1.5 deg, basket -2 deg, sound -9 deg, change room -1.5 deg, close +2 deg, back -4 deg. Hover: the top-right corner peels. Build the peel with a clip-path that cuts a 14px triangle off the corner plus a pseudo-element triangle filled with a light gray gradient and a soft shadow, animated from 0 to 14px in 0.3s with --ease-out; the tile rotates 1 extra degree. Press: scale 0.96 for 0.1s. Entrance: the tileEnter keyframes in C3, 0.5s with --ease-pop, 60ms stagger. Each tile sets --rest to its rest rotation and sets --enter-x or --enter-y to 120% toward its nearest screen edge, so the entrance never erases the rotation.

Toast and reward card: --paper-card, radius 4px, padding 12px 27px, rotate -2 deg, shadow 0 0 4px rgba(0,0,0,0.25). Toast layout puts the 62px white icon circle at the left and two lines of text at the right. Reward layout stacks the icon circle, two centered lines, and a button. Entrance: translateY(140%) to 0 with --ease-pop in 0.8s. Exit: translateY(140%) with --ease-exit in 0.5s. When one card replaces another, leave a 0.9s gap. A 28px round white close button sits on the top-right corner of dismissible cards.

Card button: white, square corners, 43px tall, padding 0 18px, uppercase 14px, rest rotation -0.6 deg, wiggle keyframes (0% and 20% to 100% at -0.59 deg, 5% at -5 deg, 10% at +5 deg, 15% at -5 deg) on a 4s loop.

Hotspot: 46px button, white blob (an SVG circle with slightly irregular radius), 36px icon, invisible 93px hit area. Two pseudo-element rings with a 1px rgba(255,255,255,0.6) border run a 2s pulse from scale 1 and opacity 1 to scale 2.2 and opacity 0, the second ring delayed by 1s. Loading state: the icon fades and the blob shrinks to a 20px dot while a 1.5px ring spins. Visited state: a 22px white circle with a check mark and no rings. Locked state: fingerprint icon at 50% opacity with a small lock; a click plays the shake keyframes for 0.6s with --ease-shake.

Arrow buttons: 46px white circles with a 1px hand-drawn arrow, vertically centered, 20px from the left and right edges, disabled state 40% opacity.

Instant photo card: white border frame with aspect 900:1078, the square image inset 4.5% from the top at 77.5% of the height, a faint paper noise overlay, shadow 0 6px 18px rgba(0,0,0,0.35). Tape strip: use K_tape_1 to K_tape_3 when they exist; the fallback is a 120x34px rectangle in rgba(255,255,255,0.55) with a slightly ragged clip-path. Either way rotate it -4 to +6 deg. While the piece viewer is open, the image inside the top photo runs slowZoom over 8s, alternating.

Progress cursor (ask hold, fabric lens, approve hold): a 46px white dot following the pointer with 0.12 lerp, a 2px --highlight ring drawn with stroke-dashoffset to show progress.

Animation wrappers: hotspots are positioned by a per-frame transform, and paper elements carry a rest rotation. Never run shakeX, lineBoil, wiggle, or ringPulse on those elements themselves. Put the animation on an inner wrapper so it cannot overwrite the position or the rotation.

### C3. Keyframes to include

```css
@keyframes ringPulse { from { opacity: 1; transform: translate(-50%, -50%) scale(1); }
                       to   { opacity: 0; transform: translate(-50%, -50%) scale(2.2); } }
@keyframes lineBoil  { 0%, 100% { opacity: 1;   transform: translate(0, 0) rotate(0deg); }
                       25%      { opacity: 0.8; transform: translate(-0.2px, 0.2px) rotate(-1deg); }
                       50%      { opacity: 0.9; transform: translate(0.2px, -0.2px) rotate(1deg); }
                       75%      { opacity: 0.7; transform: translate(-0.2px, -0.2px) rotate(0deg); } }
@keyframes slowZoom  { from { transform: scale(1); } to { transform: scale(1.1); } }
@keyframes underlineDraw { from { background-size: 0% 2px; } to { background-size: 100% 2px; } }
@keyframes wiggle    { 0%, 20%, 100% { transform: rotate(-0.59deg); }
                       5%, 15% { transform: rotate(-5deg); } 10% { transform: rotate(5deg); } }
@keyframes shakeX    { 10%, 90% { transform: translateX(-0.5px); } 20%, 80% { transform: translateX(1px); }
                       30%, 50%, 70% { transform: translateX(-2px); } 40%, 60% { transform: translateX(2px); } }
@keyframes tileEnter { from { opacity: 0; transform: translate(var(--enter-x, 0), var(--enter-y, -120%)) rotate(var(--rest, 0deg)); }
                       to   { opacity: 1; transform: translate(0, 0) rotate(var(--rest, 0deg)); } }
@keyframes spin      { to { transform: rotate(360deg); } }
```

Run lineBoil with `steps(1)` timing at 0.5s per loop so it reads as hand-drawn frames, not as a smooth wobble. The underline is a `linear-gradient(var(--ink), var(--ink))` background with no-repeat, positioned at 0 100%, animated by underlineDraw with fill mode forwards. The spin keyframes drive the hotspot loading ring and the spinner inside the Enter tile.

### C4. Camera rig and transition timings

| Item | Value |
|---|---|
| Idle zoom | 1.32 on the full still, so an 8 degree roll plus travel never shows an edge (cos 8 + 16/9 sin 8 = 1.24, plus 0.08 for travel) |
| Roll | mouseX (-1 to 1) times 8 deg, clockwise when the mouse is on the right. The reference reaches 10 to 12 deg because it is true 3D; 8 deg keeps the 2.5D stills inside their bleed |
| Sideways travel | mouseX times 4% of viewport width, opposite to the mouse |
| Vertical travel | mouseY times 3% of viewport height |
| Depth parallax (if a depth map exists) | UV offset = (depth - 0.5) times mouse times 0.015 |
| Damping | lerp 0.04 per frame at 60fps, frame-rate corrected |
| Title to scene | 2.0s crossfade through black |
| Opening dolly back | 2.5s, --ease-slide, from scale 2.6 centered on the empty corner to the idle zoom of 1.32 |
| Found reveal | the rig (roll, travel, parallax) eases to 0 in 0.4s and stays at 0 for the whole reveal; the world pushes to 1.25 times the idle zoom while the hotspot point moves halfway toward the screen center, clamped so the still always covers the viewport, in 1.2s --ease-expo; blur and veil 0 to 1 in 0.8s; eyebrow at 0.4s; title at 0.7s; cut-out at 0.9s (0.55s fade, scale 0.92 to 1 with --ease-pop, rotated in CSS by 15 deg for the phone and 10 deg for the chair); card at 1.6s |
| Page slide in | 1.2s --ease-slide from translateX(100%) rotate(-4deg) over a 0.35s flood of --field |
| Fly out | 3.0s: world scale from inside to outside over 0 to 2.0s with --ease-slide, zoom blur 0 to 1 to 0 peaking at 45%, labels fade in at 2.6s |
| Truck | 1.6s --ease-slide, horizontal blur 0 to 1 to 0 peaking at 50% |
| Fly in | 0.3s anticipation (3 deg of extra roll with total roll clamped to 8 deg, scale 0.98), 1.4s dive with zoom blur, 0.5s settle with a trace of horizontal blur |
| Facade cover factor | each facade module covers the viewport times 1.4, so the anticipation and the roll never show a module edge |
| Fabric wipe | 0.9s --ease-slide, radius from 90px to 1.5 times the viewport diagonal, feather from 60px to 200px |
| Card deal | 0.7s --ease-pop each, 80ms stagger, random rest rotation between -14 and +10 deg |
| Card shuffle | top card moves 115% of its width to the right with +12 deg in 0.22s, z-order swaps, returns under the stack in 0.28s --ease-out |
| Receipts | each slides in over 0.8s with --ease-pop and its PAID stamp scales from 1.6 to 1 in 0.25s. Receipt 1 enters when VO 8 starts, receipt 2 when VO 9 starts, receipt 3 enters 0.9s after receipt 2 with no line, receipt 4 when VO 10 starts. 1.5s after VO 10 ends the last reward card rises, and its button slides the finale in |
| Interaction close-ups | A1a, A1b, the four fabric stills, and the phone pair render flat: cover fit at zoom 1.0 with roll, travel, and parallax eased to 0. Their DOM overlays are fixed to the screen and placed with the same cover-fit math |
| Edge pan | when the viewport aspect is below 1.5 or above 1.92, part of the safe area falls off screen. In that case widen the travel range on the cropped axis so that moving the pointer to a screen edge brings the matching safe-area edge at least 8% inside the viewport, clamp it so the still always covers the viewport, and scale the roll down by the same ratio. On touch, a drag does the same with the same clamp |
| Video clips | when a D10 clip exists it replaces the shader move. Ease the rig to 0 first, play the clip at the playback rate that fits the C4 duration (a 5s clip plays at 2x for a 2.5s move), scale the UI cues to match, and cut to the live stage on the last frame |

Reduced motion: when `prefers-reduced-motion` is set, turn off roll, travel, parallax, zoom blur, and truck blur, and replace every camera move with a 0.4s crossfade.

---
## Part D. Higgsfield prompt pack

### D0. Setup, so Claude Code can generate assets too

Higgsfield's own CLI page gives three steps: install with `npm i -g @higgsfield/cli`, sign in with `higgsfield auth login` (it opens a browser window), then add the companion skills with `npx skills add higgsfield-ai/skills`. After that you can ask Claude Code to generate images and videos and save them into `public/assets/`. Third-party guides also describe a hosted MCP server added with `claude mcp add --transport http --scope user higgsfield https://mcp.higgsfield.ai/mcp`; check Higgsfield's own docs for that address before you run it. Generations spend credits, and video costs far more than images, so lock every still before you render any video.

Model choice, kept general because the roster changes often: for the master still use the best photoreal image model in your plan (Higgsfield lists Soul, Seedream, GPT Image, and Nano Banana Pro). For every edit of an existing still use a model that accepts reference images and follows "change only this" instructions (Higgsfield highlights Nano Banana Pro for reference-driven work), or the brush-based Edit Image tool. For video use Cinema Studio or image to video with a model that exposes both a start frame and an end frame, and choose a single dolly move in the camera controls.

### D1. The consistency workflow (read this first)

The whole page depends on images that line up with each other. The before and after of the room, the three colored windows, and the four sofa fabrics are all the same picture with one thing changed. Image models drift when you re-prompt from scratch, so never do that for a variant.

1. Generate R1a, the master plate, until you love it. Upscale it to 3840x2160.
2. Make every other room still by editing R1a or its descendant with the master attached as the reference: R1a to R1b to R2 to R3.
3. Make one fabric hero still, then make the other three fabrics by editing that one still.
4. Make one facade module, then make the other two colors by editing that one module.
5. After each edit, stack the new image over its parent at 50% opacity in any editor. Walls, floor lines, and window edges must not double. If they do, regenerate the edit.
6. Reject any image with invented text, fake logos, extra furniture, warped perspective, or mismatched light direction.

### D2. STYLE block (paste at the top of every still prompt)

```
STYLE: Interior photograph with a soft painterly finish, like a scanned medium format film print. Soft overcast daylight enters from a large window on the left wall, with long gentle shadows falling to the right and no hard sun patches. Warm white matte plaster walls with a slight hand-troweled texture, pale oak plank floor running toward the back wall, tall plain white baseboard. Straight-on one-point perspective with the back wall perfectly parallel to the camera, camera height 1.2 meters, 28mm lens look, everything in focus, subtle film grain, slightly lifted blacks. Muted neutral palette with exactly one saturated accent color: {ACCENT}. No people, no animals, no text, no letters, no numbers, no logos, no brand marks, no watermark. Aspect ratio 16:9.
```

Accent values: cobalt blue for Chapter I, moss green for Chapter II, tomato red for Chapter III.

### D3. Room stills

R1a, saved as rooms/R1a.avif (Chapter I before, the master plate, accent cobalt blue). New generation.

```
{STYLE with ACCENT = cobalt blue}
An empty living room on moving-in day, composed with generous bleed: everything important sits inside the central 64% of the image width and the central 70% of its height, and the outer margins show only more wall, ceiling, and floor, because the web page zooms in by about 1.3 and tilts the picture. The back wall spans from 24% to 76% of the image width, the left and right walls recede symmetrically to the frame edges, the ceiling line sits at 14% from the top, and the floor meets the back wall at 60% from the top. On the left wall, the deep reveal of a large window with a sheer white curtain and a thick oak windowsill at hip height, the sill ending at 22% from the left edge. A modern smartphone lies flat on that windowsill, screen dark, at 20% from the left edge and 55% from the top. On the back wall, right of center, a rough hand-rolled rectangular paint test patch in cobalt blue spanning from 47% to 63% of the image width and from 22% to 52% of the image height, with uneven roller edges and two small drips, as if someone is choosing a wall color. A bare light bulb on a twisted cloth cord hangs from the ceiling at the center, ending at 20% from the top. The back left corner of the floor, around 30% from the left edge, is completely empty and evenly lit. One closed plain cardboard moving box with no printing sits on the floor at 66% from the left edge and 70% from the top. Nothing else in the room.
```

R1b, saved as rooms/R1b.avif (Chapter I after the lamp is placed). Edit of R1a with R1a as the reference image.

```
Use the reference image as the exact base. Keep the camera, walls, floor, window, curtain, phone, paint patch, bulb, moving box, light, and film grain pixel-identical. Add only one object: a slim brass arc floor lamp with a white linen drum shade standing in the back left corner, its round base on the floor at 30% from the left edge and 63% from the top. The lamp is 152 cm tall in a room with a 270 cm ceiling, so the top of its arc reaches a little over half the wall height. The lamp is switched on and throws a soft warm pool of light on the wall behind it and a faint shadow to the right. Do not move, restyle, or relight anything else.
```

R2, saved as rooms/R2.avif (Chapter II, accent moss green). Edit of R1b.

```
Use the reference image as the exact base and keep the camera, architecture, window, curtain, phone, arc lamp, bulb, light direction, and grain pixel-identical. Make only these changes. 1: repaint the rough paint test patch on the back wall from cobalt blue to moss green, same shape and drips. 2: remove the cardboard moving box and show clean oak floor in its place. 3: add a three-seater sofa with a low oak frame and deep loose cushions in warm oat-colored boucle, centered against the back wall at 50% from the left edge, spanning from 36% to 64% of the image width, with its seat cushions at 58% from the top, so the green paint patch rises behind its back cushions. 4: add a flat-woven wool rug, 200 by 300 cm, off-white with a thin moss green border line, lying on the floor in front of the sofa and centered at 50% from the left edge and 76% from the top, its far edge tucked slightly under the sofa. Soft contact shadows under the new pieces that match the existing light from the left.
```

R3, saved as rooms/R3.avif (Chapter III, accent tomato red). Edit of R2.

```
Use the reference image as the exact base and keep everything pixel-identical except these changes. 1: repaint the paint test patch from moss green to tomato red, same shape and drips. 2: change the thin border line of the rug from moss green to tomato red. 3: add one lounge armchair with a slender oak frame and a tomato red linen seat and back cushion, standing on the floor at 71% from the left edge and 66% from the top, turned about 30 degrees toward the sofa, with a soft contact shadow falling to the right. The phone stays on the windowsill. Nothing else changes.
```

A1a and A1b, saved as rooms/A1a.avif and rooms/A1b.avif (the full-screen close-up pair for the ASK interaction). Generate A1a with R1a attached as the reference. Then make A1b by editing A1a with R1b attached as a second reference, so the lamp matches. These two render flat with no zoom, so compose them edge to edge with no bleed.

```
A1a: {STYLE with ACCENT = cobalt blue} Same room as the reference image, camera moved closer to the empty back left corner: the corner where the back wall meets the left wall sits at 38% from the left edge, the oak floor takes the bottom 30% of the frame, a slice of the cobalt blue paint patch is visible at the far right edge, the edge of the sheer curtain is visible at the far left. The corner is empty, calm, and evenly lit. Override the lens in the style block: use a 35mm lens look here, camera height 1.2 meters.

A1b (edit of A1a): Keep everything pixel-identical. Add only the slim brass arc floor lamp with a white linen drum shade, identical to the lamp in the second reference image (R1b), standing in the corner with its base on the floor at 40% from the left edge, 152 cm tall, switched on, warm glow on both walls, faint shadow to the right.
```

### D4. Fabric hero set (four pixel-aligned stills for the lens interaction)

FAB_oat, saved as fabric/FAB_oat.avif. New generation with R2 attached as a style reference. The fabric stills render flat with no zoom, so compose them edge to edge with no bleed.

```
{STYLE with ACCENT = moss green} but closer: 50mm lens look, camera 1.0 meter high and 2.2 meters from the sofa, back wall still parallel to the camera. A three-seater sofa with a low oak frame and deep loose cushions upholstered in warm oat boucle, centered, filling 70% of the frame width, standing on pale oak floor with the near edge of an off-white wool rug across the bottom 12% of the frame. Behind the sofa the rough hand-rolled moss green paint patch covers most of the wall seen above the back cushions, with uneven roller edges visible at the left and right. A folded chunky knitted throw in moss green hangs over the right arm of the sofa. On the floor at the left, a stack of three large books with plain moss green linen covers and a plain white ceramic mug on top. Only the wall is slightly soft, the sofa is crisp.
```

FAB_rust, FAB_cobalt, FAB_moss, saved next to FAB_oat. Three edits of FAB_oat, each with this prompt and its own values.

```
Use the reference image as the exact base. Keep the sofa shape, every cushion fold, the oak frame, the rug, the mug, the floor, the framing, the light, and the grain pixel-identical. Change only three colors. Sofa upholstery becomes {FABRIC}. The paint patch on the wall becomes {PATCH}. The knitted throw and the three book covers become {PROPS}. Do not add or remove any object.

rust version:   FABRIC = rust orange boucle,  PATCH = cobalt blue,  PROPS = cobalt blue
cobalt version: FABRIC = cobalt blue boucle,  PATCH = tomato red,   PROPS = tomato red
moss version:   FABRIC = moss green boucle,   PATCH = warm oat,     PROPS = warm oat
```

Order on the page: oat, rust, cobalt, moss, then back to oat.

### D5. Square photos for instant-photo cards (1:1, export 1200x1200)

```
P_lamp: Square photograph of the same room as R1b (attach R1b as the reference). The brass arc lamp with white linen shade glowing in the corner at dusk-blue hour, warm pool of light on the plaster wall, a slice of cobalt blue paint patch at the right edge. Soft painterly film print finish, subtle grain. No text, no logos.

P_sofa: Square photograph, three-quarter view of the oak-framed sofa in warm oat boucle against the plaster wall with the moss green paint patch behind it, knitted throw on the arm, soft daylight from the left, film print finish. No text, no logos.

P_rug_1: Square top-down photograph of an off-white flat-woven wool rug with a thin moss green border line lying on pale oak floor, one corner folded back to show the weave underside, soft daylight, film print finish.
P_rug_2: Square macro photograph of the same rug's weave with a thin tomato red border line, raking light from the left showing the wool texture, shallow depth of field.
P_rug_3: Square photograph of the rug with its moss green border line in the room under the front legs of the oak-framed oat sofa, camera low at 40 cm, soft daylight from the left.
P_rug_4: Square photograph of the same rug with a thin cobalt blue border line, rolled up and leaning against the warm white plaster wall beside the window with the sheer curtain, tied with plain cotton string, oak floor.

P_chair: Square photograph of the slender oak lounge armchair with tomato red linen cushions beside the window, sheer curtain moving slightly, tomato red paint patch soft in the background, film print finish. No text, no logos.
```

Card accents for the piece viewer, stored in the manifest so the Add to basket tile can color-sync: facts card uses the highlight blue, P_rug_1 moss, P_rug_2 tomato, P_rug_3 moss, P_rug_4 cobalt. P_sofa is always oat. When the shopper picks another fabric in the lens, the basket and the finale show a centered square crop of that FAB still instead of P_sofa, so no extra images are needed. The room stills keep the oat sofa; if you have credits left, make R3_rust, R3_cobalt, and R3_moss as edits of R3 and let the manifest swap them in.

### D6. Approve scene (top-down pair)

```
T3_phone_up (this pair renders flat with no zoom, so compose it edge to edge): Top-down photograph with the camera exactly perpendicular to a thick oak windowsill. A modern smartphone with a plain dark bezel lies screen-up in the center, rotated 6 degrees clockwise, in portrait orientation, taking up about 19% of the frame width and 75% of the frame height. The screen is on and shows one completely flat, evenly lit off-white color with no interface, no icons, no text, and no reflections, because the interface is added later in code. Oak grain runs left to right. Soft daylight comes from the top of the frame and the phone casts a gentle shadow toward the bottom. The white painted window frame runs along the top 10% of the image and the hem of a sheer curtain touches the sill at the top right. No hands, no logos, no text. Painterly film print finish, subtle grain. 16:9.

T3_phone_down (edit of T3_phone_up): Keep everything pixel-identical. Change only the phone: it now lies screen-down in the same position and rotation, showing a plain matte graphite back with one small camera lens at its top left corner and no logo or marking.
```

After you lock T3_phone_up, measure the screen rectangle (center, width, height, rotation) and put it in the asset manifest so the HTML interface lands exactly on the screen.

### D7. Facade modules (three pixel-aligned stills) and the shadow loop

F_mod_cobalt. New generation.

```
Perfectly frontal, flat, elevation-style photograph of a sun-washed exterior wall of an old apartment building. Hand-troweled stucco in pale apricot with subtle water stains and hairline cracks fills the entire frame edge to edge, with no ground, no sky, no roof, and no neighboring windows. In the exact center there is one wide rectangular picture window with 16:9 proportions. Its opening spans from 32% to 68% of the image width and from 30% to 66% of the image height, and the opening itself is pure flat black because it will be replaced in compositing. The window has a deep-set wooden casement frame 8 cm thick, painted glossy cobalt blue with slightly chipped paint. Its two window leaves are opened outward and lie flat against the wall to the left and right of the opening like shutters, painted the same cobalt blue. Above the window a short canvas awning with cobalt blue and cream stripes projects slightly and casts a soft shadow band on the wall beneath it. Below the window a narrow pale stone sill carries one small terracotta pot of trailing greenery at its far right end. The outer 12% of the image on the left and on the right is plain stucco with no features. Even, soft daylight. Painterly film print finish, subtle grain. No text, no house numbers, no logos, no people. Aspect ratio 16:9.
```

F_mod_moss and F_mod_tomato. Edits of F_mod_cobalt.

```
Use the reference image as the exact base and keep the wall, stains, cracks, sill, plant, geometry, light, and grain pixel-identical. Change only the paint color of the window frame, the two open window leaves, and the colored stripes of the awning from cobalt blue to {moss green | tomato red}. The black opening stays pure black.
```

V_shadow_loop, saved as video/V_shadow_loop.mp4 (6s, 16:9, no audio). Used as a multiply overlay on the facade at about 35% opacity.

```
Locked-off shot of a plain white wall filling the frame. Soft, out-of-focus shadows of tree branches and leaves sway slowly across the wall in a light breeze. High key, gentle contrast, calm and slow. No objects, no camera movement, no light changes other than the moving shadows. The motion at the end matches the motion at the start so the clip can loop.
```

### D8. Cut-outs (generate on a flat backdrop, remove the background with Higgsfield's editing tools or any background remover, export PNG or WebP with alpha, 1600px on the long side)

```
X_phone: Studio product photograph of a modern smartphone with a plain dark bezel, perfectly upright with no tilt, seen straight from the front, screen showing one flat off-white color with no interface, soft even light from the top left, no shadow on the backdrop, flat solid mid-gray backdrop, no logos, no text.

X_chair: Studio product photograph of a slender oak lounge armchair with tomato red linen seat and back cushions, three-quarter front view, standing level with no tilt, soft even light from the top left, flat solid mid-gray backdrop, no shadow on the backdrop.

X_swatch: Top-down studio photograph of a rectangular upholstery fabric swatch in cobalt blue boucle with pinked zigzag edges, slightly curled at one corner, strong texture detail, soft raking light, flat solid mid-gray backdrop.
```

Add the drop shadow and the tilt in CSS, not in the image (C4 sets 15 degrees for the phone and 10 for the chair).

### D9. Paper kit

```
K_paper: Flat top-down scan of a sheet of heavy cream writing paper, very subtle fibers and tooth, even lighting, no folds, no stains, no text, no lines. Seamless and uniform enough to tile. 4096 by 4096.

K_label: Flat top-down scan of a strip of white paper torn by hand along both short ends, with soft fibrous torn edges, on a flat solid mid-gray backdrop, no text. 3:1.

K_tape: Flat top-down scan of three separate strips of translucent matte paper masking tape with slightly ragged cut ends, arranged side by side with space between them, on a flat solid mid-gray backdrop, no text.

K_doodles_black: A sheet of eight separate small hand-drawn doodles in black ballpoint pen on pure white paper, arranged in a 4 by 2 grid with generous spacing: a loose spiral scribble, a floor lamp sketch with a vertical measurement arrow beside it, a sofa outline, a rough floor plan rectangle with tick marks, a curly arrow, a starburst, an underline flourish, a circled check mark. Quick confident lines with natural pen pressure, no shading, no text, no numbers, no color. High resolution scan.

K_doodles_color: A sheet of four separate marks on pure white paper with generous spacing: a loose loop in blue ballpoint pen, a zigzag in yellow highlighter, a short dry brush smear in cobalt blue paint, a crayon scribble in tomato red. No text. High resolution scan.
```

Cut the tape sheet and both doodle sheets into single WebP files with alpha: K_tape_1 to K_tape_3, and K_doodle_01 to K_doodle_12 (01 to 08 black, 09 to 12 color). Place the doodles with `mix-blend-mode: multiply`. The ghost handwriting in the page background needs no asset: Claude Code renders a few lines in the script font, mirrored, blurred 1.5px, at 6% opacity.

### D10. Video clips (16:9, 5s unless noted, no audio, 1080p, start and end frames from your locked stills)

Every clip is optional. Each one has a fallback in Part E (a shader move, a wipe, or a still swap), and a clip replaces its fallback when the file exists. Ask for 5s clips; the page speeds them up to fit the C4 timings. The live room sits at zoom 1.32, so start and end frames are crops, not full stills: the idle view is the central 75.8% of a room still (1 divided by 1.32), and the opening close shot is a 38.5% crop (1 divided by 2.6).

```
V_intro_pullback. Start frame: the 38.5% wide 16:9 crop of R1a centered on u 0.30, v 0.52 (upscale R1a first). End frame: the central 75.8% crop of R1a.
Slow, perfectly straight dolly out, with a gentle ease in and a gentle ease out. No rotation, no handheld shake. The room and the light stay completely static and nothing moves except the camera.

V_lamp_appears. Start frame: A1a. End frame: A1b. Locked-off camera.
In the empty corner, thin glowing dotted construction lines draw the outline of a tall arc floor lamp at full real-world size from the floor upward. The outline then fills in and becomes the real brass lamp, which switches on with a warm glow. Nothing else in the room changes.

V_flyout_1, V_flyout_2, V_flyout_3. Start frame: the central 75.8% crop of the chapter's room still (R1b for chapter I, R2, R3; while R1a is still showing the page uses the shader move). End frame: a screenshot of that chapter's facade from the built page with the room visible inside the window.
The camera flies straight backwards with increasing speed, passes out through the open window frame, and settles on a frontal view of the exterior stucco wall with the window centered. Strong natural motion blur at peak speed. The interior stays static. The shot ends perfectly still.

V_phone_down (4s). Start frame: T3_phone_up. End frame: T3_phone_down. Top-down locked-off camera.
A hand enters from the bottom right, turns the phone over, lays it face down on the oak windowsill in the same spot, and leaves the frame. Calm, unhurried, natural motion.

V_room_gold (8s, the clip behind the finale poster until your real demo video exists). Start frame: the central 75.8% crop of R3.
Very slow push in toward the sofa. The sheer curtain breathes in a light breeze, dust motes drift through the light, and the daylight warms gradually toward golden hour. No people. Nothing else moves.
```

### D11. Voice and sound

Generate the ten lines from B5 with Higgsfield's voiceover tool or any text to speech you already use. Direction: calm, warm, unhurried, close to the microphone, a hint of a smile, natural pauses, no music. Export one m4a file per line, mono, normalized, named vo_01 to vo_10 as in B5. Also gather these, each as m4a: roomtone (30s loopable room tone with faint street ambience, starts on Enter and ducks under voice lines), sfx_paper_slide (cards, toasts, and pages arriving), sfx_paper_tear (a page or card leaving), sfx_pen (handwriting), sfx_shutter (card shuffle), sfx_whoosh (fly out, truck, fly in), sfx_stamp (each PAID stamp), and sfx_chime (the approval completing).

### D12. Export specs and names

Stills: 3840x2160, AVIF or WebP at quality 60 to 70, under 600KB each. Squares: 1200x1200. Cut-outs: 1600px long side with alpha. Videos: 1920x1080 mp4 (H.264), under 3MB each, muted, with playsinline. The shadow loop: 1280x720. Optional depth maps for the four room stills: same name plus `_depth`, 8-bit grayscale PNG, white is near. They are not a Higgsfield job: ask Claude Code to produce them with a depth estimation model (for example Depth Anything V2 small through the Python transformers pipeline). Skip them if that is not available; the roll and travel carry the effect without them.

```
public/assets/
  rooms/    R1a.avif R1b.avif R2.avif R3.avif A1a.avif A1b.avif  (optional: R1a_depth.png R1b_depth.png R2_depth.png R3_depth.png)
  fabric/   FAB_oat.avif FAB_rust.avif FAB_cobalt.avif FAB_moss.avif
  photos/   P_lamp.avif P_sofa.avif P_rug_1.avif P_rug_2.avif P_rug_3.avif P_rug_4.avif P_chair.avif
  approve/  T3_phone_up.avif T3_phone_down.avif
  facade/   F_mod_cobalt.avif F_mod_moss.avif F_mod_tomato.avif
  cutouts/  X_phone.webp X_chair.webp X_swatch.webp
  paper/    K_paper.avif K_label.webp K_tape_1.webp K_tape_2.webp K_tape_3.webp K_doodle_01.webp to K_doodle_12.webp
  video/    V_shadow_loop.mp4 V_intro_pullback.mp4 V_lamp_appears.mp4 V_flyout_1.mp4 V_flyout_2.mp4 V_flyout_3.mp4 V_phone_down.mp4 V_room_gold.mp4
  audio/    vo_01.m4a to vo_10.m4a roomtone.m4a sfx_paper_slide.m4a sfx_paper_tear.m4a sfx_pen.m4a sfx_shutter.m4a sfx_whoosh.m4a sfx_stamp.m4a sfx_chime.m4a
```

---
## Part E. Claude Code prompts

### E1. Kickoff prompt (paste this first)

````
You are building the Sense landing page. Read docs/SENSE_LANDING_SPEC.md completely before writing any code. Part A describes how the reference behaves. Part B is what we are building. Part C holds the exact tokens, component specs, and timings. Part D lists the assets and their file names. Follow Parts B and C exactly. Do not copy any asset, text, or code from the reference site.

STACK
Vite, TypeScript, three.js, GSAP, Lenis for the two scrolling pages, Howler for audio. No UI framework and no router. If this repo is already a React or Next app, build the same modules as one client-only component instead.

ARCHITECTURE
1. One fixed full-screen canvas behind one fixed <main class="ui"> layer. The body never scrolls.
2. Renderer: three.js, orthographic camera, world units equal CSS pixels, device pixel ratio capped at 1.6, one requestAnimationFrame loop, resize aware.
3. Scene graph: a `world` group that receives the damped mouse roll and travel from C4. Inside it a `facadeStrip` group holds three facade module planes side by side, one per chapter. Each module covers the viewport times the facade cover factor from C4 (1.4). Each module's material cuts a rectangular alpha hole at the window rect from the manifest (2px feather) and multiplies V_shadow_loop over the wall at 35%. Each module parents one `roomPlane` that fills its window rect exactly with the chapter's current 16:9 room still.
4. Two camera poses, both expressed as a scale and position of `world`. OUTSIDE(i): scale 1, window i centered. INSIDE(i): scale chosen so window i's rect covers the viewport times the idle zoom (1.32) in both dimensions. Hide the facade planes while inside and fade them in over 0.15s when a fly out starts, so no frame edge can peek in during a roll. Implement the edge pan rule from C4 for viewports with an aspect ratio below 1.5 or above 1.92.
5. Transitions are tweens between poses with the C4 timings. Fly out and fly in tween the pose while the post pass animates zoom blur. The truck tweens world x by one module width while the post pass animates horizontal blur. Because the room is parented inside the window, the fly through needs no cut.
6. Interaction close-ups (A1a, A1b, the four FAB stills, T3_phone_up, T3_phone_down) are different: they render flat on a separate full-screen plane, cover fit at zoom 1.0, with roll, travel, and parallax eased to 0. Their DOM overlays are fixed to the screen and placed with a `projectFlat(u, v)` helper that uses the same cover-fit math.
7. Room and close-up material uniforms: uTexA, uTexB, uDepth (optional), uParallax (vec2), uReveal (vec3: center uv and radius), uFeather, uTrail (array of 6 vec3 for the lens trail). It mixes A and B by the reveal mask. When a depth map exists it offsets UVs by (depth - 0.5) * uParallax.
8. Post pass on a render target: zoom blur toward a focus point (12 taps), horizontal blur (12 taps), focus blur (9 tap disc), a veil gradient from --veil-top to --veil-bottom, exposure for fades from black, film grain. Every strength is a 0 to 1 uniform driven by GSAP.
9. What moves with the world and what does not. Projected every frame with one `project(u, v, moduleIndex)` function that applies the same scale, translation, and roll as the world: hotspots, each window's ChapterLabel, and each window's entry tile. Fixed to the screen and never tilted: all HUD tiles including Change room, the arrow buttons, toasts, cards, subtitles. While a toast or card is visible the Change room tile slides out, and it returns when the toast leaves.
10. A finite state machine is the single source of truth: BOOT, TITLE, INTRO_VO, ROOM(ch), FOUND(item), INTERACTION(kind), REWARD, BASKET, FLYOUT, FACADE(ch), TRUCK, FLYIN, APPROVE, RECEIPTS, FINALE. Input is ignored while a transition runs. Progress (pieces collected, fabric chosen) lives in a small store.
11. Data lives in src/data/manifest.ts: asset paths, chapters, accents, hotspots with u and v, the window rect (x 0.32, y 0.30, w 0.36, h 0.36 until measured), the phone screen rect for the approve scene, prices, shop names, the piece viewer card accents from D5, demoUrl for the Try the demo tile, demoVideo for the finale poster, and every string from B4 and B5.
12. Missing assets must never block work. If a file in the manifest does not exist, generate a canvas texture with a flat tint, a grid, and the asset name in large type, and log one warning.

FILES
src/main.ts, src/state/machine.ts, src/state/store.ts, src/data/manifest.ts,
src/gl/Stage.ts, src/gl/World.ts, src/gl/FlatPlane.ts, src/gl/PostFX.ts, src/gl/materials/room.ts, src/gl/materials/facade.ts, src/gl/placeholder.ts,
src/ui/TitleCard.ts, Tile.ts, Toast.ts, RewardCard.ts, Hotspot.ts, Subtitles.ts, ChapterLabel.ts, FoundReveal.ts, BasketPage.ts, FinalePage.ts, PieceViewer.ts, AskInteraction.ts, FabricLens.ts, ApproveInteraction.ts, ReceiptsReel.ts, ProgressCursor.ts, icons.ts,
src/audio/sound.ts, src/styles/tokens.css, base.css, components.css, pages.css

QUALITY BARS
Use the easing curves and durations from Part C, never browser defaults. Every paper element has its own small rest rotation, and looping animations run on inner wrappers as C2 requires. Icons are hand-drawn looking SVG paths with a 1.5px stroke, drawn by you. Fonts load from Google Fonts: Work Sans 400 and 700, Reenie Beanie, Sometype Mono. Honor prefers-reduced-motion as described in C4. Every hotspot and tile is a real button with an aria-label and a visible focus ring. On touch devices replace the mouse rig with a gentle device-orientation tilt when permission is granted, otherwise a slow idle sway, and let a drag pan the room inside the clamp from the edge pan rule. Below 768px wide, cards take 88vw and the basket slots stack in one column. This page never asks for the microphone, the camera, or any payment data. The ask, the fingerprint hold, and the receipts are simulations driven by timers.

Start with milestone M1 only. Stop after each milestone, tell me how to see it, and wait.
````

### E2. Milestone prompts (send one at a time)

````
M1. Stage, world, and rig. Build Stage, World, FlatPlane, PostFX, placeholders, and the manifest. Show chapter I's room at the INSIDE pose with the damped roll and travel from C4 and film grain. Add a debug panel (toggle with the D key) with sliders for every post uniform, buttons for fly out, truck left, truck right, and fly in, and a Fill basket button that marks all four pieces as earned. Done when I can fly between all three windows with blur and the placeholders stay glued together at several window sizes, including 966x695 and an ultra-wide window.
````

````
M2. Title card and opening. Build TitleCard with the exact lockup from A2 and C1, the Sense copy from the B4 wireframe, and the timings in C4: the corner-peel Enter tile with its spinner, the 2s crossfade through black, the Subtitles component, and the opening move that starts at scale 2.6 on the empty corner, plays vo_01 and vo_02 with subtitles, then dollies back to the idle zoom in 2.5s. If video/V_intro_pullback.mp4 exists, use it under the video clip rule in C4. Add the sound tile and Howler with a global mute. Start roomtone on Enter and duck it under every voice line.
````

````
M3. HUD, hotspots, found reveal. Build Tile, Toast, Hotspot with all four states from C2, the onboarding toast, and FoundReveal following A5 and the found reveal row in C4: rig to 0, push, blur, veil, eyebrow, title, cut-out, reward card with the wiggling button. H1 uses cutouts/X_phone and H5 uses cutouts/X_chair, tilted in CSS as C4 says. Until M6 exists, H2, H3, and H4 also open a plain FoundReveal with a placeholder cut-out so every piece can be earned. Earned hotspots turn into check marks and the counter tile updates. H1 and H6 never change the counter. Play sfx_paper_slide when a toast or card arrives.
````

````
M4. Basket page. Build BasketPage following A6, the B4 wireframe, and the page slide row in C4: field flood, page slide in, cover strip, K_paper as the page texture, the label on K_label, description, sticky counter, budget line, four zigzag slots with empty and filled states, doodles from K_doodle_01 to K_doodle_12 with lineBoil, ghost handwriting background, a mono running total that counts up, Lenis scroll, deep links from empty slots to their chapter, and the close tile. The write-on sequence for a newly earned slot: clip the script text open from left to right at about 14 characters per second with sfx_pen, then underlineDraw, then the arrow, then the instant photo with the pop ease and a K_tape strip (CSS strip as the fallback), then the shop tag with the price. Slot photos: slot 1 P_lamp, slot 2 P_sofa or a centered square crop of the chosen FAB still, slot 3 P_rug_3, slot 4 P_chair. Opening the page after earning a piece scrolls to that slot before it writes. Play sfx_paper_slide when the page arrives and sfx_paper_tear when it leaves.
````

````
M5. Facade. Replace the debug buttons with the real thing: the Change room tile and the arrow buttons fixed to the screen, and a ChapterLabel plus an entry tile projected with each window so they travel with it during a truck. Fly out, truck, and fly in follow A8 to A10 and C4, including the 0.3s anticipation before a fly in, each with sfx_whoosh. Swap a chapter's room still when its state changes (R1a to R1b after the lamp). Play vo_04 and vo_05 with subtitles the first time the user lands inside chapter II. If a V_flyout clip exists for the chapter, use it under the video clip rule in C4.
````

````
M6. Interactions, all on the flat plane from E1 item 6. AskInteraction: crossfade to A1a, a paper note at the bottom with the handwritten ask, and a Hold to ask tile. Holding it fills the ProgressCursor ring in 1.2s and releasing early drains it. There is no microphone access; the hold is a timer. On completion reveal A1b through a circular wipe that grows from the lamp base (about u 0.40, v 0.75 on A1a) while SVG dimension lines draw with stroke-dashoffset and the label from B5 appears, then play vo_03 and show the reward card. If video/V_lamp_appears.mp4 exists, play it in place of the wipe and end on A1b. FabricLens: follow A14 with the four fabric stills from D4 in the order FAB_oat, FAB_rust, FAB_cobalt, FAB_moss. The lens radius is 90px with a 60px feather and a 6-point lagging trail, and the ProgressCursor replaces the pointer. A click runs the fabric wipe from C4. After the user has seen all four, show a Pick this one tile. It earns piece 2, stores the fabric, tints the sofa tag in the basket with that fabric color, and writes the fabric name under the handwritten ask. Room stills keep the oat sofa unless the manifest lists R3 variants. PieceViewer for the rug: follow A11 and the card deal and shuffle rows in C4 with the four P_rug photos and the facts card from B5, sfx_shutter on each shuffle, and an Add to basket tile whose background crossfades to the accent of whichever card is on top, using the card accents in the manifest.
````

````
M7. Approve once and receipts, on the flat plane. ApproveInteraction on T3_phone_up: place an HTML phone interface exactly over the measured screen rect with the same 6 degree rotation, using projectFlat. It shows the summary from B5 and one Approve once button. Step 1 is a single tap, then vo_06. Step 2 replaces the button with a fingerprint glyph inside a ring drawn by the same SVG ring component as the ProgressCursor, placed on the phone screen. Holding the pointer on it fills the ring in 1.2s and releasing early drains it. When it completes, play sfx_chime and vo_07, swap to T3_phone_down (or play video/V_phone_down.mp4), hide all UI, and run ReceiptsReel with the receipts row in C4: DOM receipts in the mono font with masked one-time numbers, sfx_stamp on each PAID stamp, and vo_08 to vo_10 as subtitles. Then show the card after the receipts from B5, and its button opens the finale. If the user opens H6 before 4/4, play shakeX on the hotspot's inner wrapper and show the locked toast with the number of pieces left. Nothing on this page sends data anywhere.
````

````
M8. Finale and polish. FinalePage per A15 and the B4 wireframe: slide in from the right like the basket page, script title, the four restated asks that fill from gray to ink as they scroll into view, four scattered photos (P_lamp, the sofa photo used in the basket, P_rug_3, P_chair) plus cutouts/X_swatch, the taped poster showing R3 with a play tile that opens manifest.demoVideo in a full-screen overlay (V_room_gold until the real demo exists, and no play tile if neither exists), the Try the demo tile linking to manifest.demoUrl, the Share tile that copies the URL and swaps its label for 2 seconds, and the three-stamp strip under both tiles. Then polish: preload per chapter, audio ducking, reduced motion, keyboard access, touch behavior, a Lighthouse pass, and a final sweep comparing every timing against C4.
````

### E3. Acceptance checklist

1. The title lockup justifies to both column edges and scales with viewport height.
2. Moving the mouse tilts the world up to 8 degrees, the HUD stays level, and no picture edge ever shows at any window size.
3. Hotspots stay glued to their objects during tilt, push, and fly moves, and every hotspot can be reached at 966x695 and on an ultra-wide window.
4. The found reveal plays in this order: push and blur, eyebrow, title, cut-out, card.
5. The basket page writes a new line with handwriting, underline, arrow, photo, and tag, in that order.
6. Fly out, truck, and fly in are continuous moves with blur, never cuts or fades.
7. Chapter labels and entry tiles travel with their window during a truck, while the arrows and HUD tiles stay put.
8. The fabric lens previews the next fabric and a click wipes the whole scene from the cursor.
9. The approve hotspot shakes and refuses before 4/4, and the approval needs one tap plus one hold.
10. The receipts show four shops and four masked one-time numbers, and never a full card number.
11. With reduced motion set, every move becomes a short crossfade and nothing tilts.
12. No file, string, or image from the reference site exists in the repo, and the page requests no microphone, camera, or payment data.

---

## Part F. Build order, risks, and notes

### Build order for a hackathon clock

Work in two lanes. Lane one is Claude Code running M1 to M8 on placeholders. Lane two is asset generation in this order: R1a, then R1b, R2, R3, then the facade module and its two recolors, then T3_phone_up and T3_phone_down, then A1a and A1b, then the fabric set, then the square photos and cut-outs, then the paper kit, then audio, and video last. After M5 you already have the demo spine: title, room, found reveal, basket, fly out, carousel, fly in. M7 is the beat that carries the Visa story, so if time runs short, build M7 before M6. That works because M3 lets H2, H3, and H4 earn their pieces through a plain found reveal, and the debug panel has a Fill basket button.

### Risks and fallbacks

| Risk | Fallback |
|---|---|
| Edited stills drift and do not line up | Use brush-based Edit Image on just the changed region, or composite the new object over the parent still in any editor |
| Facade window is not a clean rectangle | Set the rect by hand in the manifest and widen the feather, or paint the opening black yourself |
| Fabric stills misalign by a few pixels | Widen the lens feather, or recolor one still in code with a hue shift inside a sofa mask |
| Video clips warp the room | Skip them. Every clip has a fallback in Part E |
| Text appears inside generated images | Regenerate. All words on this page come from HTML |
| Laptop GPU struggles | Drop the pixel ratio cap to 1.25 and halve the blur taps behind a quality flag |

### Notes on brand and claims

Keep the reference as inspiration for behavior only, and keep every pixel and word your own. Do not generate or redraw any logo. Describe the payment model in plain words first (one approval, software shops at several shops, each shop gets a number that works once), and name Visa Intelligent Commerce only in the way your demo really uses it. The approve scene is a simulation and must never collect real card data.

---

## Sources

- Reference studied in the browser: https://immersivebags.miumiu.com/en/
- Higgsfield CLI setup: https://higgsfield.ai/cli
- Higgsfield feature overview: https://geo.higgsfield.ai/higgsfield-ai-features-full-guide-2026
- Higgsfield image to video page: https://higgsfield.ai/image-to-video-ai
- Higgsfield overview by The Rundown: https://www.therundown.ai/tools/higgsfield
- Third-party guide to the Higgsfield MCP server: https://techsy.io/en/blog/higgsfield-mcp-claude-code
- Visa Intelligent Commerce for developers: https://developer.visa.com/capabilities/visa-intelligent-commerce
