/**
 * 回放时间轴 —— 把「事实底本（seed）」+「节拍剧本（storyboard）」+「当日事件簿（background）」
 * 合成一条**确定性**的消息序列，并给每条消息钉上因果 ID。
 *
 * ## 这一层是产品自己的状态机的时间轴，不是编排框架
 *
 * 没有 agent framework、没有编排运行时依赖：整条序列由**纯函数**算出，输入是三个静态事实文件，
 * 输出是数组。`factory-policy.json` 的 forbiddenScope 拦的是「产品应用代码里出现编排框架」，
 * 而这里一个运行时库都没有引入 —— 命名上也避开 `orchestrator` 一类词，用 `timeline` / `replay`。
 *
 * ## 排序（确定性的一部分）
 *
 * 排序键是 `(revealedAtMs, orderKey)`，两者都是整数，且**没有并列**：
 *
 *   · `revealedAtMs`：回放时间。当日事件簿的消息是 `-1`（开场已在册），
 *     解说窗口内的消息取剧本的 `T+` 毫秒数；
 *   · `orderKey`：当日事件簿用 `序号 × 10 + 链内位置`（同一时刻内按事实先后排），
 *     剧本节拍用 `1_000_000 + 拍次 × 10 + 拍内位置`（同一时刻内按剧本顺序排）。
 *
 * **`occurredAtMs` 不参与排序**，这是刻意的：第 7 拍记录的那条审计行，事实时间是 16:20:31 ——
 * 比它前几拍的事实时间都早，但它被揭示在第 7 拍。用事实时间排序会把「计划先于动作」这类
 * 顺序不变量排乱；用回放时间排序才能同时保住剧本的顺序与设计稿的时间戳真值。
 *
 * ## 一个必须先说清楚的矛盾：第 15 拍批还是不批
 *
 * 种子 `openItems` 与剧本 `openItems` 都写着「**审批端是异步真人还是脚本代批未定**，需人拍板」，
 * 同时种子给的静帧里：授权卡 a2 仍在待批（SLA 137s 倒计时）、计划第 6 步仍是
 * `blocked / 挂起待授权`，而顶栏 `liveStatus` 已经写着「待人工授权 0 项」。
 * 三者不能同时为「某一时刻」的状态 —— 种子那一帧其实是**拼起来的**。
 *
 * 本层的处理（不替人做决定，但也不假装没有矛盾）：
 *
 *   1. 序列里**有**一条 `approval`（剧本第 15 拍）；没有它，人签署的「人工介入 3」无法由事件聚合出来。
 *   2. 它是一条**普通消息**：真人点击也好、脚本代批也好，都是发这条消息。组件阶段若选择
 *      「等真人点」，就把序列**揭示到第 14 拍为止**，点击后由组件派发这条消息 —— 数据层不关心。
 *   3. 于是第 14 拍之前的计划与卡片状态**逐字等于种子静帧**（p6 blocked / a2 待批），
 *      而 `liveStatus` 那句顶栏文案属于审批之后 —— 这一点写进交接，因为它是一个**待裁决的
 *      数据矛盾**，不是实现细节。
 */

import {
  causalIdOf,
  MESSAGE_KINDS,
  type ActionCode,
  type AgentActor,
  type AlertMessage,
  type AutonomyLevel,
  type CausalId,
  type ComponentId,
  type EvidenceId,
  type IncidentId,
  type IncidentMessage,
  type MessageEnvelope,
  type MessageId,
  type MessageKind,
} from "./contract"
import {
  BACKGROUND_ASSETS,
  backgroundEvidenceId,
  backgroundMessageSlug,
  BACKGROUND_SEVERITIES,
  buildBackgroundClosures,
  type BackgroundClosure,
} from "./background"
import {
  APPROVAL_CARD,
  ASK_S1,
  AUDIT_ROWS,
  AUTO_CARD,
  CARD_A1_ACTION,
  CARD_A2_ACTION,
  FINDING_F1,
  FINDING_F2,
  INCIDENT_ID,
  INCIDENT_START_MS,
  PLAN_STEPS,
  PLAN_REPLAN,
  REPORT,
  SEDIMENT_ITEMS,
  SUPERSEDED_PLAN_STEP,
  TOOL_CALLS,
  clockToMs,
  formatClock,
} from "./seed"
import { TIMED_BEATS, type StoryboardBeat } from "./storyboard"

