import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A guard on the source itself, not on behaviour.
 *
 * The credentials path handles a decrypted PAN, expiry and dynamic CVV. The
 * rules that keep it safe are the kind a later edit breaks silently — one
 * `console.error(error)` added while debugging and the credential is in a log
 * for the rest of the deploy. These tests read the files and fail the build
 * instead.
 *
 * If one of these fails, do not relax it. Find another way to debug.
 */

const ROOT = join(__dirname, "..", "..");

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (/\.tsx?$/.test(entry) && !entry.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

/** Every file that can touch a VIC response. */
const VISA_FILES = [
  ...filesUnder(join(ROOT, "lib", "visa")),
  ...filesUnder(join(ROOT, "app", "api", "visa")),
];

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** Strip comments so a `console.log` mentioned in prose is not a hit. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Strip the CONTENTS of string and template literals, keeping any `${...}`
 * interpolations. A log line that says the word "body" is prose; a log line
 * that interpolates a variable called `body` is the leak.
 */
function expressionsOnly(source: string): string {
  return code(source)
    .replace(/`(?:[^`\\]|\\.)*`/g, (literal) =>
      (literal.match(/\$\{[^}]*\}/g) ?? []).join(" ")
    )
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

describe("nothing in the Visa path can log a payload", () => {
  it("found the files it is supposed to be guarding", () => {
    expect(VISA_FILES.length).toBeGreaterThan(6);
    expect(VISA_FILES.some((f) => f.includes("credentials"))).toBe(true);
  });

  it("logs only template literals — never an object, a body or a payload", () => {
    for (const file of VISA_FILES) {
      const source = code(read(file));
      for (const [, args] of source.matchAll(/console\.\w+\(([\s\S]*?)\);/g)) {
        // a backtick template or a plain string is fine; `error.message` is fine
        const offending = args
          .split(",")
          .map((arg) => arg.trim())
          .filter(Boolean)
          .filter(
            (arg) =>
              !arg.startsWith("`") &&
              !arg.startsWith('"') &&
              !arg.startsWith("'") &&
              !/\.message\b/.test(arg) &&
              arg !== "error" // only allowed where a VicApiError was already returned
          );
        expect(offending, `${file} logs something that is not a string`).toEqual([]);
      }
    }
  });

  it("never logs a variable named like a body, payload or credential", () => {
    for (const file of VISA_FILES) {
      const source = expressionsOnly(read(file));
      expect(
        source,
        `${file} logs something credential-shaped`
      ).not.toMatch(/console\.\w+\([^)]*\b(body|payload|responseData|credentials?|data|encData|plaintext|decrypted)\b/);
    }
  });
});

describe("the credentials route holds nothing back", () => {
  const source = code(read(join(ROOT, "app", "api", "visa", "credentials", "route.ts")));

  it("returns exactly ok, transactionReferenceId and last4 on success", () => {
    const success = source.match(/\{ ok: true[^}]*\}/);
    expect(success?.[0]).toBe("{ ok: true, transactionReferenceId, last4 }");
  });

  it("reads the credential through last4Of and nothing else", () => {
    expect((source.match(/last4Of/g) ?? []).length).toBe(2); // the import, and the call
    expect(source).not.toMatch(/response\.data\.[A-Za-z]/);
    expect(source).not.toContain("transactionCredentials");
    expect(source).not.toContain("cardNumber");
    expect(source).not.toContain("securityCode");
  });

  it("never stores the response — only the transaction reference", () => {
    expect(source).toContain("setTransactionReference(runId, lineId, transactionReferenceId)");
    expect(source).not.toMatch(/setTransactionReference\([^)]*response/);
  });

  it("never puts a VIC error body in a response", () => {
    expect(source).not.toMatch(/error\.body/);
  });
});

describe("a VIC error body never leaves vicClient.ts", () => {
  it("nothing outside it reads `.body` off an error", () => {
    for (const file of VISA_FILES) {
      if (file.endsWith("vicClient.ts")) continue;
      expect(code(read(file)), `${file} reads a VIC error body`).not.toMatch(
        /\berror\.body\b/
      );
    }
  });
});

describe("the confirm route cannot invent an approval", () => {
  const source = code(read(join(ROOT, "app", "api", "visa", "confirm", "route.ts")));

  it("refuses a line with no real authorization behind it", () => {
    expect(source).toContain('payment.status !== "AUTHORIZED"');
    expect(source).not.toContain('transactionStatus: "APPROVED" as const');
    expect(source).toContain("nothing-to-confirm");
  });

  it("reads the transaction reference back rather than minting one", () => {
    expect(source).toContain("getTransactionReference(runId, lineId)");
    expect(source).not.toContain("randomUUID()");
  });
});
