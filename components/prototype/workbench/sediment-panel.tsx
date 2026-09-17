"use client"

import { useMessages } from "@/components/i18n/locale-provider"
import { WorkbenchPanel, type PanelStatus } from "@/components/prototype/workbench/panel"
import { RoundTripBlock } from "@/components/prototype/workbench/round-trip-block"
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
 * ## 往返控件是共享实现
 *
 * 「导出 → 贴回 → 逐条核对」这一块住在 `round-trip-block.tsx` 里，⑭ 报告流式生成用的是
 * **同一个组件**（前缀不同）。抽出来的理由在那份文件的头部：两份实现会漂移，
 * 而漂移之后同一条不变量在两个面板上的强度不同，屏幕上却看不出来。
 *
 * ## 为什么导出物里没有墙上时间
 *
 * 导出物带的是**回放游标**（`exportedAtCursorMs` / `exportedAtSeq`），不是 `Date.now()`：同一
 * 状态导出两次得到同一个字符串，「导出再导入、逐条等价」才是一句能复算的话。若导出物盖了
 * 墙上时间，两份导出物永远不可能逐字符相等，那条不变量就只能放宽成「大致相同」—— 而「大致
 * 相同」是没法判红的。
 *
 * ## 一色一义
 *
 * 三种结果只借三个色槽：等价 = 绿（核实通过），不一致 = 琥珀（球在人那边），解析失败 = 红
 * （这是一次真实的失败，不是待办）。条目上的青只说「这是本回合 AI 产出的沉淀」，来源引用用
 * 证据蓝。每个上色元素都带 `data-meaning`，颜色与语义一一对应。
 */

/** 导入框与导出文档的 DOM id。**模块级常量**：它们必须跨渲染稳定（随机 id 会让关联断掉）。 */
const IMPORT_TEXTAREA_ID = "s1-sediment-import"
const EXPORT_DOCUMENT_ID = "s1-sediment-export"

/** 文件名兜底：解析不出游标时才用它（正常路径永远带游标）。 */
const EXPORT_FILE_BASE = "s1-sediment"

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
}) {
  const t = useMessages()
  const copy = t.workbench.sediment

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

      <RoundTripBlock
        prefix="sediment"
        exportText={exportText}
        fileBase={EXPORT_FILE_BASE}
        documentId={EXPORT_DOCUMENT_ID}
        textareaId={IMPORT_TEXTAREA_ID}
        labels={{
          exportAction: copy.exportAction,
          exportHint: copy.exportHint,
          copyAction: copy.copyAction,
          downloadAction: copy.downloadAction,
          importAction: copy.importAction,
          importPlaceholder: copy.importPlaceholder,
          importOk: copy.importOk,
          importFailed: copy.importFailed,
          importParseFailed: copy.importParseFailed,
          roundTripHint: copy.roundTripHint,
          exportNote: copy.exportNote,
        }}
        onVerify={onVerify}
      />
    </WorkbenchPanel>
  )
}
