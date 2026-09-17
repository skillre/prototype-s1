import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

import { expect, test } from "@playwright/test"

import {
  buildAuditLedger,
  countersFromLedger,
  entriesUpTo,
  explainCardDecision,
  incidentTimelineRows,
  replayFromAudit,
  summarizeLedger,
  traceCausalChain,
  verifyCausalLedger,
  type AuditLedgerEntry,
} from "../lib/s1/audit"
import { BACKGROUND_SUMMARY } from "../lib/s1/background"
import {
  ACTION_CATALOG,
  AUTONOMOUS_ACTION_CODES,
  COMPONENT_IDS,
  MESSAGE_KINDS,
  type ActionCode,
  type IncidentMessage,
} from "../lib/s1/contract"
import { COUNTER_DEFINITIONS, counterContributors, counterTrace, countersFromEvents } from "../lib/s1/counters"
import { CURSOR_OPENING, cursorAtBeat, replayStream } from "../lib/s1/replay"
import { AUDIT_ROW_CLOCKS, INCIDENT_ID } from "../lib/s1/seed"
import { exportSedimentBundle, importSediment, sedimentRoundTripDiff, serializeSediment } from "../lib/s1/sediment"
import { stableStringify } from "../lib/s1/stable-json"
import {
  BEATS,
  DEFERRED_FRAME_INVARIANT_ID,
  FRAME_INVARIANTS,
  ON_DEMAND_BEAT,
  TIMED_BEATS,
} from "../lib/s1/storyboard"
import { askS1Message, buildIncidentStream, summarizeStream } from "../lib/s1/timeline"
import {
  claimPartsOf,
  scanAuthority,
  scanCausalChain,
  scanEvidenceCitations,
  scanStoryboard,
} from "../lib/s1/verify"
import { stripComments } from "../scripts/lib/kits-seam.mjs"
import { invariant } from "./support/product-contract"

/**
 * S1 数据层与确定性回放引擎的不变量登记与断言。
 *
 * 本包登记五条（六条已签署里能不用 DOM 验证的那些）。第六条 `boundary.demo-is-labelled-as-demo`
 * 的判红方式写的是「每个路由断言存在**可见**的演示标识（非 aria-hidden、非 display:none）」——
 * 那需要 DOM，而本包没有界面；**声明了却没有对象会让 `pnpm factory:contract` 变红**。
 * 组件第一批（2026-09-17）建出了那件对象，所以它现在**已经进契约、也已经登记**
 * （`tests/s1-console.spec.ts`）；原文仍原样留在 `lib/s1/storyboard.ts` 的 `FRAME_INVARIANTS` 里。
 *
 * 第七条 `color.every-hue-has-one-meaning` 登记在 `tests/art-direction.spec.ts`
 * （那是对真实像素的断言，取证能力在那里）。
 *
 * 每个 `invariant` 块里都有**负对照**：给一个坏输入，扫描器必须红。没有负对照的探针
 * 只是在说「是」——那正是 Factory 反复要拆掉的那种静默通过。
 */

const ROOT = process.cwd()

/** 一次构建，多次复用（构建本身是纯函数；另有测试比对两次构建相等）。 */
const STREAM: readonly IncidentMessage[] = buildIncidentStream()

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const cursorOf = (step: number) => cursorAtBeat(STREAM, step)

/* ========================================================================== */
/* evidence.every-claim-cites-a-source                                        */
/* ========================================================================== */

