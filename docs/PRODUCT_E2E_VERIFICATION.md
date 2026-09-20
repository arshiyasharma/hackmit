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


## Persistent inventory and real product photos

- Matching products stay on the left. **In your room** is now a separate, persistent 200px panel on the right; on phones it becomes an 80px rail. Selection opens the corresponding matches, and removal/undo remains available. Browser checks covered 1440×900, 390×844, and 375×667 without horizontal overflow.
- Selecting a listing now shows background-removal progress. The decoded transparent product image replaces the illustration in the room; its placement, rotation, and scale are retained. Missing images and failures expose a retry instead of silently leaving a placeholder. Request tokens prevent stale A→B→A responses from overwriting the current choice.
- The plain-background extractor remains the fast path. Coloured/lifestyle photos now use **BiRefNet-General-Lite** through local ONNX inference, preserving the source product pixels. Weak masks, clipped objects, multiple substantial foregrounds, and full-photo masks are rejected. Inference is bounded and superseded queued requests are skipped.
- Real API checks: an Etsy stone lamp and a dark green floor lamp both returned transparent cutouts (roughly eight seconds each); the repeat cached request took 12ms. A cropped lamp and a collage were refused. No paid search or image-generation requests were used for these checks. The older opaque fallback described in the historical table above is no longer used.
- The browser selected an actual listing image, decoded the API image, and rendered it as the scene sprite rather than the generated silhouette while preserving the item's position, rotation, and scale. Pure mask/cache tests cover original pixel colours, alpha handling, confidence, clipping, multiple objects, aborts, and cache versioning; client tests cover stale responses, retry, timeout, decode failure, and delete/undo.

### Segmentation runtime

`onnxruntime-node` is a server-only external dependency. On first non-packshot use, the server downloads the fixed 224MB BiRefNet-General-Lite model from the rembg release, verifies its published checksum, and saves it under the ignored `.placeholder-cache/models/birefnet-lite.onnx`. Subsequent requests reuse one local CPU session; there is no external inference API or API key. Provision the same model ahead of time with `CUTOUT_MODEL_PATH` for an offline deployment, or set `PLACEHOLDER_CACHE_DIR` to a writable persistent cache location. The model license is retained in `docs/licenses/BiRefNet.txt`. The API/client extraction deadline is 90 seconds to allow a cold download; ordinary cached-model extraction is much shorter.

Final regression check: 618 tests passed; three opt-in Visa sandbox tests skipped. TypeScript, focused ESLint and diff whitespace checks passed. The added ONNX runtime was upgraded to 1.30.0; dependency audit reported zero vulnerabilities.


## Faster, less restrictive product cutouts

The previous 1024-pixel remover could spend 6–8 seconds and then reject a real product because it touched the frame or had multiple separated foreground pieces. The product flow now prioritizes a usable real listing photo. Flat white/colored backgrounds use the fast border mask; complex photos use the pinned BiRefNet-Lite 512 export, with U²-Net 320 as a quick alternative for weak/cropped predictions. The original listing pixels are preserved; no generated image is used as a successful result. Cropped edges and separated pieces are accepted, and rectangular objects receive transparent padding.

Real endpoint checks on four public listing photos returned four transparent PNGs, including both previously rejected samples. Initial dev compilation/model load took 4.05s; the next three requests took 2.42s, 2.04s, and 1.53s. These are limited sample results, not a guarantee for every merchant image. Complex collages can still leave unwanted foreground pieces or incomplete objects; edge perfection is deliberately secondary to returning the real product image.

Client requests now have a 30-second deadline. Deleting/replacing an item cancels its old request immediately. Hot reload/hydration no longer leaves an orphaned “Removing background…” status forever. The native model session survives development hot reloads.

The default model artifact is now `.placeholder-cache/models/birefnet-lite-512.onnx` (192MB), pinned to Hugging Face revision `4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7` with SHA-256 verification. `CUTOUT_MODEL_PATH`, if set, must point to this 512 export rather than the former 1024 artifact. The optional fast fallback is `.placeholder-cache/models/u2net.onnx`; model licenses are retained under `docs/licenses/`. Both files are already cached on the development machine. This section supersedes the older strict-rejection and 90-second runtime details above.

Fast-cutout regression verification: 630 tests passed; three opt-in Visa tests skipped. TypeScript, targeted ESLint, and whitespace checks passed. All four returned PNGs had both visible product pixels and zero-alpha background pixels.

## White background quality and Adjust placement

White packshots containing pale foreground pixels now receive a semantic matte after the quick border pass. This removes enclosed white spaces between legs and shelves instead of keeping them as solid white patches; clean existing transparency still bypasses inference. A refinement can shrink the incorrect background-expanded bounds, but a result retaining only a small fragment is refused. The shared `white-matte-v7` revision invalidates the old cache and is returned by the API.

Visually checked source/border-mask/refined results on a reconstructed white source made from the user's cached oak table, plus cached merchant photos of a black console table, thin brass lamp, and ribbed vase. The oak table's enclosed gaps and exterior speckles disappeared while its pale tabletop stayed visible. The black table's shelf openings and floor background became transparent; the lamp stem and vase outline were retained. These local sample extractions took approximately 1.1–3.2 seconds with cached models. Marketing collages and partially cropped lifestyle photos remain less reliable than clear product packshots.

Existing ready photos with an older version automatically upgrade once per linked listing, sequentially. The current photo stays in place until its replacement decodes; a failed refresh retains it and offers retry. A selected ready listing also exposes **Refresh photo**. Automatic attempts are recorded before requesting, preventing retries from looping during hot reload or against an older server response.

An isolated guest browser used a local room fixture and a real public stone-lamp listing. Its automatic upgrade called the actual `/api/cutout`, decoded the returned PNG, and reached `ready` with `white-matte-v7` in about 2.1 seconds, preserving position, rotation 8°, and scale 1.2. A follow-up fixture confirmed the previous source-photo URL remained during pending and the cached replacement then swapped in. No paid generation/search or checkout was invoked.

**Adjust** is restored to the far right of the selected-item action group, including 390px mobile. Desktop and phone checks confirmed resize/rotation interaction and no horizontal overflow. TypeScript, targeted ESLint, whitespace checks, and the full regression suite passed: 644 tests, with 3 opt-in Visa sandbox tests skipped.
