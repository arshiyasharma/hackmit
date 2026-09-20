import { createPublicKey, generateKeyPairSync, verify as cryptoVerify } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getAgentKeys, hasAgentKeys } from "./keys";
import { lookupKey, registeredKeyIds } from "./registry";
import {
  buildSignatureBase,
  SIGNATURE_LABEL,
  SIGNATURE_WINDOW_SECONDS,
  signRequest,
  signatureHeaders,
  toAuthorityAndPath,
} from "./sign";

const TARGET = "https://www.wayfair.com/furniture/pdp/lamp-123";

const ENV_KEYS = [
  "TAP_ED25519_PRIVATE_KEY",
  "TAP_ED25519_PUBLIC_KEY",
  "TAP_KEY_ID",
  "TAP_AGENT_ID",
] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

let publicKeyPem = "";

beforeAll(() => {
  const pair = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  publicKeyPem = pair.publicKey;

  // stored the way a .env file stores them: newlines escaped
  process.env.TAP_ED25519_PRIVATE_KEY = pair.privateKey.trim().replace(/\n/g, "\\n");
  process.env.TAP_ED25519_PUBLIC_KEY = pair.publicKey.trim().replace(/\n/g, "\\n");
  process.env.TAP_KEY_ID = "vra-key-test";
  process.env.TAP_AGENT_ID = "visa-room-agent";
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** Exactly what a merchant does: take the header apart and rebuild the base. */
function rebuildBase(signatureInput: string, targetUrl: string): string {
  const params = signatureInput.slice(`${SIGNATURE_LABEL}=`.length);
  const { authority, path } = toAuthorityAndPath(targetUrl);
  return buildSignatureBase(authority, path, params);
}

function rawSignature(signature: string): Buffer {
  const match = signature.match(/^sig1=:(.+):$/);
  if (!match) throw new Error(`unparseable Signature header: ${signature}`);
  return Buffer.from(match[1], "base64");
}

describe("getAgentKeys", () => {
  it("unescapes the PEM back into real newlines", () => {
    const keys = getAgentKeys();
    expect(keys.privateKeyPem).toContain("-----BEGIN PRIVATE KEY-----");
    expect(keys.privateKeyPem).toContain("\n");
    expect(keys.privateKeyPem).not.toContain("\\n");
    expect(keys.publicKeyPem.trim()).toBe(publicKeyPem.trim());
    expect(keys.keyId).toBe("vra-key-test");
  });

  it("throws naming TAP_ED25519_PRIVATE_KEY when it is unset — never a generated key", () => {
    const saved = process.env.TAP_ED25519_PRIVATE_KEY;
    delete process.env.TAP_ED25519_PRIVATE_KEY;
    try {
      expect(() => getAgentKeys()).toThrow(/TAP_ED25519_PRIVATE_KEY/);
      expect(() => getAgentKeys()).toThrow(/keys:tap/);
      expect(hasAgentKeys()).toBe(false);
    } finally {
      process.env.TAP_ED25519_PRIVATE_KEY = saved;
    }
  });

  it("throws naming whichever other variable is missing", () => {
    const saved = process.env.TAP_KEY_ID;
    delete process.env.TAP_KEY_ID;
    try {
      expect(() => getAgentKeys()).toThrow(/TAP_KEY_ID/);
    } finally {
      process.env.TAP_KEY_ID = saved;
    }
  });
});

describe("toAuthorityAndPath", () => {
  it("takes the host with no scheme and no trailing slash, and the pathname", () => {
    expect(toAuthorityAndPath(TARGET)).toEqual({
      authority: "www.wayfair.com",
      path: "/furniture/pdp/lamp-123",
    });
  });

  it("keeps a non-default port on the authority", () => {
    expect(toAuthorityAndPath("https://shop.example.com:8443/a/b").authority).toBe(
      "shop.example.com:8443"
    );
  });

  it("covers the pathname only — the query is deliberately outside the signature", () => {
    expect(toAuthorityAndPath("https://www.wayfair.com/p/lamp?sku=blue").path).toBe(
      "/p/lamp"
    );
  });
});

describe("signRequest", () => {
  it("produces the Signature-Input the prompt specifies", () => {
    const signed = signRequest(TARGET, "payment");
    expect(signed.signatureInput.startsWith('sig1=("@authority" "@path"); created=')).toBe(
      true
    );
    expect(signed.signatureInput).toContain('alg="ed25519"');
    expect(signed.signatureInput).toContain('tag="payment"');
    expect(signed.signatureInput).toContain('keyId="vra-key-test"');
    expect(signed.signature).toMatch(/^sig1=:[A-Za-z0-9+/]+=*:$/);
  });

  it("signs a base of exactly three lines, in order", () => {
    const signed = signRequest(TARGET, "browsing");
    const lines = signed.signatureBase.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('"@authority": www.wayfair.com');
    expect(lines[1]).toBe('"@path": /furniture/pdp/lamp-123');
    expect(lines[2].startsWith('"@signature-params": ("@authority" "@path");')).toBe(true);
  });

  it("puts a byte-identical params string in the base and in the header", () => {
    const signed = signRequest(TARGET, "payment");
    const fromHeader = signed.signatureInput.slice("sig1=".length);
    const fromBase = signed.signatureBase.split("\n")[2].slice('"@signature-params": '.length);
    expect(fromBase).toBe(fromHeader);
  });

  it("expires five minutes after it was created", () => {
    const signed = signRequest(TARGET, "payment");
    expect(signed.expiresAt - signed.createdAt).toBe(SIGNATURE_WINDOW_SECONDS);
    expect(signed.signatureInput).toContain(`created=${signed.createdAt}`);
    expect(signed.signatureInput).toContain(`expires=${signed.expiresAt}`);
  });

  it("uses a fresh nonce every time, so two signatures never match", () => {
    const a = signRequest(TARGET, "payment");
    const b = signRequest(TARGET, "payment");
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.signature).not.toBe(b.signature);
  });

  it("carries the tag it was given and nothing else", () => {
    expect(signRequest(TARGET, "browsing").signatureInput).toContain('tag="browsing"');
    expect(signRequest(TARGET, "browsing").signatureInput).not.toContain('tag="payment"');
  });

  it("hands back both headers ready to send", () => {
    const signed = signRequest(TARGET, "payment");
    expect(signatureHeaders(signed)).toEqual({
      "Signature-Input": signed.signatureInput,
      Signature: signed.signature,
    });
  });
});

describe("a merchant verifying what we signed", () => {
  it("rebuilds the base from Signature-Input alone and the signature checks out", () => {
    const signed = signRequest(TARGET, "payment");
    const rebuilt = rebuildBase(signed.signatureInput, TARGET);

    // the rebuild has to be byte-identical or the maths cannot work
    expect(rebuilt).toBe(signed.signatureBase);

    const ok = cryptoVerify(
      null,
      Buffer.from(rebuilt, "utf8"),
      createPublicKey(publicKeyPem),
      rawSignature(signed.signature)
    );
    expect(ok).toBe(true);
  });

  it("fails when one character of the authority is changed", () => {
    const signed = signRequest(TARGET, "payment");
    const tampered = signed.signatureBase.replace(
      '"@authority": www.wayfair.com',
      '"@authority": www.wayfair.con'
    );
    expect(tampered).not.toBe(signed.signatureBase);

    const ok = cryptoVerify(
      null,
      Buffer.from(tampered, "utf8"),
      createPublicKey(publicKeyPem),
      rawSignature(signed.signature)
    );
    expect(ok).toBe(false);
  });

  it("fails when the path is changed — it is bound to that exact page", () => {
    const signed = signRequest(TARGET, "payment");
    const tampered = signed.signatureBase.replace("lamp-123", "lamp-124");
    const ok = cryptoVerify(
      null,
      Buffer.from(tampered, "utf8"),
      createPublicKey(publicKeyPem),
      rawSignature(signed.signature)
    );
    expect(ok).toBe(false);
  });

  it("fails when the tag is changed from browsing to payment", () => {
    const signed = signRequest(TARGET, "browsing");
    const tampered = signed.signatureBase.replace('tag="browsing"', 'tag="payment"');
    const ok = cryptoVerify(
      null,
      Buffer.from(tampered, "utf8"),
      createPublicKey(publicKeyPem),
      rawSignature(signed.signature)
    );
    expect(ok).toBe(false);
  });

  it("fails against a different agent's public key", () => {
    const signed = signRequest(TARGET, "payment");
    const other = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const ok = cryptoVerify(
      null,
      Buffer.from(signed.signatureBase, "utf8"),
      createPublicKey(other.publicKey),
      rawSignature(signed.signature)
    );
    expect(ok).toBe(false);
  });
});

describe("the registry", () => {
  it("resolves the seeded keyId to an agent with a usable public key", () => {
    const ids = registeredKeyIds();
    expect(ids.length).toBeGreaterThan(0);
    const agent = lookupKey(ids[0]);
    expect(agent?.agentId).toBe("visa-room-agent");
    expect(agent?.publicKeyPem).toContain("-----BEGIN PUBLIC KEY-----");
    expect(agent?.publicKeyPem).not.toContain("\\n");
    expect(() => createPublicKey(agent!.publicKeyPem)).not.toThrow();
  });

  it("answers undefined for a key nobody registered", () => {
    expect(lookupKey("vra-key-nobody")).toBeUndefined();
  });

  it("holds no private keys", () => {
    for (const id of registeredKeyIds()) {
      expect(lookupKey(id)!.publicKeyPem).not.toContain("PRIVATE KEY");
    }
  });
});
