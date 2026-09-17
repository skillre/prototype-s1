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
  AGENT_ACTORS,
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
import { FINDINGS, ENVIRONMENT, HEADER_STATS_SIGNED, INCIDENT_ID, PLAN, PLAN_STEPS, REPORT, TOOL_CALLS, type SeedFinding } from "@/lib/s1/seed"
import { ASK_S1_ANSWERS, ASK_S1_QUESTIONS, type AskS1Answer } from "@/lib/s1/timeline"
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
 * 实体在画布上的落点 —— **由图的形状算出来的层与列**，不是手写的格子。
 *
 * ## 为什么换掉手写格子（2026-09-17 实测缺陷，本批修的）
 *
 * 旧实现是「正方形画布 + 百分比坐标 + `translate(-50%, -50%)` 居中」，
 * 落点来自一张手写的 `ATTACK_CHAIN_POSITION` 表，表外的实体从若干"空格子"里领位。
 * 它守住了「两个节点不落在同一个坐标上」，但**坐标不同不等于矩形不相交**：
 * 画布 444×444，节点宽 202px、高 98–216px，四个格子中任意两个的间距
 * （0.48 × 444 ≈ 213px）小于一个节点的宽或高 —— 于是**六个节点在四个格子里视觉上互相压**
 * （截图实拍）。
 *
 * 根因不是坐标选得不好，而是**手写格子与内容尺寸之间没有任何关系**：
 * 节点的宽高由它自己的内容（标签 + 状态词 + detail + 证据 chip）决定，
 * 而格子是常量。只要内容变了，格子就不再成立。
 *
 * ## 现在怎么算
 *
 * 两步，都是从图本身推出来的（层次布局 / Sugiyama 的前两步 + 重心排序）：
 *
 *   1. **分层**：先把边定向 —— 一律从「对象模型里更浅的一端」指向更深的一端。
 *      对象模型的顺序就是设计稿 §三 ⑤ 的副题原文：`人-资产-文件-进程-数据`。
 *      于是边不可能成环，可以在一个 pass 里算出最长路径层号：
 *      `rank(v) = max(类型深度(v), max over 入边 (rank(u) + 1))`。
 *      没有边的孤立实体因此落在它自己类型的深度上 —— 读起来就是那张对象模型。
 *   2. **层内排序**：一次向下的重心（barycenter）扫描，让每一层的节点尽量靠近
 *      它在上一层的邻居（有向边的两端因此不会左右交叉）。无前驱的节点保持原序，排序稳定。
 *
 * 层号随后**压实成连续的排号**（第 0 排、第 1 排……），所以画布上不会出现空排。
 *
 * ## 为什么这样就不会再压
 *
 * 落点现在是**格子的行列区间**，而不是一个点 + 居中位移：
 * 同一排的节点拿到的是**互不相交的列区间**（`columnStart` / `columnSpan`），
 * 不同排的节点在竖直方向上本来就不重叠。于是"不相交"由**区间不相交**保证，
 * 而区间是按内容所在的排分配的 —— 内容长高了，长的是那一排的高度，不是往邻居身上压。
 *
 * 这条性质有两道判据：纯函数侧断言同排列区间两两不相交（`tests/s1-panels.spec.ts`），
 * 浏览器侧直接量 `getBoundingClientRect()` 断言任意两个节点的矩形不相交。
 */
const ENTITY_KIND_DEPTH: Readonly<Record<EntityView["kind"], number>> = {
  attacker: 0,
  asset: 1,
  file: 2,
  data: 3,
}

/** 一个节点在画布上的落点：第几排、排内第几个、占第几列到第几列（1 起的网格线）。 */
export type AttackNodeSlot = {
  rank: number
  order: number
  columnStart: number
  columnSpan: number
}

/** 画布的形状 —— 排数与列数，由布局给出，组件按它铺网格。 */
export type AttackLayout = {
  /** 排数（层号已经压实成 0…rankCount−1）。 */
  rankCount: number
  /** 列数 = 最宽那一排的节点数（至少 1）。 */
  columnCount: number
}

/**
 * 层与列的唯一算法（纯函数，不读时钟、不随机、不依赖迭代顺序）。
 *
 * 输入只有两样：节点（id + 类型）与边（两端 id）。位置表、画布尺寸、像素都不进来 ——
 * 它回答的是"谁在第几排、排内排第几、占哪几列"，不是"画在哪一像素"。
 */
