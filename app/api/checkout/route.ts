import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { auth } from "@clerk/nextjs/server";
import type { CartItem } from "@/lib/cart-store";

// Fail loud at first use if the key is missing — never silently pretend to charge.
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.startsWith("sk_test_...") || key.length < 20) {
    throw new Error(
      "STRIPE_SECRET_KEY is missing or a placeholder — add a real sk_test_ key to .env.local and restart the dev server."
    );
  }
  return new Stripe(key);
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let items: CartItem[];
  try {
    ({ items } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
  }

  const totalCents = Math.round(items.reduce((s, i) => s + i.price, 0) * 100);
  if (totalCents <= 0) {
    return NextResponse.json({ error: "Cart total must be greater than $0" }, { status: 400 });
  }

  // The demo narrative: items from multiple retailers, one transaction.
  const retailers = [...new Set(items.map((i) => i.retailer))];

  try {
    const stripe = getStripe();

    // Auto-confirm with Stripe's test Visa card — produces a real, succeeded
    // PaymentIntent in test mode (visible in the Stripe dashboard) with no card form on stage.
    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalCents,
      currency: "usd",
      payment_method: "pm_card_visa",
      payment_method_types: ["card"],
      confirm: true,
      metadata: {
        retailers: retailers.join(","),
        itemCount: String(items.length),
        userId,
      },
    });

    return NextResponse.json({
      status: paymentIntent.status, // "succeeded"
      paymentIntentId: paymentIntent.id,
      visaToken: `vt_${paymentIntent.id.slice(3, 15)}`, // cosmetic — shown as "Visa Token" in the UI
      retailers,
      amount: totalCents / 100,
    });
  } catch (err) {
    // Surface the real error to the client instead of a blank confirmation.
    const message = err instanceof Error ? err.message : "Payment failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
