/**
 * 控制台视图模型 —— **纯函数**，把「回放游标」翻译成面板要看的东西。
 *
 * ## 这一层为什么存在
 *
 * 界面不许自己算：面板里出现的每一行、每一个数字，都必须能追到一条消息或一个派生量。
 * 所以派生集中在这里，且全部是纯函数 —— 于是它们可以在**没有 DOM** 的情况下被断言
 * （`tests/s1-console.spec.ts`），也可以在浏览器里被断言同一件事。
 *
 * ## 三条纪律
 *
 * 1. **不发明内容。** 计划条目的名字、命令、回显、结论、证据标签全部来自 `lib/s1/**`
 *    的事实底本；这里只做**筛选、排序、连接与投影**。凡是「数据里没有的字段」，
 *    返回 `null`，由界面显示空位，而不是就地编一句。
 * 2. **不读时钟、不随机。** 本模块里没有 `Date`、没有 `Math.random()`：时间只有两个来源 ——
 *    消息自己的 `revealedAtMs`（回放时间）与调用方传进来的 `progressMs`（播放进度）。
 * 3. **不含界面文案、不含视觉常量。** 状态词、动作名、字段标签都住在 `lib/i18n/zh-CN.ts`；
 *    颜色、字号、时长一律 `var(--kits-*)`。
 *
 * ## 两个时钟（沿用数据层的建模）
 *
 * | 量 | 含义 | 谁用 |
 * |---|---|---|
 * | `revealedAtMs` | 回放时间：这条消息在第几毫秒被揭示 | 状态、顺序、拍号 |
 * | `progressMs` | 播放进度：回放器此刻走到哪儿（连续，可暂停） | 打字机、回显逐行返回 |
 *
 * 打字机**不是独立的定时器**：可见字符数 = `f(progressMs − 这条消息被揭示的时刻)`。
 * 所以暂停会冻住、拖时间轴会重算、倒着拖会把字收回去 —— 它由游标派生，不由动画驱动。
 */

import {
  ACTION_CATALOG,
  AGENT_ACTOR_SET,
  AUTONOMY_LEVELS,
  type ActionCode,
  type ActorRef,
  type AgentActor,
  type AutonomyLevel,
  type DataSourceId,
  type EntityId,
  type EntityView,
  type EvidenceId,
  type EvidenceItem,
  type IncidentMessage,
  type MessageId,
  type PlanStepState,
  type SedimentItem,
} from "@/lib/s1/contract"
import {
  CURSOR_OPENING,
  evidenceById,
  knownEvidenceIds,
  replayStream,
  type ApprovalRecord,
  type CardRecord,
  type IncidentState,
  type ReplayCursor,
} from "@/lib/s1/replay"
import { FINDINGS, ENVIRONMENT, INCIDENT_ID, PLAN, PLAN_STEPS, TOOL_CALLS, type SeedFinding } from "@/lib/s1/seed"
import { BACKGROUND_ENTITY_VIEWS } from "@/lib/s1/background"
import { ENTITY_VIEWS } from "@/lib/s1/seed"
import { BEATS } from "@/lib/s1/storyboard"
import {
  bundleRoundTripDiff,
  exportSedimentFromEvents,
  importSediment,
  serializeSediment,
} from "@/lib/s1/sediment"
import { stableStringify, type JsonValue } from "@/lib/s1/stable-json"
import { isAutonomous } from "@/lib/s1/verify"

/* -------------------------------------------------------------------------- */
/* 1 · 已揭示的消息                                                             */
/* -------------------------------------------------------------------------- */

/**
 * 游标包含这条消息吗？—— **直接复用数据层的判定**，不在这里重写一遍顺序规则
 * （`cursorIncludes` 是 `(revealedAtMs, seq)` 的全序，第 6/7 拍与第 14/15 拍
 * 共享同一个揭示时刻，只有带上序号才分得开）。
 */
function includes(cursor: ReplayCursor, message: IncidentMessage): boolean {
  if (message.revealedAtMs < cursor.revealedAtMs) return true
  if (message.revealedAtMs > cursor.revealedAtMs) return false
  return message.seq <= cursor.seq
}

/** 已揭示的消息前缀。**保持输入顺序**（时间轴的顺序就是权威顺序）。 */
export function revealedMessages(
  events: readonly IncidentMessage[],
  cursor: ReplayCursor | number,
): IncidentMessage[] {
  const boundary: ReplayCursor =
    typeof cursor === "number" ? { revealedAtMs: cursor, seq: Number.POSITIVE_INFINITY } : cursor
  const revealed: IncidentMessage[] = []
  for (const message of events) {
    if (!includes(boundary, message)) break
    revealed.push(message)
  }
  return revealed
}

/** 某一帧的游标：最后一条已揭示消息的位置（`seq` 带上，才能停在同一时刻的中间）。 */
export function frameOf(revealed: readonly IncidentMessage[]): ReplayCursor {
  const last = revealed[revealed.length - 1]
  if (last === undefined) return CURSOR_OPENING
  return { revealedAtMs: last.revealedAtMs, seq: last.seq }
}

/* -------------------------------------------------------------------------- */
/* 2 · 回放节奏（解说窗口内「同一时刻的多条消息」怎么落地）                        */
/* -------------------------------------------------------------------------- */

/**
 * 同一揭示时刻内的相邻两条消息之间，播放器停留多久。
 *
 * 为什么需要它：剧本里第 6/7 拍都是 `T+3.2s`、第 14/15 拍都是 `T+9.0s`
 * （数据层特意把序号放进游标，就是为了让这种中间状态**存在**）。如果播放器按毫秒直推，
 * 那个中间状态在 1 帧之内就滑过去了 —— 于是「AI 提交 1 项待授权」这句解说词
 * 永远看不到对应的画面，而「审批往返」也就没有往返。
 *
 * 所以播放器**按消息逐条揭示**，同一时刻内的第 k 条晚 `k × 320ms` 落地。
 * 剧本自己写明 `T+` 偏移「是示意，不是设计值……T+ 的偏移量是回放器自己的节奏」，
 * 这条节奏就是回放器给出的答案（种子 `openItems` 把「动效时序」列为开放项，正是这一条）。
 */
export const INTRA_INSTANT_DWELL_MS = 320

/** 两条相邻揭示之间的最小间隔，保证节奏严格递增（同一时刻的第 3 条不会追尾）。 */
export const MIN_REVEAL_STEP_MS = 40

export type ScheduleFrame = {
  /** 播放进度上的墙钟毫秒数。 */
  at: number
  /** 这一帧的游标。 */
  cursor: ReplayCursor
  /** 触发这一帧的消息序号（开场前缀为 `null`）。 */
  seq: number | null
  beatStep: number | null
}

/**
 * 播放排程：把消息序列翻译成「第几毫秒揭示第几条」。
 *
 * 出场（`revealedAtMs = -1`，即当日事件簿）不占排程：它们在演示开始前**已经在册**，
 * 所以第 0 帧就是 `CURSOR_OPENING`（顶栏此刻读 126 / 2，不是 0 / 0）。
 */