/* -------------------------------------------------------------------------- */
/* 草稿与排序                                                                  */
/* -------------------------------------------------------------------------- */

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/**
 * 消息去掉**只属于信封**的字段之后的部分（八类消息的判别联合）。
 *
 * 事实来源是契约里的 `MessageEnvelope`：信封上除了判别式 `kind` 与两条由节拍决定的
 * 引用字段（`evidenceRefs` / `affects`）之外，其余都只在拼装时才知道
 * （排序之后才有 `seq` / `id` / `causalId`）。给信封加字段会被这个 `Exclude`
 * 自动收进来 —— 不需要在这里再抄一遍清单，也就不会抄漏。
 */
type EnvelopeOnlyKeys = Exclude<keyof MessageEnvelope, "kind" | "evidenceRefs" | "affects">

export type MessageCore = DistributiveOmit<IncidentMessage, EnvelopeOnlyKeys>

export type Draft = {
  /** 链内局部键：第二遍用它把 `causeKey` 换成真正的 `causeId`。 */
  key: string
  causeKey: string | null
  orderKey: number
  occurredAtMs: number
  revealedAtMs: number
  incidentId: IncidentId
  beatStep: number | null
  core: MessageCore
}

/** 排序：回放时间，然后链内顺序键。**没有并列**，所以排序结果与实现无关。 */
export function compareDrafts(a: Draft, b: Draft): number {
  if (a.revealedAtMs !== b.revealedAtMs) return a.revealedAtMs - b.revealedAtMs
  return a.orderKey - b.orderKey
}

const seqPad = (value: number) => String(value).padStart(3, "0")

function messageId(seq: number, kind: MessageKind): MessageId {
  return `m${seqPad(seq)}-${kind}`
}

/* -------------------------------------------------------------------------- */
/* 当日事件簿（背景）的草稿                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 链内顺序键的两条规则。
 *
 * **剧本节拍用小键、当日事件簿用大键**，于是同一揭示时刻上「剧本的行」先于
 * 「窗口内到达的闭环」——这正是剧本自己的编号顺序（第 3 拍「计划先于动作」在第 4 拍
 * 「顶栏建立底噪」之前，两者都是 `T+1.4s`）。
 * 当日事件簿的开场消息（`revealedAtMs = -1`）不受这条影响：它们靠揭示时刻就排在最前。
 */
function backgroundOrderKey(index: number, position: number): number {
  return 1_000_000 + index * 10 + position
}

function beatOrderKey(step: number, position = 0): number {
  return step * 10 + position
}

const BACKGROUND_AFFECTS: ComponentId[] = ["command-bar"]
const BACKGROUND_CARD_AFFECTS: ComponentId[] = ["command-bar", "authority"]

/**
 * 背景事件簿的三 / 五条消息链：
 *
 *   自主闭环：alert → tool_call → audit_event                    （3 条）
 *   人工介入：alert → action_card → approval → tool_call → audit_event （5 条）
 *
 * **闭环记录不挂证据引用**（`evidenceRefs: []`）—— 与剧本第 4 拍一致：那些行属于
 * 「今日事件簿」，不是本回合的研判卡。它们的出处是**自己那条 alert**（因果父节点，
 * 证据挂在那里），这条链由 `verify.ts` 的 `scanCausalLedger` 逐条检查。
 */
