/** Conservative rectangular-box checks for a door and one level, 90° turn. */
export type Measurement = "doorW" | "doorH" | "hallW" | "stairW" | "ceiling";
export type Profile = {
  doorW: number;
  doorH: number;
  hallW: number;
  stairW: number;
  ceiling: number;
  flatPack?: boolean;
  /** Omitted for explicitly supplied kernel inputs; app defaults must pass false. */
  measured?: Partial<Record<Measurement, boolean>>;
  dimensionsSource?: "quoted" | "estimated" | "approx" | "missing";
};

export type FitCheck = {
  key: "door" | "corner" | "headroom";
  verdict: "pass" | "tight" | "fail" | "unknown";
  marginMm: number | null;
  reason: string;
};
export type FitResult = {
  verdict: FitCheck["verdict"];
  binding: "flat_pack" | "door" | "corner" | "corner_flat" | "corner_tilted" | "headroom" | "measurements";
  marginMm: number | null;
  reason: string;
  confidence?: "measured" | "estimated" | "unknown";
  checks?: FitCheck[];
};

/** An advisory handling margin, not a building-code or delivery guarantee. */
export const TIGHT_CLEARANCE_MM = 100;

/**
 * Planar rectangular footprint through a level right-angle corridor.
 * L(theta) = (a - d*cos theta)/sin theta + (b - d*sin theta)/cos theta.
 * Both straight legs must also admit the footprint's minimum width.
 */
export function planarCornerLimit(a: number, b: number, depth: number, steps = 20000): { limit: number | null; atDeg: number | null } {
  if (![a, b, depth].every(Number.isFinite) || a <= 0 || b <= 0 || depth < 0 || depth > Math.min(a, b) || !Number.isInteger(steps) || steps < 2) {
    return { limit: null, atDeg: null };
  }
  let best: number | null = null;
  let bestTh = 0;
  for (let i = 1; i < steps; i++) {
    const th = (i * Math.PI) / (2 * steps);
    const s = Math.sin(th), c = Math.cos(th);
    const na = a - depth * c, nb = b - depth * s;
    if (na <= 0 || nb <= 0) continue;
    const length = na / s + nb / c;
    if (best === null || length < best) { best = length; bestTh = th; }
  }
  return { limit: best, atDeg: best === null ? null : (bestTh * 180) / Math.PI };
}

/**
 * Both sides of a tilted rectangle project onto the floor: l*cos(phi)+m*sin(phi).
 * Reserve the maximum headroom swept while tilting, not just its final height.
 * This tests a bounding footprint; it does not prove a continuous 3D carry path.
 */
export function cornerTilt(l: number, m: number, limit: number): { phi: number; headroom: number; finalHeight: number } | null {
  if (![l, m, limit].every(Number.isFinite) || l <= 0 || m <= 0 || limit < m) return null;
  if (l <= limit) return { phi: 0, headroom: m, finalHeight: m };
  const diagonal = Math.hypot(l, m);
  const phi = Math.atan2(m, l) + Math.acos(Math.min(1, limit / diagonal));
  const finalHeight = l * Math.sin(phi) + m * Math.cos(phi);
  const headroom = phi >= Math.atan2(l, m) ? diagonal : finalHeight;
  return { phi, headroom, finalHeight };
}

const clearanceVerdict = (margin: number): FitCheck["verdict"] => margin < 0 ? "fail" : margin < TIGHT_CLEARANCE_MM ? "tight" : "pass";
const unknown = (key: FitCheck["key"], reason: string): FitCheck => ({ key, verdict: "unknown", marginMm: null, reason });