export function buildPlaybackSchedule(events: readonly IncidentMessage[]): ScheduleFrame[] {
  const frames: ScheduleFrame[] = [
    { at: 0, cursor: CURSOR_OPENING, seq: null, beatStep: null },
  ]
  let previousAt = 0
  let instant = Number.NaN
  let withinInstant = 0

  for (const message of events) {
    if (message.revealedAtMs < 0) continue

    if (message.revealedAtMs !== instant) {
      instant = message.revealedAtMs
      withinInstant = 0
    } else {
      withinInstant += 1
    }

    const wanted = message.revealedAtMs + withinInstant * INTRA_INSTANT_DWELL_MS
    const at = Math.max(wanted, previousAt + MIN_REVEAL_STEP_MS)
    previousAt = at
    frames.push({
      at,
      cursor: { revealedAtMs: message.revealedAtMs, seq: message.seq },
      seq: message.seq,
      beatStep: message.beatStep,
    })
  }

  return frames
}

/** 排程的总时长（毫秒）。 */
export function scheduleDurationMs(schedule: readonly ScheduleFrame[]): number {
  return schedule[schedule.length - 1]?.at ?? 0
}

/** 播放进度 → 那一帧（二分查找；进度超出末尾就停在最后一帧）。 */
export function frameAt(schedule: readonly ScheduleFrame[], progressMs: number): ScheduleFrame {
  if (schedule.length === 0) {
    return { at: 0, cursor: CURSOR_OPENING, seq: null, beatStep: null }
  }
  let low = 0
  let high = schedule.length - 1
  if (progressMs <= schedule[0].at) return schedule[0]
  if (progressMs >= schedule[high].at) return schedule[high]
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (schedule[mid].at <= progressMs) low = mid
    else high = mid - 1
  }
  return schedule[low]
}

/** 某一条消息在播放进度上的落地时刻（用于打字机）。找不到（开场前缀）就是 0。 */
export function revealAtOf(schedule: readonly ScheduleFrame[], seq: number): number {
  for (const frame of schedule) if (frame.seq === seq) return frame.at
  return 0
}

/** 上一条的批量形态：一次算好 序号 → 落地时刻，供每帧的打字机查（避免每帧线性扫描）。 */
export function revealTimesBySeq(schedule: readonly ScheduleFrame[]): Map<number, number> {
  const times = new Map<number, number>()
  for (const frame of schedule) if (frame.seq !== null) times.set(frame.seq, frame.at)
  return times
}

/**
 * 有固定时刻的节拍（第 18 拍「任意时刻」不在其中）。拍号 → 那一帧（精确匹配）。
 *
 * ⚠ 这是**精确**查询，第 18 拍它就是 `null`。要「跳到第 N 拍」请用
 * `frameForBeatRequest` —— 它负责把「没有帧的拍」夹到最近的**更晚**帧。
 */
export function frameOfBeat(schedule: readonly ScheduleFrame[], step: number): ScheduleFrame | null {
  let found: ScheduleFrame | null = null
  for (const frame of schedule) if (frame.beatStep === step) found = frame
  return found
}

/**
 * 「跳到第 N 拍」的**唯一**解析规则 —— 18 拍里任何一拍都要有落点。
 *
 * ## 为什么需要它（2026-09-17 实测缺陷）
 *
 * 剧本有 18 拍，但**没有任何消息带 `beatStep: 18`**：第 18 拍是「被盘问 · 任意时刻」，
 * 它由观众点击 ⑨ 问 S1 时才追加（`timeline.ts` 的 `askS1Message`，且那时才带上
 * `beatStep: 18`）。所以排程里没有第 18 拍的帧，而旧实现遇到 `null` 就**静默留在 0**：
 *
 * ```
 * ?beat=12 → 127/2 · T+8.00s      ?beat=17 → 128/3 · 回放结束
 * ?beat=18 → 126/2 · 尚未开场     ← 观众要最后一拍，看到的是开场
 * ```
 *
 * 「没有这一帧」与「回到开场」是两件事，把它们合成一件就是一次静默归零：
 * 深链发出去以后，收链接的人看到的是另一个画面，而且没有任何东西说它出了偏差。
 *
 * ## 规则
 *
 *   1. 有精确帧 → 用它；
 *   2. 没有 → 夹到**最接近的、更晚的**那一帧（拍号 ≥ 请求值的最小者）；
 *   3. 连更晚的也没有（请求值超过最后一拍）→ 夹到**排程上真实存在的最后一帧**。
 *
 * 夹取方向**只往前**：往后退会给出一个「比你要的更早」的画面，而观众要的是
 * 「这一拍之后的世界」。第 18 拍因此落在排程末尾那一帧上 —— 那是它在固定排程上
 * 唯一诚实的落点（第 18 拍本身由 ⑨ 按需追加，固定排程里没有它，所以「末尾那一帧」
 * 而不是 `CURSOR_END`：`CURSOR_END` 是无穷大的游标，界面上没有对应的帧可停）。
 *
 * 返回 `clamped` 标记，让界面能说出「你停在第 18 拍上，它的帧是追加出来的」，
 * 而不是假装精确命中了。
 */
export function frameForBeatRequest(
  schedule: readonly ScheduleFrame[],
  step: number,
): { frame: ScheduleFrame; clamped: boolean } | null {
  const exact = frameOfBeat(schedule, step)
  if (exact !== null) return { frame: exact, clamped: false }

  let later: ScheduleFrame | null = null
  for (const frame of schedule) {
    if (frame.beatStep === null || frame.beatStep < step) continue
    if (later === null || frame.beatStep < (later.beatStep ?? Number.POSITIVE_INFINITY)) later = frame
  }
  if (later !== null) return { frame: later, clamped: true }

  const last = schedule[schedule.length - 1]
  return last === undefined ? null : { frame: last, clamped: true }
}

/**
 * 剧本声明的全部拍号（1…18）。
 *
 * 它是「18 拍都跳得到」这条断言的对照物：`scheduledBeats(schedule)` 只有 17 个
 * （第 18 拍按需追加），所以「跳得到」必须在**请求入口**上成立，而不是在排程上。
 */
export function declaredBeats(): number[] {
  const steps = new Set<number>()
  for (const beat of BEATS) steps.add(beat.step)
  return [...steps].sort((a, b) => a - b)
}

/** 排程里出现过的拍号（升序、去重）—— 回放控制的「跳到第 N 拍」列表就是它。 */
export function scheduledBeats(schedule: readonly ScheduleFrame[]): number[] {
  const steps = new Set<number>()
  for (const frame of schedule) if (frame.beatStep !== null) steps.add(frame.beatStep)
  return [...steps].sort((a, b) => a - b)
}

/* -------------------------------------------------------------------------- */
/* 3 · ② 任务计划                                                               */
/* -------------------------------------------------------------------------- */

export type PlanRow = {
  id: string
  label: string
  actor: AgentActor
  detail: string | null
  state: PlanStepState
  /** 被重规划划掉的旧计划行 —— 界面上要**看得见地被划掉**。 */
  struck: boolean
}

/**
 * 计划清单。顺序由数据层给（`p0` 在前，然后 p1…p7），这里只投影。
 *
 * `p0` 是那个被划掉的旧方案（种子 `plan.replan.from` 引号内的原文）；
 * 它从第 3 拍就在清单里，第 9 拍被 `plan_update.supersedes` 划掉 —— 这正是
 * 「观众亲眼看到它临场改方案」的物质基础。
 */
export function planRows(state: IncidentState): PlanRow[] {
  return state.plan.steps.map((step) => ({
    id: step.id,
    label: step.label,
    actor: step.actor,
    detail: step.detail ?? null,
    state: step.state,
    struck: step.state === "superseded",
  }))
}