function backgroundDrafts(closure: BackgroundClosure): Draft[] {
  const slug = backgroundMessageSlug(closure.index)
  const evidenceId = backgroundEvidenceId(closure.index)
  const drafts: Draft[] = []
  const base = {
    incidentId: closure.id,
    beatStep: null as number | null,
    revealedAtMs: closure.alertRevealedAtMs,
  }
  const alertKey = `bg-${slug}-alert`

  drafts.push({
    ...base,
    key: alertKey,
    causeKey: null,
    orderKey: backgroundOrderKey(closure.index, 0),
    occurredAtMs: closure.openedAtMs,
    core: {
      kind: "alert",
      actor: "取证 Agent",
      source: closure.evidence.source,
      severity: BACKGROUND_SEVERITIES[closure.index % BACKGROUND_SEVERITIES.length],
      entityRefs: [...closure.evidence.entityRefs],
      claim: null,
      evidenceRefs: [evidenceId],
      affects: BACKGROUND_AFFECTS,
    },
  })

  let toolCauseKey = alertKey
  let position = 1

  if (!closure.autonomous) {
    const cardKey = `bg-${slug}-card`
    drafts.push({
      ...base,
      key: cardKey,
      causeKey: alertKey,
      orderKey: backgroundOrderKey(closure.index, position),
      occurredAtMs: closure.openedAtMs + 1_000,
      core: {
        kind: "action_card",
        actor: "处置 Agent",
        cardId: `${slug}-a1`,
        cardKind: "approval-required",
        actionCode: closure.action,
        title: `${closure.action} · ${closure.id}`,
        autonomy: "L2",
        basis: `证据 ${evidenceId}`,
        impact: `影响面：${closure.asset}`,
        rollback: "基线备份 · 可回退",
        actions: APPROVAL_CARD.actions,
        sla: { ...APPROVAL_CARD.sla },
        evidenceRefs: [evidenceId],
        affects: BACKGROUND_CARD_AFFECTS,
      },
    })
    position += 1

    const approvalKey = `bg-${slug}-approval`
    drafts.push({
      ...base,
      key: approvalKey,
      causeKey: cardKey,
      orderKey: backgroundOrderKey(closure.index, position),
      occurredAtMs: closure.closedAtMs - 2_000,
      core: {
        kind: "approval",
        actor: "人工",
        cardId: `${slug}-a1`,
        decision: "approved",
        evidenceRefs: [evidenceId],
        affects: BACKGROUND_CARD_AFFECTS,
      },
    })
    position += 1
    toolCauseKey = approvalKey
  }

  const toolKey = `bg-${slug}-tool`
  drafts.push({
    ...base,
    key: toolKey,
    causeKey: toolCauseKey,
    orderKey: backgroundOrderKey(closure.index, position),
    occurredAtMs: closure.closedAtMs - 1_000,
    core: {
      kind: "tool_call",
      actor: "处置 Agent",
      actionCode: closure.action,
      auto: closure.autonomous,
      autonomy: closure.autonomous ? "L3" : "L2",
      session: "svc-s1-auto@bastion",
      ...(closure.autonomous
        ? { rollbackWindowMs: AUTO_CARD.rollbackWindowMs }
        : { approvalCardId: `${slug}-a1` }),
      evidenceRefs: [evidenceId],
      affects: BACKGROUND_AFFECTS,
    },
  })
  position += 1

  drafts.push({
    ...base,
    key: `bg-${slug}-audit`,
    causeKey: toolKey,
    orderKey: backgroundOrderKey(closure.index, position),
    occurredAtMs: closure.closedAtMs,
    revealedAtMs: closure.closureRevealedAtMs,
    // 窗口内第一起闭环的揭示时刻正是第 4 拍「顶栏建立底噪」。
    beatStep: closure.revision === "in-window" && closure.index === 129 ? 4 : null,
    core: {
      kind: "audit_event",
      actor: closure.agent,
      scope: "background",
      action: `${closure.action} · ${closure.outcome}`,
      basisRefs: [],
      closure: { outcome: closure.outcome, handlingMs: closure.durationSeconds * 1_000 },
      evidenceRefs: [],
      affects: BACKGROUND_AFFECTS,
    },
  })

  return drafts
}

/* -------------------------------------------------------------------------- */
/* 回合 3 的节拍草稿（前台）                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 节拍的事实时间。
 *
 * 四条审计行取**设计稿真值**（种子 `audit[].at`，逐字）；其余节拍取整数秒形态 ——
 * 剧本自己声明 `T+` 是「回放器自己的节奏」，所以事实时间只给整秒，只有两处例外能推：
 *   · 第 2 拍 = 开场 + 930ms（种子 `findings[1].elapsedMs = 930`）；
 *   · 第 3 拍 = 开场 + 1000ms（种子 `plan.steps[0].detail = "0.9s 前完成"`）。
 */
export const BEAT_FACT_TIMES_MS: Readonly<Record<number, number>> = {
  1: INCIDENT_START_MS + 0,
  2: INCIDENT_START_MS + 930,
  3: INCIDENT_START_MS + 1_000,
  5: INCIDENT_START_MS + 1_800,
  6: INCIDENT_START_MS + 2_400,
  7: clockToMs(AUDIT_ROWS[0].at),
  8: clockToMs(AUDIT_ROWS[1].at),
  9: INCIDENT_START_MS + 10_000,
  10: INCIDENT_START_MS + 12_000,
  11: INCIDENT_START_MS + 16_000,
  12: INCIDENT_START_MS + 19_000,
  13: clockToMs(AUDIT_ROWS[2].at),
  14: INCIDENT_START_MS + 23_000,
  15: INCIDENT_START_MS + 25_000,
  16: INCIDENT_START_MS + 27_000,
  17: clockToMs(AUDIT_ROWS[3].at),
}

