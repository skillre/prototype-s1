import { readFileSync } from "node:fs"
import { join } from "node:path"

import { expect, test, type Page } from "@playwright/test"

import {
  askS1AnswerFor,
  askS1AnswersOf,
  askS1UnresolvableRefs,
  attackChainOf,
  buildPlaybackSchedule,
  pipelineOf,
  reportOf,
  reportUnresolvableRefs,
  revealTimesBySeq,
  revealedMessages,
  rosterOf,
  verifyReportImport,
  type AttackChain,
} from "../components/prototype/workbench/view-model"
import { CONSOLE_GEOMETRY, scaleForViewport } from "../components/prototype/workbench/geometry"
import type { IncidentMessage } from "../lib/s1/contract"
import {
  CURSOR_END,
  CURSOR_OPENING,
  cursorAtBeat,
  knownEvidenceIds,
  replayStream,
  type ReplayCursor,
} from "../lib/s1/replay"
import { HEADER_STATS_SIGNED } from "../lib/s1/seed"
import { ASK_S1_ANSWERS, askS1Message, buildIncidentStream } from "../lib/s1/timeline"
import { zhCN } from "../lib/i18n/zh-CN"
import { stripComments } from "./support/source-scan"

/**
 * S1 工作台 · 组件批次 3 的验收：四个新面板（⑨ ⑩ ⑭ ⑫）+ ⑤ 画布的布局修复
 * + 整屏收口（十二格无占位、骨架值钉到 DOM）。
 *
 * ## 与前一节同一条规矩：每件事都算两遍
 *
 * 一遍在**纯函数**上（没有 DOM、不依赖机器快慢），一遍在**真实 Chromium** 上。
 * 只有前者 = 「代码看起来对」；只有后者 = 「今天这台机器看起来对」。
 *
 * ## 本文件里最重要的两条判据
 *
 * 1. **⑤ 画布的矩形相交判据**（B 节）：不是比坐标，是量 `getBoundingClientRect()`
 *    逐对判交 —— 上一批修掉了「两个节点落在同一个坐标上」，但坐标不同**不等于**矩形不相交
 *    （画布 444×444、节点宽 202 / 高 98–216，手写格子的间距比节点自己还小）。
 * 2. **骨架值钉到 DOM**（C2 节）：`geometry.ts` 的那句「由测试逐值比对规格」此前只对了一半 ——
 *    比对的是常量 ↔ 种子，**没有任何断言检查浏览器真的按这些值排版**。
 *    「常量等于规格」与「页面等于常量」是两件事。
 */

const ROOT = process.cwd()
const WORKBENCH = "/workbench"

const STREAM: readonly IncidentMessage[] = buildIncidentStream()
const SCHEDULE = buildPlaybackSchedule(STREAM)
const cursorOf = (beat: number) => cursorAtBeat(STREAM, beat)
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8")

/** 设计画布 = 断言骨架用的视口：1680×1050 下 scale 恰好是 1，rect 就是布局值。 */
const CANVAS: { width: number; height: number } = {
  width: CONSOLE_GEOMETRY.canvasWidth,
  height: CONSOLE_GEOMETRY.canvasHeight,
}
/** QA 矩阵里的那条视口（desktop 1440×900）—— 窄视口下的等比缩小在这里量。 */
const NARROW: { width: number; height: number } = { width: 1440, height: 900 }

/**
 * 等 scale 落到该落的值上（同前两批的理由：scale 是挂载后才量视口的）。
 *
 * ## 为什么还要等样式与回放装载（2026-09-17 实测的一次假红）
 *
 * 第一版只等了 `data-scale` —— 那个属性是 React 挂上来的，**与 CSS 无关**。
 * 于是探针可能在样式表还没落地时就开始量：实测 `getBoundingClientRect()` 给出的顶栏高是
 * **57.5**（浏览器默认态下 ① 的自然高度），而画布上的节点是 **0 个**（回放还没装载，
 * 每个面板都停在 loading）。两处都会被读成"产品缺陷"，其实是**探针量早了**。
 *
 * 所以这里加两件独立的事：
 *   · `transform` 不是 `none` —— 画布的 `transform: scale(var(--s1-scale))` 是
 *     **本路由的样式表**给的，它出现了才说明样式真的到了浏览器（同 `qa` 的 style-presence 关切）；
 *   · 没有面板停在 `data-panel-status="loading"` —— 回放装载完之前量到的都是空壳。
 */
async function settled(page: Page, viewport: { width: number; height: number } = CANVAS) {
  await expect
    .poll(async () => Number(await page.locator(".s1-canvas").getAttribute("data-scale")), {
      message: "scale-to-fit 必须落到签过字的那个值上",
    })
    .toBeCloseTo(scaleForViewport(viewport.width, viewport.height), 3)
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const canvas = document.querySelector(".s1-canvas")
          return canvas === null ? "none" : getComputedStyle(canvas).transform
        }),
      { message: "样式表必须真的到了浏览器（transform 不是 none）" },
    )
    .not.toBe("none")
  await expect
    .poll(async () => page.locator('[data-panel][data-panel-status="loading"]').count(), {
      message: "回放装载完之前量到的都是空壳",
    })
    .toBe(0)
}

/** 停在某一拍上打开工作台。 */
async function openAt(
  page: Page,
  beat: number,
  options: { theme?: "dark" | "light"; viewport?: { width: number; height: number } } = {},
) {
  const viewport = options.viewport ?? CANVAS
  await page.setViewportSize(viewport)
  await page.emulateMedia({ colorScheme: options.theme ?? "dark" })
  await page.goto(`${WORKBENCH}?beat=${beat}&autoplay=0`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("workbench")).toBeVisible()
  await settled(page, viewport)
}

type Rect = { id: string; left: number; top: number; right: number; bottom: number; width: number; height: number }

/** 画布上每个节点的**屏幕矩形**（含 scale-to-fit 的缩放）。 */
async function nodeRects(page: Page): Promise<Rect[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid="graph-node"]')).map((node) => {
      const box = node.getBoundingClientRect()
      return {
        id: node.getAttribute("data-node-id") ?? "?",
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      }
    }),
  )
}

/**
 * 矩形两两判交。**允许半像素的容差**：`getBoundingClientRect()` 在缩放过的画布上会给出
 * 小数，两个相邻网格单元之间只隔一条 `gap`，容差是为了不让 0.4px 的四舍五入被读成"压上了"。
 * 真被压住的节点重叠量是几十像素，不会被这个容差放过。
 */
function overlappingPairs(rects: readonly Rect[]): string[] {
  const found: string[] = []
  for (let a = 0; a < rects.length; a += 1) {
    for (let b = a + 1; b < rects.length; b += 1) {
      const first = rects[a] as Rect
      const second = rects[b] as Rect
      const overlapX = Math.min(first.right, second.right) - Math.max(first.left, second.left)
      const overlapY = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top)
      if (overlapX > 0.5 && overlapY > 0.5) {
        found.push(`${first.id} × ${second.id}（重叠 ${overlapX.toFixed(1)}×${overlapY.toFixed(1)}）`)
      }
    }
  }
  return found
}