export function planProgress(state: IncidentState): { done: number; total: number } {
  return {
    done: state.plan.steps.filter((step) => step.state === "done").length,
    total: state.plan.steps.length,
  }
}

/** 计划的内容签名 —— 「这一屏动过没有」的机器判据（用于 90 秒定调那条断言）。 */
export function planSignature(state: IncidentState): string {
  return state.plan.steps.map((step) => `${step.id}:${step.state}`).join("|")
}

/** 重规划脚注（种子 `plan.replan`）；还没发生就是 `null`。 */
export function replanOf(state: IncidentState): { from: string; to: string } | null {
  return state.plan.replan
}

/** 计划面板的抬头（种子 `plan.eventId` / `plan.owner`）。 */
export function planHeaderOf(state: IncidentState): { eventId: string; owner: string } {
  return { eventId: state.plan.eventId || PLAN.eventId, owner: state.plan.owner || PLAN.owner }
}

/* -------------------------------------------------------------------------- */
/* 4 · ③ 研判流                                                                 */
/* -------------------------------------------------------------------------- */

export type FindingCard = {
  findingId: string
  conclusion: string
  confidencePercent: number
  evidenceRefs: EvidenceId[]
  extraChips: string[]
  nextStep: string | null
  sources: DataSourceId[]
  actor: AgentActor
  seq: number
  revealedAtMs: number
  occurredAt: string
}

const FINDING_INDEX: ReadonlyMap<string, SeedFinding> = new Map(
  FINDINGS.map((finding) => [finding.id, finding]),
)

/** 只收本回合的研判卡（`affects` 里有 `finding-stream`）。第 18 拍的回答走 `ask-s1`。 */
export function findingCards(revealed: readonly IncidentMessage[]): FindingCard[] {
  const cards: FindingCard[] = []
  for (const message of revealed) {
    if (!message.affects.includes("finding-stream")) continue
    if (message.kind !== "alert" && message.kind !== "context_package") continue
    const claim = message.claim
    if (claim === null) continue
    const detail = FINDING_INDEX.get(claim.findingId)
    cards.push({
      findingId: claim.findingId,
      conclusion: claim.conclusion,
      confidencePercent: Math.round(claim.confidence * 100),
      evidenceRefs: [...claim.evidenceRefs],
      // `extraChips` / `nextStep` 只写在种子的事实底本里（`Claim` 类型不带它们），
      // 所以这里按 findingId 连接一次 —— 连不上就是 `[]` / `null`，不编造。
      extraChips: detail?.extraChips === undefined ? [] : [...detail.extraChips],
      nextStep: detail?.nextStep ?? null,
      sources: [...claim.sources],
      actor: message.actor,
      seq: message.seq,
      revealedAtMs: message.revealedAtMs,
      occurredAt: message.occurredAt,
    })
  }
  return cards
}

/* -------------------------------------------------------------------------- */
/* 5 · ④ 工具控制台（处置说明卡 + 命令流）                                        */
/* -------------------------------------------------------------------------- */

/**
 * 说明卡的来源。
 *
 * `own` = 这条命令自己带 `brief`（本回合是 t1）；`session` = 本会话的会话级说明卡
 * （t2…t5 在种子里只有命令与回显，没有独立的 brief）。**两种情况都不编内容**：
 * 前者的原文来自种子的 `toolCalls[].brief`，后者复用同一会话里那张真实存在的卡。
 */
export type BriefSource = "own" | "session"

export type BriefEntry = {
  kind: "brief"
  key: string
  /** 这一卡所属的 tool_call 消息序号。 */
  seq: number
  revealedAtMs: number
  session: string | null
  /** 会话自己的声明（种子 `toolCalls[0].disclosure = "堡垒机托管会话 · 全程留痕"`）。 */
  disclosure: string | null
  source: BriefSource
  /** 种子里的说明卡原文（逐字），没有就是 `null`。 */
  briefText: string | null
  evidenceRefs: EvidenceId[]
  actionCode: ActionCode
  auto: boolean
  autonomy: AutonomyLevel
  approvalCardId: string | null
  /** 动作目录里的可回滚性与回滚窗口 —— 回滚一栏的出处。 */
  reversible: boolean
  rollbackWindowMs: number | null
  actor: AgentActor
  occurredAt: string
}

export type CommandEntry = {
  kind: "command"
  key: string
  seq: number
  revealedAtMs: number
  session: string | null
  /** 同 `BriefEntry.disclosure`：会话自己的声明，命令与说明卡共用同一行抬头。 */
  disclosure: string | null
  command: string
  output: string | null
  exitCode: number | null
  actor: AgentActor
  actionCode: ActionCode
  occurredAt: string
}

export type TranscriptEntry = BriefEntry | CommandEntry

/**
 * 会话名 → 会话自己的声明（种子 `toolCalls[0].disclosure`）。
 *
 * 建表而不是写死 `t1`：种子里**哪一条**命令带着 `disclosure` 是种子的事实，
 * 不是界面该记住的东西；这里只是把那一列摊成一张表，取不到就是取不到。
 */
const SESSION_DISCLOSURE: ReadonlyMap<string, string> = new Map(
  Object.values(TOOL_CALLS)
    .filter((call) => typeof call.session === "string" && typeof call.disclosure === "string")
    .map((call) => [call.session as string, call.disclosure as string]),
)

/**
 * 工具控制台的消息流：**每一条命令前面都紧跟一张处置说明卡**。
 *
 * 这条顺序不是界面排版，是**规则**：规格的硬要求是「观众看到的不是命令一闪而过」，
 * 所以这里由构造函数保证 `command` 的前一条必然是 `brief`（有测试逐条断言）。
 *
 * 范围：只收本回合（`beatStep !== null`）的 `tool_call`。当日事件簿里那 130 起闭环的
 * 处置命令属于顶栏的底噪，不属于这条堡垒机会话 —— 把它们倒进控制台会让 4 条真命令
 * 淹在 400 行里，而这一屏要看的正是那 4 条。
 */
