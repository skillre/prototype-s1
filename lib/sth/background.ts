/**
 * 背景事件底座 —— 「今日」这个词的物质基础。
 *
 * ## 这一层为什么必须存在
 *
 * 顶栏那三个数字（今日自主闭环 / 人工介入 / 平均处置）**不是装饰**：人于 2026-09-16 签署的
 * 决定 `counters-are-derived` 要求「允许跳动，但每跳必须可追溯到一条事件」，并且明确
 * 「回放器必须生成规模足够聚合出 128 / 3 / 41s 的背景事件底座，而不是 `setInterval` 里 `count++`」。
 * 所以这一层要给出**底座本身**：一条规模足够、可复现、每一起闭环都有出处的当日事件簿。
 *
 * ## 形态与规模（本轮的开放设计题，这里是答案）
 *
 * | 项 | 取值 | 依据 |
 * |---|---|---|
 * | 当日闭环总数 | 130 | 128 起自主闭环（种子 `headerStats.autonomousClosedToday`）+ 2 起人工介入闭环 |
 * | 起止 | 08:00:00 → 16:20:57 | 全部落在回合 3 开场（16:20:31）前后，不留到「明天」 |
 * | 每一起闭环的消息链 | 自主 3 条 / 人工 5 条 | `alert → tool_call → audit_event`（人工那条中间多 `action_card → approval`） |
 * | 消息总数 | 394 | 126×3 + 2×5 + 2×3 —— 前台 17 拍之外的全部 |
 * | 处置时长 | 自主 17–62s，人工 342 / 418s | 整数秒，**总和恰好 5330s** = 130 × 41 |
 * | 证据 | 每起一条 `#e-b<index>` | 沿用种子的三种证据种类与数据源，不新造种类 |
 *
 * ### 为什么要在解说窗口里留两条
 *
 * 剧本第 4 拍（`T+1.4s`「顶栏建立底噪」）写的正是「三个数字开始按已发生事件重算并跳动」。
 * 若 130 起全部发生在 16:20:31 之前，回放期间三个数字就是**静止**的 —— 「跳动」这句话会
 * 退化成一句解说词。所以最后两起闭环的**事实时间**落在解说窗口内（16:20:32 / 16:20:35 开，
 * 16:20:52 / 16:20:57 结），它们的揭示时刻分别是 `T+1.4s`（第 4 拍那一刻）与 `T+9.4s`。
 * 于是：
 *
 *   · 开场时计数器读 **126 / 2**，回放结束时读 **128 / 3 / 41s** —— 与设计稿静帧一致，
 *     而设计稿的静帧本来就是**本回合结束**那一刻（第 17 拍「计数封账」）；
 *   · 每一次跳变都能指到一条 `audit_event`（`counters.ts` 的 `counterTrace` 逐跳给出出处）；
 *   · 跳变是**真实事实到达**的结果，不是动画。
 *
 * ### 可复现怎么保证
 *
 * 全模块没有 `Date`、没有 `Math.random()`：开放时刻是整数等差数列，
 * 处置时长来自一张固定的 8 槽位模式表 + 一次**确定性**的余数分配（每第 4 起减 1 秒，
 * 0/4/8/…/124 共 32 起，恰好吸收 32 秒的偏差）。`tests/sth-invariants.spec.ts`
 * 断言：连跑两次得到同一序列；总和恰好 5330s；计数与签署值一致。
 */

import {
  ACTION_CATALOG,
  type ActionCode,
  type AgentActor,
  type DataSourceId,
  type EntityId,
  type EvidenceItem,
  type EntityView,
  type EvidenceKind,
  type IncidentId,
} from "./contract"
import { INCIDENT_START_MS } from "./seed"

/* -------------------------------------------------------------------------- */
/* 常量：底座的规模                                                            */
/* -------------------------------------------------------------------------- */

