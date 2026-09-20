import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import CheckoutRun from "./CheckoutRun";
import TestModeChip from "./TestModeChip";
import type { CartItem, Product } from "@/types";

/**
 * Does the checkout screen actually RENDER?
 *
 * Every other test in this repo checks logic. This one checks that the
 * components produce markup and that the words a judge reads are in it —
 * the TEST MODE bar, the shop names, the honest copy under the button.
 *
 * Server rendering, not a browser: no effects run, so this covers the idle
 * screen rather than the live walk. That is deliberately the half that is
 * hardest to check any other way, because the walk is already covered by
 * lineView.test.ts and by the end-to-end API tests.
 */

function product(patch: Partial<Product> = {}): Product {
  return {
    id: "p1",
    retailer: "IKEA",
    title: "Brass-finish tall lamp",
    url: "https://www.ikea.com/us/en/p/lamp-70437814/",
    imageUrl: "",
    priceCents: 12000,
    currency: "USD",
    dimsMm: [300, 1500, 300],
    dimsSource: "quoted",
    inStock: true,
    ...patch,
  };
}

function cartItem(patch: Partial<Product> = {}, quantity = 1): CartItem {
  const p = product(patch);
  return { id: `line-${p.id}`, product: p, quantity, itemId: `item-${p.id}`, addedAt: 0 };
}

const BASKET: CartItem[] = [
  cartItem(),
  cartItem({ id: "p2", retailer: "Wayfair", title: "Walnut photo frame", url: "https://www.wayfair.com/decor/pdp/frame-1", priceCents: 3500 }, 2),
  cartItem({ id: "p3", title: "Small photo frame", url: "https://www.ikea.com/us/en/p/frame-9911/", priceCents: 1900 }),
  cartItem({ id: "p4", retailer: "Target", title: "Wool area rug", url: "https://www.target.com/p/rug/-/A-1", priceCents: 8900 }),
];

/** Markup with the tags stripped, so assertions read like what a person sees. */
function text(markup: string): string {
  return markup.replace(/<[^>]*>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

describe("TestModeChip", () => {
  it("renders the words that stop a judge worrying", () => {
    expect(text(renderToStaticMarkup(<TestModeChip />))).toContain(
      "Test mode — no money moves"
    );
  });

  it("says something different, and louder, if a run were ever live", () => {
    const live = text(renderToStaticMarkup(<TestModeChip live />));
    expect(live).toContain("Live mode");
    expect(live).not.toContain("no money moves");
  });

  it("is a status, never a control — nothing in it is clickable", () => {
    const markup = renderToStaticMarkup(<TestModeChip />);
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("<a ");
  });
});

describe("CheckoutRun renders the idle screen", () => {
  const markup = renderToStaticMarkup(<CheckoutRun lines={BASKET} mode="test" />);
  const body = text(markup);

  it("produces markup at all", () => {
    expect(markup.length).toBeGreaterThan(200);
  });

  it("offers one button for the whole basket, counted and totalled", () => {
    // 4 lines, one of them x2 = 5 items; $120 + $70 + $19 + $89
    expect(body).toContain("Buy all 5");
    // whole dollars, the way formatMoney renders a round total
    expect(body).toContain("$298");
    expect(body).toContain("across 3 shops");
  });

  it("says plainly that nothing is bought and no card is charged", () => {
    expect(body).toContain("Test mode.");
    expect(body).toContain("Nothing is bought and no card is charged");
  });

  it("does not claim the agent visits real shops — that would be the bluff", () => {
    expect(body).not.toContain("works each shop's own site");
    expect(body).not.toContain("stops at the final confirm");
  });

  it("shows no run rows, no mandate line and no signature line before it starts", () => {
    expect(body).not.toContain("Visa mandate");
    expect(body).not.toContain("signature verified");
    expect(body).not.toContain("test order placed");
  });

  it("renders nothing at all for an empty basket", () => {
    expect(renderToStaticMarkup(<CheckoutRun lines={[]} mode="test" />)).toBe("");
  });

  it("tells the truth when the real-order switch is on: the server still refuses", () => {
    const live = text(renderToStaticMarkup(<CheckoutRun lines={BASKET} mode="live" />));
    expect(live).toContain("the server still refuses");
    expect(live).not.toContain("Nothing is bought and no card is charged");
  });
});

describe("the checkout page mounts the chip where it cannot be missed", () => {
  const source = readFileSync(join(__dirname, "..", "app", "checkout", "page.tsx"), "utf8");

  it("renders TestModeChip inside the sticky header, not below the fold", () => {
    expect(source).toContain("<TestModeChip");
    const sticky = source.indexOf("sticky top-");
    const chip = source.indexOf("<TestModeChip");
    expect(sticky).toBeGreaterThan(-1);
    expect(chip).toBeGreaterThan(sticky);
    // before the basket total, so it is the first thing in the block
    expect(chip).toBeLessThan(source.indexOf("<NumberPlate"));
  });

  it("is not conditional — it shows for the whole run, not just before it", () => {
    const line = source.split("\n").find((l) => l.includes("<TestModeChip")) ?? "";
    expect(line).not.toContain("?");
    expect(line).not.toContain("&&");
  });
});
