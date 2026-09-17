/**
 * STH 事件契约 · 八类消息 + 各值域（纯类型与常量）
 *
 * 上游权威：
 *   · `STH-产品层组件清单与实现约束.md` §三 —— 八类消息与「实体 ID / 证据引用 / 置信度 / 自主度等级」
 *     四项字段要求；
 *   · `STH-回合3回放剧本.json` 的 `contract.messageTypes` / `components` —— 八类消息与十二个组件的
 *     合法取值（本文件是它们的机器化副本，副本与原件的偏差由 `tests/sth-invariants.spec.ts` 断言）。
 *
 * 这一层是**数据与逻辑**，没有 JSX、没有任何界面文案、也没有视觉常量（颜色 / 字号 / 时长 / 缓动）。
 * 业务记录内容（IP、hash、时间戳、Agent 名、命令回显、卡片的业务句）按仓规**不翻译**，住在数据层；
 * 界面文案由组件阶段经 `lib/i18n/zh-CN.ts` 取。
 */

/* -------------------------------------------------------------------------- */
/* 八类消息                                                                    */
/* -------------------------------------------------------------------------- */

/** 八类消息。剧本 `contract.rule` 原文：每一步的 `emits` 只能取这八个之一。 */
export const MESSAGE_KINDS = [
  "alert",
  "context_package",
  "plan_update",
  "tool_call",
  "action_card",
  "approval",
  "audit_event",
  "sediment",
] as const

export type MessageKind = (typeof MESSAGE_KINDS)[number]

/**
 * 十二个组件 id（剧本 `components` 段）。
 *
 * 编号 ⑬（传统引擎对照栏）**永久空缺** —— 那是已签署的范围决定，不是遗漏：
 * 它服务演示叙事，由演示层承担。这里因此既没有 `engine-compare` 这个 id，
 * 也不允许任何消息 `affects` 它。
 */
export const COMPONENT_IDS = [
  "command-bar", // ① 态势指挥条
  "plan-panel", // ② 任务计划面板
  "finding-stream", // ③ 研判流
  "tool-console", // ④ 工具控制台
  "attack-graph", // ⑤ 攻击链实体画布
  "authority", // ⑥ 处置与授权卡片区
  "audit-timeline", // ⑧ 审计时间线
  "ask-sth", // ⑨ 问 STH
  "en-pipeline", // ⑩ E+N 数据汇流视图
  "sediment", // ⑪ 战果与沉淀面板
  "roster", // ⑫ AI 数字员工花名册
  "report-stream", // ⑭ 报告流式生成
] as const

export type ComponentId = (typeof COMPONENT_IDS)[number]

/* -------------------------------------------------------------------------- */
/* 行为者与自主度                                                              */
/* -------------------------------------------------------------------------- */

/** 四个 AI 数字员工（种子 `headerStats.roster`）。 */
export const AGENT_ACTORS = ["调查 Agent", "取证 Agent", "处置 Agent", "报告 Agent"] as const

export type AgentActor = (typeof AGENT_ACTORS)[number]

/** 人。审批事件的 actor 只有它 —— 「AI 干活，责任在人」这条边界在类型里就写死。 */
export const HUMAN_ACTOR = "人工"

export type ActorRef = AgentActor | typeof HUMAN_ACTOR

/** 自主度阶梯（种子 `headerStats.autonomyLadder`）。 */
export const AUTONOMY_LEVELS = ["L0", "L1", "L2", "L3", "L4"] as const

export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number]

/** 场景策略：L4 限定自主（种子 `headerStats.scenePolicy`）。 */
export const SCENE_AUTONOMY_CEILING: AutonomyLevel = "L3"

/* -------------------------------------------------------------------------- */
/* 证据与实体                                                                  */
/* -------------------------------------------------------------------------- */

export type EvidenceId = string
export type EntityId = string
export type IncidentId = string
export type MessageId = string
export type CausalId = string