/**
 * 当日闭环数。**这是底座的规模（事实），不是给顶栏赋的值。**
 *
 * 顶栏的 128 由 `counters.ts` 从事件流重算得出，`counters.ts` 里没有任何一个 128 字面量
 * （有测试逐字扫描该模块的源码）。底座自己当然知道自己生成了多少起 —— 否则它无从生成。
 */
export const CLOSED_TODAY = 130

/** 其中自主闭环数（种子的 128 指的是这个数）。 */
export const AUTONOMOUS_CLOSED_TODAY = 128

/** 人工介入的事件数：2 起背景闭环 + 前台第 15 拍那一次批准。 */
export const HUMAN_INTERVENTIONS_TODAY = 3

/** 平均处置秒数（种子 `headerStats.avgHandlingSeconds`）。 */
export const AVG_HANDLING_SECONDS = 41

/** 总处置秒数 = 130 × 41，**恰好**，不留四舍五入的余地。 */
export const TOTAL_HANDLING_SECONDS = CLOSED_TODAY * AVG_HANDLING_SECONDS

/** 当日事件簿的开场：08:00:00。 */
export const DAY_START_MS = 8 * 3600 * 1000

/** 窗口内闭环的**事实**时间（解说窗口内到达的两起）。 */
export const IN_WINDOW_CLOSURES = [
  { index: 129, openedAtMs: INCIDENT_START_MS + 1_000, durationSeconds: 20, alertRevealedAtMs: 900 },
  { index: 130, openedAtMs: INCIDENT_START_MS + 4_000, durationSeconds: 22, alertRevealedAtMs: 9_000 },
] as const

/**
 * 窗口内闭环的揭示时刻。
 *
 * 第 4 拍（`T+1.4s`「顶栏建立底噪」）本身就是一条 `audit_event`，所以第一起窗口内闭环的
 * **闭环记录**就揭示在第 4 拍那一刻 —— 这一拍不是「重算一下」的空转消息，而是一条真实到达的
 * 当日闭环；第二起揭示在 `T+9.4s`（第 15 拍之后、第 16 拍之前），让计数在封账前走完最后一步。
 */
export const IN_WINDOW_REVEAL_MS = [1_400, 9_400] as const

/** 预窗口部分的开放时间窗：[08:00:00, 16:12:00)，留 8 分半给最长的处置时长。 */
const PRE_WINDOW_OPEN_SPAN_MS = 8 * 3600 * 1000 + 12 * 60 * 1000

/** 这 128 起里哪两起是人工介入闭环（确定性取值，不是随机）：1 起的序号。 */
export const HUMAN_APPROVED_INDEXES: readonly number[] = [41, 97]

export const HUMAN_APPROVED_DURATION_SECONDS: readonly number[] = [342, 418]

/* -------------------------------------------------------------------------- */
/* 处置时长模型                                                                */
/* -------------------------------------------------------------------------- */

/**
 * 自主闭环的时长模式（8 槽位循环）。
 *
 * 取值带内没有 1 秒的处置，也没有几分钟的处置：自主收敛的形态是「十几秒到一分钟」。
 * 总和 290 秒 / 8 起 = 36.25 秒，略低于全体均值 41 秒（人工那两起会把它拉上去），
 * 这正是「AI 快、人慢」在数字上的样子。
 */
export const AUTONOMOUS_DURATION_PATTERN = [24, 31, 39, 46, 28, 42, 18, 62] as const

/** 余数分配的步伐：每第 4 起（下标 0,4,8,…,124 共 32 起）减 1 秒。 */
export const RESIDUAL_STRIDE = 4

/** 时长的允许带宽（防呆：任何一次修正都不许把时长推出这个带）。 */
export const AUTONOMOUS_DURATION_BAND = { min: 15, max: 70 } as const

const PRE_WINDOW_AUTONOMOUS_COUNT =
  AUTONOMOUS_CLOSED_TODAY - IN_WINDOW_CLOSURES.length // 126

