import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  acceptsTag,
  failureSentence,
  parseSignature,
  parseSignatureInput,
  verifyRequest,
  type TapFailure,
} from "./verify";
import { merchantIdentity, verifyAsMerchant } from "./merchant";
import { signRequest, SIGNATURE_LABEL, toAuthorityAndPath } from "./sign";

const TARGET = "https://www.wayfair.com/furniture/pdp/lamp-123";
const KEY_ID = "vra-key-verify-test";

/**
 * The registry is a committed JSON file read at module load, so the test
 * agent is mocked in rather than written to disk. `lookupKey` is the only
 * thing verify.ts asks it for.
 */
const registered = new Map<string, { agentId: string; agentName: string; publicKeyPem: string; registeredAt: string }>();

vi.mock("./registry", () => ({
  lookupKey: (keyId: string) => registered.get(keyId),
  registeredKeyIds: () => [...registered.keys()],
}));

const ENV_KEYS = [
  "TAP_ED25519_PRIVATE_KEY",
  "TAP_ED25519_PUBLIC_KEY",
  "TAP_KEY_ID",
  "TAP_AGENT_ID",
  "TAP_VERIFY_BASE_URL",
] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeAll(() => {
  const pair = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  process.env.TAP_ED25519_PRIVATE_KEY = pair.privateKey.trim().replace(/\n/g, "\\n");
  process.env.TAP_ED25519_PUBLIC_KEY = pair.publicKey.trim().replace(/\n/g, "\\n");
  process.env.TAP_KEY_ID = KEY_ID;
  process.env.TAP_AGENT_ID = "visa-room-agent";
  delete process.env.TAP_VERIFY_BASE_URL;

  registered.set(KEY_ID, {
    agentId: "visa-room-agent",
    agentName: "VISA Room Agent",
    publicKeyPem: pair.publicKey,
    registeredAt: new Date().toISOString(),
  });
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** Present a signature to the shop it was actually made for. */
function presentHonestly(signed: ReturnType<typeof signRequest>, url = TARGET) {
  const { authority, path } = toAuthorityAndPath(url);
  return verifyRequest({
    signatureInput: signed.signatureInput,
    signature: signed.signature,
    authority,
    path,
    declaredUrl: url,
  });
}

describe("parseSignatureInput", () => {
  it("reads every parameter back off the header", () => {
    const signed = signRequest(TARGET, "payment");
    const parsed = parseSignatureInput(signed.signatureInput);

    expect(parsed).not.toBeNull();
    expect(parsed!.keyId).toBe(KEY_ID);
    expect(parsed!.alg).toBe("ed25519");
    expect(parsed!.tag).toBe("payment");
    expect(parsed!.nonce).toBe(signed.nonce);
    expect(parsed!.created).toBe(signed.createdAt);
    expect(parsed!.expires).toBe(signed.expiresAt);
  });

  it("hands back the params substring byte-for-byte, never reformatted", () => {
    const signed = signRequest(TARGET, "payment");
    const parsed = parseSignatureInput(signed.signatureInput)!;
    expect(parsed.params).toBe(signed.signatureInput.slice(`${SIGNATURE_LABEL}=`.length));
    expect(signed.signatureBase.endsWith(parsed.params)).toBe(true);
  });

  it("refuses a label it does not use", () => {
    const signed = signRequest(TARGET, "payment");
    expect(parseSignatureInput(signed.signatureInput.replace("sig1=", "sig2="))).toBeNull();
  });

  it("refuses a different set of covered components", () => {
    const signed = signRequest(TARGET, "payment");
    expect(
      parseSignatureInput(
        signed.signatureInput.replace('("@authority" "@path")', '("@authority")')
      )
    ).toBeNull();
  });

  it("refuses an algorithm it cannot check, rather than accepting it unverified", () => {
    const signed = signRequest(TARGET, "payment");
    expect(
      parseSignatureInput(signed.signatureInput.replace('alg="ed25519"', 'alg="rsa-pss-sha256"'))
    ).toBeNull();
  });
});

describe("parseSignature", () => {
  it("takes the 64 raw bytes out of sig1=:...:", () => {
    const signed = signRequest(TARGET, "payment");
    expect(parseSignature(signed.signature)?.length).toBe(64);
  });

  it("refuses anything that is not that shape", () => {
    expect(parseSignature("")).toBeNull();
    expect(parseSignature("sig1=abc")).toBeNull();
    expect(parseSignature("sig1=:not base64!:")).toBeNull();
    expect(parseSignature("sig1=:QUJD:")).toBeNull(); // parses, wrong length
  });
});

describe("verifyRequest — the happy path", () => {
  it("serves an agent it knows, for the page the signature was made for", () => {
    const verdict = presentHonestly(signRequest(TARGET, "payment"));
    expect(verdict).toEqual({
      ok: true,
      agentId: "visa-room-agent",
      agentName: "VISA Room Agent",
      tag: "payment",
      expiresAt: expect.any(Number),
    });
  });

  it("verifies with no declaredUrl at all — authority and path from the request", () => {
    const signed = signRequest(TARGET, "browsing");
    const { authority, path } = toAuthorityAndPath(TARGET);
    const verdict = verifyRequest({
      signatureInput: signed.signatureInput,
      signature: signed.signature,
      authority,
      path,
    });
    expect(verdict.ok).toBe(true);
  });
});

describe("verifyRequest — every way it refuses", () => {
  function reasonFor(input: Parameters<typeof verifyRequest>[0]): TapFailure {
    const verdict = verifyRequest(input);
    if (verdict.ok) throw new Error("expected a refusal");
    return verdict.reason;
  }

  const { authority, path } = toAuthorityAndPath(TARGET);

  it("malformed: the header cannot be read", () => {
    const signed = signRequest(TARGET, "payment");
    expect(
      reasonFor({ signatureInput: "nonsense", signature: signed.signature, authority, path })
    ).toBe("malformed");
    expect(
      reasonFor({ signatureInput: signed.signatureInput, signature: "nonsense", authority, path })
    ).toBe("malformed");
  });

  it("unknown-key: nobody registered this agent", () => {
    const signed = signRequest(TARGET, "payment");
    const stranger = signed.signatureInput.replace(`keyId="${KEY_ID}"`, 'keyId="vra-key-nobody"');
    expect(reasonFor({ signatureInput: stranger, signature: signed.signature, authority, path })).toBe(
      "unknown-key"
    );
  });

  it("expired: the five-minute window has closed", () => {
    const hourAgo = Math.floor(Date.now() / 1000) - 3600;
    const signed = signRequest(TARGET, "payment", { created: hourAgo });
    expect(
      reasonFor({
        signatureInput: signed.signatureInput,
        signature: signed.signature,
        authority,
        path,
        declaredUrl: TARGET,
      })
    ).toBe("expired");
  });

  it("expired: a signature still inside its window is not", () => {
    const signed = signRequest(TARGET, "payment", { created: Math.floor(Date.now() / 1000) - 60 });
    expect(presentHonestly(signed).ok).toBe(true);
  });

  it("authority-mismatch: the same signature replayed at another shop", () => {
    const signed = signRequest(TARGET, "payment");
    expect(
      reasonFor({
        signatureInput: signed.signatureInput,
        signature: signed.signature,
        // IKEA's verifier, holding Wayfair's signature
        authority: "www.ikea.com",
        path,
        declaredUrl: TARGET,
      })
    ).toBe("authority-mismatch");
  });

  it("path-mismatch: made for a different page at the same shop", () => {
    const signed = signRequest(TARGET, "payment");
    expect(
      reasonFor({
        signatureInput: signed.signatureInput,
        signature: signed.signature,
        authority,
        path: "/furniture/pdp/sofa-999",
        declaredUrl: TARGET,
      })
    ).toBe("path-mismatch");
  });

  it("bad-signature: one character changed inside the signature", () => {
    const signed = signRequest(TARGET, "payment");
    const body = signed.signature.slice("sig1=:".length, -1);
    const flipped = `sig1=:${(body[0] === "A" ? "B" : "A") + body.slice(1)}:`;
    expect(
      reasonFor({ signatureInput: signed.signatureInput, signature: flipped, authority, path })
    ).toBe("bad-signature");
  });

  it("bad-signature: a relay caught even when it hides the declared URL", () => {
    const signed = signRequest(TARGET, "payment");
    expect(
      reasonFor({
        signatureInput: signed.signatureInput,
        signature: signed.signature,
        authority: "www.ikea.com",
        path,
      })
    ).toBe("bad-signature");
  });

  it("bad-signature: the nonce cannot be swapped for another", () => {
    const signed = signRequest(TARGET, "payment");
    const swapped = signed.signatureInput.replace(signed.nonce, crypto.randomUUID());
    expect(
      reasonFor({ signatureInput: swapped, signature: signed.signature, authority, path })
    ).toBe("bad-signature");
  });

  it("reports the FIRST failure: an expired signature from an unknown key is unknown-key", () => {
    const hourAgo = Math.floor(Date.now() / 1000) - 3600;
    const signed = signRequest(TARGET, "payment", { created: hourAgo });
    const stranger = signed.signatureInput.replace(`keyId="${KEY_ID}"`, 'keyId="vra-key-nobody"');
    expect(reasonFor({ signatureInput: stranger, signature: signed.signature, authority, path })).toBe(
      "unknown-key"
    );
  });
});

describe("taking our agent out of the registry", () => {
  it("makes every signature fail as unknown-key rather than silently passing", () => {
    const signed = signRequest(TARGET, "payment");
    expect(presentHonestly(signed).ok).toBe(true);

    const saved = registered.get(KEY_ID)!;
    registered.delete(KEY_ID);
    try {
      const verdict = presentHonestly(signRequest(TARGET, "payment"));
      expect(verdict).toEqual({ ok: false, reason: "unknown-key" });
    } finally {
      registered.set(KEY_ID, saved);
    }
  });
});

describe("acceptsTag — policy, not cryptography", () => {
  it("a browsing signature is valid and is still not permission to pay", () => {
    const verdict = presentHonestly(signRequest(TARGET, "browsing"));
    expect(verdict.ok).toBe(true);
    expect(acceptsTag(verdict, "payment")).toBe(false);
    expect(acceptsTag(verdict, "browsing")).toBe(true);
  });

  it("a refusal is never accepted for anything", () => {
    expect(acceptsTag({ ok: false, reason: "expired" }, "payment")).toBe(false);
  });
});

describe("failureSentence", () => {
  it("gives every reason a sentence a person could read aloud", () => {
    const reasons: TapFailure[] = [
      "unknown-key",
      "malformed",
      "expired",
      "bad-signature",
      "authority-mismatch",
      "path-mismatch",
    ];
    for (const reason of reasons) {
      expect(failureSentence(reason).length).toBeGreaterThan(10);
      expect(failureSentence(reason)).not.toContain("-");
    }
  });
});

describe("merchantIdentity", () => {
  it("a shop's own subdomain is still that shop", () => {
    expect(merchantIdentity("ikea", "https://www.ikea.com/us/en/p/lamp-123/")).toEqual({
      retailer: "ikea",
      authority: "www.ikea.com",
      path: "/us/en/p/lamp-123/",
      displayName: "IKEA",
    });
  });

  it("somebody else's domain leaves the shop as itself, so the check can fail", () => {
    expect(merchantIdentity("ikea", TARGET)?.authority).toBe("www.ikea.com");
  });

  it("is null for something that is not a web address", () => {
    expect(merchantIdentity("ikea", "not a url")).toBeNull();
    expect(merchantIdentity("ikea", "file:///etc/passwd")).toBeNull();
  });
});

describe("verifyAsMerchant — the shop, end to end", () => {
  it("accepts a payment signature made for one of its own pages", () => {
    const signed = signRequest(TARGET, "payment");
    const check = verifyAsMerchant({
      retailer: "wayfair",
      declaredUrl: TARGET,
      signatureInput: signed.signatureInput,
      signature: signed.signature,
      requiredTag: "payment",
    })!;

    expect(check.verdict.ok).toBe(true);
    expect(check.accepted).toBe(true);
    expect(check.merchant.authority).toBe("www.wayfair.com");
    expect(check.merchant.displayName).toBe("Wayfair");
  });

  it("refuses a Wayfair signature presented to IKEA", () => {
    const signed = signRequest(TARGET, "payment");
    const check = verifyAsMerchant({
      retailer: "ikea",
      declaredUrl: TARGET,
      signatureInput: signed.signatureInput,
      signature: signed.signature,
      requiredTag: "payment",
    })!;

    expect(check.verdict).toEqual({ ok: false, reason: "authority-mismatch" });
    expect(check.accepted).toBe(false);
  });

  it("verifies a browsing signature and still does not accept it for payment", () => {
    const signed = signRequest(TARGET, "browsing");
    const check = verifyAsMerchant({
      retailer: "wayfair",
      declaredUrl: TARGET,
      signatureInput: signed.signatureInput,
      signature: signed.signature,
      requiredTag: "payment",
    })!;

    expect(check.verdict.ok).toBe(true);
    expect(check.accepted).toBe(false);
  });

  it("is null when the declared URL is not a URL", () => {
    const signed = signRequest(TARGET, "payment");
    expect(
      verifyAsMerchant({
        retailer: "wayfair",
        declaredUrl: "nope",
        signatureInput: signed.signatureInput,
        signature: signed.signature,
        requiredTag: "payment",
      })
    ).toBeNull();
  });
});
