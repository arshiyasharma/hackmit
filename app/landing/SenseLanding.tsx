"use client";

import dynamic from "next/dynamic";

// Keep the imperative Three.js landing browser-only while giving its modules
// a React refresh boundary that recreates the DOM alongside updated styles.
const SenseLandingClient = dynamic(() => import("./SenseLandingClient"), { ssr: false });

export default function SenseLanding() {
  return <SenseLandingClient />;
}
