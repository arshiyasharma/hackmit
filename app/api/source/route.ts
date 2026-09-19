import { NextRequest, NextResponse } from "next/server";
import type { Product } from "@/lib/sourcing/enrich";
import { parseShoppingQuery } from "@/lib/sourcing/parseQuery";
import {
  buildContextualShoppingQuery,
  getSearchTerms,
  type RoomContext,
} from "@/lib/sourcing/roomContext";
import { sourceProductsForQuery } from "@/lib/sourcing/sourceProducts";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const query = body?.query;

  if (!query || typeof query !== "string") {
    return NextResponse.json({ error: "query required" }, { status: 400 });
  }

  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "SERPAPI_KEY is not configured" },
      { status: 500 }
    );
  }

  const roomContext = (body?.roomContext ?? null) as RoomContext | null;
  const searchTerms = getSearchTerms(roomContext);

  // Multi-item flow: one product set per roomContext.searchTerms entry.
  if (searchTerms.length > 0) {
    const { maxPrice } = parseShoppingQuery(query);

    const results = await Promise.all(
      searchTerms.map(async (searchTerm) => {
        const shoppingQuery = buildContextualShoppingQuery(
          searchTerm,
          roomContext,
          query
        );

        try {
          const products = await sourceProductsForQuery({
            shoppingQuery,
            apiKey,
            maxPrice,
            limit: 4,
            designQuery: query,
          });
          return { searchTerm, products };
        } catch (error) {
          console.error(
            `[source] Failed sourcing for "${searchTerm}":`,
            error
          );
          return {
            searchTerm,
            products: [] as Product[],
          };
        }
      })
    );

    return NextResponse.json({ query, results });
  }

  // Backward-compatible simple query flow.
  const { searchQuery, maxPrice } = parseShoppingQuery(query);

  try {
    const products = await sourceProductsForQuery({
      shoppingQuery: searchQuery,
      apiKey,
      maxPrice,
      limit: 5,
      designQuery: searchQuery,
    });

    if (products.length === 0) {
      return NextResponse.json({
        products: [],
        note: "no_whitelist_matches",
      });
    }

    return NextResponse.json({ products });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "SerpAPI request failed";
    return NextResponse.json(
      { error: message, products: [] },
      { status: 502 }
    );
  }
}
