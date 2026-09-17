"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  buildPlaybackSchedule,
  frameAt,
  frameForBeatRequest,
  frameOfBeat,
  revealTimesBySeq,
  scheduleDurationMs,
  type ScheduleFrame,
} from "@/components/prototype/workbench/view-model"
import { countersFromEvents, type CounterSnapshot } from "@/lib/s1/counters"
import type { IncidentMessage } from "@/lib/s1/contract"
import { replayStream, type IncidentState, type ReplayCursor } from "@/lib/s1/replay"
import {
  loadCanonicalStream,
  selectCursorMs,
  selectEvents,
  useIncidentStore,
} from "@/stores/incident-store"

/**
 * 回放控制 —— **唯一的播放者，也是游标的唯一写者**。
 *
 * ## 位置的完整表达
 *
 * `replayStream(events, cursor)` 的游标是 `{ revealedAtMs, seq }`：剧本里第 6/7 拍、
 * 第 14/15 拍共享同一个揭示时刻，**只有带上序号**才分得开（数据层自己的注释写着：
 * 「第 14 拍之后、第 15 拍之前」这个中间状态，只有时刻时根本不存在）
 * ——而第 14 拍正是「AI 提交 1 项待授权」那一帧，第 15 拍是人批完那一帧。
 *
 * store 里只有 `cursorMs`（一个数），那是上一包定下的原始值，本批**不动它**。所以：
 *
 * ```
 * store.cursorMs   回放时刻（毫秒）—— 每换一帧 seek() 一次，别的消费者可以订阅它
 * seq              同一时刻内的第几条 —— 住在播放器里，因为它是「哪一帧」的概念
 * ```
 *
 * 两者合起来才是那个 `ReplayCursor`，而且写者只有这一个 hook（`single-writer`），
 * 所以它不是第二份真相；外部 seek（将来的审计行 / 证据 chip 跳转）由下面的
 * subscribe 跟随。
 *
 * ## 播放本身不是状态源
 *
 * 播放只做一件事：把 `progressMs` 往前推。界面里所有「动」—— 计划逐条点亮、
 * 划掉重写、命令逐字打出、回显逐行返回 —— 都是 `progressMs` 与 `revealedAtMs`
 * 的纯函数（见 `view-model.ts`）。暂停就冻住，倒拖就把字收回去：
 * **没有一个动效有自己的定时器**。
 */

export type WorkbenchReplay = {
  /** 事件流是否已装载（装载前是 loading，不是空）。 */
  ready: boolean
  /** 派生失败的原因（例如事件流里出现了无法解析的证据引用）。 */
  error: string | null
  events: readonly IncidentMessage[]
  schedule: ScheduleFrame[]
  durationMs: number
  /** 各消息在播放进度上的落地时刻（打字机查表用）。 */
  revealTimes: ReadonlyMap<number, number>
  /** 播放进度（连续毫秒）。 */
  progressMs: number
  /** 当前帧（离散，来自排程）。 */
  frame: ScheduleFrame
  cursor: ReplayCursor
  state: IncidentState
  counters: CounterSnapshot
  playing: boolean
  atEnd: boolean
  play: () => void
  pause: () => void
  toggle: () => void
  /** 拖时间轴（毫秒）。拖动会**暂停** —— 操作者要停在这一帧上看。 */
  seekProgress: (progressMs: number) => void
  /** 跳到第 N 拍（该拍结束后的那一帧）；没有帧的拍按 `frameForBeatRequest` 往前夹。 */
  seekBeat: (step: number) => void
  /** 停在某一帧上（⑧ 审计行点击）。带序号，所以「同一时刻的第二条」也停得住。 */
  seekToCursor: (cursor: ReplayCursor) => void
  /** 界面请求过的拍号（可能是被夹取过的，见 `requestedBeatClamped`）。 */
  requestedBeat: number | null
  /** 请求的那一拍在排程里没有自己的帧（第 18 拍就是）。 */
  requestedBeatClamped: boolean
  /** 回到开场（当日事件簿已在册、解说窗口还没开始）。 */
  restart: () => void
  /** 重新装载确定性事件流 —— 错误态的真实出路。 */
  reload: () => void
}

type InitialPosition = { progressMs: number | null; beat: number | null; autoplay: boolean }

/**
 * 初始位置从 URL 读：`?beat=9` / `?cursor=4600` / `&autoplay=0`。
 *
 * 这不是测试专用后门，是**演示需要**：讲解者要能把某个画面当链接发出去，
 * 也要能停在某一帧上指着讲。默认（无参数）= 从开场开始播。
 */