export function beatFactTime(step: number): number {
  const value = BEAT_FACT_TIMES_MS[step]
  if (value === undefined) throw new Error(`第 ${step} 拍没有事实时间`)
  return value
}

function beatByStep(step: number): StoryboardBeat {
  const beat = TIMED_BEATS.find((entry) => entry.step === step)
  if (beat === undefined) throw new Error(`剧本里没有第 ${step} 拍`)
  return beat
}

/**
 * 由一拍生成一条草稿。
 *
 * `core` 里必须自带 `evidenceRefs` / `affects`（消息信封的一部分）；缺省用剧本原文，
 * 同一拍发多条消息时由调用方显式覆盖（种子 `toolCalls` 的四条命令就是这样落地的）。
 */
function beatDraft(input: {
  step: number
  key: string
  causeKey: string | null
  core: MessageCore
  position?: number
  occurredAtMs?: number
  evidenceRefs?: readonly EvidenceId[]
  affects?: readonly ComponentId[]
}): Draft {
  const beat = beatByStep(input.step)
  const core = {
    ...input.core,
    evidenceRefs: [...(input.evidenceRefs ?? beat.evidenceRefs)],
    affects: [...(input.affects ?? beat.affects)],
  } as MessageCore

  return {
    key: input.key,
    causeKey: input.causeKey,
    orderKey: beatOrderKey(beat.step, input.position ?? 0),
    occurredAtMs: input.occurredAtMs ?? beatFactTime(beat.step),
    revealedAtMs: beat.offsetMs ?? 0,
    incidentId: INCIDENT_ID,
    beatStep: beat.step,
    core,
  }
}

function toolCallDraft(input: {
  step: number
  position: number
  key: string
  causeKey: string
  actionCode: ActionCode
  auto: boolean
  autonomy: AutonomyLevel
  evidenceRefs: readonly EvidenceId[]
  command?: string
  output?: string
  exitCode?: number
  brief?: string
  session?: string
  rollbackWindowMs?: number
  approvalCardId?: string
  occurredAtMs?: number
}): Draft {
  return beatDraft({
    step: input.step,
    key: input.key,
    causeKey: input.causeKey,
    position: input.position,
    occurredAtMs: input.occurredAtMs,
    evidenceRefs: input.evidenceRefs,
    core: {
      kind: "tool_call",
      actor: "处置 Agent",
      actionCode: input.actionCode,
      auto: input.auto,
      autonomy: input.autonomy,
      ...(input.brief === undefined ? {} : { brief: input.brief }),
      ...(input.session === undefined ? {} : { session: input.session }),
      ...(input.command === undefined ? {} : { command: input.command }),
      ...(input.output === undefined ? {} : { output: input.output }),
      ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
      ...(input.rollbackWindowMs === undefined ? {} : { rollbackWindowMs: input.rollbackWindowMs }),
      ...(input.approvalCardId === undefined ? {} : { approvalCardId: input.approvalCardId }),
      evidenceRefs: [],
      affects: [],
    },
  })
}

function auditRowDraft(input: { rowIndex: number; step: number; key: string; causeKey: string }): Draft {
  const row = AUDIT_ROWS[input.rowIndex]
  return beatDraft({
    step: input.step,
    key: input.key,
    causeKey: input.causeKey,
    core: {
      kind: "audit_event",
      actor: row.actor as AgentActor,
      scope: "incident",
      action: row.action,
      basisRefs: [...row.basisRefs],
      evidenceRefs: [],
      affects: [],
    },
  })
}

/**
 * 回合 3 的 17 拍 → 消息草稿。两处刻意不是「一拍一条消息」：
 *
 *   · 第 4 拍（`T+1.4s`「顶栏建立底噪」）由**当日事件簿窗口内到达的那起闭环**承担 ——
 *     它不产生任何事件面内容，只让计数动；让「跳动」有真实出处，比多一条空转消息好。
 *   · 第 11 / 12 拍各发两条 `tool_call`：种子 `toolCalls` 里那是四条命令
 *     （t2 / t3 / t4 / t5），一条消息塞不下，而「逐行回显」正是这两拍要看的东西。
 */
