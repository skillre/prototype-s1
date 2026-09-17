"use client"

import { useMessages } from "@/components/i18n/locale-provider"
import { scheduledBeats, type RosterView } from "@/components/prototype/workbench/view-model"
import type { WorkbenchReplay } from "@/hooks/use-workbench-replay"
import type { CounterSnapshot } from "@/lib/sth/counters"
import { AUTONOMY_LEVELS, SCENE_AUTONOMY_CEILING, type AgentActor, type AutonomyLevel } from "@/lib/sth/contract"
import { ENVIRONMENT, HEADER_STATS_SIGNED } from "@/lib/sth/seed"

/**
 * ⑫ 展开面的 DOM id。**模块级常量**：它必须跨渲染稳定，否则 `aria-controls` 会在下一次
 * 渲染时指向一个不存在的 id（关联是"上一次那个字符串"，不是"那个面板"）。
 */
export const ROSTER_PANEL_ID = "sth-roster-panel"

/**
 * ① 态势指挥条（76px，设计稿实测骨架）—— 含 ⑫ 数字员工花名册。
 *
 * 回放控制**不在这一条里**：设计稿的 ① 没有播放器，硬塞进来会把 1680px 撑破
 * （实测 1749px 对 1640px），于是花名册标签被挤成竖排、最右的控件被裁掉。
 * 它单独住一条 46px 的回放控制条（`ReplayControl`，见下与 `workbench-view.tsx`）。
 *
 * ## 哪些是读数、哪些是派生、哪些是记录
 *
 *   三个计数（128 / 3 / 41s）      **派生**：由事件流聚合重算（`countersFromEvents`），
 *                                 不是给顶栏赋的值（不变量 `evidence.counters-derive-from-events`）
 *   「待人工授权 N 项」            **派生**：待批授权卡的条数 —— 见 `view-model.ts` 的长注释
 *   花名册里谁在干活               **派生**：最后一条已揭示消息的 actor
 *   自主度阶梯里哪几档亮           **派生**：本回合已出现过的自主任档
 *   当前事件 / 场景策略 / 回合      **记录内容**：逐字来自种子，不翻译
 *   业务系统名                     **记录内容**：`environment.businessSystem`
 *
 * ## 一屏一个光源、一色一义
 *
 * 这一条里只有三种颜色：主墨、次墨、AI 青（= AI 正在产出：呼吸点、在岗员工、
 * 正在跑的回放按钮）。**没有红** —— 红属于攻击 / 失败，那是左列画布的事。
 */
