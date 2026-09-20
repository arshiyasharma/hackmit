import type { Metadata } from "next";
import { DM_Sans, Instrument_Serif } from "next/font/google";
import "./waitlist.css";

const sans = DM_Sans({
  variable: "--font-wl-sans",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const serif = Instrument_Serif({
  variable: "--font-wl-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "PIXX-AR — furniture that actually fits",
  description:
    "PIXX-AR drops real furniture into your real room in ar, checks it clears the doorway, and keeps your cart under budget. join the waitlist.",
  openGraph: {
    title: "PIXX-AR — furniture that actually fits",
    description:
      "see it to scale, fit it through the door, stay under budget. join the PIXX-AR waitlist.",
  },
};

export default function WaitlistLayout({ children }: LayoutProps<"/waitlist">) {
  return <div className={`${sans.variable} ${serif.variable} flex w-full min-w-0 flex-1`}>{children}</div>;
}
