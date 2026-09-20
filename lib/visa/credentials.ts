import { randomUUID } from "node:crypto";

import { RETAILER_NAMES } from "@/lib/checkout/retailers";
import type { BasketLine } from "@/lib/checkout/types";
import { minorToDecimalString } from "@/lib/money";

import type { WorkflowContext } from "./payloads";
import { generateTimestamp } from "./payloads";

/**
 * Payment credentials and transaction confirmations.
 *
 * ── THE RULE THAT OVERRIDES EVERYTHING ELSE IN THIS FILE ──────────────────
 *
 * The retrieve-credentials response contains REAL PAYMENT CREDENTIALS — a PAN
 * or network token, an expiry, and a dynamic CVV. Visa's own example carries a
 * comment saying not to log it. So:
 *
 *   - never log it, at any level, not even truncated
 *   - never return it to the browser
 *   - never store it, in a run, a database, or a variable that outlives the
 *     request
 *   - never put it in an error message
 *
 * `last4Of` below is the ONLY function that reads the credential, and the most
 * it can return is four characters. Everything else in the route works from
 * the transaction reference, which is an identifier and not a secret. That is
 * enough for the UI to say "paying with •••• 4242" and nothing more.
 *
 * ── AND THE OTHER ONE ─────────────────────────────────────────────────────
 *
 * Do not report APPROVED for a purchase that did not happen. Signals are how
 * Visa resolves disputes; feeding the sandbox fiction is both wrong and an
 * easy thing for a judge to catch. `buildConfirmationPayload` reports what our
 * run actually did, and the route refuses outright to confirm a line that has
 * no real payment behind it.
 */

/** Visa's sample shipping details. Sandbox data — we collect no real address. */
const SAMPLE_SHIPPING = {
  line1: "123 Main St",
  line2: "Apt 1",
  city: "San Francisco",
  state: "CA",
  zip: "94105",
  countryCode: "US",
  deliveryContactDetails: {
    contactFullName: "Adam Taylor",
    contactEmailAddress: "abc@gmail.com",
    contactPhoneNumber: {
      countryCode: "1",
      phoneNumber: "6317054545",
      numberIsVoiceOnly: false,
    },
    instructions: "Leave the package at the door",
  },
} as const;

/** The origin of the line's real listing URL, or null when it will not parse. */
export function merchantUrlFor(line: BasketLine): string | null {
  try {
    return new URL(line.productUrl).origin;
  } catch {
    return null;
  }
}

export function lineTotalDecimal(line: BasketLine): string {
  return minorToDecimalString(line.priceMinor * line.quantity);
}

/* ------------------------------------------------- retrieve the credential */

export interface CredentialsOptions {
  tokenId: string;
  transactionReferenceId: string;
  context: WorkflowContext;
  line: BasketLine;
  instructionId?: string;
  client?: Record<string, unknown>;
}

/**
 * The request. Merchant details come from the line's REAL listing rather than
 * Visa's sample "Best Buy", because the whole point is that this transaction
 * is for that page at that shop.
 */
export function buildRetrievePaymentCredentialsPayload({
  tokenId,
  transactionReferenceId,
  context,
  line,
  instructionId,
  client,
}: CredentialsOptions): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    clientReferenceId: context.clientReferenceId,
    tokenId,
    transactionData: [
      {
        transactionType: "PURCHASE",
        transactionReferenceId,
        transactionAmount: {
          transactionCurrencyCode: "USD",
          transactionAmount: lineTotalDecimal(line),
        },
        shippingAddress: { addressId: randomUUID(), ...SAMPLE_SHIPPING },
        merchantName: RETAILER_NAMES[line.retailer],
        merchantCountryCode: "US",
        merchantUrl: merchantUrlFor(line) ?? line.productUrl,
      },
    ],
  };

  if (instructionId) payload.instructionId = instructionId;
  if (client) payload.client = client;
  return payload;
}

/**
 * The ONLY function allowed to look at a decrypted credential.
 *
 * It returns four characters or null. It does not return the credential, it
 * does not log, it does not throw with the value in the message, and it holds
 * no reference once it returns. Do not add a second reader.
 */