/* ========================================================================== */
/* B · ⑤ 攻击链画布：内容尺寸与格子间距匹配（矩形级判据）                          */
/* ========================================================================== */

test.describe("B · ⑤ 画布：任意两个节点的矩形不相交", () => {
  test("正例：浏览器里逐对量矩形，没有一对相交（不是只比坐标）", async ({ page }) => {
    await openAt(page, 17)
    const rects = await nodeRects(page)
    // 「0 个节点也算通过」是最坏的一种绿：先钉住真的有节点被量到。
    expect(rects.length, "画布上必须有节点，否则这条断言在空集上成立").toBeGreaterThan(1)
    for (const rect of rects) {
      expect(Number.isFinite(rect.width) && rect.width > 0, `${rect.id} 的矩形不是实体`).toBe(true)
      expect(Number.isFinite(rect.height) && rect.height > 0, `${rect.id} 的矩形不是实体`).toBe(true)
    }

    const pairs = overlappingPairs(rects)
    expect(
      pairs,
      `有节点在屏幕上互相压：${pairs.join(" · ")}（实测矩形：${JSON.stringify(rects)}）`,
    ).toEqual([])
  })

  test("正例：同排的节点共用一个排号、列区间不相交；不同排的节点竖直方向错开", async ({ page }) => {
    await openAt(page, 17)
    const slots = await page
      .locator('[data-testid="graph-node"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          id: node.getAttribute("data-node-id") ?? "?",
          rank: Number(node.getAttribute("data-rank")),
          start: Number(node.getAttribute("data-column-start")),
          span: Number(node.getAttribute("data-column-span")),
        })),
      )
    expect(slots.length).toBeGreaterThan(1)
    expect(new Set(slots.map((slot) => slot.rank)).size, "布局必须真的分过层").toBeGreaterThan(1)
    for (const slot of slots) {
      expect(Number.isInteger(slot.rank) && slot.rank >= 0, `${slot.id} 的排号不是整数`).toBe(true)
      expect(slot.start, `${slot.id} 的列起点必须 ≥ 1`).toBeGreaterThanOrEqual(1)
      expect(slot.span, `${slot.id} 的列跨度必须 ≥ 1`).toBeGreaterThanOrEqual(1)
    }
  })

  /**
   * 负对照：**判据必须能红**。
   *
   * 把每个节点强行钉进同一个网格单元（`grid-area: 1/1/2/2`）—— 那正是"格子数不够"
   * 在旧实现里的样子（六个节点四个格子，靠居中位移挤在一起）。同一条判据这时必须报出重叠对。
   */
  test("负对照：把节点钉进同一个网格单元，同一条判据必须红", async ({ page }) => {
    await openAt(page, 17)
    expect(overlappingPairs(await nodeRects(page))).toEqual([])

    await page.addStyleTag({
      content: '[data-testid="graph-node"]{grid-area:1/1/2/2 !important}',
    })
    await page.waitForTimeout(80)

    const after = overlappingPairs(await nodeRects(page))
    expect(after.length, "六个节点全被钉进一格却量不到重叠 —— 这条判据是死的").toBeGreaterThan(0)
  })

  test("画布是内容自适应的：行数 = 布局给的排数，且画布高度随内容撑开（不裁切）", async ({ page }) => {
    await openAt(page, 17)
    const measured = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLElement>('[data-testid="attack-graph-canvas"]')
      if (canvas === null) throw new Error("找不到画布")
      const nodes = Array.from(canvas.querySelectorAll<HTMLElement>('[data-testid="graph-node"]'))
      const box = canvas.getBoundingClientRect()
      const lowest = Math.max(
        ...nodes.map((node) => node.getBoundingClientRect().bottom),
      )
      return {
        ranks: Number(canvas.getAttribute("data-rank-count")),
        columns: Number(canvas.getAttribute("data-column-count")),
        height: box.height,
        lowest,
        bottom: box.bottom,
        overflow: getComputedStyle(canvas).overflow,
      }
    })
    expect(measured.ranks).toBeGreaterThan(1)
    expect(measured.columns).toBeGreaterThan(1)
    // 每个节点的下沿都在画布边界之内 —— 「内容尺寸与格子间距匹配」的可量形式。
    expect(measured.lowest, "有节点伸出了画布下边界（等于被裁切）").toBeLessThanOrEqual(measured.bottom + 0.5)
    expect(measured.overflow, "画布不该再靠 overflow:hidden 收住内容").not.toBe("hidden")
  })
})

/* ========================================================================== */
/* 1 · ⑨ 问 S1：回答必须有出处，答不出必须明说                                    */
/* ========================================================================== */

