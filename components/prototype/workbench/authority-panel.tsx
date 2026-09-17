"use client"

import { Fragment } from "react"

import { useMessages } from "@/components/i18n/locale-provider"
import { WorkbenchPanel, type PanelStatus } from "@/components/prototype/workbench/panel"
import {
  clockOfMs,
  slaRemainingMs,
  type AuthorityCardView,
} from "@/components/prototype/workbench/view-model"
import { cn } from "@/lib/utils"

/**
 * ⑥ 处置与授权卡片区 —— 「AI 干活，责任在人」在这一屏上的物证。
 *
 * ## 两条通道，一个问题
 *
 * 这一栏回答：**哪些处置是 AI 自己做的，哪些停在人这道门上。** 卡片按数据层的 `cardKind` 分两条：
 * `auto`（免授权通道 —— 自主清单内的动作，带回滚窗口）与 `approval-required`（需人工授权 ——
 * 五件套 + SLA + 三个真实按键）。
 *
 * ## 自主度是数据层的事实，不是界面的意见
 *
 * 「L3 授权策略内」里的级别不是这里判断的：`autonomousAllowed` 由数据层的
 * `isAutonomous(actionCode)` 给出（与 `lib/s1/verify.ts` 的 `scanAuthority` 共用 `ACTION_CATALOG`
 * 这一份判据源），`executedAutomatically` 由**真实执行记录**给出。卡上那对
 * `data-autonomous-allowed` / `data-auto-executed` 就是这两个事实的机器可读形式 —— 断言读它，
 * 而不是读 JSX 里有没有「已自动执行」四个字。所以状态词是推出来的：只有真的执行过才说「已自动
 * 执行」，否则如实说「需人工授权」—— 动作可以在自主清单内，却因本回合没有执行记录而仍停在人这里；
 * 合成一件事，界面就成了第二份判据。
 *
 * ## SLA 由游标派生，不是定时器
 *
 * 剩余量 = `slaRemainingMs(slaMs, 这张卡被揭示的时刻, progressMs)`。`progressMs` 是回放进度而不是
 * 墙钟：暂停会冻住、倒拖游标会把时间还回来，`?autoplay=0` 停在卡片刚打开那一帧时读到的就是整段
 * SLA（137000ms → `02:17`，设计稿的实测值）。倒计时一旦有了自己的定时器，「界面在动」与
 * 「数据在动」就成了两件事 —— 而这个面板正好是两者必须同一的地方。
 *
 * ## 这里没有红色
 *
 * 琥珀 = 球在你那边（待批、SLA），青 = AI 正在产出（自主执行），绿 = 已裁决闭环；红色在这一屏是
 * 「攻击 / 失败」，而这一栏里没有失败 —— **驳回是一次正常的裁决，不是故障**。
 *
 * ## 不编一个字的界面
 *
 * 卡标题、五件套正文、依据 / 影响 / 回滚、动作码中文名、时间戳都逐字来自 `lib/s1/**`；界面词
 * （通道名、字段名、三个键、SLA 标签）走词典。「证据」那句 `#e-79 …` 是种子原文，不是界面抠出来
 * 的引用（`evidenceRefs` 本批为空，抠字符串会造出一条未经核对的引用）。
 */

type AuthorityCopy = ReturnType<typeof useMessages>["workbench"]["authority"]
type AuthorityDecision = "approved" | "rejected" | "param-changed"

/** 五件套的展示顺序 —— 设计稿的顺序，不是对象键的偶然顺序。 */
const FIVE_ORDER = ["what", "basis", "impact", "rollback", "alternative"] as const
type FiveKey = (typeof FIVE_ORDER)[number]

