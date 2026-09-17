/**
 * 确定性回放 —— 给一个回放时刻，返回**那一刻**的完整状态。
 *
 * ## 三条硬性质
 *
 * 1. **纯函数**：`replayStream(events, at)` 不读时钟、不随机、不依赖迭代顺序不稳定的容器
 *    （源码扫描器见 `tests/sth-invariants.spec.ts` 的「确定性：不读时钟、不随机、不依赖迭代顺序」一节 ——
 *    它先 `stripComments` 再扫，所以注释里可以自由地提到被禁止的 API）。同一输入两次调用深比较相等。
 * 2. **状态由「效果」驱动**：`effectsOf(message)` 把一条消息翻译成一串 `StateEffect`，
 *    `applyEffect` 是唯一改状态的地方。审计重放（`audit.ts`）喂的是**同一批效果**，
 *    所以「直放」与「从审计序列重放」走的是同一条代码路径 —— 这是
 *    `audit.replay-is-faithful` 能被证明的原因，而不是两套实现互相印证。
 * 3. **可序列化**：状态是纯 JSON 值（`stable-json.ts` 可以直接稳定序列化），
 *    于是深比较、导出、跨进程比对都不需要对类做特判。
 */

import {
  ACTION_CATALOG,
  type ActionCode,
  type ActorRef,
  type AgentActor,
  type AutonomyLevel,
  type Claim,
  type EntityId,
  type EntityState,
  type EntityView,
  type EvidenceId,
  type EvidenceItem,
  type IncidentId,
  type IncidentMessage,
  type MessageId,
  type PlanStep,
  type SedimentItem,
} from "./contract"
import { BACKGROUND_ENTITY_VIEWS, buildBackgroundClosures } from "./background"
import {
  countersFromInputs,
  counterInputOf,
  type CounterInput,
  type CounterSnapshot,
} from "./counters"
import { ENTITY_VIEWS, EVIDENCE_ITEMS, PLAN } from "./seed"

/* -------------------------------------------------------------------------- */
/* 静态索引（种子 + 当日事件簿的证据/实体）                                     */
/* -------------------------------------------------------------------------- */

const backgroundEvidence: EvidenceItem[] = buildBackgroundClosures().map((closure) => closure.evidence)

const EVIDENCE_INDEX: ReadonlyMap<EvidenceId, EvidenceItem> = new Map(
  [...EVIDENCE_ITEMS, ...backgroundEvidence].map((item) => [item.id, item]),
)

const ENTITY_INDEX: ReadonlyMap<EntityId, EntityView> = new Map(
  [...ENTITY_VIEWS, ...BACKGROUND_ENTITY_VIEWS].map((entity) => [entity.id, entity]),
)

export function evidenceIndexSize(): number {
  return EVIDENCE_INDEX.size
}

/**
 * 证据登记簿（种子 + 当日事件簿）的全部 id。
 *
 * 这是「引用可定位」的**对照物**：扫描器拿它去比对消息里的引用，
 * 而不是拿消息自己比对消息自己 —— 后者会永远为真（一个只会说「是」的探针）。
 */
export function knownEvidenceIds(): Set<EvidenceId> {
  return new Set(EVIDENCE_INDEX.keys())
}

/** 按 id 取证据；取不到就是**断链**，直接抛而不是静默跳过（不变量要求引用可定位）。 */
export function evidenceById(id: EvidenceId): EvidenceItem {
  const item = EVIDENCE_INDEX.get(id)
  if (item === undefined) throw new Error(`证据引用解析不到：${id}`)
  return item
}

export function entityById(id: EntityId): EntityView {
  const entity = ENTITY_INDEX.get(id)
  if (entity === undefined) throw new Error(`实体引用解析不到：${id}`)
  return entity
}

/* -------------------------------------------------------------------------- */
/* 状态                                                                        */
/* -------------------------------------------------------------------------- */

