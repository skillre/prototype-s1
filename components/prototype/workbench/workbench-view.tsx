"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"

import { useMessages } from "@/components/i18n/locale-provider"
import { AskS1 } from "@/components/prototype/workbench/ask-s1"
import { AttackGraph } from "@/components/prototype/workbench/attack-graph"
import { AuditTimeline } from "@/components/prototype/workbench/audit-timeline"
import { AuthorityPanel } from "@/components/prototype/workbench/authority-panel"
import { CommandBar, ReplayControl } from "@/components/prototype/workbench/command-bar"
import { DemoEnvironmentLabel } from "@/components/prototype/workbench/demo-environment-label"
import { FindingStream } from "@/components/prototype/workbench/finding-stream"
import { CONSOLE_GEOMETRY, scaleForViewport } from "@/components/prototype/workbench/geometry"
import type { PanelStatus } from "@/components/prototype/workbench/panel"
import { PipelinePanel } from "@/components/prototype/workbench/pipeline-panel"
import { PlanPanel } from "@/components/prototype/workbench/plan-panel"
import { ReportStream } from "@/components/prototype/workbench/report-stream"
import { RosterPanel } from "@/components/prototype/workbench/roster-panel"
import { SedimentPanel } from "@/components/prototype/workbench/sediment-panel"
import { ToolConsole } from "@/components/prototype/workbench/tool-console"
import {
  activeActorOf,
  askS1AnswersOf,
  attackChainOf,
  auditRowsOf,
  authorityCardsOf,
  exportSedimentText,
  findingCards,
  observedAutonomyOf,
  pendingApprovalCount,
  pipelineOf,
  planHeaderOf,
  planProgress,
  planRows,
  replanOf,
  reportOf,
  revealedMessages,
  rosterOf,
  sedimentItemsOf,
  verifyReportImport,
  verifySedimentImport,
  workbenchTranscript,
} from "@/components/prototype/workbench/view-model"
import { useMediaQuery } from "@/hooks/use-media-query"
import { useWorkbenchReplay } from "@/hooks/use-workbench-replay"
import { HUMAN_ACTOR, type ApprovalMessage } from "@/lib/s1/contract"
import type { ReplayCursor } from "@/lib/s1/replay"
import { askS1Message } from "@/lib/s1/timeline"
import { ON_DEMAND_BEAT } from "@/lib/s1/storyboard"
import { useIncidentStore } from "@/stores/incident-store"

import "./workbench.css"

/**
 * S1 工作台 · 战情室骨架（本批的「骨架」就是这一屏）。
 *
 * ## 这一层只做三件事
 *
 *   1. **装配**：① 顶栏 / 三列 / 底栏，位置与尺寸全部来自 `geometry.ts`（实测值的唯一一份），
 *      面板里放什么由批次决定 —— 本批是 ②③④，其余是**诚实的占位**（`PendingPanel`）。
 *   2. **派生**：把 `useWorkbenchReplay()` 的游标翻译成各面板要看的东西，全部走
 *      `view-model.ts` 的纯函数。骨架自己**不算数**，所以界面上每个数字都能追到一条消息。
 *   3. **scale-to-fit**：`SCALE = Math.min(1, innerWidth/1680, innerHeight/1050)`，
 *      把 1680×1050 的画布等比缩到任意视口 —— 人已签署（见 `geometry.ts`）。
 *
 * ## 为什么派生只在这里做一次
 *
 * `planRows` / `findingCards` / `workbenchTranscript` 都以「游标」为唯一输入，所以它们
 * 可以在这一层一次算好、按 props 分下去；面板里没有第二处 `replayStream`。这也是
 * 「同一个数字在同一屏里只出现一次」这条构图纪律在代码里的形态。
 *
 * ## 观众看得见的三态
 *
 * `loading`（事件流还没装载）/ `empty`（本回合还没走到这一步）/ `error`（派生真的失败）。
 * 三态一律走 Core 的全局组件，面板自己不另造一套视觉。
 */