invariant(
  "evidence.every-claim-cites-a-source",
  "凡出现结论或置信度的卡片都至少挂一条可定位的证据引用",
  () => {
    test("全序列扫描：没有无引用的结论，也没有断掉的引用", () => {
      const issues = scanEvidenceCitations(STREAM)
      expect(issues, JSON.stringify(issues, null, 2)).toEqual([])

      // 0 个对象不能被说成通过：这条扫描必须真的扫到了东西，而且四类都在。
      const claims = STREAM.flatMap((message) => claimPartsOf(message))
      expect(claims.length, "全序列里必须有带结论的卡片").toBeGreaterThanOrEqual(4)
      const kinds = [...new Set(claims.map((claim) => claim.label.split(":")[0]))].sort()
      expect(kinds).toEqual(["action_card", "alert", "context_package", "tool_call"])
    })

    test("「问 S1」的回答同样有出处（第 18 拍按需生成）", () => {
      for (let index = 0; index < 3; index += 1) {
        const answer = askS1Message(STREAM, index)
        expect(answer.evidenceRefs.length, `第 ${index} 条回答没有引用`).toBeGreaterThanOrEqual(1)
        expect(scanEvidenceCitations([...STREAM, answer])).toEqual([])
      }
    })

    test("负对照：无引用的结论必须被扫描器抓住", () => {
      const findingAlert = STREAM.find(
        (message) => message.kind === "alert" && message.claim !== null && message.beatStep === 5,
      )
      expect(findingAlert, "第 5 拍的结论消息必须存在").toBeDefined()

      const stripped = clone(findingAlert!) as Extract<IncidentMessage, { kind: "alert" }>
      stripped.claim = { ...stripped.claim!, evidenceRefs: [] }
      const issues = scanEvidenceCitations([...STREAM, stripped])
      expect(issues.map((issue) => issue.code)).toContain("evidence/claim-without-source")
    })

    test("负对照：指向不存在证据的引用必须被抓住", () => {
      const anyMessage = clone(STREAM[0])
      anyMessage.evidenceRefs = ["#e-ghost"]
      const issues = scanEvidenceCitations([...STREAM, anyMessage])
      expect(issues.map((issue) => issue.code)).toContain("evidence/unresolvable-ref")
    })

    test("每条证据都指向一个数据源与至少一个实体", () => {
      const items = replayStream(STREAM).evidence.items
      expect(items.length).toBeGreaterThanOrEqual(3)
      for (const item of items) {
        expect(["probe", "edr"]).toContain(item.source)
        expect(item.entityRefs.length, `${item.id} 没有指向任何实体`).toBeGreaterThanOrEqual(1)
      }
      const byId = new Map(items.map((item) => [item.id, item]))
      expect(byId.get("#e-41")?.entityRefs).toContain("attacker:0421")
      expect(byId.get("#e-79")?.entityRefs).toContain("file:webshell2.jsp")
    })
  },
)

/* ========================================================================== */
/* authority.no-unlisted-autonomous-action                                    */
/* ========================================================================== */

invariant(
  "authority.no-unlisted-autonomous-action",
  "自主执行的每个动作都命中可回滚清单，清单外动作必须停在人这道门",
  () => {
    test("全序列扫描：没有清单外的自主执行，也没有绕过批准的处置", () => {
      const issues = scanAuthority(STREAM)
      expect(issues, JSON.stringify(issues, null, 2)).toEqual([])

      // 这条断言必须真的有对象：两类动作各出现过。
      const autoCalls = STREAM.filter((message) => message.kind === "tool_call" && message.auto)
      const gatedCalls = STREAM.filter((message) => message.kind === "tool_call" && !message.auto)
      expect(autoCalls.length, "必须有自主执行的工具调用").toBeGreaterThanOrEqual(1)
      expect(gatedCalls.length, "必须有经人批准后执行的工具调用").toBeGreaterThanOrEqual(1)
    })

    test("清单本身：L3 允许自主的是可回滚的安全域动作，改业务接口的必须待批", () => {
      expect(AUTONOMOUS_ACTION_CODES).toContain("block-source")
      expect(AUTONOMOUS_ACTION_CODES).toContain("delete-file-with-backup")
      expect(AUTONOMOUS_ACTION_CODES).not.toContain("patch-config")
      expect(ACTION_CATALOG["block-source"].rollbackWindowMs).toBe(41_000)
      expect(ACTION_CATALOG["patch-config"].approvalRequired).toBe(true)

      // 改业务接口的那张卡（a2）从来没被自主执行过。
      const executed = STREAM.filter(
        (message) => message.kind === "tool_call" && message.actionCode === "patch-config",
      )
      expect(executed).toEqual([])
    })

    test("待批的卡片如实停在待批：第 14 拍之后、第 15 拍之前的计划与卡片状态", () => {
      const beforeApproval = replayStream(STREAM, cursorOf(14))
      expect(beforeApproval.disposition.cards.find((entry) => entry.cardId === "a2")?.state).toBe("pending")
      const planStep = beforeApproval.plan.steps.find((entry) => entry.id === "p6")
      expect(planStep?.state, "第 15 拍之前 p6 必须是 blocked（挂起待授权）").toBe("blocked")
      expect(planStep?.detail).toBe("挂起待授权")

      const atEnd = replayStream(STREAM)
      expect(atEnd.disposition.cards.find((entry) => entry.cardId === "a2")?.state).toBe("approved")
      expect(atEnd.plan.steps.find((entry) => entry.id === "p6")?.state).toBe("done")
    })

    test("负对照：清单外的动作以 auto 执行 → 必须被抓住", () => {
      const target = STREAM.find((message) => message.kind === "tool_call" && message.auto)
      const tampered = clone(target!) as { actionCode: ActionCode }
      tampered.actionCode = "patch-config"
      const issues = scanAuthority([...STREAM, tampered as unknown as IncidentMessage])
      expect(issues.map((issue) => issue.code)).toContain("authority/autonomous-action-outside-list")
    })

    test("负对照：拿掉批准凭证之后执行 → 必须被抓住", () => {
      const gated = STREAM.find((message) => message.kind === "tool_call" && !message.auto)
      expect(gated, "必须有经人批准后执行的工具调用").toBeDefined()
      const tampered = clone(gated!) as Extract<IncidentMessage, { kind: "tool_call" }>
      delete tampered.approvalCardId
      const issues = scanAuthority([...STREAM, tampered])
      expect(issues.map((issue) => issue.code)).toContain("authority/executed-without-approval")
    })

    test("可回答「谁批准的删除操作」：三种情况都要如实回答", () => {
      const ledger = buildAuditLedger(STREAM)

      const auto = explainCardDecision(ledger, "a1") // 封禁攻击源：清单内自主
      expect(auto.decision).toBeNull()
      expect(auto.answer).toContain("没有人工批准单")

      const gated = explainCardDecision(ledger, "a2") // 修白名单：停在人这道门
      expect(gated.decision).toBe("approved")
      expect(gated.approval).not.toBeNull()
      expect(gated.answer).toContain(gated.approval!.occurredAt)
      expect(traceCausalChain(ledger, gated.openedBy.messageId).length).toBeGreaterThanOrEqual(3)
    })
  },
)

