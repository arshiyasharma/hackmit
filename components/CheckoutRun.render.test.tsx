import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import CheckoutRun from "./CheckoutRun";
import CheckoutSheet from "./CheckoutSheet";
import TestModeChip from "./TestModeChip";
import type { CartItem, Product } from "@/types";

// Exercise the order-mode content without a browser-only portal. Shared Sheet
// focus trapping and dismissal are independently verified in the browser.
vi.mock("@/components/ui/Sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
}));

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
    expect(body).not.toContain("proves its identity");
    expect(body).toContain("simulates checkout");
  });

  it("shows no run rows, no mandate line and no signature line before it starts", () => {
    expect(body).not.toContain("Visa mandate");
    expect(body).not.toContain("signature verified");
    expect(body).not.toContain("test order placed");
  });

  it("renders nothing at all for an empty basket", () => {
    expect(renderToStaticMarkup(<CheckoutRun lines={[]} mode="test" />)).toBe("");
  });

  it("does not offer real purchases even if a saved mode is live", () => {
    const live = text(renderToStaticMarkup(<CheckoutRun lines={BASKET} mode="live" />));
    expect(live).toContain("Real orders are unavailable in this version");
    expect(live).toContain("Nothing is bought and no card is charged");
    expect(live).not.toContain("server-side flags");
  });
});

describe("checkout eligibility is shown before starting", () => {
  const walmart = cartItem({
    id: "walmart-plush",
    retailer: "walmart.com",
    retailerDomain: "walmart.com",
    title: "Plush toy from Walmart",
    url: "https://www.walmart.com/ip/plush/12345",
    priceCents: 2550,
  }, 2);

  it("shows a store link and no dead buy button for unsupported-only baskets", () => {
    const markup = renderToStaticMarkup(<CheckoutRun lines={[walmart]} mode="test" />);
    const body = text(markup);
    expect(body).toContain("Not included in checkout");
    expect(body).toContain("Plush toy from Walmart");
    expect(body).toContain("We cannot check out at walmart.com yet.");
    expect(body).toContain("View at walmart.com");
    expect(markup).toContain('href="https://www.walmart.com/ip/plush/12345"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).not.toContain("<button");
  });

  it("asks to buy only the eligible quantity, total, and shops in a mixed basket", () => {
    const lines = [
      cartItem({ retailer: "ikea.com" }, 2),
      cartItem({ id: "ikea-frame", title: "Small photo frame", priceCents: 1900 }),
      walmart,
    ];
    const markup = renderToStaticMarkup(<CheckoutRun lines={lines} mode="test" />);
    const body = text(markup);
    // Two display-name spellings of IKEA still represent one supported shop.
    // Walmart's two items and $51 never enter the checkout button's promise.
    expect(body).toContain("Buy 3 available items — $259 across 1 shop");
    expect(body).not.toContain("Buy all");
    expect(body).not.toContain("$310");
    expect(body).toContain("These items are excluded from this test run");
    expect(body.indexOf("Not included in checkout")).toBeLessThan(body.indexOf("Buy 3"));
    expect(markup).toContain('href="https://www.walmart.com/ip/plush/12345"');
  });

  it("discloses a known-shop product without a price before offering the subset", () => {
    const noPrice = cartItem({ id: "no-price", title: "Lamp without a price", priceCents: 0 });
    const body = text(renderToStaticMarkup(<CheckoutRun lines={[cartItem(), noPrice]} mode="test" />));
    expect(body).toContain("Lamp without a price has no price on it.");
    expect(body).toContain("Buy 1 available item — $120 across 1 shop");
  });

  it("never renders a non-web product URL as an external store link", () => {
    const invalid = cartItem({ retailer: "Other shop", url: "javascript:alert(1)" });
    const markup = renderToStaticMarkup(<CheckoutRun lines={[invalid]} mode="test" />);
    expect(markup).not.toContain("<a ");
    expect(markup).not.toContain("<button");
  });
});

describe("order mode explains the actual simulation", () => {
  const markup = renderToStaticMarkup(
    <CheckoutSheet open onOpenChange={() => {}} lines={BASKET} mode="test" onModeChange={() => {}} />
  );
  const body = text(markup);

  it("explains the test without claiming real retailer checkout or a final-confirm stop", () => {
    expect(body).toContain("A test run simulates checkout for supported shops");
    expect(body).toContain("Nothing is bought, and no card is charged");
    expect(body).not.toContain("final confirm");
    expect(body).not.toContain("each shop's own page");
    expect(body).not.toContain("NEXT_PUBLIC");
    expect(body).not.toContain("rebuild");
  });

  it("preserves cents in the displayed basket total", () => {
    const markup = renderToStaticMarkup(
      <CheckoutSheet open onOpenChange={() => {}} lines={[cartItem({ priceCents: 16450 })]} mode="test" onModeChange={() => {}} />
    );
    // NumberFlow includes its formatted value in accessible text even though
    // the visual digits are individually rendered for animation.
    const total = markup.slice(markup.indexOf('aria-label="Basket total"'));
    expect(total).toContain("164.50");
    expect(total).not.toContain('>165<');
  });

  it("keeps real orders unavailable rather than offering a mode that cannot work", () => {
    expect(body).toContain("Real orders Unavailable in this version");
    const realOrders = markup.match(/<button[^>]*>[\s\S]*?<\/button>/g)
      ?.find((button) => text(button).includes("Real orders"));
    expect(realOrders).toContain('aria-disabled="true"');
    expect(realOrders).toContain('disabled=""');
    expect(body).not.toContain("Use real orders");
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


describe("checkout budget enforcement", () => {
  // The store starts with a $600 budget. Include exact cent boundaries.
  it.each([59999, 60000])("allows a total of %i cents within the cap", (priceCents) => {
    const markup = renderToStaticMarkup(<CheckoutRun lines={[cartItem({ priceCents })]} mode="test" />);
    const buy = markup.match(/<button[^>]*>[\s\S]*?<\/button>/g)?.find((button) => text(button).includes("Buy all"));
    expect(buy).toBeDefined();
    expect(buy).not.toContain('disabled=""');
    expect(text(markup)).not.toContain("over budget");
  });

  it("disables buying even one cent over budget and explains how to continue", () => {
    const markup = renderToStaticMarkup(<CheckoutRun lines={[cartItem({ priceCents: 60001 })]} mode="test" />);
    const buy = markup.match(/<button[^>]*>[\s\S]*?<\/button>/g)?.find((button) => text(button).includes("Buy all"));
    expect(buy).toContain('disabled=""');
    expect(buy).toContain("aria-describedby=");
    expect(text(markup)).toContain("$0.01 over budget. Remove an item or choose a cheaper option to continue.");
  });

  it("does not let a supported subset bypass an over-budget room", () => {
    const lines = [cartItem(), cartItem({ id: "unsupported", retailer: "Walmart", url: "https://www.walmart.com/ip/1", priceCents: 60000 })];
    const markup = renderToStaticMarkup(<CheckoutRun lines={lines} mode="test" />);
    const buy = markup.match(/<button[^>]*>[\s\S]*?<\/button>/g)?.find((button) => text(button).includes("Buy 1 available"));
    expect(buy).toContain('disabled=""');
    expect(text(markup)).toContain("$120 over budget");
  });
});
