import { sound } from "./audio/sound";
import { manifest, type ChapterIndex, type Hotspot as HotspotData, type PieceId } from "./data/manifest";
import { disposeTextures } from "./gl/placeholder";
import { Stage } from "./gl/Stage";
import { gsap, wait } from "./motion";
import { machine } from "./state/machine";
import { hasOnboarded, markOnboarded, store } from "./state/store";
import { runApprove } from "./ui/ApproveInteraction";
import { runAsk } from "./ui/AskInteraction";
import { AboutPage } from "./ui/AboutPage";
import { BasketPage } from "./ui/BasketPage";
import { ChapterLabel } from "./ui/ChapterLabel";
import { Debug } from "./ui/Debug";
import { h } from "./ui/dom";
import { runFabricLens } from "./ui/FabricLens";
import { FinalePage } from "./ui/FinalePage";
import { FoundReveal } from "./ui/FoundReveal";
import { Hotspot } from "./ui/Hotspot";
import { icon } from "./ui/icons";
import { ProgressCursor } from "./ui/ProgressCursor";
import { RewardCard } from "./ui/RewardCard";
import { Subtitles } from "./ui/Subtitles";
import { Tile } from "./ui/Tile";
import { Intro } from "./ui/Intro";
import { Toast } from "./ui/Toast";
import type { Ctx, Interaction } from "./ui/types";

/** How much faster than authored every animation runs. */
const SPEED = 1.55;

/** Chapters I and II are the whole tour, approval included; chapter III is left
 *  empty for the real product, so no demo chrome belongs there. */
const PRODUCT_CHAPTER = 2;

/** Chapter IV is the About us page, which opens over its room on arrival. */
const ABOUT_CHAPTER = 3;

/** What the React shell lends the landing. The product is a React app and the
 *  landing is not, so room III asks its host to open it and waits to be told
 *  the shopper has left. */
export interface Host {
  /** Resolves when the product closes. `onCovered` fires once it hides the stage. */
  openProduct(opts: { onCovered: () => void }): Promise<void>;
}

// Entry point and conductor. The React shell calls mount() once in the browser
// and gets a destroy function back. The state machine is the single source of
// truth; this file wires states to the stage and the DOM.

class App {
  stage: Stage;
  ui: HTMLElement;
  ctx!: Ctx;
  private dead = false;
  private cleanups: (() => void)[] = [];

  private hotspots: Hotspot[] = [];
  private labels: ChapterLabel[] = [];
  private arrows!: { left: HTMLButtonElement; right: HTMLButtonElement };
  private tiles!: { counter: Tile; basket: Tile; sound: Tile; rooms: Tile; skip: Tile; open: Tile };
  private toast!: Toast;
  private reward!: RewardCard;
  private reveal!: FoundReveal;
  private basket!: BasketPage;
  private finale!: FinalePage;
  private about!: AboutPage;
  /** the running intro, exposed so a test can scrub its timeline */
  intro?: Intro;
  private cardUp = false;
  /** the product opens by itself once per visit to room III, not on every return */
  private productSeen = false;
  private saidChoose = false;
  private onboarded = false;

  constructor(private root: HTMLElement, private host?: Host) {
    root.innerHTML = "";
    const canvas = h("canvas", "sense-canvas");
    canvas.setAttribute("aria-hidden", "true");
    this.ui = h("main", "ui");
    root.append(canvas, this.ui);
    this.stage = new Stage(canvas);
  }

