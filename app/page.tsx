import Link from "next/link";

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#FBFAF7] text-[#2A2724]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,#F0E4D8_0%,transparent_55%),radial-gradient(ellipse_at_bottom_left,#E8D9CC_0%,transparent_50%)]"
      />
      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-5 py-16 sm:px-10">
        <p className="text-sm font-semibold tracking-[0.22em] text-[#C97B5F] uppercase">
          VISA
        </p>
        <h1 className="mt-5 max-w-3xl text-5xl font-semibold tracking-tight sm:text-6xl">
          Spatial shopping for the room you already have.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-8 text-[#665F59]">
          Upload a photo, describe what you want, and get real products that fit
          your palette, lighting, and style — with dimensions pulled from
          retailer pages.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/generate"
            className="inline-flex items-center justify-center rounded-2xl bg-[#C97B5F] px-6 py-4 text-base font-semibold text-white transition hover:bg-[#B86B50]"
          >
            Start discovering
          </Link>
          <a
            href="#how"
            className="inline-flex items-center justify-center rounded-2xl border border-[#DDD5CB] bg-white/70 px-6 py-4 text-base font-medium text-[#2A2724] backdrop-blur"
          >
            How it works
          </a>
        </div>

        <section id="how" className="mt-24 grid gap-8 sm:grid-cols-3">
          {[
            {
              step: "01",
              title: "Read the room",
              body: "Gemini extracts palette, lighting, and style tags from your photo.",
            },
            {
              step: "02",
              title: "Source the pieces",
              body: "We search Google Shopping across Amazon, IKEA, Wayfair, Walmart, and Etsy.",
            },
            {
              step: "03",
              title: "Trust the fit",
              body: "Product pages are scraped for W × D × H so placement isn’t a guess.",
            },
          ].map((item) => (
            <div key={item.step}>
              <p className="text-xs font-semibold tracking-[0.18em] text-[#C97B5F]">
                {item.step}
              </p>
              <h2 className="mt-2 text-lg font-semibold">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-[#665F59]">{item.body}</p>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
