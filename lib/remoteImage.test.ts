import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dns = vi.hoisted(() => vi.fn());
const transport = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup: dns }));
vi.mock("node:http", () => ({ request: transport }));
vi.mock("node:https", () => ({ request: transport }));
import { fetchPublicImage, isPublicImageAddress } from "./remoteImage";

type Reply = { statusCode?: number; headers?: Record<string, string>; chunks?: Buffer[] };
function reply({ statusCode = 200, headers = { "content-type": "image/png" }, chunks = [Buffer.from("dummy image")] }: Reply = {}) {
  transport.mockImplementationOnce((_url, _options, callback) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () => queueMicrotask(() => {
      const response = Object.assign(Readable.from(chunks), { statusCode, headers });
      callback(response);
    });
    return req;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  dns.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

describe("bounded public image requests", () => {
  it.each(["http://127.0.0.1/photo", "http://2130706433/photo", "http://0x7f000001/photo", "http://10.0.0.1/photo", "http://169.254.169.254/photo", "http://[::1]/photo", "http://[::ffff:127.0.0.1]/photo", "http://localhost/photo", "file:///tmp/photo", "https://user:password@example.com/photo", "http://example.com:8080/photo"])("rejects unsafe URL without connecting: %s", async (url) => {
    expect(await fetchPublicImage(url)).toBeNull();
    expect(transport).not.toHaveBeenCalled();
  });
  it("refuses hostnames with any private DNS answer", async () => {
    dns.mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "192.168.1.1", family: 4 }]);
    expect(await fetchPublicImage("https://cdn.example.com/photo.png")).toBeNull();
    expect(transport).not.toHaveBeenCalled();
  });
  it("pins the verified public DNS answer for the actual connection", async () => {
    reply();
    expect((await fetchPublicImage("https://cdn.example.com/photo.png"))?.toString()).toBe("dummy image");
    const options = transport.mock.calls[0][1];
    const callback = vi.fn();
    options.lookup("cdn.example.com", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    expect(options.family).toBe(4);
  });
  it("validates redirect destinations before making another connection", async () => {
    reply({ statusCode: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
    expect(await fetchPublicImage("https://cdn.example.com/photo.png")).toBeNull();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("accepts a public redirect with a fresh DNS check", async () => {
    reply({ statusCode: 302, headers: { location: "https://images.example.org/photo.png" } });
    reply();
    expect(await fetchPublicImage("https://cdn.example.com/photo.png")).not.toBeNull();
    expect(dns).toHaveBeenCalledTimes(2);
  });
  it("rejects oversized bodies even without Content-Length", async () => {
    reply({ chunks: [Buffer.alloc(6_000_001), Buffer.alloc(6_000_000)] });
    expect(await fetchPublicImage("https://cdn.example.com/photo.png")).toBeNull();
  });
  it("rejects SVG rather than handing potentially active content to the image pipeline", async () => {
    reply({ headers: { "content-type": "image/svg+xml" } });
    expect(await fetchPublicImage("https://cdn.example.com/photo.svg")).toBeNull();
  });
  it("stops before DNS or transport when cancelled", async () => {
    const controller = new AbortController(); controller.abort();
    expect(await fetchPublicImage("https://cdn.example.com/photo.png", controller.signal)).toBeNull();
    expect(dns).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });
  it.each(["0.0.0.0", "172.16.0.1", "172.31.255.255", "192.168.0.1", "100.64.0.1", "198.18.0.1", "224.0.0.1", "fc00::1", "fe80::1", "2002:7f00:1::1", "2001:db8::1", "2001::1", "2001:0000::1"])("blocks non-public address %s", (address) => {
    expect(isPublicImageAddress(address)).toBe(false);
  });
});
