/** Room IV presentation content. Set demoVideoUrl when the final film is ready. */
export const pitch = {
  slogan: ["The spatial", "marketplace."],
  validationVideoUrl: "https://www.youtube.com/shorts/yD_aFuvd4iY",
  demoVideoUrl: "",
  signups: "70+",
  repository: "https://github.com/ygadipalli/hackmit",
};

export const team = [
  { name: "Arshiya Sharma", role: "Room intelligence & product identity", body: "Connected room-aesthetic analysis to product discovery through the Gemini and Higgsfield workflows. Led the transition to the PIXX-AR identity." },
  { name: "Jose Cruz-Lopez", role: "Frontend & spatial experience", body: "Built the room experience, product placement, previews, fit visualization, and visual and motion design. Strengthened live search and room analysis." },
  { name: "Yashasree Gadipalli", role: "Application architecture & checkout", body: "Established the application foundation, authentication, basket and checkout orchestration, budget safeguards, caching, and verification systems." },
  { name: "Yutian Gong", role: "Product sourcing & authentication", body: "Built early product sourcing and retailer-page scraping, improved search performance, contributed to the AR workflow, and added Google authentication." },
];

export const gallery = [
  { file: "team-build.webp", title: "A table, four laptops, one idea.", alt: "The team working on laptops around a table at HackMIT.", width: 1600, height: 900, shape: "wide" },
  { file: "focus-mode.webp", title: "Do not disturb. Probably debugging.", alt: "A teammate typing with their blue HackMIT hoodie pulled forward.", width: 1200, height: 1600, shape: "portrait" },
  { file: "opening-ceremony.webp", title: "Before the first commit.", alt: "A group selfie from the auditorium seating at HackMIT.", width: 1200, height: 1600, shape: "small" },
  { file: "matching-hoodies.webp", title: "The unofficial team uniform.", alt: "Two teammates wearing matching blue HackMIT hoodies.", width: 1200, height: 1600, shape: "small" },
  { file: "hallway-build.webp", title: "Our second office.", alt: "An overhead view of teammates working on laptops at a red hallway bench.", width: 1200, height: 1600, shape: "small" },
  { file: "team-selfie.webp", title: "The people behind the pixels.", alt: "Four teammates taking a selfie in matching HackMIT hoodies.", width: 900, height: 1600, shape: "small" },
  { file: "hackmit-meetup.webp", title: "And the people we met along the way.", alt: "Four people in front of the colorful HackMIT backdrop and balloons.", width: 1600, height: 1200, shape: "panorama" },
];

export const authFeatures = [
  { title: "Shopper identity", body: "Google OAuth through Supabase provides account sign-in when configured. A clearly identified guest path keeps the demo accessible." },
  { title: "Checkout ownership", body: "An HttpOnly, SameSite cookie binds each checkout run to the browser that created it. Other sessions cannot read its status or payment progress." },
  { title: "Payment integrity", body: "Signed Visa Acceptance requests authenticate the sandbox payment. A local Trusted Agent Protocol demo verifies the agent’s identity and request scope." },
];

export const details = [
  { number: "01", title: "The room writes the search.", body: "Palette, lighting, style, and your own edits travel with each request. Explicit preferences take priority, and a simpler search can recover when a styled query is too narrow.", tag: "Context-aware discovery" },
  { number: "02", title: "Original pixels. Honest previews.", body: "We isolate the actual listing image for placement. When extraction fails, a clearly labeled illustration stays in the room. Estimated dimensions never become a verified measurement.", tag: "Product image extraction" },
  { number: "03", title: "A fit check has to earn its green light.", body: "Doorway, right-angle turn, and headroom are checked separately. Missing measurements stay unknown; tight clearance stays a warning. The geometry is a model, not a delivery guarantee.", tag: "Spatial geometry" },
  { number: "04", title: "Changing your mind is a first-class action.", body: "Searches respond to budget edits. Replacing a piece releases its own budget, and late results from an older photo or request cannot overwrite your newer choices.", tag: "State & concurrency" },
  { number: "05", title: "One review. A traceable checkout.", body: "A reviewed basket becomes a fixed server snapshot. Session ownership, duplicate protection, progress events, and bounded retries keep the agent’s work tied to that approval.", tag: "Checkout orchestration" },
  { number: "06", title: "A payment result you can point to.", body: "A signed request reaches Visa Acceptance’s sandbox and returns a real authorization reference. The demo exposes that result, keeps capture disabled, and labels retailer orders as simulated.", tag: "Verified sandbox payments" },
];

