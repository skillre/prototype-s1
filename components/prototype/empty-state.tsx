"use client"

import { InboxIcon, type LucideIcon } from "lucide-react"
import { FadeIn } from "@/components/motion/fade-in"
import { cn } from "@/lib/utils"
import { durations } from "@/lib/motion-presets"

type EmptyStateProps = {
  icon?: LucideIcon
  title: string
  description?: string
  /** 通常是一个按钮，让空状态有真实的出路（例如"清除筛选"）。 */
  action?: React.ReactNode
  className?: string
}

/** Friendly empty result — always paired with a real way out. */
export function EmptyState({
  icon: Icon = InboxIcon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <FadeIn
      duration={durations.fast}
      className={cn("flex flex-col items-center justify-center gap-2.5 py-8 text-center", className)}
    >
      <span className="relative flex size-12 items-center justify-center rounded-panel bg-muted/70 text-muted-foreground ring-1 ring-border/60">
        <Icon className="size-5" />
      </span>
      <span className="text-body font-medium">{title}</span>
      {description ? (
        <span className="max-w-sm text-pretty text-caption text-muted-foreground">{description}</span>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </FadeIn>
  )
}
