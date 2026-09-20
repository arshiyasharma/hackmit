"use client";

import * as React from "react";
import Image from "next/image";
import { ArrowUpRight, Camera, ChevronRight, Maximize2, MessageSquare, PanelLeft, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import AgentThread from "@/components/AgentThread";
import ArScene from "@/components/ArScene";
import AskInput, { useAsking } from "@/components/AskInput";
import BudgetHud, { useRemoveItem } from "@/components/BudgetHud";
import BudgetPrompt from "@/components/BudgetPrompt";
import ItemsStrip from "@/components/ItemsStrip";
import OptionSheet, { closeOptions, openOptionsFor, useOptionsOpen } from "@/components/OptionSheet";
import { ADJUST_ITEM_EVENT, OPEN_OPTIONS_EVENT, PHOTO_REVEALED_EVENT, REMOVE_ITEM_EVENT } from "@/components/PhotoMode";
import { RoomContextStrip } from "@/components/RoomContextStrip";
import RoomPurchaseButton from "@/components/RoomPurchaseButton";
import Sheet from "@/components/ui/Sheet";
import { demoHref } from "@/lib/demo";
import { AppLink, useAppNav } from "@/lib/nav";
import { usePreviewFor } from "@/lib/preview";
import { formatPrice } from "@/components/ProductCard";
import { itemById, useRoomContext, useStore } from "@/lib/store";
import type { PlacedItem, RoomPhase } from "@/types";
import "./workspace.css";

export function derivePhase(items: PlacedItem[], active: PlacedItem | null, asking: boolean): RoomPhase {
  if (asking) return "asking";
  if (items.length === 0) return "empty";
  if (!active) return "placing";
  if (active.placeholderStatus === "pending" || active.optionsStatus === "pending") return "generating";
  if (active.linkedProduct) return "linked";
  return "placing";
}

/** The same workspace mounts at /room and inside room III of the landing. */
export default function RoomPage() {
  const items = useStore((s) => s.items);
  const activeItemId = useStore((s) => s.activeItemId);
  const roomContext = useRoomContext();
  const asking = useAsking();
  const optionsOpen = useOptionsOpen();
  const nav = useAppNav();
  const [panel, setPanel] = React.useState<"style" | "activity" | null>(null);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [offerBudget, setOfferBudget] = React.useState(false);
  const workspaceRef = React.useRef<HTMLElement | null>(null);
  const sidebarRef = React.useRef<HTMLElement | null>(null);
  const sidebarToggleRef = React.useRef<HTMLButtonElement | null>(null);
  const active = itemById(items, activeItemId);
  const phase = derivePhase(items, active, asking);
  const removeItem = useRemoveItem();
  const trayVisible = optionsOpen && active !== null;
  const showingMatches = optionsOpen || items.length === 0;
  const previewProduct = usePreviewFor(active);
  const selectedProduct = previewProduct ?? active?.linkedProduct;
  const canPreviewSize = !!previewProduct?.dimsMm && previewProduct.dimsMm[1] > 0;

  // Let the photo arrive first. Never interrupt someone already using the room.
  React.useEffect(() => {
    let engaged = false;
    const onInteraction = () => { engaged = true; };
    const onRevealed = () => { if (!engaged) setOfferBudget(true); };
    const workspace = workspaceRef.current;
    workspace?.addEventListener("pointerdown", onInteraction, { passive: true });
    workspace?.addEventListener("keydown", onInteraction);
    workspace?.addEventListener("focusin", onInteraction);
    window.addEventListener(PHOTO_REVEALED_EVENT, onRevealed);
    return () => {
      workspace?.removeEventListener("pointerdown", onInteraction);
      workspace?.removeEventListener("keydown", onInteraction);
      workspace?.removeEventListener("focusin", onInteraction);
      window.removeEventListener(PHOTO_REVEALED_EVENT, onRevealed);
    };
  }, []);

  // An explicit search or item selection opens matches on compact screens.
  React.useEffect(() => {
    if (!trayVisible || !window.matchMedia("(max-width: 960px)").matches) return;
    const frame = window.requestAnimationFrame(() => setSidebarOpen(true));
    return () => window.cancelAnimationFrame(frame);
  }, [trayVisible, activeItemId]);

  const showMatches = React.useCallback(() => {
    if (active) openOptionsFor(active.id);
    if (window.matchMedia("(max-width: 960px)").matches) setSidebarOpen(true);
  }, [active]);

  const closeSidebar = React.useCallback((restoreFocus = true) => {
    setSidebarOpen(false);
    const trigger = sidebarToggleRef.current;
    if (restoreFocus && trigger?.getClientRects().length) {
      trigger.focus({ preventScroll: true });
    }
  }, []);

  // This mobile disclosure closes as focus leaves; it never hides a focused
  // workspace control behind its backdrop. The account chip is hosted outside
  // the page, but is part of the sidebar's keyboard sequence while it is open.
  React.useEffect(() => {
    if (!sidebarOpen) return;
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const stops = () => Array.from(sidebar.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled]), input:not([disabled]), [tabindex='0']"
    )).filter((element) => element.getClientRects().length > 0);
    const account = () => {
      const chip = sidebar.closest(".pixx-room-root")?.querySelector<HTMLElement>(".pixx-chip");
      return chip?.getClientRects().length ? chip : null;
    };
    const modalOpen = () => Array.from(document.querySelectorAll("[role='dialog'][aria-modal='true']"))
      .some((dialog) => !dialog.closest(".sense"));
    const frame = window.requestAnimationFrame(() => stops()[0]?.focus({ preventScroll: true }));

    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || modalOpen()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeSidebar();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = stops();
      const first = controls[0];
      const last = controls[controls.length - 1];
      const chip = account();
      const focused = document.activeElement;
      if (event.shiftKey && focused === first) {
        event.preventDefault();
        closeSidebar();
      } else if (!event.shiftKey && focused === last) {
        event.preventDefault();
        if (chip) chip.focus({ preventScroll: true });
        else closeSidebar();
      } else if (chip && focused === chip) {
        event.preventDefault();
        if (event.shiftKey && last) last.focus({ preventScroll: true });
        else closeSidebar();
      }
    };
    const onFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || sidebar.contains(target) || account()?.contains(target) || modalOpen()) return;
      closeSidebar(false);
    };
    const desktop = window.matchMedia("(min-width: 961px)");
    const onResize = (event: MediaQueryListEvent) => {
      if (event.matches) closeSidebar(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus);
    desktop.addEventListener("change", onResize);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocus);
      desktop.removeEventListener("change", onResize);
    };
  }, [sidebarOpen, closeSidebar]);

  React.useEffect(() => {
    const itemIdOf = (event: Event): string | null => {
      const detail = (event as CustomEvent<{ itemId?: unknown }>).detail;
      return typeof detail?.itemId === "string" ? detail.itemId : null;
    };
    const onOpen = (event: Event) => {
      const id = itemIdOf(event);
      if (id) openOptionsFor(id);
    };
    const onRemove = (event: Event) => {
      const id = itemIdOf(event);
      if (id) removeItem(id);
    };
    window.addEventListener(OPEN_OPTIONS_EVENT, onOpen);
    window.addEventListener(REMOVE_ITEM_EVENT, onRemove);
    return () => {
      window.removeEventListener(OPEN_OPTIONS_EVENT, onOpen);
      window.removeEventListener(REMOVE_ITEM_EVENT, onRemove);
    };
  }, [removeItem]);

  const roomType = roomContext?.roomType?.trim() ?? "";
  const roomName = roomType ? roomType.charAt(0).toUpperCase() + roomType.slice(1) : "Your room";

  return (
    <main ref={workspaceRef} className="room-workspace" data-phase={phase} data-tray={trayVisible ? "open" : "closed"} data-sidebar={sidebarOpen ? "open" : "closed"} data-selected={active ? "true" : "false"}>
      {sidebarOpen ? <button type="button" tabIndex={-1} className="room-sidebar-backdrop" aria-label="Close items" onClick={() => closeSidebar()} /> : null}
      <aside ref={sidebarRef} className="room-sidebar" aria-label="Room workspace" id="room-items">
        <div className="room-brand">
          <Image className="room-brand-mark" src="/assets/brand/room-logo.png" alt="" width={1320} height={1164} sizes="52px" />
          <span className="room-brand-name">PIXX<span className="room-brand-suffix">-AR</span></span>
          <button className="room-sidebar-close room-tool" aria-label="Close items" onClick={() => closeSidebar()}><X size={17} aria-hidden /></button>
        </div>
        <nav className="room-panel-tabs" aria-label="Product panel">
          <button type="button" aria-pressed={showingMatches} disabled={!active && items.length > 0} onClick={showMatches}>Matches</button>
          <button type="button" aria-pressed={!showingMatches} disabled={items.length === 0} onClick={closeOptions}>In your room <span>{items.length}</span></button>
        </nav>
        <div className="room-matches">
          <OptionSheet />
          {!showingMatches ? <div className="room-inventory"><ItemsStrip /></div> : null}
          {showingMatches && !active ? (
            <div className="room-matches-empty">
              <Search size={23} strokeWidth={1.4} aria-hidden />
              <h2>Find your next piece.</h2>
              <p>Describe what you want below. Matching products will appear here.</p>
              <ol><li><span>01</span> Ask for a piece</li><li><span>02</span> Preview your matches</li><li><span>03</span> Add your favourite</li></ol>
            </div>
          ) : null}
        </div>
        <div className="room-sidebar-footer">
          {nav.embedded ? <span className="room-account-label">Account &amp; settings</span> : <AppLink href="/landing" className="room-tool">Back to rooms <ChevronRight size={15} aria-hidden /></AppLink>}
        </div>
      </aside>
      <header className="room-toolbar">
        <div className="room-toolbar-title">
          <button ref={sidebarToggleRef} className="room-sidebar-toggle room-tool" aria-label="Show products" aria-expanded={sidebarOpen} aria-controls="room-items" onClick={() => setSidebarOpen((open) => !open)}><PanelLeft size={18} aria-hidden /></button>
          <h1>{roomName}<span>Room studio</span></h1>
          <span className="room-toolbar-divider" aria-hidden />
          <button className="room-tool" onClick={() => setPanel("style")} aria-label="Edit room style" title="Edit room style"><SlidersHorizontal size={16} aria-hidden /><span className="room-tool-label">Style</span></button>
          <button className="room-tool" onClick={() => setPanel("activity")} aria-label="Open conversation" title="Conversation"><MessageSquare size={16} aria-hidden /><span className="room-tool-label">History</span></button>
        </div>
        <div className="room-toolbar-actions">
          <AppLink href={demoHref("/")} className="room-tool room-change-photo" title="Change room photo"><Camera size={16} aria-hidden /><span>Change photo</span></AppLink>
          <div className="room-budget"><BudgetHud /></div>
          <RoomPurchaseButton className="room-purchase" />
        </div>
      </header>
      <div className="room-stage">
        <ArScene />
        {offerBudget ? <BudgetPrompt /> : null}
        <div className="room-bottom">
          {active ? (
            <section className="room-selection" aria-label="Selected piece">
              <div className="room-selection-details">
                <span className="room-selection-state">{previewProduct ? (canPreviewSize ? "Trying a match · not added" : "Match details · size preview unavailable") : active.linkedProduct ? "In your room" : "Preview · choose a product"}</span>
                <h2 title={selectedProduct?.title || active.category}>{selectedProduct?.title || active.category}</h2>
                <p>
                  {selectedProduct ? <>{selectedProduct.retailer} · {selectedProduct.priceCents > 0 ? formatPrice(selectedProduct.priceCents, selectedProduct.currency || "USD") : "Price unavailable"}<span className="room-selection-separator"> / </span>{selectedProduct.dimsMm && selectedProduct.dimsSource !== "missing" ? <>{selectedProduct.dimsMm.join(" × ")} mm · {selectedProduct.dimsSource === "quoted" ? "listed size" : "estimated size"}</> : "Dimensions not listed"}</> : "Choose a match on the left to see its price and dimensions."}
                  {active.scale !== 1 ? <span> · Preview resized to {Math.round(active.scale * 100)}%</span> : null}
                </p>
                {!previewProduct && active.fit && active.fit.verdict !== "pass" ? <p className="room-selection-warning">{active.fit.reason}</p> : null}
              </div>
              <div className="room-selection-actions">
                <button type="button" className="room-tool" onClick={() => window.dispatchEvent(new CustomEvent(ADJUST_ITEM_EVENT, { detail: { itemId: active.id } }))} title="Show resize and rotate handles"><Maximize2 size={15} aria-hidden /><span>Adjust</span></button>
                <button type="button" className="room-tool room-choose-product" onClick={showMatches}>{active.linkedProduct ? "Change product" : "Choose product"}<ArrowUpRight size={15} aria-hidden /></button>
                <button type="button" className="room-tool" onClick={() => removeItem(active.id)} aria-label={`Remove ${active.category}`} title="Remove piece"><Trash2 size={15} aria-hidden /></button>
              </div>
            </section>
          ) : null}
          <div className="room-composer"><AskInput /></div>
        </div>
      </div>
      <Sheet open={panel === "style"} onOpenChange={(open) => { if (!open) setPanel(null); }} label="Room style" className="room-studio-dialog">
        <div className="room-settings">
          <h2>Room style</h2>
          <p>Fine-tune the colours and style used to find pieces for your room.</p>
          <RoomContextStrip />
        </div>
      </Sheet>
      <Sheet open={panel === "activity"} onOpenChange={(open) => { if (!open) setPanel(null); }} label="Your conversation" className="room-studio-dialog">
        <div className="room-settings"><h2>Your conversation</h2><p>Your requests and the progress of each piece.</p></div>
        <div className="room-conversation" onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("[data-item-id]")) setPanel(null);
        }}><AgentThread /></div>
      </Sheet>
    </main>
  );
}
