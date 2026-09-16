/**
 * 审计账本 —— 全量留痕，以及「从审计序列重放」。
 *
 * ## 为什么账本条目要长这样
 *
 * 不变量 `audit.replay-is-faithful` 的判红方式是「一次直放、一次从审计序列重放，深比较三棵状态树」。
 * 这条要求反过来决定了审计记录的形态：**一串日志字符串做不到**。一条账本条目必须自带
 *
 *   · **因果 ID**（`causalId` / `causeId` / 父消息 id）—— 回答「这条留痕是谁触发的」；
 *   · **证据指针**（`evidenceRefs` / 事件 id / 消息 id）—— 回答「它凭什么」；
 *   · **结构化效果**（`effects`）—— 回答「它把状态改成了什么样」。
 *
 * 有了这三样，`replayFromAudit` 才能和直放**共用同一个归约器**（`replay.ts` 的
 * `applyReplayStep`），而不是另写一套「大概等价」的重放逻辑。
 *
 * ## 账本与时间线不是一回事
 *
 * 账本 = 每一条消息一行（本场 412 行）。⑧ 审计时间线 = 账本里 `kind === "audit_event"`
 * 且 `scope === "incident"` 的那 4 行（设计稿真值 16:20:31 / :38 / :52 / 16:21:00）。
 * 当日事件簿的 130 起闭环也在账本里 —— 它们是顶栏计数的出处。
 */

import {
  causalChainOf,
  type ActorRef,
  type CausalId,
  type EvidenceId,
  type IncidentId,
  type IncidentMessage,
  type MessageId,
  type MessageKind,
} from "./contract"
import { countersFromInputs, counterInputOf, type CounterInput, type CounterSnapshot } from "./counters"
import { INCIDENT_ID } from "./seed"
import {
  applyReplayStep,
  cursorIncludes,
  effectsOf,
  emptyIncidentState,
  type IncidentState,
  type ReplayCursor,
  type StateEffect,
} from "./replay"

export type AuditLedgerEntry = {
  entryId: string
  seq: number
  messageId: MessageId
  kind: MessageKind
  incidentId: IncidentId
  beatStep: number | null
  /** 记账的人/Agent（⑧ 时间线左边那一列）。 */
  actor: ActorRef
  /** 业务记录里的动作描述（回合 3 的四行逐字来自种子 `audit[].action`）。 */
  action: string
  scope: "incident" | "background"
  occurredAtMs: number
  occurredAt: string
  revealedAtMs: number
  causeId: MessageId | null
  causalId: CausalId
  evidenceRefs: EvidenceId[]
  effects: StateEffect[]
  counter: CounterInput | null
}

/**
 * 一条消息 → 一条账本条目。
 *
 * **每一条消息都留下痕迹**（含不改变状态的那些）：留痕的完整性不能靠「哪些值得记」
 * 这种判断 —— 那个判断一旦写错，少掉的正是一条事后最需要的记录。
 */
export function auditEntryOf(message: IncidentMessage): AuditLedgerEntry {
  return {
    entryId: `a${String(message.seq).padStart(3, "0")}`,
    seq: message.seq,
    messageId: message.id,
    kind: message.kind,
    incidentId: message.incidentId,
    beatStep: message.beatStep,
    actor: actorOf(message),
    action: actionOf(message),
    scope:
      message.kind === "audit_event"
        ? message.scope
        : message.incidentId === INCIDENT_ID
          ? "incident"
          : "background",
    occurredAtMs: message.occurredAtMs,
    occurredAt: message.occurredAt,
    revealedAtMs: message.revealedAtMs,
    causeId: message.causeId,
    causalId: message.causalId,
    evidenceRefs: [...message.evidenceRefs],
    effects: effectsOf(message),
    counter: counterInputOf(message),
  }
}

/** 八类消息都带 `actor`（契约里 `approval` 的 actor 只能是「人工」）。 */
function actorOf(message: IncidentMessage): ActorRef {
  return message.actor
}

function actionOf(message: IncidentMessage): string {
  switch (message.kind) {
    case "alert":
      return message.claim === null
        ? `告警到达 · ${message.severity}`
        : `结论成立 · conf ${message.claim.confidence}`
    case "context_package":
      return `上下文汇流 · conf ${message.claim.confidence}`
    case "plan_update":
      return message.replan === undefined
        ? `计划更新 · ${message.steps.map((step) => step.id).join("/")}`
        : `重规划 · ${message.replan.to}`
    case "tool_call":
      return message.command === undefined
        ? `工具动作 · ${message.actionCode}`
        : `执行 ${message.command}`
    case "action_card":
      return message.cardKind === "auto"
        ? `免授权通道卡 · ${message.title}`
        : `授权卡待批 · ${message.title}`
    case "approval":
      return `人工裁决 · ${message.decision} · ${message.cardId}`
    case "audit_event":
      return message.action
    case "sediment":
      return `沉淀入库 · ${message.items.map((item) => item.id).join("/")}`
  }
}