/* ========================================================================== */
/* audit.replay-is-faithful                                                   */
/* ========================================================================== */

invariant(
  "audit.replay-is-faithful",
  "从审计序列重放能逐字段重建计划 / 证据链 / 处置状态",
  () => {
    test("账本 1:1 覆盖每一条消息，且因果自检没有一处断裂", () => {
      const ledger = buildAuditLedger(STREAM)
      const summary = summarizeLedger(ledger)
      expect(summary.total).toBe(STREAM.length)
      expect(ledger.map((entry) => entry.messageId)).toEqual(STREAM.map((message) => message.id))
      expect(verifyCausalLedger(ledger)).toEqual([])
      expect(summary.deepestChain).toBeGreaterThanOrEqual(5)
      expect(summary.roots).toBeGreaterThan(0)
    })

    test("直放与审计重放：终态逐字段一致（走的是同一条归约路径）", () => {
      const ledger = buildAuditLedger(STREAM)
      const direct = replayStream(STREAM)
      const fromAudit = replayFromAudit(ledger)
      expect(stableStringify(fromAudit)).toBe(stableStringify(direct))

      // 三棵状态树单独比对，失败信息才指得出是哪一棵。
      expect(stableStringify(fromAudit.plan)).toBe(stableStringify(direct.plan))
      expect(stableStringify(fromAudit.evidence)).toBe(stableStringify(direct.evidence))
      expect(stableStringify(fromAudit.disposition)).toBe(stableStringify(direct.disposition))
    })

    test("中途四个时刻也一致（不是只有终态凑巧相等）", () => {
      const ledger = buildAuditLedger(STREAM)
      for (const cursor of [CURSOR_OPENING, cursorOf(8), cursorOf(14), cursorOf(17)]) {
        const direct = replayStream(STREAM, cursor)
        const fromAudit = replayFromAudit(entriesUpTo(ledger, cursor))
        expect(stableStringify(fromAudit), `游标 ${JSON.stringify(cursor)} 处两条路径不一致`).toBe(
          stableStringify(direct),
        )
      }
    })

    test("计数也能只靠账本重算出来", () => {
      const ledger = buildAuditLedger(STREAM)
      expect(countersFromLedger(ledger)).toEqual(countersFromEvents(STREAM))
    })

    test("因果 ID 自洽：链的倒数第二段就是 causeId，根没有祖先", () => {
      const issues = scanCausalChain(STREAM)
      expect(issues, JSON.stringify(issues, null, 2)).toEqual([])
      const deepest = STREAM.reduce((best, message) =>
        message.causalId.split("/").length > best.causalId.split("/").length ? message : best,
      )
      const rootId = deepest.causalId.split("/")[0]
      const root = STREAM.find((message) => message.id === rootId)
      expect(root?.causeId, "链的根必须是根消息").toBeNull()
      expect(deepest.causalId.endsWith(deepest.id)).toBe(true)
      expect(deepest.causalId.split("/").length).toBeGreaterThanOrEqual(5)
    })

    test("回溯可用：审计时间线的一行能一路走回它的根", () => {
      const ledger = buildAuditLedger(STREAM)
      const row = incidentTimelineRows(ledger)[1] // 16:20:38 取证行
      const chain = traceCausalChain(ledger, row.messageId)
      expect(chain.length).toBeGreaterThanOrEqual(3)
      expect(chain[chain.length - 1].messageId).toBe(row.messageId)
      expect(chain[0].causeId).toBeNull()
      for (let index = 1; index < chain.length; index += 1) {
        expect(chain[index].causeId).toBe(chain[index - 1].messageId)
      }
    })

    test("负对照：账本少记一个效果 → 重放必须与直放不同", () => {
      const ledger = buildAuditLedger(STREAM)
      const index = ledger.findIndex((entry) => entry.effects.length > 0)
      expect(index).toBeGreaterThanOrEqual(0)
      const tampered: AuditLedgerEntry[] = clone(ledger)
      tampered[index] = { ...tampered[index], effects: tampered[index].effects.slice(0, -1) }
      expect(stableStringify(replayFromAudit(tampered))).not.toBe(stableStringify(replayStream(STREAM)))
    })

    test("负对照：把 causeId 指成自己 → 因果自检必须报错", () => {
      const ledger = buildAuditLedger(STREAM)
      const index = ledger.findIndex((entry) => entry.causeId !== null)
      const tampered: AuditLedgerEntry[] = clone(ledger)
      tampered[index] = { ...tampered[index], causeId: tampered[index].messageId }
      const codes = verifyCausalLedger(tampered).map((issue) => issue.code)
      expect(codes.length).toBeGreaterThan(0)
      expect(codes).toContain("cause-missing")
    })
  },
)

