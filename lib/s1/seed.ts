/**
 * S1 事实底本 —— `seed.round3.json` 的**只读**类型化视图。
 *
 * `seed.round3.json` 是从工作区根目录 `S1-回合3种子事件流.json` **逐字复制**进来的
 * （复制后 `diff` 为空，2026-09-17）。复制而不是引用，是因为产品必须独立可构建：
 * 根目录不属于本仓，跨仓读文件会让本仓在独立 checkout 里读不到事实底本。
 *
 * **本文件不得手改任何数值。** 界面上的每个数字都要能在这里找到出处
 * （不变量 `evidence.every-claim-cites-a-source` 的物质基础）。这里只做三件事：
 *
 *   1. 把 JSON 变成有类型的只读视图（`SEED`）；
 *   2. 把种子内部已经隐含、但需要显式化的**派生**写出来（证据 → 实体映射、旧计划行）；
 *   3. 提供一个纯函数时钟格式化器（时间戳是业务记录内容，逐字保留种子的写法）。
 *
 * 「派生」都要在注释里写明它来自种子的哪一句 —— 否则它就是编造。
 */

import seedDocument from "./seed.round3.json"
import type {
  ActionCode,
  AgentActor,
  DataSourceId,
  EntityView,
  EvidenceItem,
  EvidenceKind,
  PlanStep,
  SedimentItem,
} from "./contract"

/* -------------------------------------------------------------------------- */
/* 逐字复制的事实底本                                                          */
/* -------------------------------------------------------------------------- */

export const SEED = seedDocument

export const SEED_PROVENANCE = {
  /** 工作区根目录里的原件（复制来源，不是运行时依赖）。 */
  sourceOfTruthFile: "S1-回合3种子事件流.json",
  sourceId: seedDocument.id,
  sourceTitle: seedDocument.title,
  copiedFrom: "工作区根目录",
  copiedAt: "2026-09-17",
  copyMode: "逐字复制（cp，复制后 diff 为空）",
  designExtractedAt: seedDocument.sourceOfTruth.extractedAt,
} as const

/** 回合 3 的事件 id（种子 `plan.eventId`）。 */
export const INCIDENT_ID = seedDocument.plan.eventId

/** 业务系统与隔离声明（种子 `environment`）。 */
export const ENVIRONMENT = seedDocument.environment

/** 顶栏的**设计稿静帧取值**。注意：其中三个计数不是取用值而是**断言目标**，
 *  由 `counters.ts` 从事件流重算后比对（不变量 `evidence.counters-derive-from-events`）。 */
export const HEADER_STATS_SIGNED = seedDocument.headerStats

/* -------------------------------------------------------------------------- */
/* 时钟：序号化，不用 Date                                                     */
/* -------------------------------------------------------------------------- */

const CLOCK_PATTERN = /^(\d{2}):(\d{2}):(\d{2})$/

/**
 * `"16:20:31"` → 当日 00:00:00 起的毫秒数。
 *
 * 刻意**不用 `Date`**：本层的确定性要求「同一输入同一输出」，而 `Date` 会把时区、
 * 夏令时、`now()` 这些环境变量引进来（`verify.ts` 有一条扫描器禁止 `lib/s1/**` 出现 `Date`）。
 */
export function clockToMs(clock: string): number {
  const match = CLOCK_PATTERN.exec(clock)
  if (match === null) throw new Error(`不是合法的 HH:MM:SS：${JSON.stringify(clock)}`)
  const [, hours, minutes, seconds] = match
  return (Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000
}

/** 当日毫秒数 → `"HH:MM:SS"`。**只到秒**：种子的时间戳都是秒粒度，多给的精度是假的。 */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) throw new Error(`不是合法的时间：${JSON.stringify(ms)}`)
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600) % 24
  const minutes = Math.floor(totalSeconds / 60) % 60
  const seconds = totalSeconds % 60
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

/** 回合 3 开场（种子 `audit[0].at = "16:20:31"`）—— 前台回放的事实时间原点。 */
export const INCIDENT_START_MS = clockToMs(seedDocument.audit[0].at)

/** 四条设计稿真值审计时间戳（`16:20:31 / :38 / :52 / 16:21:00`），逐字来自 `seed.audit`。 */
export const AUDIT_ROW_CLOCKS = seedDocument.audit.map((row) => row.at)

/** 同上，毫秒形态。 */
export const AUDIT_ROW_TIMES_MS = AUDIT_ROW_CLOCKS.map(clockToMs)

/* -------------------------------------------------------------------------- */
/* 实体与证据                                                                  */
/* -------------------------------------------------------------------------- */

/** 实体（种子 `entities`）—— 画布上的节点。 */
export const ENTITY_VIEWS: readonly EntityView[] = seedDocument.entities.map((entity) => ({
  id: entity.id,
  kind: entity.kind,
  label: entity.label,
  state: entity.state,
})) as readonly EntityView[]

export const ENTITY_IDS = ENTITY_VIEWS.map((entity) => entity.id)