/**
 * 生成 126 起预窗口自主闭环的时长：模式表循环 + 确定性余数分配。
 *
 * 计算过程（可逐位核对）：
 *   126 = 15 轮 × 8 槽位 + 6 槽位 → 15 × 290 + (24+31+39+46+28+42) = 4350 + 210 = 4560
 *   目标：5330 − 760（人工两起）− 42（窗口内两起）= 4528
 *   偏差：4560 − 4528 = 32 → 每第 4 起减 1 秒，0,4,…,124 恰好 32 起 → 4528 ✓
 */
export function autonomousDurationsForPreWindow(): number[] {
  const durations: number[] = []
  for (let index = 0; index < PRE_WINDOW_AUTONOMOUS_COUNT; index += 1) {
    const patternValue = AUTONOMOUS_DURATION_PATTERN[index % AUTONOMOUS_DURATION_PATTERN.length]
    durations.push(index % RESIDUAL_STRIDE === 0 ? patternValue - 1 : patternValue)
  }

  const target = TOTAL_HANDLING_SECONDS
    - HUMAN_APPROVED_DURATION_SECONDS.reduce((sum, value) => sum + value, 0)
    - IN_WINDOW_CLOSURES.reduce((sum, entry) => sum + entry.durationSeconds, 0)
  const actual = durations.reduce((sum, value) => sum + value, 0)
  if (actual !== target) {
    throw new Error(
      `背景底座的时长模型与目标总时长对不上：${actual}s ≠ ${target}s。` +
        " 模式表或余数步伐改了却没重算，就会得到一条静默偏移的底噪。",
    )
  }
  for (const value of durations) {
    if (value < AUTONOMOUS_DURATION_BAND.min || value > AUTONOMOUS_DURATION_BAND.max) {
      throw new Error(`时长 ${value}s 落在允许带宽 [${AUTONOMOUS_DURATION_BAND.min}, ${AUTONOMOUS_DURATION_BAND.max}] 之外`)
    }
  }
  return durations
}

/* -------------------------------------------------------------------------- */
/* 背景资产与环境（演示环境自己的其它主机）                                     */
/* -------------------------------------------------------------------------- */

/**
 * 背景闭环涉及的主机。
 *
 * 命名沿用种子 `entities[1].detail` 的写法（`app01 · tomcat · 反序列化入口`），
 * 且 `asset:dmz-app01` 就是本场那台机器 —— 当日其它闭环里当然也可能碰到它。
 * 这 8 台是**演示环境**的资产，不是客户真实环境（`seed.environment.isolation`）。
 */
export const BACKGROUND_ASSETS: readonly EntityId[] = [
  "asset:dmz-app01",
  "asset:dmz-app02",
  "asset:dmz-web01",
  "asset:mail-gw01",
  "asset:vpn-gw01",
  "asset:erp-app03",
  "asset:report-db01",
  "asset:office-dc02",
]

/** 证据类型循环（沿用种子的三种，不新造种类）。 */
export const BACKGROUND_EVIDENCE_KINDS: readonly EvidenceKind[] = ["packet", "process-chain", "file-hash"]

/** 证据标签沿用种子的写法，不逐条编文案。 */
export const BACKGROUND_EVIDENCE_LABELS: Readonly<Record<EvidenceKind, string>> = {
  packet: "原始报文",
  "process-chain": "进程链",
  "file-hash": "文件 hash",
}

/** 严重度循环：多数低中，少数高（形成「底噪」而不是「天天高强度」）。 */
export const BACKGROUND_SEVERITIES = ["low", "medium", "medium", "high"] as const

/** 自主收敛动作的循环（全部来自 `ACTION_CATALOG` 里允许自主执行的那一批）。 */
export const BACKGROUND_AUTONOMOUS_ACTIONS: readonly ActionCode[] = [
  "block-source",
  "quarantine-file",
  "terminate-process",
  "isolate-host",
  "revoke-session",
]

/** 人工介入闭环的动作（清单外 → 必须停在人这道门）。 */
export const BACKGROUND_APPROVAL_ACTIONS: readonly ActionCode[] = ["patch-config", "rotate-credential"]

