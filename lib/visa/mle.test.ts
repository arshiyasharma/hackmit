import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeProtectedHeader } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { decryptPayload, encryptPayload, MleError, unescapePem } from "./mle";

/**
 * Message-level encryption, proved offline.
 *
 * VIC encrypts to a certificate Visa hands out and decrypts with the key from
 * our own CSR, so the test builds both halves itself: an RSA pair, and — when
 * openssl is on the machine — a genuine self-signed X.509 certificate, because
 * a certificate PEM is what the dashboard actually gives you and "it works
 * with a bare public key" is not the same claim.
 */

const KEY_ID = "vra-mle-key-1";

let publicKeyPem = "";
let privateKeyPem = "";
/** a genuine self-signed cert and ITS OWN key — kept apart from the pair above */
let certPem: string | null = null;
let certPrivateKeyPem = "";

beforeAll(() => {
  const pair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  publicKeyPem = pair.publicKey;
  privateKeyPem = pair.privateKey;

  // a real certificate, the way the dashboard hands one over
  const dir = mkdtempSync(join(tmpdir(), "mle-"));
  try {
    const keyPath = join(dir, "key.pem");
    const certPath = join(dir, "cert.pem");
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", keyPath, "-out", certPath, "-days", "1",
      "-subj", "/CN=test/UID=vra-mle-key-1",
    ], { stdio: "ignore" });
    certPem = execFileSync("cat", [certPath], { encoding: "utf8" });
    certPrivateKeyPem = execFileSync("cat", [keyPath], { encoding: "utf8" });
  } catch {
    // no openssl on this machine; the SPKI path still proves the JWE
    certPem = null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("unescapePem", () => {
  it("turns an env-file PEM back into real newlines", () => {
    const escaped = "-----BEGIN CERTIFICATE-----\\nAAAA\\n-----END CERTIFICATE-----";
    expect(unescapePem(escaped)).toBe(
      "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----"
    );
  });

  it("leaves a PEM that already has real newlines alone", () => {
    const real = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----";
    expect(unescapePem(real)).toBe(real);
  });
});

describe("encryptPayload", () => {
  it("returns one key, encData, holding a five-segment compact JWE", async () => {
    const encrypted = await encryptPayload({ a: 1 }, publicKeyPem, KEY_ID);
    expect(Object.keys(encrypted)).toEqual(["encData"]);
    expect(encrypted.encData.split(".")).toHaveLength(5);
  });

  it("uses RSA-OAEP-256 and A128GCM — not A256GCM, which fails opaquely at Visa", async () => {
    const { encData } = await encryptPayload({ a: 1 }, publicKeyPem, KEY_ID);
    const header = decodeProtectedHeader(encData);
    expect(header.alg).toBe("RSA-OAEP-256");
    expect(header.enc).toBe("A128GCM");
    expect(header.enc).not.toBe("A256GCM");
  });

  it("carries the key id, and an iat in MILLISECONDS the way Visa's client does", async () => {
    const before = Date.now();
    const { encData } = await encryptPayload({ a: 1 }, publicKeyPem, KEY_ID);
    const header = decodeProtectedHeader(encData) as { kid?: string; iat?: number };

    expect(header.kid).toBe(KEY_ID);
    expect(header.iat).toBeGreaterThanOrEqual(before);
    // seconds would be ~1.7e9; milliseconds are ~1.7e12
    expect(header.iat).toBeGreaterThan(1e12);
  });

  it("is non-deterministic — two encryptions of the same payload differ", async () => {
    const a = await encryptPayload({ a: 1 }, publicKeyPem, KEY_ID);
    const b = await encryptPayload({ a: 1 }, publicKeyPem, KEY_ID);
    expect(a.encData).not.toBe(b.encData);
  });

  it("accepts a PEM whose newlines are escaped, as an env var stores it", async () => {
    const escaped = publicKeyPem.trim().replace(/\n/g, "\\n");
    const encrypted = await encryptPayload({ a: 1 }, escaped, KEY_ID);
    expect(encrypted.encData.split(".")).toHaveLength(5);
  });

  it("names the variable when the certificate cannot be read", async () => {
    await expect(encryptPayload({ a: 1 }, "not a pem", KEY_ID)).rejects.toThrow(MleError);
    await expect(encryptPayload({ a: 1 }, "not a pem", KEY_ID)).rejects.toThrow(
      /VISA_MLE_SERVER_CERT/
    );
  });
});

describe("the round trip", () => {
  it("decrypts back to a deep-equal object", async () => {
    const payload = {
      clientReferenceId: "8f14e45f-ceea-467a-9575-1c1f9f7f9a11",
      mandates: [
        {
          mandateId: "b1",
          declineThreshold: { amount: "1250.00", currencyCode: "USD" },
          quantity: "3",
        },
      ],
      nested: { deeply: { ok: true, n: 42, list: [1, 2, 3] } },
    };

    const encrypted = await encryptPayload(payload, publicKeyPem, KEY_ID);
    const decrypted = await decryptPayload(encrypted, privateKeyPem, KEY_ID);
    expect(decrypted).toEqual(payload);
  });

  it("round-trips through a real X.509 certificate, which is what Visa hands over", async () => {
    if (!certPem) return; // openssl not available on this machine
    const encrypted = await encryptPayload({ hello: "visa" }, certPem, KEY_ID);
    const decrypted = await decryptPayload(encrypted, certPrivateKeyPem, KEY_ID);
    expect(decrypted).toEqual({ hello: "visa" });
  });

  it("accepts the response as a JSON string as well as an object", async () => {
    const encrypted = await encryptPayload({ a: 1 }, publicKeyPem, KEY_ID);
    expect(await decryptPayload(JSON.stringify(encrypted), privateKeyPem, KEY_ID)).toEqual({
      a: 1,
    });
  });
});

describe("decryptPayload refuses what it cannot handle", () => {
  it("throws a named error when there is no encData", async () => {
    await expect(decryptPayload({ notEncData: "x" }, privateKeyPem, KEY_ID)).rejects.toThrow(
      MleError
    );
    await expect(decryptPayload({}, privateKeyPem, KEY_ID)).rejects.toThrow(/encData/);
  });

  it("says which variable to check when the wrong key is used", async () => {
    const other = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const encrypted = await encryptPayload({ a: 1 }, publicKeyPem, KEY_ID);

    await expect(decryptPayload(encrypted, other.privateKey, KEY_ID)).rejects.toThrow(
      /VISA_KEY_ID|did not decrypt/
    );
  });

  it("names the variable when the private key cannot be read", async () => {
    const encrypted = await encryptPayload({ a: 1 }, publicKeyPem, KEY_ID);
    await expect(decryptPayload(encrypted, "not a pem", KEY_ID)).rejects.toThrow(
      /VISA_MLE_PRIVATE_KEY/
    );
  });
});