test.describe("evidence.every-claim-cites-a-source · ⑨ 问 S1", () => {
  test("正例：数据层的每条回答都引用了登记簿里真实存在的证据", () => {
    const known = knownEvidenceIds()
    expect(known.size, "证据登记簿必须真的被读到").toBeGreaterThan(0)
    expect(ASK_S1_ANSWERS.length).toBeGreaterThan(0)
    for (const answer of ASK_S1_ANSWERS) {
      expect(answer.evidenceRefs.length, `「${answer.question}」的回答没有引用任何证据`).toBeGreaterThan(0)
      for (const ref of answer.evidenceRefs) {
        expect(known.has(ref), `${ref} 不在登记簿里`).toBe(true)
      }
    }
  })

  test("正例：提问→回答的匹配是整句相等，且答不出的问题返回 null（不猜）", () => {
    const first = ASK_S1_ANSWERS[0]
    expect(first).toBeDefined()
    const matched = askS1AnswerFor(first!.question)
    expect(matched?.answer.conclusion).toBe(first!.conclusion)
    // 模糊匹配会把别人的答案当成你的答案 —— 这条判据钉住"不许那样做"。
    expect(askS1AnswerFor(`${first!.question} `)).not.toBeNull()
    expect(askS1AnswerFor("这台机器昨天重启过几次？")).toBeNull()
    expect(askS1AnswerFor("")).toBeNull()
  })

  test("正例：回答的引用可定位；负对照：挂一条不存在的引用必须被抓住", () => {
    // 第 18 拍那条由测试自己按数据层的工厂生成（界面上由观众点击触发）——不用手搓一条消息，
    // 那样测的就是测试自己的形状，不是产品的形状。
    const answers = askS1AnswersOf([...revealedMessages(STREAM, CURSOR_END), askS1Message(STREAM, 0)])
    expect(answers.length).toBeGreaterThan(0)
    expect(askS1UnresolvableRefs(answers), "真实回答的引用必须全部可定位").toEqual([])
    expect(answers[0]?.question, "回答要能连回它回答的那个问题").toBe(ASK_S1_ANSWERS[0]?.question)

    const first = answers[0]!
    const corrupted = [{ ...first, evidenceRefs: [...first.evidenceRefs, "#e-not-real"] }]
    expect(askS1UnresolvableRefs(corrupted)).toEqual(["#e-not-real"])
  })

  test("浏览器：点一个快捷问 → 回答出现、带可点开的证据 chip、且不出现拒绝态", async ({ page }) => {
    await openAt(page, 17)
    const known = [...knownEvidenceIds()]
    await expect(page.getByTestId("ask-empty")).toBeVisible()
    expect(await page.locator('[data-testid="ask-answers"] li').count()).toBe(0)

    await page.locator('[data-testid="ask-preset"]').first().click()

    const answer = page.locator('[data-testid="ask-answers"] li').first()
    await expect(answer).toBeVisible()
    await expect(page.getByTestId("ask-conclusion")).toContainText("最大风险")
    await expect(page.getByTestId("ask-refusal")).toHaveCount(0)

    // 每个引用 chip 都指向登记簿里真实存在的证据。
    const refs = await page
      .locator('[data-testid="ask-evidence-chip"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-evidence-ref") ?? ""))
    expect(refs.length, "回答必须带证据 chip").toBeGreaterThan(0)
    for (const ref of refs) expect(known, `${ref} 不在登记簿里`).toContain(ref)

    // 出处可核对：回答带着它来自哪条消息。
    await expect(page.getByTestId("ask-origin")).not.toBeEmpty()

    // chip 点开显示那条证据自己的字段（真交互，不是装饰）。
    await page.locator('[data-testid="ask-evidence-chip"]').first().click()
    await expect(page.getByTestId("ask-evidence-detail")).toBeVisible()
  })

  test("浏览器：问一个答不出证据的问题 → 界面明说答不出，且不生成任何回答", async ({ page }) => {
    await openAt(page, 17)
    await page.getByTestId("ask-input").fill("这台机器昨天重启过几次？")
    await page.getByTestId("ask-send").click()

    const refusal = page.getByTestId("ask-refusal")
    await expect(refusal).toBeVisible()
    await expect(refusal).toHaveAttribute("data-refusal", "unmatched")
    // 它必须说清楚**边界**（几个问题答得出来）与**机制**（不编结论），而不是只说一句"不知道"。
    await expect(refusal).toContainText(String(ASK_S1_ANSWERS.length))
    await expect(refusal).toContainText("编")
    // 拒绝不能悄悄造一条回答出来。
    await expect(page.locator('[data-testid="ask-answers"] li')).toHaveCount(0)
    // 负对照的反面：答得出来的那条路依然在（点一下就能走通）。
    await page.locator('[data-testid="ask-answerable"]').first().click()
    await expect(page.locator('[data-testid="ask-answers"] li').first()).toBeVisible()
    await expect(page.getByTestId("ask-refusal")).toHaveCount(0)
  })

  test("浏览器：空输入也是一种拒绝，且与「不在有出处的回答里」分开说", async ({ page }) => {
    await openAt(page, 17)
    await page.getByTestId("ask-input").fill("")
    await page.getByTestId("ask-send").click()
    await expect(page.getByTestId("ask-refusal")).toHaveAttribute("data-refusal", "empty")
  })
})

/* ========================================================================== */
/* 2 · ⑩ E+⑩ 汇流管道：图上每个数字都是数出来的                                  */
/* ========================================================================== */

test.describe("evidence.counters-derive-from-events · ⑩ 汇流管道", () => {
  test("正例：同一游标两次派生逐字段相同（纯函数没有隐藏状态）", () => {
    for (const beat of [1, 2, 6, 14, 17]) {
      const revealed = revealedMessages(STREAM, cursorOf(beat))
      expect(pipelineOf(revealed)).toEqual(pipelineOf(revealed))
    }
  })

  test("正例：每个数字都等于**从事件流另算一遍**的结果", () => {
    const revealed = revealedMessages(STREAM, cursorOf(17))
    const view = pipelineOf(revealed)

    // 对照物是「另写一遍数法」，不是「再调用一次同一个函数」——后者是同一份实现自己对自己。
    const scope = revealed.filter((message) => message.beatStep !== null)
    for (const lane of view.lanes) {
      const refs = new Set<string>()
      for (const message of scope) {
        for (const ref of message.evidenceRefs) {
          if (ref.startsWith(`#${lane.source === "probe" ? "p" : "e"}`) === false) continue
          refs.add(ref)
        }
      }
      expect(lane.evidenceCount).toBe(lane.evidenceRefs.length)
      expect(lane.messageCount).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(lane.evidenceCount)).toBe(true)
    }

    const merged = scope.filter((message) => {
      const claim = "claim" in message ? message.claim : null
      return claim !== null && claim !== undefined && claim.sources.length >= 2
    }).length
    expect(view.consumed.merged).toBe(merged)
    expect(view.consumed.total).toBe(view.consumed.merged + view.consumed.singleSource)
    expect(view.packageView, "第 17 拍上上下文包必须已经在册").not.toBeNull()
    expect(view.packageView?.mergeElapsedMs, "汇流耗时是种子真值 930ms").toBe(930)
  })

  test("浏览器：DOM 上的数字 = 派生值，而且两个游标下不同（常量满足不了第二条）", async ({ page }) => {
    const readLane = async (source: string) =>
      page
        .locator(`[data-testid="pipeline-lanes"] [data-lane="${source}"]`)
        .evaluate((node) => ({
          evidence: Number(node.getAttribute("data-evidence-count")),
          messages: Number(node.getAttribute("data-message-count")),
        }))

    await openAt(page, 1)
    const early = { probe: await readLane("probe"), edr: await readLane("edr") }

    await openAt(page, 17)
    const late = { probe: await readLane("probe"), edr: await readLane("edr") }
    const expected = pipelineOf(revealedMessages(STREAM, cursorOf(17)))

    for (const lane of expected.lanes) {
      expect(late[lane.source as "probe" | "edr"].evidence).toBe(lane.evidenceCount)
      expect(late[lane.source as "probe" | "edr"].messages).toBe(lane.messageCount)
    }
    expect(
      late.probe.evidence !== early.probe.evidence || late.edr.evidence !== early.edr.evidence,
      "两个游标下管道的数字完全一样 —— 那更像一个字面量而不是派生值",
    ).toBe(true)
  })

  test("管道上没有写死的数字：组件源码里不含 930 / 19 这类取值", () => {
    const source = stripComments(read("components/prototype/workbench/pipeline-panel.tsx"))
    expect(source.length).toBeGreaterThan(2_000)
    // 种子的汇流耗时与置信度是**记录**，只能从事件流读；写在组件里就是对不上账的字面量。
    expect(source).not.toMatch(/\b930\b/)
    expect(source).not.toMatch(/\b0\.93\b/)
  })
})

/* ========================================================================== */
/* 3 · ⑭ 报告流式生成：导出后逐条等价，且整篇一眼可辨是演示环境                     */
/* ========================================================================== */