export type TimelineRow = {
  seq: number
  messageId: MessageId
  /** 事实时间（设计稿真值，业务记录内容）。 */
  at: string
  occurredAtMs: number
  actor: ActorRef
  action: string
  basisRefs: EvidenceId[]
}

export type PlanState = {
  eventId: string
  owner: string
  steps: PlanStep[]
  replan: { from: string; to: string } | null
}

export type CardState = "pending" | "executed" | "approved" | "rejected"

export type CardRecord = {
  cardId: string
  cardKind: "auto" | "approval-required"
  actionCode: ActionCode
  title: string
  autonomy: AutonomyLevel
  basis: string
  impact: string
  rollback: string
  rollbackWindowMs: number | null
  slaMs: number | null
  planStepId: string | null
  state: CardState
  /**
   * 待批卡的**五件套**（做什么 / 依据 / 影响与风险 / 回滚 / 替代方案）。
   *
   * 2026-09-17 加上：⑥ 处置与授权卡片区要显示这五项，而它们本来只活在消息里 ——
   * 卡片状态被归约进 `CardRecord` 时丢掉了。丢掉之后界面只有两条路：把 `basis`
   * 那类文字再解析一遍（脆），或者另写一句（编）。两条都不能要，所以让记录带上它。
   *
   * ⚠ 这是 `lib/sth/**` 的**增补，不是语义变更**：既有字段一个没改，既有消费者
   * （`audit.ts` 的 `explainCardDecision`、`sediment.ts` 的 `card.open`）读的还是原来那些；
   * 新增的三个字段只是不再让已经存在于消息里的事实丢失。
   */
  five: { what: string; basis: string; impact: string; rollback: string; alternative: string } | null
  /** 三键（种子 `actionCards[1].actions`，逐字）。自动卡没有。 */
  actions: readonly string[]
  /**
   * 这条卡是由哪条消息产生的序号。
   *
   * ⑥ 的 SLA 倒计时要用它：`revealTimes.get(seq)` 把「卡片刚打开的那一刻」换成
   * 播放进度上的毫秒数，于是倒计时是游标的纯函数，没有自己的定时器。
   * 同时它也是「这一项能被追到哪条事件」的答案。
   */
  seq: number
  /**
   * 超时策略的原文（种子 `actionCards[].sla.timeoutPolicy`：
   * `超时默认挂起不执行`）。**必须显示**：它是"球在你那边"这句话的另一半 ——
   * 不说清楚超时会怎样，SLA 倒计时就只是一个装饰性的数字。
   */
  slaTimeoutPolicy: string | null
}

export type ToolCallRecord = {
  seq: number
  messageId: MessageId
  actor: AgentActor
  actionCode: ActionCode
  auto: boolean
  autonomy: AutonomyLevel
  brief: string | null
  session: string | null
  command: string | null
  output: string | null
  exitCode: number | null
  rollbackWindowMs: number | null
  approvalCardId: string | null
}

export type ApprovalRecord = {
  seq: number
  messageId: MessageId
  cardId: string
  decision: "approved" | "rejected" | "param-changed"
  by: "人工"
  at: string
}

export type IncidentRecord = {
  incidentId: IncidentId
  status: "open" | "closed"
  openedAtMs: number
  closedAtMs: number | null
  outcome: "closed-autonomous" | "closed-after-approval" | null
  handlingMs: number | null
  entityRefs: EntityId[]
}

export type AnswerRecord = {
  seq: number
  messageId: MessageId
  questionId: string
  conclusion: string
  confidence: number
  evidenceRefs: EvidenceId[]
}