export function WorkbenchView() {
  const t = useMessages()
  const replay = useWorkbenchReplay()
  /**
   * 「把游标推到某一帧上」—— ⑧ 的审计行与 ⑥ 的裁决共用同一个入口。
   * 在这里解构一次（而不是各处 `replay.seekToCursor`）：它的身份只跟排程走，
   * 所以下面那些 effect 的依赖表里写它就够了。
   */
  const { seekToCursor } = replay
  const scale = useViewportScale()
  // reduced-motion：打字机与逐行回显的降级开关（动效可以丢，信息不能丢）。
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)")
  /** ⑫ 花名册展开面开着没有（局部状态：它是观众按需打开的一格，不参与回放）。 */
  const [rosterOpen, setRosterOpen] = useState(false)

  const revealed = useMemo(
    () => (replay.ready ? revealedMessages(replay.events, replay.cursor) : []),
    [replay.ready, replay.events, replay.cursor],
  )

  const rows = useMemo(() => planRows(replay.state), [replay.state])
  const cards = useMemo(() => findingCards(revealed), [revealed])
  const transcript = useMemo(() => workbenchTranscript(revealed), [revealed])
  const chain = useMemo(() => attackChainOf(replay.state, replay.events), [replay.state, replay.events])
  const approvals = useMemo(
    () => authorityCardsOf(replay.state, t.workbench.authority.actionLabels),
    [replay.state, t.workbench.authority.actionLabels],
  )
  const auditRows = useMemo(
    () => auditRowsOf(replay.state, replay.revealTimes),
    [replay.state, replay.revealTimes],
  )
  const sediment = useMemo(() => sedimentItemsOf(replay.state), [replay.state])
  const sedimentText = useMemo(
    () => (sediment.length === 0 ? "" : exportSedimentText(replay.state, replay.events)),
    [sediment.length, replay.state, replay.events],
  )
  /* ⑩ 管道、⑨ 回答、⑫ 花名册 —— 三块都只吃「已揭示的消息」与状态，全部由游标派生。 */
  const pipeline = useMemo(() => pipelineOf(revealed), [revealed])
  const answers = useMemo(() => askS1AnswersOf(revealed), [revealed])
  const roster = useMemo(
    () => rosterOf(replay.state, revealed, t.workbench.toolConsole.actions),
    [replay.state, revealed, t.workbench.toolConsole.actions],
  )
  /* ⑭ 报告：正文来自第 16 拍那条 `sediment` 消息带进来的 `reportLines`，
     进度由 `progressMs` 与排程给的揭示时刻派生（见 `reportOf`）。 */
  const report = useMemo(
    () => reportOf(revealed, replay.cursor, replay.progressMs, replay.revealTimes),
    [revealed, replay.cursor, replay.progressMs, replay.revealTimes],
  )
  const progress = planProgress(replay.state)
  const replan = replanOf(replay.state)
  const header = planHeaderOf(replay.state)
  const pendingApprovals = pendingApprovalCount(replay.state)
  const activeActor = useMemo(() => activeActorOf(revealed), [revealed])
  const observedAutonomy = useMemo(() => observedAutonomyOf(revealed), [revealed])

  /**
   * 人的裁决 —— ⑥ 的三个键按下之后发生的事。
   *
   * 它做的是一件**真事**：往事件流里插一条 `approval` 消息，于是
   *   · 数据层的状态机把卡片从 `pending` 翻到 `approved` / `rejected`；
   *   · 顶栏「待人工授权 N 项」自己变小（那是派生值，没有人去改它）；
   *   · 计划里挂在这一步上的受阻行自己变成完成（`replay.ts` 的 `card.decide` 分支）。
   *
   * ## 两处都不是随手写的（2026-09-17 实测缺陷 + 两次修正）
   *
   * **一、为什么是「插在当前游标之后」而不是「追加到末尾」。**
   * 已揭示 = **序列的一个前缀**：`revealedMessages` / `replayStream` 遇到第一条没揭示的就
   * `break`。追加在末尾的消息，只有在它前面的每一条都已揭示时才够得着 —— 回放停在半途时
   * 它永远落在游标之外。实测（`?beat=14` 点「批准」）：序列变长、排程变长，
   * **画面一动不动**（卡片仍 `pending`、顶栏仍读「待人工授权 1 项」）。
   *
   * **二、为什么序号带半格（`cursor.seq + 0.5`）。**
   * 剧本第 14 与第 15 拍**共享同一个揭示时刻**（9000ms），这一瞬里排着 4 条消息。
   * 如果人的裁决拿到一个整数序号（例如 `序列末尾 + 1`），那么"已揭示"的比较会连带把
   * **同一时刻、排在它后面的那几条**（其中就有剧本里第 15 拍的代批）一起放进来，
   * 而且它们折叠在我的消息**之后** —— 于是点「驳回」会看到卡片变成 `approved`：
   * 人的决定被剧本覆盖了一次，屏幕上却说不出为什么。
   *
   * 半格序号把这条夹缝留出来：`cursor.seq < 人的裁决 < 下一条`。
   * 于是已揭示的前缀正好是「已经发生的一切 + 刚刚发生的这一件」，
   * 剧本里同一时刻的其余消息与后面的拍都还在后面等着（`tests/s1-batch3.spec.ts` 有断言）。
   * 序号因此不再保证是整数 —— 这是**有意**的：`seq` 在这个模型里是"全序里的一个位置"，
   * 不是"第几条"（`lib/s1/timeline.ts` 生成的剧本序号仍然是 1..412 的稠密整数，
   * 那条不变量没有变，见 `tests/s1-invariants.spec.ts`）。
   *
   * 插完还要把游标推到那一条上 —— 排程要等这一帧被算出来才认识它（见下面的 effect）。
   * 事实时间沿用卡片的锚点时间，不读墙上时钟。
   */
  const pendingDecision = useRef<ReplayCursor | null>(null)
  const decide = useCallback(
    (cardId: string, decision: ApprovalMessage["decision"]) => {
      const events = useIncidentStore.getState().events
      const last = events[events.length - 1]
      if (last === undefined) return
      const cursor = replay.frame.cursor
      const anchor = events.find(
        (message) => message.kind === "action_card" && message.cardId === cardId,
      )
      const seq = cursor.seq + 0.5
      const message: ApprovalMessage = {
        id: `${anchor?.id ?? cardId}-approval-${decision}`,
        seq,
        kind: "approval",
        incidentId: anchor?.incidentId ?? last.incidentId,
        beatStep: null,
        occurredAtMs: anchor?.occurredAtMs ?? last.occurredAtMs,
        occurredAt: anchor?.occurredAt ?? last.occurredAt,
        revealedAtMs: cursor.revealedAtMs,
        causeId: anchor?.id ?? null,
        causalId: anchor?.causalId ?? `${anchor?.id ?? cardId}-approval-${decision}`,
        evidenceRefs: [],
        affects: ["authority", "plan-panel", "command-bar", "audit-timeline"],
        actor: HUMAN_ACTOR,
        cardId,
        decision,
      }
      useIncidentStore.getState().insertAfter(cursor.seq, message)
      pendingDecision.current = { revealedAtMs: cursor.revealedAtMs, seq }
    },
    [replay.frame.cursor],
  )
  useEffect(() => {
    const wanted = pendingDecision.current
    if (wanted === null) return
    pendingDecision.current = null
    /*
     * 推到刚插进去的那一条上。找不到（理论上不会）就什么都不做 ——
     * 静默跳到别处比停在原地更坏：那会把"没找到"伪装成"已经处理过了"。
     */
    seekToCursor(wanted)
  }, [seekToCursor, replay.events])

  /** ⑪ 的「导入并核对」：把贴回来的 JSON 与**此刻**的状态逐条比对。 */
  const verifySediment = useCallback(
    (pastedJson: string) => verifySedimentImport(pastedJson, replay.state, replay.events),
    [replay.state, replay.events],
  )

  /** ⑭ 的「导入并核对」：报告的导出物与此刻的报告**逐行**比对（判据在 view-model）。 */
  const verifyReport = useCallback(
    (pastedJson: string) => verifyReportImport(pastedJson, report.document),
    [report.document],
  )

  /**
   * ⑨ 的提问 —— 真的往序列里追加一条消息（第 18 拍，按需生成）。
   *
   * ## 为什么追加之后必须**把游标推过去**
   *
   * 游标是一个**前缀**（`revealedMessages` 从头开始收，遇到第一条没揭示的就停）。新追加的
   * 消息在序列末尾、揭示时刻比当前帧晚，所以它一定落在游标之后 —— 只 append 不 seek 的话，
   * 观众按下「发送」，屏幕上什么都不会变：那是一个看起来像按钮的假按钮。
   *
   * 顺序不能反：排程还是旧的时候 `frameForBeatRequest` 找不到第 18 拍的帧，按它的规则会
   * 往前夹到第 17 拍 —— 于是又停在了回答之前。所以这里只**记一个待落地的标记**（用 ref，
   * 因为它是"下一步要做的事"而不是要渲染的状态），等排程把新消息算进去之后（`seekBeat`
   * 的依赖就是排程，所以它的身份会变）再跳到第 18 拍。
   */
  const pendingAsk = useRef(false)
  const ask = useCallback((presetIndex: number) => {
    const events = useIncidentStore.getState().events
    useIncidentStore.getState().append(askS1Message(events, presetIndex))
    pendingAsk.current = true
  }, [])
  const { seekBeat } = replay
  useEffect(() => {
    if (!pendingAsk.current) return
    pendingAsk.current = false
    seekBeat(ON_DEMAND_BEAT?.step ?? 18)
  }, [seekBeat, replay.events])

  /** ⑧ 的「点一行停在那一帧上」。 */
  const seekToAuditCursor = useCallback(
    (cursor: ReplayCursor) => seekToCursor(cursor),
    [seekToCursor],
  )

  /**
   * 三态判定：**错误优先**。
   *
   * `error !== null` 时整屏进错误态（不留一半正常一半坏的画面）；装载中一律 loading；
   * 装载完成但这一拍还没到，才是 empty。三者都不是「看起来像空」的同一种东西。
   */
  const statusWith = (hasContent: boolean): PanelStatus => {
    if (replay.error !== null) return "error"
    if (!replay.ready) return "loading"
    return hasContent ? "ready" : "empty"
  }

  const panelError = {
    errorMessage: replay.error,
    onRetry: replay.reload,
  }

  return (
    <div className="s1-viewport" data-testid="workbench" style={canvasVars(scale)}>
      <div className="s1-canvas" data-scale={scale.toFixed(4)}>
        <CommandBar
          counters={replay.counters}
          pendingApproval={pendingApprovals}
          activeActor={activeActor}
          observedAutonomy={observedAutonomy}
          roster={roster}
          rosterOpen={rosterOpen}
          onToggleRoster={() => setRosterOpen((open) => !open)}
        />

        {/* 回放控制条：仪表归仪表。① 是设计稿实测的 76px 读数条，里面没有播放器；
            把播放器塞进它会撑破 1680（实测 1749 对 1640），所以它单独占一条。 */}
        <div className="s1-replaybar">
          <ReplayControl replay={replay} />
        </div>

        <div className="s1-columns">
          <div className="s1-column s1-column--left">
            <div className="s1-slot">
              <AttackGraph
                status={statusWith(chain.nodes.length > 0)}
                chain={chain}
                {...panelError}
              />
            </div>
          </div>

          <div className="s1-column s1-column--middle">
            <div className="s1-slot s1-slot--plan">
              <PlanPanel
                status={statusWith(rows.length > 0)}
                rows={rows}
                progress={progress}
                replan={replan}
                eventId={header.eventId}
                subtitle={t.workbench.plan.subtitle}
                {...panelError}
              />
            </div>

            <div className="s1-slot s1-slot--findings">
              <FindingStream
                status={statusWith(cards.length > 0)}
                cards={cards}
                progressMs={replay.progressMs}
                revealTimes={replay.revealTimes}
                reducedMotion={reducedMotion}
                {...panelError}
              />
            </div>

            <div className="s1-slot s1-slot--console">
              <ToolConsole
                status={statusWith(transcript.length > 0)}
                entries={transcript}
                progressMs={replay.progressMs}
                revealTimes={replay.revealTimes}
                reducedMotion={reducedMotion}
                {...panelError}
              />
            </div>

            {/* ⑩ 在 ④ 之下（设计稿 §二 的中列清单里它是第四块）。
                「这一格到了没有」的判据是**汇流开始没有**：两条进料都还没进管道 = 还没到这一拍。 */}
            <div className="s1-slot s1-slot--pipeline">
              <PipelinePanel
                status={statusWith(
                  pipeline.lanes.some((lane) => lane.messageCount > 0) || pipeline.packageView !== null,
                )}
                view={pipeline}
                {...panelError}
              />
            </div>
          </div>

          <div className="s1-column s1-column--right">
            <div className="s1-slot">
              <AuthorityPanel
                status={statusWith(approvals.length > 0)}
                cards={approvals}
                progressMs={replay.progressMs}
                revealTimes={replay.revealTimes}
                onDecide={decide}
                {...panelError}
              />
            </div>
            <div className="s1-slot">
              <AuditTimeline
                status={statusWith(auditRows.length > 0)}
                rows={auditRows}
                cursorMs={replay.frame.cursor.revealedAtMs}
                onSeek={seekToAuditCursor}
                {...panelError}
              />
            </div>
            <div className="s1-slot">
              <SedimentPanel
                status={statusWith(sediment.length > 0)}
                items={sediment}
                exportText={sedimentText}
                onVerify={verifySediment}
                {...panelError}
              />
            </div>
          </div>
        </div>

        <footer className="s1-footer">
          <div className="s1-footer__slot s1-footer__slot--ask">
            {/*
              ⑨ 永远是 ready：这一格里**问句输入框本身就是内容**，把它放进 empty 态会让
              「还没问过」变成一个不能提问的界面 —— 那正是最坏的一种空态。
              「还没问过」由面板内部的空态说明表达（`AskS1` 的 `empty` / `emptyNote`）。
            */}
            <AskS1 status={statusWith(true)} answers={answers} onAsk={ask} {...panelError} />
          </div>
          <div className="s1-footer__slot s1-footer__slot--report">
            {/* ⑭ 的「到了没有」按**报告那一拍到了没有**判：报告已经存在但一行都还没生成时，
                它是 ready + 进度 0，不是 empty —— 「还没到」与「到了但刚开始」是两件事。 */}
            <ReportStream
              status={statusWith(report.available)}
              view={report}
              onVerify={verifyReport}
              {...panelError}
            />
          </div>
        </footer>
        {/* 已签署不变量 (a) 层：全场级演示标识，常驻在画布底部，不随游标出现或消失。 */}
        <DemoEnvironmentLabel />
        {/* ⑫ 的展开面：绝对定位的浮层，落点在顶栏之下（见 `roster-panel.tsx`）。
            它排在最后，所以盖得住三列 —— 不需要 z-index，DOM 顺序就是层序。 */}
        <RosterPanel
          status={statusWith(roster.total > 0)}
          view={roster}
          open={rosterOpen}
          {...panelError}
        />
      </div>
    </div>
  )
}

