/**
 * STH 回合 3 回放剧本 —— 18 节拍的结构化数据。
 *
 * `storyboard.round3.json` 是从工作区根目录 `STH-回合3回放剧本.json` **逐字复制**进来的
 * （复制后 `diff` 为空，2026-09-17），理由与 `seed.ts` 相同：产品必须独立可构建。
 *
 * 这一层只做两件事：把剧本读成有类型的只读视图；把 `T+0.9s` 这类写法解析成毫秒。
 * **不解释剧本、不改剧本**：`emits` / `evidenceRefs` / `affects` 的合法性由
 * `tests/sth-invariants.spec.ts` 对剧本原文断言（剧本自己的 `contract.rule`）。
 */

import storyboardDocument from "./storyboard.round3.json"
import {
  COMPONENT_ID_SET,
  isMessageKind,
  type ComponentId,
  type EvidenceId,
  type MessageKind,
} from "./contract"

export const STORYBOARD = storyboardDocument

export const STORYBOARD_PROVENANCE = {
  sourceOfTruthFile: "STH-回合3回放剧本.json",
  sourceId: storyboardDocument.id,
  sourceTitle: storyboardDocument.title,
  copiedAt: "2026-09-17",
  copyMode: "逐字复制（cp，复制后 diff 为空）",
  builtFrom: storyboardDocument.builtFrom,
} as const

/** 剧本声明的消息契约（八类消息 + 两条规则）。 */
export const MESSAGE_CONTRACT = storyboardDocument.contract

/** 十二个组件（剧本 `components` 段）。 */
export const STORYBOARD_COMPONENTS = storyboardDocument.components

/* -------------------------------------------------------------------------- */
/* 节拍                                                                        */
/* -------------------------------------------------------------------------- */

export type StoryboardBeat = {
  step: number
  /** 剧本原文的 `at`，例如 `"T+0.9s"`；第 18 拍是 `"任意时刻"`。 */
  at: string
  /**
   * 回放偏移毫秒数；`null` = 没有固定时刻（第 18 拍「任意时刻」）。
   *
   * 剧本自己写明这些偏移「是示意，不是设计值」—— 它们是**回放节奏**，
   * 落到消息上就是 `revealedAtMs`（见 `contract.ts` 的信封注释）。
   */
  offsetMs: number | null
  label: string
  emits: MessageKind
  evidenceRefs: readonly EvidenceId[]
  affects: readonly ComponentId[]
  audienceSees: string
  invariant?: string
  note?: string
  openQuestion?: string
}

const OFFSET_PATTERN = /^T\+(\d+(?:\.\d+)?)s$/

/** `"T+0.9s"` → `900`；`"任意时刻"` → `null`。只认这两种形态，别的写法响亮地失败。 */
export function parseBeatOffset(at: string): number | null {
  if (at === "任意时刻") return null
  const match = OFFSET_PATTERN.exec(at)
  if (match === null) throw new Error(`剧本里认不出的时刻写法：${JSON.stringify(at)}`)
  return Math.round(Number(match[1]) * 1000)
}

export const BEATS: readonly StoryboardBeat[] = storyboardDocument.beats.map((beat) => {
  const emits = beat.emits
  if (!isMessageKind(emits)) throw new Error(`第 ${beat.step} 拍的 emits 不是八类消息之一：${emits}`)
  const affects = beat.affects.filter((id): id is ComponentId => COMPONENT_ID_SET.has(id))
  if (affects.length !== beat.affects.length) {
    throw new Error(`第 ${beat.step} 拍的 affects 里有不是组件的 id：${beat.affects.join(", ")}`)
  }
  return {
    step: beat.step,
    at: beat.at,
    offsetMs: parseBeatOffset(beat.at),
    label: beat.label,
    emits,
    evidenceRefs: [...beat.evidenceRefs],
    affects,
    audienceSees: beat.audienceSees,
    ...("invariant" in beat ? { invariant: beat.invariant } : {}),
    ...("note" in beat ? { note: beat.note } : {}),
    ...("openQuestion" in beat ? { openQuestion: beat.openQuestion } : {}),
  }
})

/** 有固定回放时刻的节拍（第 1–17 拍）。**这 17 拍就是确定性时间轴的全部。** */
export const TIMED_BEATS = BEATS.filter((beat) => beat.offsetMs !== null)

/**
 * 第 18 拍「任意时刻 · 被盘问」。
 *
 * 它**不在**确定性时间轴上：`at` 是「任意时刻」，含义是「观众点预置问题时才发生」。
 * 所以它不产生一条排好序的流消息，而是由 `timeline.ts` 的 `askSthMessage()` 在被问到时
 * 生成一条消息 —— 那条消息同样带因果 ID 与证据引用，所以「不许出现无引用回答」这条
 * 在这一拍上依然成立（不变量 `evidence.every-claim-cites-a-source`）。
 */
export const ON_DEMAND_BEAT = BEATS.find((beat) => beat.offsetMs === null) ?? null

/* -------------------------------------------------------------------------- */
/* 全片级不变量                                                                */
/* -------------------------------------------------------------------------- */

export type FrameInvariant = {
  id: string
  scope: string
  mustHoldAt: string
  howImplemented: string
  howTested: string
  whyItMatters: string
  signedBy: string
  signedAt: string
}

export const FRAME_INVARIANTS: readonly FrameInvariant[] = storyboardDocument.frameInvariants

/**
 * 本层的**登记范围**（写在这里，免得下一个人以为漏了）：
 *
 * · 已进 `product-contract.json` 并已登记的：`evidence.every-claim-cites-a-source`、
 *   `authority.no-unlisted-autonomous-action`、`audit.replay-is-faithful`、
 *   `sediment.survives-export`、`evidence.counters-derive-from-events`、`color.every-hue-has-one-meaning`。
 * · **未进契约**：`boundary.demo-is-labelled-as-demo`。
 *   它的 `howTested` 原文要求「每个路由断言存在可见（非 aria-hidden、非 display:none）的演示标识」——
 *   那需要 DOM，而本包没有界面。**声明了却没有对象，会让 `pnpm factory:contract`
 *   因「声明了没测试」变红**，所以它留给组件阶段；`frameInvariants` 里保留它，是为了
 *   组件阶段能读到它的原文（`mustHoldAt` / `whyTested`），而不是让这里假装它已经被守住。
 */
export const FRAME_INVARIANT_IDS = FRAME_INVARIANTS.map((entry) => entry.id)

/** 未进契约的那一条（组件阶段的对象）。 */
export const DEFERRED_FRAME_INVARIANT_ID = "boundary.demo-is-labelled-as-demo"

export const STORYBOARD_OPEN_ITEMS = storyboardDocument.openItems
