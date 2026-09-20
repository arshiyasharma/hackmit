// Single source of data for the Sense landing page: asset paths, chapters,
// hotspots, rects, prices, and every on-screen string (spec B3 to B5, D5, D12).

export const ASSET_BASE = "/assets";

export type ChapterIndex = 0 | 1 | 2 | 3;
export type PieceId = "lamp" | "sofa";
export type FabricId = "oat" | "rust" | "cobalt" | "moss";
export type HotspotId = "H1" | "H2" | "H3" | "H6";
export type IconName =
  | "phone" | "mic" | "swatch" | "photo" | "chair" | "fingerprint"
  | "bag" | "basket" | "sound" | "mute" | "door" | "close" | "back"
  | "arrowLeft" | "arrowRight" | "check" | "lock" | "hand" | "play"
  | "share" | "rooms" | "curvedArrow";

export interface Rect { x: number; y: number; w: number; h: number }

export interface Hotspot {
  id: HotspotId;
  chapter: ChapterIndex;
  icon: IconName;
  u: number;
  v: number;
  label: string;
  earns?: PieceId;
}

export interface Piece {
  id: PieceId;
  slot: 1 | 2;
  name: string;
  ask: string;
  price: number;
  shop: string;
  masked: string;
  photo: string;
  chapter: ChapterIndex;
}

