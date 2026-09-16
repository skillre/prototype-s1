/**
 * 沉淀物导出 / 导入 —— 不变量 `sediment.survives-export` 的载体。
 *
 * 承诺是「一次事件 = 全网免疫」，而承诺要能被验证而不是被讲述：**带出去再带回来，
 * 闭环计数、审批次数、事件链必须一致**。所以导出物不是三张卡片，而是
 *
 *   · 沉淀物本身（剧本章节 / 白名单策略 / 攻击者画像）；
 *   · 当时的**计数**（当日自主闭环 / 人工介入 / 平均处置）；
 *   · 当时的**裁决记录**（谁批的、批的是哪张卡）；
 *   · 把沉淀物接回事实的**事件链**（因果 ID + 消息 id + 事实时间）。
 *
 * ## 确定性
 *
 * `serializeSediment` 用 `stable-json` 的键序稳定序列化，因此**导出两次得到同一个字符串**。
 * 导出物里没有墙上时间：`exportedAtCursorMs` 是回放游标，不是 `Date.now()`。
 */

import {
  type CausalId,
  type EvidenceId,
  type IncidentMessage,
  type MessageId,
  type MessageKind,
  type SedimentItem,
} from "./contract"
import { stableStringify, type JsonValue } from "./stable-json"
import {
  buildAuditLedger,
  traceCausalChain,
  type AuditLedgerEntry,
} from "./audit"
import type { ApprovalRecord, IncidentState } from "./replay"

export const SEDIMENT_SCHEMA_VERSION = 1

export type SedimentEventLink = {
  seq: number
  messageId: MessageId
  causalId: CausalId
  kind: MessageKind
  occurredAt: string
}

export type SedimentBundle = {
  schemaVersion: number
  /** 导出时的回放游标（毫秒）与最后一条消息的序号。 */
  exportedAtCursorMs: number
  exportedAtSeq: number
  items: SedimentItem[]
  counts: {
    autonomousClosedToday: number
    humanInterventions: number
    closedToday: number
    avgHandlingSeconds: number
  }
  approvals: ApprovalRecord[]
  eventChain: SedimentEventLink[]
}

/* -------------------------------------------------------------------------- */
/* 导出                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 把沉淀物接回事实：`sourceRefs` 里既有证据 id（`#e-79`）、也有卡片 id（`a2`）、
 * 也有实体 id（`attacker:0421`）。三种都要能落到至少一条账本条目上 ——
 * 落不到就是**断链**，这里直接抛，不静默容忍。
 */
function entriesForSourceRef(ledger: readonly AuditLedgerEntry[], ref: string): AuditLedgerEntry[] {
  return ledger.filter((entry) => {
    if (entry.evidenceRefs.includes(ref)) return true
    return entry.effects.some((effect) => {
      switch (effect.op) {
        case "card.open":
          return effect.card.cardId === ref
        case "claim.record":
          return effect.claim.findingId === ref || effect.claim.evidenceRefs.includes(ref as EvidenceId)
        case "evidence.register":
          return effect.items.some(
            (item) => item.id === ref || item.entityRefs.includes(ref),
          )
        case "tool.execute":
          return effect.record.approvalCardId === ref
        default:
          return false
      }
    })
  })
}

