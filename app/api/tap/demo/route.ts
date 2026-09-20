import type { NextRequest } from "next/server";

import { verifyAsMerchant } from "@/lib/tap/merchant";
import { hasAgentKeys } from "@/lib/tap/keys";
import { signRequest, SIGNATURE_LABEL, type TapSignature } from "@/lib/tap/sign";

/**
 * POST /api/tap/demo — the four-second moment.
 *
 * "Here is the agent's signature. Here is the shop verifying it. Here is what
 * happens when I change one character of the domain." Nobody else at the table
 * will have this, and it is the difference between claiming the agent proves
 * its identity and showing it.
 *
 * In:  { tamper?: "authority" | "expiry" | "signature" | "tag" }  (body optional)
 * Out: { ok, tamper, reason, story, signatureBase, headers, merchant, verdict }
 *
 * The signature base comes back either way, always, because the three lines
 * being signed are the thing to put on screen. There is nothing secret in
 * them — a host, a path, and the parameters that bound them together.
 *
 * GET does the untampered run, so a person with curl at the booth needs no
 * body. `?tamper=authority` works there too.
 */

export const runtime = "nodejs";
export const maxDuration = 10;

/** A plausible page at a real shop. Nothing is fetched from it, ever. */
const SAMPLE_URL = "https://www.wayfair.com/furniture/pdp/arc-floor-lamp-123";
const SAMPLE_RETAILER = "wayfair" as const;
/** Where a replayed signature gets presented. Any other shop would do. */
const RELAY_RETAILER = "ikea" as const;

export type Tamper = "authority" | "expiry" | "signature" | "tag";

const TAMPERS: ReadonlySet<string> = new Set<Tamper>([
  "authority",
  "expiry",
  "signature",
  "tag",
]);

/**
 * Change one character of the base64 signature, keeping it well-formed.
 *
 * The point is a signature that PARSES and does not VERIFY. Corrupting the
 * header's shape would come back `malformed`, which is a different and much
 * less interesting failure.
 */
function flipOneCharacter(signature: string): string {
  const prefix = `${SIGNATURE_LABEL}=:`;
  const body = signature.slice(prefix.length, -1);
  const first = body[0];
  const swapped = (first === "A" ? "B" : "A") + body.slice(1);
  return `${prefix}${swapped}:`;
}

interface Scenario {
  signed: TapSignature;
  /** the shop the request is presented to */
  retailer: typeof SAMPLE_RETAILER | typeof RELAY_RETAILER;
  signature: string;
  story: string;
}

function scenario(tamper: Tamper | null): Scenario {
  const now = Math.floor(Date.now() / 1000);

  switch (tamper) {
    case "authority": {
      // the honest signature, captured and replayed at a different shop. It is
      // bound to wayfair.com and IKEA can see that it is not for them.
      const signed = signRequest(SAMPLE_URL, "payment");
      return {
        signed,
        retailer: RELAY_RETAILER,
        signature: signed.signature,
        story:
          "The same signature, replayed at a different shop. It is bound to " +
          "www.wayfair.com, so IKEA refuses it. One character of the domain is " +
          "all it takes.",
      };
    }
    case "expiry": {
      // signed an hour ago, five-minute window, long gone
      const signed = signRequest(SAMPLE_URL, "payment", { created: now - 3600 });
      return {
        signed,
        retailer: SAMPLE_RETAILER,
        signature: signed.signature,
        story:
          "A signature from an hour ago. The window is five minutes, so a " +
          "recording of this morning's checkout buys nobody anything.",
      };
    }
    case "signature": {
      const signed = signRequest(SAMPLE_URL, "payment");
      return {
        signed,
        retailer: SAMPLE_RETAILER,
        signature: flipOneCharacter(signed.signature),
        story:
          "One character changed inside the signature itself. It still parses. " +
          "It does not verify.",
      };
    }
    case "tag": {
      // cryptographically perfect, and only authorised to look at the page
      const signed = signRequest(SAMPLE_URL, "browsing");
      return {
        signed,
        retailer: SAMPLE_RETAILER,
        signature: signed.signature,
        story:
          "A real, valid signature — for browsing. The shop can see the agent " +
          "is who it says it is and that it was never cleared to spend money.",
      };
    }
    default: {
      const signed = signRequest(SAMPLE_URL, "payment");
      return {
        signed,
        retailer: SAMPLE_RETAILER,
        signature: signed.signature,
        story:
          "The agent proves who it is and that it may pay, on this page, at " +
          "this shop, for the next five minutes. The shop checks it and serves it.",
      };
    }
  }
}

function run(tamper: Tamper | null): Response {
  if (!hasAgentKeys()) {
    return Response.json(
      {
        error:
          "This agent has no signing keys yet. Run `npm run keys:tap`, paste the " +
          "four lines into .env.local and the JSON entry into data/tap-registry.json.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  const { signed, retailer, signature, story } = scenario(tamper);

  const check = verifyAsMerchant({
    retailer,
    declaredUrl: SAMPLE_URL,
    signatureInput: signed.signatureInput,
    signature,
    requiredTag: "payment",
  });

  if (!check) {
    return Response.json(
      { error: "The demo target URL could not be parsed." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  const reason = check.verdict.ok
    ? check.accepted
      ? null
      : "wrong-operation"
    : check.verdict.reason;

  return Response.json(
    {
      // `ok` is the shop's whole answer: verified AND cleared for this
      // operation. A browsing signature is genuine and still not a yes.
      ok: check.accepted,
      tamper,
      reason,
      // hoisted out of the verdict so the booth overlay has one field to read
      agentId: check.verdict.ok ? check.verdict.agentId : null,
      agentName: check.verdict.ok ? check.verdict.agentName : null,
      story,
      requiredTag: check.requiredTag,
      // the three lines that were signed, for the screen
      signatureBase: signed.signatureBase,
      headers: {
        "Signature-Input": signed.signatureInput,
        Signature: signature,
      },
      merchant: {
        retailer: check.merchant.retailer,
        name: check.merchant.displayName,
        authority: check.merchant.authority,
        path: check.merchant.path,
      },
      signedFor: SAMPLE_URL,
      verdict: check.verdict,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

function toTamper(value: unknown): Tamper | null {
  return typeof value === "string" && TAMPERS.has(value) ? (value as Tamper) : null;
}

export async function POST(request: NextRequest) {
  // an empty body is the happy path — "no body returns ok: true"
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return run(toTamper(body.tamper));
}

export async function GET(request: NextRequest) {
  return run(toTamper(request.nextUrl.searchParams.get("tamper")));
}
