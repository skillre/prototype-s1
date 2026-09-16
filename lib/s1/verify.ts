/**
 * 纯扫描器 —— 把不变量变成**可失败的检查**。
 *
 * 这里的每个函数都只做一件事：吃进事件序列（或剧本），吐出一串**问题**。
 * 空数组 = 没发现问题。它们不抛异常、不写文件、不读时钟，因此既能在测试里跑，
 * 也能在未来被组件或调试面板调用。
 *
 * 为什么「扫描器」要和「数据」分开：判定必须能被**反过来测一次**（给一个坏输入，
 * 它必须红）。把判定埋进断言里，就没法做这条负对照 —— 而负对照才是「探针还活着」的证据。
 */

import {
  ACTION_CATALOG,
  COMPONENT_ID_SET,
  MESSAGE_KIND_SET,
  type ActionCode,
  type EvidenceId,
  type IncidentMessage,
  type MessageId,
} from "./contract"
import { knownEvidenceIds } from "./replay"
import { EVIDENCE_IDS } from "./seed"
import type { StoryboardBeat } from "./storyboard"

export type ScanIssue = {
  code: string
  /** 出问题的对象（消息 id / 拍次 / 引用），便于直接定位。 */
  subject: string
  detail: string
}

/* -------------------------------------------------------------------------- */
/* 剧本自身的规则（剧本 `contract.rule` 原文）                                   */
/* -------------------------------------------------------------------------- */

/**
 * 剧本 `contract.rule` 原文：
 *   每一步的 `emits` 只能取上面八个之一；`evidenceRefs` 必须能在种子数据的 evidence 段找到；
 *   `affects` 必须指向十二个组件之一。
 */
export function scanStoryboard(beats: readonly StoryboardBeat[]): ScanIssue[] {
  const issues: ScanIssue[] = []
  const seedEvidence = new Set<string>(EVIDENCE_IDS)

  for (const beat of beats) {
    if (!MESSAGE_KIND_SET.has(beat.emits)) {
      issues.push({ code: "storyboard/unknown-message-kind", subject: `beat ${beat.step}`, detail: beat.emits })
    }
    for (const ref of beat.evidenceRefs) {
      if (!seedEvidence.has(ref)) {
        issues.push({
          code: "storyboard/evidence-not-in-seed",
          subject: `beat ${beat.step}`,
          detail: `${ref} 不在种子的 evidence 段里`,
        })
      }
    }
    for (const id of beat.affects) {
      if (!COMPONENT_ID_SET.has(id)) {
        issues.push({ code: "storyboard/unknown-component", subject: `beat ${beat.step}`, detail: id })
      }
    }
  }

  const steps = beats.map((beat) => beat.step)
  const expected = Array.from({ length: beats.length }, (_, index) => index + 1)
  if (steps.join(",") !== expected.join(",")) {
    issues.push({ code: "storyboard/step-sequence", subject: "beats", detail: `拍次不是 1..${beats.length}：${steps.join(",")}` })
  }

  return issues
}

/* -------------------------------------------------------------------------- */
/* 证据引用（evidence.every-claim-cites-a-source）                              */
/* -------------------------------------------------------------------------- */

export type ClaimPart = {
  /** 这条「说法」在消息里的位置。 */
  label: string
  evidenceRefs: readonly EvidenceId[]
  /** 带结论的说法会带这个（结论先行的那句话）。 */
  conclusion?: string
}

/**
 * 一条消息里**必须挂证据**的部分。
 *
 * 判据来自不变量原文「凡出现结论或置信度的卡片」：
 *   · 带 `claim` 的消息（结论 + 置信度）；
 *   · 授权卡（它有 `basis` 一栏，且是处置动作的依据）；
 *   · 工具调用带处置说明卡时（说明卡里写着「依据证据#e-41/#e-77」）；
 *   · 沉淀物（它的 `sourceRefs` 必须接回事实）。
 * 不在这里的形状（告警到达、闭环记录、裁决本身）不是「说法」，因此不受这条约束。
 */
export function claimPartsOf(message: IncidentMessage): ClaimPart[] {
  switch (message.kind) {
    case "alert":
      return message.claim === null
        ? []
        : [
            {
              label: `alert:${message.claim.findingId}`,
              evidenceRefs: message.claim.evidenceRefs,
              conclusion: message.claim.conclusion,
            },
          ]
    case "context_package":
      return [
        {
          label: `context_package:${message.claim.findingId}`,
          evidenceRefs: message.claim.evidenceRefs,
          conclusion: message.claim.conclusion,
        },
      ]
    case "action_card":
      return [{ label: `action_card:${message.cardId}`, evidenceRefs: message.evidenceRefs }]
    case "tool_call":
      return message.brief === undefined
        ? []
        : [{ label: `tool_call:${message.id}:brief`, evidenceRefs: message.evidenceRefs }]
    case "sediment":
      return []
    default:
      return []
  }
}

/**
 * 不变量 `evidence.every-claim-cites-a-source` 的扫描器。
 *
 * 两条判据：
 *   1. **不许出现无引用的说法**：每个 claim 部位至少一条证据引用；
 *   2. **引用必须可定位**：消息里的每个证据引用都必须是序列里真实存在的证据
 *      （`timeline.ts` 生成时就会抛，这里再独立扫一遍 —— 生成期的检查与审计期的检查
 *      是两回事，后者要能发现「序列被外部改过」）。
 */