test.describe("sediment.survives-export + boundary.demo-is-labelled-as-demo · ⑭ 报告流", () => {
  test("正例：报告进度由游标派生（0 → 生成中 → 100），种子静帧的 68 只作为记录保留", () => {
    const revealTimes = revealTimesBySeq(SCHEDULE)
    const reportMessage = revealedMessages(STREAM, CURSOR_END).find(
      (message) => message.kind === "sediment",
    )
    expect(reportMessage, "第 16 拍必须有一条 sediment 消息带着报告正文").toBeDefined()
    const at = revealTimes.get(reportMessage!.seq)
    expect(Number.isFinite(at), "报告那一拍必须有它的落地时刻").toBe(true)

    const revealedAtBeat16 = revealedMessages(STREAM, cursorOf(16))
    // 落地**前一毫秒**：一个字都还没有。
    const before = reportOf(revealedAtBeat16, cursorOf(16), (at as number) - 1, revealTimes)
    expect(before.available).toBe(true)
    expect(before.totalLines).toBe(3)
    expect(before.progressPercent, "还没落地就不该有进度").toBe(0)
    expect(before.generatedLines).toEqual([])

    // 落地那一刻：第一行已经在（与 ④ 的逐行回显同一条节奏：第 n 行在第 n × 180ms 之后出现）。
    const atLanding = reportOf(revealedAtBeat16, cursorOf(16), at as number, revealTimes)
    expect(atLanding.generatedLines).toHaveLength(1)
    expect(atLanding.progressPercent).toBeGreaterThan(0)
    expect(atLanding.progressPercent).toBeLessThan(100)
    expect(atLanding.designProgressPercent, "种子静帧的 68 必须原样留着").toBe(68)

    // 单调不减：游标往前走，进度只能变大（它是"生成到哪儿了"，不是动画）。
    let previous = atLanding.progressPercent
    for (const delay of [200, 400, 700, 1_000]) {
      const view = reportOf(revealedAtBeat16, cursorOf(16), (at as number) + delay, revealTimes)
      expect(view.progressPercent, `+${delay}ms 之后进度反而变小了`).toBeGreaterThanOrEqual(previous)
      previous = view.progressPercent
    }
    expect(previous, "多等一会儿之后报告必须生成完").toBe(100)

    const done = reportOf(revealedMessages(STREAM, CURSOR_END), CURSOR_END, 999_999, revealTimes)
    expect(done.generatedLines).toHaveLength(3)
    expect(done.progressPercent).toBe(100)
    // 终点游标是无穷大（一个语义哨兵），导出物里必须是有限数 —— 否则稳定序列化会响亮地拒绝它。
    expect(Number.isFinite(done.document.cursorMs)).toBe(true)
  })

  test("正例：导出 → 重新解析 → 逐行等价；负对照：改掉一行必须红", () => {
    const report = reportOf(revealedMessages(STREAM, CURSOR_END), CURSOR_END, 999_999, new Map())
    const verdict = verifyReportImport(report.text, report.document)
    expect(verdict.parseIssues).toEqual([])
    expect(verdict.diffs).toEqual([])

    const parsed = JSON.parse(report.text) as { lines: string[] }
    expect(parsed.lines).toEqual([...report.document.lines])
    expect(reportUnresolvableRefs(parsed.lines), "报告里的证据引用必须能在登记簿里定位").toEqual([])

    // 负对照 1：改掉一行 → 差异必须指出是第几行。
    const mutated = JSON.parse(report.text) as { lines: string[] }
    mutated.lines[1] = `${mutated.lines[1]}（改过）`
    const diff = verifyReportImport(JSON.stringify(mutated), report.document)
    expect(diff.diffs.join(" ")).toContain("第 2 行")

    // 负对照 2：把演示标识摘掉 → 也必须红（导出物自己得说得清自己是什么）。
    const noDemo = JSON.parse(report.text) as { demo: { isDemo: boolean } }
    noDemo.demo.isDemo = false
    expect(verifyReportImport(JSON.stringify(noDemo), report.document).diffs.join(" ")).toContain("演示环境")

    // 负对照 3：不是一份导出物 → 解析失败，而不是"尽量恢复"。
    expect(verifyReportImport("not json at all", report.document).parseIssues.length).toBeGreaterThan(0)
  })

  test("浏览器：正文第一行就是演示标识；导出→核对判定为等价；改一行则判红", async ({ page }) => {
    await openAt(page, 17)
    const banner = page.getByTestId("report-demo-banner")
    await expect(banner).toBeVisible()
    await expect(banner).toContainText("演示环境")

    // 「一眼可辨」的可量形式：标识是报告正文里的**第一个**元素，不是落款。
    const isFirst = await page.evaluate(() => {
      const doc = document.querySelector('[data-testid="report-document"]')
      const first = doc?.firstElementChild
      return first?.getAttribute("data-testid") === "report-demo-banner"
    })
    expect(isFirst, "演示标识必须是报告正文的第一行（等读者看到落款才知道 = 没提前说）").toBe(true)

    // 报告是**逐行**生成的：回放终点上它仍在生成（设计稿静帧就是「流式生成中 68%」），
    // 所以这里钉的是机制而不是"三行都在"：至少一行已经出来、进度在 0 与 100 之间。
    const lineCount = await page.locator('[data-testid="report-lines"] li').count()
    expect(lineCount, "回放终点上报告必须已经开始了").toBeGreaterThan(0)
    const percent = Number(await page.getByTestId("report-progress").getAttribute("data-percent"))
    expect(Number.isFinite(percent), "进度不是有限数（没量到 ≠ 满足条件）").toBe(true)
    expect(percent).toBeGreaterThan(0)
    expect(percent).toBeLessThan(100)
    // 它必须**说得出来**这是"生成到哪儿了"，而不是一个永远不动的数。
    await expect(page.getByTestId("report-generated-count")).toContainText(`/ 3 行`)
    // 种子的 68 留在 DOM 上（可断言），但不冒充活读数。
    await expect(page.getByTestId("report-progress")).toHaveAttribute("data-design-progress", "68")

    // 导出物可解析、带演示标识、逐行等价。
    const exported = await page.getByTestId("report-export-text").textContent()
    expect(exported).toBeTruthy()
    const parsed = JSON.parse(exported as string) as { demo: { isDemo: boolean }; lines: string[] }
    expect(parsed.demo.isDemo).toBe(true)
    expect(parsed.lines).toHaveLength(lineCount)

    await page.getByTestId("report-fill-import").click()
    await page.getByTestId("report-import-verify").click()
    await expect(page.getByTestId("report-import-result")).toHaveAttribute("data-import-result", "equivalent")

    // 负对照：改掉一行再核对 —— 必须指出是第几行。
    await page.getByTestId("report-import-input").fill(exported!.replace("：", "：（改过）"))
    await page.getByTestId("report-import-verify").click()
    await expect(page.getByTestId("report-import-result")).toHaveAttribute("data-import-result", "mismatch")
    await expect(page.getByTestId("report-import-diffs")).toContainText("行")
  })
})

/* ========================================================================== */
/* 4 · ⑫ 数字员工花名册：「4 个在岗」是算出来的                                    */
/* ========================================================================== */

