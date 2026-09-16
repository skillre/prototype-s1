"use client"

import { useId } from "react"
import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from "lucide-react"
import { AnimatedNumber, formatSeconds } from "@/components/motion/animated-number"
import { formatCurrency, formatCurrencyCompact, formatNumber } from "@/lib/format"
import { durations } from "@/lib/motion-presets"
import { cn } from "@/lib/utils"

type FormatKind = "currency" | "currencyCompact" | "integer" | "percent" | "duration"

const FORMATTERS: Record<FormatKind, (value: number) => string> = {
  currency: (value) => formatCurrency(value),
  currencyCompact: (value) => formatCurrencyCompact(value),
  integer: (value) => formatNumber(value),
  percent: (value) => value.toFixed(1),
  duration: formatSeconds,
}

/**
 * 次级指标条。
 *
 * V2 的仪表盘是五张等宽 KPI 卡；那是"AI 生成 SaaS"最明显的信号：
 * 五块同样重的矩形 + 五条通栏 sparkline，视觉重量完全相同。
 *
 * V3 把它拆成两层——主指标升进 Hero（`text-metric`），其余指标降级成
 * 这一条**没有卡片、只有竖分隔线**的指标带：字号小一档（`text-metric-sm`），
 * 没有边框、没有阴影、没有背景，靠排版与 hairline 与页面融为一体。
 * 于是"哪个数字更重要"变成一眼可读，而不是需要逐张卡片去比。
 *
 * 顺序即重量：调用方按重要性排列，而不是按数据种类排列。
 */
export function MetricStrip({
  children,
  label,
  className,
}: {
  children: React.ReactNode
  /** 可选的眉标，画在整条指标带上方。 */
  label?: string
  className?: string
}) {
  const items = Array.isArray(children) ? children : [children]
  // 分隔线按位置决定：移动端 2×2 → 第 3 项补上边线；桌面 4 列 → 全部竖线。
  const dividers = [
    "",
    "border-l",
    "border-t lg:border-t-0 lg:border-l",
    "border-t border-l lg:border-t-0",
  ]

  return (
    <div className={cn("flex flex-col gap-3.5", className)}>
      {label ? (
        <span className="eyebrow text-muted-foreground/60">
          <span aria-hidden className="section-tick" />
          {label}
        </span>
      ) : null}
      <div className="grid grid-cols-2 gap-y-5 lg:grid-cols-4">
        {items.map((child, index) => (
          <div
            key={index}
            className={cn(
              "flex min-w-0 flex-col gap-1.5 border-hairline px-4 odd:pl-0 lg:px-6 lg:first:pl-0",
              dividers[index]
            )}
          >
            {child}
          </div>
        ))}
      </div>
    </div>
  )
}

type MetricItemProps = {
  label: string
  value: number
  format?: FormatKind
  /** 有符号百分比，例如 18.2 / -0.4。 */
  delta?: number
  deltaLabel?: string
  /** 无 delta 时展示的说明文案。 */
  hint?: string
  /**
   * 真实逐月走势（12 个点）——画成一条极细的迷你线，让"这个数字在往哪走"
   * 变成一眼可见的事实。没有数据就不画，绝不塞装饰性曲线。
   */
  trend?: number[]
  /** 迷你走势的无障碍名称（图表本身是装饰性的，读屏需要这句话）。 */
  trendLabel?: string
  /** 传了才成为真实的按钮；没有目的地的指标保持纯展示。 */
  onActivate?: () => void
  activateLabel?: string
  testId?: string
  className?: string
}

/** 指标带里的单个指标。字号固定 `text-metric-sm`——层级由位置决定。 */
export function MetricItem({
  label,
  value,
  format = "integer",
  delta,
  deltaLabel,
  hint,
  trend,
  trendLabel,
  onActivate,
  activateLabel,
  testId,
  className,
}: MetricItemProps) {
  const deltaTone = delta === undefined ? "none" : delta >= 0 ? "positive" : "negative"
  const DeltaIcon =
    deltaTone === "positive"
      ? ArrowUpRightIcon
      : deltaTone === "negative"
        ? ArrowDownRightIcon
        : MinusIcon

  const body = (
    <>
      <span className="eyebrow truncate text-muted-foreground/70">{label}</span>

      <span className="flex items-baseline gap-0.5">
        <AnimatedNumber
          value={value}
          duration={durations.slow}
          formatValue={FORMATTERS[format]}
          /* 纯数字才吃负字距：时长（"4分38秒"）里带中文量词，
             负 tracking 会把中文压紧——中文不该借用数字的紧缩。 */
          className={cn("text-metric-sm", format === "duration" ? "tracking-normal" : "numeric")}
        />
        {format === "percent" ? (
          <span className="text-body font-medium text-muted-foreground">%</span>
        ) : null}
      </span>

      <span className="flex min-w-0 items-center gap-1.5">
        {delta !== undefined ? (
          <>
            <span
              className={cn(
                "numeric inline-flex items-center gap-0.5 text-label font-medium",
                deltaTone === "positive" && "text-success",
                deltaTone === "negative" && "text-danger"
              )}
            >
              <DeltaIcon className="size-3" />
              {delta > 0 ? "+" : ""}
              {delta}%
            </span>
            {deltaLabel ? (
              <span className="truncate text-label text-muted-foreground">{deltaLabel}</span>
            ) : null}
          </>
        ) : hint ? (
          <span className="truncate text-label text-muted-foreground">{hint}</span>
        ) : null}
      </span>

      {trend && trend.length > 1 ? <Sparkline data={trend} label={trendLabel} /> : null}
    </>
  )

  if (!onActivate) {
    return <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>{body}</div>
  }

  return (
    <button
      type="button"
      onClick={onActivate}
      aria-label={activateLabel ?? label}
      data-testid={testId}
      className={cn(
        "group/metric flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-field text-left outline-none",
        "transition-colors duration-hover ease-standard",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        className
      )}
    >
      {body}
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/* 迷你走势                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 指标带里的迷你走势。
 *
 * 手写 SVG 而不是再挂一个图表库实例：一行 22px 的走势不需要坐标轴、不需要
 * tooltip、不需要响应式容器，只需要一条线。`preserveAspectRatio="none"` 让
 * 它随列宽伸展，`non-scaling-stroke` 保证线宽不被拉伸。
 */
function Sparkline({ data, label }: { data: number[]; label?: string }) {
  const gradientId = useId()
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const height = 22
  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * 100
    const y = height - ((value - min) / span) * (height - 4) - 2
    return [x, y] as const
  })
  const line = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ")
  const area = `${line} L100,${height} L0,${height} Z`

  return (
    <svg
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      className="h-[22px] w-full overflow-visible"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.18} />
          <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke="var(--brand)"
        strokeOpacity={0.55}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