/* -------------------------------------------------------------------------- */
/* 背景资产在画布上的形态                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 背景资产作为**实体节点**的形态。
 *
 * 它们是演示环境自己的资产（不是客户真实环境），标签沿用种子 `entities[1].label`
 * 的写法；状态一律 `控制中` —— 每一起闭环都已经收敛，这是「闭环」的含义。
 */
const BACKGROUND_ASSET_LABELS: Readonly<Record<string, string>> = {
  "asset:dmz-app01": "DMZ 应用服务器",
  "asset:dmz-app02": "DMZ 应用服务器 02",
  "asset:dmz-web01": "DMZ 前置门户",
  "asset:mail-gw01": "邮件网关",
  "asset:vpn-gw01": "VPN 网关",
  "asset:erp-app03": "ERP 应用服",
  "asset:report-db01": "报表数据库",
  "asset:office-dc02": "办公域控",
}

export const BACKGROUND_ENTITY_VIEWS: readonly EntityView[] = BACKGROUND_ASSETS.map((id) => ({
  id,
  kind: "asset" as const,
  state: "控制中" as const,
  label: BACKGROUND_ASSET_LABELS[id] ?? `演示资产 ${id.slice("asset:".length)}`,
}))


/* -------------------------------------------------------------------------- */
/* 生成（确定性：无随机、无 Date）                                              */
/* -------------------------------------------------------------------------- */

export type BackgroundClosure = {
  /** 1 起的当日事件簿序号，同时是消息 id 与证据 id 的一部分。 */
  index: number
  id: IncidentId
  openedAtMs: number
  closedAtMs: number
  durationSeconds: number
  autonomous: boolean
  outcome: "closed-autonomous" | "closed-after-approval"
  action: ActionCode
  asset: EntityId
  evidence: EvidenceItem
  agent: AgentActor
  /** `pre-window`（开场已在册）/ `in-window`（解说窗口内到达）。 */
  revision: "pre-window" | "in-window"
  /** 揭示时刻：预窗口是 `-1`（开场已在册），窗口内是剧本节奏里的毫秒数。 */
  alertRevealedAtMs: number
  closureRevealedAtMs: number
}

const pad = (value: number) => String(value).padStart(4, "0")

export function backgroundIncidentId(index: number): IncidentId {
  return `#b${pad(index)}`
}

export function backgroundEvidenceId(index: number): string {
  return `#e-b${pad(index)}`
}

/** 消息 id 里的一段短名：`#b0041` → `b0041`。 */
function slugOf(index: number): string {
  return `b${pad(index)}`
}

export function backgroundMessageSlug(index: number): string {
  return slugOf(index)
}

export function buildBackgroundClosures(): BackgroundClosure[] {
  const durations = autonomousDurationsForPreWindow()
  const closures: BackgroundClosure[] = []

  // 1 · 预窗口的 128 起：126 自主 + 2 人工。开放时刻为整数等差数列。
  const preWindowSlots = CLOSED_TODAY - IN_WINDOW_CLOSURES.length // 128
  const humanIndexes = new Set<number>(HUMAN_APPROVED_INDEXES)
  let autonomousCursor = 0

  for (let slot = 0; slot < preWindowSlots; slot += 1) {
    const index = slot + 1
    const openedAtMs = DAY_START_MS + Math.floor((slot * PRE_WINDOW_OPEN_SPAN_MS) / preWindowSlots)
    const humanSlot = humanIndexes.has(index) ? HUMAN_APPROVED_INDEXES.indexOf(index) : -1
    const human = humanSlot >= 0
    const durationSeconds = human
      ? HUMAN_APPROVED_DURATION_SECONDS[humanSlot]
      : durations[autonomousCursor++]

    closures.push(
      makeClosure({
        index,
        openedAtMs,
        durationSeconds,
        human,
        revision: "pre-window",
        alertRevealedAtMs: -1,
        closureRevealedAtMs: -1,
      }),
    )
  }

  // 2 · 窗口内的 2 起：事实时间落在解说窗口里，揭示时刻取自剧本节奏。
  IN_WINDOW_CLOSURES.forEach((entry, position) => {
    closures.push(
      makeClosure({
        index: entry.index,
        openedAtMs: entry.openedAtMs,
        durationSeconds: entry.durationSeconds,
        human: false,
        revision: "in-window",
        alertRevealedAtMs: entry.alertRevealedAtMs,
        closureRevealedAtMs: IN_WINDOW_REVEAL_MS[position],
      }),
    )
  })

  return closures
}

