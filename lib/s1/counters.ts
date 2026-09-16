/**
 * 计数聚合 —— 顶栏三个数字的**唯一**来源。
 *
 * 不变量 `evidence.counters-derive-from-events` 的落地方式：
 *
 *   1. 本模块是**纯函数**：`countersFromEvents(events) -> CounterSnapshot`；
 *   2. 本模块里**没有任何 128 / 3 / 41 字面量**（有测试逐字扫描源码）——
 *      它只知道怎么数，不知道数出来应当是多少；
 *   3. 每一次跳变都能反查：`counterTrace` 逐条消息给出「这一刻哪个计数从几变到几、
 *      由哪条消息引起」；`counterContributors` 给出构成某个计数的**那一批事件**。
 *
 * 计数定义（不是形容词，是可核对的算法）见 `COUNTER_DEFINITIONS`：
 * 「今日」= 回放开场时已经在册的事件簿 + 解说窗口内到达的事件；进行中的事件不计入闭环。
 */

import type { IncidentId, IncidentMessage, MessageId } from "./contract"
import { cursorIncludes, normalizeCursor, type ReplayCursor } from "./replay"

export const COUNTER_NAMES = [
  "autonomousClosedToday",
  "humanInterventions",
  "avgHandlingSeconds",
] as const

export type CounterName = (typeof COUNTER_NAMES)[number]

export const COUNTER_DEFINITIONS: Readonly<Record<CounterName, string>> = {
  autonomousClosedToday:
    "当日 outcome = closed-autonomous 的闭环条数。回合 3 事件在进行中，因此不计入（它的批准只算人工介入）。",
  humanInterventions: "当日人做出的裁决条数（actor = 人工 的 approval 消息）。",
  avgHandlingSeconds:
    "当日**已闭环**事件的处置时长均值（closedAt − openedAt，秒），四舍五入到整数秒；进行中的事件不参与。",
}

/**
 * 对计数有影响的事件 —— 其余七类消息一个都不影响计数。
 *
 * 这个类型本身就是一条断言：**只有闭环记录与人工裁决能改变顶栏**，
 * 于是「计数跳了但没有对应事件」在类型层面就写不出来。
 */
export type CounterInput =
  | {
      kind: "closure"
      incidentId: IncidentId
      outcome: "closed-autonomous" | "closed-after-approval"
      handlingMs: number
    }
  | {
      kind: "intervention"
      incidentId: IncidentId
      cardId: string
    }

export type CounterSnapshot = {
  autonomousClosedToday: number
  humanInterventions: number
  closedToday: number
  /** 显示值（整数秒）。 */
  avgHandlingSeconds: number
  /** 精确值（秒，可能带小数）—— 用来核对「显示值不是靠凑出来的」。 */
  avgHandlingSecondsExact: number
  totalHandlingSeconds: number
}

/** 一条消息对计数的贡献；不影响计数的消息返回 `null`。 */
export function counterInputOf(message: IncidentMessage): CounterInput | null {
  if (message.kind === "audit_event" && message.closure !== undefined) {
    return {
      kind: "closure",
      incidentId: message.incidentId,
      outcome: message.closure.outcome,
      handlingMs: message.closure.handlingMs,
    }
  }
  if (message.kind === "approval") {
    return { kind: "intervention", incidentId: message.incidentId, cardId: message.cardId }
  }
  return null
}

export function countersFromInputs(inputs: readonly CounterInput[]): CounterSnapshot {
  let autonomousClosedToday = 0
  let humanInterventions = 0
  let closedToday = 0
  let totalHandlingMs = 0

  for (const input of inputs) {
    if (input.kind === "closure") {
      closedToday += 1
      totalHandlingMs += input.handlingMs
      if (input.outcome === "closed-autonomous") autonomousClosedToday += 1
    } else {
      humanInterventions += 1
    }
  }

  const totalHandlingSeconds = totalHandlingMs / 1000
  const avgHandlingSecondsExact = closedToday === 0 ? 0 : totalHandlingSeconds / closedToday

  return {
    autonomousClosedToday,
    humanInterventions,
    closedToday,
    avgHandlingSeconds: Math.round(avgHandlingSecondsExact),
    avgHandlingSecondsExact,
    totalHandlingSeconds,
  }
}

