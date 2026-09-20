import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/visa/health/route";
import { REQUIRED_VARS } from "./config";
import { VicApiError, vicRequest } from "./vicClient";
vi.mock("./vicClient", async () => {
  const actual = await vi.importActual<typeof import("./vicClient")>("./vicClient");
  return { ...actual, vicRequest: vi.fn() };
});
afterEach(() => { vi.unstubAllEnvs(); vi.mocked(vicRequest).mockReset(); });
describe("Visa health is evidence based", () => {
  it.each([400, 401, 403, 404, 429, 500, 503])("never treats HTTP %s as authenticated", async (status) => {
    for (const key of REQUIRED_VARS) vi.stubEnv(key, "test-configured");
    vi.mocked(vicRequest).mockRejectedValue(new VicApiError("untrusted upstream body", status, "test-correlation", null));
    const response = await GET(); const body = await response.json();
    expect(response.status).toBe(502); expect(body.ok).toBe(false);
    expect(body.stage).not.toBe("authenticated");
    expect(JSON.stringify(body)).not.toContain("untrusted upstream body");
  });
});