test.describe("authority.no-unlisted-autonomous-action · ⑫ 花名册", () => {
  test("正例：在岗人数由本回合的动作算出，收尾那一帧逐字等于种子静帧", () => {
    const opening = rosterOf(replayStream(STREAM, CURSOR_OPENING), revealedMessages(STREAM, CURSOR_OPENING))
    expect(opening.onDutyCount, "开场时还没有人出动").toBe(0)
    expect(opening.total, "编制来自数据层的四个数字员工").toBe(4)

    const final = rosterOf(replayStream(STREAM, CURSOR_END), revealedMessages(STREAM, CURSOR_END))
    expect(final.onDutyCount, "回放结束时四个员工都必须出动过").toBe(4)
    // 顶栏那句话由模板 + 派生值拼出来，且**逐字**等于种子静帧的那一句。
    expect(zhCN.workbench.roster.onDuty(final.onDutyCount)).toBe(HEADER_STATS_SIGNED.rosterLabel)
    // 它是长出来的，不是一开始就是 4。
    expect(opening.onDutyCount).not.toBe(final.onDutyCount)
  })

  test("正例：白名单外的动作只停在人这道门上（每个席位逐条核对）", () => {
    let checked = 0
    let outsideSeen = 0
    for (const frame of SCHEDULE) {
      const state = replayStream(STREAM, frame.cursor)
      const view = rosterOf(state, revealedMessages(STREAM, frame.cursor))
      for (const seat of view.seats) {
        if (seat.last === null) {
          expect(seat.inWhitelist, `${seat.role} 没有动作却有白名单判决`).toBeNull()
          continue
        }
        checked += 1
        // 判决来自数据层（isAutonomous），不是界面自己的一张表。
        expect(typeof seat.inWhitelist).toBe("boolean")
        if (seat.inWhitelist === false) {
          outsideSeen += 1
          // 清单外的动作**必须**有一个人这道门上的落点：要么卡正停在他这里，
          // 要么已经被裁决过（裁决记录在卡片状态里）。两者都不在 = 它悄悄执行了。
          const decided = state.disposition.approvals.some((record) => record.cardId === seat.awaiting?.cardId)
          expect(
            seat.awaiting !== null || decided || seat.last.auto === false,
            `${seat.role} 的动作 ${seat.last.actionCode} 不在自主清单内，却既没有待批卡也没有裁决记录`,
          ).toBe(true)
        } else {
          // 清单内的动作才允许走自主通道。
          expect(seat.last.auto, `${seat.role} 的动作 ${seat.last.actionCode} 在清单内却不是自主通道`).toBe(true)
        }
      }
    }
    expect(checked, "整条回放里必须有席位动作被扫到").toBeGreaterThan(0)
    expect(outsideSeen, "整条回放里必须出现过清单外的动作（否则这条判据没有对象）").toBeGreaterThan(0)
  })

  test("浏览器：展开面真的是开关 —— 收起时不可见、展开后给出派生的在岗人数与逐席位判决", async ({ page }) => {
    await openAt(page, 17)
    const toggle = page.getByTestId("roster-toggle")
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expect(page.locator('[data-panel="roster"]')).toBeHidden()

    await toggle.click()
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    const panel = page.locator('[data-panel="roster"]')
    await expect(panel).toBeVisible()

    const expected = rosterOf(replayStream(STREAM, cursorOf(17)), revealedMessages(STREAM, cursorOf(17)), zhCN.workbench.toolConsole.actions)
    await expect(page.getByTestId("roster-on-duty")).toHaveAttribute(
      "data-on-duty",
      String(expected.onDutyCount),
    )
    await expect(page.getByTestId("roster-seats").locator("> li")).toHaveCount(expected.total)

    // 顶栏那句「N 个在岗」与展开面里的 N 是同一个数（同一屏里只出现一次同一个数字）。
    await expect(page.getByTestId("roster-label")).toHaveText(
      zhCN.workbench.roster.onDuty(expected.onDutyCount),
    )

    // 每个席位的白名单判决都落在 DOM 上，且与派生值一致。
    const seats = await page
      .locator('[data-testid="roster-seats"] > li')
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          seat: node.getAttribute("data-seat") ?? "",
          whitelist: node.getAttribute("data-whitelist") ?? "",
          awaiting: node.getAttribute("data-awaiting") ?? "",
        })),
      )
    expect(seats).toHaveLength(expected.total)
    for (const seat of seats) {
      const derived = expected.seats.find((entry) => entry.role === seat.seat)
      expect(derived, `${seat.seat} 不在派生视图里`).toBeDefined()
      expect(seat.whitelist).toBe(derived!.inWhitelist === null ? "none" : String(derived!.inWhitelist))
      expect(seat.awaiting).toBe(String(derived!.awaiting !== null))
    }

    // 收起之后它真的不可见（`hidden` 不是摆设）。
    await toggle.click()
    await expect(page.locator('[data-panel="roster"]')).toBeHidden()
  })

  test("浏览器：第 14 拍上，清单外的动作确实停在「待人工授权」上", async ({ page }) => {
    await openAt(page, 14)
    await page.getByTestId("roster-toggle").click()
    const expected = rosterOf(replayStream(STREAM, cursorOf(14)), revealedMessages(STREAM, cursorOf(14)))
    const awaitingSeats = expected.seats.filter((seat) => seat.awaiting !== null)
    expect(awaitingSeats.length, "第 14 拍必须有人停在待批卡上").toBeGreaterThan(0)

    const dom = await page
      .locator('[data-testid="roster-seats"] > li[data-awaiting="true"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-seat") ?? ""))
    expect(dom.sort()).toEqual(awaitingSeats.map((seat) => seat.role).sort())
    await expect(page.locator('[data-testid="roster-awaiting"][data-meaning="waiting"]').first()).toBeVisible()
  })
})

/* ========================================================================== */
/* 5 · ⑥ 人的裁决不是假按钮（2026-09-17 实测缺陷 + 修法）                          */
/* ========================================================================== */

/**
 * 「已揭示」是**序列的一个前缀**，不是一个过滤条件 —— 这条性质有一个很容易踩的坑：
 *
 * 一条**追加在末尾**的消息，只有当它前面的每一条都已揭示时才够得着
 * （`revealedMessages` / `replayStream` 遇到第一条没揭示的就 `break`）。
 * 所以回放停在半途时，把「人此刻的裁决」追加到末尾、无论把时刻写成多少，
 * 它都落在游标之外 —— 按钮看起来按得下去，画面一动不动。
 *
 * 实测（`?beat=14` 点 ⑥ 的「批准」）：序列 412 → 413 条、排程 +40ms，
 * 但卡片仍 `pending`、顶栏仍读「待人工授权 1 项」。这条断言把那个机制钉住，
 * 免得以后有人"顺手改回追加"。
 */