/* ========================================================================== */
/* sediment.survives-export                                                   */
/* ========================================================================== */

invariant(
  "sediment.survives-export",
  "沉淀物导出再导入后，闭环计数、审批次数、事件链一致",
  () => {
    test("往返一致：导出 → 序列化 → 导入 → 再导出，逐字段无差异", () => {
      const ledger = buildAuditLedger(STREAM)
      const state = replayStream(STREAM)
      expect(state.sediment.map((item) => item.id)).toEqual(["s1", "s2", "s3"])
      expect(sedimentRoundTripDiff(state, ledger)).toEqual([])
    })

    test("导出的三块内容与运行状态逐一对上（不是另抄一份）", () => {
      const ledger = buildAuditLedger(STREAM)
      const state = replayStream(STREAM)
      const bundle = exportSedimentBundle({ state, ledger })

      expect(bundle.counts.autonomousClosedToday).toBe(state.counters.autonomousClosedToday)
      expect(bundle.counts.humanInterventions).toBe(state.counters.humanInterventions)
      expect(bundle.counts.avgHandlingSeconds).toBe(state.counters.avgHandlingSeconds)
      expect(bundle.approvals.length).toBe(state.disposition.approvals.length)
      expect(bundle.eventChain.length).toBeGreaterThan(0)
      for (let index = 1; index < bundle.eventChain.length; index += 1) {
        expect(bundle.eventChain[index].seq).toBeGreaterThan(bundle.eventChain[index - 1].seq)
      }
      // 事件链把根也带上了：第一条是根（因果 ID 里没有祖先），其余都带祖先。
      expect(bundle.eventChain[0].causalId.includes("/")).toBe(false)
      expect(bundle.eventChain.slice(1).some((link) => link.causalId.includes("/"))).toBe(true)
    })

    test("确定性：导出两次得到同一个字符串", () => {
      const ledger = buildAuditLedger(STREAM)
      const state = replayStream(STREAM)
      expect(serializeSediment(exportSedimentBundle({ state, ledger }))).toBe(
        serializeSediment(exportSedimentBundle({ state, ledger })),
      )
    })

    test("负对照：被削过的导出物必须被拒绝，而不是「尽量恢复」", () => {
      const ledger = buildAuditLedger(STREAM)
      const bundle = exportSedimentBundle({ state: replayStream(STREAM), ledger })

      const missingItems = importSediment(JSON.stringify({ ...bundle, items: undefined }))
      expect(missingItems.ok).toBe(false)
      if (!missingItems.ok) {
        expect(missingItems.issues.map((issue) => issue.code)).toContain("sediment/missing-field")
      }

      const wrongVersion = importSediment(JSON.stringify({ ...bundle, schemaVersion: 99 }))
      expect(wrongVersion.ok).toBe(false)
      if (!wrongVersion.ok) {
        expect(wrongVersion.issues.map((issue) => issue.code)).toContain("sediment/unsupported-schema-version")
      }

      const unknownField = importSediment(JSON.stringify({ ...bundle, extra: "偷偷塞进来的字段" }))
      expect(unknownField.ok).toBe(false)
      if (!unknownField.ok) {
        expect(unknownField.issues.map((issue) => issue.code)).toContain("sediment/unknown-field")
      }

      const emptySources = importSediment(
        JSON.stringify({ ...bundle, items: bundle.items.map((item) => ({ ...item, sourceRefs: [] })) }),
      )
      expect(emptySources.ok).toBe(false)
      if (!emptySources.ok) {
        expect(emptySources.issues.map((issue) => issue.code)).toContain("sediment/invalid-item")
      }

      expect(importSediment("{ 不是 JSON").ok).toBe(false)
    })

    test("负对照：沉淀物来源断了 → 导出必须当场失败", () => {
      const ledger = buildAuditLedger(STREAM)
      const state = clone(replayStream(STREAM))
      state.sediment[0].sourceRefs = ["#e-ghost"]
      expect(() => exportSedimentBundle({ state, ledger })).toThrow(/找不到出处/)
    })
  },
)