function foregroundDrafts(): Draft[] {
  const drafts: Draft[] = []

  // 1 · 双源到达（两路粒子，尚未汇合）
  drafts.push(
    beatDraft({
      step: 1,
      key: "fg-1",
      causeKey: null,
      core: {
        kind: "alert",
        actor: "调查 Agent",
        source: "probe",
        alsoFrom: "edr",
        severity: "high",
        entityRefs: ["attacker:0421", "asset:dmz-app01"],
        claim: null,
        evidenceRefs: [],
        affects: [],
      },
    }),
  )

  // 2 · 汇流 · 上下文包成形（种子 findings[1]：conf .93 / elapsedMs 930）
  drafts.push(
    beatDraft({
      step: 2,
      key: "fg-2",
      causeKey: "fg-1",
      core: {
        kind: "context_package",
        actor: "调查 Agent",
        claim: {
          findingId: FINDING_F2.id,
          conclusion: FINDING_F2.conclusion,
          confidence: FINDING_F2.confidence,
          evidenceRefs: [...FINDING_F2.evidenceRefs],
          sources: [...FINDING_F2.sources],
        },
        mergeElapsedMs: FINDING_F2.elapsedMs,
        packageLabel: FINDING_F2.contextPackage,
        mergeLabel: FINDING_F2.mergeLabel,
        evidenceRefs: [],
        affects: [],
      },
    }),
  )

  // 3 · 计划先于动作（整份计划一次出现，前三条已点亮；旧方案此刻仍然在位）
  //
  // p4 / p6 在这里先以 `pending` 出现、状态后置：种子给它们的取值（p4 running、p6 blocked）
  // 是**更晚时刻**的事实，第 9 / 14 拍才分别成立。直接把种子的最终状态铺在第 3 拍，
  // 会让「重规划」「挂起待授权」这两件事在第 3 拍就已经发生 —— 那是把时间轴压平。
  drafts.push(
    beatDraft({
      step: 3,
      key: "fg-3",
      causeKey: "fg-2",
      core: {
        kind: "plan_update",
        actor: "调查 Agent",
        steps: [
          { ...SUPERSEDED_PLAN_STEP, state: "planned" },
          ...PLAN_STEPS.filter((step) => ["p1", "p2", "p3", "p4", "p6", "p7"].includes(step.id)).map(
            (step) =>
              step.id === "p4" || step.id === "p6"
                ? { id: step.id, actor: step.actor, state: "pending" as const, label: step.label }
                : { ...step },
          ),
        ],
        evidenceRefs: [],
        affects: [],
      },
    }),
  )

  // 4 · 顶栏建立底噪 —— 由 background.ts 的窗口内闭环承担（见文件头）

  // 5 · 研判成立 · 结论带置信度与证据（种子 findings[0]：conf .97）
  drafts.push(
    beatDraft({
      step: 5,
      key: "fg-5",
      causeKey: "fg-2",
      core: {
        kind: "alert",
        actor: "调查 Agent",
        source: "edr",
        severity: "high",
        entityRefs: ["file:webshell2.jsp"],
        claim: {
          findingId: FINDING_F1.id,
          conclusion: FINDING_F1.conclusion,
          confidence: FINDING_F1.confidence,
          evidenceRefs: [...FINDING_F1.evidenceRefs],
          sources: [...FINDING_F1.sources],
        },
        evidenceRefs: [],
        affects: [],
      },
    }),
  )

  // 6 · 低风险动作自主执行 · 带后悔药（种子 actionCards[0]：L3 / 回滚 41000ms）
  drafts.push(
    beatDraft({
      step: 6,
      key: "fg-6",
      causeKey: "fg-5",
      core: {
        kind: "action_card",
        actor: "处置 Agent",
        cardId: AUTO_CARD.id,
        cardKind: "auto",
        actionCode: CARD_A1_ACTION,
        title: AUTO_CARD.title,
        autonomy: "L3",
        basis: AUTO_CARD.basis,
        impact: AUTO_CARD.impact,
        rollback: AUTO_CARD.rollback,
        rollbackWindowMs: AUTO_CARD.rollbackWindowMs,
        evidenceRefs: [],
        affects: [],
      },
    }),
  )

  // 7 / 8 / 13 / 17 · 四条留痕（时间戳是设计稿真值）
  drafts.push(auditRowDraft({ rowIndex: 0, step: 7, key: "fg-7", causeKey: "fg-5" }))
  drafts.push(auditRowDraft({ rowIndex: 1, step: 8, key: "fg-8", causeKey: "fg-5" }))

  // 9 · 重规划 · 划掉重写（旧计划行 superseded，新增 p4 / p5）
  drafts.push(
    beatDraft({
      step: 9,
      key: "fg-9",
      causeKey: "fg-8",
      core: {
        kind: "plan_update",
        actor: "调查 Agent",
        steps: PLAN_STEPS.filter((step) => ["p4", "p5"].includes(step.id)).map((step) => ({ ...step })),
        supersedes: { ...SUPERSEDED_PLAN_STEP, state: "planned" },
        replan: { from: PLAN_REPLAN.from, to: PLAN_REPLAN.to },
        evidenceRefs: [],
        affects: [],
      },
    }),
  )

  // 10 · 处置说明卡先于命令（种子 toolCalls[0]：堡垒机托管会话 + 处置说明卡）
  drafts.push(
    toolCallDraft({
      step: 10,
      position: 0,
      key: "fg-10",
      causeKey: "fg-9",
      actionCode: "delete-file-with-backup",
      auto: true,
      autonomy: "L3",
      brief: TOOL_CALLS.t1.brief,
      session: TOOL_CALLS.t1.session,
      rollbackWindowMs: AUTO_CARD.rollbackWindowMs,
      evidenceRefs: beatByStep(10).evidenceRefs,
    }),
  )

  // 11 · 命令流式下发 · 回显（种子 toolCalls[1] / [2]）
  drafts.push(
    toolCallDraft({
      step: 11,
      position: 0,
      key: "fg-11-t2",
      causeKey: "fg-10",
      actionCode: "inspect-file",
      auto: true,
      autonomy: "L3",
      command: TOOL_CALLS.t2.command,
      exitCode: TOOL_CALLS.t2.exitCode,
      session: TOOL_CALLS.t1.session,
      evidenceRefs: beatByStep(11).evidenceRefs,
    }),
  )
  drafts.push(
    toolCallDraft({
      step: 11,
      position: 1,
      key: "fg-11-t3",
      causeKey: "fg-11-t2",
      actionCode: "inspect-file",
      auto: true,
      autonomy: "L3",
      command: TOOL_CALLS.t3.command,
      exitCode: TOOL_CALLS.t3.exitCode,
      session: TOOL_CALLS.t1.session,
      occurredAtMs: beatFactTime(11) + 1_000,
      evidenceRefs: beatByStep(11).evidenceRefs,
    }),
  )

  // 12 · 跨面板因果（rm 落下 → 画布节点碎裂）· 随后复核返回空（种子 toolCalls[3] / [4]）
  drafts.push(
    toolCallDraft({
      step: 12,
      position: 0,
      key: "fg-12-t4",
      causeKey: "fg-11-t3",
      actionCode: "delete-file-with-backup",
      auto: true,
      autonomy: "L3",
      command: TOOL_CALLS.t4.command,
      output: TOOL_CALLS.t4.output,
      exitCode: TOOL_CALLS.t4.exitCode,
      session: TOOL_CALLS.t1.session,
      rollbackWindowMs: AUTO_CARD.rollbackWindowMs,
      evidenceRefs: beatByStep(12).evidenceRefs,
    }),
  )
  drafts.push(
    toolCallDraft({
      step: 12,
      position: 1,
      key: "fg-12-t5",
      causeKey: "fg-12-t4",
      actionCode: "verify-file",
      auto: true,
      autonomy: "L3",
      command: TOOL_CALLS.t5.command,
      output: TOOL_CALLS.t5.output,
      exitCode: TOOL_CALLS.t5.exitCode,
      session: TOOL_CALLS.t1.session,
      occurredAtMs: beatFactTime(12) + 1_000,
      evidenceRefs: beatByStep(12).evidenceRefs,
    }),
  )

  drafts.push(auditRowDraft({ rowIndex: 2, step: 13, key: "fg-13", causeKey: "fg-12-t5" }))

  // 14 · 根因追问 → 需要人拍板（种子 actionCards[1]：五件套 + SLA 137s）
  drafts.push(
    beatDraft({
      step: 14,
      key: "fg-14",
      causeKey: "fg-8",
      core: {
        kind: "action_card",
        actor: "调查 Agent",
        cardId: APPROVAL_CARD.id,
        cardKind: "approval-required",
        actionCode: CARD_A2_ACTION,
        title: APPROVAL_CARD.title,
        autonomy: "L2",
        basis: APPROVAL_CARD.five.basis,
        impact: APPROVAL_CARD.five.impact,
        rollback: APPROVAL_CARD.five.rollback,
        five: { ...APPROVAL_CARD.five },
        actions: APPROVAL_CARD.actions,
        sla: { ...APPROVAL_CARD.sla },
        planStepId: "p6",
        planStep: { ...PLAN_STEPS[5] },
        evidenceRefs: [],
        affects: [],
      },
    }),
  )

  // 15 · 审批往返（裁决本身是一条消息：真人点击与脚本代批都发它，见文件头）
  drafts.push(
    beatDraft({
      step: 15,
      key: "fg-15",
      causeKey: "fg-14",
      core: {
        kind: "approval",
        actor: "人工",
        cardId: APPROVAL_CARD.id,
        decision: "approved",
        evidenceRefs: [],
        affects: [],
      },
    }),
  )

  // 16 · 报告流式生成 + 三条沉淀（种子 sediment / report）
  drafts.push(
    beatDraft({
      step: 16,
      key: "fg-16",
      causeKey: "fg-15",
      core: {
        kind: "sediment",
        actor: "报告 Agent",
        items: SEDIMENT_ITEMS.map((item) => ({ ...item, sourceRefs: [...item.sourceRefs] })),
        reportLines: [...REPORT.lines],
        reportProgressPercent: REPORT.progressPercent,
        evidenceRefs: [],
        affects: [],
      },
    }),
  )

  // 17 · 留痕 + 计数封账（设计稿真值 16:21:00）
  drafts.push(auditRowDraft({ rowIndex: 3, step: 17, key: "fg-17", causeKey: "fg-16" }))

  return drafts
}

