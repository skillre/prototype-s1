"use client"

import { ArrowLeftIcon, CompassIcon } from "lucide-react"
import Link from "next/link"
import { buttonVariants } from "@/components/ui/button"
import { FadeIn } from "@/components/motion/fade-in"
import { cn } from "@/lib/utils"
import { durations } from "@/lib/motion-presets"

type NotFoundStateProps = {
  /** 例如 "404"。 */
  code?: string
  title: string
  description?: string
  /** 主行动：返回一个真实存在的路由。 */
  action?: {
    label: string
    href: string
  }
  /** 次级建议路由，避免用户走进死胡同。 */
  suggestions?: { label: string; href: string }[]
  className?: string
  testId?: string
  /** 点击主行动时的回调（用于关闭抽屉/清理状态）。 */
  onAction?: () => void
}

/**
 * 404 / 找不到内容的统一兜底界面。刻意做成可复用组件：任何原型都可以在
 * `not-found.tsx` 或详情页里使用它，并且永远提供真实的返回路径。
 */
export function NotFoundState({
  code = "404",
  title,
  description,
  action,
  suggestions,
  className,
  testId,
  onAction,
}: NotFoundStateProps) {
  return (
    <FadeIn
      duration={durations.normal}
      className={cn(
        "relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-panel border border-dashed border-border bg-surface/50 px-6 py-16 text-center",
        className
      )}
    >
      <span className="relative flex size-12 items-center justify-center rounded-panel bg-muted/70 text-muted-foreground ring-1 ring-border/60">
        <CompassIcon className="size-5" />
      </span>

      <span className="font-mono text-label tracking-[0.3em] text-muted-foreground/70">{code}</span>
      <span className="text-heading" data-testid={testId}>
        {title}
      </span>

      {description ? (
        <span className="max-w-md text-pretty text-caption text-muted-foreground">{description}</span>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {action ? (
          <Link href={action.href} className={buttonVariants()} onClick={onAction}>
            <ArrowLeftIcon />
            {action.label}
          </Link>
        ) : null}
        {suggestions?.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={buttonVariants({ variant: "outline" })}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </FadeIn>
  )
}
