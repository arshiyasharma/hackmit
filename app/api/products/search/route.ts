import { NextRequest, NextResponse } from "next/server";
import { searchProducts } from "@/lib/elastic/search";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const q = searchParams.get("q") ?? undefined;
  const retailer = searchParams.get("retailer") ?? undefined;
  const maxPriceRaw = searchParams.get("max_price");

  let maxPriceCents: number | undefined;
  if (maxPriceRaw != null && maxPriceRaw !== "") {
    const parsed = Number.parseInt(maxPriceRaw, 10);
    if (!Number.isFinite(parsed)) {
      return NextResponse.json(
        { error: "max_price must be an integer (cents)", products: [] },
        { status: 400 }
      );
    }
    maxPriceCents = parsed;
  }

  try {
    const products = await searchProducts({ q, maxPriceCents, retailer });
    return NextResponse.json({ products });
  } catch (error) {
    console.error("[elastic] Product search failed:", error);
    return NextResponse.json(
      { error: "Product search unavailable", products: [] },
      { status: 502 }
    );
  }
}
