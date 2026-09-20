"use client";

import { ChangeEvent, useRef, useState } from "react";

type RoomContext = {
  palette: string[];
  styleTags: string[];
  lighting: "warm" | "cool" | "neutral";
  searchTerms: string[];
};

export default function DiscoverPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<string | null>(null);
  const [request, setRequest] = useState("a warm boho reading nook with a leafy plant");
  const [context, setContext] = useState<RoomContext | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        throw new Error(responseText || `Room analysis returned an empty response (${response.status}).`);
      }
      if (!response.ok) throw new Error(data.error ?? "Could not analyze this room.");
      setContext(data);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not analyze this room.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  function prepareSearch() {
    if (!context || !request.trim()) return;
    const handoff = { query: request.trim(), roomContext: context };
    sessionStorage.setItem("visa-search-request", JSON.stringify(handoff));
    window.dispatchEvent(new CustomEvent("visa-search-ready", { detail: handoff }));
  }

  return (
    <main className="min-h-screen bg-[#FBFAF7] px-5 py-10 text-[#2A2724] sm:px-10">
      <div className="mx-auto max-w-5xl">
        <p className="mb-3 text-sm font-semibold tracking-[0.18em] text-[#C97B5F] uppercase">VISA · Discover</p>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">Find pieces that belong in your room.</h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-[#665F59]">We read your room’s palette, lighting, and style, then hand that context to product search.</p>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <section className="rounded-3xl border border-[#E6E0D8] bg-white p-5 shadow-sm sm:p-7">
            <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">1. Your space</h2><button type="button" onClick={() => inputRef.current?.click()} className="rounded-full bg-[#2A2724] px-4 py-2 text-sm font-medium text-white">{image ? "Choose another" : "Upload photo"}</button></div>
            <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFile} />
            <div className="mt-5 aspect-[4/3] overflow-hidden rounded-2xl bg-[#F1ECE5]">
              {image ? <>
                {/* FileReader returns a local data URL, which Next's image optimizer cannot fetch. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt="Uploaded room" className="h-full w-full object-cover" />
              </> : <div className="flex h-full items-center justify-center px-8 text-center text-[#776E66]">Upload a clear photo of the room you’re shopping for.</div>}
            </div>
          </section>

          <section className="rounded-3xl border border-[#E6E0D8] bg-white p-5 shadow-sm sm:p-7">
            <h2 className="text-lg font-semibold">2. What do you need?</h2>
            <textarea value={request} onChange={(event) => setRequest(event.target.value)} rows={4} className="mt-5 w-full resize-none rounded-2xl border border-[#DDD5CB] bg-[#FFFEFC] p-4 outline-none focus:border-[#C97B5F]" placeholder="A cozy reading chair under $300…" />
            {isAnalyzing && <p className="mt-5 text-sm text-[#776E66]">Reading your room’s aesthetic…</p>}
            {context && <div className="mt-5 rounded-2xl bg-[#F7F2EC] p-4"><p className="text-sm font-semibold">Room context ready</p><p className="mt-2 text-sm text-[#665F59]">{context.styleTags.join(" · ")} · {context.lighting} light</p><div className="mt-3 flex gap-2">{context.palette.map((color) => <span key={color} title={color} className="h-7 w-7 rounded-full border border-black/10" style={{ backgroundColor: color }} />)}</div></div>}
            <button type="button" disabled={!context || !request.trim()} onClick={prepareSearch} className="mt-5 w-full rounded-2xl bg-[#C97B5F] px-5 py-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Send context to product search</button>
            <p className="mt-3 text-center text-xs text-[#776E66]">Search receives your request plus room style—not a generated image.</p>
            {error && <p className="mt-4 rounded-xl bg-[#FFF0EB] p-3 text-sm text-[#9D402A]">{error}</p>}
          </section>
        </div>
      </div>
    </main>
  );
}
