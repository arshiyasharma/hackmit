# VISA — AI spatial shopping agent

HackMIT project: upload a room photo, describe what you want, and source real products (with dimensions) from Amazon, IKEA, Wayfair, Walmart, and Etsy.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` in the project root:

```bash
SERPAPI_KEY=...                 # required for product sourcing
GEMINI_API_KEY=...              # required for room photo analysis
ELASTICSEARCH_URL=...           # optional; speeds up repeat searches
ELASTICSEARCH_API_KEY=...       # optional; Elastic Cloud auth
```

3. Run the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → **Start discovering** → `/generate`.

## Flow

1. **Home** (`/`) — entry point
2. **Discover** (`/generate`) — upload room photo → `POST /api/analyze` (Gemini) → type a request → `POST /api/source`
3. **Source pipeline** — Elasticsearch catalog (if configured) → SerpAPI Google Shopping → whitelist retailers → immersive buy URLs → scrape W/D/H from PDPs → upsert to Elastic
4. Results render on the same page (grouped by room `searchTerms` when present)

## API

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/analyze` | POST | `{ imageBase64 }` → room context JSON |
| `/api/source` | POST | `{ query, roomContext? }` → products / result groups |
| `/api/products/search` | GET | `?q=&retailer=&max_price=` (cents) Elastic-only catalog |

Text-only search works without a photo (`roomContext` omitted). Photo analysis needs `GEMINI_API_KEY`.
