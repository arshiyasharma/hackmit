import type { Profile as FitProfile } from "./fit";
import type { Profile } from "@/types";

export function profileToFitProfile(profile: Profile): FitProfile {
  return {
    doorW: profile.doorWidthMm, doorH: profile.doorHeightMm,
    hallW: profile.hallwayWidthMm, stairW: profile.landingWidthMm,
    ceiling: profile.ceilingHeightMm,
    measured: {
      doorW: profile.measured.doorWidthMm === true,
      doorH: profile.measured.doorHeightMm === true,
      hallW: profile.measured.hallwayWidthMm === true,
      stairW: profile.measured.landingWidthMm === true,
      ceiling: profile.measured.ceilingHeightMm === true,
    },
  };
}