  async start() {
    // the tour should feel brisk, so every motion on the page runs faster
    gsap.globalTimeline.timeScale(SPEED);

    const params = new URLSearchParams(location.search);
    // ?product lands in room III with the product already open: the address the
    // old standalone screens forward to, and the one a test starts from
    const product = params.has("product");
    const about = params.has("about");
    const skip = params.has("skip") || product || about;
    this.stage.post.values.exposure = 0;
    const loaded = this.stage.init();
    sound.preload();

    const title = new Intro(this.ui);
    this.intro = title;
    this.cleanups.push(() => title.destroy());
    machine.set("TITLE");
    this.build();
    if (params.has("fill")) store.fillBasket();

    if (skip) {
      await loaded;
      if (this.dead) return;
      title.destroy();
      this.stage.post.values.exposure = 1;
      if (product) {
        store.fillBasket();
        store.set({ chapter: PRODUCT_CHAPTER });
        this.resetStage();
      } else if (about) {
        store.set({ chapter: ABOUT_CHAPTER });
        this.resetStage();
      }
      this.enterRoom();
      return;
    }

    await title.run(loaded);
    if (this.dead) return;
    machine.set("INTRO_VO");
    void sound.startRoomtone();
    this.tiles.sound.show(0.8);

    // Opening shot: the wide room, exposure up from black, voice-over over it.
    // The spec's 2.6x close-up on the empty corner (A3) magnified the still far
    // past its resolution, so it read as a soft blank wall instead of a reveal.
    // World.introPose() is still there if we ever want the dolly back.
    const { stage } = this;
    stage.setPose(stage.world.insidePose(0));
    stage.world.rigAmount = 1;
    void title.leave();
    // the paper dissolves straight into the photographed room, with no black gap
    gsap.to(stage.post.values, { exposure: 1, duration: 1.4, ease: "power1.inOut" });
    await wait(1.6);
    await this.say(1);
    await this.say(2);
    if (this.dead) return;
    this.enterRoom();
  }

  // ---- construction --------------------------------------------------------

