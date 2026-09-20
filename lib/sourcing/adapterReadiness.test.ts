import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ source: vi.fn() }));
vi.mock("@/lib/sourcing/sourceProducts", () => ({ sourceProductsForQuery: mocks.source }));
import { sourceOptions } from "./adapter";

const product = (price: number | null) => ({ id: "lamp", title: "Floor Lamp", product_url: "https://www.target.com/p/lamp/1", retailer: "target.com", image_url: "", currency: "USD", price_cents: price, in_stock: true, dimensions: { h_in: 60, w_in: 10, d_in: 10, estimated: false } });
beforeEach(() => { vi.stubEnv("SERPAPI_KEY", "test"); vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("options entering the room", () => {
  it("does not present a listing with an unknown price as free", async () => {
    mocks.source.mockResolvedValue([product(null)]);
    const options = await sourceOptions({ query: "unknown-price", request: "unknown-price" });
    expect(options).toEqual([]);
  });
  it("keeps a price of zero only when the provider actually quoted zero", async () => {
    mocks.source.mockResolvedValue([product(0)]);
    const options = await sourceOptions({ query: "zero-price", request: "zero-price" });
    expect(options?.[0].priceCents).toBe(0);
  });
  it("does not reuse a previous budget's search results", async () => {
    mocks.source.mockResolvedValue([product(5000)]);
    const input = { query: "budget-test", request: "budget-test" };
    await sourceOptions({ ...input, budgetRemainingCents: 50000 });
    await sourceOptions({ ...input, budgetRemainingCents: 2000 });
    expect(mocks.source).toHaveBeenCalledTimes(2);
    expect(mocks.source.mock.calls[0][0].maxPrice).toBe(500);
    expect(mocks.source.mock.calls[1][0].maxPrice).toBe(20);
  });
  it("strips a stated budget from retrieval and searches the user phrase alongside room style", async () => {
    mocks.source.mockResolvedValue([product(9900), { ...product(25000), id: "expensive" }]);
    const options = await sourceOptions({
      query: "white modern empty warm brass floor lamp under $150",
      request: "a warm brass floor lamp under $150",
      budgetRemainingCents: 50000,
    });
    expect(mocks.source.mock.calls.map(([input]) => input.shoppingQuery)).toEqual([
      "white modern empty warm brass floor lamp", "warm brass floor lamp",
    ]);
    expect(mocks.source.mock.calls.every(([input]) => input.designQuery === "warm brass floor lamp" && input.maxPrice === 150)).toBe(true);
    expect(options?.map((option) => option.priceCents)).toEqual([9900]);
  });
  it("uses the bare product response when room styling has no matches", async () => {
    mocks.source.mockImplementation(({ shoppingQuery }) => Promise.resolve(
      shoppingQuery === "warm brass floor lamp" ? [product(9900)] : []
    ));
    const options = await sourceOptions({ query: "white empty warm brass floor lamp under $151", request: "warm brass floor lamp under $151" });
    expect(options).toHaveLength(1);
  });
  it("waits for a healthy bare search that takes longer than the styling window", async () => {
    vi.useFakeTimers();
    mocks.source.mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve([product(9900)]), 13500);
    }));
    const job = sourceOptions({ query: "slow-bare", request: "slow-bare" });
    await vi.advanceTimersByTimeAsync(13500);
    expect(await job).toHaveLength(1);
  });
  it("gives the plain fallback time to answer after a slow styled query", async () => {
    vi.useFakeTimers();
    const started = Date.now();
    mocks.source.mockImplementation(({ shoppingQuery, deadline }) => new Promise((resolve) => {
      const delay = shoppingQuery === "patient brass lamp" ? 13500 : 8000;
      setTimeout(() => resolve(deadline >= started + delay && shoppingQuery === "patient brass lamp" ? [product(9900)] : []), delay);
    }));
    const job = sourceOptions({ query: "empty modern patient brass lamp", request: "patient brass lamp" });
    await vi.advanceTimersByTimeAsync(13500);
    expect(await job).toHaveLength(1);
  });
  it("shares identical in-flight searches and rebinds the room item", async () => {
    let resolve!: (value: ReturnType<typeof product>[]) => void;
    mocks.source.mockReturnValue(new Promise((done) => { resolve = done; }));
    const first = sourceOptions({ query: "shared-test", request: "shared-test", itemId: "first" });
    const second = sourceOptions({ query: "shared-test", request: "shared-test", itemId: "second" });
    resolve([product(5000)]);
    const [a, b] = await Promise.all([first, second]);
    expect(mocks.source).toHaveBeenCalledTimes(1);
    expect(a?.[0].itemId).toBe("first");
    expect(b?.[0].itemId).toBe("second");
  });
});