export function last4Of(response: unknown): string | null {
  const data = (response as { data?: Record<string, unknown> } | null)?.data ?? response;
  const credentials = (data as { transactionCredentials?: Record<string, unknown> } | null)
    ?.transactionCredentials;
  if (!credentials) return null;

  const value =
    typeof credentials.cardNumber === "string"
      ? credentials.cardNumber
      : typeof credentials.token === "string"
        ? credentials.token
        : null;

  if (!value || value.length < 4) return null;
  return value.slice(-4);
}

/* --------------------------------------------------- confirm what happened */

/** What our run actually did with this line. Nothing here is aspirational. */
export interface TransactionOutcome {
  /** the real authorization, when one happened */
  approved: boolean;
  /** decimal string, e.g. "120.00" */
  amount: string;
  /** the processor's approval code, when we have a real one */
  authorizationCode: string | null;
  /** the reconciliation id, when we have a real one */
  retrievalReferenceNumber: string | null;
  /** our own order reference — `TEST-IKEA-…` in test mode */
  orderRef: string | null;
}

export interface ConfirmationOptions {
  transactionReferenceId: string;
  context: WorkflowContext;
  line: BasketLine;
  outcome: TransactionOutcome;
  instructionId?: string;
  client?: Record<string, unknown>;
  now?: number;
}

/**
 * The confirmation.
 *
 * `orderStatus` IS DELIBERATELY NOT "COMPLETED". An authorization is a hold,
 * the retailer walk is a simulation, and no goods were ever ordered — so the
 * payment was approved and the order is still pending. Reporting a completed
 * order for one that does not exist is the dishonesty this file exists to
 * avoid.
 *
 * A NOTE ON THE ENUMS: `transactionStatus: "APPROVED"` and
 * `orderStatus: "COMPLETED"` are the only values shown in Visa's sample, so
 * "PENDING" is our reading of what an uncompleted order should say rather than
 * a value we have seen accepted. If the sandbox rejects it, look the enum up —
 * do not "fix" it by sending COMPLETED.
 */
export function buildConfirmationPayload({
  transactionReferenceId,
  context,
  line,
  outcome,
  instructionId,
  client,
  now = Date.now(),
}: ConfirmationOptions): Record<string, unknown> {
  const timestamp = generateTimestamp(now);
  const deliveryEstimate = (Number(timestamp) + 86_400 * 7).toString();
  const amount = {
    transactionAmount: outcome.amount,
    transactionCurrencyCode: "USD",
  };

  const payload: Record<string, unknown> = {
    clientReferenceId: context.clientReferenceId,
    confirmationData: [
      {
        transactionReferenceId,
        paymentConfirmationData: {
          transactionType: "PURCHASE",
          // the authorization really was approved; nothing else claims to be
          transactionStatus: outcome.approved ? "APPROVED" : "DECLINED",
          transactionTimestamp: timestamp,
          responseCode: outcome.approved ? "00" : "05",
          authorizationCode: outcome.authorizationCode ?? "",
          retrievalReferenceNumber: outcome.retrievalReferenceNumber ?? "",
          systemTraceAuditNumber: transactionReferenceId.replace(/-/g, "").slice(0, 12),
          transactionAmount: amount,
          cardEntryMode: "ECOMMERCE",
        },
        orderData: {
          // our own reference, and it says TEST- out loud
          orderId: outcome.orderRef ?? transactionReferenceId,
          // the money was authorised; the goods were never ordered
          orderStatus: "PENDING",
          orderDate: timestamp,
          expectedDeliveryDate: deliveryEstimate,
          transactionAmount: amount,
        },
        merchantData: { merchantName: RETAILER_NAMES[line.retailer] },
        shippingData: {
          // no carrier, no tracking: nothing was shipped and nothing will be
          shippingMethod: "Standard",
          shippingAddress: SAMPLE_SHIPPING,
        },
      },
    ],
  };

  if (instructionId) payload.instructionId = instructionId;
  if (client) payload.client = client;
  return payload;
}
