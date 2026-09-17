"use client"

import { useState, type ReactElement } from "react"

import { useMessages } from "@/components/i18n/locale-provider"
import { WorkbenchPanel, type PanelStatus } from "@/components/prototype/workbench/panel"
import {
  cursorKey,
  evidenceDetailOf,
  type AuditRowView,
} from "@/components/prototype/workbench/view-model"
import { cursorIncludes, type ReplayCursor } from "@/lib/sth/replay"

/**
 * ⑧ 审计时间线 —— 本回合的每一步都留痕，每一行都能把回放停到那一刻。
 *
 * ## 这一面板存在的理由（不变量 `audit.replay-is-faithful` 的界面侧）
 *
 * 它是「这一屏没有演的成分」这句话的可核对版本：**给多少行就画多少行**。不插占位行、
 * 不合并同刻的两行、不因为某行没有证据就把它藏起来。所以观众在时间线上数到的拍数，
 * 与数据层账本里本回合的留痕条数是同一个数 —— 演示里「AI 说它做了三步」与
 * 「时间线上有三行」互相印证，而不是靠讲解。
 *
 * ## 为什么 seek 传的是游标，不是毫秒
 *
 * 行上显示的是**事实时间**（`16:20:31`，设计稿真值），而回放跑在**回放时间**上，
 * 这是两个时钟（种子与剧本各自成立，见 `lib/sth/contract.ts` 里那段说明）。两条留痕
 * 可以共用一个事实时刻，却落在排程的两个不同毫秒上；只传毫秒就无法表达「是这两条里的
 * 哪一条」，点击会落到一个不属于任何一帧的位置上。游标 `{revealedAtMs, seq}` 是二者
 * 的**全序**，所以点击传的是它 —— 同刻的两行因此分得开。
 *
 * 拿不到揭示时刻的行 `cursor === null`：它**不是**按钮（没有死按钮，也不可聚焦），
 * 因为「点了会发生什么」这个问题在这一行上没有答案。这不是缺陷，是排程里真没有它的帧。
 *
 * ## 为什么不写倍速
 *
 * 本构建里没有播放倍速这件事。角标写「可 4× 回放」会是一句界面自己做不到的承诺，
 * 所以这里显示的是 `replaySpeed`（「1× · 播放倍速未实现」）—— 诚实标注优先于好看。
 *
 * ## 为什么「无依据」是一个事实而不是留白
 *
 * 本回合最后一行（`16:21:00` 报告草稿）确实不引用任何证据：它没有可指的证据，
 * 而不是我们忘了画。留白会让观众以为界面漏了东西，写出来才是准确的。
 */

export function AuditTimeline({
  status,
  rows,
  cursorMs,
  onSeek,
  errorMessage,
  onRetry,
}: {
  status: PanelStatus
  rows: AuditRowView[]
  cursorMs: number
  onSeek: (cursor: ReplayCursor) => void
  errorMessage?: string | null
  onRetry?: () => void
}): ReactElement {
  const t = useMessages()
  const fresh = useFreshRowIds(rows)

  return (
    <WorkbenchPanel
      id="audit-timeline"
      title={t.workbench.audit.title}
      status={status}
      errorMessage={errorMessage}
      onRetry={onRetry}
      emptyTitle={t.workbench.audit.empty}
      emptyNote={t.workbench.audit.emptyNote}
      aside={
        <span className="sth-badge" data-testid="audit-badge" title={t.workbench.audit.badgeNote}>
          {t.workbench.audit.badge}
        </span>
      }
    >
      {rows.map((row) => (
        <AuditRow
          key={row.entryId}
          row={row}
          fresh={fresh.has(row.entryId)}
          replayed={isReplayed(cursorMs, row.cursor)}
          onSeek={onSeek}
        />
      ))}

      {/*
       * 读数的位置固定在时间线**下方**：它描述的是整块面板此刻停在哪一帧，
       * 而不是某一行自己的属性 —— 放进行内会让「这是谁的游标」变得含糊。
       */}
      <p className="sth-audit__readout">
        <span data-testid="audit-cursor" data-replay-cursor-ms={cursorMs}>
          <span className="sth-audit__readout-label">{`${t.workbench.audit.cursorLabel} `}</span>
          <code>{cursorMs}</code>
        </span>
        <span className="sth-audit__note">{t.workbench.audit.faithfulNote}</span>
        <span data-testid="audit-faithful-note" className="sth-audit__note">
          {t.workbench.audit.replaySpeed}
        </span>
      </p>
    </WorkbenchPanel>
  )
}

