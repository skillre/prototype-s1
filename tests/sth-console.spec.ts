import { readFileSync } from "node:fs"
import { join } from "node:path"

import { expect, test, type Page } from "@playwright/test"

import {
  CONSOLE_GEOMETRY,
  scaleForViewport,
} from "../components/prototype/workbench/geometry"
import {
  buildPlaybackSchedule,
  frameForBeatRequest,
  planSignature,
  promptSignals,
  revealedMessages,
  transcriptIsGuarded,
  workbenchTranscript,
} from "../components/prototype/workbench/view-model"
import { ACTION_CATALOG, type ActionCode, type IncidentMessage } from "../lib/sth/contract"
import { countersFromEvents } from "../lib/sth/counters"
import { CURSOR_OPENING, cursorAtBeat, replayStream } from "../lib/sth/replay"
import { ENVIRONMENT, HEADER_STATS_SIGNED, SEED, TOOL_CALLS } from "../lib/sth/seed"
import { buildIncidentStream } from "../lib/sth/timeline"
import { zhCN } from "../lib/i18n/zh-CN"
import { stripComments } from "../scripts/lib/kits-seam.mjs"
import { invariant } from "./support/product-contract"

/**
 * STH 工作台 · 界面第一批（骨架 + ① 顶栏 + ②③④ 中列）的浏览器与派生断言。
 *
 * 这个文件是**注释里已经承诺过的那一份**：
 *   · `lib/i18n/zh-CN.ts` 的 `workbench` 命名空间写着「`liveStatus(0)` 必须逐字等于种子
 *     `headerStats.liveStatus`（那条断言在 `tests/sth-console.spec.ts` 里）」；
 *   · 同一个文件承诺「动作目录里的每个动作码都必须有图例」；
 *   · `components/prototype/workbench/view-model.ts` 写着派生「可以在没有 DOM 的情况下被断言
 *     （`tests/sth-console.spec.ts`），也可以在浏览器里被断言同一件事」；
 *   · `geometry.ts` 写着骨架尺寸「由 `tests/sth-console.spec.ts` 逐值比对」；
 *   · `workbench.css` 写着「文件里没有 #hex / rgb() / px 时长 / cubic-bezier 字面量，
 *     `tests/sth-console.spec.ts` 会逐条扫描」。
 *
 * 所以这里的形状是固定的：**同一件事既在纯函数上算一遍，也在真实 Chromium 上量一遍**。
 * 只有前者 = 「代码看起来对」；只有后者 = 「今天这台机器看起来对」。
 */

const ROOT = process.cwd()
const WORKBENCH = "/workbench"

/** 一次构建，多次复用（数据层自己保证同一输入同一输出）。 */
const STREAM: readonly IncidentMessage[] = buildIncidentStream()
const SCHEDULE = buildPlaybackSchedule(STREAM)

const cursorOf = (beat: number) => cursorAtBeat(STREAM, beat)

const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8")

/** QA 矩阵里的那条视口（desktop 1440×900）。 */
const VIEWPORT = { width: 1440, height: 900 }

/**
 * 等 scale 落到该落的值上。
 *
 * 画布是挂载后量视口、再由 React 写进 `data-scale` 的（SSR 与首帧都是 1）。所以
 * 「页面已经能看见」不等于「布局已经settle」—— 直接去量 DOM 会在缩放生效之前读到
 * 1050 画布的原始坐标，得到一条**假的**结论（这不是假想：本文件第一次跑就是这么红的）。
 * 一切静态读数（坐标、计数文案）都必须先过这一关。
 */
async function settled(page: Page, viewport = VIEWPORT) {
  await expect
    .poll(
      async () => Number(await page.locator(".sth-canvas").getAttribute("data-scale")),
      { message: "scale-to-fit 必须落到签过字的那个值上" },
    )
    .toBeCloseTo(scaleForViewport(viewport.width, viewport.height), 3)
}

/** 停在某一拍上打开工作台（回放控制本来就支持 `?beat=` 深链）。 */
async function openAt(page: Page, beat: number) {
  await page.setViewportSize(VIEWPORT)
  await page.goto(`${WORKBENCH}?beat=${beat}&autoplay=0`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("workbench")).toBeVisible()
  await settled(page)
}

