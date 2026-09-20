import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as checkout } from "@/app/api/checkout/route";
import { GET as readRun } from "@/app/api/checkout/[runId]/route";
import { GET as streamRun } from "@/app/api/checkout/[runId]/stream/route";
import { POST as credential } from "@/app/api/visa/credentials/route";
import { POST as confirm } from "@/app/api/visa/confirm/route";
import { POST as mandate } from "@/app/api/visa/mandate/route";
import { POST as enroll } from "@/app/api/visa/enroll/route";
import { POST as payment } from "@/app/api/payments/authorize/route";
import { createRun, findRunByBasketId, getRun, setInstructionId, setTransactionReference, updateLine } from "./runs";
import type { Basket } from "./types";

vi.mock("@/lib/checkout/agent", () => ({ runCheckout: vi.fn(async () => {}) }));

function basket(): Basket {
  return { basketId: crypto.randomUUID(), budgetMinor: 50000, lines: [{
    lineId: "line-1", placementId: "placement-1", listingId: "listing-1", retailer: "ikea",
    title: "Lamp", productUrl: "https://www.ikea.com/us/en/p/lamp/", imageUrl: "",
    priceMinor: 4200, currency: "USD", quantity: 1, dimensionsMm: null,
  }] };
}
function request(body: unknown, cookie = "", extra: Record<string, string> = {}) {
  return new Request("http://localhost/api/checkout", {
    method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...extra },
    body: JSON.stringify(body),
  }) as Parameters<typeof checkout>[0];
}
function context(runId: string) { return { params: Promise.resolve({ runId }) }; }
function owner() { return crypto.randomUUID(); }
afterEach(() => vi.useRealTimers());

describe("checkout adversarial inputs", () => {
  it.each([null, [], 1, "basket", true])("returns a 400 for non-object JSON: %j", async (body) => {
    for (const route of [checkout, credential, confirm, mandate, enroll, payment]) {
      expect((await route(request(body))).status).toBe(400);
    }
  });
  it.each([0, -1, 1.5, 100, Number.MAX_SAFE_INTEGER + 1])("rejects invalid quantity %s", async (quantity) => {
    const input = basket(); input.lines[0].quantity = quantity;
    expect((await checkout(request({ basket: input }))).status).toBe(400);
  });
  it.each(["https://ikea.com.evil.test/x", "https://amazon.com/x", "http://ikea.com/x", "https://user:pass@ikea.com/x", "https://ikea.com:3000/x", "http://127.0.0.1/x", "javascript:alert(1)"])("rejects unsafe/mismatched URL %s", async (productUrl) => {
    const input = basket(); input.lines[0].productUrl = productUrl;
    expect((await checkout(request({ basket: input }))).status).toBe(400);
  });
  it("rejects duplicates rather than leaving a second line pending forever", async () => {
    const input = basket(); input.lines.push({ ...input.lines[0] });
    expect((await checkout(request({ basket: input }))).status).toBe(400);
  });
  it("rejects unsafe money and excessive line counts", async () => {
    const input = basket(); input.lines[0].priceMinor = Number.MAX_SAFE_INTEGER + 1;
    expect((await checkout(request({ basket: input }))).status).toBe(400);
    input.lines[0].priceMinor = 4200; input.budgetMinor = -1;
    expect((await checkout(request({ basket: input }))).status).toBe(400);
    input.budgetMinor = 0; input.lines = Array.from({ length: 13 }, (_, i) => ({ ...input.lines[0], lineId: `l${i}`, placementId: `p${i}` }));
    expect((await checkout(request({ basket: input }))).status).toBe(400);
  });
  it("refuses cross-site writes before creating a run", async () => {
    expect((await checkout(request({ basket: basket() }, "", { origin: "https://attacker.test" }))).status).toBe(403);
  });
});