/**
 * 证据 → 实体映射。
 *
 * 种子没有这一栏，但它**已经隐含**在 `findings[1].contextPackage` 里：
 * `{app01 · conf .93 · ev[#e-41,#e-77]}` —— 两条证据指向 `app01`。另外两处：
 *   · `evidence[2].target = "file:webshell2.jsp"`（#e-79 是那个文件的 hash）；
 *   · `entities[0]` 攻击者 #0421 的 `detail = "IP 203.0.113.7 → 换IP .41"`，
 *     而 #e-41 是 `probe` 的「回连报文」—— 回连的发起方是这个攻击者。
 * 所以映射如下（不新增实体，只显式化已经写在种子里的指向）。
 */
const EVIDENCE_ENTITY_REFS: Readonly<Record<string, readonly string[]>> = {
  "#e-41": ["attacker:0421", "asset:dmz-app01"],
  "#e-77": ["asset:dmz-app01"],
  "#e-79": ["file:webshell2.jsp", "asset:dmz-app01"],
}

export const EVIDENCE_ITEMS: readonly EvidenceItem[] = seedDocument.evidence.map((item) => ({
  id: item.id,
  kind: item.kind as EvidenceKind,
  source: item.source as DataSourceId,
  /** 种子里有的带 `label`、有的带 `note`（#e-41 两者都有）—— 逐字取，不拼接。 */
  label: item.label,
  entityRefs: [...(EVIDENCE_ENTITY_REFS[item.id] ?? [])],
}))

export const EVIDENCE_IDS = EVIDENCE_ITEMS.map((item) => item.id)

/**
 * 种子里的 `findings` / `toolCalls` / `actionCards` 三段是**异构数组**（每条的字段集合不同，
 * 例如只有 `findings[1]` 带 `elapsedMs`、只有 `toolCalls[0]` 带 `brief`）。
 * JSON 导入会把它们推成联合类型，直接取字段会被 TS 拒绝。这里给出**显式类型化的只读视图**，
 * 把「哪些字段可能存在」写在类型里，而不是靠 `as any` 把类型系统关掉。
 */
export type SeedFinding = {
  id: string
  confidence: number
  conclusion: string
  evidenceRefs: string[]
  sources: DataSourceId[]
  nextStep?: string
  extraChips?: string[]
  contextPackage?: string
  mergeLabel?: string
  elapsedMs?: number
}

/** f2 的汇流三件套在种子里是**必有**的，所以类型里也必填 —— 用可选类型会漏掉「它没值」这种状态。 */
export type SeedMergedFinding = SeedFinding & {
  contextPackage: string
  mergeLabel: string
  elapsedMs: number
}

export const FINDINGS = seedDocument.findings as unknown as SeedFinding[]

export type SeedToolCall = {
  id: string
  session?: string
  disclosure?: string
  brief?: string
  command?: string
  output?: string
  exitCode?: number
}

export type SeedAutoCard = {
  id: string
  kind: "auto"
  title: string
  autonomy: string
  decision: string
  rollbackWindowMs: number
  basis: string
  impact: string
  rollback: string
}

export type SeedApprovalCard = {
  id: string
  kind: "approval-required"
  title: string
  target: string
  five: { what: string; basis: string; impact: string; rollback: string; alternative: string }
  actions: string[]
  sla: { ms: number; timeoutPolicy: string }
}

const RAW_TOOL_CALLS = seedDocument.toolCalls as unknown as SeedToolCall[]
const RAW_CARDS = seedDocument.actionCards as unknown as Array<SeedAutoCard | SeedApprovalCard>

function requireToolCall(id: string): SeedToolCall {
  const call = RAW_TOOL_CALLS.find((entry) => entry.id === id)
  if (call === undefined) throw new Error(`种子 toolCalls 里没有 ${id}`)
  return call
}

function requireCard<T extends SeedAutoCard | SeedApprovalCard>(kind: T["kind"]): T {
  const card = RAW_CARDS.find((entry) => entry.kind === kind)
  if (card === undefined) throw new Error(`种子 actionCards 里没有 ${kind} 卡`)
  return card as T
}

function requireFinding(id: string): SeedFinding {
  const finding = (seedDocument.findings as unknown as SeedFinding[]).find((entry) => entry.id === id)
  if (finding === undefined) throw new Error(`种子 findings 里没有 ${id}`)
  return finding
}

/* -------------------------------------------------------------------------- */
/* 计划                                                                        */
/* -------------------------------------------------------------------------- */

export const PLAN = seedDocument.plan

export const PLAN_STEPS: readonly PlanStep[] = seedDocument.plan.steps.map((step) => ({
  id: step.id,
  actor: step.actor as AgentActor,
  state: step.state,
  label: step.label,
  // 种子有的步骤没有 `detail`：这里**不写**这个键，而不是写成 `undefined`。
  // 一个值为 undefined 的键不是 JSON 值（`stable-json.ts` 会当场拒绝），
  // 而且它会让「有没有这一栏」这件事在深比较里变得含糊。
  ...(step.detail === undefined ? {} : { detail: step.detail }),
})) as readonly PlanStep[]