export function CommandBar({
  counters,
  pendingApproval,
  activeActor,
  observedAutonomy,
  roster,
  rosterOpen,
  onToggleRoster,
}: {
  counters: CounterSnapshot
  /** 待人工授权条数（派生值，来自 `pendingApprovalCount(state)`）。 */
  pendingApproval: number
  activeActor: AgentActor | null
  observedAutonomy: readonly AutonomyLevel[]
  /** ⑫ 花名册的派生视图（在岗人数就在它里面）。 */
  roster: RosterView
  /** ⑫ 展开面开着没有。 */
  rosterOpen: boolean
  onToggleRoster: () => void
}) {
  const t = useMessages()
  const stats = HEADER_STATS_SIGNED
  const observed = new Set(observedAutonomy)

  const reads = [
    {
      key: "autonomousClosedToday",
      label: t.workbench.commandBar.counterAutonomous,
      value: String(counters.autonomousClosedToday),
    },
    {
      key: "humanInterventions",
      label: t.workbench.commandBar.counterInterventions,
      value: String(counters.humanInterventions),
    },
    {
      key: "avgHandlingSeconds",
      label: t.workbench.commandBar.counterHandling,
      value: `${counters.avgHandlingSeconds}${t.workbench.commandBar.secondUnit}`,
    },
  ]

  return (
    <header className="sth-header" data-testid="command-bar">
      <div className="sth-zone">
        <div className="sth-brand">
          <span aria-hidden="true" className="sth-brand__mark">
            {t.brand.mark}
          </span>
          <div className="flex min-w-0 flex-col">
            <h1 className="sth-brand__name">{t.brand.name}</h1>
            <span className="sth-counter__label">{t.brand.subtitle}</span>
          </div>
        </div>
        <span className="sth-counter__label">{ENVIRONMENT.businessSystem}</span>
      </div>

      <div className="sth-zone sth-zone--divider" title={t.workbench.commandBar.countersHint} data-testid="counters">
        {reads.map((read) => (
          <div key={read.key} className="sth-counter" data-counter={read.key}>
            <span className="sth-counter__value">{read.value}</span>
            <span className="sth-counter__label">{read.label}</span>
          </div>
        ))}
      </div>

      <div className="sth-zone sth-zone--divider sth-zone--grow">
        {/* 当前事件：种子记录内容，逐字显示。 */}
        <span className="sth-status__line" data-testid="current-event">
          {stats.currentEvent}
        </span>
        <span
          className="sth-status__line sth-status__line--muted"
          data-testid="live-status"
          data-pending-approvals={pendingApproval}
        >
          {/* 状态点：AI 正在跑。全场唯一的循环动效，reduced-motion 下降级为实心点。 */}
          <span aria-hidden="true" className="sth-dot sth-dot--breathing" />
          {t.workbench.commandBar.liveStatus(pendingApproval)}
        </span>
      </div>

      <div
        className="sth-zone sth-zone--divider"
        data-testid="autonomy-ladder"
        /* 空间不够时「场景策略」会以省略号收尾：title 让它仍然读得到全文。 */
        title={stats.scenePolicy}
      >
        <span className="sth-counter__label">{t.workbench.commandBar.autonomy}</span>
        <div className="sth-ladder">
          {AUTONOMY_LEVELS.map((level) => (
            <span
              key={level}
              className="sth-ladder__step"
              data-level={level}
              data-active={observed.has(level) ? "true" : "false"}
              data-ceiling={level === SCENE_AUTONOMY_CEILING ? "true" : "false"}
            >
              {level}
            </span>
          ))}
        </div>
        {/* 场景策略：种子记录内容，逐字。 */}
        <span className="sth-counter__label">{stats.scenePolicy}</span>
      </div>

      <div className="sth-zone sth-zone--divider" data-testid="round-timer">
        <div className="sth-counter">
          <span className="sth-counter__value">{`回合 ${stats.roundTimer.round}`}</span>
          <span className="sth-counter__label">{stats.roundTimer.label}</span>
        </div>
        {/* 设计稿静帧值（种子 `roundTimer.value`）：是取值，不是派生量 ——
            从 16:20:31 到 16:21:00 是 29 秒，台账推不出 18.4 秒，所以不假装它是活的。 */}
        <span className="sth-counter__value" data-design-value="true">
          {stats.roundTimer.value}
        </span>
      </div>

      <div className="sth-zone sth-zone--divider" data-testid="roster-zone">
        {/*
          花名册席位是**一个真控件**：它是 ⑫ 展开面的开关（`aria-expanded` + `aria-controls`）。
          过去它们是四个纯展示的方块 —— 点了没有任何事发生的方块，就是一个看起来像按钮的装饰。
          席位里用 `<span>` 而不是 `<div>`：`<button>` 的内容模型是短语内容，
          塞一个块级元素进去在 HTML 上就是错的（浏览器会照渲染，校验器不会）。
        */}
        <button
          type="button"
          className="sth-roster-toggle"
          data-testid="roster-toggle"
          aria-expanded={rosterOpen}
          aria-controls={ROSTER_PANEL_ID}
          onClick={onToggleRoster}
          title={rosterOpen ? t.workbench.roster.close : t.workbench.roster.open}
        >
          <span className="sth-roster">
            {roster.seats.map((seat) => (
              <span
                key={seat.role}
                className="sth-roster__seat"
                data-role={seat.role}
                data-active={seat.role === activeActor ? "true" : "false"}
                data-on-duty={String(seat.onDuty)}
                data-meaning={seat.onDuty ? "ai" : undefined}
                title={seat.role}
              >
                {seat.short}
              </span>
            ))}
          </span>
          {/*
            「N 个 AI 数字员工在岗」里的 N 是**派生值**：本回合出动过的员工数。
            它随回放从 0 长到 4，收尾那一帧逐字等于种子 `headerStats.rosterLabel`
            （有断言）—— 与顶栏那三个计数受同一条不变量管（`evidence.counters-derive-from-events`
            的姊妹条：界面上的数字要么是记录，要么是算出来的，不许是抄来的）。
          */}
          <span className="sth-roster__label" data-testid="roster-label" data-on-duty={roster.onDutyCount}>
            {t.workbench.roster.onDuty(roster.onDutyCount)}
          </span>
        </button>
      </div>
    </header>
  )
}

/**
 * 回放控制 —— 本批的**主要真实交互**，住在①下面的**回放控制条**里（见 `workbench-view.tsx`）。
 *
 * 它**不是**设计稿的组件：设计稿的 ① 是 76px 的读数条，里面没有播放器。把它塞进那一条
 * 会让 1680px 装不下（实测：内容 1749px 对 1640px 可用宽），于是说明卡、花名册的标签
 * 会被挤成竖排、最右边的控件被裁掉。所以它单独占一条 46px 的条：**仪表归仪表，
 * 战情室归战情室**，① 保持设计稿实测的骨架不变。
 *
 * 每一个控件都连到 store 的游标（经由 `useWorkbenchReplay`），没有一个是装饰：
 *
 *   回到开场   → `progressMs = 0`（当日事件簿已在册、解说窗口还没开始）
 *   上一拍/下一拍 → 跳到相邻的有固定时刻的节拍
 *   播放/暂停   → 播放时按钮取 pack 的 `--primary` 格位（青 = 系统在跑）
 *   滑块        → 拖到任意毫秒（拖动会暂停，停在那一帧上）
 *   下拉        → 直接跳到第 1–17 拍里的任何一拍
 *
 * 界面其余部分全部由这一处派生：在控制台上拖滑块，计划面板与控制台会跟着动。
 */