const counterValue = (page: Page, key: string) =>
  page.locator(`[data-counter="${key}"] .sth-counter__value`)

/**
 * 这个节点（含祖先）里有几个 `aria-hidden="true"`。
 *
 * 不借用任何文案匹配：`aria-hidden` 剪掉的是整棵子树，所以判据必须是「链上有几个宿主」，
 * 而不是「还能不能按文字找到它」——后者取决于匹配引擎的脾气。
 */
async function hiddenHostCount(locator: ReturnType<Page["getByTestId"]>): Promise<number> {
  return locator.evaluate((node) => {
    let count = 0
    for (let element: Element | null = node; element !== null; element = element.parentElement) {
      if (element.getAttribute("aria-hidden") === "true") count += 1
    }
    return count
  })
}

/* ========================================================================== */
/* 1 · 90 秒定调：两个信号在真实浏览器里出现                                      */
/* ========================================================================== */

test.describe("90 秒定调：两个「这不是传统安全产品」的信号", () => {
  test("浏览器墙钟实测：计划首次改写与控制台首条带回显的命令都在 90 秒内出现", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    // 墙钟从导航开始算 —— 这是观众按下的那一下，不是排程里的一个数。
    const startedAt = Date.now()
    await page.goto(WORKBENCH, { waitUntil: "domcontentloaded" })

    // 信号一：重规划脚注出现（第 9 拍，`p0` 被划掉、`p5` 新增）。
    await expect(page.getByTestId("replan-note")).toBeVisible({ timeout: 60_000 })
    const planAtMs = Date.now() - startedAt
    await expect(page.locator('[data-step-id="p0"][data-step-state="superseded"]')).toBeVisible()

    // 信号二：控制台里第一条**已经返回回显**的命令（第 12 拍的 `rm`）。
    const echoed = page
      .locator('[data-entry-kind="command"][data-echo-lines]:not([data-echo-lines="0"])')
      .first()
    await expect(echoed).toBeVisible({ timeout: 60_000 })
    const consoleAtMs = Date.now() - startedAt

    const bothByMs = Math.max(planAtMs, consoleAtMs)
    expect(
      bothByMs,
      `两个信号都必须落在 90 秒预算内（计划 ${planAtMs}ms · 控制台 ${consoleAtMs}ms）`,
    ).toBeLessThanOrEqual(90_000)

    // 排程上的同一件事（可复算、不依赖机器快慢）：两边必须**指同两个信号**。
    const measured = promptSignals(STREAM, SCHEDULE)
    expect(measured.bothByMs).toBeLessThanOrEqual(measured.budgetMs)
    expect(measured.signals.map((signal) => signal.id).sort()).toEqual([
      "console-executing",
      "plan-in-motion",
    ])
    // 每个信号都要有事实出处（拍号 + 触发它的那条消息），不是形容词。
    for (const signal of measured.signals) expect(signal.evidence).toMatch(/第 \d+ 拍/)
  })

  test("第一个信号的定义是可复算的：计划签名第一次变化发生在第 9 拍", () => {
    let previous: string | null = null
    let movedAtBeat: number | null = null
    for (const frame of SCHEDULE) {
      const signature = planSignature(replayStream(STREAM, frame.cursor))
      if (signature.length === 0) continue
      if (previous !== null && signature !== previous && movedAtBeat === null) {
        movedAtBeat = frame.beatStep
        break
      }
      previous = signature
    }
    expect(movedAtBeat, "计划必须在回放里真的被改写一次").toBe(9)
  })
})

/* ========================================================================== */
/* 2 · 工具动作码图例完整性                                                      */
/* ========================================================================== */

