import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildPreHashString, createXPayToken, resourcePathFor } from "./xpay";

const SECRET = "a-shared-secret-from-the-dashboard";
const URL_WITH_KEY =
  "https://sandbox.api.visa.com/vacp/v1/instructions?apikey=SOMEAPIKEY";

describe("resourcePathFor — the VIC gotcha", () => {
  it("drops the /vacp/ context prefix and the leading slash", () => {
    expect(resourcePathFor(URL_WITH_KEY)).toBe("v1/instructions");
  });

  it("does the same for /vdp/ and /vic/", () => {
    expect(resourcePathFor("https://sandbox.api.visa.com/vdp/helloworld")).toBe(
      "helloworld"
    );
    expect(resourcePathFor("https://sandbox.api.visa.com/vic/v1/cards")).toBe("v1/cards");
  });

  it("keeps the rest of a nested path", () => {
    expect(
      resourcePathFor(
        "https://sandbox.api.visa.com/vacp/v1/instructions/abc-123/credentials?apikey=X"
      )
    ).toBe("v1/instructions/abc-123/credentials");
  });

  it("leaves a path with no context prefix alone but for the leading slash", () => {
    expect(resourcePathFor("https://sandbox.api.visa.com/foo/bar")).toBe("foo/bar");
  });

  it("is NOT the full pathname — this is the line people 'fix' and then get 401s", () => {
    expect(resourcePathFor(URL_WITH_KEY)).not.toBe("/vacp/v1/instructions");
    expect(resourcePathFor(URL_WITH_KEY)).not.toBe("vacp/v1/instructions");
  });
});

describe("buildPreHashString", () => {
  it("is the four parts concatenated, no separator, no newline", () => {
    expect(buildPreHashString(1758330000, "v1/instructions", "apikey=X", '{"a":1}')).toBe(
      '1758330000v1/instructionsapikey=X{"a":1}'
    );
  });

  it("an empty body contributes nothing", () => {
    expect(buildPreHashString(1758330000, "v1/instructions", "apikey=X", "")).toBe(
      "1758330000v1/instructionsapikey=X"
    );
  });
});

describe("createXPayToken", () => {
  it("is xv2, the timestamp, and a 64-character hex hash", () => {
    expect(createXPayToken({ sharedSecret: SECRET, requestUrl: URL_WITH_KEY })).toMatch(
      /^xv2:\d{10}:[0-9a-f]{64}$/
    );
  });

  it("hashes exactly the four concatenated parts, keeping apikey in the query", () => {
    const timestamp = 1758330000;
    const body = JSON.stringify({ encData: "eyJhbGciOiJSU0EtT0FFUC0yNTYifQ..xyz" });

    const token = createXPayToken({
      sharedSecret: SECRET,
      requestUrl: URL_WITH_KEY,
      body,
      timestamp,
    });

    const expected = createHmac("sha256", Buffer.from(SECRET, "utf8"))
      .update(`${timestamp}v1/instructionsapikey=SOMEAPIKEY${body}`)
      .digest("hex");

    expect(token).toBe(`xv2:${timestamp}:${expected}`);
  });

  it("uses the shared secret as UTF-8 bytes, not base64-decoded", () => {
    // base64-decoding is right for Visa Acceptance, a different company, and
    // produces a token sandbox.api.visa.com will never reproduce
    const secret = "eUJKeHk2TGpNMlRtY1BHdQ==";
    const timestamp = 1758330000;
    const token = createXPayToken({
      sharedSecret: secret,
      requestUrl: URL_WITH_KEY,
      timestamp,
    });
    const asUtf8 = createHmac("sha256", Buffer.from(secret, "utf8"))
      .update(`${timestamp}v1/instructionsapikey=SOMEAPIKEY`)
      .digest("hex");
    const asBase64 = createHmac("sha256", Buffer.from(secret, "base64"))
      .update(`${timestamp}v1/instructionsapikey=SOMEAPIKEY`)
      .digest("hex");

    expect(token).toBe(`xv2:${timestamp}:${asUtf8}`);
    expect(token).not.toBe(`xv2:${timestamp}:${asBase64}`);
  });

  it("signs the ENCRYPTED body — a different body is a different token", () => {
    const timestamp = 1758330000;
    const plaintext = JSON.stringify({ clientReferenceId: "abc" });
    const encrypted = JSON.stringify({ encData: "eyJ...jwe" });

    const signedPlain = createXPayToken({
      sharedSecret: SECRET,
      requestUrl: URL_WITH_KEY,
      body: plaintext,
      timestamp,
    });
    const signedEncrypted = createXPayToken({
      sharedSecret: SECRET,
      requestUrl: URL_WITH_KEY,
      body: encrypted,
      timestamp,
    });

    expect(signedPlain).not.toBe(signedEncrypted);
  });

  it("every part of the request changes the token", () => {
    const base = { sharedSecret: SECRET, requestUrl: URL_WITH_KEY, timestamp: 1758330000 };
    const token = createXPayToken(base);

    expect(
      createXPayToken({ ...base, requestUrl: URL_WITH_KEY.replace("instructions", "cards") })
    ).not.toBe(token);
    expect(
      createXPayToken({ ...base, requestUrl: URL_WITH_KEY.replace("SOMEAPIKEY", "OTHER") })
    ).not.toBe(token);
    expect(createXPayToken({ ...base, timestamp: 1758330001 })).not.toBe(token);
    expect(createXPayToken({ ...base, sharedSecret: "other" })).not.toBe(token);
    expect(createXPayToken({ ...base, body: "{}" })).not.toBe(token);
  });

  it("uses now when no timestamp is given", () => {
    const before = Math.floor(Date.now() / 1000);
    const seconds = Number(
      createXPayToken({ sharedSecret: SECRET, requestUrl: URL_WITH_KEY }).split(":")[1]
    );
    expect(seconds).toBeGreaterThanOrEqual(before);
    expect(seconds).toBeLessThanOrEqual(before + 2);
  });
});
