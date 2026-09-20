import { cn } from "cn"

/**
 * A wait, drawn as light: a pale-blue block with one soft highlight crossing
 * it. Never a spinner.
 *
 * The sweep borrows the `glass-sheen` keyframe from app/globals.css (it only
 * says "end at translateX(70%)"), so the highlight starts parked off the left
 * edge and the block reads as a still pale-blue shape whenever the animation
 * is not running — which is exactly what reduced motion gets, because the
 * global clamp plays it once, fast, and lets it fall back.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "relative overflow-hidden rounded-md bg-accent-wash",
        "after:pointer-events-none after:absolute after:inset-y-0 after:-inset-x-[60%] after:content-['']",
        "after:bg-[linear-gradient(105deg,transparent_40%,rgb(255_255_255/0.75)_50%,transparent_60%)]",
        "after:[transform:translateX(-70%)]",
        "after:animate-[glass-sheen_1.8s_cubic-bezier(0.65,0,0.35,1)_infinite]",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