function makeClosure(input: {
  index: number
  openedAtMs: number
  durationSeconds: number
  human: boolean
  revision: BackgroundClosure["revision"]
  alertRevealedAtMs: number
  closureRevealedAtMs: number
}): BackgroundClosure {
  const { index, openedAtMs, durationSeconds, human } = input
  const action = human
    ? BACKGROUND_APPROVAL_ACTIONS[index % BACKGROUND_APPROVAL_ACTIONS.length]
    : BACKGROUND_AUTONOMOUS_ACTIONS[index % BACKGROUND_AUTONOMOUS_ACTIONS.length]
  const asset = BACKGROUND_ASSETS[index % BACKGROUND_ASSETS.length]
  const kind = BACKGROUND_EVIDENCE_KINDS[index % BACKGROUND_EVIDENCE_KINDS.length]
  const source: DataSourceId = index % 2 === 0 ? "probe" : "edr"

  // 自检：动作的分级策略必须与「这起要不要人批」一致。
  // 清单内（`approvalRequired: false`）= 自主闭环；清单外 = 必须有一次裁决。
  const policy = ACTION_CATALOG[action]
  if (policy.approvalRequired !== human) {
    throw new Error(
      `背景动作 ${action} 的分级策略（approvalRequired=${policy.approvalRequired}）` +
        `与它的人工介入标记（human=${human}）不一致`,
    )
  }

  return {
    index,
    id: backgroundIncidentId(index),
    openedAtMs,
    closedAtMs: openedAtMs + durationSeconds * 1000,
    durationSeconds,
    autonomous: !human,
    outcome: human ? "closed-after-approval" : "closed-autonomous",
    action,
    asset,
    evidence: {
      id: backgroundEvidenceId(index),
      kind,
      source,
      label: BACKGROUND_EVIDENCE_LABELS[kind],
      entityRefs: [asset],
    },
    agent: index % 3 === 0 ? "报告 Agent" : "处置 Agent",
    revision: input.revision,
    alertRevealedAtMs: input.alertRevealedAtMs,
    closureRevealedAtMs: input.closureRevealedAtMs,
  }
}

/** 底座的自述（测试与交接都读它，避免数字散落在注释里）。 */
export const BACKGROUND_SUMMARY = {
  closedToday: CLOSED_TODAY,
  autonomousClosedToday: AUTONOMOUS_CLOSED_TODAY,
  humanApprovedClosures: HUMAN_APPROVED_INDEXES.length,
  humanInterventionsToday: HUMAN_INTERVENTIONS_TODAY,
  avgHandlingSeconds: AVG_HANDLING_SECONDS,
  totalHandlingSeconds: TOTAL_HANDLING_SECONDS,
  /**
   * 完整的计数定义 —— 「任一时刻的计数都能反查到构成它的那一批事件」需要一个**定义**，
   * 否则「平均处置」到底平均谁就无从核对。这里是定义本身：
   */
  definitions: {
    autonomousClosedToday:
      "当日 outcome = closed-autonomous 的闭环条数。回合 3 事件本身在进行中，因此不计入。",
    humanInterventions:
      "当日人做出的裁决条数（approval 消息，actor = 人工）。含背景 2 次与前台第 15 拍 1 次。",
    avgHandlingSeconds:
      "当日**已闭环**事件的处置时长均值（closedAt − openedAt，秒）。进行中的事件不参与。",
  },
} as const
