# The demo, and what is true

Written for the Visa "Reimagine Shopping" table. Everything in Part 2 is a
sentence you can say out loud without it becoming untrue when somebody opens
the laptop.

---

## Part 0. Before you stand up

| # | Check | How you know it worked |
|---|---|---|
| 1 | `.env.local` has the four `TAP_*` lines | `curl localhost:3000/api/tap/demo` returns `"ok": true` |
| 2 | `TAP_KEY_ID` matches a key in `data/tap-registry.json` | same call — a mismatch gives `unknown-key` |
| 3 | `CHECKOUT_MODE=test`, `ENABLE_REAL_ORDERS` unset | the checkout screen shows the green **TEST MODE — no money moves** bar |
| 4 | `PAYMENT_PROVIDER` **unset** for the offline rehearsal | the walk completes with the router off |
| 5 | `PAYMENT_PROVIDER=acceptance` only if you want a live Visa authorization on screen | each line shows `Visa authorized · $120.00 · <reconciliation id>` |
| 6 | Check the **deployed** env in the Vercel dashboard, not just your laptop | the TEST MODE bar is on the deployed URL too |
| 7 | If VIC credentials arrived, paste them into `.env.local` | `curl localhost:3000/api/visa/health` returns 200 instead of 503 |
| 8 | Both Androids charged | iPhone Safari still has no WebXR |

**The offline rehearsal.** Run the app locally, turn the router off, press
checkout. Every line must still go green. The server's walk makes no outbound
request in test mode — there is no `fetch(` in `lib/checkout/agent.ts` and a
test asserts it — so if anything stalls, something is fetching that should not
be.

---

## Part 1. What is real, in one table

Have this in your head. The single fastest way to lose a payments judge is to
be caught overstating; the single fastest way to win one is to name your own
boundary before they find it.

| Piece | Real | Simulated |
|---|---|---|
| Agent identity (TAP) | Ed25519 signature over RFC 9421, bound to the shop's domain and the exact page, five-minute window. Verified against a key resolved from a registry. | The **merchant** is ours. No real retailer implements TAP yet. |
| The retailer walk | The listings, the prices, the product URLs. | The purchase. No retailer exposes an API we could buy through. Order refs are `TEST-` prefixed. |
| The payment | A signed authorization to `apitest.visaacceptance.com`, a Visa-operated endpoint, returning a real `AUTHORIZED` and a reconciliation id. | The merchant is Visa's published **shared test merchant**, the card is Visa's published test PAN, and `capture: false` — nothing is ever captured. |
| The mandate (VIC) | Built and tested. The X-Pay token, the JWE encryption and the payload builders all work offline; the mandate's `declineThreshold` is the budget HUD's cap. | Waiting on credentials. Without them every VIC endpoint answers 503 and the checkout run is untouched. The mandate line does not appear unless the server has a real `instructionId`. **Never faked.** |

---

## Part 2. The ninety-second payment beat

Rehearse until it is muscle memory. Timings are the whole beat, not each line.

**1 · The room. (0:00)**
Lamp and two frames standing in the room, budget reading $1,250 with $310 left.

> "Nothing is bought yet. This is just a basket with a cap on it."

**2 · Press checkout. (0:10)**
The green TEST MODE bar is already on screen and stays there.

> "One button. Four items, three different stores."

**3 · The first line lights up, and the signature line appears under it. (0:20)**
`signature verified · visa-room-agent`

> "Before it touches a store, the agent proves who it is — Visa's Trusted
> Agent Protocol, a real signature, bound to that store's domain and that exact
> page. The store checks it."

**4 · The tamper demo. (0:40) — four seconds, and it is the moment that separates you.**

```bash
curl -s localhost:3000/api/tap/demo?tamper=authority | jq '.ok, .reason'
# false
# "authority-mismatch"
```

> "Change one character of the domain and it is rejected. It cannot be replayed
> anywhere else."

The other three are worth knowing if they ask: `expiry` → `expired`,
`signature` → `bad-signature`, `tag` → a valid signature that was only cleared
to browse, not to buy.

**5 · The walk completes. (1:00)**
Four test orders, `TEST-IKEA-…`, `TEST-WAYFAIR-…`.

> "Test mode. Real ordering is behind a flag that is off, and that button
> cannot reach it. The retailer walk is a simulation per store — no store
> exposes an API we could buy through, and I would rather say that than bluff."

**6 · If `PAYMENT_PROVIDER=acceptance` is on. (1:10)**
Each line carries `Visa authorized · $120.00 · 7898716909956640004807`.

