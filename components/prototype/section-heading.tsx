import { cn } from "@/lib/utils"

type SectionHeadingProps = {
  title: string
  eyebrow?: string
  description?: string
  /** Right-aligned control row (buttons, filters, counters). */
  action?: React.ReactNode
  /** Hairline under the heading — the section's only boundary. */
  divider?: boolean
  className?: string
  /** h2 by default; `h3` for headings nested inside a region. */
  level?: "h2" | "h3"
}

/**
 * 开放式区块标题。
 *
 * 结构固定：眉标（带品牌短刻度）+ 标题 + 说明，右侧是操作。区块之间靠
 * 一条 hairline 与留白分隔——这是 V3 里取代「卡片标题栏 + 卡片边框」的
 * 排版手段，也是页面上大部分层级信息的承担者。
 *
 * 数字与金额请放在描述里（它们自带 `.numeric`），不要塞进标题，
 * 否则标题的字重会把数字的视觉重量压平。
 */
export function SectionHeading({
  title,
  eyebrow,
  description,
  action,
  divider = true,
  className,
  level = "h2",
}: SectionHeadingProps) {
  const Heading = level
  return (
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-x-6 gap-y-3",
        divider && "border-b border-hairline pb-3.5",
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow ? (
          <span className="eyebrow text-muted-foreground/60">
            <span aria-hidden className="section-tick" />
            {eyebrow}
          </span>
        ) : null}
        <Heading className="text-heading text-balance">{title}</Heading>
        {description ? (
          <p className="text-body-sm text-pretty text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  )
}
