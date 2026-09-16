"use client"

import { useId } from "react"
import { AnimatePresence, motion } from "motion/react"
import { RefreshCwIcon, SparklesIcon, TriangleAlertIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useMessages } from "@/components/i18n/locale-provider"
import { durations, easings } from "@/lib/motion-presets"
import { cn } from "@/lib/utils"

export type AiSummaryStatus = "idle" | "loading" | "ready" | "error"

/**
 * 摘要的**结构**契约——由共享组件定义，不由任何产品定义。
 *
 * v1.0.0 这里 import 了 `AiSummary`（来自 `@/lib/ai-summary`），而后者又
 * `import type { CrmCustomer } from "@/lib/crm-data"`：一条从共享组件穿过产品
 * 数据模块的编译期依赖。现在只描述形状——任何产品的摘要，形状对得上就能用。
 */
export interface AiSummaryLike {
  /** 一句话结论。 */
  headline: string
  /** 3–4 条基于数据的关键信号。 */
  signals: string[]
  /** 建议的下一步动作。 */
  nextStep: string
  /** 0–100 的确定性置信度评分。 */
  confidence: number
  /** 展示用的模型标识（技术标识，不翻译）。 */
  model: string
}

type AiSummaryPanelProps = {
  status: AiSummaryStatus
  summary: AiSummaryLike | null
  onGenerate: () => void
  className?: string
  testId?: string
  /**
   * 面板内的品牌光晕。
   *
   * **默认关闭（Factory v1.2 · N1）。** 全站唯一允许"发光"的地方也必须是
   * 显式的：一个默认打开的光晕，就是 Factory 替所有产品做的审美决定。
   * Reference Sample 在调用点显式传 `glow`。
   */
  glow?: boolean
}

/**
 * 客户详情里的 AI 摘要区块：idle → loading（骨架屏）→ ready（结果淡入）。
 * 结果是确定性 mock（见 lib/ai-summary.ts），可反复重新生成。
 *
 * 视觉上这是全站唯一允许"发光"的地方——它本来就是 AI 能力的展示面。
 * 光晕克制在一层柔和径向渐变内，不叠加粒子或大面积渐变，而且**默认关闭**：
 * 调用方要显式传 `glow`（Factory v1.2 · N1）。
 */
export function AiSummaryPanel({
  status,
  summary,
  onGenerate,
  className,
  testId,
  glow = false,
}: AiSummaryPanelProps) {
  const t = useMessages()
  const loading = status === "loading"
  // v1.0.0 这里把 id 写死成 "ai-summary-heading"。两个面板同时挂载就会产生重复
  // id，`aria-labelledby` 会指向错误（或第一个）节点——正是「No Invisible
  // Semantics」要防的那类问题：屏幕上看不出任何异常。
  const headingId = useId()

  return (
    <section
      data-testid={testId}
      aria-labelledby={headingId}
      className={cn(
        /* 这是页面上唯一带"品牌色内衬"的区块——AI 摘要值得一块自己的地面，
           但不需要 elevation：不用阴影，改用品牌色左轨 + 极淡的品牌底。 */
        "relative isolate flex flex-col gap-3 overflow-hidden rounded-panel border-l-2 border-brand/45 bg-brand-soft/25 py-gutter pr-gutter pl-[calc(var(--spacing-gutter)-2px)]",
        className
      )}
    >
      {/* 品牌光晕：只在面板内部，不溢到页面；显式 opt-in，见 AiSummaryPanelProps.glow。 */}
      {glow ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-70"
          style={{
            backgroundImage:
              "radial-gradient(120% 90% at 0% 0%, var(--ambient-brand), transparent 62%)",
          }}
        />
      ) : null}

      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3
            id={headingId}
            className="flex items-center gap-1.5 text-body font-semibold"
          >
            <span className="flex size-5 items-center justify-center rounded-sm bg-brand-soft text-brand">
              <SparklesIcon className="size-3.5" />
            </span>
            {t.aiSummary.title}
          </h3>
          <p className="text-caption text-muted-foreground">{t.aiSummary.description}</p>
        </div>

        {status !== "idle" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onGenerate}
            disabled={loading}
            data-testid={testId ? `${testId}-regenerate` : undefined}
          >
            <RefreshCwIcon className={cn(loading && "animate-spin")} />
            {loading ? t.aiSummary.generating : t.aiSummary.regenerate}
          </Button>
        ) : null}
      </header>

      <AnimatePresence mode="wait" initial={false}>
        {status === "idle" ? (
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: durations.fast, ease: easings.standard }}
            className="flex flex-col items-start gap-2"
          >
            <p className="text-body-sm text-pretty text-muted-foreground">
              {t.aiSummary.idleHint}
            </p>
            <Button
              type="button"
              size="sm"
              onClick={onGenerate}
              data-testid={testId ? `${testId}-generate` : undefined}
            >
              <SparklesIcon />
              {t.aiSummary.generate}
            </Button>
          </motion.div>
        ) : null}

        {loading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: durations.fast, ease: easings.standard }}
            className="flex flex-col gap-2.5"
            role="status"
            aria-live="polite"
          >
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-3/5" />
            <span className="sr-only">{t.aiSummary.generatingSr}</span>
          </motion.div>
        ) : null}

        {status === "ready" && summary ? (
          <motion.div
            key="ready"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: durations.enter, ease: easings.outExpo }}
            className="flex flex-col gap-3"
          >
            <p className="text-body leading-relaxed font-medium text-pretty">
              {summary.headline}
            </p>

            <ul className="flex flex-col gap-1.5">
              {summary.signals.map((signal) => (
                <li key={signal} className="flex gap-2 text-caption text-muted-foreground">
                  <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-brand" />
                  <span className="leading-relaxed text-pretty">{signal}</span>
                </li>
              ))}
            </ul>

            <div className="rounded-card border border-brand/15 bg-background/60 p-3">
              <span className="eyebrow text-muted-foreground">
                {t.aiSummary.recommendedNextStep}
              </span>
              <p className="mt-1.5 text-caption leading-relaxed text-pretty">{summary.nextStep}</p>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-muted-foreground">
              <span className="numeric">{t.aiSummary.confidence(summary.confidence)}</span>
              <span aria-hidden>·</span>
              <span className="font-mono">{summary.model}</span>
            </div>
          </motion.div>
        ) : null}

        {status === "error" ? (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: durations.fast, ease: easings.standard }}
            className="flex items-center gap-2 text-caption text-danger"
          >
            <TriangleAlertIcon className="size-4 shrink-0" />
            {t.aiSummary.failed}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  )
}