test.describe("⑥ 人的裁决：插在当前游标之后，而不是追加到末尾", () => {
  const anchor = STREAM.find((message) => message.kind === "action_card" && message.cardId === "a2")
  const last = STREAM[STREAM.length - 1]

  const approvalAt = (revealedAtMs: number, seq: number) =>
    ({
      id: `${anchor?.id ?? "a2"}-approval-approved`,
      seq,
      kind: "approval",
      incidentId: anchor?.incidentId ?? "x",
      beatStep: null,
      occurredAtMs: anchor?.occurredAtMs ?? 0,
      occurredAt: anchor?.occurredAt ?? "00:00:00",
      revealedAtMs,
      causeId: anchor?.id ?? null,
      causalId: `${anchor?.id ?? "a2"}/approval`,
      evidenceRefs: [],
      affects: ["authority"],
      actor: "人工",
      cardId: "a2",
      decision: "approved",
    }) as IncidentMessage

  /** 把一条消息插到 `seq` 那条之后（与 `stores/incident-store.ts` 的 `insertAfter` 同义）。 */
  const insertAfter = (
    stream: readonly IncidentMessage[],
    seq: number,
    message: IncidentMessage,
  ): IncidentMessage[] => {
    const index = stream.findIndex((entry) => entry.seq === seq)
    const at = index < 0 ? stream.length : index + 1
    return [...stream.slice(0, at), message, ...stream.slice(at)]
  }

  test("负对照：追加到末尾的消息在回放半途**永远揭示不到**（旧实现就是这么坏的）", () => {
    const cursor = cursorOf(14)
    expect(cursor.revealedAtMs).toBe(9000)
    // 时刻取遍「此刻 − 1ms / 此刻 / −1」都不行：断点在它前面的那些拍上。
    for (const revealedAtMs of [cursor.revealedAtMs - 1, cursor.revealedAtMs, -1]) {
      const appended = [...STREAM, approvalAt(revealedAtMs, (last?.seq ?? 0) + 1)]
      const state = replayStream(appended, cursor)
      expect(
        state.disposition.cards.find((card) => card.cardId === "a2")?.state,
        `追加在末尾（revealedAtMs=${revealedAtMs}）竟然生效了 —— 这条负对照的前提变了`,
      ).toBe("pending")
      expect(revealedMessages(appended, cursor).length).toBeLessThan(appended.length)
    }
  })

  test("正例：插在当前游标那条之后 + 半格序号 → 卡片当场翻转，同刻的剧本消息仍在后面", () => {
    const cursor = cursorOf(14)
    /**
     * 剧本第 14 与第 15 拍共享同一个揭示时刻：这一瞬里排着 4 条消息，
     * 而游标停在其中的第 1 条（`seq = 406`）。**半格序号**是让人的裁决夹在
     * 「这一条之后、下一条之前」的唯一办法 —— 整数序号会把同一时刻后面的那几条
     * 一起放进来（其中就有剧本第 15 拍的代批），而它们折叠在人之后 ⇒ 点「驳回」也会变 approved。
     */
    const seq = cursor.seq + 0.5
    const next = insertAfter(STREAM, cursor.seq, approvalAt(cursor.revealedAtMs, seq))
    const after: ReplayCursor = { revealedAtMs: cursor.revealedAtMs, seq }

    const revealed = revealedMessages(next, after)
    const state = replayStream(next, after)
    expect(state.disposition.cards.find((card) => card.cardId === "a2")?.state).toBe("approved")
    expect(state.disposition.approvals.some((record) => record.cardId === "a2")).toBe(true)

    // 「已经发生的一切 + 刚刚发生的这一件」：人的裁决是**最后**一条被折叠的。
    expect(revealed.at(-1)?.kind).toBe("approval")
    // 同刻后面的剧本消息**没有**被带进来（否则人的决定会被剧本覆盖）。
    expect(revealed.length, "同刻后面的消息被一起放进来了").toBe(
      next.findIndex((message) => message.seq === seq) + 1,
    )
    // 后面的拍也还在后面。
    expect(revealed.every((message) => message.revealedAtMs <= cursor.revealedAtMs)).toBe(true)
    expect(revealed.length).toBeLessThan(next.length)
  })

  test("负对照：拿整数序号（序列末尾 + 1）插在同一条之后 → 同刻的剧本代批会被一起放进来", () => {
    const cursor = cursorOf(14)
    const seq = (last?.seq ?? 0) + 1
    const next = insertAfter(STREAM, cursor.seq, approvalAt(cursor.revealedAtMs, seq))
    const revealed = revealedMessages(next, { revealedAtMs: cursor.revealedAtMs, seq })
    // 这正是半格序号要防的那件事：同刻排在后面的消息也被算作"已揭示"。
    expect(revealed.length).toBeGreaterThan(
      next.findIndex((message) => message.seq === seq) + 1,
    )
  })

  test("浏览器：?beat=14 上点「批准」→ 待授权 1 → 0、卡片翻到 approved、游标只走一格", async ({
    page,
  }) => {
    await openAt(page, 14)
    const readState = async () =>
      page.evaluate(() => ({
        pending: document.querySelector('[data-testid="live-status"]')?.getAttribute("data-pending-approvals"),
        cardState: document.querySelector('article[data-card-id="a2"]')?.getAttribute("data-card-state"),
        decided: document
          .querySelector('article[data-card-id="a2"] [data-testid="authority-decision"]')
          ?.getAttribute("data-decided"),
        cursorMs: document
          .querySelector('[data-testid="replay-position"]')
          ?.getAttribute("data-replay-cursor-ms"),
        cursorSeq: document
          .querySelector('[data-testid="replay-position"]')
          ?.getAttribute("data-replay-cursor-seq"),
        duration: document.querySelector('[data-testid="replay-range"]')?.getAttribute("max"),
      }))

    const before = await readState()
    expect(before.pending, "第 14 拍上必须有一张待批卡").toBe("1")
    expect(before.cardState).toBe("pending")

    await page.locator('article[data-card-id="a2"] button[data-decision="approved"]').click()
    await expect
      .poll(async () => (await readState()).pending, { message: "按下去之后待授权必须自己变小" })
      .toBe("0")

    const after = await readState()
    expect(after.cardState).toBe("approved")
    expect(after.decided, "裁决必须以文字说出来，而不是只改一个字段").toBe("approved")
    // 排程总长没变：后面的拍仍然在后面等着，没有被快进掉。
    expect(after.duration).toBe(before.duration)
    // 游标仍停在**同一个揭示时刻**上（人的裁决发生在此刻之内，不是跳到回放终点）。
    expect(Number(after.cursorMs)).toBe(Number(before.cursorMs))
    expect(Number(after.cursorSeq)).not.toBe(Number(before.cursorSeq))
  })
})

/* ========================================================================== */
/* C1 · 整屏收口：十二格无占位                                                    */
/* ========================================================================== */