/* ========================================================================== */
/* evidence.counters-derive-from-events                                       */
/* ========================================================================== */

invariant(
  "evidence.counters-derive-from-events",
  "顶栏三个计数由事件流聚合重算得出，每一跳都能反查到出处",
  () => {
    test("终值等于设计稿签署值：128 / 3 / 41s —— 而且是算出来的", () => {
      const counters = countersFromEvents(STREAM)
      expect(counters.autonomousClosedToday).toBe(128)
      expect(counters.humanInterventions).toBe(3)
      expect(counters.avgHandlingSeconds).toBe(41)
      // 显示值不是凑出来的：均值恰好是整 41 秒。
      expect(counters.avgHandlingSecondsExact).toBe(41)
      expect(counters.totalHandlingSeconds).toBe(5330)
      expect(counters.closedToday).toBe(130)
    })

    test("计数器模块里没有这些数字，也没有 count++ 这类直接赋值", () => {
      const source = stripComments(readFileSync(join(ROOT, "lib/s1/counters.ts"), "utf8"))
      for (const literal of ["128", "41", "5330", "130"]) {
        expect(source, `counters.ts 不该出现字面量 ${literal}`).not.toContain(literal)
      }
      for (const file of listFiles(join(ROOT, "lib/s1"))) {
        const code = stripComments(readFileSync(file, "utf8"))
        expect(code, `${file} 不得用自增改计数`).not.toMatch(/\bcount\w*\s*(\+\+|--|\+=|-=)/)
      }
      expect(Object.keys(COUNTER_DEFINITIONS)).toEqual([
        "autonomousClosedToday",
        "humanInterventions",
        "avgHandlingSeconds",
      ])
      for (const definition of Object.values(COUNTER_DEFINITIONS)) {
        expect(definition.length).toBeGreaterThan(20)
      }
    })

    test("可复现：两次构建序列、两次重算都相同", () => {
      const again = buildIncidentStream()
      expect(stableStringify(again)).toBe(stableStringify(STREAM))
      expect(countersFromEvents(again)).toEqual(countersFromEvents(STREAM))
      const cursor = cursorOf(13)
      expect(stableStringify(replayStream(STREAM, cursor))).toBe(stableStringify(replayStream(STREAM, cursor)))
    })

    test("每一跳都有出处：不存在「计数变了但没有对应事件」", () => {
      const trace = counterTrace(STREAM)
      expect(trace.length).toBeGreaterThan(10)
      expect(trace.filter((change) => !change.attributable)).toEqual([])

      for (const change of trace) {
        for (const delta of change.changed) {
          if (delta.name === "avgHandlingSeconds") continue
          expect(Math.abs(delta.to - delta.from)).toBe(1)
        }
      }

      const jumps = trace.filter((change) =>
        change.changed.some((delta) => delta.name === "autonomousClosedToday"),
      )
      expect(jumps.length, "「128 起」必须有 128 次可追溯的跳变").toBe(128)
    })

    test("有人问「128 是哪 128 起」时答得出来", () => {
      const result = counterContributors(STREAM, "autonomousClosedToday")
      expect(result.value).toBe(128)
      expect(result.messageIds.length).toBe(128)
      expect(new Set(result.messageIds).size).toBe(128)
      expect(new Set(result.incidentIds).size).toBe(128)
      expect(result.incidentIds.every((id) => id.startsWith("#b"))).toBe(true)

      const interventions = counterContributors(STREAM, "humanInterventions")
      expect(interventions.value).toBe(3)
      expect(interventions.incidentIds.length).toBe(3)
    })

    test("开场时读 126 / 2，回放结束时读 128 / 3 —— 「跳动」是事实到达，不是动画", () => {
      const opening = countersFromEvents(STREAM, 0)
      expect(opening.autonomousClosedToday).toBe(126)
      expect(opening.humanInterventions).toBe(2)

      const final = countersFromEvents(STREAM)
      expect(final.autonomousClosedToday).toBe(128)
      expect(final.humanInterventions).toBe(3)

      // 两次关键跳变：第 15 拍的人工裁决，与窗口内最后一起闭环的到达。
      const ledger = buildAuditLedger(STREAM)
      const intervention = ledger.find(
        (entry) => entry.kind === "approval" && entry.incidentId === INCIDENT_ID,
      )
      expect(intervention?.occurredAt).toBe("16:20:56")
      const lastClosure = [...ledger]
        .reverse()
        .find((entry) => entry.counter?.kind === "closure" && entry.scope === "background")
      expect(lastClosure?.occurredAt).toBe("16:20:57")
    })

    test("负对照：拿掉一起闭环 → 重算必须不再等于 128", () => {
      const target = STREAM.find((message) => message.kind === "audit_event" && message.closure !== undefined)
      expect(target).toBeDefined()
      const tampered = STREAM.filter((message) => message.id !== target!.id)
      const counters = countersFromEvents(tampered)
      expect(counters.autonomousClosedToday).toBe(127)
      expect(counters.autonomousClosedToday).not.toBe(128)
    })

    test("负对照：塞进一条与计数无关的消息 → 计数不动", () => {
      const extra = clone(STREAM.find((message) => message.kind === "plan_update")!)
      extra.id = "m999-plan_update"
      extra.seq = STREAM.length + 1
      extra.revealedAtMs = 99_999
      expect(countersFromEvents([...STREAM, extra])).toEqual(countersFromEvents(STREAM))
    })

    test("底座自述与重算一致（规模写在底座的注释里，数字来自事件）", () => {
      const counters = countersFromEvents(STREAM)
      expect(BACKGROUND_SUMMARY.autonomousClosedToday).toBe(counters.autonomousClosedToday)
      expect(BACKGROUND_SUMMARY.humanInterventionsToday).toBe(counters.humanInterventions)
      expect(BACKGROUND_SUMMARY.avgHandlingSeconds).toBe(counters.avgHandlingSeconds)
      expect(BACKGROUND_SUMMARY.totalHandlingSeconds).toBe(counters.totalHandlingSeconds)
    })
  },
)

