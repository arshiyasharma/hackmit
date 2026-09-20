# PIXX-AR demo guide

Show the working path: a room photo, a specific product request, real listings,
a reviewed basket, agent verification, and a clearly labeled test checkout.
Describe each provider only as far as its observed response supports.

## Before presenting

1. Start the local server and use the same origin throughout the demo. Checkout
   runs are held in one server process, not durable shared storage. Restarting
   the process or reaching a different instance can lose the run.
2. Set `CHECKOUT_MODE=test` and `ENABLE_REAL_ORDERS=false`. The UI should show
   test mode. Real retailer ordering is not implemented; enabling the server's
   live flags makes the agent refuse rather than place an order.
3. Check TAP with `GET /api/tap/demo`. A successful response has `ok: true`.
   The private signing key and the public entry in `data/tap-registry.json`
   must agree. Generate development keys with `npm run keys:tap` if needed.
4. Rehearse a specific search such as “a warm brass floor lamp under $150”.
   Inspect the returned price, retailer link, and size source before linking it.
   Search caches help repeat requests, but new searches depend on upstream
   availability. Dimensions marked approximate are not measured delivery fit.
5. Choose the payment demonstration explicitly. With `PAYMENT_PROVIDER` unset
   or `simulated`, checkout simulates payment. With `acceptance`, it calls the
   configured Visa Acceptance sandbox merchant using test-card data and
   `capture: false`. Verify a successful sandbox response before presenting it.
6. Check `/api/visa/health` separately. Present VIC as connected only when a
   successful authenticated response supports it. Configuration alone, a
   gateway rejection, or an Acceptance approval does not prove VIC readiness.
   Mandate creation also needs `VISA_ENROLLMENT_REFERENCE_ID`.
7. Repeat the relevant checks against the actual presentation URL after deploy.

**Network rehearsal:** do not promise that the whole product works offline.
Room analysis, uncached sourcing, remote images, generated stand-ins, first-time
cutout model downloads, and enabled Visa calls can require the network. An
isolated `/api/checkout` simulation with a prepared basket, local TAP keys,
`PAYMENT_PROVIDER` unset, and `TAP_VERIFY_BASE_URL` unset uses the in-process
verifier and simulated payment. The checkout UI separately attempts an optional
VIC mandate, which can make a network request when configured.

## What the demo proves

| Piece | Demonstrated behavior | Boundary |
|---|---|---|
| Room and listings | Gemini room analysis with an OpenAI fallback; deterministic request normalization; indexed/live Shopping results and retailer dimension reads. | Providers can fail. Missing data remains unknown; some offers open Google Shopping. Explicit demo results are labeled. |
| Product preview and fit | A selected listing can supply its own cutout and dimensions. Fit uses product size plus measured route clearances. | Approximate sizes and missing measurements do not establish delivery clearance. Even a measured pass is a model result. |
| TAP identity | Ed25519 request signatures bind authority, path, expiry, and operation; our verifier checks them against the registry. | The merchant verifier is ours. This does not demonstrate adoption or checkout access at an external retailer. |
| Retailer checkout | The server validates basket amounts, budget, quantities, duplicate IDs, retailer hosts, and session ownership; it streams per-line test progress. | Basket actions and `TEST-` order references are simulated. Retailer accounts are not changed and goods are not ordered. |
| Visa Acceptance | When enabled and successful, a signed request returns sandbox authorization evidence and a reconciliation ID. | Uses the configured sandbox merchant and published test-card fixtures. No capture. It is a separate payment path from VIC. |
| Visa Intelligent Commerce | Code supports sandbox health, mandate, credential, cancellation, and confirmation requests. | An actual returned instruction ID is required. Missing onboarding, token references, or rejected calls are reported honestly. Acceptance approval is not confirmation of a VIC purchase. |

## A short walkthrough

**Room → request.** “Start with the room you have. Tell PIXX-AR what you want,
and compare listings in the context of your space.”

**Results → review.** Choose a listing with a direct supported retailer link.
Point out its price and whether dimensions are quoted or approximate. “These
are the items in the basket and the cap we set. Nothing has been ordered.”
Unsupported stores and unresolved offer links are excluded from checkout and
remain available through their listing links.

