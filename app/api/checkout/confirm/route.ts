import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { auth } from "@clerk/nextjs/server";

/**
 * Verifies a PaymentIntent actually succeeded before an order is marked complete.
 * The /api/checkout route auto-confirms, so this is a belt-and-suspenders check
 * (and the seam where a real webhook / order-write would go).
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.startsWith("sk_test_...")) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const { paymentIntentId } = await req.json();
  if (!paymentIntentId) {
    return NextResponse.json({ error: "Missing paymentIntentId" }, { status: 400 });
  }

  const stripe = new Stripe(key);
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);

  if (pi.status !== "succeeded") {
    return NextResponse.json({ status: pi.status, confirmed: false }, { status: 402 });
  }

  return NextResponse.json({ status: pi.status, confirmed: true });
}