  private build() {
    const { ui, stage } = this;
    const world = h("div", "layer");
    ui.appendChild(world);

    const subtitles = new Subtitles(ui);
    const cursor = new ProgressCursor(ui);
    this.toast = new Toast(ui);
    this.reward = new RewardCard(ui);
    this.reveal = new FoundReveal(ui);
    this.cleanups.push(() => { subtitles.destroy(); cursor.destroy(); this.toast.destroy(); this.reward.destroy(); this.reveal.destroy(); });

    this.ctx = {
      ui, stage, subtitles, cursor, toast: this.toast, reward: this.reward,
      say: (n) => this.say(n),
      enterFlat: async (a, b) => {
        gsap.to(stage.post.values, { focus: 0, veil: 0, duration: 0.6, ease: "power2.inOut" });
        await stage.flat.show(a, b ?? a, 0.6);
      },
    };

    for (const data of manifest.hotspots) {
      const spot = new Hotspot(world, data);
      spot.el.addEventListener("click", () => void this.onHotspot(spot));
      this.hotspots.push(spot);
    }
    for (const c of manifest.chapters) this.labels.push(new ChapterLabel(world, c.index, (i) => void this.flyIn(i)));

    const arrow = (side: "left" | "right") => {
      const el = h("button", `arrow ${side}`, icon(side === "left" ? "arrowLeft" : "arrowRight", 22));
      el.type = "button";
      el.setAttribute("aria-label", side === "left" ? "Previous room" : "Next room");
      el.addEventListener("click", () => void this.truck(side === "left" ? -1 : 1));
      ui.appendChild(el);
      return el;
    };
    this.arrows = { left: arrow("left"), right: arrow("right") };

    const s = manifest.strings;
    this.tiles = {
      counter: new Tile(ui, { icon: "bag", label: `0/${manifest.pieces.length}`, aria: "Pieces in the basket", rest: 1.5, from: "top", className: "hud-counter" }),
      basket: new Tile(ui, { icon: "basket", aria: "Open the basket", rest: -2, from: "top", className: "hud-basket" }),
      sound: new Tile(ui, { icon: "sound", aria: "Mute sound", rest: -9, from: "right", className: "hud-sound" }),
      rooms: new Tile(ui, { icon: "rooms", label: s.hud.changeRoom, aria: s.hud.changeRoom, rest: -1.5, from: "bottom", className: "hud-rooms" }),
      skip: new Tile(ui, { icon: "arrowRight", label: s.hud.skip, aria: s.hud.skipAria, rest: 1, from: "right", className: "hud-skip" }),
      // room III's only control of its own: the way back into the product
      open: new Tile(ui, { icon: "arrowRight", label: s.hud.openProduct, aria: s.hud.openProductAria, rest: 1, from: "right", className: "hud-skip hud-open" }),
    };
    // the tile belongs to room III, so it wears room III's colour
    this.tiles.open.color = manifest.chapters[PRODUCT_CHAPTER].accent;
    this.tiles.open.onClick(() => void this.openProduct());
    this.tiles.skip.onClick(() => void this.skipTour());
    if (hasOnboarded()) this.tiles.skip.el.classList.add("seen-before");
    this.tiles.counter.el.tabIndex = -1;
    this.tiles.sound.onClick(() => {
      const muted = !store.state.muted;
      store.set({ muted });
      sound.setMuted(muted);
      this.tiles.sound.iconName = muted ? "mute" : "sound";
      this.tiles.sound.el.setAttribute("aria-label", muted ? "Turn sound on" : "Mute sound");
    });
    this.tiles.rooms.onClick(() => void this.flyOut());
    this.tiles.basket.onClick(() => void this.openBasket());
    this.tiles.counter.onClick(() => void this.openBasket());

    // A thumb lands on the corners. Stage starts its touch pan from a pointerdown
    // on window, so the chrome swallows that one event and the room stays put
    // while a tile is pressed; pointerup still reaches Stage, which needs it.
    const holdStill = (el: HTMLElement) =>
      el.addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") e.stopPropagation(); });
    Object.values(this.tiles).forEach((tile) => holdStill(tile.el));
    holdStill(this.arrows.left);
    holdStill(this.arrows.right);

    this.basket = new BasketPage(this.ctx, (chapter) => void this.goToChapter(chapter));
    this.finale = new FinalePage(this.ctx, () => void this.goToChapter(PRODUCT_CHAPTER));
    this.about = new AboutPage(this.ctx);
    this.cleanups.push(() => { this.basket.destroy(); this.finale.destroy(); this.about.destroy(); });

    // the Change room tile slides out while a toast or card is up
    const onCard = (e: Event) => { this.cardUp = (e as CustomEvent<boolean>).detail; this.syncHud(); };
    ui.addEventListener("sense:card", onCard);
    // focusing an off-screen card must never scroll the fixed UI layer
    ui.addEventListener("scroll", () => { ui.scrollTop = 0; ui.scrollLeft = 0; });

    this.cleanups.push(store.subscribe((state, changed) => {
      if (changed.pieces) this.tiles.counter.label = `${state.pieces.length}/${manifest.pieces.length}`;
      // the chapter decides which tiles belong on screen, not just which
      // hotspots, so the HUD has to follow a room change too
      if (changed.chapter !== undefined) this.syncHud();
      this.syncHotspots();
    }) as () => void);
    this.cleanups.push(machine.subscribe(() => { this.syncHud(); this.syncHotspots(); }) as () => void);

    this.cleanups.push(stage.onFrame((dt) => {
      const chapter = store.state.chapter;
      for (const spot of this.hotspots) {
        if (spot.state === "hidden" && spot.data.chapter !== chapter) continue;
        const p = stage.world.project(spot.data.u, spot.data.v, spot.data.chapter);
        spot.place(p.x, p.y);
      }
      for (const label of this.labels) label.place(stage.world);
      cursor.update(dt);
    }) as () => void);

    const debug = new Debug(ui, stage, {
      chapter: () => store.state.chapter,
      flyOut: () => void this.flyOut(),
      flyIn: () => void this.flyIn(store.state.chapter),
      truck: (dir) => void this.truck(dir),
    });
    this.cleanups.push(() => debug.destroy());

    if (process.env.NODE_ENV !== "production") {
      // test hook: step time by hand, for tabs where requestAnimationFrame is paused
      let clock = gsap.ticker.time;
      const advance = async (seconds: number) => {
        // real frames may have ticked while the tab was visible; never rewind
        clock = Math.max(clock, gsap.ticker.time);
        for (let t = 0; t < seconds; t += 1 / 60) {
          clock += 1 / 60;
          gsap.updateRoot(clock);
          stage.frame(1 / 60, clock);
          await new Promise<void>((resolve) => { const c = new MessageChannel(); c.port1.onmessage = () => resolve(); c.port2.postMessage(0); });
        }
        return machine.state;
      };
      Object.assign(window, { __sense: { app: this, stage, machine, store, advance } });
    }
  }