/** 已揭示到游标为止（含）的事件所产生的计数。默认整条序列。 */
export function countersFromEvents(
  events: readonly IncidentMessage[],
  cursor: ReplayCursor | number = Number.POSITIVE_INFINITY,
): CounterSnapshot {
  return countersFromInputs(inputsUpTo(events, normalizeCursor(cursor)))
}

export function inputsUpTo(events: readonly IncidentMessage[], cursor: ReplayCursor): CounterInput[] {
  const inputs: CounterInput[] = []
  for (const message of events) {
    if (!cursorIncludes(cursor, message)) break
    const input = counterInputOf(message)
    if (input !== null) inputs.push(input)
  }
  return inputs
}

/* -------------------------------------------------------------------------- */
/* 每次跳变的出处                                                              */
/* -------------------------------------------------------------------------- */

export type CounterChange = {
  seq: number
  messageId: MessageId
  revealedAtMs: number
  occurredAt: string
  /** 这一条消息引起的计数变化。 */
  changed: Array<{ name: CounterName; from: number; to: number }>
  /** 有变化却没有计数输入 = 不允许出现的状态（`attributable` 为 false）。 */
  attributable: boolean
}

/**
 * 逐条消息给出计数轨迹：**只在计数真的变了的时候记一笔**。
 *
 * 这条轨迹是不变量「不存在『计数跳了但没有对应事件』」的机器化形态：
 * 测试断言每一笔 `attributable` 为真，且变化幅度与新增的计数输入条数一致。
 */
export function counterTrace(events: readonly IncidentMessage[]): CounterChange[] {
  const trace: CounterChange[] = []
  const inputs: CounterInput[] = []
  let previous = countersFromInputs(inputs)

  for (const message of events) {
    const input = counterInputOf(message)
    if (input !== null) inputs.push(input)
    const next = countersFromInputs(inputs)
    const changed: CounterChange["changed"] = []
    for (const name of COUNTER_NAMES) {
      if (next[name] !== previous[name]) changed.push({ name, from: previous[name], to: next[name] })
    }
    if (changed.length > 0) {
      trace.push({
        seq: message.seq,
        messageId: message.id,
        revealedAtMs: message.revealedAtMs,
        occurredAt: message.occurredAt,
        changed,
        attributable: input !== null,
      })
    }
    previous = next
  }

  return trace
}

/**
 * 构成某个计数的**那一批事件** —— 现场有人问「128 是哪 128 起」时要能立刻答出来。
 *
 * 返回的是消息 id 与事件 id，不是数字：数字谁都能说，出处才是答案。
 */
export function counterContributors(
  events: readonly IncidentMessage[],
  name: CounterName,
  cursor: ReplayCursor | number = Number.POSITIVE_INFINITY,
): { value: number; messageIds: MessageId[]; incidentIds: IncidentId[] } {
  const boundary = normalizeCursor(cursor)
  const messageIds: MessageId[] = []
  const incidentIds: IncidentId[] = []

  for (const message of events) {
    if (!cursorIncludes(boundary, message)) break
    const input = counterInputOf(message)
    if (input === null) continue

    if (name === "humanInterventions") {
      if (input.kind !== "intervention") continue
    } else if (input.kind !== "closure") {
      continue
    } else if (name === "autonomousClosedToday" && input.outcome !== "closed-autonomous") {
      continue
    }

    messageIds.push(message.id)
    incidentIds.push(input.incidentId)
  }

  const snapshot = countersFromEvents(events, boundary)
  return { value: snapshot[name], messageIds, incidentIds }
}