/* -------------------------------------------------------------------------- */
/* 合成                                                                        */
/* -------------------------------------------------------------------------- */

function backgroundDraftsAll(): Draft[] {
  return buildBackgroundClosures().flatMap((closure) => backgroundDrafts(closure))
}

/**
 * 合成今天的全量事件序列。纯函数：同样的输入必然得到同样的输出（有测试比对两次调用）。
 */
export function buildIncidentStream(): IncidentMessage[] {
  const drafts: Draft[] = [...backgroundDraftsAll(), ...foregroundDrafts()]
  const ordered = [...drafts].sort(compareDrafts)

  const idByKey = new Map<string, MessageId>()
  ordered.forEach((draft, index) => {
    idByKey.set(draft.key, messageId(index + 1, draft.core.kind))
  })

  const causalById = new Map<MessageId, CausalId>()
  const messages: IncidentMessage[] = []

  ordered.forEach((draft, index) => {
    const id = idByKey.get(draft.key)
    if (id === undefined) throw new Error(`草稿 ${draft.key} 没有 id`)
    const causeId = draft.causeKey === null ? null : idByKey.get(draft.causeKey) ?? null
    if (draft.causeKey !== null && causeId === null) {
      throw new Error(`草稿 ${draft.key} 的因果父节点 ${draft.causeKey} 不在序列里`)
    }
    const parentCausalId = causeId === null ? null : causalById.get(causeId) ?? null
    const causalId = causalIdOf(parentCausalId, id)
    causalById.set(id, causalId)

    messages.push({
      id,
      seq: index + 1,
      incidentId: draft.incidentId,
      beatStep: draft.beatStep,
      occurredAtMs: draft.occurredAtMs,
      occurredAt: formatClock(draft.occurredAtMs),
      revealedAtMs: draft.revealedAtMs,
      causeId,
      causalId,
      ...draft.core,
    } as IncidentMessage)
  })

  return messages
}