test.describe("C1 · 十二格无占位（⑬ 按签署决定永久空缺）", () => {
  /**
   * 十二个组件在 DOM 上的落点。① 是**顶栏本身**（一个 `<header>`，不是面板外壳），
   * 其余十个各有一块 `data-panel`；⑫ 是顶栏右侧的展开面，同样带 `data-panel`。
   *
   * ⑬ **不在这张表里，而且不能在这里**：人已签署它交给演示层，S1 工作台的组件清单是十二个
   * （`lib/s1/contract.ts` 的 `COMPONENT_IDS` 里没有它，有测试双向钉住）。
   */
  const PRESENT: ReadonlyArray<{ label: string; selector: string }> = [
    { label: "① 态势指挥条", selector: '[data-testid="command-bar"]' },
    { label: "② 任务计划", selector: '[data-panel="plan-panel"]' },
    { label: "③ 研判流", selector: '[data-panel="finding-stream"]' },
    { label: "④ 工具控制台", selector: '[data-panel="tool-console"]' },
    { label: "⑤ 攻击链", selector: '[data-panel="attack-graph"]' },
    { label: "⑥ 处置与授权", selector: '[data-panel="authority"]' },
    { label: "⑧ 审计时间线", selector: '[data-panel="audit-timeline"]' },
    { label: "⑨ 问 S1", selector: '[data-panel="ask-s1"]' },
    { label: "⑩ 汇流管道", selector: '[data-panel="en-pipeline"]' },
    { label: "⑪ 战果与沉淀", selector: '[data-panel="sediment"]' },
    { label: "⑫ 花名册展开面", selector: '[data-panel="roster"]' },
    { label: "⑭ 报告流式生成", selector: '[data-panel="report-stream"]' },
  ]

  test("正例：十二个组件都在 DOM 上，且没有一处「本面板尚未实现」", async ({ page }) => {
    await openAt(page, 17)
    for (const entry of PRESENT) {
      await expect(page.locator(entry.selector), `${entry.label} 不在 DOM 上`).toHaveCount(1)
    }

    expect(await page.locator('[data-testid="pending-panel"]').count(), "占位面板必须一个都不剩").toBe(0)
    const text = await page.getByTestId("workbench").innerText()
    expect(text).not.toContain("尚未实现")
    expect(text).not.toContain("尚未开始")
    // ⑬ 的编号不许被别的面板顶替。
    expect(text).not.toContain("传统引擎")
  })

  test("负对照：塞一个占位面板进去，同一条判据必须红", async ({ page }) => {
    await openAt(page, 17)
    expect(await page.locator('[data-testid="pending-panel"]').count()).toBe(0)
    await page.evaluate(() => {
      const fake = document.createElement("div")
      fake.setAttribute("data-testid", "pending-panel")
      fake.textContent = "本面板尚未实现"
      document.querySelector('[data-testid="workbench"]')?.append(fake)
    })
    expect(await page.locator('[data-testid="pending-panel"]').count()).toBe(1)
    expect(await page.getByTestId("workbench").innerText()).toContain("尚未实现")
  })
})

/* ========================================================================== */
/* C2 · 骨架值钉到 DOM（本批新增：此前只有「常量等于规格」）                        */
/* ========================================================================== */