/** 数据源（种子 `environment.dataSources`）：只监听不阻断的探针 + 主机遥测。 */
export const DATA_SOURCE_IDS = ["probe", "edr"] as const

export type DataSourceId = (typeof DATA_SOURCE_IDS)[number]

/** 证据种类（种子 `evidence[].kind`）。 */
export const EVIDENCE_KINDS = ["packet", "process-chain", "file-hash"] as const

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]

/** 实体种类（种子 `entities[].kind`）。 */
export const ENTITY_KINDS = ["attacker", "asset", "file", "data"] as const

export type EntityKind = (typeof ENTITY_KINDS)[number]

/** 证据引用。`entityRefs` 是「这条证据指向谁」，`sourceRefs` 是「它是从哪来的」。 */
export type EvidenceItem = {
  id: EvidenceId
  kind: EvidenceKind
  source: DataSourceId
  label: string
  entityRefs: EntityId[]
}

/** 实体在画布上的状态（种子的取值 + 回合 3 推进后的取值）。 */
export const ENTITY_STATES = [
  "已识别",
  "控制中",
  "已清除",
  "定位完成",
  "未触及",
  "0 异常",
  "封禁中",
] as const

export type EntityState = (typeof ENTITY_STATES)[number]

export type EntityView = {
  id: EntityId
  kind: EntityKind
  label: string
  state: EntityState
}

/* -------------------------------------------------------------------------- */
/* 计划                                                                        */
/* -------------------------------------------------------------------------- */

/** 计划步骤状态（种子 `plan.steps[].state` + 一个模型化取值 `superseded`，见下）。 */
export const PLAN_STEP_STATES = [
  "planned",
  "running",
  "done",
  "replanned",
  "blocked",
  "pending",
  /**
   * 被重规划划掉的旧计划行。
   *
   * 为什么需要它：剧本第 9 拍的签名动作是「旧计划行被划掉，改写为新方案」——
   * 「划掉」在数据上必须有一个状态，否则重规划在界面上只能表现为「多了一行」，
   * 而不是「它临场改了方案」。种子把这句话放在 `plan.replan.from`（旧计划「持续观察后门」）
   * 而不是 `plan.steps` 里，所以旧计划行是**本层把它显式建模成一步**的结果，
   * label 逐字取自种子 `plan.replan.from` 的引号内文字。
   */
  "superseded",
] as const

export type PlanStepState = (typeof PLAN_STEP_STATES)[number]

export type PlanStep = {
  id: string
  actor: AgentActor
  state: PlanStepState
  label: string
  detail?: string
}

/* -------------------------------------------------------------------------- */
/* 动作目录（分级授权的判据）                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 动作目录 —— `authority.no-unlisted-autonomous-action` 的机器可读判据。
 *
 * 两个方向都由种子里的真实卡片锚定：
 *   · 正例 `block-source`：卡片 a1「封禁攻击源 203.0.113.7」· autonomy L3 ·
 *     「L3 授权策略内 · 已自动执行」· 回滚窗口 41000ms（种子 `actionCards[0]`）；
 *   · 负例 `patch-config`：卡片 a2「修复上传接口扩展名白名单」·
 *     停在待批（种子 `actionCards[1]`），SLA 137s、超时默认挂起不执行。
 *
 * 所以清单的判据**不是**「能不能回滚」单条：a2 也有回退方案（`config.old` 一键回退），
 * 但它改的是**业务接口**，因此必须停在人这道门上。L3 允许自主执行的范围是
 * 「安全域内的收敛动作，且带可回滚窗口」。
 */
