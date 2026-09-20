import type { RoomContext } from "@/types";

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function readStrings(source: unknown, key: string, limit: number): string[] {
  if (!source || typeof source !== "object") return [];
  const value = (source as Record<string, unknown>)[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .slice(0, limit);
}

function readText(source: unknown, key: string): string | undefined {
  if (!source || typeof source !== "object") return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const LIGHTING = new Set(["warm", "cool", "neutral"]);

/** Whatever /api/analyze answers, we only keep what we can actually render. */
export function readRoomContext(payload: unknown): RoomContext | null {
  const palette = readStrings(payload, "palette", 5).filter((hex) =>
    HEX.test(hex)
  );
  if (palette.length === 0) return null;
  const lighting = readText(payload, "lighting");
  return {
    palette,
    // shopping words, lowercase, so they read the same in the search string
    styleTags: readStrings(payload, "styleTags", 5).map((t) =>
      t.trim().toLowerCase()
    ),
    lighting:
      lighting && LIGHTING.has(lighting)
        ? (lighting as RoomContext["lighting"])
        : "neutral",
    roomType: readText(payload, "roomType"),
    suggestions: readStrings(payload, "suggestions", 6),
    source: readText(payload, "source") === "model" ? "model" : "fallback",
  };
}
