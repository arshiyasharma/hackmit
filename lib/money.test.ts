import { describe, expect, it } from "vitest";

import { decimalStringToMinor, minorToDecimalString } from "./money";

describe("minorToDecimalString — the only place cents become a string", () => {
  it("turns cents into two decimal places", () => {
    expect(minorToDecimalString(12000)).toBe("120.00");
    expect(minorToDecimalString(125000)).toBe("1250.00");
    expect(minorToDecimalString(8999)).toBe("89.99");
    expect(minorToDecimalString(5)).toBe("0.05");
    expect(minorToDecimalString(50)).toBe("0.50");
    expect(minorToDecimalString(0)).toBe("0.00");
  });

  it("keeps a negative amount negative — relinking can go down", () => {
    expect(minorToDecimalString(-3001)).toBe("-30.01");
  });

  it("is exact past the point where a float stops being", () => {
    // 1e15 + 5 cents. Divide by 100 in a float and the cents are gone.
    expect(minorToDecimalString(100000000000005)).toBe("1000000000000.05");
  });

  it("refuses anything that is not a whole number of cents", () => {
    expect(() => minorToDecimalString(120.5)).toThrow(/integer/);
    expect(() => minorToDecimalString(Number.NaN)).toThrow(/integer/);
  });
});

describe("decimalStringToMinor", () => {
  it("reads an amount back off a Visa response", () => {
    expect(decimalStringToMinor("120.00")).toBe(12000);
    expect(decimalStringToMinor("89.99")).toBe(8999);
    expect(decimalStringToMinor("0.5")).toBe(50);
    expect(decimalStringToMinor("1250")).toBe(125000);
    expect(decimalStringToMinor("-30.01")).toBe(-3001);
  });

  it("round-trips every amount the app will see", () => {
    for (const minor of [0, 1, 99, 100, 4200, 8999, 12000, 125000]) {
      expect(decimalStringToMinor(minorToDecimalString(minor))).toBe(minor);
    }
  });

  it("refuses something that is not an amount", () => {
    expect(() => decimalStringToMinor("one hundred")).toThrow();
    expect(() => decimalStringToMinor("120.000")).toThrow();
  });
});
