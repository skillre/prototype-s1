"use client"

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react"

import { useMessages } from "@/components/i18n/locale-provider"
import { AttackGraph } from "@/components/prototype/workbench/attack-graph"
import { AuditTimeline } from "@/components/prototype/workbench/audit-timeline"
import { AuthorityPanel } from "@/components/prototype/workbench/authority-panel"
import { CommandBar, ReplayControl } from "@/components/prototype/workbench/command-bar"
import { DemoEnvironmentLabel } from "@/components/prototype/workbench/demo-environment-label"
import { FindingStream } from "@/components/prototype/workbench/finding-stream"
import { CONSOLE_GEOMETRY, scaleForViewport } from "@/components/prototype/workbench/geometry"
import { PendingPanel, type PanelStatus } from "@/components/prototype/workbench/panel"
import { PlanPanel } from "@/components/prototype/workbench/plan-panel"
import { SedimentPanel } from "@/components/prototype/workbench/sediment-panel"
import { ToolConsole } from "@/components/prototype/workbench/tool-console"
import {
  activeActorOf,
  attackChainOf,
  auditRowsOf,
  authorityCardsOf,
  exportSedimentText,
  findingCards,
  observedAutonomyOf,
  pendingApprovalCount,
  planHeaderOf,
  planProgress,
  planRows,
  replanOf,
  revealedMessages,
  sedimentItemsOf,
  verifySedimentImport,
  workbenchTranscript,
} from "@/components/prototype/workbench/view-model"
import { useMediaQuery } from "@/hooks/use-media-query"
import { useWorkbenchReplay } from "@/hooks/use-workbench-replay"
import { HUMAN_ACTOR, type ApprovalMessage } from "@/lib/s1/contract"
import type { ReplayCursor } from "@/lib/s1/replay"
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
  const scale = useViewportScale()
  // reduced-motion：打字机与逐行回显的降级开关（动效可以丢，信息不能丢）。
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)")

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
  const progress = planProgress(replay.state)
  const replan = replanOf(replay.state)
  const header = planHeaderOf(replay.state)
  const pendingApprovals = pendingApprovalCount(replay.state)
  const cursorMs = replay.frame.cursor.revealedAtMs
  const activeActor = useMemo(() => activeActorOf(revealed), [revealed])
  const observedAutonomy = useMemo(() => observedAutonomyOf(revealed), [revealed])

  /**
   * 人的裁决 —— ⑥ 的三个键按下之后发生的事。
   *
   * 它做的是一件**真事**：往序列里追加一条 `approval` 消息，于是
   *   · 数据层的状态机把卡片从 `pending` 翻到 `approved` / `rejected`；
   *   · 顶栏「待人工授权 N 项」自己变小（那是派生值，没有人去改它）；
   *   · 计划里挂在这一步上的受阻行自己变成完成（`replay.ts` 的 `card.decide` 分支）。
   *
   * 消息的**回放时刻**取"此刻"（`replay.progressMs`），所以它插在当前游标之后 ——
   * 否则它会落在游标之前，按下去什么都不发生，那就成了一个看起来很真的假按钮。
   * 序号取序列末尾 +1；事实时间沿用卡片的锚点时间，不读墙上时钟。
   */
  const decide = useCallback(
    (cardId: string, decision: ApprovalMessage["decision"]) => {
      const events = useIncidentStore.getState().events
      const last = events[events.length - 1]
      if (last === undefined) return
      const anchor = events.find(
        (message) => message.kind === "action_card" && message.cardId === cardId,
      )
      const message: ApprovalMessage = {
        id: `${anchor?.id ?? cardId}-approval-${decision}`,
        seq: last.seq + 1,
        kind: "approval",
        incidentId: anchor?.incidentId ?? last.incidentId,
        beatStep: null,
        occurredAtMs: anchor?.occurredAtMs ?? last.occurredAtMs,
        occurredAt: anchor?.occurredAt ?? last.occurredAt,
        revealedAtMs: Math.max(0, cursorMs),
        causeId: anchor?.id ?? null,
        causalId: anchor?.causalId ?? `${anchor?.id ?? cardId}-approval-${decision}`,
        evidenceRefs: [],
        affects: ["authority", "plan-panel", "command-bar", "audit-timeline"],
        actor: HUMAN_ACTOR,
        cardId,
        decision,
      }
      useIncidentStore.getState().append(message)
    },
    [cursorMs],
  )

  /** ⑪ 的「导入并核对」：把贴回来的 JSON 与**此刻**的状态逐条比对。 */
  const verifySediment = useCallback(
    (pastedJson: string) => verifySedimentImport(pastedJson, replay.state, replay.events),
    [replay.state, replay.events],
  )

  /** ⑧ 的「点一行停在那一帧上」。 */
  const { seekToCursor } = replay
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
            <PendingPanel id="ask-s1" title={t.workbench.pending.askS1} bodyClassName="s1-panel__body--centre" />
          </div>
          <div className="s1-footer__slot s1-footer__slot--report">
            <PendingPanel id="report-stream" title={t.workbench.pending.report} />
          </div>
        </footer>
        {/* 已签署不变量 (a) 层：全场级演示标识，常驻在画布底部，不随游标出现或消失。 */}
        <DemoEnvironmentLabel />
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
