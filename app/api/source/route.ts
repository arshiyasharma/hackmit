import { NextRequest, NextResponse } from "next/server";
import { isRequestObject, MAX_QUERY_LENGTH, validRoomContext } from "@/lib/sourcing/request";
import type { Product } from "@/lib/sourcing/enrich";
import { parseShoppingQuery } from "@/lib/sourcing/parseQuery";
import {
  buildContextualShoppingQuery,
  buildSimpleShoppingQuery,
  resolveSearchTermsForQuery,
  type RoomContext,
} from "@/lib/sourcing/roomContext";
import { sourceProductsForQuery } from "@/lib/sourcing/sourceProducts";

/** Cap multi-item fanout — Gemini often returns 5 terms; 3 keeps latency usable. */
const MAX_SEARCH_TERMS = 3;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!isRequestObject(body) || typeof body.query !== "string" ||
      !body.query.trim() || body.query.length > MAX_QUERY_LENGTH) {
    return NextResponse.json({ error: "query must contain 1–500 characters" }, { status: 400 });
  }
  if (!validRoomContext(body.roomContext)) {
    return NextResponse.json({ error: "Invalid roomContext" }, { status: 400 });
  }
  const query = body.query.trim();

  const apiKey = process.env.SERPAPI_KEY ?? "";

  const roomContext = (body?.roomContext ?? null) as RoomContext | null;
  const searchTerms = resolveSearchTermsForQuery(
    query,
    roomContext,
    MAX_SEARCH_TERMS
  );

  // Multi-item flow: one real product set per furniture searchTerm.
  if (searchTerms.length > 0) {
    const { maxPrice } = parseShoppingQuery(query);

    const shoppingByTerm = searchTerms.map((searchTerm) => ({
      searchTerm,
      shoppingQuery: buildContextualShoppingQuery(
        searchTerm,
        roomContext,
        query
      ),
    }));

    const uniqueQueries = [
      ...new Set(shoppingByTerm.map((t) => t.shoppingQuery)),
    ];
    const productsByQuery = new Map<string, Promise<Product[]>>();

    for (const shoppingQuery of uniqueQueries) {
      // Relevance filter against the furniture term, not the scene sentence.
      const termForFilter =
        shoppingByTerm.find((t) => t.shoppingQuery === shoppingQuery)
          ?.searchTerm ?? shoppingQuery;

      productsByQuery.set(
        shoppingQuery,
        sourceProductsForQuery({
          shoppingQuery,
          apiKey,
          maxPrice,
          limit: 4,
          designQuery: termForFilter,
        }).catch((error) => {
          console.error(
            `[source] Failed sourcing for "${shoppingQuery}":`,
            error
          );
          return [] as Product[];
        })
      );
    }

    const results = await Promise.all(
      shoppingByTerm.map(async ({ searchTerm, shoppingQuery }) => {
        const products = await productsByQuery.get(shoppingQuery)!;
        return { searchTerm, products };
      })
    );

    return NextResponse.json({ query, results });
  }

  // Simple / specific product query (e.g. "pink lamp") — one result list.
  // Still uses room lighting/style when present; ignores unrelated searchTerms.
  const { searchQuery, maxPrice } = parseShoppingQuery(query);
  const shoppingQuery = buildSimpleShoppingQuery(searchQuery, roomContext);

  try {
    const products = await sourceProductsForQuery({
      shoppingQuery,
      apiKey,
      maxPrice,
      limit: 5,
      designQuery: searchQuery,
    });

    if (products.length === 0) {
      return NextResponse.json({
        products: [],
        note: "no_results",
      });
    }

    return NextResponse.json({ products });
  } catch (error) {
    console.error("[source] Unhandled sourcing error:", error);
    return NextResponse.json({
      products: [],
      note: "no_results",
      error:
        "No products found for that request. Try a shorter product name (e.g. \"blue sofa\").",
    });
  }
}
