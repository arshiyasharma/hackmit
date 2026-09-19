# VISA — Visualize · Imagine · Shop · Arrange

> Point your phone at a wall. Draw a box around the part you want to change. Say what you want.
> The app designs it, finds every object as a real product you can buy, drops it into your room in
> AR at true physical size, tells you when it won't fit through your door — and buys the whole room
> from six different shops in one tokenized Visa checkout.

**HackMIT 2026.** Primary track: Visa — *Reimagine Shopping with Generative AI*.

---

## The one line

> Other tools help you buy the thing you already decided on. We help you discover what you didn't
> know you wanted — in the one place buying decisions actually get made: your own room.

## Why this exists

Decorating a room today means Pinterest for ideas, five browser tabs across Amazon, Etsy and
Wayfair, guessing what looks right, guessing what fits, and five separate checkouts. Then you find
out it doesn't work when the delivery driver can't get the sofa up the stairs.

Every part of that is a solved problem in isolation and nobody has put them in one place. We did.

## What it does

1. **Capture** — photo of a wall or corner, or live AR camera.
2. **Select** — lasso the region you want changed.
3. **Describe** — *"a warm boho reading nook with a leafy plant"*.
4. **Generate** — four design variants of just that region, matched to the room's real palette and lighting.
5. **Source** — every element reverse-image-searched into real listings from a verified-retailer whitelist, with real prices and real dimensions.
6. **Budget** — a live bar; over-budget items grey out with a cheaper swap suggested.
7. **Place** — the product renders in AR **locked to its true physical size**. Pinch-to-scale is disabled on purpose.
8. **Fit check** — *"needs 56° of tilt and 1,978 mm of headroom at your landing; you have 2,140."*
9. **Checkout** — one cart across every retailer, one tokenized Visa payment with a passkey step-up.

## The rule that makes it trustworthy

**The model never invents a dimension.**

Every measurement is either scraped from a merchant listing (tagged `quoted`, with the source URL and
field), entered by the user (`measured`), or estimated by CV — and anything `estimated` says so on
screen. The fit kernel is pure arithmetic and never sees a photograph. The model reads, extracts and
explains; it does not decide.

## Architecture

```
BROWSER  Next.js 15 · Tailwind · shadcn/ui · Framer Motion
         Konva.js (selection) · <model-viewer> + WebXR (AR)
                    |
                 HTTPS / JSON
                    |
API      FastAPI (async, Python 3.11)
         /analyze  /generate  /source  /fit  /cart  /checkout  /savings
                    |
   +----------------+----------------+-----------------+
   |                |                |                 |
gpt-4o-mini    image model      SerpAPI Lens      Visa Intelligent
(room JSON)    (inpainting)     + scrapers        Commerce (tokens,
                                + rembg           passkey, instructions)
   |                |                |
   +-------- REDIS cache + token ledger ---------+
                    |
            POSTGRES / SQLITE
```

### Modules

| Module | Endpoint | Responsibility |
|---|---|---|
| Room analysis | `POST /analyze` | Image → `{palette, style_tags, lighting, existing_objects, scale_reference}`. Faces blurred before the image leaves our server. |
| Generation | `POST /generate` | Base + mask + prompt → 4 variants, in parallel, cached on `sha256(room+mask+prompt)`. |
| Sourcing | `POST /source` | Variant → 3–5 real products per element with price, URL and `dims_mm` + `dims_source`. |
| Fit kernel | `POST /fit` | Product + access profile → `pass \| tight \| fail`, binding constraint, margin in mm. Pure functions, unit-tested. |
| Cart | `/cart` | Multi-retailer lines, budget total, per-item fit, swap suggestions. |
| Checkout | `POST /checkout` | Visa Intelligent Commerce flow; tokenized confirmation + split fulfilment. |
| Token ledger | `GET /savings` | Every model call logged with tokens and cost. Savings are **computed**, never hardcoded. |

## The fit check

The doorway is usually *not* what stops furniture. The corner turn is, and then headroom once you
tilt. Longest object of depth `w` that turns a right angle between corridors `a` and `b`:

```
L(θ) = (a − w·cos θ)/sin θ + (b − w·sin θ)/cos θ,  minimised over θ
```

