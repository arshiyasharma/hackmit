"use client";

import { useState } from "react";
import { useUser, SignInButton } from "@clerk/nextjs";
import { useCartStore, type CartItem } from "@/lib/cart-store";
import { checkFit } from "@/lib/fit-check";
import BudgetSidebar from "@/components/BudgetSidebar";

// Demo items for rehearsal until Jose/Yutian wire their modules into the store.
const DEMO_ITEMS: CartItem[] = [
  { id: "d1", title: "woven jute rug", retailer: "Etsy", price: 128, imageUrl: "", dimensions: { h: 1, w: 60, d: 96, unit: "in" } },
  { id: "d2", title: "oak floor lamp", retailer: "IKEA", price: 79, imageUrl: "", dimensions: { h: 68, w: 12, d: 12, unit: "in" } },
  { id: "d3", title: "linen accent chair", retailer: "Wayfair", price: 340, imageUrl: "", dimensions: { h: 34, w: 30, d: 32, unit: "in" } },
];

type Confirmed = { visaToken: string; retailers: string[]; amount: number };

export default function CheckoutPage() {
  const { user, isSignedIn } = useUser();
  const { items, total, doorway, overBudget, addItem, removeItem, setDoorway } = useCartStore();

  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  const [loading, setLoading] = useState(false);
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

  const handlePay = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Payment failed — try again.");
        return;
      }
      setConfirmed({ visaToken: data.visaToken, retailers: data.retailers, amount: data.amount });
    } catch {
      setError("Network error — try again.");
    } finally {
      setLoading(false);
    }
  };

  // ---- Confirmation screen ----
  if (confirmed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="text-5xl text-[#C97B5F]">✓</div>
        <h1 className="text-2xl">order confirmed</h1>
        <p className="text-black/60">
          {items.length} items from {confirmed.retailers.join(", ")} — one transaction.
        </p>
        <div className="mt-4 px-4 py-2 rounded-full bg-black/5 text-sm font-mono">
          •••• 4242 · visa token: {confirmed.visaToken}
        </div>
        <p className="text-xs text-black/40 mt-2">
          ${confirmed.amount.toFixed(2)} · secured with passkey · tokenized by visa
        </p>
      </div>
    );
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

            <div className="flex justify-between mt-4 mb-6">
              <span>total</span><span>${total().toFixed(2)}</span>
            </div>

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
                onClick={handlePay}
                disabled={loading || overBudget()}
                className="w-full py-3 bg-black text-white rounded-full disabled:opacity-40"
              >
                {loading
                  ? "processing…"
                  : overBudget()
                  ? "over budget — remove an item"
                  : `pay with visa · ${user?.firstName ? `verified as ${user.firstName}` : "verified"}`}
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
