import type { RoomContext } from "./roomContext";

export const MAX_QUERY_LENGTH = 500;

export function isRequestObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validate nested JSON before it reaches query building or paid providers. */
export function validRoomContext(value: unknown): value is RoomContext | null | undefined {
  if (value == null) return true;
  if (!isRequestObject(value)) return false;
  for (const key of ["palette", "styleTags", "searchTerms"]) {
    const list = value[key];
    if (list === undefined) continue;
    if (!Array.isArray(list) || list.length > 20) return false;
    if (!list.every((part) => typeof part === "string" && part.length <= 200)) return false;
  }
  return value.lighting === undefined ||
    (typeof value.lighting === "string" && value.lighting.length <= 200);
}