/* -------------------------------------------------------------------------- */
/* 第 18 拍：问 S1（按需生成）                                                  */
/* -------------------------------------------------------------------------- */

/** 预置问题（种子 `askS1.presets` 三条 + 占位提示里的那一条）。 */
export const ASK_S1_QUESTIONS = [ASK_S1.placeholder, ...ASK_S1.presets] as const

export type AskS1Answer = {
  question: string
  /** 结论先行的回答（业务记录内容，不翻译）。 */
  conclusion: string
  evidenceRefs: EvidenceId[]
}

/**
 * 三条预置问题的答案 —— **结论先行 + 证据可点开**，每条都挂证据链。
 *
 * 措辞是从种子里读出来的，不是新编的：
 *   · 「现在最大风险是什么？」→ `headerStats.currentEvent`（进行中：1 起高危事件）与
 *     `impactView`（门户 · 1 台应用服 = 活跃后门）；
 *   · 「谁批准的删除操作？」→ `actionCards[0]`（L3 授权策略内 · 已自动执行）：
 *     删除走的是**清单内自主通道**，没有人工批准单 —— 这正是要能答清楚的地方；
 *   · 「如果攻击者换个新 IP 再来一次会怎样？」→ `plan.steps[5]`（修复上传接口 · 需人工授权）
 *     与 `actionCards[1].five.alternative`（不修则 4 回合后仍可再传）。
 */