/* ========================================================================== */
/* 未登记为不变量的守护：契约副本、排序、两个时钟、种子静帧、确定性、store 约定    */
/* ========================================================================== */

test.describe("契约与剧本的机器化副本", () => {
  test("八类消息逐字一致，十二个组件里没有 ⑬ 对照栏", () => {
    expect([...MESSAGE_KINDS]).toEqual([
      "alert",
      "context_package",
      "plan_update",
      "tool_call",
      "action_card",
      "approval",
      "audit_event",
      "sediment",
    ])
    expect(COMPONENT_IDS.length).toBe(12)
  })

  test("剧本规则：emits / evidenceRefs / affects 全部合法，18 拍连号", () => {
    expect(scanStoryboard(BEATS)).toEqual([])
    expect(BEATS.length).toBe(18)
    expect(TIMED_BEATS.length).toBe(17)
    expect(ON_DEMAND_BEAT?.at).toBe("任意时刻")
  })

  test("第 8 条不变量已由组件阶段落盘：契约里声明了它，原文仍在数据层里读得到", () => {
    const contract = JSON.parse(readFileSync(join(ROOT, "product-contract.json"), "utf8")) as {
      invariants: Array<{ id: string }>
    }
    // 数据层那一包**故意**没写进契约（判红需要 DOM，声明了没测试会让 factory:contract 变红）。
    // 组件第一批建出了 DOM 对象，于是它进了契约、并在 `tests/s1-console.spec.ts` 里登记；
    // 数据层这一侧保留的仍是它的**原文**，所以两边能对上。
    expect(contract.invariants.map((entry) => entry.id)).toContain(DEFERRED_FRAME_INVARIANT_ID)
    expect(FRAME_INVARIANTS.map((entry) => entry.id)).toContain(DEFERRED_FRAME_INVARIANT_ID)
    const deferred = FRAME_INVARIANTS.find((entry) => entry.id === DEFERRED_FRAME_INVARIANT_ID)
    expect(deferred?.howTested).toContain("每个路由断言存在可见")
  })
})

