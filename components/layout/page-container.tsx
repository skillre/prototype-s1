import { AmbientBackdrop } from "@/components/prototype/ambient-backdrop"
import { cn } from "@/lib/utils"

type PageContainerProps = {
  /** Small line above the H1 — breadcrumb / section context. */
  eyebrow?: string
  title?: string
  description?: string
  /** Right-aligned header actions (buttons, selectors). */
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  /** Constrain content width; passthrough to the inner wrapper. */
  contentClassName?: string
  /**
   * Opt in to the page-level ambient backdrop.
   *
   * **Default off (Factory v1.2 · N1).** An ambient wash is Art Direction, not
   * structure: a brand-new route that inherits one has been given a personality
   * nobody chose. The capability stays here; turning it on is a decision the
   * product makes at the call site (`<PageContainer ambient>`), which is also
   * what the Reference Sample now does.
   */
  ambient?: boolean
  /**
   * `full`    — eyebrow + display-ish title + description. For pages where the
   *             title is the entry point (客户 / 任务 / 活动 / 详情).
   * `compact` — one tight row: small title + actions. For pages that open with
   *             their own protagonist region (总览的 Hero)，避免标题和主视觉
   *             抢同一个高度。
   * `none`    — no header at all; the page owns its own opening.
   */
  variant?: "full" | "compact" | "none"
}

/**
 * Standard page shell: a header block with a clear type hierarchy, then the
 * content on a consistent max width.
 *
 * Neutral by default (Factory v1.2 · N1). The ambient layer used to default to
 * ON, which meant every new route inherited a brand wash before anyone decided
 * it should have one — the Factory quietly supplying a personality. It is now
 * opt-in, and the Reference Sample opts in explicitly. The eyebrow tick below
 * stays: it is a structural rule mark (see AGENTS.md · Core Neutrality), not a
 * lighting effect.
 */
export function PageContainer({
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
  ambient = false,
  variant = "full",
}: PageContainerProps) {
  return (
    <div
      className={cn(
        "relative isolate mx-auto w-full max-w-dashboard px-gutter py-6 sm:px-8 sm:py-6",
        className
      )}
    >
      {ambient ? <AmbientBackdrop variant="page" /> : null}

      {variant === "none" || !title ? null : variant === "compact" ? (
        <div className="mb-5 flex items-center justify-between gap-4">
          <h1 className="text-heading text-balance">{title}</h1>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : (
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1.5">
            {eyebrow ? (
              <span className="eyebrow text-brand">
                <span aria-hidden className="section-tick" />
                {eyebrow}
              </span>
            ) : null}
            <h1 className="text-title text-balance">{title}</h1>
            {description ? (
              <p className="text-body-sm text-pretty text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>
          ) : null}
        </div>
      )}

      <div className={cn("flex flex-col gap-6", contentClassName)}>{children}</div>
    </div>
  )
}