export const roadmap = [
  { title: "From a photo to a home.", body: "Floor plans, automatic depth and geometry, and a persistent digital twin that remembers the spaces and pieces you already own." },
  { title: "A budget for the whole room.", body: "Optimize combinations of products across retailers, compare alternatives, and balance style, size, and price together." },
  { title: "From sandbox to ownership.", body: "Complete VIC enrollment and passkey consent, connect retailer fulfillment, and bring order tracking and cross-brand rewards into one place." },
];

export const visaStages = [
  { title: "Discovery", status: "Built", ask: "Help people discover without perfect keywords.", answer: "Start with a room photo and “something warm for this corner.” Room analysis turns that feeling into a search for real products." },
  { title: "Personalization", status: "Built", ask: "Make the journey relevant to the shopper.", answer: "The actual room’s palette, lighting, style, budget, and editable preferences shape product discovery. Personalization begins with their space." },
  { title: "Decision-making", status: "Built · estimates labeled", ask: "Give people confidence before they commit.", answer: "Preview pieces in the room, inspect dimensions, and check delivery constraints. Unknown sizes and unmeasured doorways remain visibly unverified." },
  { title: "Checkout", status: "Demo orchestration", ask: "Reduce the friction between choosing and buying.", answer: "Review items from multiple retailers in one basket and start one coordinated agent run. The prototype simulates retailer fulfillment; it does not place real orders." },
  { title: "Payments", status: "Sandbox verified", ask: "Make agent-driven payments trustworthy.", answer: "Trust starts with identity and ownership: optional Google sign-in, session-bound checkout, and signed Visa Acceptance requests. Test-card authorizations were verified in our merchant portal; altered signatures are rejected. VIC credential tokenization and passkey consent are the next integration step." },
  { title: "Loyalty & rewards", status: "Next", ask: "Create value beyond an individual purchase.", answer: "A cross-retailer room basket could become a home for unified rewards and relevant offers. This is a product direction, not an implemented rewards system." },
  { title: "Post-purchase", status: "Next · prevention today", ask: "Keep helping after checkout.", answer: "Pre-purchase fit checks aim to surface size problems earlier. A unified order timeline, delivery updates, and return support are planned; we have not measured a reduction in returns." },
];

/** Track titles supplied by the team. These are project alignments, not award claims. */
export const sponsorTracks = [
  { sponsor: "Elastic", title: "Find the Signal", body: "Turn scattered product results into a reusable catalog. Elasticsearch supports filtered discovery; fresh shopping results can enrich that index for the next query.", tag: "Search & retrieval" },
  { sponsor: "Ramp", title: "Save Time. Save Money.", body: "Keep the room budget visible, constrain product searches, and review the whole basket together. Room-wide budget optimization is the next step.", tag: "Product impact" },
  { sponsor: "Long Lake", title: "Convince a Non-Believer", body: "Start with something personal: a photo of their own room. Let a skeptic describe a feeling, find a real product, and see the idea take shape in that space.", tag: "An experience you can try" },
  { sponsor: "OpenAI", title: "OpenAI Challenge (5th Teammate)", body: "OpenAI vision provides an alternate room-analysis path. Codex supported implementation, debugging, and verification, including fixing stale budget results and checking the checkout flow.", tag: "Generation & development" },
  { sponsor: "Cursor / SpaceXAI", title: "Make it Legendary with SpaceXAI", body: "Track eligibility is under review. The brief requires Cursor and Grok Imagine or Voice API in a space-data project; that integration is not demonstrated in the current build.", tag: "Eligibility to confirm" },
];
