import { describe, expect, it } from "vitest";
import { cornerTilt, fits, planarCornerLimit, type Profile } from "./fit";
import { profileToFitProfile } from "./fitProfile";
import { DEFAULT_PROFILE } from "./store";

const PROFILE: Profile = { doorW: 812, doorH: 2000, hallW: 900, stairW: 870, ceiling: 2140 };
const WIDE: Profile = { doorW: 1500, doorH: 3000, hallW: 3000, stairW: 3000, ceiling: 4000 };
const measured = { doorW: true, doorH: true, hallW: true, stairW: true, ceiling: true };

describe("level 90° corner geometry", () => {
  it("agrees with the equal-width moving-ladder limit for zero thickness", () => {
    // The thin-rod special case is 2*sqrt(2)*width.
    expect(planarCornerLimit(900, 900, 0).limit).toBeCloseTo(2 * Math.SQRT2 * 900, 4);
  });
  it("retains the existing finite-thickness corner calculation", () => {
    const result = planarCornerLimit(900, 870, 640);
    expect(Math.round(result.limit!)).toBe(1223);
    expect(result.atDeg!).toBeCloseTo(46.0, 1);
  });
  it("refuses a footprint wider than either straight approach", () => {
    expect(planarCornerLimit(900, 870, 900)).toEqual({ limit: null, atDeg: null });
  });
  it.each([[0, 900, 400], [900, NaN, 400], [900, 900, -1]])("handles invalid geometry %j", (a, b, d) => {
    expect(planarCornerLimit(a, b, d).limit).toBeNull();
  });
});

describe("tilting keeps the whole box in the footprint", () => {
  it("includes the vertical side in horizontal projection and reserves swept headroom", () => {
    const limit = planarCornerLimit(900, 870, 640).limit!;
    const tilt = cornerTilt(1900, 720, limit)!;
    expect(1900 * Math.cos(tilt.phi) + 720 * Math.sin(tilt.phi)).toBeCloseTo(limit, 8);
    expect(tilt.headroom).toBeCloseTo(Math.hypot(1900, 720), 8);
    expect(tilt.headroom).toBeGreaterThanOrEqual(tilt.finalHeight);
  });
  it("does not claim that a tilt proves a continuous delivery path", () => {
    const result = fits([1900, 720, 640], PROFILE);
    expect(result.verdict).toBe("tight");
    expect(result.binding).toBe("corner_tilted");
    expect(result.reason).toContain("Verify the full carry path");
  });
  it("catches headroom that the old thin-rod tilt approximation missed", () => {
    const result = fits([1900, 720, 640], { ...PROFILE, ceiling: 2000 });
    expect(result.verdict).toBe("fail");
    expect(result.binding).toBe("headroom");
    expect(result.marginMm).toBe(-32);
  });
  it("returns unknown, not impossible, when simple orientations find no route", () => {
    const result = fits([2500, 1500, 500], { ...WIDE, hallW: 700, stairW: 700 });
    expect(result.verdict).toBe("unknown");
    expect(result.checks?.find((c) => c.key === "corner")?.reason).toContain("other orientations");
  });
});

describe("clearance thresholds and the tightest constraint", () => {
  it.each([[500, "pass", 100], [499, "tight", 99], [400, "tight", 0], [399, "fail", -1]] as const)(
    "door width %i produces %s with margin %i", (doorW, verdict, marginMm) => {
      expect(fits([1200, 600, 400], { ...WIDE, doorW })).toMatchObject({ verdict, binding: "door", marginMm });
    },
  );
  it("reports the door-height shortage even when width alone would clear", () => {
    expect(fits([1200, 600, 400], { ...WIDE, doorW: 450, doorH: 550 })).toMatchObject({ verdict: "fail", binding: "door", marginMm: -50 });
  });
  it.each([[700, "pass"], [699, "tight"], [600, "tight"], [599, "fail"]] as const)(
    "checks flat-box headroom at %i mm", (ceiling, verdict) => {
      expect(fits([1200, 600, 400], { ...WIDE, ceiling })).toMatchObject({ verdict, binding: "headroom", marginMm: ceiling - 600 });
    },
  );
  it("warns when the corner is tight even though door and ceiling are wide", () => {
    const result = fits([850, 600, 400], { ...WIDE, hallW: 600, stairW: 600 });
    expect(result).toMatchObject({ verdict: "tight", binding: "corner_flat" });
    expect(result.marginMm).toBeLessThan(100);
    expect(result.reason).toContain("handrails");
  });
  it("is independent of carton axis order", () => {
    expect(fits([640, 1900, 720], PROFILE)).toEqual(fits([1900, 720, 640], PROFILE));
  });
});

describe("measurement and listing provenance", () => {
  it("never declares the application's default route a fit", () => {
    const result = fits([1200, 600, 400], profileToFitProfile(DEFAULT_PROFILE));
    expect(result).toMatchObject({ verdict: "unknown", confidence: "unknown", marginMm: null });
    expect(result.checks?.every((check) => check.verdict === "unknown")).toBe(true);
  });
  it("checks the door alone when stair measurements were skipped", () => {
    const result = fits([1200, 600, 400], { ...WIDE, measured: { doorW: true, doorH: true } });
    expect(result.verdict).toBe("unknown");
    expect(result.checks?.find((check) => check.key === "door")?.verdict).toBe("pass");
    expect(result.checks?.find((check) => check.key === "corner")?.verdict).toBe("unknown");
  });
  it("still reports a measured obstruction when other route dimensions are unknown", () => {
    const result = fits([1200, 600, 400], { ...WIDE, doorW: 300, measured: { doorW: true, doorH: true } });
    expect(result).toMatchObject({ verdict: "fail", binding: "door" });
  });
  it("labels an estimated product size even with fully measured doorways", () => {
    expect(fits([1200, 600, 400], { ...WIDE, measured, dimensionsSource: "estimated" })).toMatchObject({ verdict: "pass", confidence: "estimated" });
  });
  it("does not infer flat-pack carton clearance from assembled dimensions", () => {
    expect(fits([3000, 2000, 1500], { ...PROFILE, flatPack: true })).toMatchObject({ verdict: "unknown", binding: "flat_pack", marginMm: null });
  });
  it("rejects missing or invalid product sizes without a clearance claim", () => {
    expect(fits([1200, 600, NaN], WIDE).verdict).toBe("unknown");
    expect(fits([1200, 600, 400], { ...WIDE, dimensionsSource: "missing" }).verdict).toBe("unknown");
  });
});
