import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

const MAX_BYTES = 12_000_000;
const TIMEOUT_MS = 8_000;
const RASTER_IMAGE = /^image\/(?:png|jpe?g|webp|avif|gif|bmp)(?:;|$)/i;

/** Public unicast only; mapped IPv4 and transition IPv6 cannot bypass IPv4 checks. */
export function isPublicImageAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19)));
  }
  if (isIP(address) === 6) {
    // Limit to global 2000::/3; reject documentation, Teredo and 6to4 ranges.
    const [first, second] = address.split(":").map((part) => Number.parseInt(part || "0", 16));
    return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 &&
      !(first === 0x2001 && (second === 0 || second === 0xdb8));
  }
  return false;
}

async function publicAddress(url: URL, signal: AbortSignal) {
  if (!/^https?:$/.test(url.protocol) || url.username || url.password ||
      (url.port && url.port !== "80" && url.port !== "443")) return null;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || /\.(?:localhost|local|internal)\.?$/i.test(hostname)) return null;
  if (isIP(hostname)) return isPublicImageAddress(hostname) ? { address: hostname, family: isIP(hostname) } : null;
  // DNS work is also bounded by the same overall deadline.
  const records = await new Promise<Array<{ address: string; family: number }> | null>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    lookup(hostname, { all: true, verbatim: true }).then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", aborted);
    });
  });
  if (!Array.isArray(records) || !records.length || records.some((record) => !isPublicImageAddress(record.address))) return null;
  return records[0];
}

/** A bounded raster-image download with vetted DNS pinned through the connection. */
export async function fetchPublicImage(raw: string, inputSignal?: AbortSignal): Promise<Buffer | null> {
  if (raw.length > 4096) return null;
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  const signal = inputSignal ? AbortSignal.any([inputSignal, deadline]) : deadline;
  try {
    let url = new URL(raw);
    for (let redirects = 0; redirects <= 3; redirects++) {
      signal.throwIfAborted();
      const address = await publicAddress(url, signal);
      if (!address) return null;
      const result = await new Promise<Buffer | URL | null>((resolve, reject) => {
        const request = url.protocol === "https:" ? httpsRequest : httpRequest;
        const req = request(url, {
          signal,
          family: address.family,
          headers: { accept: "image/*" },
          // Pin the checked answer rather than resolving again during connect.
          lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
        }, async (response) => {
          try {
            if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
              const location = response.headers.location;
              response.destroy();
              resolve(location ? new URL(location, url) : null);
              return;
            }
            if (response.statusCode !== 200 || !RASTER_IMAGE.test(response.headers["content-type"] ?? "") ||
                Number(response.headers["content-length"] ?? 0) > MAX_BYTES) {
              response.destroy();
              resolve(null);
              return;
            }
            let size = 0;
            const chunks: Buffer[] = [];
            for await (const chunk of response) {
              size += chunk.length;
              if (size > MAX_BYTES) {
                response.destroy();
                resolve(null);
                return;
              }
              chunks.push(Buffer.from(chunk));
            }
            resolve(Buffer.concat(chunks, size));
          } catch (error) { reject(error); }
        });
        req.on("error", reject);
        req.end();
      });
      if (!(result instanceof URL)) return result;
      url = result;
    }
  } catch { /* A rejected or unavailable image keeps the existing stand-in. */ }
  return null;
}
