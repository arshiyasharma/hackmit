"use client";

import { ChangeEvent, useRef, useState } from "react";
import Link from "next/link";
import { ProductResults } from "@/components/ProductResults";
import type {
  RoomContext,
  SourceResponse,
  SourceResultGroup,
} from "@/lib/types";

export default function DiscoverPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<string | null>(null);
  const [request, setRequest] = useState(
    "a warm boho reading nook with a leafy plant"
  );
  const [context, setContext] = useState<RoomContext | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultGroups, setResultGroups] = useState<SourceResultGroup[]>([]);
  const [searched, setSearched] = useState(false);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Could not read that photo."));
      reader.readAsDataURL(file);
    });

    setImage(dataUrl);
    setContext(null);
    setError(null);
    setResultGroups([]);
    setSearched(false);
    setIsAnalyzing(true);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: dataUrl }),
      });
      const responseText = await response.text();
      let data: RoomContext & { error?: string };
      try {
        data = JSON.parse(responseText) as RoomContext & { error?: string };
      } catch {
        throw new Error(
          responseText ||
            `Room analysis returned an empty response (${response.status}).`
        );
      }
      if (!response.ok) {
        throw new Error(data.error ?? "Could not analyze this room.");
      }
      setContext(data);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not analyze this room."
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function runProductSearch() {
    const query = request.trim();
    if (!query) return;

    setError(null);
    setIsSearching(true);
    setSearched(true);
    setResultGroups([]);

    const handoff = {
      query,
      roomContext: context ?? undefined,
    };
    sessionStorage.setItem("visa-search-request", JSON.stringify(handoff));
    window.dispatchEvent(
      new CustomEvent("visa-search-ready", { detail: handoff })
    );

    try {
      const response = await fetch("/api/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(handoff),
      });
      const responseText = await response.text();
      let data: SourceResponse;
      try {
        data = JSON.parse(responseText) as SourceResponse;
      } catch {
        throw new Error(
          responseText ||
            `Product search returned an empty response (${response.status}).`
        );
      }
      if (!response.ok) {
        throw new Error(data.error ?? "Product search failed.");
      }

      if (Array.isArray(data.results)) {
        setResultGroups(data.results);
      } else if (Array.isArray(data.products)) {
        setResultGroups([{ searchTerm: query, products: data.products }]);
      } else {
        setResultGroups([]);
      }

      const total = Array.isArray(data.results)
        ? data.results.reduce((n, g) => n + (g.products?.length ?? 0), 0)
        : data.products?.length ?? 0;
      if (total === 0) {
        setError(
          data.error ??
            "No products found for that request. Try a shorter product name."
        );
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Product search failed."
      );
      setResultGroups([]);
    } finally {
      setIsSearching(false);
    }
  }

  const canSearch = Boolean(request.trim()) && !isAnalyzing && !isSearching;

  return (
    <main className="min-h-screen bg-[#FBFAF7] px-5 py-10 text-[#2A2724] sm:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="text-sm font-semibold tracking-[0.18em] text-[#C97B5F] uppercase"
          >
            VISA
          </Link>
          <p className="text-sm text-[#776E66]">Discover</p>
        </div>

        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Find pieces that belong in your room.
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-[#665F59]">
          Upload a room photo for palette and style context, describe what you
          want, and we source matching products from trusted retailers.
        </p>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <section className="rounded-3xl border border-[#E6E0D8] bg-white p-5 shadow-sm sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">1. Your space</h2>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="rounded-full bg-[#2A2724] px-4 py-2 text-sm font-medium text-white"
              >
                {image ? "Choose another" : "Upload photo"}
              </button>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleFile}
            />
            <div className="mt-5 aspect-4/3 overflow-hidden rounded-2xl bg-[#F1ECE5]">
              {image ? (
                <>
                  {/* FileReader returns a local data URL; Next image optimizer cannot fetch it. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image}
                    alt="Uploaded room"
                    className="h-full w-full object-cover"
                  />
                </>
              ) : (
                <div className="flex h-full items-center justify-center px-8 text-center text-[#776E66]">
                  Optional — upload a clear photo so we can match palette,
                  lighting, and style. You can still search with text only.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-[#E6E0D8] bg-white p-5 shadow-sm sm:p-7">
            <h2 className="text-lg font-semibold">2. What do you need?</h2>
            <textarea
              value={request}
              onChange={(event) => setRequest(event.target.value)}
              rows={4}
              className="mt-5 w-full resize-none rounded-2xl border border-[#DDD5CB] bg-[#FFFEFC] p-4 outline-none focus:border-[#C97B5F]"
              placeholder="A cozy reading chair under $300…"
            />
            {isAnalyzing && (
              <p className="mt-5 text-sm text-[#776E66]">
                Reading your room’s aesthetic…
              </p>
            )}
            {context && (
              <div className="mt-5 rounded-2xl bg-[#F7F2EC] p-4">
                <p className="text-sm font-semibold">Room context ready</p>
                <p className="mt-2 text-sm text-[#665F59]">
                  {(context.styleTags ?? []).join(" · ")}
                  {context.lighting ? ` · ${context.lighting} light` : ""}
                </p>
                {!!context.palette?.length && (
                  <div className="mt-3 flex gap-2">
                    {context.palette.map((color) => (
                      <span
                        key={color}
                        title={color}
                        className="h-7 w-7 rounded-full border border-black/10"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                )}
                {!!context.searchTerms?.length && (
                  <p className="mt-3 text-xs text-[#776E66]">
                    Looking for: {context.searchTerms.join(", ")}
                  </p>
                )}
              </div>
            )}
            <button
              type="button"
              disabled={!canSearch}
              onClick={runProductSearch}
              className="mt-5 w-full rounded-2xl bg-[#C97B5F] px-5 py-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSearching ? "Searching products…" : "Find products"}
            </button>
            <p className="mt-3 text-center text-xs text-[#776E66]">
              Sources Amazon, IKEA, Wayfair, Walmart, and Etsy — with real
              dimensions when the product page has them.
            </p>
            {error && (
              <p className="mt-4 rounded-xl bg-[#FFF0EB] p-3 text-sm text-[#9D402A]">
                {error}
              </p>
            )}
          </section>
        </div>

        <ProductResults
          groups={resultGroups}
          isLoading={isSearching}
          emptyMessage={
            searched
              ? "No matching products from whitelist retailers. Try a simpler request."
              : undefined
          }
        />
      </div>
    </main>
  );
}
