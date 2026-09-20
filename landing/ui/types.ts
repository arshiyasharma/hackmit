import type { Stage } from "../gl/Stage";
import type { ProgressCursor } from "./ProgressCursor";
import type { RewardCard } from "./RewardCard";
import type { Subtitles } from "./Subtitles";
import type { Toast } from "./Toast";

// What every interaction and page gets from main.ts.
export interface Ctx {
  ui: HTMLElement;
  stage: Stage;
  subtitles: Subtitles;
  cursor: ProgressCursor;
  toast: Toast;
  reward: RewardCard;
  /** Play voice line n (1 based) with its subtitle. Resolves when the line ends. */
  say(n: number): Promise<void>;
  /** Crossfade the flat close-up plane in over the blurred room and clear the blur. */
  enterFlat(pathA: string, pathB?: string): Promise<void>;
}

/** An interaction resolves true when it earned its piece, false when the shopper backed out. */
export type Interaction = (ctx: Ctx) => Promise<boolean>;
