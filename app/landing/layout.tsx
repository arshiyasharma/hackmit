import type { Metadata, Viewport } from "next";
import { Reenie_Beanie } from "next/font/google";

/**
 * The display, body and mono faces come from the root layout now: the product
 * lives in this page's third room, and its sheets and toasts render in <body>,
 * outside this wrapper. One set of font variables on <html> is the only way both
 * halves of the screen agree on a typeface. Only the handwriting is the
 * landing's own.
 */
const reenie = Reenie_Beanie({ variable: "--font-reenie", subsets: ["latin"], weight: "400", display: "swap" });

export const metadata: Metadata = {
  title: "PIXX-AR — the future of spatial shopping",
  description:
    "The future of spatial shopping: your vision, curated in one secure marketplace, one click away.",
};

/** The root layout already covers the notch; this restates it so the landing
 *  stands on its own, and tints the browser chrome to the stage, not the app. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // the stage is one drag surface behind a fixed HUD; a pinch-zoomed WebGL
  // canvas is broken, and nothing on the page is a document to zoom into
  maximumScale: 1,
  // the HUD reaches back out into the notch and the home indicator with env()
  viewportFit: "cover",
  // the landing is a black room in both schemes, unlike the product app's paper
  themeColor: "#000000",
};

export default function LandingLayout({ children }: LayoutProps<"/landing">) {
  return (
    <div className={reenie.variable}>
      {children}
    </div>
  );
}