export const ASK_S1_ANSWERS: readonly AskS1Answer[] = [
  {
    question: ASK_S1.placeholder,
    conclusion:
      "攻击者换个新 IP 仍然进得来：入口是上传接口的扩展名白名单，换 IP 不改变入口；白名单修复正停在待批。",
    evidenceRefs: ["#e-79", "#e-41"],
  },
  {
    question: ASK_S1.presets[0],
    conclusion:
      "当前最大风险是门户那台应用服上的活跃后门（1 台 · 攻击者 #0421 第 3 回合）；保单库与会员账号尚未被触及。",
    evidenceRefs: ["#e-77", "#e-41"],
  },
  {
    question: ASK_S1.presets[1],
    conclusion:
      "删除操作没有人工批准单：它命中 L3 可回滚清单，在策略内自主执行、回滚窗口内可一键撤销，审计时间线有留痕。",
    evidenceRefs: ["#e-79"],
  },
]

/** 按需回答与最后一条已揭示消息之间的回放间隔。 */
export const ASK_S1_REVEAL_OFFSET_MS = 100

/**
 * 生成第 18 拍的一条消息（观众点预置问题时调用）。
 *
 * 它**不在** `buildIncidentStream()` 里：剧本给它的时刻是「任意时刻」。
 * 但它是一条正式消息 —— 有证据引用（所以「不许出现无引用回答」成立）、有因果 ID
 * （根：因为『提问』不是八类消息之一，剧本把这一拍算作 `alert` 的 emits）。
 * 调用方把返回值 append 进序列即可；下一次调用会看到它继续编号。
 */
export function askS1Message(stream: readonly IncidentMessage[], presetIndex: number): AlertMessage {
  const answer = ASK_S1_ANSWERS[presetIndex]
  if (answer === undefined) {
    throw new Error(`问 S1 没有第 ${presetIndex} 个预置问题（共 ${ASK_S1_ANSWERS.length} 个）`)
  }
  const seq = stream.length + 1
  const id = messageId(seq, "alert")
  const lastRevealed = stream.reduce((max, message) => Math.max(max, message.revealedAtMs), 0)
  const occurredAtMs = clockToMs("16:21:00") + ASK_S1_REVEAL_OFFSET_MS

  return {
    id,
    seq,
    kind: "alert",
    incidentId: INCIDENT_ID,
    beatStep: 18,
    occurredAtMs,
    occurredAt: formatClock(occurredAtMs),
    revealedAtMs: lastRevealed + ASK_S1_REVEAL_OFFSET_MS,
    causeId: null,
    causalId: causalIdOf(null, id),
    evidenceRefs: [...answer.evidenceRefs],
    affects: ["ask-s1"],
    actor: "调查 Agent",
    source: "edr",
    severity: "medium",
    entityRefs: [],
    claim: {
      findingId: `ask-${presetIndex}`,
      conclusion: answer.conclusion,
      confidence: 0.95,
      evidenceRefs: [...answer.evidenceRefs],
      sources: ["probe", "edr"],
    },
  }
}

/** 序列的自述：测试与交接都读它，避免数字散落在注释里。 */
export function summarizeStream(stream: readonly IncidentMessage[]): {
  total: number
  byKind: Record<MessageKind, number>
  incidentMessages: number
  dayLedgerMessages: number
  firstOccurredAt: string
  lastOccurredAt: string
} {
  const byKind = {} as Record<MessageKind, number>
  for (const kind of MESSAGE_KINDS) byKind[kind] = 0
  for (const message of stream) byKind[message.kind] += 1

  const occurred = stream.map((message) => message.occurredAtMs)
  return {
    total: stream.length,
    byKind,
    incidentMessages: stream.filter((message) => message.incidentId === INCIDENT_ID).length,
    dayLedgerMessages: stream.filter((message) => message.incidentId !== INCIDENT_ID).length,
    firstOccurredAt: formatClock(Math.min(...occurred)),
    lastOccurredAt: formatClock(Math.max(...occurred)),
  }
}

export { BACKGROUND_ASSETS }
