"use client"

import { useState } from "react"

import { useMessages } from "@/components/i18n/locale-provider"
import { WorkbenchPanel, type PanelStatus } from "@/components/prototype/workbench/panel"
import {
  askSthQuestions,
  askSthSubmit,
  dataSourceLabelOf,
  evidenceDetailOf,
  type AskSthAnswerView,
  type AskSthRefusal,
} from "@/components/prototype/workbench/view-model"
import type { EvidenceId } from "@/lib/sth/contract"
import { ASK_STH } from "@/lib/sth/seed"

/**
 * ⑨ 问 STH —— 底栏左（设计稿实测 640px）。
 *
 * ## 判据：`evidence.every-claim-cites-a-source` 在对话上的形态
 *
 * 三条：
 *   1. 每条回答都带证据引用，引用**能在证据登记簿里定位**（chip 点开就是那条证据自己的字段）；
 *   2. 回答还带**出处**：它是事件流里的哪一条消息（`<code>` 里的消息 id），所以"这句话从哪来"
 *      不是一句承诺，是一个可以回头核对的编号；
 *   3. **答不出的问题明说答不出**。输入框里随便打一句「这台机器昨天重启过几次」，
 *      界面不会编一个结论 —— 它会说这句话不在有出处的回答里，并把**答得出来的那几条**列出来。
 *
 * ## 为什么"答不出"是这一格最重要的状态
 *
 * 一个永远答得出来的助手，等于一个永远说"是"的探针。所以拒绝这条路必须和回答那条路
 * 一样好走：拒绝态给出原因（空输入 / 不在有出处的回答里），给出边界（有几条答得出来），
 * 给出机制（回答要么引得出证据，要么不回答）。判据在派生层（`askSthSubmit`），
 * 组件只负责把它显示出来 —— 于是"界面明说答不出"不依赖某段 JSX 里的 `if`。
 *
 * ## 为什么只有三个问题答得出来
 *
 * 因为数据层只写了三条答案（`timeline.ASK_STH_ANSWERS`），每条都从种子的事实底本里读出来。
 * 这不是没做完：**能答的问题数就是有出处的问题数**。给它加第四条的正当理由只有一个 ——
 * 种子里出现了第四条带证据的事实。
 */
