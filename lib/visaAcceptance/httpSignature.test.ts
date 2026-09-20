import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import {
  bodyDigest,
  buildSignatureString,
  httpDate,
  signRequest,
  type MerchantCredentials,
} from "./httpSignature";

/** Not the real shared sandbox values — a throwaway pair, valid base64. */
const CREDENTIALS: MerchantCredentials = {
  merchantId: "testmerchant",
  merchantKeyId: "00000000-0000-4000-8000-000000000001",
  merchantSecretKey: Buffer.from("a-32-byte-secret-for-the-tests!!").toString("base64"),
  host: "apitest.visaacceptance.com",
};

const DATE = "Sat, 19 Sep 2026 22:00:00 GMT";
const BODY = JSON.stringify({ orderInformation: { amountDetails: { totalAmount: "120.00" } } });

function parseSignatureHeader(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, key, value] of header.matchAll(/(\w+)="([^"]*)"/g)) out[key] = value;
  return out;
}

describe("bodyDigest", () => {
  it("is base64 of the SHA-256 of the body — a hash, not an HMAC", () => {
    expect(bodyDigest(BODY)).toBe(
      createHash("sha256").update(Buffer.from(BODY, "utf8")).digest("base64")
    );
  });

  it("an empty body still has a digest", () => {
    expect(bodyDigest("")).toBe(createHash("sha256").update(Buffer.alloc(0)).digest("base64"));
  });
});

describe("buildSignatureString", () => {
  it("is exactly the five lines, in order, with no trailing newline", () => {
    const { signatureString, headerList } = buildSignatureString({
      method: "post",
      resourcePath: "/pts/v2/payments",
      host: CREDENTIALS.host,
      date: DATE,
      merchantId: CREDENTIALS.merchantId,
      digest: "SHA-256=abc=",
    });

    expect(signatureString).toBe(
      "host: apitest.visaacceptance.com\n" +
        `date: ${DATE}\n` +
        "request-target: post /pts/v2/payments\n" +
        "digest: SHA-256=abc=\n" +
        "v-c-merchant-id: testmerchant"
    );
    expect(signatureString.endsWith("\n")).toBe(false);
    expect(headerList).toBe("host date request-target digest v-c-merchant-id");
  });

  it("spells request-target WITHOUT parentheses — this is the one that 401s", () => {
    const { signatureString, headerList } = buildSignatureString({
      method: "post",
      resourcePath: "/pts/v2/payments",
      host: CREDENTIALS.host,
      date: DATE,
      merchantId: CREDENTIALS.merchantId,
      digest: "SHA-256=abc=",
    });
    expect(signatureString).not.toContain("(request-target)");
    expect(headerList).not.toContain("(request-target)");
    expect(signatureString).toContain("\nrequest-target: post /pts/v2/payments\n");
  });

  it("lowercases the method in the request-target line", () => {
    expect(
      buildSignatureString({
        method: "POST",
        resourcePath: "/pts/v2/payments",
        host: CREDENTIALS.host,
        date: DATE,
        merchantId: CREDENTIALS.merchantId,
        digest: "SHA-256=abc=",
      }).signatureString
    ).toContain("request-target: post /pts/v2/payments");
  });

  it("omits digest for a method with no body, from both the string and the list", () => {
    const { signatureString, headerList } = buildSignatureString({
      method: "get",
      resourcePath: "/pts/v2/payments/123",
      host: CREDENTIALS.host,
      date: DATE,
      merchantId: CREDENTIALS.merchantId,
    });
    expect(signatureString).not.toContain("digest");
    expect(headerList).toBe("host date request-target v-c-merchant-id");
  });

  it("the header list names exactly the lines that were signed, in the same order", () => {
    const { signatureString, headerList } = buildSignatureString({
      method: "post",
      resourcePath: "/pts/v2/payments",
      host: CREDENTIALS.host,
      date: DATE,
      merchantId: CREDENTIALS.merchantId,
      digest: "SHA-256=abc=",
    });
    const signedNames = signatureString.split("\n").map((line) => line.split(":")[0]);
    expect(signedNames).toEqual(headerList.split(" "));
  });
});