export function AuthorityPanel({
  status,
  cards,
  progressMs,
  revealTimes,
  onDecide,
  errorMessage,
  onRetry,
}: {
  status: PanelStatus
  cards: AuthorityCardView[]
  progressMs: number
  /** 消息序号 → 它在**播放进度**上的揭示时刻：SLA 倒计时的锚点。 */
  revealTimes: ReadonlyMap<number, number>
  onDecide: (cardId: string, decision: AuthorityDecision) => void
  errorMessage?: string | null
  onRetry?: () => void
}) {
  const t = useMessages()
  const copy = t.workbench.authority

  /* 待授权条数**从传进来的这份数组里数**，不是字面量：于是它不可能与卡片区自己打架
     （第 14 拍 1 项，第 15 拍人裁决之后 0 项，都是同一份数据的必然结果）。 */
  const pendingCount = cards.filter(
    (card) => card.cardKind === "approval-required" && card.state === "pending",
  ).length
  const cardProps = { copy, progressMs, revealTimes, onDecide } as const

  return (
    <WorkbenchPanel
      id="authority"
      title={copy.title}
      /* 0 项时它保持中性：没有待批卡还亮着琥珀，就是让「球在你那边」这个颜色失效。 */
      aside={
        <span
          className={cn("s1-auth__pending", pendingCount > 0 && "s1-auth__pending--waiting")}
          data-testid="authority-pending"
          data-pending-approvals={pendingCount} data-meaning={pendingCount > 0 ? "waiting" : undefined}
        >
          {copy.submitted(pendingCount)}
        </span>
      }
      status={status}
      errorMessage={errorMessage}
      onRetry={onRetry}
      emptyTitle={copy.empty}
      emptyNote={copy.emptyNote}
    >
      <div className="s1-auth" data-testid="authority-list">
        {cards.map((card) => (
          <AuthorityCard key={card.cardId} card={card} {...cardProps} />
        ))}
      </div>
    </WorkbenchPanel>
  )
}

/** 一张卡渲染要的东西：数据 + 回放游标 + 人的那一下。 */
type AuthorityCardProps = {
  card: AuthorityCardView
  copy: AuthorityCopy
  progressMs: number
  revealTimes: ReadonlyMap<number, number>
  onDecide: (cardId: string, decision: AuthorityDecision) => void
}

/**
 * 一张处置卡。两种卡共用同一套骨架（抬头 → 标题 → 状态 → 字段 → 回滚窗口 → SLA → 三个键 /
 * 裁决记录），差别只在**数据层真的给了什么**：自动卡没有 `what` 与 `alternative`，待批卡没有
 * 回滚窗口。缺的就不画 —— 不留空栏，也不补一句看起来对的话。
 */
