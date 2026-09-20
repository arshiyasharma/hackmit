"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";

import { useDemo } from "@/lib/demo";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * The frame the flat screens sit in: a slim top bar and a single 390px-first
 * column.
 *
 * THERE ARE NO STEP DOTS. The flow is two places now — the camera, then the
 * room — and the persistent chrome is the budget HUD on the room screen, not a
 * progress meter up here. The room screen renders its own overlays and does not
 * use this shell at all.
 *
 * The title doubles as the logo: press and hold it to put the flow back at
 * capture. You run this six times in a row at an expo and you do not want to be
 * reloading tabs in front of a judge.
 */

const LONG_PRESS_MS = 700;
/** a finger that travels this far was scrolling, not pressing */
const LONG_PRESS_SLOP_PX = 10;

function useLongPressReset(
  reset: () => void,
  router: ReturnType<typeof useRouter>
): React.DOMAttributes<HTMLElement> {
  const timer = React.useRef<number | null>(null);
  const origin = React.useRef<{ x: number; y: number } | null>(null);

  const cancel = React.useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);

  React.useEffect(() => cancel, [cancel]);

  return {
    onPointerDown: (e: React.PointerEvent) => {
      cancel();
      origin.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        cancel();
        reset();
        if (
          typeof navigator !== "undefined" &&
          typeof navigator.vibrate === "function"
        ) {
          navigator.vibrate(20);
        }
        toast("Started over. Your doorway measurements were kept.");
        router.push("/");
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const start = origin.current;
      if (!start) return;
      if (
        Math.abs(e.clientX - start.x) > LONG_PRESS_SLOP_PX ||
        Math.abs(e.clientY - start.y) > LONG_PRESS_SLOP_PX
      ) {
        cancel();
      }
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    // a long press on a phone otherwise raises the text-selection callout
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
}

export type AppShellProps = {
  children: React.ReactNode;
  /** the name in the top bar */
  title?: string;
  /** replaces router.back() */
  onBack?: () => void;
  /** the first screen has nowhere to go back to */
  showBack?: boolean;
  /** the camera screen wants the whole viewport with no chrome */
  bare?: boolean;
  /** extra controls on the right of the top bar */
  actions?: React.ReactNode;
  className?: string;
  /**
   * @deprecated v2's four-step flow. Accepted so older screens still compile;
   * it is ignored. There are no step dots any more.
   */
  step?: string;
};

export function AppShell({
  children,
  title,
  onBack,
  showBack,
  bare = false,
  actions,
  className,
}: AppShellProps) {
  const router = useRouter();
  const reset = useStore((s) => s.reset);
  const longPress = useLongPressReset(reset, router);

  // false on the server and on the first client render, the real value after:
  // the flag lives in the URL and sessionStorage, which the server cannot see
  const demo = useDemo();

  const label = title ?? "Your room";
  const canGoBack = showBack ?? true;

  if (bare) {
    return (
      <div className={cn("relative flex min-h-dvh flex-col", className)}>
        {children}
      </div>
    );
  }

  return (
    <div className="relative flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-md items-center gap-2 gutter py-2 pt-[max(8px,env(safe-area-inset-top))]">
          {canGoBack ? (
            <button
              type="button"
              onClick={() => (onBack ? onBack() : router.back())}
              aria-label="Go back"
              className="tap -ml-2 flex size-11 items-center justify-center rounded-full text-foreground/80 transition-colors hover:bg-muted active:bg-muted"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
          ) : (
            <span className="size-11 shrink-0" aria-hidden />
          )}

          <h1
            {...longPress}
            title="Press and hold to start over"
            className="font-display min-w-0 flex-1 cursor-default truncate text-lg font-semibold select-none"
          >
            {label}
          </h1>

          {demo ? (
            <span
              className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground"
              title="Replaying frozen listings instead of calling out"
            >
              demo
            </span>
          ) : null}

          {actions}
        </div>
      </header>

      <div className="flex w-full flex-1 justify-center">
        <main
          className={cn(
            "w-full max-w-md flex-1 gutter pb-[max(24px,env(safe-area-inset-bottom))]",
            className
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

export default AppShell;
