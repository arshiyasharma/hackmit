/**
 * The shops, their display names, and the domains they own.
 *
 * WHY A MERCHANT NEEDS A DOMAIN. A TAP signature is bound to `@authority` —
 * the host the request arrived at. For the merchant side of our demo to check
 * that binding it has to know its own host, and the only thing the request
 * gives it is the `[retailer]` segment of the verify URL. This map is how
 * "wayfair" becomes "wayfair.com", and it is what makes a signature made for
 * one shop get refused at another.
 *
 * SUBDOMAINS COUNT. A listing URL is `www.ikea.com/us/en/p/...`, not
 * `ikea.com`, and IKEA's merchant is still IKEA. `hostBelongsTo` matches the
 * registrable domain and anything under it, so the walk does not fail on a
 * `www.` that nobody thought about.
 *
 * Display names are here too because Prompt 7's mandate needs a
 * `preferredMerchantName` and Prompt 10's overlay needs a heading, and one
 * spelling of "West Elm" is better than three.
 */

import type { Retailer } from "./types";

export const RETAILER_NAMES: Readonly<Record<Retailer, string>> = {
  amazon: "Amazon",
  wayfair: "Wayfair",
  ikea: "IKEA",
  walmart: "Walmart",
  etsy: "Etsy",
};

/** The registrable domain each shop answers on. No scheme, no www, no path. */
export const RETAILER_DOMAINS: Readonly<Record<Retailer, string>> = {
  amazon: "amazon.com",
  wayfair: "wayfair.com",
  ikea: "ikea.com",
  walmart: "walmart.com",
  etsy: "etsy.com",
};

export const RETAILERS = Object.keys(RETAILER_DOMAINS) as Retailer[];

export function isRetailer(value: string): value is Retailer {
  return Object.prototype.hasOwnProperty.call(RETAILER_DOMAINS, value);
}

export function retailerName(retailer: Retailer): string {
  return RETAILER_NAMES[retailer];
}

/** Port and case stripped, so `WWW.IKEA.COM:443` is still IKEA. */
function normaliseHost(host: string): string {
  return host.trim().toLowerCase().split(":")[0].replace(/\.$/, "");
}

/** Is this host the shop itself, or something under it? */
export function hostBelongsTo(retailer: Retailer, host: string): boolean {
  const domain = RETAILER_DOMAINS[retailer];
  const h = normaliseHost(host);
  return h === domain || h.endsWith(`.${domain}`);
}

/**
 * The host this shop's merchant answers as when it has no better information.
 * Used as the merchant's identity when the signature declares somebody else's
 * domain — which is exactly the case that must come back `authority-mismatch`.
 */
export function canonicalHost(retailer: Retailer): string {
  return `www.${RETAILER_DOMAINS[retailer]}`;
}
