import { randomUUID } from "node:crypto";

import { RETAILER_NAMES } from "@/lib/checkout/retailers";
import type { Basket, BasketLine, Retailer } from "@/lib/checkout/types";
import { minorToDecimalString } from "@/lib/money";

/**
 * The VIC payload builders.
 *
 * MATCHED AGAINST VISA'S OWN, field for field: `apps/shared-utils/constants.ts`
 * and `apps/shared-utils/payload-builders/*` in `github.com/visa/ai`. Where a
 * value is Visa's sample data it is kept; where it is OUR data — the mandate —
 * it is built from the basket, because that is the entire point.
 *
 * ── THE MANDATE IS THE PITCH ──────────────────────────────────────────────
 *
 * A mandate is a standing, cardholder-authorised instruction: this agent may
 * spend up to this much, at this kind of merchant, until this time. Its
 * `declineThreshold.amount` IS THE BUDGET HUD'S CAP. The number ticking in the
 * corner of the room view is not a UI affordance we invented — it is the spend
 * cap on a Visa payment mandate, and when the user relinks a lamp and the
 * delta fires, they are watching their remaining mandate headroom.
 *
 * Say exactly that to the Visa rep. It is the difference between "nice app"
 * and "you understood the product".
 *
 * ── TIMESTAMPS ────────────────────────────────────────────────────────────
 *
 * UNIX SECONDS, AS STRINGS, at most 12 characters. Not ISO 8601, not
 * milliseconds. `generateTimestamp` is the only place that formats one.
 */

/** Visa's sample shape, with our application name. */
export const APP_INSTANCE_BASE = {
  userAgent: "Mozilla",
  applicationName: "VISA Room Agent",
  countryCode: "US",
  ipAddress: "128.88.99.100",
  deviceData: {
    type: "Mobile",
    manufacturer: "Google",
    brand: "Google",
    model: "Pixel 9 Pro",
  },
} as const;

/** Device verification, straight from Visa's constants. */
export const ASSURANCE_DATA_BASE = {
  verificationType: "DEVICE",
  verificationEntity: "10",
  verificationEvents: ["01", "02"],
  verificationMethod: "02",
  verificationResults: "01",
} as const;

export const CONSUMER_CONFIG = { countryCode: "US", languageCode: "en" } as const;

export const ENROLLMENT_CONFIG = {
  enrollmentReferenceType: "TOKEN_REFERENCE_ID",
  enrollmentReferenceProvider: "VTS",
} as const;

/** Furniture and home furnishings. What we actually sell. */
export const MERCHANT_CATEGORY = "Home Furnishings";
export const MERCHANT_CATEGORY_CODE = "5712";

/** A mandate should outlive the checkout and not much else. */
export const MANDATE_TTL_SECONDS = 60 * 60;

/**
 * The identifiers Visa correlates a workflow by.
 *
 * CREATED ONCE PER CHECKOUT RUN and reused across every call in it. Generating
 * a fresh pair per call breaks the chain and Visa cannot tie the enrolment,
 * the instruction and the confirmation together.
 */
export interface WorkflowContext {
  clientReferenceId: string;
  clientDeviceId: string;
}

export function createWorkflowContext(): WorkflowContext {
  return { clientReferenceId: randomUUID(), clientDeviceId: randomUUID() };
}

/** Unix seconds as a string. The only place a VIC timestamp is formatted. */
export function generateTimestamp(at: number = Date.now()): string {
  return Math.floor(at / 1000).toString();
}

/** Unix seconds as a string, `seconds` into the future. */
export function generateEffectiveUntil(seconds: number, from: number = Date.now()): string {
  return Math.floor(from / 1000 + seconds).toString();
}

function nationalIdentifier(countryCode: string): string {
  return `${countryCode}-ID-${Math.floor(Math.random() * 1_000_000)}`;
}

/* ------------------------------------------------------------ enrol a card */

export interface EnrollCardOptions {
  consumerId: string;
  /** the VTS token reference id. Without it there is nothing to enrol. */
  enrollmentReferenceId: string;
  context: WorkflowContext;
  email?: string;
  client?: Record<string, unknown>;
}

export function buildEnrollCardPayload({
  consumerId,
  enrollmentReferenceId,
  context,
  email = "agent@visaroom.test",
  client,
}: EnrollCardOptions): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    clientReferenceId: context.clientReferenceId,
    consumer: {
      consumerId,
      nationalIdentifier: nationalIdentifier(CONSUMER_CONFIG.countryCode),
      countryCode: CONSUMER_CONFIG.countryCode,
      languageCode: CONSUMER_CONFIG.languageCode,
      consumerIdentity: {
        identityType: "EMAIL_ADDRESS",
        identityValue: email,
        identityProvider: "PARTNER",
        identityProviderUrl: "https://example.com",
      },
    },
    appInstance: { ...APP_INSTANCE_BASE, clientDeviceId: context.clientDeviceId },
    enrollmentReferenceData: {
      enrollmentReferenceId,
      enrollmentReferenceType: ENROLLMENT_CONFIG.enrollmentReferenceType,
      enrollmentReferenceProvider: ENROLLMENT_CONFIG.enrollmentReferenceProvider,
    },
    consentData: [
      {
        id: randomUUID(),
        type: "PERSONALIZATION",
        source: "CLIENT",
        acceptedTime: generateTimestamp(),
        effectiveUntil: generateEffectiveUntil(365 * 24 * 60 * 60),
      },
    ],
  };

  if (client) payload.client = client;
  return payload;
}

