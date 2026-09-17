"use client"

import { useMessages } from "@/components/i18n/locale-provider"
import { WorkbenchPanel, type PanelStatus } from "@/components/prototype/workbench/panel"
import { RoundTripBlock } from "@/components/prototype/workbench/round-trip-block"
import { REPORT_DOCUMENT_ID, type ReportView } from "@/components/prototype/workbench/view-model"
import { ENVIRONMENT } from "@/lib/s1/seed"

/**
 * ⑭ 报告流式生成 —— 底栏右（设计稿实测：底栏 130px，⑨ 占 640px，其余归它）。
 *
 * ## 两条判据，两个都能判红
 *
 * 1. **`sediment.survives-export`**：报告能导出，导出物重新解析后**逐行等价**，
 *    差异要能指出是第几行（`verifyReportImport`）。往返控件与 ⑪ 是**同一份实现**
 *    （`round-trip-block.tsx`）—— 两处各写一遍的代价不是多打几百行，而是两份实现会漂移。
 * 2. **`boundary.demo-is-labelled-as-demo`**：整篇**一眼可辨**是演示环境。
 *    所以标识在正文的**第一行**，而且导出物里也带着它（`demo.isDemo` 恒为 `true`）——
 *    报告是会被截图、被转发、被单独拿走的东西，它得自己说得清自己是什么。
 *    落款处再声明一次不算数：读者要读到结尾才知道的事，等于没提前说。
 *
 * ## 为什么进度不是种子里的 68
 *
 * 见 `view-model.ts` 的 `reportOf`：显示值由游标派生（已生成字数 ÷ 总字数），
 * 种子的 68 作为 `data-design-progress` 留在 DOM 上（可断言、不冒充活读数）。
 * 一个写着"流式生成中"却永远停在 68% 的进度条，是一句做不到的承诺。
 *
 * ## 为什么正文与往返控件并排
 *
 * 底栏只有 130px（其中 24px 是内边距），纵向很紧。⑭ 拿到约 960px 宽，所以横向分成两栏：
 * 左栏是报告本身（标识 + 已生成的行），右栏是导出/核对。两栏都在面板正文里滚动。
 */
export function ReportStream({
  status,
  view,
  onVerify,
  errorMessage,
  onRetry,
}: {
  status: PanelStatus
  view: ReportView
  onVerify: (pastedJson: string) => { parseIssues: string[]; diffs: string[] }
  errorMessage?: string | null
  onRetry?: () => void
}) {
  const t = useMessages()
  const copy = t.workbench.report

  return (
    <WorkbenchPanel
      id="report-stream"
      title={copy.heading}
      subtitle={copy.subtitle}
      status={status}
      errorMessage={errorMessage}
      onRetry={onRetry}
      emptyTitle={copy.empty}
      emptyNote={copy.emptyNote}
      className="s1-panel--dense"
      aside={
        /* 两个读数都在面板头上：① 进度（派生）② 已生成几行（派生）。
           它们**不放进报告正文** —— 底栏只有 130px，正文每多一行，报告本身就少看得见一行。
           演示标识与正文必须留在最显眼的位置，chrome 让位（2026-09-17 截图实测之后调整）。 */
        <span className="s1-report__readout">
          <span
            className="s1-panel__subtitle"
            data-testid="report-progress"
            data-percent={view.progressPercent}
            data-design-progress={view.designProgressPercent}
            /* 派生的理由挂在读数上（hover 读得到全文），而不是在正文里占两行。 */
            title={copy.progressNote}
          >
            {copy.progress(view.progressPercent)}
          </span>
          <span className="s1-panel__subtitle" data-testid="report-generated-count">
            {copy.generatedOf(view.generatedLines.length, view.totalLines)}
          </span>
        </span>
      }
    >
      <div className="s1-report">
        <section
          className="s1-report__doc"
          data-testid="report-document"
          data-demo-environment="true"
          /* 演示标识的机器可读形态：屏幕上第一行是人读的那一份，这里是给探针的那一份。 */
          data-isolation={ENVIRONMENT.isolation}
        >
          {/* 一眼可辨，靠的是**正文第一行**：读者不必读到结尾。
              文案逐字取种子 `environment.isolation`（记录内容）—— 它自己就以「演示环境」开头，
              再加一个词典里的前缀会读成「演示环境 演示环境，……」（2026-09-17 截图实拍）。
              与画布底部那条全场标识用的是**同一句话**：同一个东西在整屏里只有一种写法。 */}
          <p className="s1-report__demo" data-testid="report-demo-banner">
            <span aria-hidden="true" className="s1-report__demo-dot" />
            <span>{ENVIRONMENT.isolation}</span>
          </p>

          <ol className="s1-report__lines" data-testid="report-lines">
            {view.generatedLines.map((line, index) => (
              <li key={`${index}-${line}`} className="s1-report__line" data-line-index={index}>
                <span className="s1-report__line-no" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {/* 报告正文是记录内容（含 IP / hash / 引用编号），逐字显示、不翻译。 */}
                <code className="s1-report__line-text">{line}</code>
              </li>
            ))}
          </ol>
        </section>

        <div className="s1-report__actions">
          <RoundTripBlock
            prefix="report"
            exportText={view.text}
            fileBase="s1-report"
            documentId={REPORT_DOCUMENT_ID}
            textareaId="s1-report-import"
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
        </div>
      </div>
    </WorkbenchPanel>
  )
}
