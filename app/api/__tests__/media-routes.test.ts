import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const model = vi.hoisted(() => vi.fn());
const placeholder = vi.hoisted(() => vi.fn());
vi.mock("@google/genai", () => ({ GoogleGenAI: class { models = { generateContent: model }; } }));
vi.mock("@/lib/placeholder", () => ({ readCachedPng: vi.fn(), resolvePlaceholder: placeholder }));
import { POST as normalise } from "../normalise/route";
import { POST as fit } from "../fit/route";
import { POST as analyze } from "../analyze/route";
import { POST as draw } from "../placeholder/route";

const request = (payload: unknown) => new NextRequest("http://localhost/api/test", {
  method: "POST", body: JSON.stringify(payload), headers: { "content-type": "application/json" },
});

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("media request boundaries", () => {
  it.each([null, [], false, 42, "nope"])("normalise gracefully handles %j", async (body) => {
    const response = await normalise(request(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ category: "floor lamp", defaulted: true });
  });
  it.each([null, [], false, 42, "nope", { carton: [0.1, 200, 400] }, { carton: [1e300, 200, 400] }, { carton: [200, -1, 400] }, { carton: [200, 300, 400], profile: { doorW: 0 } }, { carton: [200, 300, 400], profile: { ceiling: "abc" } }])("fit rejects unusable dimensions %j", async (body) => {
    const response = await fit(request(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ fit: null, checked: false });
  });
  it("fit still handles valid numeric-string dimensions", async () => {
    const response = await fit(request({ carton: ["1200", "600", "400"] }));
    expect(await response.json()).toMatchObject({ checked: true, carton: [1200, 600, 400], fit: { verdict: "pass" } });
  });
  it.each([null, [], {}, { category: 12 }, { category: "x".repeat(121) }])("placeholder rejects malformed asks without starting generation: %j", async (body) => {
    const response = await draw(request(body));
    expect(response.status).toBe(400);
    expect(placeholder).not.toHaveBeenCalled();
  });
  it("placeholder reports generator/filesystem failure without throwing", async () => {
    placeholder.mockRejectedValueOnce(new Error("dummy generation failure"));
    const response = await draw(request({ category: "floor lamp" }));
    expect(response.status).toBe(502);
    expect(await response.json()).toHaveProperty("error");
  });
  it.each([null, { dataUrl: "data:image/png;garbage" }, { dataUrl: "data:image/svg+xml;base64,AAAA" }])("analyze returns neutral for invalid input without a model call: %j", async (body) => {
    vi.stubEnv("GEMINI_API_KEY", "dummy-key");
    const response = await analyze(request(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ source: "fallback", styleTags: [] });
    expect(model).not.toHaveBeenCalled();
  });
  it("analyze tries OpenAI when Gemini rejects instead of silently losing room context", async () => {
    vi.stubEnv("GEMINI_API_KEY", "dummy-key");
    vi.stubEnv("OPENAI_API_KEY", "dummy-key");
    model.mockRejectedValueOnce(new Error("403 invalid key"));
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({
      styleTags: ["wood", "classic"], palette: ["#111111", "#444444", "#777777", "#aaaaaa", "#eeeeee"], lighting: "warm", suggestions: ["a lamp"],
    }) } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await analyze(request({ dataUrl: "data:image/png;base64,AAAA" }));
    expect(await response.json()).toMatchObject({ source: "model", styleTags: ["wood", "classic"] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