test.describe("C2 · 1680×1050 下用 getBoundingClientRect 断言骨架", () => {
  test("正例：顶栏 76 · 底栏 130 · 三列 500/600/366 · 根 pad 20 · 列间距 14", async ({ page }) => {
    await openAt(page, 17, { viewport: CANVAS })

    const boxes = await page.evaluate(() => {
      const pick = (selector: string) => {
        const node = document.querySelector<HTMLElement>(selector)
        if (node === null) throw new Error(`骨架断言找不到 ${selector}`)
        const box = node.getBoundingClientRect()
        return {
          left: box.left,
          top: box.top,
          right: box.right,
          bottom: box.bottom,
          width: box.width,
          height: box.height,
        }
      }
      return {
        canvas: pick(".s1-canvas"),
        header: pick(".s1-header"),
        replaybar: pick(".s1-replaybar"),
        columns: pick(".s1-columns"),
        footer: pick(".s1-footer"),
        left: pick(".s1-column--left"),
        middle: pick(".s1-column--middle"),
        right: pick(".s1-column--right"),
      }
    })

    // 先钉住「量到了」：0 / NaN 绝不能静默通过（`Math.abs(NaN - x) > tol` 是 false）。
    for (const [name, box] of Object.entries(boxes)) {
      for (const [key, value] of Object.entries(box)) {
        expect(Number.isFinite(value), `${name}.${key} 不是有限数（没量到 ≠ 满足条件）`).toBe(true)
      }
      expect(box.width > 0 && box.height > 0, `${name} 的矩形不是实体`).toBe(true)
    }

    // 画布本身 = 设计尺寸（scale 在 1680×1050 下恰好是 1）。
    expect(boxes.canvas.width).toBeCloseTo(CONSOLE_GEOMETRY.canvasWidth, 1)
    expect(boxes.canvas.height).toBeCloseTo(CONSOLE_GEOMETRY.canvasHeight, 1)

    // 骨架三件套。
    expect(boxes.header.height, "顶栏高必须是 76").toBeCloseTo(CONSOLE_GEOMETRY.headerHeight, 1)
    expect(boxes.footer.height, "底栏高必须是 130").toBeCloseTo(CONSOLE_GEOMETRY.footerHeight, 1)
    expect(boxes.left.width, "左列宽必须是 500").toBeCloseTo(CONSOLE_GEOMETRY.columnWidths.left, 1)
    expect(boxes.middle.width, "中列宽必须是 600").toBeCloseTo(CONSOLE_GEOMETRY.columnWidths.middle, 1)
    expect(boxes.right.width, "右列宽必须是 366").toBeCloseTo(CONSOLE_GEOMETRY.columnWidths.right, 1)

    // 根 padding = 20：顶栏上沿到画布上沿的距离。
    expect(boxes.header.top - boxes.canvas.top, "根 padding 必须是 20").toBeCloseTo(
      CONSOLE_GEOMETRY.rootPadding,
      1,
    )
    expect(boxes.left.left - boxes.canvas.left, "左列起点必须是 20").toBeCloseTo(
      CONSOLE_GEOMETRY.rootPadding,
      1,
    )

    /*
     * 右侧留白 = padding 20 **加上** 146 的余量。
     *
     * 146 不是"随便剩的"：`S1-设计稿实测与实现规格.md` §二 写明了
     * 「三列合计 500 + 600 + 366 + 2×14 = 1494，加根左右 padding 40 = 1534 ≤ 1680 ✓
     * （余量 146 留给面板内边距与滚动条）」。这里把它连同 padding 一起算成一个可判红的等式 ——
     * 于是"三列到底占多宽"与"还剩多少"两件事都被钉住，而不是只钉住前者。
     */
    const columnsWidth = Object.values(CONSOLE_GEOMETRY.columnWidths).reduce(
      (sum, width) => sum + width,
      0,
    )
    const slack =
      CONSOLE_GEOMETRY.canvasWidth -
      (CONSOLE_GEOMETRY.rootPadding * 2 + columnsWidth + CONSOLE_GEOMETRY.rootGap * 2)
    expect(slack, "设计稿实测的右侧余量是 146").toBe(146)
    expect(boxes.canvas.right - boxes.right.right, "右侧留白 = 20 的根 padding + 146 的余量").toBeCloseTo(
      CONSOLE_GEOMETRY.rootPadding + slack,
      1,
    )

    // 列间距 = 14（= 根 gap）：三列之间、以及每一段之间的竖直间距。
    expect(boxes.middle.left - boxes.left.right, "左列与中列之间必须是 14").toBeCloseTo(
      CONSOLE_GEOMETRY.rootGap,
      1,
    )
    expect(boxes.right.left - boxes.middle.right, "中列与右列之间必须是 14").toBeCloseTo(
      CONSOLE_GEOMETRY.rootGap,
      1,
    )
    expect(boxes.columns.top - boxes.replaybar.bottom, "顶栏/回放条/主体之间的竖直间距").toBeCloseTo(
      CONSOLE_GEOMETRY.rootGap,
      1,
    )
    expect(boxes.footer.top - boxes.columns.bottom, "主体与底栏之间必须是 14").toBeCloseTo(
      CONSOLE_GEOMETRY.rootGap,
      1,
    )

    // 列内 padding = 12：左列内容起点 32、右列内容终点 1502 —— 与 2026-09-17 截图实拍一致。
    expect(boxes.left.left + CONSOLE_GEOMETRY.columnPadding, "左列内容起点必须是 32").toBeCloseTo(32, 1)
    expect(boxes.right.right - CONSOLE_GEOMETRY.columnPadding, "右列内容终点必须是 1502").toBeCloseTo(1502, 1)
  })

  test("正例：底栏 ⑨ 的宽度也是实测值（640），且两格之间只隔一个 gap", async ({ page }) => {
    await openAt(page, 17, { viewport: CANVAS })
    const measured = await page.evaluate(() => {
      const ask = document.querySelector<HTMLElement>('[data-panel="ask-s1"]')?.closest(".s1-footer__slot")
      const report = document
        .querySelector<HTMLElement>('[data-panel="report-stream"]')
        ?.closest(".s1-footer__slot")
      const footer = document.querySelector<HTMLElement>(".s1-footer")
      if (ask === null || ask === undefined || report === null || report === undefined || footer === null) {
        throw new Error("底栏两格找不到")
      }
      return {
        askWidth: ask.getBoundingClientRect().width,
        gap: report.getBoundingClientRect().left - ask.getBoundingClientRect().right,
        reportWidth: report.getBoundingClientRect().width,
        footerWidth: footer.getBoundingClientRect().width,
      }
    })
    expect(measured.askWidth).toBeCloseTo(CONSOLE_GEOMETRY.askS1Width, 1)
    expect(measured.gap).toBeCloseTo(CONSOLE_GEOMETRY.footerGap, 1)
    expect(measured.askWidth + measured.gap + measured.reportWidth).toBeCloseTo(
      measured.footerWidth - CONSOLE_GEOMETRY.footerPadding * 2,
      1,
    )
  })

  test("正例：scale-to-fit 在窄视口下等比缩小 —— 画布仍按 1680 排版，屏幕上占满 1440", async ({ page }) => {
    await openAt(page, 17, { viewport: NARROW })
    const measured = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLElement>(".s1-canvas")
      if (canvas === null) throw new Error("找不到画布")
      const box = canvas.getBoundingClientRect()
      return {
        rectWidth: box.width,
        rectHeight: box.height,
        layoutWidth: canvas.offsetWidth,
        layoutHeight: canvas.offsetHeight,
        scale: Number(canvas.getAttribute("data-scale")),
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }
    })
    const expected = scaleForViewport(NARROW.width, NARROW.height)
    expect(expected).toBeLessThan(1)
    expect(measured.scale).toBeCloseTo(expected, 3)
    // 屏幕上等比的：1440×900 下正好占满。
    expect(measured.rectWidth).toBeCloseTo(NARROW.width, 1)
    expect(measured.rectHeight).toBeCloseTo(NARROW.height, 1)
    // 布局尺寸**没有变**：内部仍然按 1680×1050 排版（保真优先）。
    expect(measured.layoutWidth).toBe(CONSOLE_GEOMETRY.canvasWidth)
    expect(measured.layoutHeight).toBe(CONSOLE_GEOMETRY.canvasHeight)
    // 缩放之后不产生横向溢出。
    expect(measured.scrollWidth).toBeLessThanOrEqual(measured.innerWidth + 1)
  })

  test("负对照：把根 padding 改掉，同一条判据必须红", async ({ page }) => {
    await openAt(page, 17, { viewport: CANVAS })
    const before = await page.evaluate(
      () => document.querySelector(".s1-header")!.getBoundingClientRect().top,
    )
    expect(before).toBeCloseTo(CONSOLE_GEOMETRY.rootPadding, 1)

    await page.addStyleTag({
      content: `.s1-canvas{padding-top:${CONSOLE_GEOMETRY.rootPadding + 7}px !important}`,
    })
    await page.waitForTimeout(60)
    const after = await page.evaluate(
      () => document.querySelector(".s1-header")!.getBoundingClientRect().top,
    )
    expect(after, "改了根 padding 而判据没反应 —— 它量错了对象").not.toBeCloseTo(
      CONSOLE_GEOMETRY.rootPadding,
      1,
    )
  })

  test("样式层仍然没有颜色与时长字面量（本批新增的 CSS 一并受管）", () => {
    const css = read("components/prototype/workbench/workbench.css")
    expect(css.length).toBeGreaterThan(10_000)
    const code = stripComments(css)
    expect(code.length, "剥掉注释后不该只剩空壳").toBeGreaterThan(10_000)
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(code).not.toMatch(/\b(?:rgba?|hsla?)\(/)
    expect(code).not.toMatch(/cubic-bezier\(/)
    expect(code).not.toMatch(/\b\d+(?:\.\d+)?m?s\b/)
  })
})

/* ========================================================================== */
/* 附：本批新增的两条 UI 纪律                                                     */
/* ========================================================================== */

test.describe("批次 3 的文案纪律", () => {
  test("没有残留的「未实现」文案键（词典里删干净了）", () => {
    const dictionary = stripComments(read("lib/i18n/zh-CN.ts"))
    expect(dictionary).not.toContain("本面板尚未实现")
    expect(dictionary).not.toContain("notBuilt")
    // 但它必须真的说了十二格已经落盘 —— 否则删除就只是"没写那句话"。
    expect(read("lib/i18n/zh-CN.ts")).toContain("十二")
  })

  test("画布的空窗期不是「空气泡」：没有坐标字段残留（布局换过一次）", () => {
    const source = stripComments(read("components/prototype/workbench/view-model.ts"))
    expect(source).not.toContain("ATTACK_CHAIN_SLOTS")
    expect(source).not.toContain("ATTACK_CHAIN_POSITION")
    expect(source, "分层布局必须真的在算").toContain("attackChainLayout")
  })
})

/** 别让"画布为空"这种状态被静默放过：本文件用到的常量必须真的非空。 */
test("本文件的对照物非空（否则上面的断言全都在空集上成立）", () => {
  expect(STREAM.length).toBeGreaterThan(100)
  expect(SCHEDULE.length).toBeGreaterThan(10)
  const chain: AttackChain = attackChainOf(replayStream(STREAM, CURSOR_END), STREAM)
  expect(chain.nodes.length).toBeGreaterThan(1)
  expect(chain.edges.length).toBeGreaterThan(0)
})
