"use client"

import { Fragment, type ReactNode } from "react"

import { useMessages } from "@/components/i18n/locale-provider"
import { ScriptedReplayBadge } from "@/components/prototype/workbench/demo-environment-label"
import { WorkbenchPanel, type PanelStatus } from "@/components/prototype/workbench/panel"
import {
  COMMAND_CHAR_MS,
  evidenceLabelsFor,
  typedPrefix,
  visibleOutputLines,
  type BriefEntry,
  type CommandEntry,
  type TranscriptEntry,
} from "@/components/prototype/workbench/view-model"

/**
 * ④ 工具控制台 —— 六特征的第二条（工具调用：真实执行、逐行回显）。
 *
 * ## 这一屏要回答的问题
 *
 * 「AI 说的话，做过没有？」所以这里的每一条命令都**先在处置说明卡之下**出现
 * （依据 / 动作 / 影响 / 回滚四栏都来自数据：说明卡原文来自种子，动作与影响面
 * 来自 `lib/s1/contract.ts` 的动作目录），命令**逐字打出**，回显**逐行返回**。
 *
 * ## 打字机与逐行回显都不是定时器
 *
 * 两者都是 `progressMs` 的纯函数（见 `view-model.ts` 的 `typedPrefix` /
 * `visibleOutputLines`）：暂停会冻住、倒拖游标会把字收回去、跳到某一拍会直接给出
 * 那一拍该有的样子。**没有一个动效有自己的定时器**，所以「界面在动」与
 * 「数据在动」永远是同一件事。
 *
 * `prefers-reduced-motion` 下打字与逐行都被跳过（`elapsed = ∞`），内容立刻完整 ——
 * 降级丢的是动效，不是信息。
 *
 * ## 两条不许破的线
 *
 *   · 命令**不落到真实主机**：本阶段是脚本化回放，所以面板头上常驻组件级角标
 *     （已签署不变量 `boundary.demo-is-labelled-as-demo` 的 (b) 层）。
 *   · 这里**不造一个字**：命令、回显、退出码、会话名都是数据层的事实底本，
 *     界面只做投影与节奏。所以退出码与回显是「返回的」，不是「演的」。
 */

type ConsoleCopy = ReturnType<typeof useMessages>["workbench"]["toolConsole"]

export function ToolConsole({
  status,
  entries,
  progressMs,
  revealTimes,
  reducedMotion,
  errorMessage,
  onRetry,
}: {
  status: PanelStatus
  entries: TranscriptEntry[]
  progressMs: number
  revealTimes: ReadonlyMap<number, number>
  reducedMotion: boolean
  errorMessage?: string | null
  onRetry?: () => void
}) {
  const t = useMessages()
  const copy = t.workbench.toolConsole

  /** 一条消息「已经过去多久」——reduced-motion 下直接给 ∞：内容立刻完整。 */
  const elapsedOf = (seq: number): number => {
    if (reducedMotion) return Number.POSITIVE_INFINITY
    return progressMs - (revealTimes.get(seq) ?? 0)
  }

  const session = entries.find((entry) => entry.session !== null)?.session ?? null
  const disclosure = entries.find((entry) => entry.disclosure !== null)?.disclosure ?? null
  const commandCount = entries.filter((entry) => entry.kind === "command").length

  return (
    <WorkbenchPanel
      id="tool-console"
      title={copy.title}
      aside={
        <>
          <ScriptedReplayBadge />
          {commandCount === 0 ? null : (
            <span className="s1-panel__subtitle" data-testid="console-command-count">
              {String(commandCount)}
            </span>
          )}
        </>
      }
      status={status}
      errorMessage={errorMessage}
      onRetry={onRetry}
      emptyTitle={copy.empty}
      emptyNote={copy.emptyNote}
      /* 控制台是往下长的，观众的眼睛在底部：条数一变就跟随到底。 */
      followKey={entries.length}
    >
      <div className="s1-console__session" data-testid="console-session">
        <code>{session}</code>
        {disclosure === null ? null : (
          <span className="s1-console__brief-source">{disclosure}</span>
        )}
      </div>

      {entries.map((entry) =>
        entry.kind === "brief" ? (
          <BriefCard key={entry.key} entry={entry} copy={copy} />
        ) : (
          <CommandBlock key={entry.key} entry={entry} elapsedMs={elapsedOf(entry.seq)} copy={copy} />
        ),
      )}

      {/* 末行常驻提示符：下一条命令落在哪里。它是结构，不是信息，所以不进无障碍树。 */}
      <span className="s1-console__line" data-testid="console-prompt" aria-hidden="true">
        <pre>$</pre>
      </span>
    </WorkbenchPanel>
  )
}

