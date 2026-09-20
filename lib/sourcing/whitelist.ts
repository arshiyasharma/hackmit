/**
 * A FIVE-SHOP ALLOWLIST IS A FIVE-SHOP CATALOGUE.
 *
 * Every Google Shopping hit whose seller was not one of these five used to be
 * dropped on the floor, in `toShoppingCandidate`, before any relevance, price
 * or dimension work ran. That is survivable for a sofa — IKEA and Wayfair sell
 * sofas — and it is fatal for anything else. Ask for a plushie and the shops
 * that answer are Target, Build-A-Bear, Hot Topic and Barnes & Noble, none of
 * which were allowed to exist, so the room said "nothing came back from that"
 * about a Google page that was full of plushies.
 *
 * So these five stay as a PREFERENCE — they rank first and they win ties —
 * and any other real shop is now allowed through. What is still refused is
 * what is not a shop: the Google wrapper itself, and the social, video and
 * reference hosts that turn up in Shopping results with nothing to buy on them.
 */
export const RETAILER_WHITELIST = [
  "etsy.com",
  "ikea.com",
  "wayfair.com",
  "walmart.com",
  "amazon.com",
] as const;

/**
 * Not shops. A link here is a dead end for someone trying to buy the thing,
 * so it is refused however the result was labelled.
 */
const BLOCKED_HOSTS = [
  "google.com",
  "googleadservices.com",
  "googleusercontent.com",
  "youtube.com",
  "youtu.be",
  "pinterest.com",
  "reddit.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "twitter.com",
  "x.com",
  "wikipedia.org",
  "quora.com",
  "medium.com",
  "blogspot.com",
  "wordpress.com",
  "tumblr.com",
  "linkedin.com",
  "yelp.com",
  "tripadvisor.com",
  "archive.org",
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

function matchesHost(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

/** True if hostname is exactly a preferred domain or a subdomain of one. */
export function isWhitelistedHostname(hostname: string): boolean {
  return getWhitelistedDomain(hostname) !== null;
}

/** Map hostname to the canonical preferred domain (e.g. www.ikea.com → ikea.com). */
export function getWhitelistedDomain(hostname: string): string | null {
  for (const domain of RETAILER_WHITELIST) {
    if (matchesHost(hostname, domain)) return domain;
  }
  return null;
}

/** True for hosts that sell nothing — social, video, reference, the wrapper. */
export function isBlockedHostname(hostname: string): boolean {
  return BLOCKED_HOSTS.some((domain) => matchesHost(hostname, domain));
}

/**
 * The name this shop goes by: the preferred domain when it is one of the five,
 * otherwise its own hostname with the `www.` dropped — "target.com",
 * "buildabear.com". Null only when the host sells nothing.
 */
export function retailerDomainFor(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  if (!host || !host.includes(".")) return null;
  if (isBlockedHostname(host)) return null;
  return getWhitelistedDomain(host) ?? host;
}

/** Two retailer names for the same shop, whether or not one carries the TLD. */
export function sameRetailer(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const bare = (value: string) =>
    value.toLowerCase().replace(/^www\./, "").replace(/\.[a-z.]{2,}$/, "");
  return bare(a) === bare(b);
}

export function isWhitelistedProductUrl(link: string | undefined | null): boolean {
  if (!link) return false;
  const hostname = getHostname(link);
  if (!hostname) return false;
  return isWhitelistedHostname(hostname);
}

/**
 * Map Google Shopping `source` labels ("Amazon", "Target") to a retailer name.
 * The five preferred shops answer with their domain; anything else answers
 * with its own label, which is what the card ends up showing.
 */
export function retailerFromSourceLabel(
  source: string | null | undefined
): string | null {
  if (!source || typeof source !== "string") return null;
  const label = source.trim().toLowerCase();
  if (!label) return null;

  for (const domain of RETAILER_WHITELIST) {
    const name = domain.replace(/\.com$/, "");
    if (label === name || label.includes(name)) {
      return domain;
    }
  }

  return label;
}

/** Prefer the hostname; fall back to the Shopping source label. */
export function resolveRetailer(
  link: string,
  sourceLabel?: string | null
): string | null {
  const hostname = getHostname(link);
  if (hostname && !isGoogleHostedUrl(link)) {
    const domain = retailerDomainFor(hostname);
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

/**
 * True when the URL is a page someone could actually buy from: a real host,
 * over http(s), that is neither the Google wrapper nor one of the blocked
 * non-shops. Being one of the five preferred shops is a bonus, not a gate.
 */
export function isDirectRetailerUrl(link: string | null | undefined): boolean {
  if (!link || isGoogleHostedUrl(link)) return false;

  const unwrapped = unwrapProductUrl(link);
  if (!unwrapped) return false;

  let parsed: URL;
  try {
    parsed = new URL(unwrapped);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;

  return retailerDomainFor(parsed.hostname) !== null;
}