export type IncidentState = {
  cursor: { revealedAtMs: number; lastSeq: number; lastMessageId: MessageId | null }
  /** 三棵状态树（不变量 `audit.replay-is-faithful` 比较的就是它们 + 下面这些）。 */
  plan: PlanState
  evidence: { items: EvidenceItem[]; claims: Claim[] }
  disposition: { cards: CardRecord[]; toolCalls: ToolCallRecord[]; approvals: ApprovalRecord[] }
  /** 攻击链实体画布的节点状态。 */
  entities: EntityView[]
  /** 当日事件簿（含回合 3 事件本身，它结束时仍然是 `open`）。 */
  incidents: IncidentRecord[]
  /** ⑧ 审计时间线只收回合 3 自己的行（`scope: "incident"`）。 */
  timeline: TimelineRow[]
  sediment: SedimentItem[]
  report: { lines: string[]; progressPercent: number } | null
  answers: AnswerRecord[]
  /** 构成当前计数的**那一批输入**（不是数字：出处才是答案）。 */
  counterInputs: CounterInput[]
  counters: CounterSnapshot
}

export function emptyIncidentState(): IncidentState {
  return {
    cursor: { revealedAtMs: 0, lastSeq: 0, lastMessageId: null },
    // 事件 id 与归属是种子里的静态事实（`plan.eventId` / `plan.owner`）：
    // 它们不是「谁做了什么」，所以由初始状态提供，审计重放与直放因此天然一致。
    plan: { eventId: PLAN.eventId, owner: PLAN.owner, steps: [], replan: null },
    evidence: { items: [], claims: [] },
    disposition: { cards: [], toolCalls: [], approvals: [] },
    // 事件现场已知的实体（种子 `entities` 六条）随初始状态就在场：
    // 它们不是「谁做了什么」，而是开演时画布上本来就该有的节点。
    entities: ENTITY_VIEWS.map((entity) => ({ ...entity })),
    incidents: [],
    timeline: [],
    sediment: [],
    report: null,
    answers: [],
    counterInputs: [],
    counters: countersFromInputs([]),
  }
}

/* -------------------------------------------------------------------------- */
/* 效果                                                                        */
/* -------------------------------------------------------------------------- */

export type StateEffect =
  | { op: "incident.open"; incidentId: IncidentId; openedAtMs: number; entityRefs: EntityId[] }
  | {
      op: "incident.close"
      incidentId: IncidentId
      outcome: "closed-autonomous" | "closed-after-approval"
      handlingMs: number
      closedAtMs: number
    }
  | { op: "evidence.register"; items: EvidenceItem[]; entities: EntityView[] }
  | { op: "claim.record"; claim: Claim }
  | { op: "plan.upsert"; steps: PlanStep[]; eventId?: string; owner?: string }
  | { op: "plan.supersede"; stepId: string }
  | { op: "plan.replan"; replan: { from: string; to: string } }
  | { op: "plan.complete"; stepId: string }
  | { op: "entity.set-state"; entityId: EntityId; state: EntityState }
  | { op: "card.open"; card: CardRecord }
  | { op: "card.decide"; cardId: string; decision: ApprovalRecord["decision"] }
  | { op: "tool.execute"; record: ToolCallRecord }
  | { op: "approval.record"; record: ApprovalRecord }
  | { op: "timeline.append"; row: TimelineRow }
  | { op: "sediment.add"; items: SedimentItem[] }
  | { op: "report.update"; lines: string[]; progressPercent: number }
  | { op: "answer.record"; record: AnswerRecord }

/** 哪些动作会把实体推到哪个状态。只读动作不在表里 —— 它们不改变画布。 */
const ACTION_ENTITY_STATES: Partial<
  Record<ActionCode, { kinds: ReadonlyArray<EntityView["kind"]>; state: EntityState }>
> = {
  "block-source": { kinds: ["attacker"], state: "封禁中" },
  "delete-file-with-backup": { kinds: ["file"], state: "已清除" },
  "quarantine-file": { kinds: ["file"], state: "定位完成" },
}