export const manifest = {
  idleZoom: 1.32,
  introZoom: 2.6,
  facadeCover: 1.4,
  maxRollDeg: 8,
  travelX: 0.04,
  travelY: 0.03,
  damping: 0.04,
  parallax: 0.015,
  safeArea: { u0: 0.18, u1: 0.82, v0: 0.15, v1: 0.85 },

  // The rig is drawn for 16:9. A phone held upright is aspect 0.46, four times
  // outside the 1.5 to 1.92 the safe area holds for, and cover fitting a 16:9
  // still there throws away three quarters of the room's width. Below "from"
  // the framing eases toward a width fit and lets the paper show above and
  // below, reaching it at "until"; "bleed" keeps a sliver of still past both
  // sides so a roll never cuts the room off square.
  portrait: { from: 1.5, until: 0.8, bleed: 1.06 },

  // 16:9 rect the room plane fills inside every facade module, in module uv
  // from the top left. Measured from the locked facade stills: it covers the
  // real opening, which is keyed out of the wall by its black pixels.
  windowRect: { x: 0.3215, y: 0.344, w: 0.357, h: 0.357 } as Rect,

  // phone screen inside T3_phone_up, in image uv: center, size, clockwise degrees
  // measured from the locked T3_phone_up still
  phoneScreen: { cx: 0.4981, cy: 0.5533, w: 0.127, h: 0.4795, rot: -19.5 },

  // where the lamp base sits on A1a, origin of the reveal wipe
  lampBase: { u: 0.305, v: 0.82 },
  introFocus: { u: 0.3, v: 0.52 },

  demoUrl: "/landing?product",
  demoVideo: "video/V_room_gold.mp4",
  budget: 2500,

  chapters: [
    { index: 0, numeral: "I", name: "ASK", accent: "#2F5BD8", facade: "facade/F_mod_cobalt.avif", flyout: "video/V_flyout_1.mp4" },
    { index: 1, numeral: "II", name: "CHOOSE", accent: "#2F9E4A", facade: "facade/F_mod_moss.avif", flyout: "video/V_flyout_2.mp4" },
    { index: 2, numeral: "III", name: "YOUR ROOM", accent: "#E0462E", facade: "facade/F_mod_tomato.avif", flyout: "video/V_flyout_3.mp4" },
    { index: 3, numeral: "IV", name: "ABOUT US", entryLabel: "Our story", accent: "#E2705F", facade: "facade/F_mod_coral.avif", flyout: "video/V_flyout_3.mp4" },
  ] as const,

  rooms: {
    R4: "about/title-card",
    R1a: "rooms/R1a.avif",
    R1b: "rooms/R1b.avif",
    R2: "rooms/R2.avif",
    R3: "rooms/R3.avif",
    A1a: "rooms/A1a.avif",
    A1b: "rooms/A1b.avif",
  },
  // optional R3 variants per fabric; empty means the room keeps the oat sofa
  roomFabricVariants: {} as Partial<Record<FabricId, string>>,

  fabrics: [
    { id: "oat", name: "Oat boucle", color: "#D9C9A8", still: "fabric/FAB_oat.avif" },
    { id: "rust", name: "Rust boucle", color: "#C4552D", still: "fabric/FAB_rust.avif" },
    { id: "cobalt", name: "Cobalt boucle", color: "#2F5BD8", still: "fabric/FAB_cobalt.avif" },
    { id: "moss", name: "Moss boucle", color: "#2F9E4A", still: "fabric/FAB_moss.avif" },
  ] as { id: FabricId; name: string; color: string; still: string }[],

  approve: { up: "approve/T3_phone_up.avif", down: "approve/T3_phone_down.avif" },
  intro: {
    line: "intro/LINE_room.webp",
    watercolor: "intro/WC_room.avif",
    lamp: "intro/X_luxo.webp",
  },
  cutouts: { phone: "cutouts/X_phone.webp", chair: "cutouts/X_chair.webp", swatch: "cutouts/X_swatch.webp" },
  paper: {
    page: "paper/K_paper.avif",
    label: "paper/K_label.webp",
    tapes: ["paper/K_tape_1.webp", "paper/K_tape_2.webp", "paper/K_tape_3.webp"],
    doodles: Array.from({ length: 12 }, (_, i) => `paper/K_doodle_${String(i + 1).padStart(2, "0")}.webp`),
  },
  video: {
    shadow: "video/V_shadow_loop.mp4",
    intro: "video/V_intro_pullback.mp4",
    lamp: "video/V_lamp_appears.mp4",
    phoneDown: "video/V_phone_down.mp4",
    gold: "video/V_room_gold.mp4",
  },

  // piece viewer stack (D5): the accent drives the Add to basket tile
  rugCards: [
    { kind: "facts", accent: "#265EB0" },
    { kind: "photo", src: "photos/P_rug_1.avif", accent: "#2F9E4A" },
    { kind: "photo", src: "photos/P_rug_2.avif", accent: "#E0462E" },
    { kind: "photo", src: "photos/P_rug_3.avif", accent: "#2F9E4A" },
    { kind: "photo", src: "photos/P_rug_4.avif", accent: "#2F5BD8" },
  ] as ({ kind: "facts"; accent: string } | { kind: "photo"; src: string; accent: string })[],

  // The onboarding demonstrates one piece per room across chapters I and II;
  // chapter III is where the shopper actually approves and buys.
  pieces: [
    { id: "lamp", slot: 1, name: "Arc lamp", ask: "A lamp for the reading corner", price: 189, shop: "Shop 1", masked: "4417", photo: "photos/P_lamp.avif", chapter: 0 },
    { id: "sofa", slot: 2, name: "Sofa", ask: "A sofa you can fall asleep on", price: 1240, shop: "Shop 2", masked: "9052", photo: "photos/P_sofa.avif", chapter: 1 },
  ] as Piece[],

  // positions measured from the locked Higgsfield stills (spec B3 asks for this)
  hotspots: [
    { id: "H1", chapter: 0, icon: "phone", u: 0.19, v: 0.62, label: "Pick up your phone" },
    { id: "H2", chapter: 0, icon: "mic", u: 0.3, v: 0.52, label: "Ask for a lamp", earns: "lamp" },
    { id: "H3", chapter: 1, icon: "swatch", u: 0.5, v: 0.68, label: "Choose the sofa fabric", earns: "sofa" },
    { id: "H6", chapter: 1, icon: "fingerprint", u: 0.19, v: 0.62, label: "Approve once" },
  ] as Hotspot[],

  vo: [
    { file: "audio/vo_01.m4a", line: "Every empty room is a question." },
    { file: "audio/vo_02.m4a", line: "Say what it needs." },
    { file: "audio/vo_03.m4a", line: "There it is. At real size." },
    { file: "audio/vo_04.m4a", line: "Choose as long as you like." },
    { file: "audio/vo_05.m4a", line: "Nothing is bought yet." },
    { file: "audio/vo_06.m4a", line: "One tap. That is the only yes." },
    { file: "audio/vo_07.m4a", line: "Now put the phone down." },
    { file: "audio/vo_08.m4a", line: "Two shops." },
    { file: "audio/vo_09.m4a", line: "Two one-time numbers." },
    { file: "audio/vo_10.m4a", line: "Your real card number stays with you." },
  ],

  sfx: {
    roomtone: "audio/roomtone.m4a",
    paperSlide: "audio/sfx_paper_slide.m4a",
    paperTear: "audio/sfx_paper_tear.m4a",
    pen: "audio/sfx_pen.m4a",
    shutter: "audio/sfx_shutter.m4a",
    whoosh: "audio/sfx_whoosh.m4a",
    stamp: "audio/sfx_stamp.m4a",
    chime: "audio/sfx_chime.m4a",
  },

  strings: {
    about: {
      question: "What if shopping started with your room?",
      problem: "You find a sofa you love. Then come the measurements, the budget, and all the open tabs. We wanted to bring those decisions back into the room.",
      product: "Tell PIXX-AR what your room needs. Start with a photo, explore real furniture listings, and preview your ideas with your budget in view. One place to see how the pieces could come together.",
      steps: [
        { title: "Start with your space", body: "A room photo gives your search a place to begin." },
        { title: "Explore the possibilities", body: "Turn a simple request into furniture previews and real product options." },
        { title: "Bring the pieces together", body: "Review choices across stores, with fit and budget in the picture." },
      ],
      tracksTitle: "Targeted Tracks",
      tracksNote: "A space for our final track selections and how PIXX-AR addresses each challenge.",
      // Replace these placeholders with the final challenge names and write-ups.
      // The Visa mark is the original image supplied by the team.
      tracks: [
        { sponsor: "Visa", logo: "about/visa-logo.png", title: "Challenge to be added", body: "Our selected challenge and project details will go here." },
        { sponsor: "Track 02", logo: "", title: "Track to be added", body: "Our selected challenge and project details will go here." },
        { sponsor: "Track 03", logo: "", title: "Track to be added", body: "Our selected challenge and project details will go here." },
      ],
      journeyTitle: "One weekend. A whole new perspective.",
      journey: [
        { title: "The question", body: "Could shopping feel more connected to the spaces we live in?" },
        { title: "The build", body: "Room photos, furniture previews, and real listings came together, one piece at a time." },
        { title: "The next step", body: "A prototype to share, feedback to learn from, and plenty left to explore." },
      ],
      galleryTitle: "Fun Moments",
      galleryNote: "The people behind the prototype. The moments between the commits.",
      // Add photos under public/assets/about/photos, set each src to
      // "about/photos/your-file.webp", and write its descriptive alt text.
      gallery: [
        { title: "The team", src: "", alt: "" },
        { title: "At the build table", src: "", alt: "" },
        { title: "The first prototype", src: "", alt: "" },
        { title: "Around HackMIT", src: "", alt: "" },
        { title: "In between the coding", src: "", alt: "" },
        { title: "A moment together", src: "", alt: "" },
        { title: "Demo time", src: "", alt: "" },
        { title: "Behind the scenes", src: "", alt: "" },
        { title: "One for the memories", src: "", alt: "" },
      ],
      photoPlaceholder: "Photo coming soon",
      signature: "Made at HackMIT 2026.",
      closeAria: "Back to the rooms",
    },
    intro: {
      name: "PIXX-AR",
      deck: "Point your phone at your room and see real furniture standing in it, at *real size*.",
      action: "Fill the room. Tap once.",
      enter: "Enter",
      notice: "For the full experience, turn on your sound",
    },
    title: {
      notice: ["For the full experience", "turn on your sound"],
      eyebrow: ["SENSE", "PRESENTS"],
      rows: [["FILL", "THE"], ["ROOM", "TAP"]],
      spread: "ONCE",
      body: ["Furnish your room at real size.", "Approve once. Software does the shopping."],
      enter: "Enter",
    },
    onboarding: ["Pick up your phone", "and get started"],
    found: {
      H1: { eyebrow: "You found", title: "Your phone", card: "You set a *budget*. PIXX-AR will *never spend past it*.", button: "Open it" },
      H5: { eyebrow: "You chose", title: "The armchair" },
      H2: { eyebrow: "You asked for", title: "The arc lamp" },
      H3: { eyebrow: "You chose", title: "The sofa" },
      H4: { eyebrow: "You chose", title: "The wool rug" },
    },
    reward: {
      piece: "You added *a piece*. *{n} left* to fill the room.",
      full: "*The room is full.* One approval is all that is left.",
      button: "See the basket",
    },
    basket: {
      label: "Basket",
      description: "Ask for what the room needs. *Nothing is bought* until you *approve once*.",
      counter: "{n}/2 pieces",
      budget: "Budget: $2,500",
      total: "TOTAL ${sum} of $2,500",
      goTo: ["Go to ASK", "Go to CHOOSE", "Go to YOUR ROOM"],
    },
    hud: { changeRoom: "Change room", enterRoom: "Enter the room", skip: "Skip the tour", skipAria: "Skip the tour and go straight to the product", openProduct: "Open PIXX-AR", openProductAria: "Open PIXX-AR, the real product" },
    ask: { note: "A lamp for this corner. Warm. Not too tall.", tile: "Hold to ask", dimension: "152 cm, real size" },
    lens: { toast: ["Click the sofa,", "unveil its fabrics"], tile: "Pick this one" },
    viewer: { hint: "Tap to explore", facts: "Flat-woven wool, 200 by 300 cm. Four border colours. $420 from Shop 3.", tile: "Add to basket" },
    locked: "Fill the room first: {n} pieces to go",
    approve: {
      lines: ["2 pieces", "2 shops", "$1,429 of $2,500"],
      button: "Approve once",
      ring: "Hold to confirm it is you",
      note: "2 pieces, 2 shops, under budget",
    },
    receipt: { caption: "one-time number", stamp: "PAID" },
    afterReceipts: { card: "*The room is yours.* Every shop was paid and *none of them saw your card*.", button: "See how it worked" },
    finale: {
      title: "One tap. The room is yours.",
      sectionTitle: "One approval, every shop.",
      paragraph: "You approve the basket once with your face or fingerprint. Software then buys each piece at its own shop. Every shop gets a stand-in number that works once.",
      demo: "Open PIXX-AR",
      share: "Share",
      copied: "Link copied",
      stamps: ["Approve once", "One-time numbers", "Budget enforced"],
    },
  },
};

export const asset = (path: string) => `${ASSET_BASE}/${path}`;
export const pieceById = (id: PieceId) => manifest.pieces.find((p) => p.id === id)!;
export const money = (n: number) => `$${n.toLocaleString("en-US")}`;
