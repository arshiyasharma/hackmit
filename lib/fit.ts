/**
 * VISA fit kernel — pure arithmetic, no imports, no I/O.
 *
 * Scope, stated honestly: this treats the carton as a rectangular prism and
 * ignores the corridor's third dimension along its length.
 */

export type Profile = {
  doorW: number;
  doorH: number;
  hallW: number;
  stairW: number;
  ceiling: number;
  flatPack?: boolean;
};

/**
 * The same measurements under the spelled-out names the rest of the app uses.
 *
 * Declared STRUCTURALLY rather than imported from types/index.ts so this file
 * keeps its promise above: no imports. `types/index.ts`'s `Profile` carries
 * extra fields and satisfies this shape, so it can be passed straight in.
 */
export type ProfileMm = {
  doorWidthMm: number;
  doorHeightMm: number;
  hallwayWidthMm: number;
  landingWidthMm: number;
  ceilingHeightMm: number;
  flatPack?: boolean;
};

/**
 * The one translation between the two spellings.
 *
 * It used to exist twice, once in CartLine and once in FitBadge, and a third
 * copy was about to appear on the server for the agent's fit constraint. Both
 * components now delegate here.
 */
export function profileFromMm(p: ProfileMm): Profile {
  return {
    doorW: p.doorWidthMm,
    doorH: p.doorHeightMm,
    hallW: p.hallwayWidthMm,
    stairW: p.landingWidthMm,
    ceiling: p.ceilingHeightMm,
    ...(p.flatPack === undefined ? {} : { flatPack: p.flatPack }),
  };
}

export type FitResult = {
  verdict: "pass" | "tight" | "fail";
  binding:
    | "flat_pack"
    | "door"
    | "corner"
    | "corner_flat"
    | "corner_tilted"
    | "headroom";
  marginMm: number | null;
  reason: string;
};

/**
 * Longest object of in-plane depth `depth` that turns a right angle
 * between corridors of width a and b.
 *
 * L(theta) = (a - depth*cos theta)/sin theta + (b - depth*sin theta)/cos theta,
 * minimised over theta. `limit` is null if it cannot turn at all.
 */
export function planarCornerLimit(
  a: number,
  b: number,
  depth: number,
  steps = 20000,
): { limit: number | null; atDeg: number | null } {
  let best: number | null = null;
  let bestTh = 0;
  for (let i = 1; i < steps; i++) {
    const th = (i * Math.PI) / (2 * steps);
    const s = Math.sin(th);
    const c = Math.cos(th);
    const na = a - depth * c;
    const nb = b - depth * s;
    if (na <= 0 || nb <= 0) continue;
    const L = na / s + nb / c;
    if (best === null || L < best) {
      best = L;
      bestTh = th;
    }
  }
  return { limit: best, atDeg: best === null ? null : (bestTh * 180) / Math.PI };
}

export function fits(carton: [number, number, number], p: Profile): FitResult {
  if (p.flatPack) {
    return {
      verdict: "pass",
      binding: "flat_pack",
      marginMm: null,
      reason: "Flat-pack — assembled size is irrelevant to delivery.",
    };
  }

  const [l, m, s] = [...carton].sort((x, y) => y - x); // long, mid, short

  // 1. the door: the two smallest faces must clear the opening in one rotation
  const throughDoor =
    (s <= p.doorW && m <= p.doorH) || (m <= p.doorW && s <= p.doorH);
  if (!throughDoor) {
    return {
      verdict: "fail",
      binding: "door",
      marginMm: Math.round(Math.min(p.doorW, p.doorH) - s),
      reason: `Its ${s}×${m} mm face will not pass a ${p.doorW}×${p.doorH} mm opening in either rotation.`,
    };
  }

  // 2. the corner, flat — thinnest face in the corridor plane
  const { limit, atDeg } = planarCornerLimit(p.hallW, p.stairW, s);
  if (limit !== null && l <= limit) {
    return {
      verdict: "pass",
      binding: "corner_flat",
      marginMm: Math.round(limit - l),
      reason: `Turns your landing flat at ${atDeg!.toFixed(1)}° with ${Math.round(
        limit - l,
      )} mm to spare.`,
    };
  }
  if (limit === null || limit <= 0) {
    return {
      verdict: "fail",
      binding: "corner",
      marginMm: null,
      reason: "Nothing this thick turns that corner at any angle.",
    };
  }

  // 3. the corner, tilted — where the good number lives
  const phi = Math.acos(Math.min(1, limit / l));
  const headroom = l * Math.sin(phi) + m * Math.cos(phi);
  const margin = Math.round(p.ceiling - headroom);
  const deg = (phi * 180) / Math.PI;

  if (margin >= 100) {
    return {
      verdict: "pass",
      binding: "corner_tilted",
      marginMm: margin,
      reason: `Needs ${deg.toFixed(1)}° of tilt and ${Math.round(
        headroom,
      )} mm of headroom at the landing; you have ${p.ceiling}.`,
    };
  }
  if (margin >= 0) {
    return {
      verdict: "tight",
      binding: "corner_tilted",
      marginMm: margin,
      reason: `Only ${margin} mm of headroom to spare at ${deg.toFixed(
        1,
      )}° — movers may manage it.`,
    };
  }
  return {
    verdict: "fail",
    binding: "headroom",
    marginMm: margin,
    reason: `Needs ${deg.toFixed(1)}° of tilt and ${Math.round(
      headroom,
    )} mm of headroom; you have ${p.ceiling}. Short by ${-margin} mm.`,
  };
}