/** 取 `旧计划「持续观察后门」` 引号内的那一句，作为被划掉的旧计划行的 label。 */
function quoted(text: string): string {
  const match = /「([^」]+)」/.exec(text)
  if (match === null) throw new Error(`种子里的这句话没有引号包围的计划名：${JSON.stringify(text)}`)
  return match[1]
}

/**
 * 旧计划行 —— 第 9 拍「划掉重写」要划掉的那一行。
 *
 * 出处：种子 `plan.replan.from = "旧计划「持续观察后门」"`，label 取引号内的原文；
 * `actor` 取 `plan.owner` 里的「调查 Agent」（`plan.owner = "调查 Agent 自主拆解"`）。
 * 它不在 `plan.steps` 里 —— 那是**重规划之后**的计划，旧方案只活在 `replan.from` 这一句里。
 */
export const SUPERSEDED_PLAN_STEP: PlanStep = {
  id: "p0",
  actor: "调查 Agent",
  state: "planned",
  label: quoted(PLAN.replan.from),
}

export const PLAN_REPLAN = PLAN.replan

/* -------------------------------------------------------------------------- */
/* 工具调用 / 授权卡 / 审计 / 沉淀 / 报告                                       */
/* -------------------------------------------------------------------------- */

/** 五条工具调用（t1 说明卡 / t2 t3 排查 / t4 删除 / t5 复核）—— 按 id 取，不靠下标。 */
export const TOOL_CALLS: Readonly<Record<"t1" | "t2" | "t3" | "t4" | "t5", SeedToolCall>> = {
  t1: requireToolCall("t1"),
  t2: requireToolCall("t2"),
  t3: requireToolCall("t3"),
  t4: requireToolCall("t4"),
  t5: requireToolCall("t5"),
}

/** 两张处置卡：a1 免授权通道（清单内可回滚）、a2 待批授权卡（五件套 + SLA）。 */
export const AUTO_CARD: SeedAutoCard = requireCard<SeedAutoCard>("auto")
export const APPROVAL_CARD: SeedApprovalCard = requireCard<SeedApprovalCard>("approval-required")

/** 两条结论（f1 判定后门 / f2 双源汇流）。 */
export const FINDING_F1: SeedFinding = requireFinding("f1")
export const FINDING_F2: SeedMergedFinding = requireMergedFinding("f2")

function requireMergedFinding(id: string): SeedMergedFinding {
  const finding = requireFinding(id)
  if (finding.contextPackage === undefined || finding.mergeLabel === undefined || finding.elapsedMs === undefined) {
    throw new Error(`种子 findings 里的 ${id} 不是汇流结论：缺 contextPackage / mergeLabel / elapsedMs`)
  }
  return {
    ...finding,
    contextPackage: finding.contextPackage,
    mergeLabel: finding.mergeLabel,
    elapsedMs: finding.elapsedMs,
  }
}

/** 四条审计行（设计稿真值时间戳）。 */
export const AUDIT_ROWS = seedDocument.audit

/** 沉淀物（种子 `sediment`）。`kind` 与 `sourceRefs` 是显式化，见各自的出处注释。 */
export const SEDIMENT_ITEMS: readonly SedimentItem[] = [
  {
    id: "s1",
    label: seedDocument.sediment[0].label,
    kind: "detection-playbook",
    sourceRefs: ["#e-41", "#e-77", "#e-79"],
  },
  {
    id: "s2",
    label: seedDocument.sediment[1].label,
    kind: "policy",
    /** 白名单策略来自那张待批卡（`actionCards[1]`，目标 `upload_avatar.jsp`）。 */
    sourceRefs: ["a2"],
  },
  {
    id: "s3",
    label: seedDocument.sediment[2].label,
    kind: "attacker-profile",
    /** 画像属于攻击者 #0421（`entities[0].fingerprintMatches = 3`）。 */
    sourceRefs: ["attacker:0421"],
  },
]

export const REPORT = seedDocument.report
export const ASK_S1 = seedDocument.askS1

/* -------------------------------------------------------------------------- */
/* 动作码：把种子里的两张卡翻译成目录里的代码                                   */
/* -------------------------------------------------------------------------- */

/** 卡片 a1「封禁攻击源 203.0.113.7」→ `block-source`（清单内，可回滚，回滚窗口 41000ms）。 */
export const CARD_A1_ACTION: ActionCode = "block-source"

/** 卡片 a2「修复上传接口扩展名白名单」→ `patch-config`（改业务接口，必须停在人这道门）。 */
export const CARD_A2_ACTION: ActionCode = "patch-config"

/** 种子 `plan.steps[2].detail = "L3 自动执行 · 可回滚"` 与 `headerStats.autonomyLadder`。 */
export const L3_AUTO_DETAIL = PLAN_STEPS[2].detail ?? ""
