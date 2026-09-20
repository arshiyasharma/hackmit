"use client";

import { useState } from "react";
import { useUser, SignInButton } from "@clerk/nextjs";
import { useCartStore, type CartItem } from "@/lib/cart-store";
import { checkFit } from "@/lib/fit-check";
import BudgetSidebar from "@/components/BudgetSidebar";
import AgentSwarm from "@/components/AgentSwarm";

// Demo items for rehearsal until Jose/Yutian wire their modules into the store.
// The sectional is deliberately too deep for a standard doorway — it's the item
// the Wayfair agent holds back, which is how the constraint layer shows itself.
const DEMO_ITEMS: CartItem[] = [
  { id: "d1", title: "woven jute rug", retailer: "Etsy", price: 128, imageUrl: "", color: "natural", dimensions: { h: 1, w: 60, d: 96, unit: "in" } },
  { id: "d2", title: "oak floor lamp", retailer: "IKEA", price: 79, imageUrl: "", color: "oak", dimensions: { h: 68, w: 12, d: 12, unit: "in" } },
  { id: "d3", title: "linen accent chair", retailer: "Wayfair", price: 340, imageUrl: "", color: "oatmeal", dimensions: { h: 34, w: 30, d: 32, unit: "in" } },
  { id: "d4", title: "deep sectional sofa", retailer: "Wayfair", price: 420, imageUrl: "", color: "oatmeal", dimensions: { h: 38, w: 90, d: 40, unit: "in" } },
];

export default function CheckoutPage() {
  const { user, isSignedIn } = useUser();
  const { items, total, doorway, room, budget, overBudget, addItem, removeItem, setDoorway, retailers } =
    useCartStore();

  // Once set, the swarm takes over the screen.
  const [swarmPayload, setSwarmPayload] = useState<object | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Doorway prompt: show once, before checkout, if we have items but no doorway yet.
  const [dw, setDw] = useState({ width: "32", height: "80" });
  const needsDoorway = items.length > 0 && !doorway;

  const seedDemo = () => {
    DEMO_ITEMS.forEach((it) => {
      const fitStatus = doorway
        ? checkFit(it.dimensions, doorway)
        : undefined;
      addItem({ ...it, fitStatus });
    });
  };

  const saveDoorway = () => {
    const d = { width: Number(dw.width), height: Number(dw.height) };
    setDoorway(d);
    // Backfill fit status on items already in the cart.
    useCartStore.setState((s) => ({
      items: s.items.map((i) => ({ ...i, fitStatus: checkFit(i.dimensions, d) })),
    }));
  };

  // One tap: open the spend mandate and dispatch one agent per retailer.
  const dispatchSwarm = () => {
    setError(null);
    setSwarmPayload({
      items,
      budget,
      doorway,
      room,
      spaceAware: true,
    });
  };

  // ---- Live agent swarm takes over the screen ----
  if (swarmPayload) {
    return <AgentSwarm payload={swarmPayload} />;
  }

  // ---- Cart review ----
  return (
    <div className="min-h-screen flex">
      <div className="flex-1 p-6 max-w-lg mx-auto">
        <h1 className="text-2xl mb-4">review your cart</h1>

        {items.length === 0 ? (
          <div className="text-black/50 text-sm py-8">
            your cart is empty.
            <button onClick={seedDemo} className="ml-2 underline">load demo items</button>
          </div>
        ) : (
          <>
            {items.map((i) => (
              <div key={i.id} className="flex justify-between items-start py-2 border-b border-black/10">
                <div>
                  <span>{i.title} <span className="text-black/40 text-xs">({i.retailer})</span></span>
                  {i.fitStatus === "no_fit" && (
                    <p className="text-red-500 text-xs">may not fit through your doorway</p>
                  )}
                  {i.fitStatus === "tight" && (
                    <p className="text-amber-600 text-xs">tight fit through your doorway</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span>${i.price}</span>
                  <button onClick={() => removeItem(i.id)} className="text-black/30 hover:text-black/60 text-xs">remove</button>
                </div>
              </div>
            ))}

            <div className="flex justify-between items-baseline mt-4 mb-1">
              <span>total</span><span>${total().toFixed(2)}</span>
            </div>
            <p className="text-xs text-black/40 mb-6">
              {items.length} items · {retailers().length} {retailers().length === 1 ? "retailer" : "retailers"} ·{" "}
              {retailers().length} {retailers().length === 1 ? "agent" : "agents"} · one payment
            </p>

            {error && (
              <div className="mb-3 text-red-500 text-sm">
                {error}
              </div>
            )}

            {!isSignedIn ? (
              <SignInButton forceRedirectUrl="/checkout">
                <button className="w-full py-3 bg-black text-white rounded-full">
                  sign in to pay
                </button>
              </SignInButton>
            ) : (
              <button
                onClick={dispatchSwarm}
                disabled={overBudget()}
                className="w-full py-3 bg-black text-white rounded-full disabled:opacity-40"
              >
                {overBudget()
                  ? "over budget — remove an item"
                  : `send ${retailers().length} ${retailers().length === 1 ? "agent" : "agents"} · buy all ${items.length}`}
              </button>
            )}
          </>
        )}
      </div>

      <BudgetSidebar />

      {/* Doorway prompt */}
      {needsDoorway && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl p-6 w-80 flex flex-col gap-4">
            <h2 className="text-lg">your doorway size</h2>
            <p className="text-black/50 text-sm">so we can flag anything that won&apos;t fit.</p>
            <div className="flex gap-3">
              <label className="flex-1 text-sm">
                width (in)
                <input
                  type="number"
                  value={dw.width}
                  onChange={(e) => setDw({ ...dw, width: e.target.value })}
                  className="mt-1 w-full border border-black/15 rounded px-2 py-1"
                />
              </label>
              <label className="flex-1 text-sm">
                height (in)
                <input
                  type="number"
                  value={dw.height}
                  onChange={(e) => setDw({ ...dw, height: e.target.value })}
                  className="mt-1 w-full border border-black/15 rounded px-2 py-1"
                />
              </label>
            </div>
            <button onClick={saveDoorway} className="py-2 bg-black text-white rounded-full text-sm">
              save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