/* -------------------------------------------------------------- the mandate */

export interface Mandate {
  mandateId: string;
  preferredMerchantName: string;
  merchantCategory: string;
  merchantCategoryCode: string;
  declineThreshold: { amount: string; currencyCode: string };
  effectiveUntilTime: string;
  quantity: string;
  description: string;
}

/**
 * Plain words for what this shop is being asked to sell us.
 *
 * The listing titles are the closest thing we have to the user's own words at
 * this layer — the room screen's phrasing ("a tall lamp") lives on the
 * placement, not on the basket line. Titles are true; inventing a phrase the
 * user never typed would not be.
 */
export function describeLines(lines: readonly BasketLine[]): string {
  const titles = lines.map((line) =>
    line.quantity > 1 ? `${line.quantity} × ${line.title}` : line.title
  );
  if (titles.length === 0) return "a home furnishings order";
  if (titles.length === 1) return titles[0];
  if (titles.length === 2) return `${titles[0]} and ${titles[1]}`;
  return `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`;
}

/**
 * One mandate per shop the basket touches.
 *
 * `declineThreshold.amount` IS THE BUDGET HUD'S CAP — the same integer of
 * cents the room screen shows, formatted once at this boundary and nowhere
 * else. Do not change it to a per-shop subtotal: the cap is what the agent is
 * authorised to spend, not what this basket happens to come to.
 */
export function buildMandates(
  basket: Basket,
  now: number = Date.now()
): Mandate[] {
  const groups = new Map<Retailer, BasketLine[]>();
  for (const line of basket.lines) {
    const existing = groups.get(line.retailer);
    if (existing) existing.push(line);
    else groups.set(line.retailer, [line]);
  }

  const effectiveUntilTime = generateEffectiveUntil(MANDATE_TTL_SECONDS, now);
  const amount = minorToDecimalString(basket.budgetMinor);

  return [...groups.entries()].map(([retailer, lines]) => ({
    mandateId: randomUUID(),
    preferredMerchantName: RETAILER_NAMES[retailer],
    merchantCategory: MERCHANT_CATEGORY,
    merchantCategoryCode: MERCHANT_CATEGORY_CODE,
    // the budget HUD's cap, formatted for Visa. The same number, one place.
    declineThreshold: { amount, currencyCode: "USD" },
    effectiveUntilTime,
    quantity: String(lines.reduce((n, line) => n + line.quantity, 0)),
    description: describeLines(lines),
  }));
}

/* --------------------------------------------- the purchase instruction */

export interface InitiateInstructionOptions {
  consumerId: string;
  /** the VTS enrolment reference. Visa calls it tokenId here. */
  tokenId: string;
  context: WorkflowContext;
  basket: Basket;
  client?: Record<string, unknown>;
  now?: number;
}

export function buildInitiatePurchaseInstructionPayload({
  consumerId,
  tokenId,
  context,
  basket,
  client,
  now = Date.now(),
}: InitiateInstructionOptions): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    clientReferenceId: context.clientReferenceId,
    appInstance: { ...APP_INSTANCE_BASE, clientDeviceId: context.clientDeviceId },
    consumerId,
    tokenId,
    assuranceData: [
      { ...ASSURANCE_DATA_BASE, verificationTimestamp: generateTimestamp(now) },
    ],
    mandates: buildMandates(basket, now),
    consumerPrompt: "Purchase authorization mandate",
  };

  if (client) payload.client = client;
  return payload;
}

/* ------------------------------------------------------------- cancelling */

export function buildCancelPurchaseInstructionPayload(
  context: WorkflowContext,
  instructionId?: string,
  client?: Record<string, unknown>
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    clientReferenceId: context.clientReferenceId,
    appInstance: { ...APP_INSTANCE_BASE, clientDeviceId: context.clientDeviceId },
    assuranceData: [
      { ...ASSURANCE_DATA_BASE, verificationTimestamp: generateTimestamp() },
    ],
  };

  if (instructionId) payload.instructionId = instructionId;
  if (client) payload.client = client;
  return payload;
}

/**
 * The client identification object the Direct API path adds and MCP does not.
 * Omitted entirely when the two external ids are not configured — an empty
 * object here is worse than no object.
 */
export function buildClientObject(
  externalClientId: string | null,
  externalAppId: string | null
): Record<string, unknown> | undefined {
  if (!externalClientId || !externalAppId) return undefined;
  return { externalClientId, externalAppId };
}
