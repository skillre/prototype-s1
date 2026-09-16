"use client"

import { TriangleAlertIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScaleIn } from "@/components/motion/scale-in"
import { useMessages } from "@/components/i18n/locale-provider"
import { cn } from "@/lib/utils"

type ErrorStateProps = {
  title?: string
  description?: string
  onRetry?: () => void
  retryLabel?: string
  className?: string
}

/** Full-surface error state. `onRetry` must actually recover (demo re-runs its loader). */
export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel,
  className,
}: ErrorStateProps) {
  const t = useMessages()

  return (
    <ScaleIn
      from={0.98}
      duration={0.25}
      className={cn(
        "relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-panel border border-dashed border-danger/35 bg-danger-soft px-6 py-14 text-center",
        className
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-panel bg-danger/12 text-danger ring-1 ring-danger/20">
        <TriangleAlertIcon className="size-5" />
      </span>
      <span className="text-heading">{title ?? t.common.loadFailed}</span>
      {description ? (
        <span className="max-w-md font-mono text-label break-all text-muted-foreground">
          {description}
        </span>
      ) : null}
      {onRetry ? (
        <Button onClick={onRetry} className="mt-2">
          {retryLabel ?? t.common.retry}
        </Button>
      ) : null}
    </ScaleIn>
  )
}