  private async say(n: number) {
    await sound.vo(n, (seconds) => void this.ctx.subtitles.show(manifest.vo[n - 1].line, seconds));
  }

  // ---- HUD and hotspot sync --------------------------------------------------

  private syncHud() {
    const room = machine.is("ROOM");
    const facade = machine.is("FACADE");
    const t = this.tiles;
    const want = (tile: Tile, on: boolean, delay = 0) => { if (on !== tile.shown) { if (on) tile.show(delay); else tile.hide(); } };
    // the basket and its counter belong to the tour, so they stop at its edge
    const touring = store.state.chapter < PRODUCT_CHAPTER;
    want(t.counter, room && touring && store.state.phoneFound, 0);
    want(t.basket, room && touring && store.state.phoneFound, 0.06);
    want(t.rooms, room && !this.cardUp, 0.12);
    // Skip stays put even while a card is up: it sits in the corner, clear of
    // the toast, and hiding the way out mid-tour is exactly the wrong moment
    want(t.skip, (room || facade) && touring, hasOnboarded() ? 0 : 0.18);
    want(t.open, room && store.state.chapter === PRODUCT_CHAPTER && !this.cardUp, 0.18);
    if (!machine.is("BOOT", "TITLE")) want(t.sound, !machine.is("BASKET", "FINALE", "PRODUCT"), 0);

    const chapter = store.state.chapter;
    this.arrows.left.classList.toggle("on", facade);
    this.arrows.right.classList.toggle("on", facade);
    this.arrows.left.disabled = chapter === 0;
    this.arrows.right.disabled = chapter === manifest.chapters.length - 1;
    this.labels.forEach((l) => l.setVisible(facade || (machine.is("TRUCK") && true)));
  }

  private syncHotspots() {
    const room = machine.is("ROOM");
    const { chapter, phoneFound, approved, visited } = store.state;
    for (const spot of this.hotspots) {
      const d = spot.data;
      if (spot.state === "loading") continue;
      if (!room || d.chapter !== chapter) { spot.set("hidden"); continue; }
      if (d.id === "H1") spot.set(phoneFound ? "visited" : "idle");
      else if (d.id === "H2") spot.set(!phoneFound ? "hidden" : store.has("lamp") ? "visited" : "idle");
      // the basket length decides this, not a count: the demo is two pieces now
      else if (d.id === "H6") spot.set(approved ? "visited" : store.left > 0 ? "locked" : "idle");
      else spot.set(d.earns && store.has(d.earns) ? "visited" : visited.includes(d.id) && !d.earns ? "visited" : "idle");
    }
  }

  // ---- room ------------------------------------------------------------------

  private enterRoom() {
    machine.set("ROOM");
    if (store.state.chapter === ABOUT_CHAPTER) { void this.openAbout(); return; }
    if (store.state.chapter === PRODUCT_CHAPTER) {
      markOnboarded();
      // arriving in room III is arriving in the product; leaving it lands back
      // here, where the Open tile is the way in again
      if (!this.productSeen) { this.productSeen = true; void this.openProduct(); return; }
    } else {
      this.productSeen = false;
    }
    this.syncHud();
    this.syncHotspots();
    if (!this.onboarded && !store.state.phoneFound && store.state.chapter === 0) {
      this.onboarded = true;
      gsap.delayedCall(0.8, () => { if (machine.is("ROOM") && !store.state.phoneFound) void this.toast.show("hand", manifest.strings.onboarding, 0, () => {
        const phone = this.hotspots.find((spot) => spot.data.id === "H1");
        if (phone) void this.onHotspot(phone);
      }); });
    }
    if (store.state.chapter === 1 && !this.saidChoose) {
      this.saidChoose = true;
      void (async () => { await wait(0.6); await this.say(4); await this.say(5); })();
    }
  }