test.describe("顺序、两个时钟与种子静帧", () => {
  test("序号稠密 1..412，回放时间非降，剧本 17 拍按序号出现", () => {
    const summary = summarizeStream(STREAM)
    expect(summary.total).toBe(412)
    expect(summary.incidentMessages + summary.dayLedgerMessages).toBe(412)
    STREAM.forEach((message, index) => expect(message.seq).toBe(index + 1))

    for (let index = 1; index < STREAM.length; index += 1) {
      expect(
        STREAM[index].revealedAtMs >= STREAM[index - 1].revealedAtMs,
        `第 ${index + 1} 条的回放时间倒退`,
      ).toBe(true)
    }

    const beatOrder = STREAM.filter((message) => message.beatStep !== null).map((message) => message.beatStep)
    for (let index = 1; index < beatOrder.length; index += 1) {
      expect(beatOrder[index]! >= beatOrder[index - 1]!).toBe(true)
    }
    expect(new Set(beatOrder).size).toBe(17)
    expect(STREAM.find((message) => message.beatStep === 1)?.revealedAtMs).toBe(0)
  })

  test("两个时钟各司其职：事实时间是设计稿真值，回放时间是剧本节奏", () => {
    const auditRows = incidentTimelineRows(buildAuditLedger(STREAM))
    expect(auditRows.map((row) => row.occurredAt)).toEqual([...AUDIT_ROW_CLOCKS])
    expect(AUDIT_ROW_CLOCKS).toEqual(["16:20:31", "16:20:38", "16:20:52", "16:21:00"])
    expect(auditRows.length, "⑧ 时间线只有本回合的四行").toBe(4)

    const firstRow = auditRows[0]
    const message = STREAM.find((entry) => entry.id === firstRow.messageId)
    expect(message?.occurredAt).toBe("16:20:31")
    expect(message?.revealedAtMs).toBe(3_200)
    expect(message?.beatStep).toBe(7)
  })

  test("种子的静帧是拼起来的：每处差异都是「那一栏在更早/更晚时刻的值」", () => {
    const atEnd = replayStream(STREAM)

    // ① 后门文件：第 8 拍标「定位完成 · hash 比对中」，第 12 拍清除后才变「已清除」。
    expect(entityState(replayStream(STREAM, cursorOf(8)), "file:webshell2.jsp")).toBe("定位完成")
    expect(entityState(atEnd, "file:webshell2.jsp")).toBe("已清除")

    // ② 攻击者：封禁卡（第 6 拍）之前是「已识别」，之后是「封禁中」。
    expect(entityState(replayStream(STREAM, cursorOf(5)), "attacker:0421")).toBe("已识别")
    expect(entityState(atEnd, "attacker:0421")).toBe("封禁中")

    // ③ 授权卡 a2 与计划第 6 步：第 15 拍批准之前逐字等于种子静帧。
    const beforeApproval = replayStream(STREAM, cursorOf(14))
    const card = beforeApproval.disposition.cards.find((entry) => entry.cardId === "a2")
    expect(card?.slaMs).toBe(137_000)
    expect(card?.rollback).toBe("基线备份 config.old · 一键回退")
    expect(beforeApproval.plan.steps.find((step) => step.id === "p6")?.state).toBe("blocked")

    // ④ 计划里三处「后置成立」的状态：第 3 拍时它们还没发生。
    const atPlan = replayStream(STREAM, cursorOf(3))
    expect(atPlan.plan.steps.find((step) => step.id === "p4")?.state).toBe("pending")
    expect(atPlan.plan.steps.find((step) => step.id === "p0")?.state).toBe("planned")
    expect(atPlan.plan.steps.some((step) => step.id === "p5")).toBe(false)

    // ⑤ 重规划之后：旧计划行被划掉，新步骤带着种子的状态出现。
    expect(atEnd.plan.steps.find((step) => step.id === "p0")?.state).toBe("superseded")
    expect(atEnd.plan.steps.find((step) => step.id === "p5")?.state).toBe("replanned")
    expect(atEnd.plan.replan?.from).toBe("旧计划「持续观察后门」")
    expect(atEnd.report?.progressPercent).toBe(68)
  })

  test("第 4 拍是窗口内到达的一起闭环：它只让计数动，不产生事件面内容", () => {
    const beat4 = STREAM.find((message) => message.beatStep === 4)
    expect(beat4?.kind).toBe("audit_event")
    expect(beat4?.affects).toEqual(["command-bar"])
    expect(beat4?.incidentId).not.toBe(INCIDENT_ID)
    const closure = beat4?.kind === "audit_event" ? beat4.closure : undefined
    expect(closure?.outcome).toBe("closed-autonomous")

    // 它的因果父节点是那条工具动作，出处挂在更早的 alert 上（不在 ⑧ 时间线上）。
    const parent = STREAM.find((message) => message.id === beat4?.causeId)
    expect(parent?.kind).toBe("tool_call")
    expect(parent?.evidenceRefs.length).toBe(1)
  })
})