export const ACTION_CATALOG = {
  /**
   * 只读的排查动作（`ls` / `cat`）。
   *
   * 它们没有副作用，因此「可回滚」对它们是平凡的成立 —— 清单把它们收进来，
   * 是为了让「清单外动作必须停在人这道门」这条判据在只读动作上**不必开例外**。
   */
  "inspect-file": {
    reversible: true,
    approvalRequired: false,
  },
  /** 删除复核：`ls | grep` 返回空，确认节点已从攻击链摘除。 */
  "verify-file": {
    reversible: true,
    approvalRequired: false,
  },
  "block-source": {
    reversible: true,
    approvalRequired: false,
    rollbackWindowMs: 41_000,
  },
  "quarantine-file": {
    reversible: true,
    approvalRequired: false,
    rollbackWindowMs: 300_000,
  },
  "delete-file-with-backup": {
    reversible: true,
    approvalRequired: false,
    rollbackWindowMs: 300_000,
  },
  "terminate-process": {
    reversible: true,
    approvalRequired: false,
    rollbackWindowMs: 300_000,
  },
  "isolate-host": {
    reversible: true,
    approvalRequired: false,
    rollbackWindowMs: 300_000,
  },
  "revoke-session": {
    reversible: true,
    approvalRequired: false,
    rollbackWindowMs: 300_000,
  },
  "patch-config": {
    reversible: true,
    approvalRequired: true,
  },
  "rotate-credential": {
    reversible: true,
    approvalRequired: true,
  },
} as const

export type ActionCode = keyof typeof ACTION_CATALOG

/** 可回滚动作清单 —— 清单内的动作才允许 L3 自主执行。 */
export const AUTONOMOUS_ACTION_CODES = (
  Object.keys(ACTION_CATALOG) as ActionCode[]
).filter((code) => !ACTION_CATALOG[code].approvalRequired)

export function isAutonomousAction(code: ActionCode): boolean {
  return AUTONOMOUS_ACTION_CODES.includes(code)
}

/* -------------------------------------------------------------------------- */
/* 消息信封                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 消息信封 —— 每条消息都有的公共字段。
 *
 * ## 两个时钟，不是一个（这是本层最重要的一处建模决定）
 *
 * `occurredAtMs`（事实时间）与 `revealedAtMs`（回放时间）**必须分开**，因为两份权威材料
 * 各自只给了其中一半：
 *
 *   · 种子给的是**事实时间**：`audit` 段的四条真值 16:20:31 / 16:20:38 / 16:20:52 / 16:21:00，
 *     以及 `findings[].elapsedMs = 930`（汇流耗时 0.93s）、`plan.steps[0].detail = "0.9s 前完成"`。
 *   · 剧本给的是**回放时间**：`beats[].at` 的 `T+0.0s … T+10.2s`，而且剧本自己写明
 *     「每步的『第几秒』是示意，不是设计值……T+ 的偏移量是回放器自己的节奏」。
 *
 * 把两者混成一个数会产生一个**假的断言**：第 7 拍（T+3.2s 揭示）记录的那条审计行，
 * 事实时间是 16:20:31。若只保留一个时间字段，要么时间线上显示出错的时间戳
 * （丢掉种子真值），要么把揭示顺序排成 16:20:31 < 16:20:31.9 < … 从而让「计划先于动作」
 * 这类顺序不变量失去对象。分开之后，两边都保真：**时间线显示事实时间，回放游标走回放时间**。
 *
 * `revealedAtMs` 的取值只有两种形态：背景（当日事件簿）里的消息一律是 `-1`
 * —— 回放开场时它们**已经在册**（这是「今日」的含义）；解说窗口内的消息则取剧本的
 * `T+` 偏移毫秒数，于是前台 17 拍严格按剧本顺序揭示。
 */
export type MessageEnvelope = {
  id: MessageId
  /** 全序序号，1 起、稠密。排序见 `timeline.ts` 的 `compareMessages`。 */
  seq: number
  kind: MessageKind
  incidentId: IncidentId
  /** 这条消息由剧本第几拍产生；当日事件簿（背景）的消息为 `null`。 */
  beatStep: number | null
  /** 事实时间：当日 00:00:00 起的毫秒数。时间线与「今日」聚合都用它。 */
  occurredAtMs: number
  /** 事实时间的 `HH:MM:SS`（业务记录内容，不翻译）。 */
  occurredAt: string
  /** 回放时间：`-1` = 开场已在册（当日事件簿）；否则为本场演示的 `T+` 毫秒数。 */
  revealedAtMs: number
  /** 哪条消息触发了它（直接因果）。根消息为 `null`。 */
  causeId: MessageId | null
  /** 因果 ID：从根到自己的 id 链，`/` 分隔。见下方 `causalIdOf`。 */
  causalId: CausalId
  evidenceRefs: EvidenceId[]
  affects: ComponentId[]
}

