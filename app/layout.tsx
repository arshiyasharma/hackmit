import type { Metadata, Viewport } from "next";
import { Fraunces, Instrument_Sans } from "next/font/google";
import { Toaster } from "sonner";

import "./globals.css";

/** Display serif — headings and every number. Never a button label. */
const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

/** Body and UI. */
const body = Instrument_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "VISA — see it, fit it, buy it",
  description:
    "Photograph a corner of your room, describe what it should become, and get four redesigns where every object is a real listing that fits through your door.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // the whole app is a phone held vertically; a pinch-zoomed AR view is broken
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FBFAF7" },
    { media: "(prefers-color-scheme: dark)", color: "#191715" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${display.variable} ${body.variable}`}
    >
      <body className="min-h-full flex flex-col font-sans">
        {children}
        <Toaster
          position="bottom-center"
          richColors={false}
          closeButton={false}
          gap={8}
          offset={{ bottom: 24 }}
          toastOptions={{
            style: {
              background: "var(--surface)",
              color: "var(--foreground)",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-xl)",
              boxShadow: "0 8px 30px rgb(0 0 0 / 0.12)",
              fontFamily: "var(--font-body)",
              fontSize: "14px",
            },
          }}
        />
      </body>
    </html>
  );
}