/** 把一条消息翻译成一串效果。**纯函数**：同样的消息永远得到同样的效果。 */
export function effectsOf(message: IncidentMessage): StateEffect[] {
  const effects: StateEffect[] = []

  // 证据与实体：引用即登记（引用解析不到会抛，不静默跳过）。
  const items = message.evidenceRefs.map((id) => evidenceById(id))
  if (items.length > 0) {
    const entities = items
      .flatMap((item) => item.entityRefs)
      .map((id) => entityById(id))
    effects.push({ op: "evidence.register", items: dedupeById(items), entities: dedupeById(entities) })
  }

  switch (message.kind) {
    case "alert": {
      effects.push({
        op: "incident.open",
        incidentId: message.incidentId,
        openedAtMs: message.occurredAtMs,
        entityRefs: [...message.entityRefs],
      })
      if (message.claim !== null) {
        effects.push({ op: "claim.record", claim: cloneClaim(message.claim) })
        if (message.affects.includes("ask-sth")) {
          effects.push({
            op: "answer.record",
            record: {
              seq: message.seq,
              messageId: message.id,
              questionId: message.claim.findingId,
              conclusion: message.claim.conclusion,
              confidence: message.claim.confidence,
              evidenceRefs: [...message.claim.evidenceRefs],
            },
          })
        }
      }
      break
    }
    case "context_package": {
      effects.push({ op: "claim.record", claim: cloneClaim(message.claim) })
      break
    }
    case "plan_update": {
      if (message.supersedes !== undefined) {
        effects.push({ op: "plan.supersede", stepId: message.supersedes.id })
      }
      effects.push({ op: "plan.upsert", steps: message.steps.map((step) => ({ ...step })) })
      if (message.replan !== undefined) {
        effects.push({ op: "plan.replan", replan: { ...message.replan } })
      }
      break
    }
    case "tool_call": {
      effects.push({
        op: "tool.execute",
        record: {
          seq: message.seq,
          messageId: message.id,
          actor: message.actor,
          actionCode: message.actionCode,
          auto: message.auto,
          autonomy: message.autonomy,
          brief: message.brief ?? null,
          session: message.session ?? null,
          command: message.command ?? null,
          output: message.output ?? null,
          exitCode: message.exitCode ?? null,
          rollbackWindowMs: message.rollbackWindowMs ?? null,
          approvalCardId: message.approvalCardId ?? null,
        },
      })
      effects.push(...entityStateEffects(message.actionCode, items))
      break
    }
    case "action_card": {
      const slaMs = message.sla?.ms ?? null
      effects.push({
        op: "card.open",
        card: {
          cardId: message.cardId,
          cardKind: message.cardKind,
          actionCode: message.actionCode,
          title: message.title,
          autonomy: message.autonomy,
          basis: message.basis,
          impact: message.impact,
          rollback: message.rollback,
          rollbackWindowMs: message.rollbackWindowMs ?? null,
          slaMs,
          planStepId: message.planStepId ?? null,
          // 清单内 + 可回滚的卡片当场执行（种子 a1：「L3 授权策略内 · 已自动执行」）。
          state: message.cardKind === "auto" ? "executed" : "pending",
          five: message.five === undefined ? null : { ...message.five },
          actions: message.actions === undefined ? [] : [...message.actions],
          seq: message.seq,
          slaTimeoutPolicy: message.sla?.timeoutPolicy ?? null,
        },
      })
      if (message.planStep !== undefined) {
        effects.push({ op: "plan.upsert", steps: [{ ...message.planStep }] })
      }
      // 免授权通道卡**本身就是那次执行**（种子 a1：「L3 授权策略内 · 已自动执行」），
      // 所以它对画布的影响与 tool_call 走同一张表。
      if (message.cardKind === "auto") {
        effects.push(...entityStateEffects(message.actionCode, items))
      }
      break
    }
    case "approval": {
      effects.push({ op: "card.decide", cardId: message.cardId, decision: message.decision })
      effects.push({
        op: "approval.record",
        record: {
          seq: message.seq,
          messageId: message.id,
          cardId: message.cardId,
          decision: message.decision,
          by: "人工",
          at: message.occurredAt,
        },
      })
      break
    }
    case "audit_event": {
      if (message.scope === "incident") {
        effects.push({
          op: "timeline.append",
          row: {
            seq: message.seq,
            messageId: message.id,
            at: message.occurredAt,
            occurredAtMs: message.occurredAtMs,
            actor: message.actor,
            action: message.action,
            basisRefs: [...message.basisRefs],
          },
        })
      }
      if (message.closure !== undefined) {
        effects.push({
          op: "incident.close",
          incidentId: message.incidentId,
          outcome: message.closure.outcome,
          handlingMs: message.closure.handlingMs,
          closedAtMs: message.occurredAtMs,
        })
      }
      break
    }
    case "sediment": {
      effects.push({ op: "sediment.add", items: message.items.map((item) => cloneSediment(item)) })
      effects.push({
        op: "report.update",
        lines: [...message.reportLines],
        progressPercent: message.reportProgressPercent,
      })
      break
    }
  }

  return effects
}