/**
 * 骨架尺寸 → CSS 自定义属性。
 *
 * 数字**只来自 `geometry.ts`**（实测值的唯一一份）；这里做的是「把那一份送进样式表」，
 * 不是第二份定义 —— 所以 CSS 里没有一个手抄的 px 骨架值，改设计稿只改 geometry 一处。
 */
function canvasVars(scale: number): CSSProperties {
  const geometry = CONSOLE_GEOMETRY
  return {
    "--s1-canvas-w": `${geometry.canvasWidth}px`,
    "--s1-canvas-h": `${geometry.canvasHeight}px`,
    "--s1-root-pad": `${geometry.rootPadding}px`,
    "--s1-root-gap": `${geometry.rootGap}px`,
    "--s1-header-h": `${geometry.headerHeight}px`,
    "--s1-header-pad": `${geometry.headerPadding}px`,
    "--s1-header-gap": `${geometry.headerGap}px`,
    "--s1-col-left": `${geometry.columnWidths.left}px`,
    "--s1-col-middle": `${geometry.columnWidths.middle}px`,
    "--s1-col-right": `${geometry.columnWidths.right}px`,
    "--s1-col-pad": `${geometry.columnPadding}px`,
    "--s1-footer-h": `${geometry.footerHeight}px`,
    "--s1-footer-pad": `${geometry.footerPadding}px`,
    "--s1-footer-gap": `${geometry.footerGap}px`,
    "--s1-ask-width": `${geometry.askS1Width}px`,
    "--s1-scale": String(scale),
  } as CSSProperties
}

/**
 * scale-to-fit 的观看层。
 *
 * 公式是签过字的那一条（`geometry.ts` 的 `scaleForViewport`），这里只负责在挂载后
 * 量一次、并在 `resize` 时重量一次。SSR 与首帧都用 `1`（画布是固定尺寸，缩放是渐进增强），
 * 所以服务端与客户端的第一帧一致 —— 没有 hydration 差异。
 */
function useViewportScale(): number {
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const apply = () => setScale(scaleForViewport(window.innerWidth, window.innerHeight))
    apply()
    window.addEventListener("resize", apply)
    return () => window.removeEventListener("resize", apply)
  }, [])

  return scale
}