export function buildAuditLedger(events: readonly IncidentMessage[]): AuditLedgerEntry[] {
  return events.map((message) => auditEntryOf(message))
}

/**
 * 从审计序列重放 —— **与 `replayStream` 同一条代码路径**。
 *
 * 这一点是刻意的：如果这里另写一套「读日志再猜状态」的逻辑，两条路径的差异
 * 就变成了两套实现之间的差异，而不是「审计记录是否完整」的证据。
 */
export function replayFromAudit(entries: readonly AuditLedgerEntry[]): IncidentState {
  let state = emptyIncidentState()
  for (const entry of entries) {
    state = applyReplayStep(
      state,
      { seq: entry.seq, messageId: entry.messageId, revealedAtMs: entry.revealedAtMs },
      entry.effects,
      entry.counter,
    )
  }
  return state
}

/** 账本里已经揭示到游标为止的那些条目（与 `replayStream` 用同一个判据）。 */
export function entriesUpTo(
  entries: readonly AuditLedgerEntry[],
  cursor: ReplayCursor,
): AuditLedgerEntry[] {
  return entries.filter((entry) => cursorIncludes(cursor, entry))
}

/** 只靠账本就重算计数 —— 「每跳有出处」在审计侧的等价物。 */
export function countersFromLedger(entries: readonly AuditLedgerEntry[]): CounterSnapshot {
  return countersFromInputs(entries.map((entry) => entry.counter).filter((input): input is CounterInput => input !== null))
}

/** ⑧ 时间线的行：本回合自己的 `audit_event`（4 行，逐字来自种子）。 */
export function incidentTimelineRows(entries: readonly AuditLedgerEntry[]): AuditLedgerEntry[] {
  return entries
    .filter((entry) => entry.kind === "audit_event" && entry.scope === "incident")
    .sort((a, b) => a.occurredAtMs - b.occurredAtMs || a.seq - b.seq)
}

/* -------------------------------------------------------------------------- */
/* 因果链                                                                      */
/* -------------------------------------------------------------------------- */

export type CausalIssue = {
  code:
    | "causal-id-not-a-chain"
    | "cause-not-earlier"
    | "cause-missing"
    | "no-effects"
    | "counter-mismatch"
  entryId: string
  detail: string
}

/**
 * 因果账本的自检。
 *
 * 检查的是**编码本身**能不能支撑回溯，而不是「看起来合理」：
 *   1. `causalId` 必须等于从根到自己的 id 链（最后一段是自己的 id）；
 *   2. `causeId` 必须存在、且**出现在自己之前**（因果不能倒流）；
 *   3. 每条消息都必须至少产生一个效果（没有效果的留痕意味着状态可能凭空变化）；
 *   4. `counter` 与 `effects` 里的闭环/裁决必须对得上（计数不能被伪造）。
 */
export function verifyCausalLedger(entries: readonly AuditLedgerEntry[]): CausalIssue[] {
  const issues: CausalIssue[] = []
  const indexById = new Map<MessageId, number>()

  entries.forEach((entry, index) => {
    const chain = causalChainOf(entry.causalId)
    if (chain[chain.length - 1] !== entry.messageId) {
      issues.push({
        code: "causal-id-not-a-chain",
        entryId: entry.entryId,
        detail: `causalId 的最后一段 ${chain[chain.length - 1]} 不等于消息 id ${entry.messageId}`,
      })
    }
    if (entry.causeId === null) {
      if (chain.length !== 1) {
        issues.push({
          code: "causal-id-not-a-chain",
          entryId: entry.entryId,
          detail: `根消息的 causalId 不应有祖先：${entry.causalId}`,
        })
      }
    } else {
      if (chain.length < 2 || chain[chain.length - 2] !== entry.causeId) {
        issues.push({
          code: "causal-id-not-a-chain",
          entryId: entry.entryId,
          detail: `causalId 的倒数第二段与 causeId 不一致：${entry.causalId} vs ${entry.causeId}`,
        })
      }
      const causeIndex = indexById.get(entry.causeId)
      if (causeIndex === undefined) {
        issues.push({
          code: "cause-missing",
          entryId: entry.entryId,
          detail: `causeId ${entry.causeId} 不在账本里（或出现在它之后）`,
        })
      } else if (causeIndex >= index) {
        issues.push({
          code: "cause-not-earlier",
          entryId: entry.entryId,
          detail: `causeId ${entry.causeId} 排在自己之后（因果倒流）`,
        })
      }
    }

    if (entry.effects.length === 0) {
      issues.push({
        code: "no-effects",
        entryId: entry.entryId,
        detail: `${entry.kind} 消息没有产生任何效果`,
      })
    }

    if (entry.counter === null) {
      const closureEffects = entry.effects.filter((effect) => effect.op === "incident.close")
      const approvalEffects = entry.effects.filter((effect) => effect.op === "approval.record")
      if (closureEffects.length > 0 || approvalEffects.length > 0) {
        issues.push({
          code: "counter-mismatch",
          entryId: entry.entryId,
          detail: "改状态的闭环/裁决没有对应的计数输入",
        })
      }
    }

    indexById.set(entry.messageId, index)
  })

  return issues
}