describe("checkout budget cap", () => {
  it.each([undefined, false, true])("blocks a basket one cent over budget even with acknowledgment %s", async (acknowledgedOverBudget) => {
    const input = basket();
    input.budgetMinor = 4199;
    const response = await checkout(request({ basket: input, acknowledgedOverBudget }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("$0.01 more");
    expect(findRunByBasketId(input.basketId)).toBeUndefined();
  });
  it.each([4200, 4201])("allows a basket at or below its %s-cent cap", async (budgetMinor) => {
    const input = basket();
    input.budgetMinor = budgetMinor;
    const response = await checkout(request({ basket: input }));
    expect(response.status).toBe(200);
    const { runId } = await response.json();
    expect(getRun(runId)?.basket.budgetMinor).toBe(budgetMinor);
  });
  it("counts quantities and all lines against the cap", async () => {
    const input = basket();
    input.budgetMinor = 12599;
    input.lines[0].quantity = 2;
    input.lines.push({ ...input.lines[0], lineId: "line-2", placementId: "placement-2", quantity: 1 });
    const response = await checkout(request({ basket: input, acknowledgedOverBudget: true }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("$126.00");
    expect(findRunByBasketId(input.basketId)).toBeUndefined();
  });
  it("treats zero as a cap rather than disabling budget enforcement", async () => {
    const input = basket();
    input.budgetMinor = 0;
    const response = await checkout(request({ basket: input, acknowledgedOverBudget: true }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("$0.00 you set");
    expect(findRunByBasketId(input.basketId)).toBeUndefined();
  });
  it.each([undefined, null, -1, 4200.5, "50000", 100_000_001])("rejects a missing or invalid cap %s before creating a run", async (budgetMinor) => {
    const input = { ...basket(), budgetMinor };
    const response = await checkout(request({ basket: input, acknowledgedOverBudget: true }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Set a valid budget");
    expect(findRunByBasketId(input.basketId)).toBeUndefined();
  });
});

describe("guest ownership and retry boundaries", () => {
  it("binds run polling to the initiating cookie and keeps ownership out of JSON", async () => {
    const response = await checkout(request({ basket: basket() }));
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("SameSite=Lax");
    const result = await response.json();
    const owned = await readRun(request({}, cookie.split(";")[0]), context(result.runId));
    expect(owned.status).toBe(200); expect(await owned.text()).not.toContain("ownerId");
    expect((await readRun(request({}), context(result.runId))).status).toBe(404);
    expect((await streamRun(request({}, `pixx_checkout=${owner()}`), context(result.runId))).status).toBe(404);
  });
  it("reuses the same session and basket on retry, rejects altered reuse", async () => {
    const input = basket(); const cookie = `pixx_checkout=${owner()}`;
    const first = await (await checkout(request({ basket: input }, cookie))).json();
    const second = await (await checkout(request({ basket: input }, cookie))).json();
    expect(second.runId).toBe(first.runId);
    input.lines[0].priceMinor += 1;
    expect((await checkout(request({ basket: input }, cookie))).status).toBe(409);
  });
  it("does not let someone else's basket ID create a mandate", async () => {
    const run = createRun(basket(), owner());
    expect((await mandate(request({ basketId: run.basket.basketId }, `pixx_checkout=${owner()}`))).status).toBe(404);
  });
  it("rejects an instruction not attached to this run and client-invented transaction references", async () => {
    const id = owner(); const run = createRun(basket(), id); const cookie = `pixx_checkout=${id}`;
    setInstructionId(run.runId, "our-instruction");
    const input = { runId: run.runId, lineId: "line-1", instructionId: "someone-else" };
    expect((await credential(request(input, cookie))).status).toBe(409);
    expect((await confirm(request(input, cookie))).status).toBe(409);
    const result = await confirm(request({ ...input, instructionId: "our-instruction", transactionReferenceId: "invented" }, cookie));
    expect(result.status).toBe(409); expect((await result.json()).stage).toBe("no-transaction");
  });
  it("closes a disconnected SSE reader and clears its timers", async () => {
    vi.useFakeTimers();
    const id = owner(); const run = createRun(basket(), id);
    const response = await streamRun(request({}, `pixx_checkout=${id}`), context(run.runId));
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"pending"');
    expect(vi.getTimerCount()).toBe(3);
    await reader.cancel(); expect(vi.getTimerCount()).toBe(0);
  });
  it("never reopens a settled line", () => {
    const run = createRun(basket());
    updateLine(run.runId, "line-1", { state: "failed", reason: "done" });
    updateLine(run.runId, "line-1", { state: "authorizing" });
    expect(getRun(run.runId)!.lines[0].status.state).toBe("failed");
  });
});

describe("upstream retry locking", () => {
  it("collapses concurrent operations and gives each caller an independently readable response", async () => {
    const { runOnce } = await import("./runs");
    const run = createRun(basket());
    const operation = vi.fn(async () => Response.json({ instructionId: "upstream-issued" }));
    const [first, second] = await Promise.all([runOnce(run, "mandate", operation), runOnce(run, "mandate", operation)]);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(await first.json()).toEqual(await second.json());
    await runOnce(run, "mandate", operation); expect(operation).toHaveBeenCalledTimes(1);
  });
});


describe("separate sandbox payment rails", () => {
  it("does not report an unrelated test-card authorization as a VIC purchase", async () => {
    const id = owner(); const run = createRun(basket(), id);
    setInstructionId(run.runId, "our-instruction");
    setTransactionReference(run.runId, "line-1", "vic-transaction");
    updateLine(run.runId, "line-1", { state: "placed", mode: "test", orderRef: "TEST-IKEA-1", payment: {
      provider: "acceptance", status: "AUTHORIZED", reconciliationId: "test-authorization",
      authorizedAmount: "42.00", approvalCode: "test", correlationId: "test",
      merchant: "shared-test", captured: false,
    } });
    const response = await confirm(request({ runId: run.runId, lineId: "line-1", instructionId: "our-instruction" }, `pixx_checkout=${id}`));
    expect(response.status).toBe(409);
    expect((await response.json()).stage).toBe("unlinked-authorization");
  });
});