export function scanEvidenceCitations(events: readonly IncidentMessage[]): ScanIssue[] {
  const issues: ScanIssue[] = []
  // 对照物是**登记簿**（种子 + 当日事件簿），不是消息自己 ——
  // 拿消息去比对消息，任何引用都会「解析得到」，探针就死了。
  const known = knownEvidenceIds()

  for (const message of events) {
    for (const ref of message.evidenceRefs) {
      if (!known.has(ref)) {
        issues.push({
          code: "evidence/unresolvable-ref",
          subject: message.id,
          detail: `证据引用 ${ref} 解析不到来源`,
        })
      }
    }
    for (const part of claimPartsOf(message)) {
      if (part.evidenceRefs.length === 0) {
        issues.push({
          code: "evidence/claim-without-source",
          subject: message.id,
          detail: `${part.label} 没有挂任何证据引用`,
        })
      }
      for (const ref of part.evidenceRefs) {
        if (!known.has(ref)) {
          issues.push({
            code: "evidence/unresolvable-ref",
            subject: message.id,
            detail: `${part.label} 的证据引用 ${ref} 解析不到来源`,
          })
        }
      }
    }
  }

  return issues
}

/* -------------------------------------------------------------------------- */
/* 分级授权（authority.no-unlisted-autonomous-action）                          */
/* -------------------------------------------------------------------------- */

/**
 * 不变量 `authority.no-unlisted-autonomous-action` 的扫描器。
 *
 * 判据（逐条都能指出是哪条消息、哪个动作）：
 *   1. `auto: true` 的每次执行都必须命中**可回滚动作清单**（`ACTION_CATALOG` 里
 *      `approvalRequired: false` 的那一批），且目录里标了回滚窗口的动作必须给出窗口；
 *   2. 清单外的动作**必须**经人：要么它带 `approvalCardId` 且该卡在它之前已经被批准，
 *      要么它根本没被执行（状态停在待批 —— 那是合法的，「超时默认挂起不执行」）。
 */
export function scanAuthority(events: readonly IncidentMessage[]): ScanIssue[] {
  const issues: ScanIssue[] = []
  const approvedCards = new Set<string>()

  for (const message of events) {
    if (message.kind === "approval" && message.decision === "approved") {
      approvedCards.add(message.cardId)
      continue
    }
    if (message.kind === "action_card" && message.cardKind === "auto") {
      const policy = ACTION_CATALOG[message.actionCode]
      if (policy.approvalRequired) {
        issues.push({
          code: "authority/auto-card-outside-list",
          subject: message.id,
          detail: `卡片 ${message.cardId} 标为自动执行，但动作 ${message.actionCode} 不在清单内`,
        })
      }
      continue
    }
    if (message.kind !== "tool_call") continue

    const policy = ACTION_CATALOG[message.actionCode]
    if (message.auto) {
      if (policy.approvalRequired) {
        issues.push({
          code: "authority/autonomous-action-outside-list",
          subject: message.id,
          detail: `动作 ${message.actionCode} 不在可回滚清单内，却以 auto 执行`,
        })
      }
      if (!policy.reversible) {
        issues.push({
          code: "authority/autonomous-action-not-reversible",
          subject: message.id,
          detail: `动作 ${message.actionCode} 不可回滚，却以 auto 执行`,
        })
      }
      const window = "rollbackWindowMs" in policy ? policy.rollbackWindowMs : undefined
      if (window !== undefined && message.rollbackWindowMs === undefined) {
        issues.push({
          code: "authority/missing-rollback-window",
          subject: message.id,
          detail: `动作 ${message.actionCode} 在目录里带回滚窗口，消息却没给出窗口`,
        })
      }
    } else if (message.approvalCardId === undefined || !approvedCards.has(message.approvalCardId)) {
      issues.push({
        code: "authority/executed-without-approval",
        subject: message.id,
        detail: `动作 ${message.actionCode} 不在清单内，且没有先于它的批准记录（card=${message.approvalCardId ?? "无"}）`,
      })
    }
  }

  return issues
}

/* -------------------------------------------------------------------------- */
/* 因果链（audit.replay-is-faithful 的一半）                                    */
/* -------------------------------------------------------------------------- */

export type CausalChainIssue = ScanIssue

/**
 * 因果编码的自检（不变量 `audit.replay-is-faithful` 的另一半，另一半在 `audit.ts`
 * 的 `verifyCausalLedger`：那里检查账本，这里检查**序列本身**）。
 */
export function scanCausalChain(events: readonly IncidentMessage[]): CausalChainIssue[] {
  const issues: CausalChainIssue[] = []
  const seen = new Map<MessageId, string>()

  for (const message of events) {
    const chain = message.causalId.split("/")
    if (chain[chain.length - 1] !== message.id) {
      issues.push({
        code: "causal/last-segment",
        subject: message.id,
        detail: `causalId 的最后一段不是自己：${message.causalId}`,
      })
    }
    if (message.causeId === null) {
      if (chain.length !== 1) {
        issues.push({ code: "causal/root-has-ancestors", subject: message.id, detail: message.causalId })
      }
    } else {
      const parentCausalId = seen.get(message.causeId)
      if (parentCausalId === undefined) {
        issues.push({
          code: "causal/cause-missing",
          subject: message.id,
          detail: `causeId ${message.causeId} 不在它之前出现`,
        })
      } else if (message.causalId !== `${parentCausalId}/${message.id}`) {
        issues.push({
          code: "causal/chain-mismatch",
          subject: message.id,
          detail: `${message.causalId} ≠ ${parentCausalId}/${message.id}`,
        })
      }
    }
    seen.set(message.id, message.causalId)
  }

  return issues
}

/** 动作码 → 是否允许自主执行（组件阶段与测试共用同一份判据）。 */
export function isAutonomous(code: ActionCode): boolean {
  return !ACTION_CATALOG[code].approvalRequired
}
