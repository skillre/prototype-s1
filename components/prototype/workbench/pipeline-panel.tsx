"use client"

import { useMessages } from "@/components/i18n/locale-provider"
import { WorkbenchPanel, type PanelStatus } from "@/components/prototype/workbench/panel"
import { evidenceDetailOf, type PipelineView } from "@/components/prototype/workbench/view-model"

/**
 * ⑩ E+N 数据汇流 · 上下文管道 —— 中列 ④ 之下（设计稿 §二 的中列清单里它是第四块）。
 *
 * ## 判据：`evidence.counters-derive-from-events` 在管道上的形态
 *
 * 图上**每一个数字都是数出来的**：两路的证据条数、引用这一路的消息条数、汇流耗时、
 * 置信度、消费掉的结论条数 —— 全部来自 `pipelineOf(revealed)`，而那个函数只做一件事：
 * 遍历**已揭示的、本回合自己的**消息并把它们分类计数。这一层里没有任何一个写死的计数，
 * 所以「同一游标两次渲染逐字段相同」是一条平凡的性质，而不是靠纪律维持的巧合。
 *
 * 判据有三条，都能判红（`tests/s1-batch3.spec.ts`）：
 *   1. 纯函数：同一游标两次调用深比较相等；
 *   2. 纯函数：每个数字等于**重新数一遍**的结果（拿界面显示的数去比对界面自己的算法没有意义，
 *      所以对照物是「从事件流另算一遍」，不是「再调用一次同一个函数」）；
 *   3. 浏览器：两个不同游标下 DOM 上的数字不同 —— 一个常量也会满足前两条。
 *
 * ## 常驻免责
 *
 * 「探针只监听不阻断；拦截由 S1 编排防火墙/EDR 执行」是种子 `environment.dataSources`
 * 里 probe 的 `capability` 原文 —— 记录内容，逐字显示，不翻译。它在这一格的位置是刻意的：
 * 管道画的是"数据怎么进来"，而这句话说的是"数据进来之后谁动手"，两件事必须挨着。
 */
