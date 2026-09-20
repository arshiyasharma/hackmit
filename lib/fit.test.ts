import { describe, expect, it } from "vitest";
import { fits, planarCornerLimit, type Profile } from "./fit";

/** The landing the demo is pitched against (build doc §8.3). */
const PROFILE: Profile = {
  doorW: 812,
  doorH: 2000,
  hallW: 900,
  stairW: 870,
  ceiling: 2140,
};

/** Pull the first "NN.N°" out of a reason string. */
function degFromReason(reason: string): number {
  const match = reason.match(/(\d+(?:\.\d+)?)°/);
  if (!match) throw new Error(`no angle in reason: ${reason}`);
  return Number(match[1]);
}

/** Pull the headroom figure ("NNNN mm of headroom") out of a reason string. */
function headroomFromReason(reason: string): number {
  const match = reason.match(/(\d+) mm of headroom/);
  if (!match) throw new Error(`no headroom in reason: ${reason}`);
  return Number(match[1]);
}

describe("planarCornerLimit — §8.2", () => {
  // in-plane depth -> [max length that turns flat, angle in degrees]
  const rows: Array<[number, number, number]> = [
    [400, 1703, 45.6],
    [640, 1223, 46.0],
    [700, 1103, 46.3],
    [800, 902, 47.2],
    [900, 693, 75.2],
  ];

  for (const [depth, limitMm, atDeg] of rows) {
    it(`turns a ${depth} mm depth through 900/870 at ${atDeg}°`, () => {
      const { limit, atDeg: deg } = planarCornerLimit(
        PROFILE.hallW,
        PROFILE.stairW,
        depth,
      );
      expect(limit).not.toBeNull();
      expect(Math.round(limit!)).toBe(limitMm);
      expect(deg!).toBeCloseTo(atDeg, 1);
    });
  }

  // No angle keeps both corridors open once depth >= sqrt(900² + 870²) ≈ 1252 mm.
  it("returns null when nothing of that depth can turn the corner", () => {
    const { limit, atDeg } = planarCornerLimit(900, 870, 1300);
    expect(limit).toBeNull();
    expect(atDeg).toBeNull();
  });
});

describe("fits — the five rows of §8.3", () => {
  it("1900 × 720 × 640 passes tilted: 49.9°, 1918 mm of headroom, 222 mm margin", () => {
    const r = fits([1900, 720, 640], PROFILE);
    expect(r.verdict).toBe("pass");
    expect(r.binding).toBe("corner_tilted");
    expect(r.marginMm).toBe(222);
    expect(degFromReason(r.reason)).toBeCloseTo(49.9, 1);
    expect(headroomFromReason(r.reason)).toBe(1918);
  });

  it("1600 × 850 × 700 passes tilted: 46.4°, 1745 mm of headroom, 395 mm margin", () => {
    const r = fits([1600, 850, 700], PROFILE);
    expect(r.verdict).toBe("pass");
    expect(r.binding).toBe("corner_tilted");
    expect(r.marginMm).toBe(395);
    expect(degFromReason(r.reason)).toBeCloseTo(46.4, 1);
    expect(headroomFromReason(r.reason)).toBe(1745);
  });

  it("2300 × 900 × 800 fails on headroom: 66.9°, 2469 mm needed, short by 329 mm", () => {
    const r = fits([2300, 900, 800], PROFILE);
    expect(r.verdict).toBe("fail");
    expect(r.binding).toBe("headroom");
    expect(r.marginMm).toBe(-329);
    expect(degFromReason(r.reason)).toBeCloseTo(66.9, 1);
    expect(headroomFromReason(r.reason)).toBe(2469);
    expect(r.reason).toContain("Short by 329 mm.");
  });

  it("2050 × 950 × 880 fails at the door", () => {
    const r = fits([2050, 950, 880], PROFILE);
    expect(r.verdict).toBe("fail");
    expect(r.binding).toBe("door");
    expect(r.reason).toBe(
      "Its 880×950 mm face will not pass a 812×2000 mm opening in either rotation.",
    );
  });

  it("1200 × 600 × 400 passes flat with 503 mm to spare", () => {
    const r = fits([1200, 600, 400], PROFILE);
    expect(r.verdict).toBe("pass");
    expect(r.binding).toBe("corner_flat");
    expect(r.marginMm).toBe(503);
    expect(degFromReason(r.reason)).toBeCloseTo(45.6, 1);
    expect(r.reason).toContain("503 mm to spare");
  });
});

describe("fits — short circuits and edges", () => {
  it("flat-pack short-circuits everything, however large the assembled size", () => {
    const r = fits([3000, 2000, 1500], { ...PROFILE, flatPack: true });
    expect(r.verdict).toBe("pass");
    expect(r.binding).toBe("flat_pack");
    expect(r.marginMm).toBeNull();
    expect(r.reason).toBe(
      "Flat-pack — assembled size is irrelevant to delivery.",
    );
  });

  it("sorts the carton, so dimension order does not change the verdict", () => {
    const a = fits([1900, 720, 640], PROFILE);
    const b = fits([640, 1900, 720], PROFILE);
    const c = fits([720, 640, 1900], PROFILE);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("fails on the corner when nothing that thick turns at any angle", () => {
    // Wide enough door to clear step 1, too thick for the 900/870 corner.
    const r = fits([1400, 1350, 1300], { ...PROFILE, doorW: 1400 });
    expect(r.verdict).toBe("fail");
    expect(r.binding).toBe("corner");
    expect(r.marginMm).toBeNull();
  });

  it("calls a sub-100 mm headroom margin tight rather than pass", () => {
    const r = fits([2300, 900, 800], { ...PROFILE, ceiling: 2500 });
    expect(r.verdict).toBe("tight");
    expect(r.binding).toBe("corner_tilted");
    expect(r.marginMm).toBe(31);
  });
});
