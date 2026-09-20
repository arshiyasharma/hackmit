import type { Product } from "@/lib/sourcing/enrich";
import type { RoomContext } from "@/lib/sourcing/roomContext";

export type { Product, RoomContext };

export type SourceResultGroup = {
  searchTerm: string;
  products: Product[];
};

export type SourceResponse = {
  query?: string;
  products?: Product[];
  results?: SourceResultGroup[];
  note?: string;
  error?: string;
};

export function formatPriceCents(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "Price n/a";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function formatDimensions(product: Product): string | null {
  const { h_in, w_in, d_in } = product.dimensions;
  const parts: string[] = [];
  if (w_in != null) parts.push(`${w_in}" W`);
  if (d_in != null) parts.push(`${d_in}" D`);
  if (h_in != null) parts.push(`${h_in}" H`);
  if (!parts.length) return null;
  return parts.join(" × ");
}