/**
 * 从某条留痕回溯到它的根 —— 「谁批准的删除操作？」这类问题要的正是这条链。
 *
 * 输入一个消息 id（或一条账本条目），返回从根到它的完整条目链；找不到就抛。
 */
export function traceCausalChain(
  entries: readonly AuditLedgerEntry[],
  messageId: MessageId,
): AuditLedgerEntry[] {
  const byId = new Map(entries.map((entry) => [entry.messageId, entry]))
  const target = byId.get(messageId)
  if (target === undefined) throw new Error(`账本里没有这条留痕：${messageId}`)

  const chain: AuditLedgerEntry[] = []
  let cursor: AuditLedgerEntry | undefined = target
  const guard = new Set<MessageId>()
  while (cursor !== undefined) {
    if (guard.has(cursor.messageId)) {
      throw new Error(`因果链出现环：${cursor.messageId}`)
    }
    guard.add(cursor.messageId)
    chain.unshift(cursor)
    cursor = cursor.causeId === null ? undefined : byId.get(cursor.causeId)
  }
  return chain
}

export type CardDecisionTrace = {
  cardId: string
  openedBy: AuditLedgerEntry
  toolCalls: AuditLedgerEntry[]
  approval: AuditLedgerEntry | null
  /** 裁决结果（`null` = 还没有人裁决）。 */
  decision: "approved" | "rejected" | "param-changed" | null
  chain: AuditLedgerEntry[]
  /** 一句话答案（业务语言）。 */
  answer: string
}

/**
 * 「谁批准的这次处置？」的可核对答案。
 *
 * 三种情况都必须能如实回答，而不是都答「人工批准了」：
 *   · 不经人：清单内自主执行（种子 a1）；
 *   · 经人：有 `approval` 消息（种子 a2）；
 *   · 还没批：卡片仍在待批 —— 这时答案必须是「还没有人批准」，不能含糊。
 */
export function explainCardDecision(
  entries: readonly AuditLedgerEntry[],
  cardId: string,
): CardDecisionTrace {
  const openedBy = entries.find(
    (entry) => entry.kind === "action_card" && entry.effects.some((effect) => effect.op === "card.open" && effect.card.cardId === cardId),
  )
  if (openedBy === undefined) throw new Error(`账本里没有这张卡：${cardId}`)

  const approval = entries.find(
    (entry) => entry.kind === "approval" && entry.effects.some((effect) => effect.op === "card.decide" && effect.cardId === cardId),
  ) ?? null

  const toolCalls = entries.filter(
    (entry) =>
      entry.kind === "tool_call" &&
      entry.effects.some((effect) => effect.op === "tool.execute" && effect.record.approvalCardId === cardId),
  )

  const isAuto = openedBy.effects.some((effect) => effect.op === "card.open" && effect.card.cardKind === "auto")
  const answer = isAuto
    ? "没有人工批准单：该动作命中 L3 可回滚清单，在策略内自主执行（有回滚窗口与留痕）。"
    : approval === null
      ? "还没有人批准：这张授权卡仍在待批，动作未执行。"
      : `由人工在 ${approval.occurredAt} 裁决：${approval.action}。`

  const decisionEffect = approval?.effects.find((effect) => effect.op === "card.decide")

  return {
    cardId,
    openedBy,
    toolCalls,
    approval,
    decision: decisionEffect?.op === "card.decide" ? decisionEffect.decision : null,
    chain: traceCausalChain(entries, openedBy.messageId),
    answer,
  }
}

/** 账本自述：交接与测试都读它。 */
export function summarizeLedger(entries: readonly AuditLedgerEntry[]): {
  total: number
  incidentRows: number
  backgroundRows: number
  roots: number
  deepestChain: number
} {
  const depths = entries.map((entry) => causalChainOf(entry.causalId).length)
  return {
    total: entries.length,
    incidentRows: entries.filter((entry) => entry.scope === "incident").length,
    backgroundRows: entries.filter((entry) => entry.scope === "background").length,
    roots: entries.filter((entry) => entry.causeId === null).length,
    deepestChain: Math.max(...depths),
  }
}
