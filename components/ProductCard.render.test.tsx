import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProductCard from "./ProductCard";
import { useStore, type VisaStore } from "@/lib/store";
import type { Product } from "@/types";

vi.mock("@/lib/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/store")>();
  return {
    ...actual,
    useStore: Object.assign((select: (state: VisaStore) => unknown) => select(actual.useStore.getState()), actual.useStore),
  };
});

const product: Product = {
  id: "a", retailer: "Shop", title: "Chair", url: "https://shop.example/a", imageUrl: "https://shop.example/a.jpg",
  priceCents: 1000, currency: "USD", dimsSource: "missing", inStock: true,
};
let id: string;
beforeEach(() => {
  useStore.getState().reset();
  id = useStore.getState().addItem({ request: "a chair", category: "chair" });
  useStore.getState().linkProduct(id, product);
});

const linkButton = (compact = false) => {
  const html = renderToStaticMarkup(<ProductCard product={product} compact={compact} />);
  return html.match(/<button[^>]*data-card-link=""[\s\S]*?<\/button>/)?.[0] ?? "";
};

describe("product photo action feedback", () => {
  it("labels and disables the linked card action while removing the background", () => {
    useStore.getState().startListingCutout(id);
    const button = linkButton();
    expect(button).toContain("Removing background…");
    expect(button).toContain('aria-busy="true"');
    expect(button).toContain('disabled=""');
  });

  it("exposes an enabled retry after extraction fails", () => {
    const request = useStore.getState().startListingCutout(id)!;
    useStore.getState().setListingCutout(id, null, request, "Unavailable");
    const button = linkButton();
    expect(button).toContain("Retry product photo");
    expect(button).not.toContain('disabled=""');
    expect(button).not.toContain('aria-disabled="true"');
    expect(button).toContain("illustration is still shown");
  });

  it("lets an already-linked item with no photo start extraction", () => {
    expect(linkButton()).toContain("Use product photo");
    expect(linkButton()).not.toContain('aria-disabled="true"');
  });

  it("offers a discreet refresh action for an already-ready linked product", () => {
    useStore.getState().setListingCutout(id, { url: "/old.png", widthRatio: 0.5 });
    const html = renderToStaticMarkup(<ProductCard product={product} />);
    expect(html).toContain('data-card-refresh=""');
    expect(html).toContain("Refresh photo");
    expect(linkButton()).toContain("In your room");
  });

  it("describes a refresh without claiming the old photo disappeared", () => {
    useStore.getState().setListingCutout(id, { url: "/old.png", widthRatio: 0.5 });
    const request = useStore.getState().startListingCutout(id, true)!;
    expect(linkButton()).toContain("Refreshing photo…");
    expect(renderToStaticMarkup(<ProductCard product={product} />)).not.toContain('data-card-refresh=""');
    useStore.getState().setListingCutout(id, null, request, "Refresh failed");
    expect(linkButton()).toContain("previous product photo is still shown");
    expect(linkButton()).toContain("Retry product photo");
  });

  it("names the compact retry button for assistive technology", () => {
    const request = useStore.getState().startListingCutout(id)!;
    useStore.getState().setListingCutout(id, null, request);
    expect(linkButton(true)).toContain('class="sr-only">Retry product photo');
  });
});
