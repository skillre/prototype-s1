"use client"

import type { ReactNode } from "react"

import { useMessages } from "@/components/i18n/locale-provider"
import { EmptyState } from "@/components/prototype/empty-state"
import { ErrorState } from "@/components/prototype/error-state"
import { LoadingState } from "@/components/prototype/loading-state"
import { usePanelScroll } from "@/hooks/use-panel-scroll"
import { cn } from "@/lib/utils"

/**
 * 面板外壳 —— 标题、角标、三态、面板内滚动。
 *
 * ## 三态是真的三态
 *
 * `loading`：事件流还没装载（store 里还没有事件）。
 * `empty`：本回合还没走到这一步（例如第 10 拍之前的工具控制台）。
 * `error`：派生**真的失败了**（数据层的 `evidenceById` 对断链的引用会抛）。
 *   它不是装饰性的错误态：重试按钮调的是 `loadCanonicalStream()`，
 *   所以「重试」是一条能真的恢复的出路，而不是一个假按钮。
 *
 * 三个状态都用 Core 的全局组件表达（EmptyState / LoadingState / ErrorState），
 * 不在这里另造一套视觉。
 *
 * ## 滚动按行对齐（2026-09-17 修复）
 *
 * 面板正文跟着最新内容滚到底，`scrollTop` 因此是个任意像素值 —— 顶部那一行会被切在
 * 半个字高上，并压到面板头的规则线。修法是 `usePanelScroll`：把 `scrollTop` 吸附到
 * 最近的行下沿（行间本来有空隙，切痕落进空隙就等于没有切痕），并在真的溢出时给顶边
 * 一层 `data-scroll-mask` 渐隐兜底。**没有改成整页滚动** —— 这一屏承诺 16:9 单屏不溢出。
 */

export type PanelStatus = "loading" | "error" | "empty" | "ready"

export type WorkbenchPanelProps = {
  /** 面板 id（十二个组件 id 之一），会写成 `data-panel` 供 QA / 测试定位。 */
  id: string
  title: string
  subtitle?: string
  /** 标题右侧：计数、进度、角标。 */
  aside?: ReactNode
  status: PanelStatus
  /** `error` 状态下的原因（数据层抛出来的原文）。 */
  errorMessage?: string | null
  onRetry?: () => void
  /** `empty` 状态下的文案。 */
  emptyTitle?: string
  emptyNote?: string
  /** 内容。`loading` / `empty` / `error` 时忽略。 */
  children?: ReactNode
  className?: string
  bodyClassName?: string
  /**
   * 「内容变了」的机器可读形式（条数、最后一条的 key……）。变一次，面板就在
   * **操作者本来就在底部**的前提下跟随到新的底部，然后按行对齐。见 `usePanelScroll`。
   */
  followKey?: string | number
}

export function WorkbenchPanel({
  id,
  title,
  subtitle,
  aside,
  status,
  errorMessage,
  onRetry,
  emptyTitle,
  emptyNote,
  children,
  className,
  bodyClassName,
  followKey = 0,
}: WorkbenchPanelProps) {
  const t = useMessages()
  /**
   * 面板正文的滚动几何全部在这一层：按行对齐、跟随到底、溢出遮罩。
   *
   * 面板自己**不再**持有正文 ref —— 「滚到底」过去由每个面板各写一遍 `scrollTo`，
   * 那正是顶边切字的来源。现在它们只需要把「内容变了」这件事说成一个变化的原始值。
   */
  const scroll = usePanelScroll<HTMLDivElement>(followKey)

  return (
    <section
      className={cn("sth-panel", "kits-surface", className)}
      data-panel={id}
      data-panel-status={status}
      aria-label={title}
    >
      <header className="sth-panel__head">
        <div className="min-w-0">
          <h2 className="sth-panel__title">{title}</h2>
          {subtitle ? <p className="sth-panel__subtitle">{subtitle}</p> : null}
        </div>
        {aside ? <div className="sth-panel__aside">{aside}</div> : null}
      </header>

      <div
        /*
         * `react-hooks/refs` 在这里报「渲染期访问 ref」。这条诊断是**误报**，理由要说清楚
         * 而不是绕过：`scroll.setNode` 是一个**回调 ref** —— React 只在挂载与卸载时调用它，
         * 渲染期并不读它；被读的 `ref.current` 在 hook 内部，不在渲染路径上。
         * 规则只做了「返回值里含有 ref 写入」的静态追踪，分不出回调 ref 与直接读 `ref.current`。
         * 备选写法（让 hook 自己 `document.querySelector` 找这个元素）能过规则，但那会让
         * hook 依赖「同一文档里只有一个面板正文」这个隐式前提 ——
         * 用一条带解释的豁免换掉一个真实的行为耦合，是更便宜的一边。
         * 豁免只作用于这一行，仓库其余代码不受影响。
         */
        // eslint-disable-next-line react-hooks/refs -- 回调 ref 不是渲染期读 ref，见上
        ref={scroll.setNode}
        className={cn("sth-panel__body", status !== "ready" && "sth-panel__body--centre", bodyClassName)}
      >
        {status === "loading" ? <LoadingState variant="rows" count={3} /> : null}
        {status === "error" ? (
          <ErrorState
            title={t.workbench.panel.error}
            description={errorMessage ?? t.workbench.panel.errorNote}
            onRetry={onRetry}
            retryLabel={t.workbench.panel.errorRetry}
          />
        ) : null}
        {status === "empty" ? (
          <EmptyState
            title={emptyTitle ?? t.workbench.panel.emptyDefault}
            description={emptyNote}
            className="py-4"
          />
        ) : null}
        {status === "ready" ? children : null}
      </div>
    </section>
  )
}
