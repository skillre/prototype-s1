"use client"


import { useMessages } from "@/components/i18n/locale-provider"
import { WorkbenchPanel, type PanelStatus } from "@/components/prototype/workbench/panel"
import type { PlanRow } from "@/components/prototype/workbench/view-model"
import type { PlanStepState } from "@/lib/s1/contract"

/**
 * ② 任务计划面板 —— 六特征的第一条（自主规划，含**重规划划掉重写**）。
 *
 * ## 一个状态、一种画法（一色一义）
 *
 *   done       ✓  绿       已闭环
 *   running    ●  青（呼吸）AI 正在跑（全景唯一的循环动效；reduced-motion 下是实心点 + 文字）
 *   blocked    !  琥珀     球在你那边（挂起待授权）
 *   replanned  ＋ 青       AI 临场改了方案（新落位的行有一次 4px 入场）
 *   superseded ×  次墨     **被划掉的那一行**：横线由状态属性驱动，倒拖游标会把线收回去
 *   pending    ·  次墨     还没轮到
 *
 * ## 为什么每一行都有文字状态
 *
 * 因为「呼吸点」在 `prefers-reduced-motion` 下必须关掉（前庭敏感），
 * 而关掉之后信息不能丢 —— 所以状态词始终以文字形式在行里，点只是加重。
 * 这是 pack 的 motion[] 里写明的降级方式：「状态点的实心填充 + 文字状态词」。
 */
export function PlanPanel({
  status,
  rows,
  progress,
  replan,
  eventId,
  subtitle,
  errorMessage,
  onRetry,
}: {
  status: PanelStatus
  rows: PlanRow[]
  progress: { done: number; total: number }
  replan: { from: string; to: string } | null
  eventId: string
  subtitle: string
  errorMessage?: string | null
  onRetry?: () => void
}) {
  const t = useMessages()

  return (
    <WorkbenchPanel
      id="plan-panel"
      title={`${t.workbench.plan.title} ${eventId}`}
      subtitle={subtitle}
      status={status}
      errorMessage={errorMessage}
      onRetry={onRetry}
      emptyTitle={t.workbench.plan.empty}
      emptyNote={t.workbench.plan.emptyNote}
      /* 行的数量一变就跟随到底（「清单在滚动」这句话的物理形态）。
         `progressMs` 每帧都在变，所以跟随的判据只能是行数，不能是它。 */
      followKey={rows.length}
      aside={
        rows.length > 0 ? (
          <span className="s1-panel__subtitle">{t.workbench.plan.progress(progress.done, progress.total)}</span>
        ) : null
      }
    >
      <div className="s1-plan" data-testid="plan-list">
        {rows.map((row) => (
          <div
            key={row.id}
            className="s1-plan__row"
            data-step-id={row.id}
            data-step-state={row.state}
            data-struck={row.struck ? "true" : "false"}
            data-fresh={row.state === "replanned" ? "true" : "false"}
          >
            <span className="s1-plan__mark" aria-hidden="true">
              {markOf(row.state)}
            </span>
            <span className="s1-plan__label" data-testid="plan-step-label">
              {row.label}
            </span>
            <span className="s1-plan__meta">
              {row.detail === null ? null : <span>{row.detail}</span>}
              <span className="s1-plan__state" data-testid="plan-step-state">
                {stateWordOf(t.workbench.plan, row.state)}
              </span>
              <span>{row.actor}</span>
            </span>
          </div>
        ))}

        {replan === null ? null : (
          <p className="s1-plan__note" data-testid="replan-note">
            <span className="s1-field__name">{`${t.workbench.plan.replanLabel}：`}</span>
            <span>{t.workbench.plan.replanNote(replan.from, replan.to)}</span>
          </p>
        )}
      </div>
    </WorkbenchPanel>
  )
}

/** 行首的记号。呼吸点由 CSS 在 `prefers-reduced-motion: no-preference` 下才呼吸。 */
function markOf(state: PlanStepState): string | React.ReactElement {
  switch (state) {
    case "done":
      return "✓"
    case "running":
      return <span className="s1-dot s1-dot--breathing" />
    case "blocked":
      return "!"
    case "replanned":
      return "+"
    case "superseded":
      return "×"
    default:
      return "·"
  }
}

type PlanCopy = {
  stateDone: string
  stateRunning: string
  stateBlocked: string
  stateReplanned: string
  stateSuperseded: string
  statePending: string
}

function stateWordOf(copy: PlanCopy, state: PlanStepState): string {
  switch (state) {
    case "done":
      return copy.stateDone
    case "running":
      return copy.stateRunning
    case "blocked":
      return copy.stateBlocked
    case "replanned":
      return copy.stateReplanned
    case "superseded":
      return copy.stateSuperseded
    default:
      return copy.statePending
  }
}