export function exportSedimentBundle(input: {
  state: IncidentState
  ledger: readonly AuditLedgerEntry[]
}): SedimentBundle {
  const { state, ledger } = input

  const chainEntries = new Map<MessageId, AuditLedgerEntry>()
  for (const item of state.sediment) {
    if (item.sourceRefs.length === 0) {
      throw new Error(`沉淀物 ${item.id} 没有任何来源引用 —— 那它就是一段没有出处的说法`)
    }
    for (const ref of item.sourceRefs) {
      const hits = entriesForSourceRef(ledger, ref)
      if (hits.length === 0) {
        throw new Error(`沉淀物 ${item.id} 的来源 ${ref} 在账本里找不到出处`)
      }
      for (const hit of hits) {
        for (const entry of traceCausalChain(ledger, hit.messageId)) {
          chainEntries.set(entry.messageId, entry)
        }
      }
    }
  }

  return {
    schemaVersion: SEDIMENT_SCHEMA_VERSION,
    exportedAtCursorMs: state.cursor.revealedAtMs,
    exportedAtSeq: state.cursor.lastSeq,
    items: state.sediment.map((item) => ({ ...item, sourceRefs: [...item.sourceRefs] })),
    counts: {
      autonomousClosedToday: state.counters.autonomousClosedToday,
      humanInterventions: state.counters.humanInterventions,
      closedToday: state.counters.closedToday,
      avgHandlingSeconds: state.counters.avgHandlingSeconds,
    },
    approvals: state.disposition.approvals.map((record) => ({ ...record })),
    eventChain: [...chainEntries.values()]
      .map((entry) => ({
        seq: entry.seq,
        messageId: entry.messageId,
        causalId: entry.causalId,
        kind: entry.kind,
        occurredAt: entry.occurredAt,
      }))
      .sort((a, b) => a.seq - b.seq),
  }
}

/** 键序稳定的序列化：**导出两次得到同一个字符串**（有测试）。 */
export function serializeSediment(bundle: SedimentBundle): string {
  return stableStringify(bundle as unknown as JsonValue)
}

/* -------------------------------------------------------------------------- */
/* 导入                                                                        */
/* -------------------------------------------------------------------------- */

export type SedimentImportIssue = { code: string; path: string; message: string }

export type SedimentImportResult =
  | { ok: true; bundle: SedimentBundle; issues: [] }
  | { ok: false; bundle: null; issues: SedimentImportIssue[] }

const TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "exportedAtCursorMs",
  "exportedAtSeq",
  "items",
  "counts",
  "approvals",
  "eventChain",
])

const SEDIMENT_KINDS = new Set(["detection-playbook", "policy", "attacker-profile"])

/**
 * 导入导出物。
 *
 * 与 `product-contract.json` 的门禁同一套纪律：字段集合是**封闭**的（未知字段报错而不是忽略），
 * 形状不对就带着原因失败。**绝不做「尽量恢复」** —— 一个悄悄丢字段的导入，
 * 会让「导出再导入一致」这条不变量永远为真，而它本该是能红的。
 */
