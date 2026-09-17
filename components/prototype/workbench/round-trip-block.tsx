"use client"

import { useState } from "react"

import { useMessages } from "@/components/i18n/locale-provider"

/**
 * 导出 → 贴回 → 逐条核对 —— **这一块交互只有这一份实现**。
 *
 * ## 为什么把它抽出来
 *
 * ⑪ 战果与沉淀（`sediment.survives-export`）与 ⑭ 报告流式生成（同一族判据）
 * 要做的是同一件事：把一份**确定性文档**带出去、再拿回来与此刻的状态逐条比对。
 * 两处各写一遍的代价不是多打几百行，而是**两份实现会漂移**：一边收紧了字段封闭性、
 * 另一边没有，于是同一条不变量在两个面板上的强度不同，而屏幕上它们看起来一样。
 *
 * 所以这里只留机制，判据仍然在各自的数据层：
 *   · ⑪ 的 `onVerify` 走 `lib/s1/sediment.ts` 的往返检查；
 *   · ⑭ 的 `onVerify` 走 `view-model.ts` 的 `verifyReportImport`（逐行比对）。
 * 组件本身**不判断"一样不一样"** —— 它只把那个回答翻译成三种结果。
 *
 * ## 为什么剪贴板不是唯一的路
 *
 * `navigator.clipboard` 不是处处可用：非安全上下文里它**根本不存在**，浏览器也随时可以因权限
 * 拒绝它。核对若只能从剪贴板走，这条不变量在被拒绝的机器上就退化成一句无法执行的声明。所以
 * 这里有四条互相独立的出口：**复制**（真写剪贴板，失败就把原因说出来 —— 静默吞掉等于没写）、
 * **下载**（Blob + 临时 `<a download>`，不经过剪贴板）、**导出文档就地展开**
 * （`<pre>` 与传入的文本逐字符相同，选中即可带走）、**把当前导出填进核对框**（真按钮，
 * 一键往返核对，不需要任何权限）。
 *
 * ## 为什么导出物里没有墙上时间
 *
 * 调用方传进来的 `exportText` 由各自的数据层生成，两边都只带**回放游标**，不带 `Date.now()`：
 * 同一状态导出两次得到同一个字符串，「导出再导入、逐条等价」才是一句能复算的话。
 * 下载文件名也照这条规矩走（`fileNameFor`）—— 它由导出物自己的游标派生，不看时钟。
 */

export type RoundTripLabels = {
  exportAction: string
  exportHint: string
  copyAction: string
  downloadAction: string
  importAction: string
  importPlaceholder: string
  importOk: string
  importFailed: (count: number) => string
  importParseFailed: string
  roundTripHint: string
  exportNote: string
}

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