export function AskSth({
  status,
  answers,
  onAsk,
  errorMessage,
  onRetry,
}: {
  status: PanelStatus
  /** 已经出现在屏幕上的回答（由游标派生，来自 `askSthAnswersOf`）。 */
  answers: AskSthAnswerView[]
  /** 提问命中一条有出处的答案时调用 —— 由上层把第 18 拍那条消息追加进事件流。 */
  onAsk: (presetIndex: number) => void
  errorMessage?: string | null
  onRetry?: () => void
}) {
  const t = useMessages()
  const copy = t.workbench.ask
  /** 输入框预置设计稿实测的那句话（种子 `askSth.placeholder`，记录内容，不翻译）。 */
  const [question, setQuestion] = useState<string>(ASK_STH.placeholder)
  const [refusal, setRefusal] = useState<{ reason: AskSthRefusal; question: string } | null>(null)
  const [openEvidence, setOpenEvidence] = useState<EvidenceId | null>(null)
  /** 提交一次提问。走派生层的判据，不在组件里另写一套匹配。 */
  const submit = (asked: string) => {
    const outcome = askSthSubmit(asked)
    if (outcome.kind === "answered") {
      setRefusal(null)
      onAsk(outcome.presetIndex)
      return
    }
    setRefusal({ reason: outcome.reason, question: outcome.question })
  }

  const preset = (value: string) => {
    setQuestion(value)
    submit(value)
  }

  return (
    <WorkbenchPanel
      id="ask-sth"
      title={copy.title}
      subtitle={copy.subtitle}
      status={status}
      errorMessage={errorMessage}
      onRetry={onRetry}
      emptyTitle={copy.empty}
      emptyNote={copy.emptyNote}
      aside={
        <span className="sth-panel__subtitle" data-testid="ask-answer-count" data-count={answers.length}>
          {String(answers.length)}
        </span>
      }
      className="sth-ask sth-panel--dense"
    >
      {/* 提问是一条**真的**表单：回车与点「发送」走同一条路径（同一个 submit 处理）。 */}
      <form
        className="sth-ask__form"
        onSubmit={(event) => {
          event.preventDefault()
          submit(question)
        }}
      >
        <input
          className="sth-ask__input"
          type="text"
          value={question}
          aria-label={copy.inputLabel}
          data-testid="ask-input"
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button type="submit" className="kits-control sth-ask__send" data-testid="ask-send">
          {copy.send}
        </button>
        <span className="sth-ask__quick">
          <span className="sth-field__name">{`${copy.quickAsk}：`}</span>
          {ASK_STH.presets.map((preset_) => (
            <button
              key={preset_}
              type="button"
              className="kits-control sth-ask__preset"
              data-testid="ask-preset"
              data-preset={preset_}
              onClick={() => preset(preset_)}
            >
              {preset_}
            </button>
          ))}
        </span>
      </form>

      {/* 答不出：**明说**，并给出边界与机制。它不是错误态 —— 系统没坏，是这句话没有出处。 */}
      {refusal === null ? null : (
        <div className="sth-ask__refusal" data-testid="ask-refusal" data-refusal={refusal.reason}>
          <p className="sth-ask__refusal-title">{copy.refusedTitle}</p>
          <p className="sth-ask__refusal-reason">
            {refusal.reason === "empty" ? copy.refusedEmpty : copy.refusedUnmatched(askSthQuestions().length)}
          </p>
          <p className="sth-ask__refusal-note">{copy.cannotFabricate}</p>
          <span className="sth-ask__quick">
            <span className="sth-field__name">{`${copy.answerableTitle}：`}</span>
            {askSthQuestions().map((value) => (
              <button
                key={value}
                type="button"
                className="kits-control sth-ask__preset"
                data-testid="ask-answerable"
                onClick={() => preset(value)}
              >
                {value}
              </button>
            ))}
          </span>
        </div>
      )}

      {/* 还没问过时的空态说明。它必须留在**面板内部**而不是面板的 empty 态里：
          输入框本身就是这一格的内容，把整格换成空态会让「还没问过」变成一个不能提问的界面。 */}
      {answers.length > 0 || refusal !== null ? null : (
        <p className="sth-ask__empty" data-testid="ask-empty">
          <span className="sth-field__name">{`${copy.empty}：`}</span>
          {copy.emptyNote}
        </p>
      )}

      <ul className="sth-ask__answers" data-testid="ask-answers">
        {answers.map((answer) => (
          <li key={answer.messageId} className="sth-ask__answer" data-answer-seq={answer.seq}>
            <p className="sth-ask__question">{answer.question ?? copy.conclusionLabel}</p>
            <p className="sth-ask__conclusion" data-testid="ask-conclusion">
              {answer.conclusion}
            </p>
            <div className="sth-chips">
              {answer.evidenceRefs.map((ref) => (
                <button
                  key={ref}
                  type="button"
                  className="sth-chip"
                  onClick={() => setOpenEvidence(openEvidence === ref ? null : ref)}
                  aria-expanded={openEvidence === ref}
                  data-evidence-ref={ref}
                  data-testid="ask-evidence-chip"
                  data-meaning="evidence"
                >
                  {`${copy.evidenceLabel}${ref} ${evidenceDetailOf(ref).label}`}
                </button>
              ))}
              <span className="sth-chip sth-chip--muted">{copy.confidence(answer.confidencePercent)}</span>
              {answer.sources.map((source) => (
                <span key={source} className="sth-chip sth-chip--muted" data-source={source}>
                  {dataSourceLabelOf(source)}
                </span>
              ))}
            </div>

            {openEvidence === null || !answer.evidenceRefs.includes(openEvidence) ? null : (
              <EvidenceDetailBlock id={openEvidence} />
            )}

            {/* 出处：这条回答是事件流里的哪一条消息 —— 编号放在 `<code>` 里，可复制、可回查。 */}
            <p className="sth-ask__origin">
              <span className="sth-field__name">{`${copy.sourceTitle}：`}</span>
              <code data-testid="ask-origin">{answer.messageId}</code>
              <span className="sth-field__name">{answer.occurredAt}</span>
            </p>
          </li>
        ))}
      </ul>
    </WorkbenchPanel>
  )
}

/** 展开的证据字段（与 ③ 的写法一致：四个字段全部来自登记簿，一个字都不编）。 */
function EvidenceDetailBlock({ id }: { id: EvidenceId }) {
  const detail = evidenceDetailOf(id)
  return (
    <div className="sth-evidence-detail" data-testid="ask-evidence-detail">
      <span className="sth-field__name">{`编号`}</span>
      <span className="sth-field__value">
        <code>{detail.id}</code>
      </span>
      <span className="sth-field__name">{`来源`}</span>
      <span className="sth-field__value">{detail.sourceLabel}</span>
      <span className="sth-field__name">{`指向`}</span>
      <span className="sth-field__value">{detail.entityLabels.join(" · ") || "—"}</span>
    </div>
  )
}