/**
 * 处置说明卡（每条命令前）。
 *
 * 四栏的顺序由词典的 `briefFieldOrder` 给（设计稿的顺序），值全部有出处：
 * `basis` = 消息自己的证据引用（从证据登记簿解析）；`action` / `impact` = 动作目录的
 * 中文对照与影响面图例；`rollback` = 动作目录的可回滚性与回滚窗口。
 * 卡底那行 `code` 是种子里的说明卡**原文**（记录，不翻译）—— 与上面四栏是两种东西：
 * 四栏是目录语义，原文是当时那句人话。
 */
function BriefCard({ entry, copy }: { entry: BriefEntry; copy: ConsoleCopy }) {
  const evidence = evidenceLabelsFor(entry.evidenceRefs)

  const values: Record<(typeof copy.briefFieldOrder)[number], ReactNode> = {
    basis: evidence.length === 0 ? copy.noBasis : evidence.join(" · "),
    action: copy.actions[entry.actionCode],
    impact: copy.impacts[entry.actionCode],
    rollback: rollbackTextOf(entry, copy),
  }

  return (
    <div
      className="s1-console__brief"
      data-testid="brief-card"
      data-entry-kind="brief"
      data-seq={entry.seq}
      data-action-code={entry.actionCode}
      data-brief-source={entry.source}
      data-auto={String(entry.auto)}
      data-autonomy={entry.autonomy}
    >
      <div className="s1-console__brief-head">
        <span>{copy.briefTitle}</span>
        <span data-testid="brief-channel">
          {entry.auto
            ? copy.autoChannel(entry.autonomy)
            : entry.approvalCardId === null
              ? copy.approvedChannel
              : copy.approvalRequired}
        </span>
      </div>

      <dl className="s1-fields">
        {copy.briefFieldOrder.map((field) => (
          <Fragment key={field}>
            <dt className="s1-field__name">{labelOf(copy, field)}</dt>
            <dd className="s1-field__value" data-brief-field={field}>
              {values[field]}
            </dd>
          </Fragment>
        ))}
      </dl>

      {entry.briefText === null ? null : (
        <div>
          <code data-testid="brief-text">{entry.briefText}</code>
        </div>
      )}

      <span className="s1-console__brief-source">
        {entry.source === "own" ? copy.briefOwnSource : copy.briefSessionSource}
      </span>
    </div>
  )
}

/** 回滚一栏：可回滚性与窗口都来自动作目录（没有窗口就照实说没有）。 */
function rollbackTextOf(entry: BriefEntry, copy: ConsoleCopy): string {
  if (!entry.reversible) return copy.notReversible
  if (entry.rollbackWindowMs === null) return copy.rollbackNoWindow
  return copy.rollbackWindow(String(Math.round(entry.rollbackWindowMs / 1000)))
}

function labelOf(copy: ConsoleCopy, field: (typeof copy.briefFieldOrder)[number]): string {
  switch (field) {
    case "basis":
      return copy.briefBasis
    case "action":
      return copy.briefAction
    case "impact":
      return copy.briefImpact
    default:
      return copy.briefRollback
  }
}

/**
 * 一条命令：逐字打出 → 回显逐行返回 → 退出码。
 *
 * 三个 `data-*` 属性是**可测量的界面**：`data-typed-chars` / `data-echo-lines` 让
 * 「逐字」「逐行」可以被断言，而不是被形容词描述（见 `tests/s1-console.spec.ts`）。
 */
function CommandBlock({
  entry,
  elapsedMs,
  copy,
}: {
  entry: CommandEntry
  elapsedMs: number
  copy: ConsoleCopy
}) {
  const typed = typedPrefix(entry.command, elapsedMs, COMMAND_CHAR_MS)
  const complete = typed.length >= entry.command.length
  // 回显在命令打完**之后**才开始逐行返回。
  const sinceTyped = elapsedMs - entry.command.length * COMMAND_CHAR_MS
  const outputLines = entry.output === null ? [] : entry.output.split("\n")
  const visible = visibleOutputLines(entry.output, sinceTyped)
  const echoFinished = complete && visible.length === outputLines.length
  const showExit = echoFinished && entry.exitCode !== null

  return (
    <div
      className="s1-console__entry"
      data-testid="console-command"
      data-entry-kind="command"
      data-seq={entry.seq}
      data-action-code={entry.actionCode}
      data-typed-chars={typed.length}
      data-command-length={entry.command.length}
      data-echo-lines={visible.length}
      data-echo-total={outputLines.length}
      data-echo-complete={String(echoFinished)}
    >
      <div className="s1-console__line">
        <pre>{typed}</pre>
      </div>

      {visible.length === 0 ? null : (
        <div className="s1-console__output" data-testid="console-output">
          {visible.map((line, index) => (
            <pre key={`${entry.key}-line-${index}`} data-output-line={index}>
              {line}
            </pre>
          ))}
        </div>
      )}

      {showExit ? (
        <span className="s1-console__exit" data-testid="console-exit" data-exit-code={entry.exitCode}>
          {`${copy.exitLabel} ${entry.exitCode}`}
        </span>
      ) : null}
    </div>
  )
}
