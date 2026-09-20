/**
 * The one place minor units become a decimal string.
 *
 * Inside our code money is always an INTEGER OF CENTS. Visa's APIs — both the
 * Acceptance payments API and VIC's mandates — want a decimal string,
 * `"1250.00"`. That conversion happens here and nowhere else, so there is one
 * function to be right and one function to test.
 *
 * NEVER A FLOAT. `(12000 / 100).toFixed(2)` happens to work; `(1e15 + 5) / 100`
 * does not, and the moment a float is involved the bug is invisible until it
 * is a wrong charge. The integer is split and the halves are pasted together.
 */

/** `minorToDecimalString(12000)` → `"120.00"`. Cents in, two decimals out. */
export function minorToDecimalString(minor: number): string {
  if (!Number.isInteger(minor)) {
    throw new TypeError(`money must be an integer number of cents, got ${minor}`);
  }
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${negative ? "-" : ""}${whole}.${String(cents).padStart(2, "0")}`;
}

/** The inverse, for reading an amount back off a Visa response. */
export function decimalStringToMinor(decimal: string): number {
  const match = decimal.trim().match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new TypeError(`not a decimal amount: ${decimal}`);
  const [, sign, whole, fraction = ""] = match;
  const cents = Number(fraction.padEnd(2, "0"));
  return (sign === "-" ? -1 : 1) * (Number(whole) * 100 + cents);
}
