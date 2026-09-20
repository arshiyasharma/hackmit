import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Confirmation from "./Confirmation";
import type { RunRow, RunVerification } from "./CheckoutRun";
import type { CartItem, Product } from "@/types";

/**
 * The two verification badges, and why they must never blur into each other.
 *
 * `instructionId` is a real Visa Intelligent Commerce purchase instruction —
 * it only exists when Visa's own sandbox returned one. `verifiedAgentId` is
 * our own Trusted Agent Protocol, modelled on Visa's real one but not itself
 * Visa's system. Labelling TAP "Visa Intelligent Commerce" would be exactly
 * the overclaim this layer exists to refuse, so each gets its own sentence
 * and neither stands in for the other.
 */

function product(patch: Partial<Product> = {}): Product {
  return {
    id: "p1",
    retailer: "IKEA",
    title: "Brass-finish tall lamp",
    url: "https://www.ikea.com/us/en/p/lamp-70437814/",
    priceCents: 12000,
    currency: "USD",
    dimsMm: undefined,
    dimsSource: "missing",
    inStock: true,
    ...patch,
  };
}

function cartItem(patch: Partial<Product> = {}): CartItem {
  const p = product(patch);
  return { id: `line-${p.id}`, product: p, quantity: 1, itemId: `item-${p.id}`, addedAt: Date.now() };
}

function orderedRow(patch: Partial<RunRow> = {}): RunRow {
  return {
    retailer: "IKEA",
    url: product().url,
    itemCount: 1,
    subtotalCents: 12000,
    currency: "USD",
    state: "ordered",
    simulated: true,
    orderRef: "TEST-IKEA-1",
    error: null,
    mode: "test",
    ...patch,
  };
}

function markup(rows: RunRow[], verification: RunVerification | null) {
  return renderToStaticMarkup(
    <Confirmation
      rows={rows}
      lines={[cartItem()]}
      verification={verification}
      onPlaceAnother={() => {}}
    />
  );
}

describe("the two verification badges never blur into one", () => {
  it("says Visa Intelligent Commerce only when a real instruction id exists", () => {
    const html = markup([orderedRow()], {
      instructionId: "pi_test_12345",
      verifiedAgentId: null,
    });
    expect(html).toContain("Visa Intelligent Commerce verified");
    expect(html).toContain("pi_test_12345");
    // the TAP sentence must not also appear — one claim per screen, not both
    expect(html).not.toContain("Trusted Agent Protocol");
  });

  it("says Trusted Agent Protocol, never Visa Intelligent Commerce, for TAP alone", () => {
    const html = markup([orderedRow()], {
      instructionId: null,
      verifiedAgentId: "visa-room-agent",
    });
    expect(html).toContain("Trusted Agent Protocol");
    expect(html).toContain("visa-room-agent");
    // this is the overclaim this test exists to catch
    expect(html).not.toContain("Visa Intelligent Commerce verified");
  });

  it("shows neither badge when neither signal is real — no placeholder, no invented id", () => {
    const html = markup([orderedRow()], { instructionId: null, verifiedAgentId: null });
    expect(html).not.toContain("Visa Intelligent Commerce verified");
    expect(html).not.toContain("Trusted Agent Protocol");
  });

  it("shows neither badge before anything actually finished buying", () => {
    // both signals real, but every row held or failed — nothing was ordered
    const html = markup(
      [orderedRow({ state: "held", heldCount: 1, heldReason: "too wide" })],
      { instructionId: "pi_test_1", verifiedAgentId: "visa-room-agent" }
    );
    expect(html).not.toContain("Visa Intelligent Commerce verified");
    expect(html).not.toContain("Trusted Agent Protocol");
  });

  it("says nothing about verification when the prop is simply absent", () => {
    const html = renderToStaticMarkup(
      <Confirmation rows={[orderedRow()]} lines={[cartItem()]} onPlaceAnother={() => {}} />
    );
    expect(html).not.toContain("Visa Intelligent Commerce verified");
    expect(html).not.toContain("Trusted Agent Protocol");
  });
});
