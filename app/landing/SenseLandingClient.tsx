"use client";

// @refresh reset

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { mount } from "@/landing/main";

import "@/landing/styles/tokens.css";
import "@/landing/styles/base.css";
import "@/landing/styles/components.css";
import "@/landing/styles/pages.css";
import "@/landing/styles/interactions.css";
import "@/landing/styles/approve.css";
import "@/landing/styles/intro.css";
import "@/landing/styles/about.css";

/**
 * Room III is the product. It is a React app and the landing is not, so it is
 * mounted here, beside the landing's root rather than inside it: the landing
 * kills touch and pointer events on its own tree for the 3D stage, and the
 * product needs both. Nothing of it is downloaded until the door is opened.
 */
const ProductRoom = dynamic(() => import("@/components/room3/ProductRoom"), { ssr: false });

/** One visit to the product: what to tell the landing, and when. */
type Visit = { onCovered: () => void; done: () => void };

export default function SenseLandingClient() {
  const root = useRef<HTMLDivElement>(null);
  const [visit, setVisit] = useState<Visit | null>(null);

  useEffect(() => {
    if (!root.current) return;
    // A static dependency lets Fast Refresh rebuild the imperative DOM when
    // its modules change; the outer boundary keeps this code browser-only.
    return mount(root.current, {
      openProduct: ({ onCovered }) =>
        new Promise<void>((resolve) => setVisit({ onCovered, done: resolve })),
    });
  }, []);

  return (
    <>
      <div ref={root} className="sense" inert={visit !== null} />
      {visit ? (
        <ProductRoom
          onCovered={visit.onCovered}
          // Resume the same room as the glass interface fades away
          onLeaving={visit.done}
          onGone={() => setVisit(null)}
        />
      ) : null}
    </>
  );
}