**Agent identity.** “Our demo merchant verifies the agent's signature for this
store, this page, and this operation.” Show the tamper example below. Do not
claim that every retailer supports this integration or that no other team does.

**Test checkout.** “The retailer checkout steps are simulated. We can also show
a separate Visa Acceptance sandbox authorization when that provider is enabled.
It uses our configured sandbox merchant, a test card, and no capture.”

**Optional VIC.** Show only the status and IDs actually returned. “The mandate
request carries the basket's budget cap. This is separate from the Acceptance
sandbox authorization.” If VIC is unavailable, name the returned stage rather
than implying that the budget is already enforced by Visa.

## API examples

Run these from a shell against the same local server used for the demo.
The TAP examples use a sample URL without fetching that retailer page.

```bash
curl -s http://localhost:3000/api/tap/demo | jq '.ok, .agentId'

curl -s 'http://localhost:3000/api/tap/demo?tamper=authority' | jq '.ok, .reason'
# false, "authority-mismatch"
curl -s 'http://localhost:3000/api/tap/demo?tamper=expiry' | jq '.reason'
# "expired"
curl -s 'http://localhost:3000/api/tap/demo?tamper=signature' | jq '.reason'
# "bad-signature"
curl -s 'http://localhost:3000/api/tap/demo?tamper=tag' | jq '.reason'
# "wrong-operation": the signature is valid for browsing, not payment

# Present a Wayfair-bound signature to our IKEA verifier.
curl -s -X POST http://localhost:3000/api/retailer/ikea/verify \
  -H 'Signature-Input: <from the demo>' -H 'Signature: <from the demo>' \
  -H 'content-type: application/json' \
  -d '{"targetUrl":"https://www.wayfair.com/furniture/pdp/arc-floor-lamp-123"}' | jq

# Optional: makes an actual sandbox request using the configured merchant.
curl -s -X POST http://localhost:3000/api/payments/authorize \
  -H 'content-type: application/json' -d '{"amountMinor":12000}' | jq
# Check status == "AUTHORIZED" and captured == false; do not assume success.

# VIC health reports presence booleans, never credential values.
curl -s http://localhost:3000/api/visa/health | jq
```

Checkout runs belong to their originating guest session. For curl, save and
reuse the cookie jar; a browser's run ID alone is insufficient. `basket.json`
should contain the reviewed `{ "basket": { "basketId", "budgetMinor", "lines" } }`
payload, with the actual IDs, prices, quantities, and supported retailer links.
Do not invent a product price for the demonstration.

```bash
curl -s -c /tmp/pixx-demo.cookies -X POST http://localhost:3000/api/checkout \
  -H 'content-type: application/json' --data-binary @basket.json | jq

curl -s -b /tmp/pixx-demo.cookies \
  'http://localhost:3000/api/checkout/<runId>' | jq

curl -s -b /tmp/pixx-demo.cookies -X POST http://localhost:3000/api/visa/mandate \
  -H 'content-type: application/json' -d '{"runId":"<runId>"}' | jq
# 503 vic-unconfigured: required VIC configuration is missing.
# 503 vts-pending: the app has no enrollment reference for this instruction.
# 502: the upstream request was refused, failed, or lacked an instruction ID.

# Use only IDs returned for this session's run; fabricated IDs are rejected.
curl -s -b /tmp/pixx-demo.cookies -X POST http://localhost:3000/api/visa/confirm \
  -H 'content-type: application/json' \
  -d '{"runId":"<runId>","lineId":"<lineId>","instructionId":"<instructionId>"}' | jq
```

Confirmation requires the run's own instruction, a retrieved transaction
reference, and authorization using that VIC credential. A simulated line is
not an approved purchase. The current Acceptance test-card path is separate,
so it cannot produce a linked VIC confirmation. Depending on which prerequisite
is absent, the route returns `409` with `instruction-mismatch`, `no-transaction`,
`nothing-to-confirm`, or `unlinked-authorization`; another session gets `404`.
Browser write requests also enforce same-origin checks. These controls do not
replace durable storage, production authentication, or retailer integrations.