/** 动作 → 画布效果（`ACTION_ENTITY_STATES` 的唯一使用点）。 */
function entityStateEffects(actionCode: ActionCode, items: readonly EvidenceItem[]): StateEffect[] {
  const rule = ACTION_ENTITY_STATES[actionCode]
  if (rule === undefined) return []
  const effects: StateEffect[] = []
  for (const item of items) {
    for (const entityId of item.entityRefs) {
      const entity = entityById(entityId)
      if (rule.kinds.includes(entity.kind)) {
        effects.push({ op: "entity.set-state", entityId, state: rule.state })
      }
    }
  }
  return effects
}

function cloneClaim(claim: Claim): Claim {
  return {
    findingId: claim.findingId,
    conclusion: claim.conclusion,
    confidence: claim.confidence,
    evidenceRefs: [...claim.evidenceRefs],
    sources: [...claim.sources],
  }
}

function cloneSediment(item: SedimentItem): SedimentItem {
  return { id: item.id, label: item.label, kind: item.kind, sourceRefs: [...item.sourceRefs] }
}

function dedupeById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Map<string, T>()
  for (const item of items) if (!seen.has(item.id)) seen.set(item.id, item)
  return [...seen.values()]
}

/* -------------------------------------------------------------------------- */
/* 归约器                                                                      */
/* -------------------------------------------------------------------------- */

function upsertBy<T>(list: readonly T[], key: (item: T) => string, value: T, order: () => number): T[] {
  const next = list.filter((item) => key(item) !== key(value))
  next.push(value)
  // `order` 只保序（值由调用方决定，通常恒为 0），真正的排序键是后面的 key。
  void order
  return next.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
}

