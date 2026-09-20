export const RETAILER_WHITELIST = [
  "etsy.com",
  "ikea.com",
  "wayfair.com",
  "walmart.com",
  "amazon.com",
] as const;

/** Common query params that carry the real destination on Google redirect URLs. */
const REDIRECT_PARAM_KEYS = ["url", "q", "imgurl", "adurl", "u", "dest"] as const;

/**
 * If `link` is a Google (or similar) redirect, return the nested destination URL.
 * Otherwise return the original link. Invalid input returns null.
 */
export function unwrapProductUrl(link: string): string | null {
  if (!link || typeof link !== "string") return null;

  let current = link.trim();
  if (!current) return null;

  // Follow a few nested redirect layers at most.
  for (let i = 0; i < 3; i++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return i === 0 ? null : current;
    }

    const host = parsed.hostname.toLowerCase();
    const isGoogleRedirect =
      host === "google.com" ||
      host.endsWith(".google.com") ||
      host === "googleadservices.com" ||
      host.endsWith(".googleadservices.com");

    if (!isGoogleRedirect) {
      return current;
    }

    let next: string | null = null;
    for (const key of REDIRECT_PARAM_KEYS) {
      const value = parsed.searchParams.get(key);
      if (!value) continue;
      try {
        // Values are often percent-encoded absolute URLs.
        const candidate = new URL(value);
        next = candidate.toString();
        break;
      } catch {
        // ignore non-URL param values (e.g. plain search queries in `q`)
      }
    }

    if (!next) {
      return current;
    }
    current = next;
  }

  return current;
}

export function getHostname(link: string): string | null {
  const unwrapped = unwrapProductUrl(link);
  if (!unwrapped) return null;

  try {
    return new URL(unwrapped).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** True if hostname is exactly a whitelist domain or a subdomain of one. */
export function isWhitelistedHostname(hostname: string): boolean {
  return getWhitelistedDomain(hostname) !== null;
}

/** Map hostname to the canonical whitelist domain (e.g. www.ikea.com → ikea.com). */
export function getWhitelistedDomain(hostname: string): string | null {
  const host = hostname.toLowerCase();
  for (const domain of RETAILER_WHITELIST) {
    if (host === domain || host.endsWith(`.${domain}`)) {
      return domain;
    }
  }
  return null;
}

export function isWhitelistedProductUrl(link: string | undefined | null): boolean {
  if (!link) return false;
  const hostname = getHostname(link);
  if (!hostname) return false;
  return isWhitelistedHostname(hostname);
}

/**
 * Map Google Shopping `source` labels (e.g. "Amazon", "Walmart") to a
 * whitelist domain when the product link is a Google wrapper URL.
 */
export function retailerFromSourceLabel(
  source: string | null | undefined
): string | null {
  if (!source || typeof source !== "string") return null;
  const label = source.toLowerCase();

  for (const domain of RETAILER_WHITELIST) {
    const name = domain.replace(/\.com$/, "");
    if (label === name || label.includes(name)) {
      return domain;
    }
  }

  return null;
}

/** Prefer hostname whitelist; fall back to Shopping source label. */
export function resolveRetailer(
  link: string,
  sourceLabel?: string | null
): string | null {
  const hostname = getHostname(link);
  if (hostname) {
    const domain = getWhitelistedDomain(hostname);
    if (domain) return domain;
  }
  return retailerFromSourceLabel(sourceLabel);
}

export function isGoogleHostedUrl(link: string | null | undefined): boolean {
  if (!link) return false;
  const hostname = getHostname(link);
  if (!hostname) return false;
  return (
    hostname === "google.com" ||
    hostname.endsWith(".google.com") ||
    hostname === "googleadservices.com" ||
    hostname.endsWith(".googleadservices.com")
  );
}

/** True when the URL is a direct whitelist retailer page (not Google Shopping). */
export function isDirectRetailerUrl(link: string | null | undefined): boolean {
  if (!link || isGoogleHostedUrl(link)) return false;
  const hostname = getHostname(link);
  if (!hostname) return false;
  return getWhitelistedDomain(hostname) !== null;
}
