"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

type LoadingStateProps = {
  variant?: "cards" | "rows" | "section"
  /** How many placeholders `cards` / `rows` render. */
  count?: number
  className?: string
}

/**
 * Layout-preserving loading placeholders.
 *
 * **Structure only (Factory v1.2 · F5).** These three variants describe *shapes*
 * — a card grid, a row list, a single content block — with no product
 * composition baked in: no hero, no fixed column count, no assumption about how
 * many metrics a page has. A page whose loading state mirrors a *specific*
 * composition owns that skeleton itself; see
 * `app/_sample/dashboard-skeleton.tsx` for the Reference Sample's.
 *
 * 骨架的价值在于"换上去的时候页面不动"，所以形状要跟着真实构图走 —— 但"真实构图"
 * 是产品的知识，不是 Factory 的。共享组件只提供结构。
 */
export function LoadingState({ variant = "cards", count = 4, className }: LoadingStateProps) {
  if (variant === "cards") {
    return (
      <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3", className)}>
        {Array.from({ length: count }).map((_, index) => (
          <div key={index} className="flex flex-col gap-3 rounded-panel border-hairline px-5 py-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
    )
  }

  if (variant === "rows") {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <Skeleton className="h-9 w-full max-w-64" />
        {Array.from({ length: count }).map((_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-3.5 w-full max-w-md" />
      <Skeleton className="mt-3 h-40 w-full rounded-card" />
    </div>
  )
}