  private async onHotspot(spot: Hotspot) {
    if (machine.busy || !machine.is("ROOM")) return;
    const d = spot.data;
    if (spot.state === "locked") {
      spot.shake();
      void this.toast.show("lock", [manifest.strings.locked.replace("{n}", String(store.left))], 2.6);
      return;
    }
    if (spot.state !== "idle" && spot.state !== "visited") return;
    if (spot.state === "visited" && d.earns) { void this.openBasket(d.earns); return; }

    await machine.run("FOUND", "ROOM", async () => {
      spot.set("loading");
      void this.toast.hide();
      await this.stage.pushIn(d.chapter, d.u, d.v);
      spot.set("hidden");
      store.visit(d.id);
      if (d.id === "H1") await this.foundPhone();
      else if (d.id === "H6") await this.approve();
      else await this.interact(d);
    });
    this.enterRoom();
  }

  private async foundPhone() {
    const s = manifest.strings.found.H1;
    this.reveal.show({ eyebrow: s.eyebrow, title: s.title, cutout: manifest.cutouts.phone, tilt: 15 });
    await this.reward.show({ icon: "phone", text: s.card, button: s.button, delay: 1.0 });
    store.set({ phoneFound: true });
    await this.pageOver(() => this.basket.open({ onCovered: () => this.resetStage() }), "BASKET");
  }

  private async interact(d: HotspotData) {
    const run: Interaction = d.id === "H2" ? runAsk : runFabricLens;
    machine.set("INTERACTION");
    const earned = await run(this.ctx);
    const piece = d.earns as PieceId;
    if (!earned) { await this.leaveCloseUp(); return; }
    store.earn(piece);
    if (piece === "lamp") void this.stage.world.setRoomStill(0, store.roomStill(0));
    if (piece === "sofa") void this.stage.world.setRoomStill(2, store.roomStill(2));
    await this.rewardThenBasket(piece, d.icon, 0.2);
  }

  private async rewardThenBasket(piece: PieceId, iconName: HotspotData["icon"], delay: number) {
    machine.set("REWARD");
    const r = manifest.strings.reward;
    const full = store.left === 0;
    const how = await this.reward.show({
      icon: iconName, dismissible: true, delay,
      text: full ? r.full : r.piece.replace("{n}", String(store.left)),
      button: r.button,
    });
    if (how === "close") { await this.leaveCloseUp(); return; }
    await this.pageOver(() => this.basket.open({ write: piece, onCovered: () => this.resetStage() }), "BASKET");
  }

  private async approve() {
    machine.set("APPROVE");
    const approved = await runApprove(this.ctx);
    if (!approved) { await this.leaveCloseUp(); return; }
    store.set({ approved: true });
    markOnboarded();   // the tour is done once the basket has been approved
    await this.pageOver(() => this.finale.open({ onCovered: () => this.resetStage() }), "FINALE");
  }

  /** Run a full-screen paper page. The stage is reset behind the flood. */
  private async pageOver(open: () => Promise<void>, state: "BASKET" | "FINALE") {
    machine.set(state);
    void this.reveal.hide();
    await open();
  }

  /** Put the stage back to the idle pose of the current chapter, with no animation. */
  private resetStage() {
    const { stage } = this;
    const v = stage.post.values;
    gsap.killTweensOf(v);
    v.focus = 0; v.veil = 0; v.zoom = 0; v.horizontal = 0;
    stage.world.rigAmount = 1;
    stage.world.setFacadeOpacity(0);
    stage.setPose(stage.world.insidePose(store.state.chapter));
    stage.flat.mesh.visible = false;
    stage.flat.uniforms.uOpacity.value = 0;
    this.ctx.cursor.hide();
  }

  /** Leave a reveal or a close-up without opening a page: focus pull back to the room. */
  private async leaveCloseUp() {
    void this.reveal.hide();
    this.ctx.cursor.hide();
    if (this.stage.flat.mesh.visible) void this.stage.flat.hide(0.6);
    await this.stage.pullBack(store.state.chapter);
  }

