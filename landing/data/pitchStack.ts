// Source-audited pitch data. No credentials, account identifiers, or production claims.
// Package versions below are exact package.json declarations, including range markers.

export const stackGroups = [
  {
    title: "The experience",
    items: [
      { name: "Next.js · React · TypeScript", status: "Built", detail: "One application for the room studio, typed product data, server routes, and checkout.", source: "package.json; app/landing/SenseLandingClient.tsx; components/room3/ProductRoom.tsx; app/api" },
      { name: "Three.js · React Three Fiber · WebXR", status: "Built", detail: "A spatial scene for placing furniture, with a photo workspace when immersive AR is unavailable.", source: "components/ArScene.tsx; components/PlaceholderSprite.tsx; components/PhotoMode.tsx; landing/gl" },
      { name: "GSAP · Motion", status: "Built", detail: "Choreographed room transitions, responsive interface motion, and reduced-motion alternatives.", source: "landing/motion.ts; landing/gl/Stage.ts; lib/motion.ts; components/FitSheet.tsx" },
      { name: "Tailwind CSS · Base UI", status: "Built", detail: "Reusable buttons, dialogs, inputs, typography, and responsive layouts.", source: "app/globals.css; postcss.config.mjs; components/ui; components.json" },
      { name: "Howler · Lenis", status: "Built", detail: "Ambient landing-page audio and smooth scrolling through the basket story.", source: "landing/audio/sound.ts; landing/ui/BasketPage.ts" },
      { name: "Zustand", status: "Built", detail: "Room selections, the shopping budget, measurements, and preview state stay connected.", source: "lib/store.ts; lib/preview.ts" },
    ],
  },
  {
    title: "Understanding the room",
    items: [
      { name: "Google Gemini", status: "Live integration", detail: "Reads the uploaded photo into a structured palette, style tags, lighting, and shopping suggestions.", source: "app/api/analyze/route.ts; lib/roomAnalysis.ts" },
      { name: "OpenAI · GPT-4o mini", status: "Optional analysis fallback", detail: "A secondary photo-analysis path over the OpenAI HTTP API; used when Gemini is not configured or returns no usable context.", source: "app/api/analyze/route.ts" },
      { name: "EXIF-aware capture", status: "Built", detail: "Corrects photo orientation and resizes the image before analysis and placement.", source: "components/Capture.tsx; exifr" },
      { name: "Deterministic request normalization", status: "Built", detail: "Turns everyday furniture phrases into consistent categories without another model request.", source: "app/api/normalise/route.ts" },
    ],
  },
  {
    title: "Finding real products",
    items: [
      { name: "SerpAPI · Google Shopping", status: "Live integration", detail: "Finds listings, resolves seller links, and brings prices and product imagery into the room.", source: "lib/sourcing/serpapi.ts; lib/sourcing/enrich.ts" },
      { name: "Elasticsearch", status: "Integrated catalog", detail: "Searches the product catalog first, filters by price and retailer, and stores enriched results for reuse.", source: "lib/elastic/client.ts; lib/elastic/search.ts; lib/elastic/index.ts; lib/sourcing/sourceProducts.ts" },
      { name: "Retailer dimension extraction", status: "Built", detail: "Extracts dimensions from listing pages and distinguishes quoted sizes from estimates.", source: "lib/sourcing/scrapeDimensions.ts; lib/sourcing/dims.ts; lib/sourcing/adapter.ts" },
      { name: "Context-aware matching", status: "Built", detail: "Combines the shopper's request with room style and selected colors, while keeping explicit requests in control.", source: "lib/sourcing/roomContext.ts; lib/sourcing/sourceProducts.ts; lib/optionSearch.ts" },
    ],
  },
  {
    title: "Seeing it before buying",
    items: [
      { name: "Sharp · BiRefNet · ONNX Runtime", status: "Built", detail: "Removes product-photo backgrounds locally so real listing pixels can be placed in the room.", source: "lib/productCutout.ts; lib/productSegmentation.ts; lib/cutout.ts" },
      { name: "Higgsfield", status: "Optional preview provider", detail: "Generates an initial concept sprite while a real product is being chosen; curated silhouettes provide a fallback.", source: "lib/placeholder.ts; app/api/placeholder/route.ts" },
      { name: "Scale and delivery-clearance checks", status: "Built", detail: "Uses a photo reference and entered measurements to assess doorway clearance, a level 90° turn, and headroom.", source: "components/PhotoMode.tsx; lib/fit.ts; lib/fitProfile.ts; components/FitBadge.tsx" },
    ],
  },
  {
    title: "Controlled checkout",
    items: [
      { name: "Visa Acceptance Solutions", status: "Sandbox verified", detail: "Signed test authorizations reached our own sandbox merchant account and appeared in its transaction portal. Nothing was captured.", source: "lib/visaAcceptance/payments.ts; lib/visaAcceptance/httpSignature.ts; app/api/payments/authorize/route.ts" },
      { name: "Trusted Agent Protocol demonstration", status: "Local verification", detail: "Ed25519 signatures bind an agent request to a merchant domain, page, operation, and short validity window.", source: "lib/tap/sign.ts; lib/tap/verify.ts; lib/tap/merchant.ts; app/api/tap/demo/route.ts" },
      { name: "Server-sent checkout updates", status: "Built", detail: "Streams each line's progress and authorization outcome into the review screen.", source: "app/api/checkout/[runId]/stream/route.ts; lib/checkout/agent.ts; components/CheckoutRun.tsx" },
      { name: "Budget and ownership checks", status: "Built", detail: "Validates integer amounts, quantity limits, retailer URLs, and checkout ownership before processing.", source: "app/api/checkout/route.ts; lib/checkout/request.ts; lib/checkout/runs.ts; lib/checkout/basket.ts" },
    ],
  },
  {
    title: "Engineering the demo",
    items: [
      { name: "Vitest · ESLint · TypeScript", status: "Development", detail: "Regression tests cover search, dimensions, fit, image processing, payment signing, and checkout failures.", source: "vitest.config.mts; eslint.config.mjs; tsconfig.json; lib/**/*.test.ts; app/api/__tests__" },
      { name: "Bounded image downloads", status: "Built", detail: "Checks public network addresses, pins validated DNS, rechecks redirects, and limits response size and duration.", source: "lib/remoteImage.ts" },
      { name: "Vercel", status: "Deployment target", detail: "The intended Next.js deployment target. A production deployment has not been verified; the demonstrated build runs locally.", source: "docs/DEMO_SCRIPT.md; app/api/checkout/route.ts; next.config.ts" },
      { name: "Supabase Google sign-in", status: "Optional integration", detail: "Google OAuth is implemented through Supabase, with a working guest path when it is not configured.", source: "lib/auth/session.ts; lib/supabase/client.ts; lib/supabase/server.ts; app/auth/callback/route.ts" },
    ],
  },
] as const;