export function workbenchTranscript(revealed: readonly IncidentMessage[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []
  let sessionBrief: string | null = null
  let session: string | null = null
  let disclosure: string | null = null

  for (const message of revealed) {
    if (message.kind !== "tool_call") continue
    if (message.beatStep === null) continue

    const policy = ACTION_CATALOG[message.actionCode]
    const rollbackWindowMs =
      "rollbackWindowMs" in policy && typeof policy.rollbackWindowMs === "number"
        ? policy.rollbackWindowMs
        : (message.rollbackWindowMs ?? null)
    const ownBrief = message.brief ?? null
    if (ownBrief !== null) sessionBrief = ownBrief
    if (message.session !== undefined && message.session !== null) {
      session = message.session
      // 会话抬头那半句（`disclosure`）**只写在种子的说明卡上**，不在消息信封里，
      // 所以按会话名连一次表 —— 连不上就是 `null`，由界面留空，不编一句。
      disclosure = SESSION_DISCLOSURE.get(message.session) ?? null
    }

    entries.push({
      kind: "brief",
      key: `${message.id}-brief`,
      seq: message.seq,
      revealedAtMs: message.revealedAtMs,
      session: message.session ?? session,
      disclosure,
      source: ownBrief === null ? "session" : "own",
      briefText: ownBrief ?? sessionBrief,
      evidenceRefs: [...message.evidenceRefs],
      actionCode: message.actionCode,
      auto: message.auto,
      autonomy: message.autonomy,
      approvalCardId: message.approvalCardId ?? null,
      reversible: policy.reversible,
      rollbackWindowMs,
      actor: message.actor,
      occurredAt: message.occurredAt,
    })

    if (message.command !== undefined && message.command !== null) {
      entries.push({
        kind: "command",
        key: `${message.id}-command`,
        seq: message.seq,
        revealedAtMs: message.revealedAtMs,
        session: message.session ?? session,
        disclosure,
        command: message.command,
        output: message.output ?? null,
        exitCode: message.exitCode ?? null,
        actor: message.actor,
        actionCode: message.actionCode,
        occurredAt: message.occurredAt,
      })
    }
  }

  return entries
}

/** 每条命令前面都有说明卡吗？—— 构造函数之外的第二道检查，测试也读它。 */
export function transcriptIsGuarded(entries: readonly TranscriptEntry[]): boolean {
  return entries.every((entry, index) => entry.kind !== "command" || entries[index - 1]?.kind === "brief")
}

/** 依据一栏要显示的证据（id + 标签），从登记簿解析；解析不到会响亮地抛（数据层的选择）。 */
export function evidenceLabelsFor(refs: readonly EvidenceId[]): string[] {
  return refs.map((id) => `证据${id} ${evidenceById(id).label}`)
}

/**
 * 证据 chip 点开之后要显示的东西 —— **全部来自证据登记簿 / 实体登记簿**。
 *
 * 这一层不做结论、不做推断：它就是那条证据自己的字段（编号、种类标签、数据源、
 * 指向的实体）。所以「点开证据」是一个真实的数据交互，而不是一次假的展开动画。
 */
export type EvidenceDetail = {
  id: EvidenceId
  label: string
  kind: string
  sourceLabel: string
  entityLabels: string[]
  missing: boolean
}

const DATA_SOURCE_LABEL: Readonly<Record<DataSourceId, string>> = Object.fromEntries(
  ENVIRONMENT.dataSources.map((source) => [source.id, `${source.label} · ${source.detail}`]),
) as Record<DataSourceId, string>

/** 数据源的中文标签（记录内容，来自种子 `environment.dataSources`）。 */
export function dataSourceLabelOf(source: DataSourceId | string): string {
  const found = ENVIRONMENT.dataSources.find((entry) => entry.id === source)
  return found === undefined ? String(source) : found.label
}

export function evidenceDetailOf(id: EvidenceId): EvidenceDetail {
  const item = evidenceById(id)
  return {
    id: item.id,
    label: item.label,
    kind: item.kind,
    sourceLabel: DATA_SOURCE_LABEL[item.source] ?? item.source,
    entityLabels: item.entityRefs.map((entityId) => entityIndexLabel(entityId)),
    missing: false,
  }
}

/**
 * 实体标签的安全查询：登记簿里没有就返回 id 本身（**不抛**）。
 * 为什么这里允许不抛：证据指向的实体是**展示用的从属信息**，
 * 主路径（证据本身解析不到）已经由 `evidenceById` 响亮地拦住了。
 */
function entityIndexLabel(entityId: string): string {
  return ENTITY_LABEL_BY_ID.get(entityId) ?? entityId
}

const ENTITY_LABEL_BY_ID: ReadonlyMap<string, string> = new Map(
  [...ENTITY_VIEWS, ...BACKGROUND_ENTITY_VIEWS].map((entity) => [entity.id, entity.label]),
)

/* -------------------------------------------------------------------------- */
/* 6 · 顶栏的派生计数（含「待人工授权 N 项」）                                     */
/* -------------------------------------------------------------------------- */

/**
 * 待人工授权条数 —— **派生值**，不是种子里的字面量。
 *
 * 出处与理由（顺带解决源设计稿的自相矛盾）：种子 `headerStats.liveStatus` 写
 * 「待人工授权 0 项」，而同一帧里 `actionCards[1]` 是带 137 秒 SLA 的待批卡 ——
 * 同一帧不可能同时为真。处置：把它做成与另三个计数同类的**派生量**，
 * 于是回放里它自己给出答案：
 *
 *   · 第 14 拍之前 = 0（此刻还没有待批卡；`liveStatus(0)` 逐字等于种子原文）
 *   · 第 14 拍     = 1（授权卡 a2 打开，停在人这道门上）
 *   · 第 15 拍之后 = 0（人已裁决，卡片状态翻转 —— 派生量的必然结果，不是矛盾）
 *
 * 定义：`disposition.cards` 里 `cardKind === "approval-required"` 且状态仍是
 * `pending` 的条数。当日事件簿里那两起人工闭环的卡都已经被自己的 `approval` 裁决过，
 * 所以开场时它读 0。
 */
export function pendingApprovalCount(state: IncidentState): number {
  return state.disposition.cards.filter(
    (card) => card.cardKind === "approval-required" && card.state === "pending",
  ).length
}

/** 卡片列表（右列的 ⑥ 是下一批的东西，这里只给计数与出处）。 */
export function approvalCardsOf(state: IncidentState) {
  return state.disposition.cards.filter((card) => card.cardKind === "approval-required")
}

/* -------------------------------------------------------------------------- */
/* 6b · ① 顶栏的两个「谁在干活」派生量（骨架读它们，不自己算）                     */
/* -------------------------------------------------------------------------- */

/**
 * 花名册里谁在干活 —— 最后一条**带 actor 的已揭示消息**里的那个 Agent。
 *
 * 只在四个数字员工的集合里取（`AGENT_ACTOR_SET`）：人工裁决那条消息的 actor 是「人工」，
 * 它不是花名册上的人，跳过而不是硬塞进一个座位。
 */
export function activeActorOf(revealed: readonly IncidentMessage[]): AgentActor | null {
  for (let index = revealed.length - 1; index >= 0; index -= 1) {
    const actor: string | undefined = (revealed[index] as { actor?: string }).actor
    if (actor !== undefined && AGENT_ACTOR_SET.has(actor)) return actor as AgentActor
  }
  return null
}

/** 本回合已经出现过的自主任档（升序，按 `AUTONOMY_LEVELS` 的顺序，不是出现顺序）。 */
export function observedAutonomyOf(revealed: readonly IncidentMessage[]): AutonomyLevel[] {
  const seen = new Set<AutonomyLevel>()
  for (const message of revealed) {
    if (message.kind === "tool_call" || message.kind === "action_card") seen.add(message.autonomy)
  }
  return AUTONOMY_LEVELS.filter((level) => seen.has(level))
}

/* -------------------------------------------------------------------------- */
/* 7 · 打字机与逐行回显（都由 `progressMs` 派生）                                 */
/* -------------------------------------------------------------------------- */

/** 结论级文本的打字速度（毫秒 / 字）。 */
export const FINDING_CHAR_MS = 18
/** 命令的打字速度（毫秒 / 字）—— 比结论稍慢，让「逐字打出」看得清。 */
export const COMMAND_CHAR_MS = 22
/** 回显行之间的间隔。 */
export const OUTPUT_LINE_MS = 180

/**
 * 打字机：给定「已经过去多久」，返回应当可见的前缀。
 *
 * `progressMs` 是播放进度，不是时钟；暂停时它不动，所以字也就不动。
 * `elapsed <= 0` 时返回空串 —— 这条消息还没开始揭示。
 */
export function typedPrefix(text: string, elapsedMs: number, charMs: number): string {
  if (elapsedMs <= 0) return ""
  const count = Math.min(text.length, Math.floor(elapsedMs / charMs))
  return text.slice(0, count)
}

/**
 * 回显逐行返回：第 n 行在第 n × 180ms 之后出现。
 *
 * 返回的数组**只包含已经开始显示的行**（`(空输出) …` 这类单行回显因此也是逐行语义）。
 */
export function visibleOutputLines(
  output: string | null,
  elapsedMs: number,
  lineMs: number = OUTPUT_LINE_MS,
): string[] {
  if (output === null || output.length === 0) return []
  const lines = output.split("\n")
  const visible: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    if (elapsedMs >= index * lineMs) visible.push(lines[index])
  }
  return visible
}

