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
/**
 * 证据 chip 走 **Kits 的签名组件** —— 但产品代码 import 的是**角色文件**，不是资产名。
 *
 * 这一行就是决策 13（「让 S1 真的消费证据 chip 签名组件」）在产品侧的落点：
 * `evidence-cite` 是产品选定的语义角色，角色的绑定声明在适配接缝里
 * （`lib/kits/adapters/seam/seam.json` 的 `bindings`：角色 → 本次安装里的资产 id）。
 *
 * 为什么不直接 import 资产名：产品源码里**不得出现 Kits 资产 id** ——
 * 这条不是风格偏好，`kits-seam` 门禁会拿**本次安装**里的资产逐个子串比对，
 * 命中即红（它连注释里的代码跨度也算，因为它认为「写在反引号里的仍是代码」）。
 * 把资产名收进角色文件之后，产品逻辑只认识「证据引用」这个语义角色，
 * 换资产只改角色文件里的一行 re-export。详见 `adapters/evidence-cite.tsx`。
 */
import { EvidenceCite } from "@/lib/kits/adapters/evidence-cite"
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

/**
 * 证据 chip —— **由 Kits 的签名组件渲染**（决策 13：S1 真的消费 `evidence-chip`）。
 *
 * 这一层只做两件属于产品的事：
 *
 *   1. **把产品语义翻成组件的 props**。组件刻意不发明文案（不问证据、不猜类别），
 *      所以「证据」这个类别词来自词典、引用号来自数据层、描述来自证据登记簿 ——
 *      三样都不在组件里硬编码，这正是它作为签名组件的用法。
 *   2. **带上 `data-evidence-ref`**。不变量 `evidence.every-claim-cites-a-source`
 *      的扫描器按这个属性核对「每个引用都能在登记簿里定位到」；
 *      组件不产出它（那是产品的引用语义，不是组件的渲染语义），所以挂在外面这一层。
 */
function EvidenceChip({
  id,
  open,
  onToggle,
}: {
  id: EvidenceId
  open: boolean
  onToggle: () => void
}) {
  const t = useMessages()
  return (
    <span className="s1-chip-slot" data-evidence-ref={id} data-testid="evidence-cite">
      <EvidenceCite
        category={t.workbench.findings.evidenceLabel}
        // 组件负责 `#` 这个引用记号的渲染，所以传引用号本身。
        evidenceId={id.replace(/^#/, "")}
        label={evidenceDetailOf(id).label}
        expanded={open}
        onActivate={() => onToggle()}
      />
    </span>
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