export function ReplayControl({ replay }: { replay: WorkbenchReplay }) {
  const t = useMessages()
  const beats = scheduledBeats(replay.schedule)
  const current = replay.frame.beatStep
  const index = current === null ? -1 : beats.indexOf(current)
  const previous = index > 0 ? beats[index - 1] : beats[0]
  const next = index >= 0 && index < beats.length - 1 ? beats[index + 1] : beats[beats.length - 1]

  const phase = replay.atEnd
    ? t.workbench.replay.finished
    : replay.playing
      ? t.workbench.replay.playing
      : t.workbench.replay.paused

  const position =
    replay.frame.cursor.revealedAtMs < 0
      ? t.workbench.replay.beforeOpening
      : t.workbench.replay.position((replay.frame.cursor.revealedAtMs / 1000).toFixed(2))

  return (
    <div className="sth-replay" data-testid="replay-control">
      <span className="sth-counter__label">{t.workbench.replay.label}</span>

      <button
        type="button"
        className="kits-control sth-replay__button"
        onClick={replay.restart}
        data-testid="replay-restart"
      >
        {t.workbench.replay.restart}
      </button>

      <button
        type="button"
        className="kits-control sth-replay__button"
        onClick={() => replay.seekBeat(previous)}
        data-testid="replay-prev-beat"
      >
        {t.workbench.replay.stepBack}
      </button>

      <button
        type="button"
        className={
          replay.playing
            ? "kits-control kits-control--primary sth-replay__button"
            : "kits-control sth-replay__button"
        }
        onClick={replay.toggle}
        aria-pressed={replay.playing}
        /* 「在跑」这个状态由青承载 —— 与 ① 的呼吸点、花名册里在岗的员工同一个意思。
           一色一义那条不变量要求「染了语义色的元素必须声明它的含义」，所以这里必须说出来；
           不声明就会被色义审计判红，而不是被放过。 */
        data-meaning={replay.playing ? "ai" : undefined}
        data-testid="replay-toggle"
      >
        {replay.playing ? t.workbench.replay.pause : t.workbench.replay.play}
      </button>

      <button
        type="button"
        className="kits-control sth-replay__button"
        onClick={() => replay.seekBeat(next)}
        data-testid="replay-next-beat"
      >
        {t.workbench.replay.stepForward}
      </button>

      <input
        type="range"
        className="sth-replay__range"
        min={0}
        max={Math.max(1, Math.round(replay.durationMs))}
        step={10}
        value={Math.round(replay.progressMs)}
        onChange={(event) => replay.seekProgress(Number(event.target.value))}
        aria-label={t.workbench.replay.timeline}
        data-testid="replay-range"
      />

      <select
        className="sth-replay__select"
        /* 显示的是**界面请求过的**那一拍，不是当前帧的拍号：第 18 拍没有自己的帧，
           若显示当前帧就会跳回 17 —— 观众点了 18、界面显示 17，那是一次看得见的撒谎。 */
        value={replay.requestedBeat === null ? "" : String(replay.requestedBeat)}
        onChange={(event) => replay.seekBeat(Number(event.target.value))}
        aria-label={t.workbench.replay.jumpAny}
        data-testid="replay-beat-jump"
      >
        <option value="" disabled>
          {t.workbench.replay.jumpAny}
        </option>
        {beats.map((beat) => (
          <option key={beat} value={String(beat)}>
            {t.workbench.replay.jump(beat)}
          </option>
        ))}
      </select>

      <span
        className="sth-replay__position"
        data-testid="replay-position"
        data-replay-cursor-ms={replay.frame.cursor.revealedAtMs}
        data-replay-cursor-seq={Number.isFinite(replay.frame.cursor.seq) ? replay.frame.cursor.seq : -1}
        data-requested-beat={replay.requestedBeat ?? -1}
        data-beat-clamped={replay.requestedBeatClamped ? "true" : "false"}
      >
        {position}
      </span>
      {/* 夹取要说出来：请求的那一拍没有自己的帧时，界面明说它落在了哪儿。
          「没有这一帧」与「回到开场」是两件事，静默归零是一次看不见的撒谎。 */}
      {replay.requestedBeatClamped ? (
        <span className="sth-counter__label" data-testid="replay-beat-clamped">
          {t.workbench.replay.beatClamped(replay.requestedBeat ?? 0, current ?? 0)}
        </span>
      ) : null}
      <span className="sth-counter__label" data-testid="replay-phase">
        {phase}
      </span>
    </div>
  )
}