test.describe("工具动作码图例：目录里的每个码都有中文名与影响面", () => {
  const copy = zhCN.workbench.toolConsole
  const codes = Object.keys(ACTION_CATALOG) as ActionCode[]

  test("运行时逐码断言（类型已经守了一道，但类型可以被绕过）", () => {
    expect(codes.length, "动作目录必须真的被扫到").toBeGreaterThan(0)
    for (const code of codes) {
      expect(copy.actions[code], `${code} 缺中文名`).toBeTruthy()
      expect(copy.impacts[code], `${code} 缺影响面图例`).toBeTruthy()
      // 图例是给现场看的文案：中文，不是把英文枚举抄一遍。
      expect(copy.impacts[code], `${code} 的影响面没有中文`).toMatch(/[\u4e00-\u9fa5]/)
      expect(copy.actions[code], `${code} 的动作名没有中文`).toMatch(/[\u4e00-\u9fa5]/)
    }
    // 说明卡的四栏顺序就是设计稿的顺序，少一栏或多一栏都是漂移。
    expect([...copy.briefFieldOrder]).toEqual(["basis", "action", "impact", "rollback"])
  })

  test("图例落在 DOM 上：每条说明卡的「影响」都等于该动作码的图例原文", async ({ page }) => {
    await openAt(page, 16)

    const cards = page.getByTestId("brief-card")
    await expect(cards).toHaveCount(5)

    for (let index = 0; index < 5; index += 1) {
      const card = cards.nth(index)
      const code = await card.getAttribute("data-action-code")
      expect(code, "说明卡必须带动作码").not.toBeNull()
      await expect(card.locator('[data-brief-field="impact"]')).toHaveText(
        copy.impacts[code as ActionCode],
      )
      await expect(card.locator('[data-brief-field="action"]')).toHaveText(
        copy.actions[code as ActionCode],
      )
      // 依据栏：这一轮的五张说明卡都引用了证据，所以不许出现「不引用证据」。
      await expect(card.locator('[data-brief-field="basis"]')).not.toHaveText(copy.noBasis)
    }
  })

  test("顶栏状态句与种子逐字一致（词典模板不是第二份文案）", () => {
    expect(zhCN.workbench.commandBar.liveStatus(0)).toBe(HEADER_STATS_SIGNED.liveStatus)
    expect(ENVIRONMENT.isolation).toContain("演示环境")
  })
})

/* ========================================================================== */
/* 3 · 顶栏计数是派生值，能追到具体事件                                           */
/* ========================================================================== */