function applyEffectToState(state: IncidentState, effect: StateEffect): IncidentState {
  switch (effect.op) {
    case "incident.open": {
      const existing = state.incidents.find((entry) => entry.incidentId === effect.incidentId)
      const record: IncidentRecord = existing === undefined
        ? {
            incidentId: effect.incidentId,
            status: "open",
            openedAtMs: effect.openedAtMs,
            closedAtMs: null,
            outcome: null,
            handlingMs: null,
            entityRefs: [...effect.entityRefs],
          }
        : {
            ...existing,
            // 同一事件可能有多条 alert：取最早的开启时刻，不被后来的覆盖。
            openedAtMs: Math.min(existing.openedAtMs, effect.openedAtMs),
            entityRefs: [...new Set([...existing.entityRefs, ...effect.entityRefs])],
          }
      return {
        ...state,
        incidents: upsertBy(state.incidents, (entry) => entry.incidentId, record, () => 0),
      }
    }
    case "incident.close": {
      const existing = state.incidents.find((entry) => entry.incidentId === effect.incidentId)
      const record: IncidentRecord = {
        incidentId: effect.incidentId,
        status: "closed",
        openedAtMs: existing?.openedAtMs ?? effect.closedAtMs - effect.handlingMs,
        closedAtMs: effect.closedAtMs,
        outcome: effect.outcome,
        handlingMs: effect.handlingMs,
        entityRefs: existing?.entityRefs ?? [],
      }
      return {
        ...state,
        incidents: upsertBy(state.incidents, (entry) => entry.incidentId, record, () => 0),
      }
    }
    case "evidence.register": {
      /*
       * **登记是幂等的、只增不改的。**
       *
       * 这里刻意用「首次见到才写」而不是 upsert：实体状态会被后续的
       * `entity.set-state` 改变（后门文件从「定位完成」变成「已清除」），
       * 而同一个证据 id 会在后面好几条消息里反复出现。若这里 upsert，
       * 那些重复引用会把状态**推回静态取值** —— 一次静默的状态回滚：
       * 画布上那个节点会在被清除之后又变回「未清除」，而不报任何错。
       */
      const items = [...state.evidence.items]
      for (const item of effect.items) {
        if (!items.some((entry) => entry.id === item.id)) items.push(item)
      }
      const entities = [...state.entities]
      for (const entity of effect.entities) {
        if (!entities.some((entry) => entry.id === entity.id)) entities.push(entity)
      }
      return {
        ...state,
        evidence: { ...state.evidence, items: sortById(items) },
        entities: sortById(entities),
      }
    }
    case "claim.record": {
      const claim = effect.claim
      const claims = upsertBy(state.evidence.claims, (entry) => entry.findingId, claim, () => 0)
      return { ...state, evidence: { ...state.evidence, claims } }
    }
    case "plan.upsert": {
      const steps = effect.steps.reduce<PlanStep[]>(
        (acc, step) => upsertBy(acc, (entry) => entry.id, step, () => 0),
        state.plan.steps,
      )
      return {
        ...state,
        plan: {
          ...state.plan,
          steps: sortPlanSteps(steps),
          ...(effect.eventId === undefined ? {} : { eventId: effect.eventId }),
          ...(effect.owner === undefined ? {} : { owner: effect.owner }),
        },
      }
    }
    case "plan.supersede": {
      const steps = state.plan.steps.map((step) =>
        step.id === effect.stepId ? { ...step, state: "superseded" as const } : step,
      )
      return { ...state, plan: { ...state.plan, steps } }
    }
    case "plan.complete": {
      const steps = state.plan.steps.map((step) =>
        step.id === effect.stepId ? { id: step.id, actor: step.actor, state: "done" as const, label: step.label } : step,
      )
      return { ...state, plan: { ...state.plan, steps } }
    }
    case "plan.replan": {
      return { ...state, plan: { ...state.plan, replan: { ...effect.replan } } }
    }
    case "entity.set-state": {
      const entities = state.entities.map((entity) =>
        entity.id === effect.entityId ? { ...entity, state: effect.state } : entity,
      )
      return { ...state, entities: sortById(entities) }
    }
    case "card.open": {
      return {
        ...state,
        disposition: {
          ...state.disposition,
          cards: upsertBy(state.disposition.cards, (card) => card.cardId, effect.card, () => 0),
        },
      }
    }
    case "card.decide": {
      const cards = state.disposition.cards.map((card) => {
        if (card.cardId !== effect.cardId) return card
        const nextState: CardState = effect.decision === "approved" ? "approved" : "rejected"
        return { ...card, state: nextState }
      })
      const decided = cards.find((card) => card.cardId === effect.cardId)
      const unblocked =
        decided !== undefined && decided.planStepId !== null && effect.decision === "approved"
          ? state.plan.steps.map((step) =>
              step.id === decided.planStepId
                ? { id: step.id, actor: step.actor, state: "done" as const, label: step.label }
                : step,
            )
          : state.plan.steps
      return {
        ...state,
        plan: { ...state.plan, steps: unblocked },
        disposition: { ...state.disposition, cards: sortCards(cards) },
      }
    }
    case "tool.execute": {
      return {
        ...state,
        disposition: {
          ...state.disposition,
          toolCalls: [...state.disposition.toolCalls, effect.record].sort((a, b) => a.seq - b.seq),
        },
      }
    }
    case "approval.record": {
      return {
        ...state,
        disposition: {
          ...state.disposition,
          approvals: [...state.disposition.approvals, effect.record].sort((a, b) => a.seq - b.seq),
        },
      }
    }
    case "timeline.append": {
      return {
        ...state,
        timeline: [...state.timeline, effect.row].sort(
          (a, b) => a.occurredAtMs - b.occurredAtMs || a.seq - b.seq,
        ),
      }
    }
    case "sediment.add": {
      const sediment = effect.items.reduce<SedimentItem[]>(
        (acc, item) => upsertBy(acc, (entry) => entry.id, item, () => 0),
        state.sediment,
      )
      return { ...state, sediment }
    }
    case "report.update": {
      return {
        ...state,
        report: { lines: [...effect.lines], progressPercent: effect.progressPercent },
      }
    }
    case "answer.record": {
      return {
        ...state,
        answers: [...state.answers, effect.record].sort((a, b) => a.seq - b.seq),
      }
    }
  }
}

