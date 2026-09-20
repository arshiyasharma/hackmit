import type { NextConfig } from "next";

// A phone on the venue wifi loads the dev server by LAN IP, and Next blocks
// /_next requests from any origin it was not started with. Put your machine's
// LAN IP in .env.local as DEV_ORIGIN so the repo stays machine-neutral.
const devOrigin = process.env.DEV_ORIGIN;

const nextConfig: NextConfig = {
  allowedDevOrigins: devOrigin ? [devOrigin] : [],
  // the dev badge sits bottom-left, exactly on the landing page's sound tile,
  // and swallows the tap. Compile and runtime errors still surface.
  devIndicators: false,
};

export default nextConfig;