export function PipelinePanel({
  status,
  view,
  errorMessage,
  onRetry,
}: {
  status: PanelStatus
  view: PipelineView
  errorMessage?: string | null
  onRetry?: () => void
}) {
  const t = useMessages()
  const copy = t.workbench.pipeline
  /** 常驻免责的出处：探针那一路自己的 `capability`（种子记录内容）。 */
  const disclaimer = view.lanes.find((lane) => lane.capability !== null)?.capability ?? null

  return (
    <WorkbenchPanel
      id="en-pipeline"
      title={copy.title}
      subtitle={copy.subtitle}
      status={status}
      errorMessage={errorMessage}
      onRetry={onRetry}
      emptyTitle={copy.empty}
      emptyNote={copy.emptyNote}
      /* 紧凑头部：标题与副题同一行。中列四块里它的格子最小，而它是一张流程图 ——
         省下的十几像素直接换成正文里多一行可读内容。 */
      className="s1-panel--dense"
      aside={
        <span
          className="s1-panel__subtitle"
          data-testid="pipeline-evidence-total"
          data-total={view.lanes.reduce((sum, lane) => sum + lane.evidenceCount, 0)}
        >
          {String(view.lanes.reduce((sum, lane) => sum + lane.evidenceCount, 0))}
        </span>
      }
    >
      <div className="s1-pipe" data-testid="en-pipeline">
        <ul className="s1-pipe__lanes" data-testid="pipeline-lanes">
          {view.lanes.map((lane) => (
            <li
              key={lane.source}
              className="s1-pipe__lane"
              data-lane={lane.source}
              data-evidence-count={lane.evidenceCount}
              data-message-count={lane.messageCount}
              /* 两路进料都是「数据自己进来了」——用青说"系统在产出"会与 AI 的自主动作混起来，
                 所以这里**不借任何语义色**：它们是数据源，不是判断。 */
            >
              <span className="s1-pipe__lane-label">{lane.label}</span>
              <code className="s1-pipe__lane-detail">{lane.detail}</code>
              <span className="s1-pipe__count" data-testid="pipeline-lane-evidence">
                {copy.laneEvidence(lane.evidenceCount)}
              </span>
              <span className="s1-pipe__count" data-testid="pipeline-lane-messages">
                {copy.laneMessages(lane.messageCount)}
              </span>
              {lane.evidenceRefs.length === 0 ? (
                <span className="s1-pipe__empty">{copy.laneEmpty}</span>
              ) : (
                <span className="s1-pipe__refs">
                  {lane.evidenceRefs.map((ref) => (
                    <button
                      key={ref}
                      type="button"
                      className="s1-chip"
                      /* 点开就是那条证据自己的字段（登记簿）——管道上的引用与 ③⑤⑨ 是同一个东西。 */
                      data-evidence-ref={ref}
                      data-testid="pipeline-evidence-chip"
                      data-meaning="evidence"
                      title={`${copy.packageTitle} · ${evidenceDetailOf(ref).sourceLabel}`}
                    >
                      {`${evidenceDetailOf(ref).label} ${ref}`}
                    </button>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>

        <div className="s1-pipe__merge" aria-hidden="true">
          <span className="s1-pipe__arrow">↓</span>
          <span className="s1-pipe__merge-label">{copy.mergeInto}</span>
        </div>

        {view.packageView === null ? (
          <div className="s1-pipe__package" data-testid="pipeline-package" data-merged="false">
            <span className="s1-pipe__package-title">{copy.packageTitle}</span>
            <span className="s1-pipe__empty">{copy.packageEmpty}</span>
            <span className="s1-pipe__empty">{copy.packageEmptyNote}</span>
          </div>
        ) : (
          <div className="s1-pipe__package" data-testid="pipeline-package" data-merged="true">
            <span className="s1-pipe__package-title">{copy.packageTitle}</span>
            {/* 上下文包自己的标签与汇流标注：种子原文，逐字。 */}
            <code className="s1-pipe__package-label" data-testid="pipeline-package-label">
              {view.packageView.label}
            </code>
            <span className="s1-pipe__merge-note">{view.packageView.mergeLabel}</span>
            <span className="s1-pipe__count" data-testid="pipeline-merge-elapsed">
              {copy.mergeElapsed(view.packageView.mergeElapsedMs)}
            </span>
            <span className="s1-pipe__count" data-testid="pipeline-package-confidence">
              {t.workbench.ask.confidence(view.packageView.confidencePercent)}
            </span>
            <span className="s1-pipe__refs">
              {view.packageView.evidenceRefs.map((ref) => (
                <code key={ref} className="s1-pipe__ref" data-meaning="evidence" data-evidence-ref={ref}>
                  {ref}
                </code>
              ))}
            </span>
          </div>
        )}

        <div className="s1-pipe__consumed" data-testid="pipeline-consumed">
          <span className="s1-pipe__package-title">{copy.consumedTitle}</span>
          {view.consumed.total === 0 ? (
            <span className="s1-pipe__empty">{copy.consumedNone}</span>
          ) : (
            <>
              <span className="s1-pipe__count" data-testid="pipeline-consumed-merged">
                {copy.consumedMerged(view.consumed.merged)}
              </span>
              <span className="s1-pipe__count" data-testid="pipeline-consumed-single">
                {copy.consumedSingle(view.consumed.singleSource)}
              </span>
            </>
          )}
        </div>

        {/* 常驻免责：种子 `environment.dataSources` 的 probe.capability 原文（记录内容）。 */}
        {disclaimer === null ? null : (
          <p className="s1-pipe__disclaimer" data-testid="pipeline-disclaimer">
            <span className="s1-field__name">{`${copy.disclaimerLabel}：`}</span>
            <code>{disclaimer}</code>
          </p>
        )}
      </div>
    </WorkbenchPanel>
  )
}