> "And that authorization is real. Signed request, Visa's own sandbox, a real
> reconciliation id. It is Visa's shared test merchant and Visa's test card,
> and it is never captured — but it is not a mock."

**7 · If the mandate has landed** — `/api/visa/health` is green and VTS gave you a token reference.

> "And the cap on the budget is not our UI — it is the decline threshold on a
> Visa purchase mandate. The number in the corner is how much this agent is
> authorized to spend."

**Line 7 is the one to lead with if the Visa rep is standing there and you only
get one sentence.** Until Prompt 7 ships, line 3 is.

---

## Part 3. Questions they will ask

**"Are you really buying from Amazon?"**
> "No, and there is no version of this where we could — no retailer exposes an
> API to buy through. We freeze real listings and replay them, and the purchase
> step runs in test mode against real payment infrastructure."

**"Is that a real card?"**
> "It is Visa's published test card against Visa's published shared test
> merchant, and we authorize without capturing. Nothing moves."

**"What is the agent actually doing that a script could not?"**
> "It proves its identity cryptographically, per request, bound to each
> merchant's domain — so the merchant can tell our agent from a scraper, and a
> captured signature cannot be replayed at another store. That is the half of
> agentic commerce nobody else at this table has built."

**"Do you send Visa fake transaction data?"**
> "No, and you can prove it. `/api/visa/confirm` returns a 409 for any line
> that was only simulated — it refuses to report an approval for a purchase
> that did not happen. Signals are how Visa resolves disputes; feeding the
> sandbox fiction would be worse than sending nothing."

**"What happens if the verification fails?"**
> "The line fails with the reason and the run carries on. Open the tamper
> endpoint and I will show you all four failure modes."

---

## Part 4. The endpoints, for a judge with curl

```bash
# the agent's signature, and a shop checking it
curl -s localhost:3000/api/tap/demo | jq

# the same, tampered four different ways
curl -s "localhost:3000/api/tap/demo?tamper=authority"  | jq '.reason'
curl -s "localhost:3000/api/tap/demo?tamper=expiry"     | jq '.reason'
curl -s "localhost:3000/api/tap/demo?tamper=signature"  | jq '.reason'
curl -s "localhost:3000/api/tap/demo?tamper=tag"        | jq '.reason'

# a shop refusing a signature made for a different shop
curl -s -X POST localhost:3000/api/retailer/ikea/verify \
  -H "Signature-Input: <from the demo>" -H "Signature: <from the demo>" \
  -H 'content-type: application/json' \
  -d '{"targetUrl":"https://www.wayfair.com/furniture/pdp/arc-floor-lamp-123"}' | jq

# a real Visa sandbox authorization
curl -s -X POST localhost:3000/api/payments/authorize \
  -H 'content-type: application/json' -d '{"amountMinor":12000}' | jq

# is VIC wired up? names and booleans only, never values
curl -s localhost:3000/api/visa/health | jq

# the mandate — 503 vts-pending until Visa Token Service onboarding lands
curl -s -X POST localhost:3000/api/visa/mandate \
  -H 'content-type: application/json' -d '{"runId":"<from /api/checkout>"}' | jq

# the one worth showing a judge: we REFUSE to tell Visa a purchase happened
curl -s -X POST localhost:3000/api/visa/confirm \
  -H 'content-type: application/json' \
  -d '{"runId":"<runId>","lineId":"l1","instructionId":"x","transactionReferenceId":"y"}' | jq
# → 409 "That line was only ever simulated, so there is no transaction outcome
#        to report. We do not tell Visa a purchase was approved when it did not happen."
```

## Part 5. The two onboardings, if someone asks why the mandate is not live

VIC needs **two separate approvals**, not one:

- **VIC onboarding** gives the API key, shared secret and the MLE certificate. That is enough to *create* a mandate.
- **Visa Token Service** is a second product with its own approval, and it is what produces `VISA_ENROLLMENT_REFERENCE_ID` — the card token every instruction is written against.

Without VTS there is no token to mandate against, so `/api/visa/mandate` answers
`503 { stage: "vts-pending" }` and the checkout run completes exactly as it
otherwise would. The code path is built, tested and waiting on a credential.

> "The mandate layer is built — the token, the encryption and the payload are
> tested against Visa's own client. What we are waiting on is the second
> onboarding, Visa Token Service, which issues the card token an instruction is
> written against. Rather than fake an instruction id, we let the endpoint say
> so and the run carries on."