function initialPosition(): InitialPosition {
  if (typeof window === "undefined") return { progressMs: null, beat: null, autoplay: true }
  const params = new URLSearchParams(window.location.search)
  const beat = params.get("beat")
  const cursor = params.get("cursor")
  const autoplay = params.get("autoplay") !== "0"
  if (beat !== null && Number.isFinite(Number(beat))) {
    return { progressMs: null, beat: Number(beat), autoplay }
  }
  if (cursor !== null && Number.isFinite(Number(cursor))) {
    return { progressMs: Number(cursor), beat: null, autoplay }
  }
  return { progressMs: null, beat: null, autoplay }
}

export function useWorkbenchReplay(): WorkbenchReplay {
  const events = useIncidentStore(selectEvents)
  const cursorMs = useIncidentStore(selectCursorMs)
  const seek = useIncidentStore((state) => state.seek)

  const [progressMs, setProgressMs] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [started, setStarted] = useState(false)
  /**
   * 界面请求过的拍号。
   *
   * 它和「当前帧的拍号」是两件事：第 18 拍没有自己的帧，请求它会落在回放终点，
   * 而终点那一帧的拍号是 17。若只留后者，下拉框会**跳回 17** —— 观众点了 18、
   * 界面显示 17，那是一次看得见的撒谎。所以两个都留着，面板自己说清楚。
   */
  const [requestedBeat, setRequestedBeat] = useState<number | null>(null)

  const schedule = useMemo(() => buildPlaybackSchedule(events), [events])
  const durationMs = useMemo(() => scheduleDurationMs(schedule), [schedule])
  const revealTimes = useMemo(() => revealTimesBySeq(schedule), [schedule])
  const frame = useMemo(() => frameAt(schedule, progressMs), [schedule, progressMs])

  /* --------------------------------------------------------------- 装载事件流 */
  useEffect(() => {
    loadCanonicalStream()
  }, [])

  /* -------------------------------------------------- 初始位置（只应用一次） */
  const position = useRef<InitialPosition | null>(null)
  useEffect(() => {
    if (started || events.length === 0) return
    if (position.current === null) position.current = initialPosition()
    const { progressMs: wanted, beat, autoplay } = position.current
    let next = 0
    if (beat !== null) {
      // 没有帧的拍**往前夹**，不静默归零（`?beat=18` 曾经回到开场）。
      const target = frameForBeatRequest(schedule, beat)
      if (target !== null) {
        next = target.frame.at
        setRequestedBeat(beat)
      }
    } else if (wanted !== null) {
      next = Math.max(0, Math.min(wanted, durationMs))
    }
    setProgressMs(next)
    setPlaying(autoplay && beat === null)
    setStarted(true)
  }, [started, events.length, schedule, durationMs])

  /* ------------------------------------------------------------------- 播放 */
  const progressRef = useRef(progressMs)
  useEffect(() => {
    progressRef.current = progressMs
  }, [progressMs])

  useEffect(() => {
    if (!playing || !started) return
    let raf = 0
    let value = progressRef.current
    let last = Number.NaN
    const tick = (now: number) => {
      const previous = Number.isNaN(last) ? now : last
      last = now
      value += now - previous
      if (value >= durationMs) {
        progressRef.current = durationMs
        setProgressMs(durationMs)
        setPlaying(false)
        return
      }
      progressRef.current = value
      setProgressMs(value)
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [playing, started, durationMs])

  /* --------------------------------------- 把这一帧的**时刻**写回 store
   *
   * 这里只写外部 store（`seek`），**不再 setState**：序号是「同一时刻里的第几条」，
   * 它本来就是当前帧的属性，在渲染期从 `frame.cursor` 读出来即可（见下面的 `cursor`）。
   * 用 effect + setState 去镜像它，会多一次级联渲染，而且镜子里必然有一瞬间是旧的。
   *
   * ⚠ 写回之前先**同步**记下「这次是播放器自己写的」：下面的订阅无法从 store 的
   * 变化里分辨写者是谁，没有这个标记时，播放器每跨一个揭示时刻就会被自己的写回
   * 当成一次「外部 seek」→ `setPlaying(false)` → 演示在第一个时刻（T+0）自己停住。
   * 这不是假想的：这条路径在 2026-09-17 的浏览器实测里就是「一直 T+0.00s · 已暂停」。
   */
  const cursorOfFrame = frame.cursor
  const selfSeekMs = useRef(cursorMs)
  useEffect(() => {
    if (!started) return
    if (cursorMs === cursorOfFrame.revealedAtMs) return
    selfSeekMs.current = cursorOfFrame.revealedAtMs
    seek(cursorOfFrame.revealedAtMs)
  }, [started, cursorOfFrame, cursorMs, seek])

  /* -------------------------------------------------- 跟随外部的 seek（订阅）
   *
   * 只有**不是播放器自己写的**游标变化才算外部 seek（审计行 / 证据 chip 跳转、
   * 或者操作者直接调 store）。外部 seek 会暂停：操作者要停在这一帧上看。
   */
  useEffect(
    () =>
      useIncidentStore.subscribe((next) => {
        if (next.cursorMs === selfSeekMs.current) return
        const target = schedule.find((entry) => entry.cursor.revealedAtMs >= next.cursorMs)
        setPlaying(false)
        setProgressMs(target?.at ?? 0)
      }),
    [schedule],
  )

  /* --------------------------------------------------------------- 派生与错误 */
  // 游标的两个分量都来自当前帧：时刻与序号是同一件事的两半，不许有一个是"上一帧的"。
  const cursor = useMemo<ReplayCursor>(
    () => ({ revealedAtMs: frame.cursor.revealedAtMs, seq: frame.cursor.seq }),
    [frame.cursor.revealedAtMs, frame.cursor.seq],
  )

  const derived = useMemo(() => {
    if (events.length === 0) return { state: null, error: null as string | null }
    try {
      return { state: replayStream(events, cursor), error: null as string | null }
    } catch (error) {
      return {
        state: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }, [events, cursor])

  const counters = useMemo(() => countersFromEvents(events, cursor), [events, cursor])

  const play = useCallback(() => {
    setProgressMs((current) => (current >= durationMs ? 0 : current))
    setPlaying(true)
  }, [durationMs])

  const pause = useCallback(() => setPlaying(false), [])

  const toggle = useCallback(() => {
    if (playing) setPlaying(false)
    else play()
  }, [playing, play])

  const seekProgress = useCallback(
    (next: number) => {
      setPlaying(false)
      setRequestedBeat(null)
      setProgressMs(Math.max(0, Math.min(next, durationMs)))
    },
    [durationMs],
  )

  const seekBeat = useCallback(
    (step: number) => {
      const target = frameForBeatRequest(schedule, step)
      if (target === null) return
      setPlaying(false)
      setRequestedBeat(step)
      setProgressMs(target.frame.at)
    },
    [schedule],
  )

  /**
   * 停在某一帧上（⑧ 审计行的点击）。
   *
   * 与 `seekProgress` 的区别只有一处：**序号也一起带过去**。剧本第 6/7 拍与 14/15 拍
   * 共享同一个揭示时刻，只给毫秒的话「同一条审计行」会落到那一时刻的第一帧上 ——
   * 点的是第 8 拍那条 `16:20:38`，画面却停在第 7 拍的 `16:20:31`。
   */
  const seekToCursor = useCallback(
    (cursor: ReplayCursor) => {
      const target = schedule.find(
        (entry) =>
          entry.cursor.revealedAtMs === cursor.revealedAtMs && entry.cursor.seq >= cursor.seq,
      )
      if (target === undefined) return
      setPlaying(false)
      setRequestedBeat(target.beatStep)
      setProgressMs(target.at)
    },
    [schedule],
  )

  const restart = useCallback(() => {
    setPlaying(false)
    setRequestedBeat(null)
    setProgressMs(0)
  }, [])

  const reload = useCallback(() => {
    loadCanonicalStream()
    setProgressMs(0)
    setPlaying(false)
    setRequestedBeat(null)
    setStarted(false)
  }, [])

  const requestedBeatClamped =
    requestedBeat !== null && frameOfBeat(schedule, requestedBeat) === null

  return {
    ready: events.length > 0,
    error: derived.error,
    events,
    schedule,
    durationMs,
    revealTimes,
    progressMs,
    frame,
    cursor,
    state: derived.state ?? EMPTY_STATE,
    counters,
    playing,
    atEnd: progressMs >= durationMs,
    play,
    pause,
    toggle,
    seekProgress,
    seekBeat,
    seekToCursor,
    requestedBeat,
    requestedBeatClamped,
    restart,
    reload,
  }
}

/**
 * 派生失败时的占位状态。
 *
 * 它**不是**一个「假装正常」的空状态：调用方看到 `error !== null` 就必须渲染错误态，
 * 而不是渲染这个空对象（面板第一件事就是判 `error`）。这里只是为了不让类型到处写 `!`。
 */
const EMPTY_STATE: IncidentState = replayStream([], 0)