  /** Chapter IV opens on arrival; leaving About returns to the room selector. */
  private async openAbout() {
    if (this.dead || machine.busy || !machine.is("ROOM") || store.state.chapter !== ABOUT_CHAPTER) return;
    void this.toast.hide();
    const opened = await machine.run("FINALE", "ROOM", () => this.about.open({ onCovered: () => this.resetStage() }));
    // Do not enterRoom() here: that would immediately open About again.
    if (opened && !this.dead) {
      await this.flyOut();
      if (!this.dead) this.labels[ABOUT_CHAPTER].entry.focus({ preventScroll: true });
    }
  }

  /** Chapter III: hand the screen to the real product, and take it back after. */
  private async openProduct() {
    this.syncHud();
    this.syncHotspots();
    const host = this.host;
    if (!host || machine.busy || !machine.is("ROOM")) return;
    void this.toast.hide();
    await machine.run("PRODUCT", "ROOM", async () => {
      this.syncHud();
      await host.openProduct({
        onCovered: () => {
          // Keep the exact room view behind the glass interface.
          sound.hush(true);
          this.stage.setPaused(true);
        },
      });
      this.stage.setPaused(false);
      sound.hush(false);
    });
    if (!this.dead) this.syncHud();
  }

  private async openBasket(write?: PieceId) {
    if (machine.busy || !machine.is("ROOM") || !store.state.phoneFound) return;
    void this.toast.hide();
    await machine.run("BASKET", "ROOM", () => this.basket.open({ write }));
    this.enterRoom();
  }

  // ---- facade ----------------------------------------------------------------

  private async flyOut() {
    if (!machine.is("ROOM")) return;
    void this.toast.hide();
    await machine.run("FLYOUT", "FACADE", async () => {
      await wait(0.2);
      void sound.sfx("whoosh", 0.5);
      await this.stage.flyOut(store.state.chapter);
      await wait(0.4);
    });
  }

  private async truck(dir: -1 | 1) {
    const to = store.state.chapter + dir;
    if (to < 0 || to > manifest.chapters.length - 1 || !machine.is("FACADE")) return;
    await machine.run("TRUCK", "FACADE", async () => {
      void sound.sfx("whoosh", 0.4);
      await this.stage.truck(to as ChapterIndex);
      store.set({ chapter: to as ChapterIndex });
    });
  }

  private async flyIn(chapter: ChapterIndex) {
    if (!machine.is("FACADE") || chapter !== store.state.chapter) return;
    const ok = await machine.run("FLYIN", "ROOM", async () => {
      void sound.sfx("whoosh", 0.5);
      await this.stage.flyIn(chapter);
    });
    if (ok) this.enterRoom();
  }

  /** Skip the tour: straight to the product room, with the basket already filled
   *  so the approval has something to approve. */
  private async skipTour() {
    if (machine.busy || !machine.is("ROOM", "FACADE")) return;
    void this.toast.hide();
    store.fillBasket();
    markOnboarded();
    if (machine.is("ROOM")) await this.flyOut();
    while (store.state.chapter !== PRODUCT_CHAPTER) await this.truck(1);
    await this.flyIn(PRODUCT_CHAPTER);
  }

  /** Deep link from an empty basket slot: out the window, along the wall, in again. */
  private async goToChapter(chapter: ChapterIndex) {
    // the basket closes first and hands the machine back in ROOM
    await wait(0.05);
    while (machine.busy) await wait(0.1);
    if (chapter === store.state.chapter) return;
    await this.flyOut();
    while (store.state.chapter !== chapter) await this.truck(chapter > store.state.chapter ? 1 : -1);
    await this.flyIn(chapter);
  }

  destroy() {
    this.dead = true;
    this.cleanups.forEach((fn) => fn());
    this.hotspots.forEach((s) => s.destroy());
    this.labels.forEach((l) => l.destroy());
    Object.values(this.tiles ?? {}).forEach((t) => t.destroy());
    gsap.globalTimeline.clear();
    sound.destroy();
    this.stage.dispose();
    disposeTextures();
    machine.reset();
    store.reset();
    this.root.innerHTML = "";
  }
}

export function mount(root: HTMLElement, host?: Host) {
  const app = new App(root, host);
  void app.start();
  return () => app.destroy();
}