/* -------------------------------------------------------------------------- */
/* 8 · 「90 秒定调」的可测量形式                                                 */
/* -------------------------------------------------------------------------- */

/** 演示预算：从开场算起 90 秒（规格 §九 验收项）。 */
export const DEMO_BUDGET_MS = 90_000

export type PromptSignal = {
  id: "plan-in-motion" | "console-executing"
  /** 在**播放进度**上的毫秒数（1× 播放时等于墙钟秒数）。 */
  atMs: number
  /** 这一信号在事实上的出处（拍号 + 触发它的那条消息），不是形容词。 */
  evidence: string
}

/**
 * 两个「这不是传统安全产品」的信号各自的落地时刻。
 *
 * 定义（判据必须先写下来，否则它只是一句解说词）：
 *
 * · `plan-in-motion` —— 计划清单的**状态签名**发生第一次变化的那一刻。
 *   清单在第 3 拍出现，第 9 拍被重规划改写（`p0` 被划掉、`p5` 新增、`p6` 受阻），
 *   签名因此改变 ⇒ 「AI 在自主规划」不是一张静态截图。
 * · `console-executing` —— 控制台里第一条**带回显的命令**出现的那一刻。
 *   命令逐字打出、回显逐行返回（第 12 拍的 `rm` 带回显 `deleted: webshell6.jsp · exit 0`）。
 *
 * 两个时刻都取**排程**上的墙钟毫秒数，所以 `bothByMs ≤ 90_000` 是一条可复算的断言，
 * 而不是「看起来很快」；浏览器侧的墙钟测量在 `tests/s1-console.spec.ts` 里另有一条。
 */
export function promptSignals(
  events: readonly IncidentMessage[],
  schedule: readonly ScheduleFrame[] = buildPlaybackSchedule(events),
): { signals: PromptSignal[]; bothByMs: number; budgetMs: number } {
  let planSignatureSeen: string | null = null
  let planMoved: PromptSignal | null = null
  let consoleExecuted: PromptSignal | null = null

  for (const frame of schedule) {
    if (planMoved !== null && consoleExecuted !== null) break
    const revealed = revealedMessages(events, frame.cursor)
    const state = replayStreamQuiet(events, frame.cursor)

    if (state !== null) {
      const signature = planSignature(state)
      if (signature.length > 0) {
        if (planSignatureSeen === null) planSignatureSeen = signature
        else if (planMoved === null && signature !== planSignatureSeen) {
          planMoved = {
            id: "plan-in-motion",
            atMs: frame.at,
            evidence: `第 ${frame.beatStep ?? "?"} 拍 ${frame.seq === null ? "" : `消息 #${frame.seq} `}把计划签名从「${planSignatureSeen}」改成「${signature}」`,
          }
        }
      }
    }

    if (consoleExecuted === null) {
      const transcript = workbenchTranscript(revealed)
      const withOutput = transcript.find(
        (entry): entry is CommandEntry => entry.kind === "command" && entry.output !== null && entry.output.length > 0,
      )
      if (withOutput !== undefined) {
        consoleExecuted = {
          id: "console-executing",
          atMs: frame.at,
          evidence: `第 ${frame.beatStep ?? "?"} 拍的消息 #${withOutput.seq} 打出了命令并返回了回显`,
        }
      }
    }
  }

  const found = [planMoved, consoleExecuted].filter((signal): signal is PromptSignal => signal !== null)
  return {
    signals: found,
    bothByMs: found.reduce((max, signal) => Math.max(max, signal.atMs), 0),
    budgetMs: DEMO_BUDGET_MS,
  }
}

/**
 * `replayStream` 的安静版本：坏引用（数据层会抛）在这里返回 `null`，
 * 因为「测量信号」这件事不该被一条坏消息打断 —— 界面那条路径会照常响亮地报错。
 */
