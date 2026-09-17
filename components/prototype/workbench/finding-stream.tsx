"use client"

import { useState } from "react"

import { useMessages } from "@/components/i18n/locale-provider"
import {
  dataSourceLabelOf,
  evidenceDetailOf,
  typedPrefix,
  FINDING_CHAR_MS,
  type FindingCard,
} from "@/components/prototype/workbench/view-model"
import { WorkbenchPanel, type PanelStatus } from "@/components/prototype/workbench/panel"
import type { EvidenceId } from "@/lib/s1/contract"

/**
 * ③ 研判流 —— 六特征的第三条（证据推理：结论 + 置信度 + 证据 chip）。
 *
 * ## 结论是「打」出来的，不是「跳」出来的
 *
 * 逐字输出由游标派生：可见字数 = `(progressMs − 这条消息被揭示的时刻) / 每字毫秒`。
 * 所以暂停会冻住、倒拖会把字收回去 —— 它没有自己的定时器（这条是硬要求：
 * 动效只表达状态变化，而「AI 正在说」就是一个状态）。
 *
 * ## 证据 chip 点开是真的
 *
 * chip 是一个真按钮：点开后显示那条证据自己的字段（编号 / 种类 / 数据源 / 指向的实体），
 * 全部来自数据层的证据登记簿与实体登记簿。**没有说话不算数的引用**：
 * 卡片上的结论与置信度必然带至少一条 chip（不变量 `evidence.every-claim-cites-a-source`）。
 */
export function FindingStream({
  status,
  cards,
  progressMs,
  revealTimes,
  reducedMotion,
  errorMessage,
  onRetry,
}: {
  status: PanelStatus
  cards: FindingCard[]
  progressMs: number
  revealTimes: ReadonlyMap<number, number>
  reducedMotion: boolean
  errorMessage?: string | null
  onRetry?: () => void
}) {
  const t = useMessages()
  const [openEvidence, setOpenEvidence] = useState<EvidenceId | null>(null)

  return (
    <WorkbenchPanel
      id="finding-stream"
      title={t.workbench.findings.title}
      subtitle={t.workbench.findings.subtitle}
      status={status}
      errorMessage={errorMessage}
      onRetry={onRetry}
      emptyTitle={t.workbench.findings.empty}
      emptyNote={t.workbench.findings.emptyNote}
      /* 流是往下长的，观众的眼睛在底部：条数一变就跟随到底。
         具体怎么滚由 `WorkbenchPanel` 负责（跟随 + 按行对齐，见 `use-panel-scroll.ts`）。 */
      followKey={cards.length}
      aside={<span className="s1-panel__subtitle">{`${cards.length}`}</span>}
    >
      {cards.map((card) => {
        const elapsed = revealedElapsed(progressMs, revealTimes.get(card.seq), reducedMotion)
        const conclusion = typedPrefix(card.conclusion, elapsed, FINDING_CHAR_MS)
        const typing = conclusion.length < card.conclusion.length
        return (
          <article key={card.findingId} className="s1-finding" data-finding-id={card.findingId}>
            <div className="s1-finding__meta">
              <span>
                {card.actor} · {card.occurredAt}
              </span>
              <span data-testid="confidence">{t.workbench.findings.confidence(card.confidencePercent)}</span>
            </div>

            <p className="s1-finding__conclusion" data-testid="conclusion">
              {conclusion}
              {typing ? (
                <span aria-hidden="true" className="s1-typing__caret">
                  ▌
                </span>
              ) : null}
            </p>

            <div className="s1-chips">
              {card.evidenceRefs.map((ref) => (
                <EvidenceChip
                  key={ref}
                  id={ref}
                  open={openEvidence === ref}
                  onToggle={() => setOpenEvidence(openEvidence === ref ? null : ref)}
                />
              ))}
              {card.extraChips.map((chip) => (
                <span key={chip} className="s1-chip s1-chip--muted">
                  {chip}
                </span>
              ))}
            </div>

            {openEvidence !== null && card.evidenceRefs.includes(openEvidence) ? (
              <EvidenceDetailBlock id={openEvidence} />
            ) : null}

            {card.nextStep === null ? null : (
              <p className="s1-fields">
                <span className="s1-field__name">{`${t.workbench.findings.nextStep}：`}</span>
                <span className="s1-field__value">{card.nextStep}</span>
              </p>
            )}

            <div className="s1-chips">
              <span className="s1-field__name">{`${t.workbench.findings.sources}：`}</span>
              {card.sources.map((source) => (
                <span key={source} className="s1-chip s1-chip--muted" data-source={source}>
                  {dataSourceLabelOf(source)}
                </span>
              ))}
            </div>
          </article>
        )
      })}
    </WorkbenchPanel>
  )
}

/** 「已经过去多久」—— reduced-motion 下直接给一个很大的数：文字立刻完整出现（信息不丢）。 */
function revealedElapsed(
  progressMs: number,
  revealAt: number | undefined,
  reducedMotion: boolean,
): number {
  if (reducedMotion) return Number.POSITIVE_INFINITY
  return progressMs - (revealAt ?? 0)
}

/** 证据 chip：真按钮，展开/收起那条证据自己的字段。 */
function EvidenceChip({
  id,
  open,
  onToggle,
}: {
  id: EvidenceId
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className="s1-chip"
      onClick={onToggle}
      aria-expanded={open}
      data-evidence-ref={id}
      data-testid="evidence-chip"
    >
      {`证据${id} ${evidenceDetailOf(id).label}`}
    </button>
  )
}

/** 展开的证据字段（数据源与实体都取登记簿的标签，不编造）。 */
function EvidenceDetailBlock({ id }: { id: EvidenceId }) {
  const detail = evidenceDetailOf(id)
  return (
    <div className="s1-evidence-detail" data-testid="evidence-detail">
      <span className="s1-field__name">{`编号`}</span>
      <span className="s1-field__value">
        <code>{detail.id}</code>
      </span>
      <span className="s1-field__name">{`种类`}</span>
      <span className="s1-field__value">
        <code>{detail.kind}</code>
      </span>
      <span className="s1-field__name">{`来源`}</span>
      <span className="s1-field__value">{detail.sourceLabel}</span>
      <span className="s1-field__name">{`指向`}</span>
      <span className="s1-field__value">{detail.entityLabels.join(" · ")}</span>
    </div>
  )
}