test.describe("确定性：不读时钟、不随机、不依赖迭代顺序", () => {
  test("lib/s1 与 stores 的源码里没有 Date / Math.random / performance.now", () => {
    const files = dataLayerFiles()
    expect(files.length).toBeGreaterThan(8)
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"))
      for (const forbidden of ["Date.now", "new Date", "Math.random", "performance.now", "process.hrtime"]) {
        expect(code, `${file} 不得使用 ${forbidden}（确定性要求）`).not.toContain(forbidden)
      }
    }
  })

  test("视觉常量不在数据层：没有颜色 / 字体度量字面量", () => {
    for (const file of dataLayerFiles()) {
      const code = stripComments(readFileSync(file, "utf8"))
      // 只认真正的颜色写法：3 / 6 位十六进制且后面不再是字母数字。
      // （业务内容里 `攻击者 #0421` 这种写法不是颜色，不能拿它当命中。）
      expect(code, `${file} 不得出现十六进制颜色`).not.toMatch(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])/)
      expect(code, `${file} 不得出现 rgb()/hsl()/lab()`).not.toMatch(/\b(rgb|hsl|oklch|lab)\(/)
      expect(code, `${file} 不得出现字体度量`).not.toMatch(/font-size|line-height|letter-spacing/)
    }
  })

  test("同一游标两次回放深比较相等（含中途）", () => {
    for (const step of [3, 8, 12, 17]) {
      const cursor = cursorOf(step)
      expect(stableStringify(replayStream(STREAM, cursor))).toBe(stableStringify(replayStream(STREAM, cursor)))
    }
    expect(stableStringify(replayStream(STREAM, 1_400))).toBe(stableStringify(replayStream(STREAM, 1_400)))
  })
})

test.describe("zustand 约定：selector 只取原始值", () => {
  test("store 里没有派生字段，selector 返回的引用稳定", async () => {
    const store = await import("../stores/incident-store")
    const state = store.useIncidentStore.getState()
    expect(Object.keys(state).sort()).toEqual([
      "append",
      "cursorMs",
      "events",
      "loadCanonicalStream",
      "reset",
      "seek",
    ])
    expect(store.selectEvents(state)).toBe(store.selectEvents(state))
    expect(store.selectCursorMs(state)).toBe(state.cursorMs)
    expect(state.cursorMs).toBe(store.CURSOR_OPENING_MS)
  })

  test("loadCanonicalStream 装进的就是那条确定性序列；seek 只改游标", async () => {
    const store = await import("../stores/incident-store")
    const loaded = store.loadCanonicalStream()
    expect(loaded.length).toBe(412)
    expect(stableStringify(store.useIncidentStore.getState().events)).toBe(stableStringify(STREAM))

    store.useIncidentStore.getState().seek(9_000)
    const after = store.useIncidentStore.getState()
    expect(after.cursorMs).toBe(9_000)
    expect(store.selectEvents(after)).toBe(loaded)

    store.useIncidentStore.getState().reset()
    expect(store.useIncidentStore.getState().events).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

function entityState(state: ReturnType<typeof replayStream>, entityId: string): string | undefined {
  return state.entities.find((entity) => entity.id === entityId)?.state
}

/** 数据层的全部 .ts 文件（`lib/s1/**` + `stores/**`）—— 确定性扫描与视觉常量扫描的对象。 */
function dataLayerFiles(): string[] {
  return [...listFiles(join(ROOT, "lib/s1")), ...listFiles(join(ROOT, "stores"))]
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return listFiles(full)
    return entry.endsWith(".ts") ? [full] : []
  })
}