/**
 * 因果 ID 的编码：**从根消息到自己这条消息的 id 链**，`/` 分隔。
 *
 * ```
 * 根        m001-alert                          →  "m001-alert"
 * 儿子      m002-tool_call   （cause = m001）    →  "m001-alert/m002-tool_call"
 * 孙子      m003-audit_event （cause = m002）    →  "m001-alert/m002-tool_call/m003-audit_event"
 * ```
 *
 * 三个性质让 `audit.replay-is-faithful` 不只是口号：
 *
 * 1. **可走回**：`causalId.split("/")` 就是完整祖先链，不需要第二个索引；
 * 2. **自洽可测**：`causeId` 必须等于 `causalId` 的倒数第二段，`id` 必须是最后一段 ——
 *    编码本身因此可以被断言，而不是一段自由文本（见 `verify.ts` 的 `scanCausalLedger`）；
 * 3. **有限深度**：本场的因果链最深 4 层（alert → action_card → approval → tool_call → audit_event），
 *    所以字符串很短，可以直接进审计记录、进导出物、进 URL 参数。
 */
export function causalIdOf(causeCausalId: CausalId | null, id: MessageId): CausalId {
  return causeCausalId === null ? id : `${causeCausalId}/${id}`
}

/** 从因果 ID 里拆出祖先链（含自己）。 */
export function causalChainOf(causalId: CausalId): MessageId[] {
  return causalId.split("/")
}

/* -------------------------------------------------------------------------- */
/* 八类消息各自的载荷                                                          */
/* -------------------------------------------------------------------------- */

/** 结论 + 置信度 + 证据 refs —— 八类消息里凡带结论的都用这个形状。 */
export type Claim = {
  findingId: string
  conclusion: string
  confidence: number
  evidenceRefs: EvidenceId[]
  sources: DataSourceId[]
}

/** ① alert：告警到达。带结论时就是一条 claim（第 5 拍）。 */
export type AlertMessage = MessageEnvelope & {
  kind: "alert"
  actor: AgentActor
  source: DataSourceId
  severity: "low" | "medium" | "high"
  entityRefs: EntityId[]
  claim: Claim | null
  /** 与第 1 拍并列到达的另一路数据源（双源同一事件）。 */
  alsoFrom?: DataSourceId
}

/** ② context_package：E+N 汇流，把两路证据合流成一个上下文包。 */
export type ContextPackageMessage = MessageEnvelope & {
  kind: "context_package"
  actor: AgentActor
  claim: Claim
  /** 汇流耗时（种子 `findings[1].elapsedMs = 930`）。 */
  mergeElapsedMs: number
  packageLabel: string
  mergeLabel: string
}

/** ③ plan_update：计划出现或改写。 */
export type PlanUpdateMessage = MessageEnvelope & {
  kind: "plan_update"
  actor: AgentActor
  /** 本步新增/更新的计划步骤。 */
  steps: PlanStep[]
  /** 重规划时被划掉的旧计划行（种子 `plan.replan.from`）。 */
  supersedes?: PlanStep
  replan?: { from: string; to: string }
}

