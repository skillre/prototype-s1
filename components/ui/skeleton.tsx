import { cn } from "cn"

/**
 * Loading placeholder. A slow shimmer reads as "content arriving" far better
 * than a hard pulse, and it stays quiet enough to sit under real content.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "relative overflow-hidden rounded-field bg-muted/70",
        "after:absolute after:inset-0 after:animate-[skeleton-sheen_1.6s_ease-in-out_infinite] after:bg-linear-to-r after:from-transparent after:via-foreground/6 after:to-transparent",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