function replayStreamQuiet(
  events: readonly IncidentMessage[],
  cursor: ReplayCursor,
): IncidentState | null {
  try {
    return replayStream(events, cursor)
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------------- */
/* 10 · ⑤ 攻击链 · 实体视图                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 实体在画布上的位置 —— **正方形坐标（0–1）**，画布本身是正方形，所以两个轴同一个尺度。
 *
 * ## 为什么换过一次（2026-09-17 实测缺陷）
 *
 * 原来是 `aspect-ratio: 2` 的扁画布 + 百分比定位。看着省地方，直到节点里的**证据 chip 多起来**：
 * 画布只有 190px 高，而一个节点带 19 个 chip 时高 696px —— 节点被 `translate(-50%, -50%)`
 * 摆在画布中心，于是整块**向上溢出 309px**，最上面那个 chip 被面板正文的上沿切掉
 * （实测 overflow 12.29px）。扁画布 + 中心定位 = 溢出必然向上，正撞在面板头上。
 *
 * 方形画布把这条通路堵死：宽高同一个尺度，四个构图位置比原来分散。
 * 画布本身还有 `max-height` + `overflow: hidden`（见 `workbench.css`），
 * 于是**再多的 chip 也不会把画布撑破** —— 内容溢出被画布自己收住，
 * 不会外溢到面板上沿去切一行字。节点内 chip 仍是 `flex-wrap`，
 * 引用的**条数不受影响**（不变量 `evidence.every-claim-cites-a-source` 要的是
 * 「每一条引用都真实存在」，不是「只许显示三条」）。
 *
 * 为什么是相对坐标而不是像素：这一层不许出现视觉常量（仓规），而且画布尺寸一旦调整，
 * 像素坐标就要全改一遍。相对坐标只回答"谁在谁左边/上边"这个问题。
 *
 * 这些取值是**构图取值**，不是从事件流派生出来的量 —— 事件流不知道节点画在哪。
 * 所以它们集中在这里、有明显出处（设计稿 §三 ⑤ 的节点清单顺序），
 * 而不是散落在 JSX 里。谁被画出来、画成什么状态，全部由游标决定。
 */
const ATTACK_CHAIN_POSITION: Readonly<Record<string, { x: number; y: number }>> = {
  "attacker:0421": { x: 0.26, y: 0.26 },
  "asset:dmz-app01": { x: 0.74, y: 0.26 },
  "file:webshell2.jsp": { x: 0.74, y: 0.74 },
  "data:policy-db": { x: 0.26, y: 0.74 },
}

/**
 * 画布上**预留给已知实体**的格子。
 *
 * `ATTACK_CHAIN_POSITION` 用掉一格，剩下的给"位置表之外的新实体"。用格子而不是
 * `index % 2 / Math.floor(index / 2)` 那种取模公式，是因为取模**会撞上位置表**：
 * 2026-09-17 实测 `data:policy-db` 与 `file:webshell1.jsp` 拿到了同一个 (0.26, 0.74)，
 * 两个节点在画布上**逐像素重叠**（截图里那段文字互相压）。
 */
const ATTACK_CHAIN_SLOTS: readonly { x: number; y: number }[] = [
  { x: 0.26, y: 0.26 },
  { x: 0.74, y: 0.26 },
  { x: 0.5, y: 0.5 },
  { x: 0.74, y: 0.74 },
  { x: 0.26, y: 0.74 },
  { x: 0.5, y: 0.1 },
  { x: 0.1, y: 0.5 },
  { x: 0.9, y: 0.5 },
  { x: 0.5, y: 0.9 },
]

/**
 * 位置表之外的新实体：从**空格子**里按顺序领一个，绝不与任何已知节点重合。
 *
 * 判据是坐标本身（同一个格子 = 同一个落点），不是"第几个实体"—— 后者会随
 * 实体数量变化而漂移，前者是画布上可以直接核对的事实。
 */
function freeFallbackPositions(): { x: number; y: number }[] {
  const taken = Object.values(ATTACK_CHAIN_POSITION)
  return ATTACK_CHAIN_SLOTS.filter(
    (slot) => !taken.some((used) => used.x === slot.x && used.y === slot.y),
  )
}

/**
 * 画布上的实体节点。
 *
 * `evidenceRefs` 是**已揭示的、指向它的证据**（判据在 `evidenceCiteFor`）。
 * 空数组不是缺陷：那说明本回合事件流里还没有指向它的证据 —— 界面照实标出来
 * （`attackGraph.noCitation`），而不是给它编一条。不变量
 * `evidence.every-claim-cites-a-source` 要求的是「凡出现的引用都必须真实存在」，
 * 所以空引用是合法的，假引用不是。
 */
export type AttackNode = {
  id: EntityId
  kind: EntityView["kind"]
  label: string
  state: EntityView["state"]
  detail: string | null
  /** 已揭示证据里指向它的那些（去重、保持登记簿顺序）。 */
  evidenceRefs: EvidenceId[]
  x: number
  y: number
  /** 状态在本回合被改写过（例如 `webshell2.jsp` 从「定位完成」变成「已清除」）。 */
  stateChanged: boolean
}

export type AttackEdge = {
  from: EntityId
  to: EntityId
  /** 这条边是**哪条证据**支撑的 —— 边上的标签就是它（`证据#e-41 原始报文`）。 */
  evidenceRef: EvidenceId
  /** 同一条证据在两端各自的角色（`突破` / `植入` …），由实体自己的种子字段给出。 */
  fromRole: string | null
  toRole: string | null
}

export type AttackChain = {
  nodes: AttackNode[]
  edges: AttackEdge[]
  /** 有节点但没有一条边引用得到证据时为 `true` —— 界面用 `edgesNote` 解释这件事。 */
  edgesNoneCitable: boolean
  attacker: { id: EntityId; label: string; fingerprint: string; matches: number; evidenceRefs: EvidenceId[] } | null
}

/**
 * 实体 → 「谁指向它」的定性字段。
 *
 * 两个字段的语义**必须分清**，否则画布上会出现一句没有出处的断言：
 *
 *   · `target`  —— **引用关系**（"这条证据指向的实体"）。`#e-79 → file:webshell2.jsp`。
 *     它是种子里的真实字段，所以由它推出的边是**带证据**的边。
 *   · `detail`  —— **自由描述**（"回合3 · 新文件 · hash 比对中"）。它读起来像一句关系，
 *     但它不是引用。`data:policy-db` 的 `推演：横向移动目标` 就是这一种：把它画成一条边，
 *     等于把一句旁白升格成一条有据可查的攻击路径 —— 那正是不变量禁止的事。
 */
type EntitySeedDetail = { detail?: string; fingerprint?: string; fingerprintMatches?: number }

const ENTITY_SEED_DETAILS: ReadonlyMap<string, EntitySeedDetail> = new Map(
  ENTITY_VIEWS.map((entity) => [entity.id, entity as unknown as EntitySeedDetail]),
)

const ENTITY_VIEW_BY_ID: ReadonlyMap<EntityId, EntityView> = new Map(
  ENTITY_VIEWS.map((entity) => [entity.id, entity]),
)

/**
 * 这条证据"指向"这个实体吗？ —— 边与引用的**唯一**判据。
 *
 * 它只看 `entityRefs`（数据层的引用字段），不看 `detail` 那类自由描述。
 */
function evidenceCiteFor(
  evidence: readonly EvidenceItem[],
  entityId: EntityId,
): EvidenceId[] {
  return evidence.filter((item) => item.entityRefs.includes(entityId)).map((item) => item.id)
}

function isStageEntity(entityId: EntityId): boolean {
  return ENTITY_VIEW_BY_ID.has(entityId)
}

/**
 * ⑤ 的派生：**已被揭示的**实体及其真实引用。
 *
 * 三件事都随游标变化：
 *   · 哪些实体在画布上 —— 引用一旦揭示，它指向的实体就"长出来"（设计稿 §三 ⑤：
 *     「画布上长出一个新节点而不是一次性画好整张图」）；
 *   · 每个实体的状态 —— `state.entities` 是本回合效果改过的状态；
 *   · 每个实体身上的证据 —— 只算**已揭示**的那些。
 *
 * 边是**推出来的**：两端都能被同一条已揭示证据引用到，才有一条边。
 * 推不出来的关系不画 —— 宁可线少，不要一条看起来对的假线。
 */
export function attackChainOf(state: IncidentState, stream?: readonly IncidentMessage[]): AttackChain {
  /*
   * ## 画布只画**本回合自己**的证据（2026-09-17 实测缺陷）
   *
   * `state.evidence.items` 是一个**池子**：本回合的证据与当日事件簿那 130 起闭环的证据
   * 都往里放（后者经第 1–5 拍带进事件流）。照着池子画，画布上就出现一个 968px 高的节点 ——
   * `asset:dmz-app01` 一次性挂上 **19 个** chip，节点被 `translate(-50%, -50%)` 摆在画布中心，
   * 向上溢出 309px、把画布里的其它节点整个盖住（截图实拍：3 个节点叠在一起、文字互相压）。
   *
   * 判据：**消息带 `beatStep` 的才是本回合的**。当日事件簿的草稿没有 `beatStep`
   * （`timeline.ts` 的背景草稿不经过 `beatDraft`），所以这是一个来自数据层的事实，
   * 不是靠 id 前缀猜的。
   *
   * `stream` 传的是**整条事件流**，函数自己按 `state.cursor` 取已揭示的部分 ——
   * 这样纯函数路径（测试直接调它）与界面路径走的是同一套作用域，不会一边修好一边照旧。
   * 不传 `stream` 时退回池子（那是「没有事件流可依据」时的诚实降级）。
   */
  const scope =
    stream === undefined
      ? null
      : new Set(
          revealedMessages(stream, { revealedAtMs: state.cursor.revealedAtMs, seq: state.cursor.lastSeq })
            .filter((message) => message.beatStep !== null)
            .flatMap((message) => message.evidenceRefs),
        )
  const evidence = scope === null ? state.evidence.items : state.evidence.items.filter((item) => scope.has(item.id))
  const stage = state.entities.filter((entity) => isStageEntity(entity.id))

  /*
   * 位置表之外的实体从**空格子**里领位 —— 先算一次空闲格子，再按领取顺序往下发。
   * 领完（理论上不会）就退回位置表的第一个格子：宁可能重叠，也不要 `undefined` 坐标。
   */
  const freeSlots = freeFallbackPositions()
  let freeIndex = 0
  const nodes: AttackNode[] = stage.map((entity) => {
    const seedState = ENTITY_VIEW_BY_ID.get(entity.id)
    const details = ENTITY_SEED_DETAILS.get(entity.id)
    const slot = ATTACK_CHAIN_POSITION[entity.id] ?? freeSlots[freeIndex++] ?? ATTACK_CHAIN_POSITION["attacker:0421"]!
    const position = slot
    return {
      id: entity.id,
      kind: entity.kind,
      label: entity.label,
      state: entity.state,
      detail: details?.detail ?? null,
      evidenceRefs: evidenceCiteFor(evidence, entity.id),
      x: position.x,
      y: position.y,
      stateChanged: seedState !== undefined && seedState.state !== entity.state,
    }
  })

  const edges: AttackEdge[] = []
  for (const item of evidence) {
    const ends = nodes.filter((node) => item.entityRefs.includes(node.id))
    for (let a = 0; a < ends.length; a += 1) {
      for (let b = a + 1; b < ends.length; b += 1) {
        const from = ends[a] as AttackNode
        const to = ends[b] as AttackNode
        edges.push({
          from: from.id,
          to: to.id,
          evidenceRef: item.id,
          fromRole: ENTITY_SEED_DETAILS.get(from.id)?.detail ?? null,
          toRole: ENTITY_SEED_DETAILS.get(to.id)?.detail ?? null,
        })
      }
    }
  }

  const attackerEntity = nodes.find((node) => node.kind === "attacker") ?? null
  const attackerSeed = attackerEntity === null ? undefined : ENTITY_SEED_DETAILS.get(attackerEntity.id)

  return {
    nodes,
    edges,
    edgesNoneCitable: nodes.length > 0 && edges.length === 0,
    attacker:
      attackerEntity === null
        ? null
        : {
            id: attackerEntity.id,
            label: attackerEntity.label,
            fingerprint: attackerSeed?.fingerprint ?? "",
            matches: attackerSeed?.fingerprintMatches ?? 0,
            evidenceRefs: attackerEntity.evidenceRefs,
          },
  }
}

/**
 * 画布上引用的每个证据 id 都真实存在吗？—— 不变量
 * `evidence.every-claim-cites-a-source` 在画布侧的判据。
 *
 * 返回**不存在的那些引用**（空数组 = 通过）。对照物是 `knownEvidenceIds()`（登记簿），
 * 不是节点自己 —— 拿节点去比对节点，任何引用都会"解析得到"，探针就死了。
 */
export function attackChainUnresolvableRefs(chain: AttackChain): string[] {
  const known = knownEvidenceIds()
  const bad = new Set<string>()
  for (const node of chain.nodes) for (const ref of node.evidenceRefs) if (!known.has(ref)) bad.add(ref)
  for (const edge of chain.edges) if (!known.has(edge.evidenceRef)) bad.add(edge.evidenceRef)
  return [...bad]
}

/* -------------------------------------------------------------------------- */
/* 11 · ⑥ 处置与授权卡片区                                                      */
/* -------------------------------------------------------------------------- */

/** 授权卡上的一个字段（五件套的每一项都带自己的名字，界面不猜）。 */
export type AuthorityField = { key: string; label: string; value: string }

export type AuthorityCardView = {
  cardId: string
  cardKind: CardRecord["cardKind"]
  title: string
  actionCode: ActionCode
  autonomy: AutonomyLevel
  state: CardRecord["state"]
  /** 什么动作。 */
  what: string | null
  /** 依据：种子自己的 `basis`，以及这条卡引用的证据 id。 */
  basis: string
  impact: string
  rollback: string
  /** 替代方案只有待批卡有。 */
  alternative: string | null
  evidenceRefs: EvidenceId[]
  rollbackWindowMs: number | null
  slaMs: number | null
  slaTimeoutPolicy: string | null
  /** 三键（种子的 `actions`，逐字）。 */
  actions: readonly string[]
  /** 这张卡挂在计划的哪一步上。 */
  planStepId: string | null
  /**
   * **数据层判定的**自主执行许可 —— `isAutonomous(actionCode)`，与
   * `lib/s1/verify.ts` 的 `scanAuthority` 同一份判据源。
   * 界面不写"哪些动作能自动执行"这张表：那是数据层的事实。
   */
  autonomousAllowed: boolean
  /** 这张卡真的自动执行了吗（来自执行记录，不是来自卡片的声明）。 */
  executedAutomatically: boolean
  /** 裁决记录（人的那一下）。 */
  decision: ApprovalRecord["decision"] | null
  decidedAt: string | null
  /**
   * 来源消息序号 —— 「这一项能被追到哪条事件」的答案，也是 SLA 倒计时的锚点：
   * 界面用 `revealTimes.get(seq)` 把它换成播放进度上的时刻，所以倒计时**由游标派生**，
   * 没有自己的定时器；`?autoplay=0` 停在卡片刚打开那一帧时，剩余量正好是 `slaMs`。
   */
  seq: number
}

/**
 * ⑥ 的派生：把处置与授权卡投影成界面要读的形状。只有 `approval-required` 才算"待授权"。
 *
 * `actionLabels` 把**动作代号**换成界面词（`rotate-credential` → 「轮换凭据」）：
 * 代号是数据层的机器名，不是给人读的文案。当日事件簿那些闭环卡的标题由数据层拿
 * 代号拼出来（`rotate-credential · #b0041`），不换就会在中文界面里露出两行英文 ——
 * 这正是 2026-09-17 `/workbench` 零英文泄漏检查抓到的那条。
 *
 * 词典传进来而不是在这里 import：这一层不许依赖具体的某个 locale（换语言只加一个
 * `lib/i18n/*.ts`），而且纯函数才好在没有 DOM 的情况下被断言。
 */
export function authorityCardsOf(
  state: IncidentState,
  actionLabels: Readonly<Partial<Record<string, string>>> = {},
): AuthorityCardView[] {
  return state.disposition.cards.map((card) => {
    const executedAutomatically = state.disposition.toolCalls.some(
      (record) => record.actionCode === card.actionCode && record.auto,
    )
    const decision = state.disposition.approvals.find((record) => record.cardId === card.cardId) ?? null
    /*
     * 标题里的代号换成界面词。匹配的是**整个代号**（`^代号( · |$)`）而不是任意子串：
     * 卡片标题是本回合的完整句子（「修复上传接口扩展名白名单」）时就原样保留，
     * 只有当标题**就是**由代号拼出来的那种形态才替换。认不出的代号照原样显示 ——
     * 显示真名比显示一句编出来的中文诚实。
     */
    const code = card.actionCode as string
    const label = actionLabels[code]
    const title =
      label === undefined
        ? card.title
        : card.title === code
          ? label
          : card.title.startsWith(`${code} · `)
            ? `${label}${card.title.slice(code.length)}`
            : card.title

    return {
      cardId: card.cardId,
      cardKind: card.cardKind,
      title,
      actionCode: card.actionCode,
      autonomy: card.autonomy,
      state: card.state,
      what: card.five?.what ?? null,
      basis: card.five?.basis ?? card.basis,
      impact: card.five?.impact ?? card.impact,
      rollback: card.five?.rollback ?? card.rollback,
      alternative: card.five?.alternative ?? null,
      // 卡片自己的证据引用**不在 `CardRecord` 上**（数据层保存的是种子给的 `basis`
      // 文本，而 `evidenceRefs` 住在消息信封上），所以这里不提供 ——
      // 界面显示种子写的那句话，不把 `basis` 文本里的 `#e-79` 抠出来当成一条引用
      // （那会造出一条未经核对的引用，正是不变量禁止的事）。
      evidenceRefs: [],
      rollbackWindowMs: card.rollbackWindowMs,
      slaMs: card.slaMs,
      slaTimeoutPolicy: card.slaTimeoutPolicy,
      actions: card.actions,
      planStepId: card.planStepId,
      autonomousAllowed: isAutonomous(card.actionCode),
      executedAutomatically,
      decision: decision?.decision ?? null,
      decidedAt: decision?.at ?? null,
      seq: card.seq,
    }
  })
}

/**
 * SLA 剩余毫秒 —— **由游标派生**，不是独立定时器。
 *
 * `frozenAtMs` 是"卡片被揭示的那一刻"：`?autoplay=0` 停在卡片刚打开那一帧上时，
 * 剩余量因此正好是种子的 `sla.ms`（137000 → `02:17`，设计稿实测值）。
 *
 * 严格递减，且**永不为负**（超时策略是"挂起不执行"，所以剩余量减到 0 就停住）。
 */
export function slaRemainingMs(
  slaMs: number | null,
  revealedAtMs: number,
  progressMs: number,
): number | null {
  if (slaMs === null) return null
  const elapsed = Math.max(0, progressMs - revealedAtMs)
  return Math.max(0, slaMs - elapsed)
}

/** 毫秒 → `mm:ss`（SLA 与回滚窗口共用）。 */
export function clockOfMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

/* -------------------------------------------------------------------------- */
/* 12 · ⑧ 审计时间线                                                            */
/* -------------------------------------------------------------------------- */

export type AuditRowView = {
  entryId: string
  seq: number
  messageId: MessageId
  actor: ActorRef
  at: string
  action: string
  basisRefs: EvidenceId[]
  /** 这一行的**游标**：点它时把回放停在这里（时刻 + 序号，所以同刻的两行分得开）。 */
  cursor: ReplayCursor | null
}

/**
 * ⑧ 的派生：本回合自己的留痕（`scope: "incident"`），按事实时间排。
 *
 * `revealTimes` 是排程给出的「序号 → 播放进度上的揭示时刻」。它必须传进来：
 * `TimelineRow` 只带**事实时间**（`16:20:31` 那个），而"点这一行停在那一帧"要用的是
 * **回放时间**。两者是不同的时钟，拿事实时间去 seek 会落到排程里不存在的毫秒数上。
 * 取不到就是 `null`，界面把这一行渲染成不可跳转 —— 而不是跳到一个猜测的位置。
 */
export function auditRowsOf(
  state: IncidentState,
  revealTimes: ReadonlyMap<number, number>,
): AuditRowView[] {
  return [...state.timeline]
    .sort((a, b) => a.occurredAtMs - b.occurredAtMs || a.seq - b.seq)
    .map((row) => {
      const revealedAtMs = revealTimes.get(row.seq)
      return {
        entryId: `a${String(row.seq).padStart(3, "0")}`,
        seq: row.seq,
        messageId: row.messageId,
        actor: row.actor,
        at: row.at,
        action: row.action,
        basisRefs: [...row.basisRefs],
        cursor: revealedAtMs === undefined ? null : { revealedAtMs, seq: row.seq },
      }
    })
}

/* -------------------------------------------------------------------------- */
/* 13 · ⑪ 战果与沉淀面板                                                        */
/* -------------------------------------------------------------------------- */

export type SedimentItemView = {
  id: string
  label: string
  kind: SedimentItem["kind"]
  sourceRefs: string[]
}

/** ⑪ 的派生：沉淀条目（`state.sediment`）。 */
export function sedimentItemsOf(state: IncidentState): SedimentItemView[] {
  return state.sediment.map((item) => ({
    id: item.id,
    label: item.label,
    kind: item.kind,
    sourceRefs: [...item.sourceRefs],
  }))
}

/**
 * 导出物的**文本**（键序稳定）—— 界面把这段文本写剪贴板 / 写文件。
 *
 * 纯函数：同一个状态 + 同一个事件序列 → 同一个字符串，所以它可以在没有 DOM 的
 * 情况下被断言（`tests/s1-console.spec.ts`），也可以在浏览器里被断言同一件事。
 */
export function exportSedimentText(
  state: IncidentState,
  events: readonly IncidentMessage[],
): string {
  return serializeSediment(exportSedimentFromEvents(state, events))
}

/**
 * 把一段导出的 JSON 与**当前状态**逐条比对 —— 不变量 `sediment.survives-export`
 * 在 ⑪ 面板上的判据。
 *
 * 三条检查，缺一条这句话就只是"看起来没问题"：
 *
 *   1. **能解析**：这段文本是一份合法导出物（字段集合封闭，`importSediment` 不合形状就报错）；
 *   2. **逐条等价**：导入的 bundle 与"此刻重新导出一次"的 bundle 序列化后逐字符相同
 *      —— 条目、计数、裁决记录、事件链都在这一份字符串里；
 *   3. **往返稳定**：数据层自己的 `sedimentRoundTripDiff` 为空（导出→导入→再导出不漂移）。
 *
 * 复用的是数据层自己的实现，不在这里另写一套：两套实现之间的差异会变成
 * "界面看着对、数据层其实是坏的"，而那条不变量守的正是数据层。
 */
export function verifySedimentImport(
  json: string,
  state: IncidentState,
  events: readonly IncidentMessage[],
): { parseIssues: string[]; diffs: string[] } {
  const fresh = exportSedimentFromEvents(state, events)
  const parsed = importSediment(json)
  if (!parsed.ok) {
    return { parseIssues: parsed.issues.map((issue) => `${issue.code} @ ${issue.path}`), diffs: [] }
  }

  const diffs: string[] = []
  if (stableStringify(parsed.bundle as unknown as JsonValue) !== stableStringify(fresh as unknown as JsonValue)) {
    diffs.push("导入的沉淀物与当前状态不等价")
  }
  // 同一个 bundle 也要能经得起数据层自己的往返检查（导出→导入→再导出不漂移）。
  diffs.push(...bundleRoundTripDiff(parsed.bundle))
  return { parseIssues: [], diffs }
}

/* -------------------------------------------------------------------------- */
/* 12b · ⑧ / ⑪ 的游标工具（两边共用一处实现）                                    */
/* -------------------------------------------------------------------------- */

/**
 * 游标的字符串形式：`时刻:序号`。
 *
 * 它是「点了一行之后，回放真的停在那一帧上吗」这条断言的**对照物**：DOM 上的
 * `data-cursor-key` 与 `data-replay-cursor-ms` 必须来自同一个游标。序号不能省 ——
 * 剧本第 6/7 拍与 14/15 拍共享同一个揭示时刻，只比毫秒的话，点第 8 拍那条
 * 「16:20:38」与点第 7 拍那条会得到同一个读数，而那两行是不同的两行。
 */
export function cursorKey(cursor: ReplayCursor | null): string {
  return cursor === null ? "" : `${cursor.revealedAtMs}:${cursor.seq}`
}

/* -------------------------------------------------------------------------- */
/* 14 · 常量再导出（测试与界面共用的出处）                                       */
/* -------------------------------------------------------------------------- */

export { INCIDENT_ID, PLAN_STEPS }