/** ④ tool_call：一次真实执行的工具动作（本阶段命令不落到真实主机）。 */
export type ToolCallMessage = MessageEnvelope & {
  kind: "tool_call"
  actor: AgentActor
  actionCode: ActionCode
  /** 自动化通道：`true` = 清单内自主执行；`false` = 经人批准后执行。 */
  auto: boolean
  autonomy: AutonomyLevel
  /** 处置说明卡（先于命令出现，种子 `toolCalls[0].brief`）。 */
  brief?: string
  session?: string
  command?: string
  output?: string
  exitCode?: number
  /** 回滚窗口（清单内动作才有）。 */
  rollbackWindowMs?: number
  /** 经人批准而执行时，指向那张授权卡。 */
  approvalCardId?: string
}

/** ⑤ action_card：处置与授权卡片。 */
export type ActionCardMessage = MessageEnvelope & {
  kind: "action_card"
  actor: AgentActor
  cardId: string
  cardKind: "auto" | "approval-required"
  actionCode: ActionCode
  title: string
  autonomy: AutonomyLevel
  basis: string
  impact: string
  rollback: string
  /** 五件套（待批卡才有）。 */
  five?: { what: string; basis: string; impact: string; rollback: string; alternative: string }
  actions?: readonly string[]
  sla?: { ms: number; timeoutPolicy: string }
  rollbackWindowMs?: number
  /** 这张卡挂在计划的哪一步上（计划面板与授权卡区的连接点）。 */
  planStepId?: string
  /** 挂上去的那一步的**待批状态**（种子 `plan.steps[5]`：blocked / 挂起待授权）。 */
  planStep?: PlanStep
}

/** ⑥ approval：人对卡片的裁决。 */
export type ApprovalMessage = MessageEnvelope & {
  kind: "approval"
  actor: typeof HUMAN_ACTOR
  cardId: string
  decision: "approved" | "rejected" | "param-changed"
  note?: string
}

export type AuditScope = "incident" | "background"

/** ⑦ audit_event：留痕。背景闭环行与回合 3 时间线行共用这一个形状。 */
export type AuditEventMessage = MessageEnvelope & {
  kind: "audit_event"
  actor: ActorRef
  scope: AuditScope
  action: string
  basisRefs: EvidenceId[]
  /** 闭环记录（背景事件簿的每一起闭环都带它）。 */
  closure?: {
    outcome: "closed-autonomous" | "closed-after-approval"
    handlingMs: number
  }
}

/** ⑧ sediment：沉淀物。 */
export type SedimentItem = {
  id: string
  label: string
  kind: "detection-playbook" | "policy" | "attacker-profile"
  sourceRefs: string[]
}

export type SedimentMessage = MessageEnvelope & {
  kind: "sediment"
  actor: AgentActor
  items: SedimentItem[]
  reportLines: string[]
  /** 设计稿静帧值（种子 `report.progressPercent = 68`）：是取值，不是派生量。 */
  reportProgressPercent: number
}

export type IncidentMessage =
  | AlertMessage
  | ContextPackageMessage
  | PlanUpdateMessage
  | ToolCallMessage
  | ActionCardMessage
  | ApprovalMessage
  | AuditEventMessage
  | SedimentMessage

/* -------------------------------------------------------------------------- */
/* 值域守卫（供纯函数与测试共用）                                              */
/* -------------------------------------------------------------------------- */

const asSet = (values: readonly string[]): ReadonlySet<string> => new Set(values)

export const MESSAGE_KIND_SET = asSet(MESSAGE_KINDS)
export const COMPONENT_ID_SET = asSet(COMPONENT_IDS)
export const AGENT_ACTOR_SET = asSet(AGENT_ACTORS)
export const AUTONOMY_LEVEL_SET = asSet(AUTONOMY_LEVELS)
export const EVIDENCE_KIND_SET = asSet(EVIDENCE_KINDS)
export const DATA_SOURCE_SET = asSet(DATA_SOURCE_IDS)
export const ACTION_CODE_SET = asSet(Object.keys(ACTION_CATALOG))

export function isMessageKind(value: string): value is MessageKind {
  return MESSAGE_KIND_SET.has(value)
}

export function isComponentId(value: string): value is ComponentId {
  return COMPONENT_ID_SET.has(value)
}