export const apiRoutes = [
  {
    "method": "POST",
    "path": "/api/analyze",
    "detail": "Extracts palette, style, lighting, and shopping suggestions from a room photo.",
    "status": "Integrated"
  },
  {
    "method": "GET",
    "path": "/api/checkout/[runId]",
    "detail": "Returns the checkout snapshot to its owning guest session.",
    "status": "Built"
  },
  {
    "method": "GET",
    "path": "/api/checkout/[runId]/stream",
    "detail": "Streams each line’s progress using server-sent events.",
    "status": "Built"
  },
  {
    "method": "POST",
    "path": "/api/checkout",
    "detail": "Validates the basket and starts an owner-bound checkout run.",
    "status": "Built"
  },
  {
    "method": "POST",
    "path": "/api/cutout",
    "detail": "Extracts a transparent product cutout from the actual listing image.",
    "status": "Built"
  },
  {
    "method": "POST",
    "path": "/api/fit",
    "detail": "Checks measured doorway, level corner, and headroom clearances.",
    "status": "Built"
  },
  {
    "method": "GET / POST",
    "path": "/api/normalise",
    "detail": "Normalizes everyday furniture requests into consistent categories.",
    "status": "Built"
  },
  {
    "method": "POST",
    "path": "/api/payments/authorize",
    "detail": "Sends a signed test authorization to Visa Acceptance with capture disabled.",
    "status": "Sandbox verified"
  },
  {
    "method": "GET / POST",
    "path": "/api/placeholder",
    "detail": "Creates initial concept sprites and serves cached preview images.",
    "status": "Optional generation"
  },
  {
    "method": "GET",
    "path": "/api/products/search",
    "detail": "Searches the Elasticsearch product catalog.",
    "status": "Configuration dependent"
  },
  {
    "method": "POST",
    "path": "/api/retailer/[retailer]/verify",
    "detail": "Runs our merchant-side TAP signature verifier.",
    "status": "Local demonstration"
  },
  {
    "method": "POST",
    "path": "/api/search",
    "detail": "Finds studio item matches using the request, room context, and remaining budget.",
    "status": "Integrated"
  },
  {
    "method": "POST",
    "path": "/api/source",
    "detail": "Sources and enriches products for a shopping request.",
    "status": "Integrated"
  },
  {
    "method": "POST / GET",
    "path": "/api/tap/demo",
    "detail": "Demonstrates local agent signing and tamper verification.",
    "status": "Local demonstration"
  },
  {
    "method": "POST",
    "path": "/api/visa/confirm",
    "detail": "Submits a purchase outcome only with matching payment evidence.",
    "status": "VIC onboarding required"
  },
  {
    "method": "POST",
    "path": "/api/visa/credentials",
    "detail": "Requests a payment credential for an owned checkout line without exposing it to the browser.",
    "status": "VIC / VTS onboarding required"
  },
  {
    "method": "POST",
    "path": "/api/visa/enroll",
    "detail": "Registers a tokenized card reference with VIC.",
    "status": "VIC / VTS onboarding required"
  },
  {
    "method": "GET",
    "path": "/api/visa/health",
    "detail": "Checks VIC configuration and performs an authenticated diagnostic probe when configured.",
    "status": "VIC onboarding required"
  },
  {
    "method": "PUT",
    "path": "/api/visa/mandate/[instructionId]/cancel",
    "detail": "Cancels an instruction owned by the checkout session.",
    "status": "VIC onboarding required"
  },
  {
    "method": "POST",
    "path": "/api/visa/mandate",
    "detail": "Creates a purchase instruction bound to a checkout run.",
    "status": "VIC onboarding required"
  }
] as const;