test.describe("顶栏计数：派生、可复算、可追到事件", () => {
  test("三个计数与 countersFromEvents 的重算逐值相等（开场 126/2 → 收尾 128/3 · 41s）", async ({
    page,
  }) => {
    const readCounters = async () =>
      page.evaluate(() => {
        const value = (key: string) =>
          document.querySelector(`[data-counter="${key}"] .sth-counter__value`)?.textContent ?? null
        return {
          autonomous: value("autonomousClosedToday"),
          interventions: value("humanInterventions"),
          handling: value("avgHandlingSeconds"),
        }
      })

    await page.setViewportSize(VIEWPORT)
    await page.goto(`${WORKBENCH}?autoplay=0`, { waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("workbench")).toBeVisible()
    await settled(page)

    const opening = countersFromEvents(STREAM, CURSOR_OPENING)
    await expect(counterValue(page, "autonomousClosedToday")).toHaveText(
      String(opening.autonomousClosedToday),
    )
    await expect(counterValue(page, "humanInterventions")).toHaveText(
      String(opening.humanInterventions),
    )
    await expect(counterValue(page, "avgHandlingSeconds")).toHaveText(
      `${opening.avgHandlingSeconds}s`,
    )
    expect(await readCounters()).toEqual({
      autonomous: String(opening.autonomousClosedToday),
      interventions: String(opening.humanInterventions),
      handling: `${opening.avgHandlingSeconds}s`,
    })
    expect(opening.autonomousClosedToday).toBe(126)
    expect(opening.humanInterventions).toBe(2)

    await openAt(page, 17)
    const final = countersFromEvents(STREAM, cursorOf(17))
    await expect(counterValue(page, "autonomousClosedToday")).toHaveText(
      String(final.autonomousClosedToday),
    )
    await expect(counterValue(page, "humanInterventions")).toHaveText(
      String(final.humanInterventions),
    )
    await expect(counterValue(page, "avgHandlingSeconds")).toHaveText(
      `${final.avgHandlingSeconds}s`,
    )
    expect(await readCounters()).toEqual({
      autonomous: String(final.autonomousClosedToday),
      interventions: String(final.humanInterventions),
      handling: `${final.avgHandlingSeconds}s`,
    })
    // 设计稿静帧值：128 / 3 / 41s —— 三个数都由事件聚合重算得出，不是脚本赋的值。
    expect(final.autonomousClosedToday).toBe(HEADER_STATS_SIGNED.autonomousClosedToday)
    expect(final.humanInterventions).toBe(HEADER_STATS_SIGNED.humanInterventions)
    expect(final.avgHandlingSeconds).toBe(HEADER_STATS_SIGNED.avgHandlingSeconds)
  })

  test("待人工授权 N 项：第 14 拍 = 1，而且能追到那张待批卡与它的来源事件", async ({ page }) => {
    await openAt(page, 14)
    await expect(page.getByTestId("live-status")).toHaveAttribute("data-pending-approvals", "1")

    const cursor = cursorOf(14)
    const state = replayStream(STREAM, cursor)
    const pendingCards = state.disposition.cards.filter(
      (card) => card.cardKind === "approval-required" && card.state === "pending",
    )
    expect(pendingCards).toHaveLength(1)
    const card = pendingCards[0]

    // 追到具体事件：这条计数就是**那条** `action_card` 消息造出来的。
    const revealed = revealedMessages(STREAM, cursor)
    const source = revealed.filter(
      (message) => message.kind === "action_card" && message.cardId === card.cardId,
    )
    expect(source, `${card.cardId} 必须有一条来源事件`).toHaveLength(1)
    expect(source[0]?.kind === "action_card" && source[0].cardKind).toBe("approval-required")
    expect(source[0]?.kind === "action_card" && source[0].evidenceRefs.length).toBeGreaterThan(0)
  })

  test("第 15 拍 = 0：翻转由人的 approval 事件解释，不是把字段悄悄改写", async ({ page }) => {
    await openAt(page, 15)
    await expect(page.getByTestId("live-status")).toHaveAttribute("data-pending-approvals", "0")

    const revealed = revealedMessages(STREAM, cursorOf(15))
    const decisions = revealed.filter((message) => message.kind === "approval")
    expect(decisions.length, "第 15 拍必须有一条人的裁决").toBeGreaterThan(0)
    // 裁决指向的正是第 14 拍那张卡。
    const pendingAt14 = replayStream(STREAM, cursorOf(14))
      .disposition.cards.filter((card) => card.cardKind === "approval-required" && card.state === "pending")
      .map((card) => card.cardId)
    expect(decisions.map((message) => (message.kind === "approval" ? message.cardId : ""))).toContain(
      pendingAt14[0],
    )
  })
})

/* ========================================================================== */
/* 4 · 已签署不变量：演示环境标识常驻可见（第 8 条，2026-09-16 人签署）              */
/* ========================================================================== */

invariant(
  "boundary.demo-is-labelled-as-demo",
  "演示环境标识常驻可见：全场级 + 组件级两层，且不得用 aria-hidden 或隐藏元素冒充",
  () => {
    for (const theme of ["dark", "light"] as const) {
      test(`正例 · ${theme}：两层标识都可见，且有实体尺寸（不是 0×0）`, async ({ page }) => {
        await page.setViewportSize(VIEWPORT)
        await page.emulateMedia({ colorScheme: theme })
        await page.goto(WORKBENCH, { waitUntil: "domcontentloaded" })
        await settled(page)

        // (a) 全场级。
        const label = page.getByTestId("demo-environment-label")
        await expect(label).toBeVisible()
        await expect(label).toContainText(ENVIRONMENT.isolation)
        // `getBoundingClientRect()` 而不是 Playwright 的 `boundingBox()`：画布是 scale-to-fit
        // 过的，前者给的是**屏幕上**的框（含缩放），后者给的是布局框（1050 画布里的坐标）。
        // 「可见」说的必须是屏幕上那一个，所以这里量前者。
        const rect = await label.evaluate((node) => {
          const box = node.getBoundingClientRect()
          return { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom }
        })
        expect(rect.width, "(a) 层必须有实体宽高").toBeGreaterThan(0)
        expect(rect.height).toBeGreaterThan(0)
        expect(rect.y).toBeGreaterThanOrEqual(-1)
        // 它必须在**视口内**：常驻可见不等于「存在但被 scale 挤出屏幕外」。
        expect(rect.bottom, "标识必须落在视口底部以内").toBeLessThanOrEqual(900 + 1)
        await expect(label).toBeInViewport()
        // 屏幕阅读器也看得见：可见性不是靠 aria-hidden 换来的。
        expect(await hiddenHostCount(label), "标识及其祖先不得有 aria-hidden").toBe(0)
        const painted = await label.evaluate((node) => {
          const style = getComputedStyle(node)
          return { display: style.display, visibility: style.visibility, opacity: Number(style.opacity) }
        })
        expect(painted.display).not.toBe("none")
        expect(painted.visibility).not.toBe("hidden")
        expect(painted.opacity).toBeGreaterThan(0.5)

        // (b) 组件级：尚未真跑的 ④ 工具控制台带自己的角标。
        await expect(page.getByTestId("scripted-replay-badge")).toBeVisible()
        const badgeBox = await page.getByTestId("scripted-replay-badge").boundingBox()
        expect(badgeBox?.width ?? 0).toBeGreaterThan(0)
      })
    }

    test("负对照：把标识藏起来之后，同一条判据必须红", async ({ page }) => {
      await page.goto(WORKBENCH, { waitUntil: "domcontentloaded" })
      const label = page.getByTestId("demo-environment-label")
      await expect(label).toBeVisible()
      expect(await hiddenHostCount(label)).toBe(0)

      // 用 `display: none` 冒充「可见」—— 探针必须识破，否则它只是在说「是」。
      await page.addStyleTag({ content: '[data-testid="demo-environment-label"]{display:none}' })
      await expect(label).toBeHidden()

      // `aria-hidden="true"` 同理：屏幕上还在，无障碍树里却没有它，不算常驻可见。
      await page.addStyleTag({ content: '[data-testid="demo-environment-label"]{display:flex}' })
      await label.evaluate((node) => node.setAttribute("aria-hidden", "true"))
      await expect(label).toBeVisible() // 肉眼还看得见……
      expect(await hiddenHostCount(label), "……但同一条判据必须红").toBe(1)
    })
  },
)

/* ========================================================================== */
/* 5 · 骨架：实测尺寸只有一份，scale-to-fit 只有一条公式                          */
/* ========================================================================== */

test.describe("骨架与 scale-to-fit", () => {
  test("geometry 逐值等于种子 layoutFacts（设计稿实测值的逐字副本）", () => {
    const facts = SEED.layoutFacts
    expect(CONSOLE_GEOMETRY.canvasWidth).toBe(facts.canvas.width)
    expect(CONSOLE_GEOMETRY.canvasHeight).toBe(facts.canvas.height)
    expect(CONSOLE_GEOMETRY.headerHeight).toBe(facts.headerHeight)
    expect(CONSOLE_GEOMETRY.footerHeight).toBe(facts.footerHeight)
    expect(CONSOLE_GEOMETRY.rootPadding).toBe(facts.rootPadding)
    expect(CONSOLE_GEOMETRY.rootGap).toBe(facts.rootGap)
    expect(CONSOLE_GEOMETRY.columnPadding).toBe(facts.columnPadding)
    expect(CONSOLE_GEOMETRY.headerPadding).toBe(facts.headerPadding)
    expect(CONSOLE_GEOMETRY.headerGap).toBe(facts.headerGap)
    expect(CONSOLE_GEOMETRY.footerPadding).toBe(facts.footerPadding)
    expect(CONSOLE_GEOMETRY.footerGap).toBe(facts.footerGap)
    expect(CONSOLE_GEOMETRY.askSthWidth).toBe(facts.askSthWidth)
    expect(CONSOLE_GEOMETRY.columnWidths).toEqual({
      left: facts.columns[0].width,
      middle: facts.columns[1].width,
      right: facts.columns[2].width,
    })
  })

  test("scale-to-fit：1440 → 0.8571，1920 → 1（不放大），并且浏览器里真的没有横向溢出", async ({
    page,
  }) => {
    expect(scaleForViewport(1440, 900)).toBeCloseTo(0.8571, 3)
    expect(scaleForViewport(1920, 1080)).toBe(1)
    expect(scaleForViewport(2560, 1440), "宽屏 1:1 不放大").toBe(1)

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport)
      await page.goto(WORKBENCH, { waitUntil: "domcontentloaded" })
      await expect(page.getByTestId("workbench")).toBeVisible()

      // scale 是挂载后量出来的（SSR 与首帧都是 1），所以要等它落到该落的值上再断言 ——
      // 「等不到」本身就是失败，不是可以放过的那一档。
      const expected = scaleForViewport(viewport.width, viewport.height)
      await expect
        .poll(
          async () => Number(await page.locator(".sth-canvas").getAttribute("data-scale")),
          { message: `${viewport.width}×${viewport.height} 的 scale 必须落到 ${expected}` },
        )
        .toBeCloseTo(expected, 3)

      const measured = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }))
      expect(measured.scrollWidth).toBeLessThanOrEqual(measured.innerWidth + 1)
    }
  })

  test("样式层没有颜色与时长字面量（骨架尺寸只从 --sth-* 来）", () => {
    const css = stripComments(read("components/prototype/workbench/workbench.css"))
    expect(css.length).toBeGreaterThan(1_000)
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/\b(?:rgba?|hsla?)\(/)
    expect(css).not.toMatch(/cubic-bezier\(/)
    // 时长：任何裸的 `180ms` / `0.2s` 都不许出现，动画只走 pack 的刻度令牌。
    expect(css).not.toMatch(/\b\d+(?:\.\d+)?m?s\b/)
    // 骨架尺寸必须来自 geometry 注入的变量，不许在样式表里手抄 px 骨架值。
    expect(css).toContain("var(--sth-canvas-w)")
    expect(css).toContain("var(--sth-scale)")
  })
})