export function importSediment(json: string): SedimentImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    return { ok: false, bundle: null, issues: [{ code: "sediment/unparsable", path: "$", message: String(error) }] }
  }

  const issues: SedimentImportIssue[] = []
  const push = (code: string, path: string, message: string) => issues.push({ code, path, message })

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      bundle: null,
      issues: [{ code: "sediment/not-an-object", path: "$", message: "沉淀导出物必须是一个 JSON 对象" }],
    }
  }

  const record = parsed as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!TOP_LEVEL_KEYS.has(key)) push("sediment/unknown-field", key, `未知字段 ${key}（字段集合是封闭的）`)
  }
  for (const key of TOP_LEVEL_KEYS) {
    if (!(key in record)) push("sediment/missing-field", key, `缺少字段 ${key}`)
  }
  if (record.schemaVersion !== SEDIMENT_SCHEMA_VERSION) {
    push(
      "sediment/unsupported-schema-version",
      "schemaVersion",
      `schemaVersion 必须是 ${SEDIMENT_SCHEMA_VERSION}，实际是 ${JSON.stringify(record.schemaVersion)}`,
    )
  }

  if (!Array.isArray(record.items)) {
    push("sediment/invalid-items", "items", "items 必须是数组")
  } else {
    record.items.forEach((item, index) => {
      const path = `items[${index}]`
      if (typeof item !== "object" || item === null) {
        push("sediment/invalid-item", path, "沉淀物必须是对象")
        return
      }
      const entry = item as Record<string, unknown>
      if (typeof entry.id !== "string" || entry.id.length === 0) push("sediment/invalid-item", `${path}.id`, "缺少 id")
      if (typeof entry.label !== "string" || entry.label.length === 0) {
        push("sediment/invalid-item", `${path}.label`, "缺少 label")
      }
      if (typeof entry.kind !== "string" || !SEDIMENT_KINDS.has(entry.kind)) {
        push("sediment/invalid-item", `${path}.kind`, `kind 不在合法集合里：${JSON.stringify(entry.kind)}`)
      }
      if (!Array.isArray(entry.sourceRefs) || entry.sourceRefs.length === 0) {
        push("sediment/invalid-item", `${path}.sourceRefs`, "沉淀物必须有来源引用")
      }
    })
  }

  const counts = record.counts
  if (typeof counts !== "object" || counts === null) {
    push("sediment/invalid-counts", "counts", "counts 必须是对象")
  } else {
    for (const key of ["autonomousClosedToday", "humanInterventions", "closedToday", "avgHandlingSeconds"]) {
      const value = (counts as Record<string, unknown>)[key]
      if (typeof value !== "number" || !Number.isFinite(value)) {
        push("sediment/invalid-counts", `counts.${key}`, `${key} 必须是有限的数字`)
      }
    }
  }

  if (!Array.isArray(record.approvals)) push("sediment/invalid-approvals", "approvals", "approvals 必须是数组")
  if (!Array.isArray(record.eventChain)) push("sediment/invalid-event-chain", "eventChain", "eventChain 必须是数组")
  else {
    record.eventChain.forEach((link, index) => {
      const entry = link as Record<string, unknown>
      for (const key of ["seq", "messageId", "causalId", "kind", "occurredAt"]) {
        if (!(key in entry)) push("sediment/invalid-event-link", `eventChain[${index}].${key}`, `缺少 ${key}`)
      }
    })
  }

  if (issues.length > 0) return { ok: false, bundle: null, issues }
  return { ok: true, bundle: parsed as unknown as SedimentBundle, issues: [] }
}

/**
 * 往返比较：导出 → 序列化 → 导入 → 再导出，四步之后必须逐字段一致。
 *
 * 返回值是**差异清单**（空数组 = 一致），这样失败信息能指出是哪一块不一致，
 * 而不是只报一个 `false`。
 */
export function sedimentRoundTripDiff(
  state: IncidentState,
  ledger: readonly AuditLedgerEntry[],
): string[] {
  const first = exportSedimentBundle({ state, ledger })
  const serialized = serializeSediment(first)
  const imported = importSediment(serialized)
  if (!imported.ok) return imported.issues.map((issue) => `${issue.code} @ ${issue.path}: ${issue.message}`)

  const second = imported.bundle
  const diffs: string[] = []
  if (stableStringify(first.items as unknown as JsonValue) !== stableStringify(second.items as unknown as JsonValue)) {
    diffs.push("沉淀物条目不一致")
  }
  if (stableStringify(first.counts as unknown as JsonValue) !== stableStringify(second.counts as unknown as JsonValue)) {
    diffs.push("计数不一致")
  }
  if (
    stableStringify(first.approvals as unknown as JsonValue) !==
    stableStringify(second.approvals as unknown as JsonValue)
  ) {
    diffs.push("审批记录不一致")
  }
  if (
    stableStringify(first.eventChain as unknown as JsonValue) !==
    stableStringify(second.eventChain as unknown as JsonValue)
  ) {
    diffs.push("事件链不一致")
  }
  if (stableStringify(serializeSediment(second)) !== stableStringify(serialized)) {
    diffs.push("二次导出的字符串与首次不同（序列化不稳定）")
  }
  return diffs
}

/** 从事件序列 + 状态一步导出（便捷入口，内部用 `buildAuditLedger`）。 */
export function exportSedimentFromEvents(state: IncidentState, events: readonly IncidentMessage[]): SedimentBundle {
  return exportSedimentBundle({ state, ledger: buildAuditLedger(events) })
}