export const dependencyGroups = [
  {
    "title": "Active application packages",
    "body": "@base-ui/react ^1.8.0; @elastic/elasticsearch ^9.5.1; @google/genai ^2.23.0; @number-flow/react ^0.6.2; @react-three/drei ^10.7.8; @react-three/fiber ^9.7.0; @react-three/xr ^6.6.30; @use-gesture/react ^10.3.1; class-variance-authority ^0.7.1; cn ^0.3.0; exifr ^7.1.3; gsap ^3.15.0; howler ^2.2.4; lenis ^1.3.26; lucide-react ^1.47.0; motion ^13.4.0; next 16.3.5; onnxruntime-node ^1.30.0; react 19.2.8; react-dom 19.2.8; sharp ^0.35.4; sonner ^2.0.8; three ^0.183.1; zustand ^5.0.15. Imported by the application; WebXR depends on device support and external API features depend on configuration."
  },
  {
    "title": "Optional integrations",
    "body": "@supabase/ssr ^0.12.7; @supabase/supabase-js ^2.116.0; jose ^6.2.12. Supabase supports optional Google sign-in. jose provides JWE for VIC, whose live flow still requires onboarding."
  },
  {
    "title": "Installed, not used by the current application",
    "body": "@clerk/nextjs ^7.9.4; @google/model-viewer ^4.3.1; embla-carousel-react ^8.6.0; framer-motion ^13.4.0; konva ^10.6.0; mongodb ^7.6.0; react-konva 19.2.7; react-modal-sheet ^5.6.0. No imports were found in app, components, lib, landing, or scripts. These are not claimed as active product integrations."
  },
  {
    "title": "Component-generation tooling",
    "body": "shadcn ^4.21.0. shadcn generates the local Base UI-based components; it is not a runtime backend."
  },
  {
    "title": "Build, verification, and type tooling",
    "body": "@tailwindcss/postcss ^4; @types/howler ^2.2.13; @types/node ^24.13.6; @types/react ^19; @types/react-dom ^19; eslint ^9; eslint-config-next 16.3.5; tailwindcss ^4; tw-animate-css ^1.4.0; typescript ^5; vitest ^5.0.1. Versions reproduce package.json declarations; a caret denotes an allowed version range, not an exact installed version."
  },
  {
    "title": "External APIs and model artifacts",
    "body": "SerpAPI Google Shopping and immersive product results; Google Gemini through @google/genai; optional OpenAI gpt-4o-mini HTTP analysis; optional Higgsfield CLI previews (default gpt_image_2_5); BiRefNet-General-Lite ONNX weights for local CPU cutouts; Visa Acceptance sandbox authorization. These services/artifacts have no separate npm package declaration here."
  },
  {
    "title": "Proposed tools, not implemented",
    "body": "ElevenLabs and xAI / Grok: no application imports, HTTP clients, or API calls found. Do not present either as powering the current demo. Vercel is a deployment target, not a verified deployment."
  }
] as const;
