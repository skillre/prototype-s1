/**
 * S1 事件总线 —— zustand 参考实现（本仓的第一个，也是仓规里那条约定的落地样本）。
 *
 * ## 约定（`prototype-s1/AGENTS.md` 的「Zustand 约定」一节，这里是它的参考实现）
 *
 * > selector 只取**原始值**（例如事件数组本身），派生（filter/sort/计数）在组件内用 `useMemo`。
 * > **禁止在 selector 里返回新数组/新对象**（zustand v5 会无限渲染）。
 *
 * 所以这个 store 里只有两样东西：**原始事件序列**与**回放游标**。没有 `plan`、没有
 * `counters`、没有 `findings` —— 那些都是派生量，派生量住在纯函数模块里
 * （`lib/s1/replay.ts` / `lib/s1/counters.ts`），由组件在 `useMemo` 里算：
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

import type { IncidentMessage } from "../lib/s1/contract"
import { buildIncidentStream } from "../lib/s1/timeline"

/** 开场之前的游标：当日事件簿还没揭示（`-1` 比任何一条消息的 `revealedAtMs` 都小）。 */
export const CURSOR_OPENING_MS = -1

export type IncidentStoreState = {
  /** 原始事件序列。只增不改：它是只读事实，改派生的东西。 */
  events: readonly IncidentMessage[]
  /** 回放游标（毫秒）。`CURSOR_OPENING_MS` = 开场之前。 */
  cursorMs: number
  /** 载入确定性时间轴（同一次会话里两次调用得到同一条序列）。 */
  loadCanonicalStream: () => void
  /** 追加一条消息（例如第 18 拍「问 S1」按需生成的那条）。 */
  append: (message: IncidentMessage) => void
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
