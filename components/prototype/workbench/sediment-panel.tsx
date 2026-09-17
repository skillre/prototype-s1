"use client"

import { useState } from "react"

import { useMessages } from "@/components/i18n/locale-provider"
import { WorkbenchPanel, type PanelStatus } from "@/components/prototype/workbench/panel"
import type { SedimentItemView } from "@/components/prototype/workbench/view-model"

/**
 * ⑪ 战果与沉淀面板 —— 这一屏要证明的不是「有三条卡片」，而是**这三条带得出去、也带得回来**。
 *
 * ## 为什么导入这条路必须存在
 *
 * 产品承诺是「一次事件 = 全网免疫」。承诺在界面上无法被证伪：三条卡片永远都在，看起来永远
 * 成立。所以这里把它做成一次**可执行的核对** —— 导出物装着条目、计数、裁决记录与事件链；
 * 把它贴回来，`onVerify` 拿它与**此刻的状态**逐条比对，并当场说出差异有几处。判据在数据层
 * （`lib/s1/sediment.ts` 的往返检查），界面只负责把它摆上台面：界面若另写一套「贴回来的和
 * 当前一样吗」，差异就变成两套实现之间的差异，而 `sediment.survives-export` 守的是数据层。
 *
 * ## 为什么剪贴板不是唯一的路
 *
 * `navigator.clipboard` 不是处处可用：非安全上下文里它**根本不存在**，浏览器也随时可以因权限
 * 拒绝它。核对若只能从剪贴板走，这条不变量在被拒绝的机器上就退化成一句无法执行的声明。所以
 * 这里有四条互相独立的出口：**复制**（真写剪贴板，失败就把原因说出来 —— 静默吞掉等于没写）、
 * **下载 JSON**（Blob + 临时 `<a download>`，不经过剪贴板）、**导出文档就地展开**（`<pre>` 与
 * `exportText` 逐字符相同，选中即可带走）、**把当前导出填进导入框**（真按钮，一键往返核对）。
 *
 * ## 为什么导出物里没有墙上时间
 *
 * 导出物带的是**回放游标**（`exportedAtCursorMs` / `exportedAtSeq`），不是 `Date.now()`：同一
 * 状态导出两次得到同一个字符串，「导出再导入、逐条等价」才是一句能复算的话。若导出物盖了
 * 墙上时间，两份导出物永远不可能逐字符相等，那条不变量就只能放宽成「大致相同」—— 而「大致
 * 相同」是没法判红的。下载文件名也照这条规矩走：它由导出物自己的游标派生，不看时钟。
 *
 * ## 一色一义
 *
 * 三种结果只借三个色槽：等价 = 绿（核实通过），不一致 = 琥珀（球在人那边），解析失败 = 红
 * （这是一次真实的失败，不是待办）。条目上的青只说「这是本回合 AI 产出的沉淀」，来源引用用
 * 证据蓝。每个上色元素都带 `data-meaning`，颜色与语义一一对应。
 */

/** 导入框的 DOM id。**模块级常量**：它必须跨渲染稳定（随机 id 会让关联在下一次渲染时断掉）。 */
const IMPORT_TEXTAREA_ID = "s1-sediment-import"

/** 导出文档容器的 DOM id（披露控件的 `aria-controls` 指向它）。同上，必须是常量。 */
const EXPORT_DOCUMENT_ID = "s1-sediment-export"

/** 文件名兜底：解析不出游标时才用它（正常路径永远带游标）。 */
const EXPORT_FILE_BASE = "s1-sediment"

type CopyState = { kind: "copied" } | { kind: "failed"; detail: string }

type VerifyOutcome = {
  kind: "equivalent" | "mismatch" | "parse-failed"
  /** 差异或解析问题的原文（数据层文本，逐字显示，不翻译）。 */
  lines: string[]
}

/** 结果 → 语义槽：**唯一**的一处映射，颜色与 `data-meaning` 由它同源给出，不可能各说各话。 */
const RESULT_MEANING: Record<VerifyOutcome["kind"], "closed" | "waiting" | "attack"> = {
  equivalent: "closed",
  mismatch: "waiting",
  "parse-failed": "attack",
}

type SedimentCopy = ReturnType<typeof useMessages>["workbench"]["sediment"]