/** 计划步骤的展示顺序：先 p0（被划掉的旧方案），再 p1…p9 —— 按编号排，不靠插入顺序。 */
function sortPlanSteps(steps: readonly PlanStep[]): PlanStep[] {
  return [...steps].sort((a, b) => stepRank(a.id) - stepRank(b.id))
}

function stepRank(id: string): number {
  const match = /^p(\d+)$/.exec(id)
  return match === null ? Number.MAX_SAFE_INTEGER : Number(match[1])
}

function sortById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** 卡片按 cardId 排序（`a1` / `a2` / 当日事件簿的 `<slug>-a1` 都在同一套字典序里）。 */
function sortCards(cards: readonly CardRecord[]): CardRecord[] {
  return [...cards].sort((a, b) => (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0))
}

/** 归约一批效果。**这是唯一的改状态入口。** */
export function foldEffects(state: IncidentState, effects: readonly StateEffect[]): IncidentState {
  return effects.reduce(applyEffectToState, state)
}

/* -------------------------------------------------------------------------- */
/* 回放                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 回放的一步 —— 直放与审计重放用的是同一个形状。
 *
 * `audit.ts` 的账本条目自带这三样（序号 / 揭示时刻 / 消息 id）+ 效果 + 计数输入，
 * 所以两条路径能共用 `applyReplayStep`，不需要第二套实现。
 */
export type ReplayStep = {
  seq: number
  messageId: MessageId
  revealedAtMs: number
}

/**
 * 回放游标 = **回放时刻 + 序号**。
 *
 * 为什么要带序号：剧本里有好几拍共享同一个 `T+` 偏移（第 6 与第 7 拍都是 `T+3.2s`，
 * 第 14 与第 15 拍都是 `T+9.0s`）。只有时刻的话，「第 14 拍之后、第 15 拍之前」这个
 * 中间状态**根本不存在** —— 于是「批准之前卡片是待批的」这类断言无法写出来，
 * 只能退化成一句解说词。带上序号，游标就是流上的一个真实位置。
 */
export type ReplayCursor = { revealedAtMs: number; seq: number }

/** 整条序列的末尾。 */
export const CURSOR_END: ReplayCursor = {
  revealedAtMs: Number.POSITIVE_INFINITY,
  seq: Number.POSITIVE_INFINITY,
}

/**
 * 开场之前的游标：**当日事件簿（`revealedAtMs = -1`）已经在册，解说窗口内的还没到**。
 *
 * 这是「今日」这个词在回放里的精确含义，也是 UI 开场那一帧的状态
 * （顶栏此刻读 126 / 2，而不是 0 / 0）。
 */