describe("signRequest", () => {
  it("HMACs the signature string with the BASE64-DECODED secret", () => {
    const signed = signRequest({
      method: "POST",
      resourcePath: "/pts/v2/payments",
      body: BODY,
      credentials: CREDENTIALS,
      date: DATE,
    });

    const expected = createHmac("sha256", Buffer.from(CREDENTIALS.merchantSecretKey, "base64"))
      .update(Buffer.from(signed.signatureString, "utf8"))
      .digest("base64");

    expect(parseSignatureHeader(signed.headers.Signature).signature).toBe(expected);
  });

  it("is not the same as HMACing with the base64 TEXT of the secret", () => {
    const signed = signRequest({
      method: "POST",
      resourcePath: "/pts/v2/payments",
      body: BODY,
      credentials: CREDENTIALS,
      date: DATE,
    });
    const wrong = createHmac("sha256", CREDENTIALS.merchantSecretKey)
      .update(signed.signatureString, "utf8")
      .digest("base64");
    expect(parseSignatureHeader(signed.headers.Signature).signature).not.toBe(wrong);
  });

  it("builds the Signature header with all four parameters", () => {
    const parsed = parseSignatureHeader(
      signRequest({
        method: "POST",
        resourcePath: "/pts/v2/payments",
        body: BODY,
        credentials: CREDENTIALS,
        date: DATE,
      }).headers.Signature
    );

    expect(parsed.keyid).toBe(CREDENTIALS.merchantKeyId);
    expect(parsed.algorithm).toBe("HmacSHA256");
    expect(parsed.headers).toBe("host date request-target digest v-c-merchant-id");
    expect(parsed.signature).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("sends the same date it signed, and the digest of the body it signed", () => {
    const signed = signRequest({
      method: "POST",
      resourcePath: "/pts/v2/payments",
      body: BODY,
      credentials: CREDENTIALS,
      date: DATE,
    });

    expect(signed.headers.Date).toBe(DATE);
    expect(signed.signatureString).toContain(`date: ${DATE}`);
    expect(signed.headers.Digest).toBe(`SHA-256=${bodyDigest(BODY)}`);
    expect(signed.headers["v-c-merchant-id"]).toBe(CREDENTIALS.merchantId);
    expect(signed.headers.Host).toBe(CREDENTIALS.host);
    expect(signed.headers["Content-Type"]).toBe("application/json");
  });

  it("a GET carries no digest and no content type", () => {
    const signed = signRequest({
      method: "GET",
      resourcePath: "/pts/v2/payments/123",
      credentials: CREDENTIALS,
      date: DATE,
    });
    expect(signed.headers.Digest).toBeUndefined();
    expect(signed.headers["Content-Type"]).toBeUndefined();
    expect(signed.digest).toBeUndefined();
  });

  it("one changed byte of the body changes the digest, so the signature no longer covers it", () => {
    const honest = signRequest({
      method: "POST",
      resourcePath: "/pts/v2/payments",
      body: BODY,
      credentials: CREDENTIALS,
      date: DATE,
    });
    const tampered = signRequest({
      method: "POST",
      resourcePath: "/pts/v2/payments",
      body: BODY.replace("120.00", "120.01"),
      credentials: CREDENTIALS,
      date: DATE,
    });

    expect(tampered.headers.Digest).not.toBe(honest.headers.Digest);
    expect(tampered.headers.Signature).not.toBe(honest.headers.Signature);
  });

  it("every part of the signed string matters", () => {
    const base = {
      method: "POST",
      resourcePath: "/pts/v2/payments",
      body: BODY,
      credentials: CREDENTIALS,
      date: DATE,
    } as const;
    const signature = () => parseSignatureHeader(signRequest(base).headers.Signature).signature;

    const variants = [
      { ...base, resourcePath: "/pts/v2/payments/123" },
      { ...base, date: "Sat, 19 Sep 2026 22:00:01 GMT" },
      { ...base, credentials: { ...CREDENTIALS, host: "api.visaacceptance.com" } },
      { ...base, credentials: { ...CREDENTIALS, merchantId: "someoneelse" } },
    ];
    for (const variant of variants) {
      expect(parseSignatureHeader(signRequest(variant).headers.Signature).signature).not.toBe(
        signature()
      );
    }
  });
});

describe("httpDate", () => {
  it("is an RFC 7231 HTTP-date", () => {
    expect(httpDate(new Date(Date.UTC(2026, 8, 19, 22, 0, 0)))).toBe(
      "Sat, 19 Sep 2026 22:00:00 GMT"
    );
  });
});

describe("getCredentials — configuration, and what happens without it", () => {
  const NAMES = [
    "VA_MERCHANT_ID",
    "VA_MERCHANT_KEY_ID",
    "VA_MERCHANT_SECRET_KEY",
    "VA_RUN_ENVIRONMENT",
  ] as const;
  const saved = new Map(NAMES.map((name) => [name, process.env[name]]));

  function restore() {
    for (const name of NAMES) {
      const value = saved.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  function configure(overrides: Partial<Record<(typeof NAMES)[number], string>> = {}) {
    process.env.VA_MERCHANT_ID = "testmerchant";
    process.env.VA_MERCHANT_KEY_ID = "key-1";
    process.env.VA_MERCHANT_SECRET_KEY = "c2VjcmV0";
    delete process.env.VA_RUN_ENVIRONMENT;
    for (const [name, value] of Object.entries(overrides)) process.env[name] = value;
  }

  afterEach(restore);

  it("names every variable that is missing, and says where to get them", async () => {
    const { getCredentials, hasCredentials, MissingAcceptanceCredentialsError } = await import(
      "./payments"
    );
    for (const name of NAMES) delete process.env[name];

    expect(hasCredentials()).toBe(false);
    expect(() => getCredentials()).toThrow(MissingAcceptanceCredentialsError);
    try {
      getCredentials();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("VA_MERCHANT_ID");
      expect(message).toContain("VA_MERCHANT_SECRET_KEY");
      expect(message).toContain("cybersource-rest-samples-node");
    }
  });

  it("defaults to the sandbox host", async () => {
    const { getCredentials } = await import("./payments");
    configure();
    expect(getCredentials().host).toBe("apitest.visaacceptance.com");
  });

  it("reduces a pasted URL to a bare host — a scheme in there signs the wrong string", async () => {
    const { getCredentials } = await import("./payments");
    configure({ VA_RUN_ENVIRONMENT: "https://apitest.visaacceptance.com/" });
    expect(getCredentials().host).toBe("apitest.visaacceptance.com");
  });
});
