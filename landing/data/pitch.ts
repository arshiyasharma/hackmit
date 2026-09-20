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

export const details = [
  { title: "Auth & trust", body: "Optional Google sign-in, protected checkout sessions, and signed sandbox payments." },
  { title: "Budget control", body: "Set your limit. Keep product searches and your basket within budget." },
  { title: "Room-aware search", body: "Find real products using your room’s colors, style, and your request." },
  { title: "Product previews", body: "Place real product images in your room before you choose." },
  { title: "Fit checks", body: "Check dimensions, doorways, turns, and headroom. Estimates stay labeled." },
  { title: "One basket", body: "Review products from multiple retailers in one place." },
];

export const roadmap = [
  { title: "Live AR", body: "Move around your space and preview furniture through your phone’s camera." },
  { title: "3D room models", body: "Turn a room scan into an editable 3D model. Arrange furniture and compare layouts." },
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
  { id: "elastic", label: "Elastic", points: ["Retrieve", "Filter", "Reuse"], demo: "Search the catalog, narrow by price and retailer, and reuse enriched product results.", sponsor: "Elastic", logos: [{ file: "elastic.png", label: "Elastic", width: 501, height: 172 }], title: "Find the Signal", body: "Turn scattered product results into a reusable catalog. Elasticsearch supports filtered discovery; fresh shopping results can enrich that index for the next query.", tag: "Search & retrieval" },
  { id: "ramp", label: "Ramp", points: ["Time", "Budget", "Control"], demo: "Set a room budget, compare options, and review the basket in one place.", sponsor: "Ramp", logos: [{ file: "ramp.svg", label: "Ramp", width: 71, height: 20 }], title: "Save Time. Save Money.", body: "Keep the room budget visible, constrain product searches, and review the whole basket together. Room-wide budget optimization is the next step.", tag: "Product impact" },
  { id: "long-lake", label: "Long Lake", points: ["Personal", "Tangible", "Intuitive"], demo: "Use a visitor’s room photo and show a real product in their own space.", sponsor: "Long Lake", logos: [{ file: "long-lake.png", label: "Long Lake", width: 1024, height: 103 }], title: "Convince a Non-Believer", body: "Start with something personal: a photo of their own room. Let a skeptic describe a feeling, find a real product, and see the idea take shape in that space.", tag: "An experience you can try" },
  { id: "openai", label: "OpenAI", points: ["Vision", "Codex", "Verification"], demo: "Explain the alternate OpenAI room-analysis path and show the code and checks built with Codex.", sponsor: "OpenAI", logos: [{ file: "openai.png", label: "OpenAI", width: 960, height: 264 }], title: "OpenAI Challenge (5th Teammate)", body: "OpenAI vision provides an alternate room-analysis path. Codex supported implementation, debugging, and verification, including fixing stale budget results and checking the checkout flow.", tag: "Generation & development" },
  { id: "cursor", label: "Cursor", points: ["Development", "Grok", "Eligibility"], demo: "Show the current build honestly. Grok integration and the required space-data focus still need to be demonstrated.", sponsor: "Cursor / SpaceXAI", logos: [{ file: "cursor.svg", label: "Cursor", width: 2239, height: 532 }, { file: "spacexai.svg", label: "SpaceXAI", width: 834, height: 318 }], title: "Make it Legendary with SpaceXAI", body: "Track eligibility is under review. The brief requires Cursor and Grok Imagine or Voice API in a space-data project; that integration is not demonstrated in the current build.", tag: "Eligibility to confirm" },
];