export function SedimentPanel({
  status,
  items,
  exportText,
  onVerify,
  errorMessage,
  onRetry,
}: {
  status: PanelStatus
  items: SedimentItemView[]
  /** The exact exported document text for the CURRENT state — already serialized deterministically. */
  exportText: string
  /** Verify a pasted export against the current state. */
  onVerify: (pastedJson: string) => { parseIssues: string[]; diffs: string[] }
  errorMessage?: string | null
  onRetry?: () => void
}) {  const t = useMessages()
  const copy = t.workbench.sediment
  const [pasted, setPasted] = useState("")
  const [exportOpen, setExportOpen] = useState(false)
  /**
   * 裁决与复制结果都**记着自己针对的是哪段文本**：文本一变，对不上的结果自己就不再显示。
   * 一个停在那儿说「导入一致」的旧徽章比没有徽章更坏 —— 它是一句关于另一段文本的真话。
   */
  const [verified, setVerified] = useState<{ of: string; outcome: VerifyOutcome } | null>(null)
  const [copied, setCopied] = useState<{ of: string; state: CopyState } | null>(null)

  const outcome = verified !== null && verified.of === pasted ? verified.outcome : null
  const copyState = copied !== null && copied.of === exportText ? copied.state : null

  /** 复制：真写剪贴板。被拒绝时把原因**显示出来**，不吞。 */
  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(exportText)
      setCopied({ of: exportText, state: { kind: "copied" } })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      setCopied({ of: exportText, state: { kind: "failed", detail } })
    }
  }

  /** 下载：真的落一个文件，且不经过剪贴板（那条路可能整条不存在）。 */
  const downloadExport = () => {
    const url = URL.createObjectURL(new Blob([exportText], { type: "application/json" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = fileNameFor(exportText)
    // 先挂进文档再点：不在文档里的 `a[download]` 在部分浏览器上不触发下载。
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    // 立刻 revoke 会把刚要开始的下载掐掉，所以放到下一个任务里回收这个 object URL。
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  /** 核对：判据来自数据层，界面只把它的回答翻译成三种结果之一。 */
  const verifyImport = () => {
    const verdict = onVerify(pasted)
    if (verdict.parseIssues.length > 0) {
      setVerified({ of: pasted, outcome: { kind: "parse-failed", lines: verdict.parseIssues } })
    } else if (verdict.diffs.length > 0) {
      setVerified({ of: pasted, outcome: { kind: "mismatch", lines: verdict.diffs } })
    } else {
      setVerified({ of: pasted, outcome: { kind: "equivalent", lines: [] } })
    }
  }

  return (
    <WorkbenchPanel
      id="sediment"
      title={copy.title}
      subtitle={copy.subtitle}
      status={status}
      errorMessage={errorMessage}
      onRetry={onRetry}
      emptyTitle={copy.empty}
      emptyNote={copy.emptyNote}
      aside={<span className="s1-panel__subtitle" data-testid="sediment-count" data-count={items.length}>{String(items.length)}</span>}
    >
      <ul className="s1-sed__items" data-testid="sediment-items">
        {items.map((item) => (
          // 左边那道青线与种类 chip 是同一个意思（本回合 AI 产出的沉淀），所以两者都带
          // `data-meaning="ai"`；条目原文是记录内容，不翻译、不裁剪，也不染色。
          <li key={item.id} className="s1-sed__item" data-sediment-id={item.id} data-kind={item.kind} data-meaning="ai">
            <span className="s1-sed__kind" data-meaning="ai">
              {copy.kindLabels[item.kind]}
            </span>
            <p className="s1-sed__label">{item.label}</p>
            <div className="s1-sed__refs">
              <span className="s1-field__name">{`${copy.sourceRefs}：`}</span>
              {item.sourceRefs.map((ref, index) => (
                <code key={`${ref}#${index}`} className="s1-sed__ref" data-meaning="evidence" data-source-ref={ref}>
                  {ref}
                </code>
              ))}
            </div>
          </li>
        ))}
      </ul>

      <section className="s1-sed__block">
        <div className="s1-sed__bar">
          <span className="s1-sed__block-title">{copy.exportAction}</span>
          <button
            type="button"
            className="kits-control s1-sed__action"
            data-testid="sediment-copy"
            onClick={() => void copyExport()}
          >
            {copy.copyAction}
          </button>
          <button type="button" className="kits-control s1-sed__action" data-testid="sediment-download" onClick={downloadExport}>
            {copy.downloadAction}
          </button>
        </div>

        {copyState === null ? null : (
          <p
            className="s1-sed__copy-state"
            data-testid="sediment-copy-result"
            data-copy-result={copyState.kind}
            data-meaning={copyState.kind === "copied" ? "closed" : "waiting"}
          >
            {copyState.kind === "copied" ? t.common.copied : t.toast.clipboardUnavailable}
            {copyState.kind === "failed" ? <code className="s1-sed__detail">{copyState.detail}</code> : null}
          </p>
        )}

        {/* 披露控件：折叠时只看得到「带出去的是什么」，展开才看得到那份文档本身。 */}
        <button
          type="button"
          className="s1-sed__disclosure"
          data-testid="sediment-export-toggle"
          aria-expanded={exportOpen}
          aria-controls={EXPORT_DOCUMENT_ID}
          onClick={() => setExportOpen(!exportOpen)}
        >
          <span aria-hidden="true">{exportOpen ? "▾" : "▸"}</span>
          {copy.exportHint}
        </button>

        {/* 折叠是**视觉**折叠（限高 + 裁切），不是从 DOM 里移走：在没有剪贴板权限的机器上，
            这份文档是唯一能带走的东西，它必须始终在文档里、始终可断言（测试读 textContent，
            与是否展开无关）。 */}
        <pre id={EXPORT_DOCUMENT_ID} className="s1-sed__export-text" data-testid="sediment-export-text" data-export-open={String(exportOpen)}>
          {exportText}
        </pre>

        {/* 这句是导出可复算的**理由**，不是装饰：读者因此知道文件名与内容为什么逐次相同。 */}
        <p className="s1-sed__note">{copy.exportNote}</p>
      </section>

      <section className="s1-sed__block">
        {/* 这句提示本身是按钮：它说的「导出再导入，逐条等价」正是点下去要做的事 —— 把当前
            导出填进导入框，于是往返核对不需要任何剪贴板权限。 */}
        <button
          type="button"
          className="kits-control s1-sed__action s1-sed__fill"
          data-testid="sediment-fill-import"
          data-fill-source="export"
          onClick={() => setPasted(exportText)}
        >
          {copy.roundTripHint}
        </button>

        <textarea
          id={IMPORT_TEXTAREA_ID}
          className="s1-sed__input"
          data-testid="sediment-import-input"
          aria-label={copy.importAction}
          placeholder={copy.importPlaceholder}
          rows={3}
          spellCheck={false}
          value={pasted}
          onChange={(event) => setPasted(event.target.value)}
        />
        <button
          type="button"
          className="kits-control s1-sed__action s1-sed__submit"
          data-testid="sediment-import-verify"
          /* 空文本核不了：禁用的控件是诚实的，静默无反应不是。 */
          disabled={pasted.trim().length === 0}
          onClick={verifyImport}
        >
          {copy.importAction}
        </button>

        {outcome === null ? null : (
          <div
            className="s1-sed__result"
            data-testid="sediment-import-result"
            data-import-result={outcome.kind}
            data-meaning={RESULT_MEANING[outcome.kind]}
          >
            <p className="s1-sed__result-text" data-meaning={RESULT_MEANING[outcome.kind]}>
              {resultTextOf(outcome, copy)}
            </p>
            {outcome.lines.length === 0 ? null : (
              <ul className="s1-sed__diffs" data-testid="sediment-import-diffs">
                {outcome.lines.map((line, index) => (
                  <li key={`${index}-${line}`}>
                    <code>{line}</code>
                  </li>
                ))}              </ul>
            )}
          </div>
        )}
      </section>
    </WorkbenchPanel>
  )
}

/** 三种结果的中文说法（`importFailed` 要带上差异条数，所以是函数）。 */
function resultTextOf(outcome: VerifyOutcome, copy: SedimentCopy): string {
  if (outcome.kind === "equivalent") return copy.importOk
  if (outcome.kind === "mismatch") return copy.importFailed(outcome.lines.length)
  return copy.importParseFailed
}

/**
 * 导出文件名 —— **从导出物自己的游标派生**，不看时钟。
 *
 * `Date.now()` 会让同一状态产生不同的文件名，于是「同一状态导出两次得到同一个东西」先在
 * 文件名上破一次；游标是导出物里本来就有的那个可复算的数。
 */
function fileNameFor(exportText: string): string {
  const cursor = cursorOf(exportText)
  if (cursor === null) return `${EXPORT_FILE_BASE}.json`
  return `${EXPORT_FILE_BASE}-cursor-${cursor.ms}-seq-${cursor.seq}.json`
}

/** 解析游标：拿不到就返回 `null`（文件名有兜底，这里不需要抛）。 */
function cursorOf(exportText: string): { ms: number; seq: number } | null {
  try {
    const parsed: unknown = JSON.parse(exportText)
    if (typeof parsed !== "object" || parsed === null) return null
    const record = parsed as Record<string, unknown>
    const ms = record.exportedAtCursorMs
    const seq = record.exportedAtSeq
    if (typeof ms !== "number" || typeof seq !== "number") return null
    return { ms, seq }
  } catch {
    return null
  }
}