export function RoundTripBlock({
  prefix,
  exportText,
  fileBase,
  documentId,
  textareaId,
  labels,
  onVerify,
}: {
  /** 所有 `data-testid` 的前缀（`${prefix}-copy` / `${prefix}-import-verify` …）。 */
  prefix: string
  /** 当前状态下的导出文本（由调用方保证确定性）。 */
  exportText: string
  /** 下载文件名的基础名（游标会拼在后面）。 */
  fileBase: string
  /** 导出文档容器的 DOM id（披露控件的 `aria-controls` 指向它）。 */
  documentId: string
  /** 导入框的 DOM id（`<label>` 与 `for` 关联）。 */
  textareaId: string
  labels: RoundTripLabels
  /** 把贴回来的文本与此刻的状态逐条比对。判据在调用方那一侧。 */
  onVerify: (pasted: string) => { parseIssues: string[]; diffs: string[] }
}) {
  const t = useMessages()
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
    anchor.download = fileNameFor(exportText, fileBase)
    // 先挂进文档再点：不在文档里的 `a[download]` 在部分浏览器上不触发下载。
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    // 立刻 revoke 会把刚要开始的下载掐掉，所以放到下一个任务里回收这个 object URL。
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  /** 核对：判据来自调用方（数据层），这里只把它的回答翻译成三种结果之一。 */
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
    <>
      <section className="s1-rt__block">
        <div className="s1-rt__bar">
          <span className="s1-rt__block-title">{labels.exportAction}</span>
          <button
            type="button"
            className="kits-control s1-rt__action"
            data-testid={`${prefix}-copy`}
            onClick={() => void copyExport()}
          >
            {labels.copyAction}
          </button>
          <button
            type="button"
            className="kits-control s1-rt__action"
            data-testid={`${prefix}-download`}
            onClick={downloadExport}
          >
            {labels.downloadAction}
          </button>
        </div>

        {copyState === null ? null : (
          <p
            className="s1-rt__copy-state"
            data-testid={`${prefix}-copy-result`}
            data-copy-result={copyState.kind}
            data-meaning={copyState.kind === "copied" ? "closed" : "waiting"}
          >
            {copyState.kind === "copied" ? t.common.copied : t.toast.clipboardUnavailable}
            {copyState.kind === "failed" ? <code className="s1-rt__detail">{copyState.detail}</code> : null}
          </p>
        )}

        {/* 披露控件：折叠时只看得到「带出去的是什么」，展开才看得到那份文档本身。 */}
        <button
          type="button"
          className="s1-rt__disclosure"
          data-testid={`${prefix}-export-toggle`}
          aria-expanded={exportOpen}
          aria-controls={documentId}
          onClick={() => setExportOpen(!exportOpen)}
        >
          <span aria-hidden="true">{exportOpen ? "▾" : "▸"}</span>
          {labels.exportHint}
        </button>

        {/* 折叠是**视觉**折叠（限高 + 裁切），不是从 DOM 里移走：在没有剪贴板权限的机器上，
            这份文档是唯一能带走的东西，它必须始终在文档里、始终可断言（测试读 textContent，
            与是否展开无关）。 */}
        <pre
          id={documentId}
          className="s1-rt__export-text"
          data-testid={`${prefix}-export-text`}
          data-export-open={String(exportOpen)}
        >
          {exportText}
        </pre>

        {/* 这句是导出可复算的**理由**，不是装饰：读者因此知道文件名与内容为什么逐次相同。 */}
        <p className="s1-rt__note">{labels.exportNote}</p>
      </section>

      <section className="s1-rt__block">
        {/* 这句提示本身是按钮：它说的「导出再导入，逐条等价」正是点下去要做的事 —— 把当前
            导出填进导入框，于是往返核对不需要任何剪贴板权限。 */}
        <button
          type="button"
          className="kits-control s1-rt__action s1-rt__fill"
          data-testid={`${prefix}-fill-import`}
          data-fill-source="export"
          onClick={() => setPasted(exportText)}
        >
          {labels.roundTripHint}
        </button>

        <textarea
          id={textareaId}
          className="s1-rt__input"
          data-testid={`${prefix}-import-input`}
          aria-label={labels.importAction}
          placeholder={labels.importPlaceholder}
          rows={3}
          spellCheck={false}
          value={pasted}
          onChange={(event) => setPasted(event.target.value)}
        />
        <button
          type="button"
          className="kits-control s1-rt__action s1-rt__submit"
          data-testid={`${prefix}-import-verify`}
          /* 空文本核不了：禁用的控件是诚实的，静默无反应不是。 */
          disabled={pasted.trim().length === 0}
          onClick={verifyImport}
        >
          {labels.importAction}
        </button>

        {outcome === null ? null : (
          <div
            className="s1-rt__result"
            data-testid={`${prefix}-import-result`}
            data-import-result={outcome.kind}
            data-meaning={RESULT_MEANING[outcome.kind]}
          >
            <p className="s1-rt__result-text" data-meaning={RESULT_MEANING[outcome.kind]}>
              {resultTextOf(outcome, labels)}
            </p>
            {outcome.lines.length === 0 ? null : (
              <ul className="s1-rt__diffs" data-testid={`${prefix}-import-diffs`}>
                {outcome.lines.map((line, index) => (
                  <li key={`${index}-${line}`}>
                    <code>{line}</code>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </>
  )
}

/** 三种结果的中文说法（`importFailed` 要带上差异条数，所以是函数）。 */
function resultTextOf(outcome: VerifyOutcome, labels: RoundTripLabels): string {
  if (outcome.kind === "equivalent") return labels.importOk
  if (outcome.kind === "mismatch") return labels.importFailed(outcome.lines.length)
  return labels.importParseFailed
}

/**
 * 导出文件名 —— **从导出物自己的游标派生**，不看时钟。
 *
 * `Date.now()` 会让同一状态产生不同的文件名，于是「同一状态导出两次得到同一个东西」先在
 * 文件名上破一次；游标是导出物里本来就有的那个可复算的数。
 */
function fileNameFor(exportText: string, fileBase: string): string {
  const cursor = cursorOf(exportText)
  if (cursor === null) return `${fileBase}.json`
  return `${fileBase}-cursor-${cursor.ms}-seq-${cursor.seq}.json`
}

/** 解析游标：拿不到就返回 `null`（文件名有兜底，这里不需要抛）。 */
function cursorOf(exportText: string): { ms: number; seq: number } | null {
  try {
    const parsed: unknown = JSON.parse(exportText)
    if (typeof parsed !== "object" || parsed === null) return null
    const record = parsed as Record<string, unknown>
    const ms = record.exportedAtCursorMs ?? record.cursorMs
    const seq = record.exportedAtSeq ?? record.seq
    if (typeof ms !== "number" || typeof seq !== "number") return null
    return { ms, seq }
  } catch {
    return null
  }
}