/* ========================================================================== */
/* 6 · ④ 工具控制台：命令与回显逐字来自数据层                                     */
/* ========================================================================== */

test.describe("④ 工具控制台的数据形状", () => {
  test("每条命令前必有说明卡；负对照：抽掉说明卡，守卫必须红", () => {
    const entries = workbenchTranscript(revealedMessages(STREAM, cursorOf(16)))
    expect(entries.length).toBe(9) // 5 张说明卡 + 4 条命令
    expect(transcriptIsGuarded(entries)).toBe(true)
    entries.forEach((entry, index) => {
      if (entry.kind !== "command") return
      expect(entries[index - 1]?.kind, `第 ${entry.seq} 条命令前面没有说明卡`).toBe("brief")
    })

    // 负对照：手工抽掉最前面两张说明卡，守卫必须红（否则它只是在说「是」）。
    const firstCommand = entries.findIndex((entry) => entry.kind === "command")
    expect(firstCommand, "这一屏必须真的有命令").toBeGreaterThan(0)
    expect(transcriptIsGuarded(entries.slice(firstCommand)), "没有说明卡的命令必须被守卫抓住").toBe(
      false,
    )
  })

  test("命令逐字来自种子，回显逐行返回，退出码是数据不是装饰", async ({ page }) => {
    await openAt(page, 16)

    const commands = page.getByTestId("console-command")
    await expect(commands).toHaveCount(4)

    const expected = [TOOL_CALLS.t2, TOOL_CALLS.t3, TOOL_CALLS.t4, TOOL_CALLS.t5]
    for (let index = 0; index < expected.length; index += 1) {
      const block = commands.nth(index)
      const call = expected[index]
      await expect(block.locator(".sth-console__line pre")).toHaveText(call.command ?? "")
      const typed = Number(await block.getAttribute("data-typed-chars"))
      expect(typed, "停在第 16 拍时命令必须已经打完").toBe((call.command ?? "").length)

      const lines = (call.output ?? "").split("\n").filter((line) => line.length > 0)
      await expect(block.locator("[data-testid=console-output] pre")).toHaveCount(lines.length)
      if (lines.length > 0) {
        await expect(block.locator("[data-testid=console-output] pre").first()).toHaveText(lines[0]!)
      }
      await expect(block.locator("[data-testid=console-exit]")).toHaveText(`退出码 ${call.exitCode}`)
    }

    // 会话抬头也是记录内容（种子的 t1.session / disclosure）。
    await expect(page.getByTestId("console-session")).toContainText(TOOL_CALLS.t1.session ?? "")
    await expect(page.getByTestId("console-session")).toContainText(TOOL_CALLS.t1.disclosure ?? "")
  })

  test("逐字与逐行都是游标的纯函数：暂停时冻结，继续时接着长", async ({ page }) => {
    await openAt(page, 13)
    const fourth = page.getByTestId("console-command").nth(3)
    const typedAtPause = Number(await fourth.getAttribute("data-typed-chars"))
    const commandLength = Number(await fourth.getAttribute("data-command-length"))
    // 第 13 拍上这条命令**打到一半**：可见字数由 `progressMs − 揭示时刻` 算出来，
    // 所以「进行中」是一个真实存在、可以被停在上面看的中间态。
    expect(typedAtPause).toBeGreaterThan(0)
    expect(typedAtPause).toBeLessThan(commandLength)

    // 暂停时游标不动 → 字也不动。它没有自己的定时器（有的话这里会继续长）。
    await page.waitForTimeout(1_200)
    expect(Number(await fourth.getAttribute("data-typed-chars"))).toBe(typedAtPause)

    await openAt(page, 16)
    await expect(page.getByTestId("console-command").nth(3)).toHaveAttribute(
      "data-echo-complete",
      "true",
    )
  })
})