/**
 * 一行留痕。
 *
 * 有游标 = 真按钮（唯一理由是「停在这一帧」）；没有游标 = 普通容器，不可聚焦、
 * 不响应点击。两者共用同一份行内容，所以「能不能点」不会改变这一行读到的东西。
 *
 * 无障碍名由 `aria-label` 给全（动作原文 + 事实时间 + 停在这一帧），因为行内还挂着
 * 主体与证据 chip；只报一串碎片对屏幕阅读器没有用。可见的 `·` 分隔符是装饰，
 * `aria-hidden` 掉，免得被读成标点。
 */
function AuditRow({
  row,
  fresh,
  replayed,
  onSeek,
}: {
  row: AuditRowView
  fresh: boolean
  replayed: boolean
  onSeek: (cursor: ReplayCursor) => void
}): ReactElement {
  const t = useMessages()
  const cursor = row.cursor
  const seekLabel = `${t.workbench.audit.rowSeek} · ${row.at} · ${row.action}`

  const shared = {
    className: "sth-audit__row",
    "data-testid": "audit-row",
    "data-row-seq": row.seq,
    "data-row-entry": row.entryId,
    "data-fresh": fresh ? "true" : "false",
    "data-replayed": replayed ? "true" : "false",
    // 「点这一行会停在哪个游标上」的机器可读形式（`时刻:序号`）。序号不能省：
    // 第 6/7 拍与 14/15 拍共享同一个揭示时刻，只比毫秒分不开那两行。
    "data-replay-cursor-key": cursorKey(cursor),
  }

  const content = (
    <>
      <span className="sth-audit__clock">{row.at}</span>
      <span className="sth-audit__actor">{row.actor}</span>
      <span className="sth-audit__action">
        <span aria-hidden="true" className="sth-audit__sep">{` · `}</span>
        {row.action}
      </span>
      <Basis refs={row.basisRefs} />
    </>
  )

  if (cursor === null) {
    return <div {...shared}>{content}</div>
  }

  return (
    <button
      {...shared}
      type="button"
      aria-label={seekLabel}
      title={seekLabel}
      onClick={() => onSeek(cursor)}
    >
      {content}
    </button>
  )
}

/**
 * 依据列：一条引用一个 chip，没有引用就**写明没有**。
 *
 * chip 本身**不是按钮**：点它在这里没有动作（证据详情在 ③ 研判流里展开），
 * 做成按钮就是一个假控件。id 逐字显示（`#e-41`），登记簿的标签跟在后面 ——
 * 与 ③ 的 chip 同一句措辞，所以同一条证据在两处看起来是同一个东西。
 */
function Basis({ refs }: { refs: readonly string[] }): ReactElement {
  const t = useMessages()

  if (refs.length === 0) {
    return (
      <span className="sth-audit__nobasis" data-testid="audit-no-basis">
        {t.workbench.audit.noBasis}
      </span>
    )
  }

  return (
    <span className="sth-audit__basis">
      {refs.map((ref) => (
        <span
          key={ref}
          className="sth-audit__chip"
          data-meaning="evidence"
          data-evidence-ref={ref}
          data-testid="audit-basis-chip"
        >
          {`证据${ref} ${evidenceDetailOf(ref).label}`}
        </span>
      ))}
    </span>
  )
}

/**
 * 「新长出来的行」—— 只在**真的新来**时给一次进入动效。
 *
 * 判据是 entryId 相对上一帧的差集：倒拖游标会让行消失又回来，那不是「新发生的事」，
 * 所以重放出来的行不会重新播一遍动画（否则每次拖动都像在放烟花，而它想说的
 * 「这一步刚刚发生」也就没人信了）。行清空时把记忆一起清掉，是同一个道理的另一半。
 */
function useFreshRowIds(rows: AuditRowView[]): ReadonlySet<string> {
  const entries = rows.map((row) => row.entryId).join("\u0000")
  const [prev, setPrev] = useState({ key: "", seen: new Set<string>() })

  if (prev.key !== entries) {
    // 在 render 里记住「这一帧见过哪些行」：`useEffect` 要等提交之后，那时动画
    // 已经该开始了；React 支持在 render 期间就地更新 state，它会立刻重渲染而不先提交。
    setPrev({ key: entries, seen: new Set(rows.map((row) => row.entryId)) })
  }

  return new Set(rows.filter((row) => !prev.seen.has(row.entryId)).map((row) => row.entryId))
}

/** 行是否在游标已经走过的那一段里（**只**用于打标记，不参与染色 —— 见 CSS 里那段说明）。 */
function isReplayed(cursorMs: number, cursor: ReplayCursor | null): boolean {
  if (cursor === null) return false
  return cursorIncludes({ revealedAtMs: cursorMs, seq: Number.POSITIVE_INFINITY }, cursor)
}
