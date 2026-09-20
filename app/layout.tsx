import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Instrument_Sans, Sometype_Mono } from "next/font/google";

import Toasts from "@/components/ui/Toasts";

import "./globals.css";

/**
 * Three families, the same three the landing page speaks in, so the product
 * reads as the landing's third room rather than as a different site.
 *
 * Display: headlines and names. Never a button label, and never a number.
 * The heavier weights exist because Cormorant is slight: small display text
 * wants 500, and a synthesised bold of it is ugly.
 */
const display = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
});

/** Body and UI. */
const body = Instrument_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

/** Every number that can change, and every label. Tabular by nature. */
const mono = Sometype_Mono({
  variable: "--font-sometype",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "PIXX-AR — see it, fit it, buy it",
  description:
    "Point your phone at your room, ask for one thing, and see real furniture standing in it at real size — then let one approval buy it at every shop.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // the whole app is a phone held vertically; a pinch-zoomed AR view is broken
  maximumScale: 1,
  viewportFit: "cover",
  // light only: paper in both schemes
  themeColor: "#FAF7F0",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body className="min-h-full flex flex-col font-sans">
        {children}
        <Toasts />
      </body>
    </html>
  );
}