/* ========================================================================== */
/* 深链 ?cursor=：与 ?beat= 是**同一份真相的两个入口**                            */
/* ========================================================================== */

/**
 * ## 为什么这一节是补上的（2026-09-17）
 *
 * `?beat=<拍>` 与 `?cursor=<毫秒>` 都是**讲解用的深链**：`STH-人眼验收清单.md` 明确告诉人
 * 「可以把某一帧当链接发出去」。但测试一直**只覆盖 `?beat=`** ——
 * `?cursor=` 那条路径在方案 §五「本包未验证的部分」里挂了很久，是已知的空白。
 *
 * 它值得单测，因为它有一个别处没有的性质：**两个入口读的是同一份排程**。
 * 于是「同一个画面」必须只有一个说法 —— 如果两个入口给出不同的读数，
 * 演示里发出去的链接就会与讲解人屏幕上的东西不一致，而且**没有任何东西会因此变红**。
 */
test.describe("深链 ?cursor=", () => {
  /** 用 `?cursor=` 打开（`autoplay=0` 保证可判定的静止帧）。 */
  async function openAtCursor(page: Page, query: string) {
    await page.setViewportSize(VIEWPORT)
    await page.goto(`${WORKBENCH}?${query}&autoplay=0`, { waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("workbench")).toBeVisible()
    await settled(page)
  }

  const readPosition = (page: Page) =>
    page.getByTestId("replay-position").evaluate((node) => ({
      ms: node.getAttribute("data-replay-cursor-ms"),
      seq: node.getAttribute("data-replay-cursor-seq"),
      requestedBeat: node.getAttribute("data-requested-beat"),
      clamped: node.getAttribute("data-beat-clamped"),
    }))

  test("正例：同一帧的两个入口（?beat= / ?cursor=）读数逐值相同", async ({ page }) => {
    const beat = 9
    const target = frameForBeatRequest(SCHEDULE, beat)
    expect(target, `第 ${beat} 拍必须有帧`).not.toBeNull()
    const frame = target!.frame

    /*
     * 前置条件（否则这条断言不可比）：这一帧的**播放时刻在排程里唯一**。
     * 剧本里第 6/7 拍与 14/15 拍共享同一个揭示时刻 —— 对那种帧，
     * `frameAt( progress )` 会取同刻的**最后**一帧，两个入口因此可能合法地给出不同帧。
     * 所以先证明这一拍不是那两处，再比。
     */
    expect(
      SCHEDULE.filter((candidate) => candidate.at === frame.at).length,
      `第 ${beat} 拍的帧时刻必须在排程里唯一，否则两个入口不可比`,
    ).toBe(1)

    await openAt(page, beat)
    const viaBeat = await readPosition(page)
    await openAtCursor(page, `cursor=${frame.at}`)
    const viaCursor = await readPosition(page)

    expect(viaCursor.ms, "同一个画面不能有两个说法").toBe(viaBeat.ms)
    expect(viaCursor.seq, "序号也要一致 —— 只比毫秒分不开同刻的帧").toBe(viaBeat.seq)
    expect(viaCursor.ms).toBe(String(frame.cursor.revealedAtMs))
    expect(viaCursor.seq).toBe(String(frame.cursor.seq))

    // 走 `?cursor=` 的那次**没有请求任何一拍**，所以它不能声称夹取过。
    expect(viaCursor.requestedBeat).toBe("-1")
    expect(viaCursor.clamped).toBe("false")
  })

  test("越界不崩：?cursor= 超过排程总长时停在最后一帧", async ({ page }) => {
    const last = SCHEDULE[SCHEDULE.length - 1]!
    await openAtCursor(page, "cursor=99999999")
    const position = await readPosition(page)
    expect(position.ms).toBe(String(last.cursor.revealedAtMs))
    // 而且界面仍然是有内容的（不是白屏、不是停在一帧残缺状态）
    await expect(page.getByTestId("replay-phase")).toBeVisible()
  })

  test("非法值不崩、也不悄悄改变行为：?cursor=abc 与「明确要求开场」完全等价", async ({ page }) => {
    const opening = countersFromEvents(STREAM, CURSOR_OPENING)

    await openAtCursor(page, "cursor=abc")
    const viaInvalid = await readPosition(page)
    const invalidAutonomous = await counterValue(page, "autonomousClosedToday").textContent()
    const invalidInterventions = await counterValue(page, "humanInterventions").textContent()

    /*
     * 判据是**与「明确要求开场」逐值相同**，而不是去钉某个文案。
     *
     * 这里我第一版写错过：我断言 `?cursor=abc&autoplay=0` 的阶段读数会是「尚未开场」，
     * 实际是「已暂停」—— 因为 `autoplay=0` 说的就是「不播」，阶段词讲的是这件事，
     * 与游标落在哪一帧无关。**那是我的测试假设错了，不是产品错了。**
     * 换成「非法值与 `cursor=0` 等价」之后，这条断言才真的在守「回落是确定的」。
     */
    await openAtCursor(page, "cursor=0")
    const viaZero = await readPosition(page)

    expect(viaInvalid.ms, "非法值必须与明确要求开场落在同一帧").toBe(viaZero.ms)
    expect(viaInvalid.seq).toBe(viaZero.seq)
    expect(viaInvalid.requestedBeat).toBe("-1")
    expect(viaInvalid.clamped).toBe("false")

    // 而且那一帧就是开场：计数等于开场计数，不是 0 / 0（那是"没量到"，不是"开场"）。
    expect(invalidAutonomous).toBe(String(opening.autonomousClosedToday))
    expect(invalidInterventions).toBe(String(opening.humanInterventions))
  })

  test("优先级：?beat= 与 ?cursor= 同时给出时，以 ?beat= 为准", async ({ page }) => {
    // 这是 `initialPosition()` 里写明并实现的行为（先看 beat，再看 cursor）。
    const target = frameForBeatRequest(SCHEDULE, 11)
    expect(target).not.toBeNull()
    await openAtCursor(page, `beat=11&cursor=0`)
    const position = await readPosition(page)
    expect(position.requestedBeat).toBe("11")
    expect(position.ms).toBe(String(target!.frame.cursor.revealedAtMs))
  })
})
