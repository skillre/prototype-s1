/**
 * STH 事件总线 —— zustand 参考实现（本仓的第一个，也是仓规里那条约定的落地样本）。
 *
 * ## 约定（`prototype-sth/AGENTS.md` 的「Zustand 约定」一节，这里是它的参考实现）
 *
 * > selector 只取**原始值**（例如事件数组本身），派生（filter/sort/计数）在组件内用 `useMemo`。
 * > **禁止在 selector 里返回新数组/新对象**（zustand v5 会无限渲染）。
 *
 * 所以这个 store 里只有两样东西：**原始事件序列**与**回放游标**。没有 `plan`、没有
 * `counters`、没有 `findings` —— 那些都是派生量，派生量住在纯函数模块里
 * （`lib/sth/replay.ts` / `lib/sth/counters.ts`），由组件在 `useMemo` 里算：
 *
 * ```tsx
 * const events = useIncidentStore(selectEvents)      // 原始引用，稳定
 * const cursorMs = useIncidentStore(selectCursorMs)  // 原始数字
 * const state = useMemo(() => replayStream(events, cursorMs), [events, cursorMs])
 * const counters = useMemo(() => countersFromEvents(events, cursorMs), [events, cursorMs])
 * ```
 *
 * 反面写法（会无限渲染，别抄）：
 *
 * ```tsx
 * const findings = useIncidentStore((s) => s.events.filter((e) => e.kind === "alert"))  // ✗ 每次新数组
 * const state = useIncidentStore((s) => replayStream(s.events, s.cursorMs))             // ✗ 每次新对象
 * ```
 *
 * 无 UI 时也可以直接用：`useIncidentStore.getState()` / `useIncidentStore.subscribe(...)`
 * —— 事件序列本身就是那个「真状态机」的状态。
 */

import { create } from "zustand"

import type { IncidentMessage } from "../lib/sth/contract"
import { buildIncidentStream } from "../lib/sth/timeline"

/** 开场之前的游标：当日事件簿还没揭示（`-1` 比任何一条消息的 `revealedAtMs` 都小）。 */
export const CURSOR_OPENING_MS = -1

export type IncidentStoreState = {
  /** 原始事件序列。只增不改：它是只读事实，改派生的东西。 */
  events: readonly IncidentMessage[]
  /** 回放游标（毫秒）。`CURSOR_OPENING_MS` = 开场之前。 */
  cursorMs: number
  /** 载入确定性时间轴（同一次会话里两次调用得到同一条序列）。 */
  loadCanonicalStream: () => void
  /** 追加一条消息（例如第 18 拍「问 STH」按需生成的那条）。 */
  append: (message: IncidentMessage) => void
  /**
   * 把一条消息插到**某条已发生消息之后**（例如人此刻做出的裁决）。
   *
   * ## 为什么只有「追加」不够（2026-09-17 实测出来的假按钮）
   *
   * 「已揭示」不是一个过滤条件，而是一个**前缀**：`revealedMessages` 与 `replayStream`
   * 都从序列头部开始收，遇到第一条还没揭示的就 `break`。所以一条**追加在末尾**的消息，
   * 只有在它前面每一条都已经揭示时才够得着 —— 回放停在半途时，追加的消息永远落在游标之外，
   * 无论把它的时刻写成多少（`-1`、`此刻`、`此刻 − 1ms` 都试过，见
   * `tests/sth-batch3.spec.ts` 的「⑥ 人的裁决」一节）。
   *
   * 实测（`?beat=14` 上点 ⑥ 的「批准」）：序列从 412 条变成 413 条、排程也跟着长了 40ms，
   * 但卡片仍然是 `pending`、顶栏仍读「待人工授权 1 项」—— 界面上看起来什么都没发生。
   *
   * 所以人此刻做出的裁决走这一条：**插在当前游标那条消息之后**、时刻取当前时刻的后一毫秒。
   * 于是已揭示的前缀正好是「已经发生的一切 + 刚刚发生的这一件」，剧本里还没到的那些拍
   * 仍然在它后面等着。语义上也更准：人的决定发生在**此刻**，不是发生在演示结束之后。
   */
  insertAfter: (seq: number, message: IncidentMessage) => void
  /** 移动回放游标。 */
  seek: (cursorMs: number) => void
  /** 回到开场之前并清空序列。 */
  reset: () => void
}

export const useIncidentStore = create<IncidentStoreState>()((set) => ({
  events: [],
  cursorMs: CURSOR_OPENING_MS,
  loadCanonicalStream: () => set({ events: buildIncidentStream(), cursorMs: CURSOR_OPENING_MS }),
  append: (message) => set((current) => ({ events: [...current.events, message] })),
  insertAfter: (seq, message) =>
    set((current) => {
      const index = current.events.findIndex((event) => event.seq === seq)
      // 找不到锚点就退回追加：宁可能够被看见，也不要静默丢掉一条事实。
      const at = index < 0 ? current.events.length : index + 1
      return { events: [...current.events.slice(0, at), message, ...current.events.slice(at)] }
    }),
  seek: (cursorMs) => set({ cursorMs }),
  reset: () => set({ events: [], cursorMs: CURSOR_OPENING_MS }),
}))

/* -------------------------------------------------------------------------- */
/* selector：只取原始值                                                        */
/* -------------------------------------------------------------------------- */

/** 事件数组本身（引用稳定：同一份 state 永远返回同一个引用）。 */
export const selectEvents = (state: IncidentStoreState): readonly IncidentMessage[] => state.events

/** 游标本身。 */
export const selectCursorMs = (state: IncidentStoreState): number => state.cursorMs

/**
 * 装载确定性时间轴并返回它（给测试与非 React 场景用；UI 请走 `loadCanonicalStream`）。
 *
 * 返回的是**刚刚装进 store 的那一条**（引用相同），所以想直接拿去算派生量也不必再取一次。
 */
export function loadCanonicalStream(): readonly IncidentMessage[] {
  useIncidentStore.getState().loadCanonicalStream()
  return useIncidentStore.getState().events
}

/** 把游标推到某一条消息被揭示的那一刻（按需回放：直接跳到第 N 拍）。 */
export function seekToMessage(message: IncidentMessage): void {
  useIncidentStore.getState().seek(message.revealedAtMs)
}