function AuthorityCard({ card, copy, progressMs, revealTimes, onDecide }: AuthorityCardProps) {
  const auto = card.cardKind === "auto"
  const meaning = meaningOf(card)
  /* 揭示时刻取不到就按 0 算：那说明这一帧还没到它，剩余量自然是整段 SLA。 */
  const remainingMs = slaRemainingMs(card.slaMs, revealTimes.get(card.seq) ?? 0, progressMs)
  const decisionText = card.decision === null ? null : copy.decisions[card.decision]

  return (
    <article
      className="s1-auth__card"
      data-testid={auto ? "authority-auto-card" : "authority-approval-card"}
      data-card-id={card.cardId} data-card-kind={card.cardKind} data-card-state={card.state}
      data-action-code={card.actionCode}
      data-autonomous-allowed={String(card.autonomousAllowed)} data-auto-executed={String(card.executedAutomatically)}
      data-meaning={meaning}
    >
      <header className="s1-auth__head">
        <span className="s1-auth__channel">{auto ? copy.autoChannel : copy.approvalRequired}</span>
        <span className="s1-auth__level" data-testid="authority-level" data-autonomy={card.autonomy}>
          {card.autonomy}
        </span>
      </header>

      <p className="s1-auth__title">{card.title}</p>

      {/* 状态词由 `executedAutomatically` 推出，不由卡片的声明给出。 */}
      {auto ? (
        <p className="s1-auth__state" data-testid="authority-auto-state" data-meaning={meaning}>
          {copy.autoState(
            card.autonomy,
            card.executedAutomatically ? copy.autoExecuted : copy.approvalRequired,
          )}
        </p>
      ) : null}

      <p className="s1-auth__source" data-testid="authority-source" title={copy.authoritySource}>
        {copy.authoritySource}
      </p>

      <dl className="s1-fields s1-auth__five">
        {FIVE_ORDER.map((key) => {
          const value = fiveValueOf(card, key)
          if (value === null) return null
          return (
            <Fragment key={key}>
              <dt className="s1-field__name">{copy.five[key]}</dt>
              <dd className="s1-field__value" data-five-key={key}>
                {value}
              </dd>
            </Fragment>
          )
        })}
      </dl>

      {/* 后悔药：动作已闭环（绿），这一段是它的撤销期；待批卡上的窗口属于「还在等人」（琥珀）。
          那句 `card.rollback` 已在上面「回滚」一栏逐字出现过，这里只印窗口 —— 同一句话印两遍
          不是更忠实，是把一条记录读成两条。 */}
      {card.rollbackWindowMs === null ? null : (
        <div
          className="s1-auth__rollback"
          data-testid="authority-rollback-window"
          data-rollback-window-ms={card.rollbackWindowMs} data-meaning={card.state === "pending" ? "waiting" : "closed"}
        >
          <span>{copy.rollbackWindow}</span>
          <span className="s1-auth__clock">{clockOfMs(card.rollbackWindowMs)}</span>
        </div>
      )}

      {remainingMs === null ? null : (
        <div
          className="s1-auth__sla"
          data-testid="authority-sla" data-sla-remaining-ms={remainingMs} data-meaning="waiting"
        >
          <span className="s1-dot s1-dot--warning s1-dot--breathing" data-meaning="waiting" aria-hidden="true" />
          <span>{copy.sla}</span>
          <span className="s1-auth__clock" data-testid="authority-sla-clock">
            {copy.remaining(clockOfMs(remainingMs))}
          </span>
          {/* 超时策略是数据层的记录；数据层没给才退回词典那句。 */}
          <span className="s1-auth__policy">{card.slaTimeoutPolicy ?? copy.slaTimeout}</span>
        </div>
      )}

      {card.actions.length === 0 ? null : (
        <div className="s1-auth__keys">
          {card.actions.map((label, index) => {
            const decision = decisionOf(copy, label)
            /* 认不出来的键**按不动**：种子里出现了一个词典里没有的决定，界面不该替它选一个。 */
            const live = decision !== null && card.state === "pending"
            return (
              <button
                key={`${card.cardId}-action-${index}`}
                type="button"
                className={cn("kits-control", live && decision === "approved" && "kits-control--authorize")}
                data-decision={decision ?? ""}
                data-meaning={live && decision === "approved" ? "waiting" : undefined}
                disabled={!live}
                title={decision === null ? label : undefined}
                onClick={() => {
                  if (decision !== null) onDecide(card.cardId, decision)
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}

      {/* 裁决记录是这张卡的终点：按钮留在原处但按不动，决定以文字说出来。 */}
      {card.state !== "pending" && card.decision !== null && decisionText !== null ? (
        <p
          className="s1-auth__decision" data-testid="authority-decision"
          data-decided={card.decision} data-meaning="closed"
        >
          {copy.decided(decisionText)}
        </p>
      ) : null}
    </article>
  )
}

/** 这张卡此刻是「什么颜色意思」—— 用语义槽的元素都从这里取，不允许各处自己判断。 */
function meaningOf(card: AuthorityCardView): "waiting" | "ai" | "closed" {
  /* 自动通道先判：一张自主清单内的卡「有没有真的执行」是**记录事实**，比卡片的 `state` 更具体
     （`state: "executed"` 只说这张卡是怎么开的，不说它真的跑过）。 */
  if (card.cardKind === "auto") return card.executedAutomatically ? "ai" : "waiting"
  return card.state === "pending" ? "waiting" : "closed"
}

/** 种子那三个键 → 裁决。判据是**文案**（与词典三句逐一比对），不是数组下标 —— 调换顺序不该让
 * 「批准」变成「驳回」。 */
function decisionOf(copy: AuthorityCopy, label: string): AuthorityDecision | null {
  if (label === copy.approve) return "approved"
  if (label === copy.reject) return "rejected"
  if (label === copy.changeParams) return "param-changed"
  return null
}

/** 五件套里某一栏的值；数据层没有这一栏就是 `null`，由上面跳过而不是打印一个空栏。 */
function fiveValueOf(card: AuthorityCardView, key: FiveKey): string | null {
  switch (key) {
    case "what":
      return card.what
    case "basis":
      return card.basis
    case "impact":
      return card.impact
    case "rollback":
      return card.rollback
    default:
      return card.alternative
  }
}