export function fits(carton: [number, number, number], p: Profile): FitResult {
  if (p.flatPack) return {
    verdict: "unknown", binding: "flat_pack", marginMm: null, confidence: "unknown",
    reason: "Flat-pack delivery needs the dimensions of every packed carton. Assembled size cannot establish delivery clearance.",
  };
  if (!carton.every((n) => Number.isFinite(n) && n > 0) || p.dimensionsSource === "missing") return {
    verdict: "unknown", binding: "measurements", marginMm: null, confidence: "unknown",
    reason: "Valid product or packed-carton dimensions are needed before checking delivery clearance.",
  };
  const known = (...fields: Measurement[]) => fields.every((field) => Number.isFinite(p[field]) && p[field] > 0 && (p.measured === undefined || p.measured[field] === true));
  const [l, m, s] = [...carton].sort((a, b) => b - a);
  const checks: FitCheck[] = [];
  let turnBinding: FitResult["binding"] = "corner_flat";
  let tilt: ReturnType<typeof cornerTilt> = null;

  if (!known("doorW", "doorH")) checks.push(unknown("door", "Doorway not checked — add the clear opening width and height."));
  else {
    const margin = Math.floor(Math.max(Math.min(p.doorW - s, p.doorH - m), Math.min(p.doorW - m, p.doorH - s)));
    checks.push({ key: "door", verdict: clearanceVerdict(margin), marginMm: margin,
      reason: margin < 0
        ? `The ${s} × ${m} mm face exceeds the doorway by at least ${-margin} mm in either upright rotation. A different carrying orientation needs a separate check.`
        : `Doorway clearance is ${margin} mm at the closest edge of the ${s} × ${m} mm face.${margin < TIGHT_CLEARANCE_MM ? " Little room for hands, padding or the door itself." : ""}` });
  }

  if (!known("hallW", "stairW")) checks.push(unknown("corner", "Stair turn not checked — add the clear hallway and landing widths."));
  else {
    const widthMargin = Math.min(p.hallW, p.stairW) - s;
    const { limit, atDeg } = planarCornerLimit(p.hallW, p.stairW, s);
    if (limit === null || limit <= 0) {
      turnBinding = "corner";
      checks.push({ key: "corner", verdict: "fail", marginMm: Math.floor(widthMargin), reason: `The ${s} mm minimum thickness leaves no clear path through this hallway and 90° stair turn. Check handrails, posts and other pinch points.` });
    } else if (l <= limit) {
      const margin = Math.floor(Math.min(widthMargin, limit - l));
      checks.push({ key: "corner", verdict: clearanceVerdict(margin), marginMm: margin,
        reason: `The level 90° turn has ${margin} mm of model clearance at its tightest constraint (${atDeg!.toFixed(1)}°).${margin < TIGHT_CLEARANCE_MM ? " This is a tight corner; check handrails and inside-corner projections." : ""}` });
      tilt = cornerTilt(l, m, limit);
    } else {
      turnBinding = "corner_tilted";
      tilt = cornerTilt(l, m, limit);
      checks.push(tilt
        ? { key: "corner", verdict: "tight", marginMm: null, reason: `It cannot turn flat. A ${((tilt.phi * 180) / Math.PI).toFixed(1)}° tilt reaches the model's turning limit with no turning allowance. Verify the full carry path with the delivery team.` }
        : { key: "corner", verdict: "unknown", marginMm: null, reason: "No flat or simple tilted route was found for this tight corner. A delivery team must check other orientations and the actual stair geometry." });
    }
  }

  if (!known("ceiling")) checks.push(unknown("headroom", "Headroom not checked — measure the lowest obstruction above the landing and turn."));
  else if (!tilt) checks.push(unknown("headroom", "Headroom cannot be assessed until a turning orientation is established."));
  else {
    const required = Math.ceil(tilt.headroom);
    const margin = Math.floor(p.ceiling - required);
    checks.push({ key: "headroom", verdict: clearanceVerdict(margin), marginMm: margin,
      reason: `${tilt.phi > 0 ? "Tilting sweeps through" : "This orientation needs"} ${required} mm of headroom; measured clearance is ${p.ceiling} mm.${margin < 0 ? ` Short by ${-margin} mm.` : ` ${margin} mm remains.`}` });
  }

  const failed = checks.find((check) => check.verdict === "fail");
  const missing = checks.find((check) => check.verdict === "unknown");
  const tight = checks.filter((check) => check.verdict === "tight").sort((a, b) => (a.marginMm ?? 0) - (b.marginMm ?? 0))[0];
  const narrowest = [...checks].sort((a, b) => (a.marginMm ?? Infinity) - (b.marginMm ?? Infinity))[0];
  const decisive = failed ?? missing ?? tight ?? narrowest;
  const estimated = p.dimensionsSource === "estimated" || p.dimensionsSource === "approx";
  return {
    verdict: decisive.verdict,
    binding: decisive.verdict === "unknown" ? "measurements" : decisive.key === "corner" ? turnBinding : decisive.key,
    marginMm: decisive.marginMm,
    reason: `${estimated ? "Estimated product size: " : ""}${decisive.reason}`,
    confidence: missing ? "unknown" : estimated ? "estimated" : "measured",
    checks,
  };
}
