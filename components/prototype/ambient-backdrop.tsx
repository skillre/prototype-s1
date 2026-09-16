"use client"

import { cn } from "@/lib/utils"

type AmbientBackdropProps = {
  /** Adds a faint grid, masked so it fades out before it reaches the content. */
  grid?: boolean
  /** `hero` centres the wash; `panel` keeps it subtle inside a card. */
  variant?: "page" | "hero" | "panel"
  className?: string
}

/**
 * The ambient layer.
 *
 * Premium feel comes from depth, not from effects: one soft radial brand wash
 * and (optionally) a barely-visible grid, always behind the content and always
 * `pointer-events-none`. Used on the page background, the dashboard hero, chart
 * surfaces and the command palette — never across a whole scrolling page at
 * full strength.
 */
export function AmbientBackdrop({ grid = false, variant = "page", className }: AmbientBackdropProps) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden", className)}
    >
      <div
        className={cn(
          "ambient-wash absolute inset-x-0",
          variant === "hero" && "-top-32 h-[22rem] opacity-90",
          variant === "page" && "-top-40 h-80 opacity-60",
          variant === "panel" && "inset-0 opacity-70"
        )}
      />
      {grid ? (
        <div
          className={cn(
            "ambient-grid absolute inset-0",
            "[mask-image:radial-gradient(72%_58%_at_50%_0%,black,transparent)]"
          )}
        />
      ) : null}
    </div>
  )
}
