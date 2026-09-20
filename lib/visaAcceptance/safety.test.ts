import { afterEach, describe, expect, it, vi } from "vitest";
import { authorize, getCredentials } from "./payments";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function configured() {
  vi.stubEnv("VA_MERCHANT_ID", "test-merchant"); vi.stubEnv("VA_MERCHANT_KEY_ID", "test-key");
  vi.stubEnv("VA_MERCHANT_SECRET_KEY", Buffer.from("test-secret").toString("base64"));
}
describe("sandbox boundaries", () => {
  it.each(["api.visaacceptance.com", "https://api.cybersource.com", "evil.test", "apitest.visaacceptance.com:1234"])("rejects non-test environment %s", (host) => {
    configured(); vi.stubEnv("VA_RUN_ENVIRONMENT", host);
    expect(() => getCredentials()).toThrow("test sandbox");
  });
  it("validates internal authorization amounts as well as the public route", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(authorize({ amountMinor: Number.MAX_SAFE_INTEGER + 1, currency: "USD", clientReferenceCode: "test" })).rejects.toThrow("Invalid");
    await expect(authorize({ amountMinor: 100, currency: "EUR", clientReferenceCode: "test" })).rejects.toThrow("Invalid");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses a finite timeout, refuses redirects and never captures", async () => {
    configured(); vi.stubEnv("VA_RUN_ENVIRONMENT", "apitest.visaacceptance.com");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: "AUTHORIZED" }, { status: 201 }));
    vi.stubGlobal("fetch", fetcher);
    await authorize({ amountMinor: 100, currency: "USD", clientReferenceCode: "test" });
    const opts = fetcher.mock.calls[0][1] as unknown as RequestInit;
    expect(opts.redirect).toBe("error"); expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(opts.body as string).processingInformation.capture).toBe(false);
  });
});