export const CURSOR_OPENING: ReplayCursor = {
  revealedAtMs: -1,
  seq: Number.POSITIVE_INFINITY,
}

export function normalizeCursor(cursor: ReplayCursor | number): ReplayCursor {
  return typeof cursor === "number" ? { revealedAtMs: cursor, seq: Number.POSITIVE_INFINITY } : cursor
}

/** 游标是否已经涵盖这条消息（按 (revealedAtMs, seq) 的全序）。 */
export function cursorIncludes(cursor: ReplayCursor, message: { revealedAtMs: number; seq: number }): boolean {
  if (message.revealedAtMs < cursor.revealedAtMs) return true
  if (message.revealedAtMs > cursor.revealedAtMs) return false
  return message.seq <= cursor.seq
}

/**
 * 第 `step` 拍结束后（含该拍的最后一条消息）的游标。
 *
 * 这是 UI「跳到第 N 拍」与测试「第 N 拍那一刻的状态」共用的唯一入口。
 */
export function cursorAtBeat(events: readonly IncidentMessage[], step: number): ReplayCursor {
  let cursor: ReplayCursor | null = null
  for (const message of events) {
    if (message.beatStep !== step) continue
    cursor = {
      revealedAtMs: message.revealedAtMs,
      seq: Math.max(cursor === null ? 0 : cursor.seq, message.seq),
    }
  }
  if (cursor === null) throw new Error(`序列里没有第 ${step} 拍的消息`)
  return cursor
}


export function applyReplayStep(
  state: IncidentState,
  step: ReplayStep,
  effects: readonly StateEffect[],
  counterInput: CounterInput | null,
): IncidentState {
  const applied = foldEffects(state, effects)
  const counterInputs = counterInput === null ? applied.counterInputs : [...applied.counterInputs, counterInput]
  return {
    ...applied,
    counterInputs,
    counters: countersFromInputs(counterInputs),
    cursor: {
      revealedAtMs: step.revealedAtMs,
      lastSeq: step.seq,
      lastMessageId: step.messageId,
    },
  }
}

/**
 * 直放：揭示到 `revealedAtMs` 为止（含）的全部消息。
 *
 * 默认 `Infinity` = 整条序列。**不排序**：输入的序列就是权威顺序（`timeline.ts` 保证），
 * 排序会掩盖「序列本身乱序」这种错误。
 */
export function replayStream(
  events: readonly IncidentMessage[],
  cursor: ReplayCursor | number = CURSOR_END,
): IncidentState {
  const boundary = normalizeCursor(cursor)
  let state = emptyIncidentState()
  for (const message of events) {
    if (!cursorIncludes(boundary, message)) break
    state = applyReplayStep(
      state,
      { seq: message.seq, messageId: message.id, revealedAtMs: message.revealedAtMs },
      effectsOf(message),
      counterInputOf(message),
    )
  }
  return state
}

/** 当前状态里回合 3 事件自己的记录（便捷读取；找不到就是「还没开场」）。 */
export function incidentRecordOf(state: IncidentState, incidentId: IncidentId): IncidentRecord | null {
  return state.incidents.find((entry) => entry.incidentId === incidentId) ?? null
}

/** 某张卡片的计划归属（计划面板与授权卡区的连接点）。 */
export function planStepOfCard(state: IncidentState, cardId: string): PlanStep | null {
  const card = state.disposition.cards.find((entry) => entry.cardId === cardId)
  if (card === undefined || card.planStepId === null) return null
  return state.plan.steps.find((step) => step.id === card.planStepId) ?? null
}

/** 动作目录里这条动作的自主执行策略（`authority.no-unlisted-autonomous-action` 的判据）。 */
export function actionPolicy(code: ActionCode): (typeof ACTION_CATALOG)[ActionCode] {
  return ACTION_CATALOG[code]
}
