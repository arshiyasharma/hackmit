import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ options: vi.fn(), products: vi.fn() }));
vi.mock("@/lib/sourcing/adapter", () => ({ sourceOptions: mocks.options }));
vi.mock("@/lib/sourcing/sourceProducts", () => ({ sourceProductsForQuery: mocks.products }));
import { POST as search } from "@/app/api/search/route";
import { POST as source } from "@/app/api/source/route";

const request = (path: string, body: unknown) => new NextRequest(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.options.mockResolvedValue([]); mocks.products.mockResolvedValue([]); });

describe("aesthetic snapshots at search routes", () => {
  it("uses current context rather than stale client query text", async () => {
    const response = await search(request("/api/search", { request: "a lamp", query: "pink ornate lamp", roomContext: { palette: ["#2e7d32"], styleTags: ["minimalist"] }, budgetRemainingCents: 24000 }));
    expect((await response.json()).query).toBe("green minimalist lamp");
    expect(mocks.options).toHaveBeenCalledWith(expect.objectContaining({ query: "green minimalist lamp", request: "a lamp", budgetRemainingCents: 24000 }));
  });
  it("sends cleared aesthetics as a bare request", async () => {
    await search(request("/api/search", { request: "chair", query: "red ornate chair", roomContext: { palette: [], styleTags: [], searchTerms: ["red ornate chair"] } }));
    expect(mocks.options).toHaveBeenCalledWith(expect.objectContaining({ query: "chair" }));
  });
  it("fans out only bare model categories, styled with current edited context", async () => {
    await source(request("/api/source", { query: "a blue reading nook", roomContext: { palette: ["#b32324"], styleTags: ["minimalist"], searchTerms: ["pink ornate floor lamp", "red velvet chair"] } }));
    expect(mocks.products.mock.calls.map(([input]) => [input.shoppingQuery, input.designQuery])).toEqual([["minimalist blue floor lamp", "blue floor lamp"], ["minimalist blue chair", "blue chair"]]);
  });
  it("keeps an explicit product request separate from stale model suggestions", async () => {
    await source(request("/api/source", { query: "blue chair", roomContext: { palette: ["#b32324"], styleTags: ["rattan"], searchTerms: ["pink velvet chair"] } }));
    expect(mocks.products).toHaveBeenCalledTimes(1);
    expect(mocks.products).toHaveBeenCalledWith(expect.objectContaining({ shoppingQuery: "rattan blue chair", designQuery: "blue chair" }));
  });
});
