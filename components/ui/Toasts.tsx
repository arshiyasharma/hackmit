"use client";

/**
 * Where the toasts stand.
 *
 * On a laptop the bottom of the room screen is the listing tray and the right
 * is the agent panel, so a bottom-centre toast lands on top of the thing it is
 * about. The top centre is the one edge nothing else uses. Under the `desk`
 * breakpoint the old bottom-centre position is still the clear one.
 *
 * Mounted once, by the root layout. Never mount a second Toaster: every toast
 * would show twice.
 */

import { Toaster } from "sonner";

import { useDesktop } from "@/lib/useDesktop";

export default function Toasts() {
  const desktop = useDesktop();
  return (
    <Toaster
      position={desktop ? "top-center" : "bottom-center"}
      richColors={false}
      closeButton={false}
      gap={8}
      offset={desktop ? { top: 20 } : { bottom: 24 }}
      toastOptions={{
        style: {
          background: "var(--surface)",
          color: "var(--foreground)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "0 14px 38px -12px rgb(90 38 24 / 0.28), 0 2px 6px rgb(90 38 24 / 0.07)",
          fontFamily: "var(--font-body)",
          fontSize: "14px",
        },
      }}
    />
  );
}