| Depth | Corridors | Max length that turns flat |
|---|---|---|
| 700 mm | 900 / 900 | **1,146 mm** @ 45.0° |
| 720 mm | 900 / 870 | **1,063 mm** @ 46.4° |
| 900 mm | 900 / 870 | 693 mm @ 75.2° |

A 1,900 mm sofa carton can't turn that landing flat — so crews tilt it. At 56.0° it needs 1,978 mm of
headroom and passes a 2,140 mm landing with 162 mm to spare. A 2,300 × 900 carton needs 72.5° and
2,464 mm, and fails by 324 mm.

**Flat-pack short-circuits all of it** — if it ships in boxes, assembled size is irrelevant; check each
box instead.

*Scope, stated honestly: we treat the carton as a rectangular prism and ignore the corridor's third
dimension.*

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 15, React, Tailwind, shadcn/ui, Framer Motion |
| Selection | Konva.js |
| AR | `<model-viewer>` (WebXR on Android, Quick Look on iOS), MindAR fallback |
| Depth fallback | Depth Anything V2 via Replicate |
| Room analysis | OpenAI `gpt-4o-mini`, JSON mode |
| Generation | Inpainting (FLUX.1 Fill / Gemini Flash Image) |
| Image → 3D | Meshy |
| Product search | SerpAPI Google Lens + retailer APIs + Playwright |
| Backend | FastAPI + Redis |
| Database | Postgres (Railway) or SQLite |
| Payments | **Visa Intelligent Commerce** sandbox |
| Deploy | Vercel + Railway |

## Getting started

```bash
git clone <repo> && cd visa
cp .env.example .env            # fill in the keys below
# API
cd api && pip install -r requirements.txt && uvicorn main:app --reload
# Web
cd ../web && npm install && npm run dev
```

AR requires **HTTPS on a real phone** — use the Vercel preview URL, not localhost.

### Environment

| Variable | For | Cost |
|---|---|---|
| `OPENAI_API_KEY` | Room analysis (`gpt-4o-mini`) | cents |
| `VISA_CLIENT_ID` / `VISA_CLIENT_SECRET` | Intelligent Commerce sandbox — free, self-serve | free |
| `SERPAPI_KEY` | Google Lens reverse image search | free tier |
| `REPLICATE_API_TOKEN` | Depth Anything V2, FLUX inpainting | ~$5 |
| `GEMINI_API_KEY` | Image generation (if not on Replicate) | ~$5 |
| `MESHY_API_KEY` | Image-to-3D for products with no `.glb` | free tier |
| `REDIS_URL` | Variant cache + token ledger | free |
| `DATABASE_URL` | Postgres or SQLite | free |

> **Never commit a key.** `.env` is in `.gitignore` from the first commit. `.env.example` lists every
> variable name with no values. This repo is public for submission — a key in git history can't be
> removed by deleting the file.

## Tracks

| Track | What we ship for it |
|---|---|
| **Visa** *(primary)* | The whole loop: discovery → personalization → decision → unified multi-merchant tokenized checkout with passkey step-up. |
| **The Token Company** | Cheap model for tagging, expensive only for generation, Redis cache, and a real savings counter driven by the ledger. |
| **Ramp** | Time-saved and money-saved counters in the same sidebar. No extra work. |
| **OpenAI** | Room analysis runs on `gpt-4o-mini` — a real in-product API call — plus Codex as a teammate. This track judges both. |
| **Long Lake** | Pitch reframe: your parents can furnish a room this way without learning anything. |
| **Meta** *(only if collaborative mode ships)* | Two people, blended aesthetics, explanation panel and a vote. |

*No MongoDB track exists at HackMIT 2026 — the database is a merit choice.*

## Working agreements

- `main` stays deployable. Branch per module, small PRs, no long-lived forks.
- Commit once in hour one, all of you, so deploys are proven before anything is at stake.
- If the loop isn't end-to-end by hour 7, cut collaborative mode, image-to-3D, and the real payment
  integration. **Working beats ambitious.**
- Anything simulated gets labelled *simulated* on screen and said out loud. A judge who catches an
  unflagged fake is done with us.

## Not building

Full 3D room reconstruction · occlusion beyond WebXR's built-in · physics · real placed orders across
merchant APIs · voice · native apps · multi-room planning · assembly instructions · returns flow.