export function attackChainLayout(
  nodes: readonly { id: EntityId; kind: EntityView["kind"] }[],
  edges: readonly { from: EntityId; to: EntityId }[],
): { slots: Map<EntityId, AttackNodeSlot>; layout: AttackLayout } {
  const kindOf = new Map(nodes.map((node) => [node.id, node.kind]))
  const depthOf = (id: EntityId): number => ENTITY_KIND_DEPTH[kindOf.get(id) ?? "asset"]
  const inputIndex = new Map(nodes.map((node, index) => [node.id, index]))

  /* 1 · 定向。同深度之间的边（理论上不该有）不参与分层，但也不丢 —— 它仍然是一条边。 */
  const outgoing = new Map<EntityId, EntityId[]>()
  const incoming = new Map<EntityId, EntityId[]>()
  for (const edge of edges) {
    if (!kindOf.has(edge.from) || !kindOf.has(edge.to) || edge.from === edge.to) continue
    const forward = depthOf(edge.from) <= depthOf(edge.to)
    const from = forward ? edge.from : edge.to
    const to = forward ? edge.to : edge.from
    if (depthOf(from) === depthOf(to)) continue
    const outs = outgoing.get(from) ?? []
    if (!outs.includes(to)) outs.push(to)
    outgoing.set(from, outs)
    const ins = incoming.get(to) ?? []
    if (!ins.includes(from)) ins.push(from)
    incoming.set(to, ins)
  }

  /* 2 · 分层：最长路径。初值取类型深度，边只能把它推得更深；按深度递增处理即拓扑序。 */
  const rank = new Map<EntityId, number>(nodes.map((node) => [node.id, depthOf(node.id)]))
  const byDepth = [...nodes].sort(
    (a, b) => depthOf(a.id) - depthOf(b.id) || (inputIndex.get(a.id) ?? 0) - (inputIndex.get(b.id) ?? 0),
  )
  for (const node of byDepth) {
    for (const next of outgoing.get(node.id) ?? []) {
      rank.set(next, Math.max(rank.get(next) ?? 0, (rank.get(node.id) ?? 0) + 1))
    }
  }

  /* 3 · 层内排序：一次向下的重心扫描（稳定）。 */
  const distinctRanks = [...new Set(rank.values())].sort((a, b) => a - b)
  const layers = new Map<number, EntityId[]>(
    distinctRanks.map((value) => [
      value,
      nodes.filter((node) => rank.get(node.id) === value).map((node) => node.id),
    ]),
  )
  const position = new Map<EntityId, number>()
  for (const value of distinctRanks) {
    layers.get(value)?.forEach((id, index) => position.set(id, index))
  }
  for (const value of distinctRanks.slice(1)) {
    const layer = layers.get(value) ?? []
    const barycenter = new Map<EntityId, number>()
    layer.forEach((id, index) => {
      const predecessors = (incoming.get(id) ?? [])
        .map((parent) => position.get(parent))
        .filter((value): value is number => value !== undefined)
      barycenter.set(
        id,
        predecessors.length === 0
          ? index
          : predecessors.reduce((sum, value) => sum + value, 0) / predecessors.length,
      )
    })
    layer.sort(
      (a, b) =>
        (barycenter.get(a) ?? 0) - (barycenter.get(b) ?? 0) ||
        (position.get(a) ?? 0) - (position.get(b) ?? 0),
    )
    layer.forEach((id, index) => position.set(id, index))
  }

  /* 4 · 列区间：第 r 排的 k 个节点把 columnCount 列**均分**，区间两两不相交（本题的核心保证）。 */
  const rankCount = distinctRanks.length
  const columnCount = Math.max(1, ...[...layers.values()].map((layer) => layer.length))
  const slots = new Map<EntityId, AttackNodeSlot>()
  distinctRanks.forEach((value, rankIndex) => {
    const layer = layers.get(value) ?? []
    layer.forEach((id, order) => {
      const start = Math.floor((order * columnCount) / layer.length) + 1
      const end = Math.floor(((order + 1) * columnCount) / layer.length) + 1
      slots.set(id, {
        rank: rankIndex,
        order,
        columnStart: start,
        columnSpan: Math.max(1, end - start),
      })
    })
  })

  return { slots, layout: { rankCount: Math.max(1, rankCount), columnCount } }
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
  /** 落点（层次布局算出来的排与列区间，见 `attackChainLayout`）。 */
  slot: AttackNodeSlot
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
  /** 画布形状（排数 / 列数）—— 组件按它铺网格，测试按它判「同排列区间不相交」。 */
  layout: AttackLayout
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
   * 边先算出来，位置后算 —— 顺序不能反：落点是**图的形状**的函数（见 `attackChainLayout`），
   * 而图的形状就是这批边。旧实现反过来（先按 index 发格子、再连边），
   * 于是位置与连接关系毫无关系，孤立节点和枢纽节点拿到同样的待遇。
   */
  const edges: AttackEdge[] = []
  for (const item of evidence) {
    const ends = stage.filter((entity) => item.entityRefs.includes(entity.id))
    for (let a = 0; a < ends.length; a += 1) {
      for (let b = a + 1; b < ends.length; b += 1) {
        const from = ends[a] as EntityView
        const to = ends[b] as EntityView
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

  const { slots, layout } = attackChainLayout(
    stage.map((entity) => ({ id: entity.id, kind: entity.kind })),
    edges,
  )
  const emptySlot: AttackNodeSlot = { rank: 0, order: 0, columnStart: 1, columnSpan: 1 }

  const nodes: AttackNode[] = stage.map((entity) => {
    const seedState = ENTITY_VIEW_BY_ID.get(entity.id)
    const details = ENTITY_SEED_DETAILS.get(entity.id)
    return {
      id: entity.id,
      kind: entity.kind,
      label: entity.label,
      state: entity.state,
      detail: details?.detail ?? null,
      evidenceRefs: evidenceCiteFor(evidence, entity.id),
      slot: slots.get(entity.id) ?? emptySlot,
      stateChanged: seedState !== undefined && seedState.state !== entity.state,
    }
  })

  const attackerEntity = nodes.find((node) => node.kind === "attacker") ?? null
  const attackerSeed = attackerEntity === null ? undefined : ENTITY_SEED_DETAILS.get(attackerEntity.id)

  return {
    nodes,
    edges,
    layout,
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
 * 这串证据引用里哪些**不在登记簿上**？—— 空数组 = 全部可定位。
 *
 * 对照物是 `knownEvidenceIds()`（登记簿），不是引用它自己的那批消息 ——
 * 拿消息去比对消息，任何引用都会"解析得到"，探针就死了。
 *
 * 它是所有「引用必须可定位」判据的**唯一一份实现**：画布（`attackChainUnresolvableRefs`）
 * 与 ⑨ 问 S1 的回答都走它，免得两处各写一遍、其中一处悄悄放宽。
 */
export function unresolvableEvidenceRefs(refs: readonly EvidenceId[]): EvidenceId[] {
  const known = knownEvidenceIds()
  return [...new Set(refs.filter((ref) => !known.has(ref)))]
}

/**
 * 画布上引用的每个证据 id 都真实存在吗？—— 不变量
 * `evidence.every-claim-cites-a-source` 在画布侧的判据。
 *
 * 返回**不存在的那些引用**（空数组 = 通过）。
 */
export function attackChainUnresolvableRefs(chain: AttackChain): string[] {
  return unresolvableEvidenceRefs([
    ...chain.nodes.flatMap((node) => node.evidenceRefs),
    ...chain.edges.map((edge) => edge.evidenceRef),
  ])
}

/**
 * 落点重叠的实体对 —— 布局的**纯函数判据**，`[]` = 没有任何两个节点会挤在一起。
 *
 * 判据分两半，缺一不可：
 *   · 同一排里，两个节点的列区间不得相交（`[start, start+span)` 区间判交）；
 *   · 不同排的节点在竖直方向上互不重叠，所以不必比。
 *
 * 为什么不用「矩形相交」在这里判：这一层没有像素，也不该有 ——
 * 矩形是**浏览器布局的产物**，那一条判据在浏览器侧量 `getBoundingClientRect()`
 * （`tests/s1-panels.spec.ts`）。两条合起来才是完整的保证：
 * 这里证明"格子本身不重叠"，那边证明"浏览器真的按格子摆"。
 */
export function attackChainOverlaps(
  chain: AttackChain,
): Array<{ a: EntityId; b: EntityId; rank: number }> {
  const overlaps: Array<{ a: EntityId; b: EntityId; rank: number }> = []
  for (let i = 0; i < chain.nodes.length; i += 1) {
    for (let j = i + 1; j < chain.nodes.length; j += 1) {
      const a = chain.nodes[i] as AttackNode
      const b = chain.nodes[j] as AttackNode
      if (a.slot.rank !== b.slot.rank) continue
      const aEnd = a.slot.columnStart + a.slot.columnSpan
      const bEnd = b.slot.columnStart + b.slot.columnSpan
      if (a.slot.columnStart < bEnd && b.slot.columnStart < aEnd) {
        overlaps.push({ a: a.id, b: b.id, rank: a.slot.rank })
      }
    }
  }
  return overlaps
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
 * `data-replay-cursor-key` 与 `data-replay-cursor-ms` 必须来自同一个游标。序号不能省 ——
 * 剧本第 6/7 拍与 14/15 拍共享同一个揭示时刻，只比毫秒的话，点第 8 拍那条
 * 「16:20:38」与点第 7 拍那条会得到同一个读数，而那两行是不同的两行。
 */
export function cursorKey(cursor: ReplayCursor | null): string {
  return cursor === null ? "" : `${cursor.revealedAtMs}:${cursor.seq}`
}

/* -------------------------------------------------------------------------- */
/* 15 · ⑨ 问 S1                                                                */
/* -------------------------------------------------------------------------- */

/**
 * ⑨ 的判据是 `evidence.every-claim-cites-a-source` 在**对话**上的形态：
 * 回答里的每个结论都带证据引用，引用能在登记簿里定位，**答不出就明说答不出**。
 *
 * 所以这一层只做两件事：
 *   · 把提问对到数据层**真的写过答案**的那三条上（对不上就是 null，不是"尽力猜"）；
 *   · 把已揭示的回答投影成界面要读的形状。
 *
 * 它**不会**在没有答案时编一个：`askS1AnswerFor` 返回 `null`，由界面渲染
 * 「答不出」那段话。这正是「问一个答不出证据的问题时，界面明说答不出」的实现方式。
 */

/** 有出处的三个问题（种子 `askS1` 的占位提示 + 两个快捷问）。 */
export function askS1Questions(): readonly string[] {
  return ASK_S1_QUESTIONS
}

/**
 * 提问 → 数据层的答案。
 *
 * 匹配是**整句相等**（去掉首尾空白），不做模糊匹配：把「现在最大风险大概是啥」判给
 * 「现在最大风险是什么？」看起来贴心，实际上是把别人的答案当成你的问题的答案 ——
 * 那正是这条不变量禁止的那类"像真的"。
 */
export function askS1AnswerFor(question: string): { presetIndex: number; answer: AskS1Answer } | null {
  const wanted = question.trim()
  if (wanted.length === 0) return null
  const index = ASK_S1_ANSWERS.findIndex((entry) => entry.question === wanted)
  if (index < 0) return null
  return { presetIndex: index, answer: ASK_S1_ANSWERS[index] as AskS1Answer }
}

/** 提问为什么答不出 —— 界面按它选措辞（两种原因不是同一件事）。 */
export type AskS1Refusal = "empty" | "unmatched"

export function askS1RefusalFor(question: string): AskS1Refusal | null {
  if (question.trim().length === 0) return "empty"
  return askS1AnswerFor(question) === null ? "unmatched" : null
}

/** 一条已经出现在屏幕上的回答。 */
export type AskS1AnswerView = {
  messageId: MessageId
  seq: number
  /** 这条回答对应的问题原文（由 `claim.findingId` 连回种子的答案表，连不上就是 null）。 */
  question: string | null
  conclusion: string
  confidencePercent: number
  evidenceRefs: EvidenceId[]
  sources: DataSourceId[]
  occurredAt: string
}

/** `claim.findingId` → 预置问题序号（`ask-0` / `ask-1` / `ask-2`，见 `timeline.askS1Message`）。 */
function askPresetIndexOf(findingId: string): number | null {
  const match = /^ask-(\d+)$/.exec(findingId)
  if (match === null) return null
  const index = Number(match[1])
  return Number.isInteger(index) && index >= 0 && index < ASK_S1_ANSWERS.length ? index : null
}

/**
 * ⑨ 的回答 —— 只收 `affects` 里有 `ask-s1` 的已揭示消息（第 18 拍那条按需追加的）。
 *
 * 它在**整条序列**上筛选而不是只挑最后一条：观众可以连问三次，三次的回答都留在屏幕上
 * （每一次都带自己的出处），而不是后一次把前一次顶掉 —— 顶掉会让"我问过什么"这件事消失。
 */
export function askS1AnswersOf(revealed: readonly IncidentMessage[]): AskS1AnswerView[] {
  const answers: AskS1AnswerView[] = []
  for (const message of revealed) {
    if (message.kind !== "alert") continue
    if (!message.affects.includes("ask-s1")) continue
    const claim = message.claim
    if (claim === null) continue
    const index = askPresetIndexOf(claim.findingId)
    answers.push({
      messageId: message.id,
      seq: message.seq,
      question: index === null ? null : (ASK_S1_ANSWERS[index]?.question ?? null),
      conclusion: claim.conclusion,
      confidencePercent: Math.round(claim.confidence * 100),
      evidenceRefs: [...claim.evidenceRefs],
      sources: [...claim.sources],
      occurredAt: message.occurredAt,
    })
  }
  return answers
}

/** 回答里有没有定位不到的证据引用？（空数组 = 每条引用都在登记簿上。） */
export function askS1UnresolvableRefs(answers: readonly AskS1AnswerView[]): EvidenceId[] {
  return unresolvableEvidenceRefs(answers.flatMap((answer) => answer.evidenceRefs))
}

/** 提问被送出之后发生了什么 —— 界面据此决定要不要渲染「答不出」。 */
export type AskS1Submit =
  | { kind: "answered"; presetIndex: number }
  | { kind: "refused"; reason: AskS1Refusal; question: string }

/**
 * 提交一次提问 —— **唯一的判据入口**（纯函数，所以它能被直接断言）。
 *
 * 调用方（组件）拿到 `answered` 才去 append 一条消息；拿到 `refused` 就把原因显示出来。
 * 于是"界面明说答不出"这件事不依赖组件里的某段 `if`，它在派生层就定了。
 */
export function askS1Submit(question: string): AskS1Submit {
  const match = askS1AnswerFor(question)
  if (match !== null) return { kind: "answered", presetIndex: match.presetIndex }
  return { kind: "refused", reason: askS1RefusalFor(question) ?? "unmatched", question }
}

/* -------------------------------------------------------------------------- */
/* 16 · ⑩ E+N 数据汇流管道                                                      */
/* -------------------------------------------------------------------------- */

/**
 * ⑩ 的判据是 `evidence.counters-derive-from-events` 在**管道**上的形态：
 * 图上每个数字都是数出来的。
 *
 * 所以这一层里没有一个字面量计数：两路的证据条数、消息条数、汇流耗时、置信度、
 * 消费掉的结论条数，全部从**已揭示的、本回合自己的**消息上数出来。
 * 唯一从这里"过路"的记录内容是数据源自己的名字与说明（种子 `environment.dataSources`）。
 *
 * ## 为什么范围限定在本回合
 *
 * 与 ⑤ 画布同一条判据（`beatStep !== null`）：当日事件簿那 130 起闭环的证据若一起倒进来，
 * 管道上会显示几百条 —— 那个数字是真的，但它不是这一帧要讲的事。
 */

export type PipelineLaneView = {
  source: DataSourceId
  /** 数据源自己的名字（种子记录内容，不翻译）。 */
  label: string
  /** 数据源自己的说明（`镜像 #p-102 · 10Gbps`）。 */
  detail: string
  /** 这一路自己的能力声明；种子没写就是 `null`（界面留空，不编一句）。 */
  capability: string | null
  /** 本回合已揭示的、来自这一路的证据（按首次出现顺序）。 */
  evidenceRefs: EvidenceId[]
  /** = `evidenceRefs.length`，做成字段是为了让界面读它而不必自己 `.length`。 */
  evidenceCount: number
  /** 提到这一路的已揭示消息条数（告警的 `source` / `alsoFrom` 或结论的 `sources`）。 */
  messageCount: number
}

export type PipelinePackageView = {
  messageId: MessageId
  seq: number
  /** 上下文包自己的标签（种子 `contextPackage.label`，例如 `{app01 · conf .93 · ev[…]}`）。 */
  label: string
  /** 汇流标注（种子 `contextPackage.merge`）。 */
  mergeLabel: string
  /** 汇流耗时（种子 `findings[1].elapsedMs = 930`）。 */
  mergeElapsedMs: number
  confidencePercent: number
  evidenceRefs: EvidenceId[]
  sources: DataSourceId[]
  occurredAt: string
}

export type PipelineView = {
  lanes: PipelineLaneView[]
  /** 最后一个已揭示的上下文包；还没汇流就是 `null`。 */
  packageView: PipelinePackageView | null
  /** AI 研判消费：已揭示的结论里，双源合流 / 单源各多少条。 */
  consumed: { merged: number; singleSource: number; total: number }
}

/** 一条消息"提到"了哪几路数据源（告警的两路 + 结论自己的 `sources`）。 */
function sourcesOf(message: IncidentMessage): DataSourceId[] {
  const found = new Set<DataSourceId>()
  if (message.kind === "alert") {
    found.add(message.source)
    if (message.alsoFrom !== undefined) found.add(message.alsoFrom)
  }
  const claim = "claim" in message ? message.claim : null
  if (claim !== null && claim !== undefined) for (const source of claim.sources) found.add(source)
  return [...found]
}

export function pipelineOf(revealed: readonly IncidentMessage[]): PipelineView {
  const scope = revealed.filter((message) => message.beatStep !== null)

  const lanes: PipelineLaneView[] = ENVIRONMENT.dataSources.map((source) => {
    const evidenceRefs: EvidenceId[] = []
    let messageCount = 0
    for (const message of scope) {
      if (sourcesOf(message).includes(source.id as DataSourceId)) messageCount += 1
      for (const ref of message.evidenceRefs) {
        if (evidenceRefs.includes(ref)) continue
        // 证据属于哪一路由**登记簿**说了算（`evidenceById(ref).source`），不是由引用它的消息说。
        if (evidenceById(ref).source !== source.id) continue
        evidenceRefs.push(ref)
      }
    }
    return {
      source: source.id as DataSourceId,
      label: source.label,
      detail: source.detail,
      capability: "capability" in source && typeof source.capability === "string" ? source.capability : null,
      evidenceRefs,
      evidenceCount: evidenceRefs.length,
      messageCount,
    }
  })

  let packageView: PipelinePackageView | null = null
  for (const message of scope) {
    if (message.kind !== "context_package") continue
    packageView = {
      messageId: message.id,
      seq: message.seq,
      label: message.packageLabel,
      mergeLabel: message.mergeLabel,
      mergeElapsedMs: message.mergeElapsedMs,
      confidencePercent: Math.round(message.claim.confidence * 100),
      evidenceRefs: [...message.claim.evidenceRefs],
      sources: [...message.claim.sources],
      occurredAt: message.occurredAt,
    }
  }

  let merged = 0
  let singleSource = 0
  for (const message of scope) {
    const claim = "claim" in message ? message.claim : null
    if (claim === null || claim === undefined) continue
    if (claim.sources.length >= 2) merged += 1
    else singleSource += 1
  }

  return { lanes, packageView, consumed: { merged, singleSource, total: merged + singleSource } }
}

/* -------------------------------------------------------------------------- */
/* 17 · ⑭ 报告流式生成                                                          */
/* -------------------------------------------------------------------------- */

/**
 * ⑭ 的两条判据：`sediment.survives-export`（导出后逐条等价）与
 * `boundary.demo-is-labelled-as-demo`（整篇一眼可辨是演示环境）。
 *
 * ## 报告的内容从哪来
 *
 * 三行正文逐字来自种子 `report.lines`，经第 16 拍的 `sediment` 消息带进事件流
 * （`timeline.ts` 的 `reportLines`）。**界面不另写一份报告稿** —— 那样一来
 * "屏幕上的报告"与"事件流里的报告"就成了两份可以互相漂移的东西。
 *
 * ## 进度是算出来的，不是种子里的 68
 *
 * 种子 `report.progressPercent = 68` 是**设计稿静帧**的取值。它的意思是"那一帧生成到 68%"，
 * 不是一个常量。所以界面上显示的进度由游标派生：已生成字数 ÷ 总字数
 * （第 k 行在第 k × `OUTPUT_LINE_MS` 之后开始出现，与 ④ 的回显逐行返回同一套节奏）。
 * 种子的 68 一个字节都没丢：它作为 `designProgressPercent` 留在视图里，
 * 面板以 `data-design-progress` 挂在 DOM 上（可断言），但不冒充活读数。
 *
 * ## 导出物自带演示标识
 *
 * 导出的是**结构化文档**（不是把屏幕上的文字拼起来）：`demo.isDemo` 恒为 `true`，
 * 并且带上种子 `environment.isolation` 的原文。于是"这份东西是演示环境产出的"这件事
 * 跟着文件走 —— 报告被截图、被转发、被贴进别的地方之后，它自己还说得清自己是什么。
 * 屏幕上同理：报告正文的**第一行**就是那条标识，不等读者看到落款才知道。
 */

/** 导出文档的 schema 版本（字段集合封闭：解析器见到别的版本会拒收）。 */
export const REPORT_DOCUMENT_SCHEMA_VERSION = 1

/** 报告面板导出文档的 DOM id（披露控件的 `aria-controls` 指向它）。 */
export const REPORT_DOCUMENT_ID = "s1-report-export"

export type ReportDocument = {
  schemaVersion: number
  demo: { isDemo: true; isolation: string; disclosure: string }
  incidentId: string
  title: string
  /** 导出时刻的游标 —— 墙上时间不进导出物，所以同一状态导出两次逐字符相同。 */
  cursorMs: number
  seq: number
  lines: string[]
  evidenceRefs: EvidenceId[]
}

export type ReportView = {
  /** 报告这一拍到了没有（`sediment` 消息已揭示）。 */
  available: boolean
  title: string
  /** 已经"生成"的行（按游标派生）。 */
  generatedLines: string[]
  totalLines: number
  /** 派生进度：已生成字数 ÷ 总字数（0–100 的整数）。 */
  progressPercent: number
  /** 种子里的设计稿静帧值（`report.progressPercent`）—— 记录，不是活读数。 */
  designProgressPercent: number
  document: ReportDocument
  text: string
}

/**
 * 报告正文的证据清单 —— 行首写 ` #e-xx ` 的那些引用**逐个到登记簿核对**。
 *
 * 判据不是"行里出现了 #e 开头的东西"，而是"这一行里出现的每一个引用都真的在登记簿上"：
 * 提取不出来的行不算有引用（不报错，因为没有引用不是缺陷）。
 */
export function reportEvidenceRefsOf(lines: readonly string[]): EvidenceId[] {
  const found: EvidenceId[] = []
  for (const line of lines) {
    for (const match of line.matchAll(/#e-\d+/g)) {
      if (!found.includes(match[0])) found.push(match[0])
    }
  }
  return found
}

/** 报告里引用不到的证据（空数组 = 全部可定位）。 */
export function reportUnresolvableRefs(lines: readonly string[]): EvidenceId[] {
  return unresolvableEvidenceRefs(reportEvidenceRefsOf(lines))
}

export function reportOf(
  revealed: readonly IncidentMessage[],
  cursor: ReplayCursor,
  progressMs: number,
  revealTimes: ReadonlyMap<number, number>,
): ReportView {
  let source: { seq: number; lines: string[] } | null = null
  for (const message of revealed) {
    if (message.kind !== "sediment") continue
    source = { seq: message.seq, lines: [...message.reportLines] }
  }

  const lines = source?.lines ?? []
  const totalChars = lines.reduce((sum, line) => sum + line.length, 0)
  const revealedAt = source === null ? 0 : (revealTimes.get(source.seq) ?? 0)
  const generatedLines: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    if (progressMs >= revealedAt + index * OUTPUT_LINE_MS) generatedLines.push(lines[index] as string)
  }
  const generatedChars = generatedLines.reduce((sum, line) => sum + line.length, 0)
  const progressPercent =
    totalChars === 0 ? 0 : Math.round((generatedChars / totalChars) * 100)

  /*
   * 导出物里的游标必须是**有限数**。
   *
   * `CURSOR_END` 的 `revealedAtMs` 是 `Number.POSITIVE_INFINITY`（它是"比任何消息都靠后"
   * 这个语义的哨兵，不是一毫秒数）。把它写进导出物有两个后果：JSON 里变成 `null`
   * （`JSON.stringify(Infinity) === "null"`），而稳定序列化器会**响亮地拒绝**它
   * （`stable-json.ts`：不可比较的东西不许写成字符串）—— 于是"导出报告"在回放终点上直接抛。
   *
   * 处置：游标落在无穷远时，用**最后一条已揭示消息的回放时刻**当导出时刻。
   * 那是同一件事的有限写法（"生成到这里为止"），而且它仍然只由事件流决定，不看时钟。
   */
  const cursorMs = Number.isFinite(cursor.revealedAtMs)
    ? cursor.revealedAtMs
    : (revealed[revealed.length - 1]?.revealedAtMs ?? 0)

  const document_: ReportDocument = {
    schemaVersion: REPORT_DOCUMENT_SCHEMA_VERSION,
    demo: {
      isDemo: true,
      isolation: ENVIRONMENT.isolation,
      disclosure: ENVIRONMENT.disclosure,
    },
    incidentId: INCIDENT_ID,
    title: REPORT.title,
    cursorMs,
    seq: source?.seq ?? 0,
    lines: generatedLines,
    evidenceRefs: reportEvidenceRefsOf(generatedLines),
  }

  return {
    available: source !== null,
    title: REPORT.title,
    generatedLines,
    totalLines: lines.length,
    progressPercent,
    designProgressPercent: REPORT.progressPercent,
    document: document_,
    text: stableStringify(document_ as unknown as JsonValue),
  }
}

/**
 * 报告导出物的**逐条核对** —— `sediment.survives-export` 在 ⑭ 上的判据。
 *
 * 与 ⑪ 的核对是同一件事的两处应用，判据也同源：能解析（字段集合封闭 + 版本一致）、
 * 逐条等价（**逐行**比，差异要指出是第几行）、往返不漂移（再序列化一次，逐字符相同）。
 * 差异文本里带行号，所以"逐条等价"不是一句形容词，而是一个能指出位置的事实。
 */
export function verifyReportImport(
  json: string,
  document_: ReportDocument,
): { parseIssues: string[]; diffs: string[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    return { parseIssues: [`不是合法 JSON：${error instanceof Error ? error.message : String(error)}`], diffs: [] }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { parseIssues: ["导出物不是一个对象"], diffs: [] }
  }
  const record = parsed as Record<string, unknown>
  const issues: string[] = []
  for (const key of Object.keys(document_)) {
    if (!(key in record)) issues.push(`缺少字段 ${key}`)
  }
  for (const key of Object.keys(record)) {
    if (!(key in document_)) issues.push(`多出字段 ${key}`)
  }
  if (record.schemaVersion !== REPORT_DOCUMENT_SCHEMA_VERSION) {
    issues.push(`schemaVersion 不是 ${REPORT_DOCUMENT_SCHEMA_VERSION}`)
  }
  if (issues.length > 0) return { parseIssues: issues, diffs: [] }

  const imported = record as unknown as ReportDocument
  const diffs: string[] = []
  const demo = (imported.demo ?? {}) as Partial<ReportDocument["demo"]>
  if (demo.isDemo !== true) diffs.push("demo.isDemo 不是 true —— 这份导出物没有标明自己是演示环境")
  if (demo.isolation !== ENVIRONMENT.isolation) diffs.push("demo.isolation 与当前环境的隔离声明不一致")
  if (imported.incidentId !== document_.incidentId) diffs.push("incidentId 不一致")
  if (imported.title !== document_.title) diffs.push("title 不一致")
  if (imported.cursorMs !== document_.cursorMs) diffs.push("游标不一致 —— 这份导出物不是此刻的这一份")

  const lines = Array.isArray(imported.lines) ? imported.lines : []
  if (lines.length !== document_.lines.length) {
    diffs.push(`行数不一致：导入 ${lines.length} 行，当前 ${document_.lines.length} 行`)
  }
  const shorter = Math.min(lines.length, document_.lines.length)
  for (let index = 0; index < shorter; index += 1) {
    if (lines[index] !== document_.lines[index]) {
      diffs.push(`第 ${index + 1} 行不一致：导入「${String(lines[index])}」≠ 当前「${document_.lines[index]}」`)
    }
  }
  if (stableStringify(imported as unknown as JsonValue) !== stableStringify(document_ as unknown as JsonValue)) {
    diffs.push("序列化后逐字符不同（字段有漂移）")
  }
  return { parseIssues: [], diffs }
}

/* -------------------------------------------------------------------------- */
/* 18 · ⑫ 数字员工花名册                                                        */
/* -------------------------------------------------------------------------- */

/**
 * ⑫ 的判据是 `authority.no-unlisted-autonomous-action` 在**花名册**上的形态。
 *
 * 顶栏那句「N 个 AI 数字员工在岗」里的 N **必须是算出来的**：旧实现逐字读种子
 * `headerStats.rosterLabel`（"4 个…"），那是一个常量，不是一句关于此刻的话。
 * 现在 N = 本回合**已经出动过**的员工数（`beatStep !== null` 的已揭示消息里出现过这个 actor），
 * 于是它在回放里从 0 长到 4，收尾那一帧与种子静帧逐字相等（有断言）。
 *
 * 「在岗」在这里的准确含义是**本回合有动作**，不是"编制上有几个人"：编制来自
 * `AGENT_ACTORS`（数据层的四个数字员工），席位短名来自种子 `headerStats.roster`（记录内容）。
 *
 * 每个席位的自主动作能追到三样东西：动作码、自主档、以及**白名单判决**
 * （`isAutonomous` —— 与 `lib/s1/verify.ts` 的 `scanAuthority` 同一份判据源，界面不另立一张表）。
 * 白名单外（`inWhitelist === false`）的动作只允许停在人的门上，所以席位同时给出
 * `awaiting`：那张挂在他名下、此刻仍然是 `pending` 的待批卡。
 */

export type RosterActionView = {
  messageId: MessageId
  seq: number
  /** 动作属于哪一类消息（`tool_call` 是执行，`action_card` 是提请）。 */
  kind: "tool_call" | "action_card"
  at: string
  actionCode: ActionCode
  autonomy: AutonomyLevel
  /** `true` = 走清单内自主通道。 */
  auto: boolean
  /** 动作码的中文名（词典给；认不出的代号原样显示）。 */
  label: string
}
export type RosterSeatView = {
  role: AgentActor
  /** 席位短名（种子 `headerStats.roster`，记录内容）。 */
  short: string
  /** 本回合出过动没有（在岗 = 这个）。 */
  onDuty: boolean
  /** 本回合这个员工经手的动作条数。 */
  actionCount: number
  /** 最近一次动作；没有就是 `null`（界面留空，不编一句）。 */
  last: RosterActionView | null
  /** 白名单判决：`isAutonomous(actionCode)`；没有动作就是 `null`。 */
  inWhitelist: boolean | null
  /** 停在他这道门上的待批卡（派生：卡片 `pending` 且拆开它的那条消息 actor 是他）。 */
  awaiting: { cardId: string; title: string; slaMs: number | null } | null
}

export type RosterView = {
  seats: RosterSeatView[]
  /** 本回合在岗人数 —— 顶栏那句 N 就是它。 */
  onDutyCount: number
  /** 编制人数（`AGENT_ACTORS` 的长度，不是写死的 4）。 */
  total: number
}

const ROSTER_SHORT: ReadonlyMap<string, string> = new Map(
  HEADER_STATS_SIGNED.roster.map((seat) => [seat.role, seat.short]),
)

export function rosterOf(
  state: IncidentState,
  revealed: readonly IncidentMessage[],
  actionLabels: Readonly<Partial<Record<string, string>>> = {},
): RosterView {
  const scope = revealed.filter((message) => message.beatStep !== null)

  const pendingCards = state.disposition.cards.filter(
    (card) => card.cardKind === "approval-required" && card.state === "pending",
  )
  const awaitingByActor = new Map<AgentActor, { cardId: string; title: string; slaMs: number | null }>()
  for (const card of pendingCards) {
    // 卡挂在谁名下：拆开它的那条 `action_card` 消息的 actor（卡片本身不带 actor）。
    const opener = scope.find(
      (message) => message.kind === "action_card" && message.cardId === card.cardId,
    )
    if (opener === undefined || opener.kind !== "action_card") continue
    if (!awaitingByActor.has(opener.actor)) {
      awaitingByActor.set(opener.actor, {
        cardId: card.cardId,
        title: card.title,
        slaMs: card.slaMs,
      })
    }
  }

  const seats: RosterSeatView[] = AGENT_ACTORS.map((role) => {
    const own = scope.filter((message) => "actor" in message && message.actor === role)
    const actions = own.filter(
      (message) => message.kind === "tool_call" || message.kind === "action_card",
    )
    const lastMessage = actions[actions.length - 1]
    const last: RosterActionView | null =
      lastMessage === undefined ||
      (lastMessage.kind !== "tool_call" && lastMessage.kind !== "action_card")
        ? null
        : {
            messageId: lastMessage.id,
            seq: lastMessage.seq,
            kind: lastMessage.kind,
            at: lastMessage.occurredAt,
            actionCode: lastMessage.actionCode,
            autonomy: lastMessage.autonomy,
            /*
             * 「走没走自主通道」要看**消息自己怎么说**：
             *   · `tool_call` 有 `auto` 字段（`true` = 清单内自主执行，`false` = 经人批准后执行）；
             *   · `action_card` 没有，它的通道写在 `cardKind` 上（`auto` / `approval-required`）。
             * 卡片一律当成自主过 —— 那正是这条判据要抓的东西：一张 `approval-required` 的卡
             * 是"提请人裁决"，不是"已经自主执行"，把两者混起来会让白名单判决失去意义
             * （2026-09-17 实测：`patch-config` 的待批卡被算成了自主通道）。
             */
            auto:
              lastMessage.kind === "tool_call"
                ? lastMessage.auto
                : lastMessage.cardKind === "auto",
            label: actionLabels[lastMessage.actionCode as string] ?? lastMessage.actionCode,
          }

    return {
      role,
      short: ROSTER_SHORT.get(role) ?? role.slice(0, 1),
      onDuty: own.length > 0,
      actionCount: actions.length,
      last,
      inWhitelist: last === null ? null : isAutonomous(last.actionCode),
      awaiting: awaitingByActor.get(role) ?? null,
    }
  })

  return {
    seats,
    onDutyCount: seats.filter((seat) => seat.onDuty).length,
    total: AGENT_ACTORS.length,
  }
}

/* -------------------------------------------------------------------------- */
/* 19 · 常量再导出（测试与界面共用的出处）                                       */
/* -------------------------------------------------------------------------- */

export { INCIDENT_ID, PLAN_STEPS }
