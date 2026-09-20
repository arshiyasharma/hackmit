# Product verification — 20 September 2026

Branch: `frontend-v3`. Server: `http://localhost:3000/landing?product&demo=0`.

## Square interface

The product scope now includes body-portalled dialogs, embedded workspace, standalone capture/checkout, and product notifications. Budget setup and remaining-budget dialogs use the same square glass surface and Instrument Sans typography. Legacy important rounded utilities no longer override that contract.

Browser checks at 1440 × 900 and 390 × 844 confirmed zero-radius visible controls for account, style, history, budget editing, scale controls, fit, measurements, and order mode. Dialogs fit the viewport with no horizontal overflow. The initial budget prompt and checkout budget prompt also passed zero-radius assertions. Escape restores focus through the shared dialog implementation.

## Unmocked guest flow

Uploaded a JPEG made from the repository room sample `public/assets/rooms/R1a.avif`. Browser fetch and EventSource observers recorded actual responses without changing them. Demo mode was disabled; no seeded products or mocked API responses were used in this flow.

| Boundary | Actual result |
| --- | --- |
| Room upload → `/api/analyze` | HTTP 200, `source: model`, room style/palette/suggestions, about 2.6 s |
| Prompt → `/api/normalise` | HTTP 200, category `floor lamp` |
| Product search → `/api/search` | HTTP 200, `source: live`, five real listings, about 8.3 s |
| Preview → `/api/placeholder` | HTTP 200, `source: generated`, `cached: false`, image URL, about 14 s |
| Selection → `/api/fit` | HTTP 200, stored fit verdict and updated selection |
| Listing image → `/api/cutout` | HTTP 200 with an image URL; this endpoint can retain the original listing background when it cannot key the image |
| Budget | Real $44.99 Walmart selection, then $164.50 Etsy selection, correctly updated the $600 budget |
| Supported checkout → `/api/checkout` | HTTP 200; server-generated run |
| Checkout progress stream | `pending → walking → authorizing → placed (test) → done` |
| Final run read | Finished, `mode: test`, `TEST-ETSY-…` order reference, no Visa instruction |

Checkout was simulated. No purchase was submitted and no card was charged. The progress came from the server, not browser fixtures.

## Issues found and corrected

- Unsupported stores previously reached a misleading Buy all action. Checkout now lists excluded items and store links before submission, offers no submit action for an entirely unsupported basket, and uses the eligible quantity/total for a mixed basket.
- A known retailer label could override an unsupported URL. A valid product URL is now authoritative, including rejection of non-HTTP(S) schemes.
- Non-USD items were being relabeled as USD at checkout. They are now explicitly excluded with a clear explanation.
- Checkout totals rounded cents away. Review, order mode, and confirmation now preserve cents.
- Test-run copy no longer claims a signature verification when that integration is unconfigured.
- Photo-stage accessibility now names the group Room preview instead of allowing inline animation CSS to become its name.

## Automated checks

- Existing backend suite: 334 passed, 3 opt-in Visa sandbox tests skipped, duplicate worktrees excluded.
- Updated checkout adapter/render regression suite: 41 passed, including unsupported-only and mixed baskets, misleading retailer metadata, URL schemes, and non-USD rejection.
- TypeScript, targeted ESLint, and git diff whitespace checks passed.

## External configuration limits

- Google OAuth cannot be completed here: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are absent. The explicit guest flow was verified instead.
- Visa health reports HTTP 503 / unconfigured. Visa/TAP credentials are absent, so this run does not verify live authentication, a Visa mandate, payment authorization, or TAP identity verification.
- Checkout defaults to test mode with simulated payment. Live retailer ordering is not implemented by this backend.

## Room-preserving glass redesign

The subsequent entry redesign keeps the actual Room III canvas visible and inert behind the product rather than resetting it or displaying an opaque page. Its last frame stays frozen during product use and is redrawn on viewport resize. Sign-in appears as a centered rectangular glass card; capture, workspace, checkout, and portalled dialogs share the red room palette. Returning sessions see Continue to studio on entry.

A fresh browser visit verified the sign-in card, actual unconfigured-Google response, explicit guest path, real JPEG upload, and model analysis, all at the unchanged `/landing?product&demo=0` URL. At 1440×900 the glass workspace is inset24px, with no extra page scroll and all visible corners0px. Separate visual checks covered390×844 and short landscape; photo aspect ratio and the left product panel are preserved. The screen entrance releases its opacity layer after finishing so native backdrop blur remains effective.

## Aesthetic, extraction, and delivery-fit update

- The workspace now keeps **Your aesthetic** visible, shows genuine analysis progress, distinguishes model results from fallback data, and shows recently added preferences in its summary. Changes remain in the current room state. Replacing a photo cannot be overwritten by the previous photo's delayed analysis.
- Browser checks used a local room fixture and intercepted API responses, with no paid model/search calls. Removing `modern`, adding `rattan`, and adding blue produced `blue warm wood rattan floor lamp`; both search and placeholder payloads contained the edited context. Explicit request colors take priority. Existing plain-object fallback searches remain available if styled results are unavailable.
- Product extraction now uses border-color segmentation with transparency/edge checks and a versioned cache. Failed isolation keeps a labeled illustration rather than placing an opaque listing photo in the room. Synthetic image tests cover pale objects, alpha, soft edges, narrow objects, collages, and cache invalidation.
- Optional doorway/stair measurements are accessible through **Delivery fit**. Unmeasured fields remain unknown; product and route estimates are distinguished. Door, 90-degree turn, and headroom calculations give separate warnings. These rectangular-box estimates are not a delivery guarantee and do not model every staircase shape.
- Checked desktop and phone layouts, including 375×667 and 812×375: no horizontal overflow; short screens scroll instead of crushing the room image.
- The larger guided setup sequence is awaiting the user's requested approval; the existing navigation remains in use.
