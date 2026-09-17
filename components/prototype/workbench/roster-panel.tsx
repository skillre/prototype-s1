"use client"

import { useMessages } from "@/components/i18n/locale-provider"
import { ROSTER_PANEL_ID } from "@/components/prototype/workbench/command-bar"
import { WorkbenchPanel, type PanelStatus } from "@/components/prototype/workbench/panel"
import type { RosterView } from "@/components/prototype/workbench/view-model"
import { AUTONOMY_LEVELS, SCENE_AUTONOMY_CEILING } from "@/lib/s1/contract"

/**
 * ⑫ 数字员工花名册 —— 顶栏那四个席位（调 / 取 / 处 / 报）的**展开面**。
 *
 * ## 判据：`authority.no-unlisted-autonomous-action` 在花名册上的形态
 *
 * 顶栏那句「N 个 AI 数字员工在岗」里的 N 是**算出来的**（本回合出动过的员工数），
 * 不是种子里的字面量 4。这一格把那个 N 拆开给人看：每个席位一行，
 * 说清楚他本回合做了几个动作、最近一个是哪个动作、在不在自主清单里、有没有卡停在他这道门上。
 *
 * 白名单判决来自 `isAutonomous(actionCode)` —— 与 `lib/s1/verify.ts` 的 `scanAuthority`
 * **同一份判据源**。界面不另立一张表：另立一张表就意味着"界面说可以、审计说不行"这种
 * 只会在演示当天暴露的分歧。
 *
 * ## 为什么它是悬浮面而不是第四列
 *
 * 设计稿实测的骨架是三列（500 / 600 / 366）+ 76px 顶栏 + 130px 底栏，没有留给第四列的宽度。
 * 花名册在顶栏右侧有自己的位置（那四个席位就是它），所以它的展开面按**浮层**处理：
 * 绝对定位、落在顶栏之下、不参与三列的排版 —— 于是展开与收起都不会推动任何一块面板，
 * 1680×1050 的骨架一行都不用改。
 *
 * ## 三态
 *
 * 由 `WorkbenchPanel` 统一表达（loading / empty / error）。这里的 empty 不是"还没做"，
 * 是一句事实：本回合还没开始，四个席位都还没出动。
 */
export function RosterPanel({
  status,
  view,
  open,
  errorMessage,
  onRetry,
}: {
  status: PanelStatus
  view: RosterView
  /** 展开面开着没有。收起时整块从 DOM 里移除（`hidden`），不留一个看不见的语义壳。 */
  open: boolean
  errorMessage?: string | null
  onRetry?: () => void
}) {
  const t = useMessages()
  const copy = t.workbench.roster

  return (
    <div className="s1-roster-panel" id={ROSTER_PANEL_ID} hidden={!open} data-open={String(open)}>
      <WorkbenchPanel
        id="roster"
        title={copy.title}
        subtitle={copy.subtitle}
        status={status}
        errorMessage={errorMessage}
        onRetry={onRetry}
        emptyTitle={copy.seatIdle}
        emptyNote={copy.whitelistNote}
        aside={
          <span
            className="s1-panel__subtitle"
            data-testid="roster-on-duty"
            data-on-duty={view.onDutyCount}
            data-total={view.total}
          >
            {copy.onDutyOf(view.onDutyCount, view.total)}
          </span>
        }
      >
        <ul className="s1-roster-list" data-testid="roster-seats">
          {view.seats.map((seat) => (
            <li
              key={seat.role}
              className="s1-roster-list__seat"
              data-seat={seat.role}
              data-on-duty={String(seat.onDuty)}
              data-action-count={seat.actionCount}
              data-whitelist={seat.inWhitelist === null ? "none" : String(seat.inWhitelist)}
              data-awaiting={String(seat.awaiting !== null)}
            >
              <div className="s1-roster-list__head">
                <span className="s1-roster__seat" data-meaning={seat.onDuty ? "ai" : undefined}>
                  {seat.short}
                </span>
                <span className="s1-roster-list__role">{seat.role}</span>
                <span
                  className="s1-roster-list__duty"
                  data-meaning={seat.onDuty ? "ai" : undefined}
                  data-testid="roster-duty"
                >
                  {seat.onDuty ? copy.actionCount(seat.actionCount) : copy.seatIdle}
                </span>
              </div>

              {seat.last === null ? (
                <p className="s1-roster-list__empty">{copy.noAction}</p>
              ) : (
                <div className="s1-roster-list__body">
                  <p className="s1-roster-list__action">
                    <span className="s1-field__name">{`${copy.lastAction}：`}</span>
                    {/* 动作的中文名来自词典（动作码是数据层的机器名）；动作码本身是记录内容，
                        放在 `<code>` 里，观众要能把它与审计行上的同一条对上。 */}
                    <span className="s1-roster-list__name">{seat.last.label}</span>
                    <code className="s1-roster-list__code">{seat.last.actionCode}</code>
                  </p>
                  <p className="s1-roster-list__autonomy">
                    <span className="s1-field__name">{`${copy.autonomy}：`}</span>
                    <span className="s1-roster-list__levels">
                      {AUTONOMY_LEVELS.map((level) => (
                        <span
                          key={level}
                          className="s1-ladder__step"
                          data-level={level}
                          data-active={level === seat.last?.autonomy ? "true" : "false"}
                          data-ceiling={level === SCENE_AUTONOMY_CEILING ? "true" : "false"}
                        >
                          {level}
                        </span>
                      ))}
                    </span>
                  </p>
                  {/* 白名单判决：清单内 = 允许自主；清单外 = 必须停在人这道门上。
                      两种说法都在文字里，颜色只是加重。 */}
                  <p
                    className="s1-roster-list__verdict"
                    data-testid="roster-whitelist"
                    data-meaning={seat.inWhitelist === true ? "ai" : undefined}
                  >
                    {seat.inWhitelist === true ? copy.inWhitelist : copy.outsideWhitelist}
                  </p>
                </div>
              )}

              {/* 停在人这道门上的待批卡：白名单外的动作能走到哪一步，就在这里说清楚。 */}
              <p
                className="s1-roster-list__awaiting"
                data-testid="roster-awaiting"
                data-meaning={seat.awaiting === null ? undefined : "waiting"}
              >
                {seat.awaiting === null
                  ? copy.awaitingNone
                  : `${copy.awaiting}：${seat.awaiting.title}（${seat.awaiting.cardId}）`}
              </p>
            </li>
          ))}
        </ul>

        {/* 判据的出处：白名单判决与审计扫描器同源。 */}
        <p className="s1-roster-list__note">{copy.whitelistNote}</p>

        {/* 数据源不是写死的 4：它来自 `AGENT_ACTORS`，而席位短名来自种子。两者分开。 */}
        <span className="sr-only" data-testid="roster-seat-count">{String(view.total)}</span>
      </WorkbenchPanel>
    </div>
  )
}
