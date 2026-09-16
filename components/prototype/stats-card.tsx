"use client"

import { useId, useMemo } from "react"
import { motion } from "motion/react"
import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon, type LucideIcon } from "lucide-react"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { AnimatedNumber, formatSeconds } from "@/components/motion/animated-number"
import { formatCurrency, formatCurrencyCompact, formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"
import { durations, easings, softSpring } from "@/lib/motion-presets"

type FormatKind = "currency" | "currencyCompact" | "integer" | "percent" | "duration"

/** Semantic accent — drives the icon tint, the sparkline and the top hairline. */
export type StatsTone = "brand" | "success" | "warning" | "danger" | "info" | "neutral"

/**
 * 所有数值都经 lib/format.ts 渲染，绝不交给 Intl 的默认 locale——
 * 否则同一个金额会因为运行环境不同而变成 "CNY20,060,000" 或 "$20,060,000"。
 */
const FORMATTERS: Record<FormatKind, (value: number) => string> = {
  currency: (value) => formatCurrency(value),
  currencyCompact: (value) => formatCurrencyCompact(value),
  integer: (value) => formatNumber(value),
  percent: (value) => value.toFixed(2),
  duration: formatSeconds,
}

const TONE_VARS: Record<StatsTone, { color: string; soft: string }> = {
  brand: { color: "var(--brand)", soft: "var(--brand-soft)" },
  success: { color: "var(--success)", soft: "var(--success-soft)" },
  warning: { color: "var(--warning)", soft: "var(--warning-soft)" },
  danger: { color: "var(--danger)", soft: "var(--danger-soft)" },
  info: { color: "var(--info)", soft: "var(--info-soft)" },
  neutral: { color: "var(--muted-foreground)", soft: "var(--muted)" },
}

type StatsCardProps = {
  label: string
  /** Animates from the previous value to this one. */
  value: number
  format?: FormatKind
  /** Signed percentage change, e.g. 12.4 or -0.4. */
  delta?: number
  /** Short hint under the delta, e.g. "环比上月". */
  deltaLabel?: string
  icon?: LucideIcon
  hint?: string
  loading?: boolean
  className?: string
  /** Lands on the KPI card — used by e2e tests. */
  testId?: string
  /**
   * 传入后整张卡片变成一个真实的按钮（可键盘聚焦、可回车触发）。
   * 只有确实有目的地时才传——避免出现"看起来能点但没反应"的卡片。
   */
  onActivate?: () => void
  /** 激活时的无障碍描述。 */
  activateLabel?: string
  /** 语义色调：图标底色、迷你走势与顶部细线共用同一种颜色。 */
  tone?: StatsTone
  /** 真实的逐月序列（由 store 数据派生）。传入即渲染迷你走势图。 */
  trend?: number[]
}

/**
 * KPI 卡片。
 *
 * 视觉重点顺序经过刻意安排：标签 → 数值 → 变化量 → 迷你走势，
 * 让"数字本身"始终是卡片上最大的东西；色调、走势与顶部细线只是语义补充。
 */
export function StatsCard({
  label,
  value,
  format = "integer",
  delta,
  deltaLabel,
  icon: Icon,
  hint,
  loading = false,
  className,
  testId,
  onActivate,
  activateLabel,
  tone = "brand",
  trend,
}: StatsCardProps) {
  const gradientId = useId()
  const toneVars = TONE_VARS[tone]
  const path = useMemo(() => (trend && trend.length > 1 ? buildSparkPath(trend) : null), [trend])

  // 布局占位同样带上 testId，避免加载态与就绪态出现两套选择器。
  if (loading) {
    return (
      <Card className={className} data-testid={testId}>
        <CardHeader>
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="gap-2.5">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-4 w-40" />
        </CardContent>
      </Card>
    )
  }

  const deltaTone = delta === undefined ? "neutral" : delta >= 0 ? "positive" : "negative"
  const DeltaIcon =
    deltaTone === "positive"
      ? ArrowUpRightIcon
      : deltaTone === "negative"
        ? ArrowDownRightIcon
        : MinusIcon

  const card = (
    <Card
      size="sm"
      interactive={Boolean(onActivate)}
      className={cn("h-full overflow-hidden", className)}
      data-testid={testId}
    >
      {/* 语义细线：卡片的"状态指示灯"，不依赖阴影表达层级。 */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-px opacity-60"
        style={{
          background: `linear-gradient(90deg, transparent, ${toneVars.color}, transparent)`,
        }}
      />

      <CardHeader>
        <CardTitle className="eyebrow text-muted-foreground">{label}</CardTitle>
        {Icon ? (
          <CardAction>
            <span
              className="flex size-8 items-center justify-center rounded-field transition-transform duration-hover ease-standard group-hover/kpi:scale-105"
              style={{ background: toneVars.soft, color: toneVars.color }}
            >
              <Icon className="size-4" />
            </span>
          </CardAction>
        ) : null}
      </CardHeader>

      <CardContent className="gap-2.5">
        <div className="flex items-baseline gap-1.5">
          <AnimatedNumber
            value={value}
            formatValue={FORMATTERS[format]}
            className={cn("numeric", format === "percent" ? "text-title" : "text-numeric")}
          />
          {format === "percent" ? (
            <span className="text-subtitle font-medium text-muted-foreground">%</span>
          ) : null}
        </div>

        {delta !== undefined ? (
          <div className="flex items-center gap-1.5">
            <Badge
              className={cn(
                "h-5 px-1.5 font-medium",
                deltaTone === "positive" && "bg-success-soft text-success",
                deltaTone === "negative" && "bg-danger-soft text-danger",
                deltaTone === "neutral" && "bg-muted text-muted-foreground"
              )}
            >
              <DeltaIcon className="size-3" />
              {delta > 0 ? "+" : ""}
              {delta}%
            </Badge>
            {deltaLabel ? (
              <span className="truncate text-label text-muted-foreground">{deltaLabel}</span>
            ) : null}
          </div>
        ) : hint ? (
          <span className="truncate text-label text-muted-foreground">{hint}</span>
        ) : null}
      </CardContent>

      {/* 迷你走势：直接由 store 里的真实序列派生，不是装饰。 */}
      {path ? (
        <div aria-hidden className="pointer-events-none -mt-2 h-8 w-full">
          <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="size-full">
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={toneVars.color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={toneVars.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <motion.path
              d={`${path} L 100 32 L 0 32 Z`}
              fill={`url(#${gradientId})`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: durations.slow, ease: easings.outExpo, delay: 0.15 }}
            />
            <motion.path
              d={path}
              fill="none"
              stroke={toneVars.color}
              strokeWidth={1.5}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: durations.glacial, ease: easings.outExpo }}
            />
          </svg>
        </div>
      ) : null}
    </Card>
  )

  // 没有目的地时保持纯展示；有目的地时才是真正的可交互元素。
  if (!onActivate) {
    return <div className={cn("h-full", className)}>{card}</div>
  }

  return (
    <motion.div className={cn("h-full", className)} whileHover={{ y: -3 }} transition={softSpring}>
      <button
        type="button"
        onClick={onActivate}
        aria-label={activateLabel ?? label}
        className="group/kpi block h-full w-full cursor-pointer rounded-card text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {card}
      </button>
    </motion.div>
  )
}

/**
 * 把任意数值序列映射成 0–100 × 0–32 的 SVG 路径。
 * 采样点固定 100 宽，配合 preserveAspectRatio="none" 自适应卡片宽度。
 */
function buildSparkPath(values: number[]): string {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const stepX = 100 / (values.length - 1)

  return values
    .map((value, index) => {
      const x = index * stepX
      // 留出上下 3 单位内边距，避免线贴边被裁掉。
      const y = 29 - ((value - min) / span) * 26
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(" ")
}
