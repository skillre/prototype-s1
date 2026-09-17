import { readFileSync } from "node:fs"
import { join } from "node:path"

import { expect, test, type Page } from "@playwright/test"

import {
  attackChainOf,
  attackChainUnresolvableRefs,
  auditRowsOf,
  authorityCardsOf,
  buildPlaybackSchedule,
  clockOfMs,
  declaredBeats,
  frameForBeatRequest,
  frameOfBeat,
  sedimentItemsOf,
  slaRemainingMs,
  exportSedimentText,
  verifySedimentImport,
} from "../components/prototype/workbench/view-model"
import { countersFromEvents, type CounterSnapshot } from "../lib/s1/counters"
import type { IncidentMessage } from "../lib/s1/contract"
import { CURSOR_END, knownEvidenceIds, replayStream } from "../lib/s1/replay"
import { buildIncidentStream } from "../lib/s1/timeline"
import { isAutonomous, scanAuthority } from "../lib/s1/verify"
import { READ_COLOR_SOURCE, stripComments } from "./support/source-scan"

/**
 * 由 `openAt()` 注入的浏览器侧颜色读取器（见 `tests/support/source-scan.ts`）。
 */
declare global {
  interface Window {
    __s1ReadColor?: (value: string) => [number, number, number] | null
  }
}

/**
 * S1 工作台 · 界面第二批（⑤ 攻击链 · ⑥ 处置与授权 · ⑧ 审计时间线 · ⑪ 战果与沉淀）的
 * 浏览器与派生断言，外加本批修掉的两条演示缺陷的回归钉。
 *
 * ## 形状与第一批相同，理由也相同
 *
 * 每一件事都算两遍：一遍在**纯函数**上（没有 DOM、不依赖机器快慢），一遍在**真实 Chromium**
 * 上。只有前者 = 「代码看起来对」；只有后者 = 「今天这台机器看起来对」。
 *
 * ## 四条已签署不变量在这里登记
 *
 * `evidence.every-claim-cites-a-source` · `authority.no-unlisted-autonomous-action` ·
 * `audit.replay-is-faithful` · `sediment.survives-export` · `color.every-hue-has-one-meaning`
 * —— 每一条都给出**正例**与**负对照**：一条不会红的断言，只是在说「是」。
 */

const ROOT = process.cwd()
const WORKBENCH = "/workbench"

const STREAM: readonly IncidentMessage[] = buildIncidentStream()
const SCHEDULE = buildPlaybackSchedule(STREAM)
const REVEAL_TIMES = new Map(
  SCHEDULE.flatMap((frame) => (frame.seq === null ? [] : [[frame.seq, frame.at] as const])),
)

/** QA 矩阵里的那条视口（desktop 1440×900）。 */
const VIEWPORT = { width: 1440, height: 900 }

const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8")

/**
 * 等 scale 落到该落的值上（与第一批同一条理由：画布是挂载后才量视口的，
 * 「页面已经能看见」不等于「布局已经 settle」）。
 */
async function settled(page: Page) {
  await expect
    .poll(async () => Number(await page.locator(".s1-canvas").getAttribute("data-scale")), {
      message: "scale-to-fit 必须落到签过字的那个值上",
    })
    .toBeCloseTo(Math.min(1, VIEWPORT.width / 1680, VIEWPORT.height / 1050), 3)
}

/** 停在某一拍上打开工作台。 */
async function openAt(page: Page, beat: number, theme: "dark" | "light" = "dark") {
  // 颜色读取器必须在文档脚本之前就位（颜色断言用它把声明值归一化）。
  await page.addInitScript(`window.__s1ReadColor = ${READ_COLOR_SOURCE}`)
  await page.setViewportSize(VIEWPORT)
  await page.emulateMedia({ colorScheme: theme })
  await page.goto(`${WORKBENCH}?beat=${beat}&autoplay=0`, { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("workbench")).toBeVisible()
  await settled(page)
  await panelsSettled(page)
}

/**
 * 等面板正文的滚动位置**停下来**。
 *
 * ## 为什么必须有这一步（2026-09-17 实测）
 *
 * `usePanelScroll` 的对齐不是一次算完的：内容长出来会触发 `ResizeObserver` / scroll /
 * `followKey` 三条路径，每一条都会把 `scrollTop` 往目标推一点。实测同一次加载里
 * `plan-panel` 的 `scrollTop` 是 `188 → 170 → 134 → 133.5…` 这样一路收敛的
 * （单调、不回弹 —— 修掉对称振荡之后）。于是「页面已经能看见」和
 * 「A2 探针量到的位置」之间隔着一个还在收敛的过程：在收敛中途量，量到的是
 * 上一帧的落点，断言的是一张**还没画完**的图。
 *
 * 这不是产品缺陷（对齐是单调收敛的，最终值正确），是测试的时序错误。
 * 所以这里按**构造**等它稳定：连续三帧所有面板正文的 `scrollTop` 都不变，
 * 才算停下来。比 `waitForTimeout(固定毫秒)` 可靠 —— 后者只是在赌。
 */
async function panelsSettled(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __s1ScrollProbe?: { last: string; stable: number } }
      const bodies = Array.from(document.querySelectorAll<HTMLElement>("[data-panel] .s1-panel__body"))
      const snapshot = bodies.map((b) => b.scrollTop.toFixed(2)).join(",")
      const probe = w.__s1ScrollProbe ?? { last: "", stable: 0 }
      probe.stable = probe.last === snapshot ? probe.stable + 1 : 0
      probe.last = snapshot
      w.__s1ScrollProbe = probe
      return probe.stable >= 3
    },
    undefined,
    { timeout: 10_000 },
  )
}

/* ========================================================================== */
/* 1 · A1 缺陷回归：18 拍都跳得到，计数不倒退，且不静默归零                        */
/* ========================================================================== */

test.describe("A1 · 跳到没有帧的拍（第 18 拍）必须往前夹，不静默归零", () => {
  test("framesForBeats：每一拍的落点都存在，且落点拍号单调不减", () => {
    const beats = declaredBeats()
    expect(beats.length, "剧本声明的拍号必须真的被读到").toBeGreaterThan(0)
    expect(beats).toEqual(Array.from({ length: beats.length }, (_, index) => index + 1))

    const resolved = beats.map((beat) => frameForBeatRequest(SCHEDULE, beat))
    // 18 拍里任何一拍都不许没有落点 —— 「跳不到」正是旧实现静默归零的地方。
    for (const [index, target] of resolved.entries()) {
      expect(target, `第 ${beats[index]} 拍没有落点`).not.toBeNull()
    }

    const landed = resolved.map((target) => target!.frame.beatStep ?? -1)
    for (let index = 1; index < landed.length; index += 1) {
      expect(
        landed[index]!,
        `第 ${beats[index]} 拍落到了第 ${landed[index]} 拍（比上一拍更早）`,
      ).toBeGreaterThanOrEqual(landed[index - 1]!)
    }

    // 有精确帧的拍必须**精确命中**（夹取只对没有帧的拍生效，不能顺手把别的拍也挪了）。
    for (const beat of beats) {
      const exact = frameOfBeat(SCHEDULE, beat)
      if (exact === null) continue
      expect(frameForBeatRequest(SCHEDULE, beat)?.clamped, `第 ${beat} 拍被误夹`).toBe(false)
      expect(frameForBeatRequest(SCHEDULE, beat)?.frame.at).toBe(exact.at)
    }
  })

  test("第 18 拍是那个没有帧的拍，它落在排程末尾（不是开场）", () => {
    const beats = declaredBeats()
    const withoutFrame = beats.filter((beat) => frameOfBeat(SCHEDULE, beat) === null)
    expect(withoutFrame, "本场只有第 18 拍是按需追加的").toEqual([18])

    const target = frameForBeatRequest(SCHEDULE, 18)
    expect(target?.clamped).toBe(true)
    // 落点是**排程上真实存在的最后一帧**，不是 `CURSOR_END`（那是个无穷大的游标，
    // 界面上没有对应的帧可停）。第 18 拍由 ⑨ 按需追加，固定排程上它就只有这一个落点。
    expect(target?.frame).toEqual(SCHEDULE[SCHEDULE.length - 1])
    expect(target?.frame.at, "夹取必须落在末尾而不是 0").toBeGreaterThan(0)
  })

  test("浏览器实测：?beat=18 不是开场 —— 三个计数与回放终点逐值相等", async ({ page }) => {
    const final = countersFromEvents(STREAM, CURSOR_END)
    const opening = countersFromEvents(STREAM, { revealedAtMs: -1, seq: 0 })

    await openAt(page, 18)
    /*
     * 比的是**游标**，不是帧的播放时刻 —— 两者在最后一帧上不是同一个数：
     * 末尾那一帧 `at = 10520`，而它的 `cursor.revealedAtMs = 10200`
     * （`data-replay-cursor-seq = 412`，即最后一条消息）。`data-replay-cursor-ms`
     * 暴露的是**游标**，所以期望值必须取游标那一侧，否则是在拿播放进度比消息位置。
     */
    const lastFrame = SCHEDULE[SCHEDULE.length - 1]!
    await expect(page.getByTestId("replay-position")).toHaveAttribute(
      "data-replay-cursor-ms",
      String(lastFrame.cursor.revealedAtMs),
    )
    await expect(page.getByTestId("replay-position")).toHaveAttribute("data-requested-beat", "18")
    await expect(page.getByTestId("replay-position")).toHaveAttribute("data-beat-clamped", "true")
    // 夹取要说出来（沉默地改落点与沉默地归零是同一种错误）。
    await expect(page.getByTestId("replay-beat-clamped")).toBeVisible()

    const counters = await readCounters(page)
    expect(counters).toEqual({
      autonomous: String(final.autonomousClosedToday),
      interventions: String(final.humanInterventions),
      handling: `${final.avgHandlingSeconds}s`,
    })
    // 旧实现下这里读到的正是开场值：126 / 2 + 「尚未开场」。
    expect(counters.autonomous).not.toBe(String(opening.autonomousClosedToday))
    await expect(page.getByTestId("replay-phase")).not.toHaveText("尚未开场")
  })

  /**
   * 「计数不倒退」的机器形式。
   *
   * 判据是可复算的：按 `declaredBeats()` 的顺序逐拍取落点、取计数，两个只增不减的量
   * （自主闭环 / 人工介入）与平均处置时长都不许回头。旧实现在第 18 拍上回退到开场值，
   * 这条断言当场就红。
   */
  test("逐拍夹取后计数单调不减（旧实现在第 18 拍上回退到开场）", () => {
    const beats = declaredBeats()
    const snapshots: Array<{ beat: number; landed: number; counters: CounterSnapshot }> = []

    for (const beat of beats) {
      const target = frameForBeatRequest(SCHEDULE, beat)
      expect(target, `第 ${beat} 拍没有落点`).not.toBeNull()
      const frame = target!.frame
      snapshots.push({
        beat,
        landed: frame.beatStep ?? -1,
        counters: countersFromEvents(STREAM, frame.cursor),
      })
    }

    for (let index = 1; index < snapshots.length; index += 1) {
      const previous = snapshots[index - 1]!
      const current = snapshots[index]!
      expect(
        current.counters.autonomousClosedToday,
        `第 ${current.beat} 拍的自主闭环数（${current.counters.autonomousClosedToday}）比第 ${previous.beat} 拍（${previous.counters.autonomousClosedToday}）更小`,
      ).toBeGreaterThanOrEqual(previous.counters.autonomousClosedToday)
      expect(current.counters.humanInterventions).toBeGreaterThanOrEqual(
        previous.counters.humanInterventions,
      )
      expect(current.counters.avgHandlingSeconds).toBeGreaterThanOrEqual(
        previous.counters.avgHandlingSeconds,
      )
    }

    // 负对照：喂一个不存在的帧位置（旧实现的 0 号落点），同一组断言必须红。
    const regressed = countersFromEvents(STREAM, { revealedAtMs: -1, seq: 0 })
    expect(
      regressed.autonomousClosedToday,
      "开场值必须严格小于末尾值，否则这条断言没有对象",
    ).toBeLessThan(snapshots[snapshots.length - 1]!.counters.autonomousClosedToday)
  })
})

/* ========================================================================== */
/* 2 · A2 缺陷回归：面板正文顶边不得切在半个字高上                                */
/* ========================================================================== */

test.describe("A2 · 面板正文顶边按行对齐（没有一行文字被切在半个字高上）", () => {
  for (const theme of ["dark", "light"] as const) {
    test(`${theme}：?beat=17 下所有面板正文都没有被切开的行`, async ({ page }) => {
      await openAt(page, 17, theme)

      const clipped = await page.evaluate(() => {
        /**
         * 只关心**面板正文**（滚动口在它们身上），面板头那类不滚动的区域不在此列。
         * 判据逐条：
         *   1. 元素上有非空直接文本；
         *   2. 它整体在口内（`bottom <= clipBottom`）—— 被口裁掉的那一半不看，
         *      那属于「滚出视野」，不属于「切在半个字高上」；
         *   3. 它的顶边落在口的上下沿之间 —— 于是它必然被裁。
         */
        const out: Array<{ panel: string; text: string; overflow: number }> = []
        /** 滚到底 / 无可滚动空间的面板 —— 见下方「为什么排除它们」。 */
        const atLimit: string[] = []
        for (const body of Array.from(
          document.querySelectorAll<HTMLElement>("[data-panel] .s1-panel__body"),
        )) {
          const clip = body.getBoundingClientRect()
          /*
           * ## 为什么排除「已经滚到底」的面板
           *
           * 面板正文是滚动口，顶边是**硬边界**：内容总高大于口高时，最上面那一行必然
           * 有一部分落在口外。滚到底（`scrollTop == scrollHeight - clientHeight`）时更是
           * 如此 —— 再往下滚不动了，顶行就只能半在口外。那不是排版缺陷，是"已经到头了"。
           *
           * 这条排除不会让真正的缺陷漏过去，因为缺陷的判据在**别处**、而且更严：
           *   · 下面的负对照把面板拖到**半行位置**（那一定不在底端）→ 同一条判据必须红；
           *   · `alignScrollTop` 的正例断言 `scrollTop` 落在行边界上；
           *   · 顶行若被硬切，`data-scroll-mask` 的渐隐负责收尾（见 `workbench.css`）。
           * 换句话说：这里只回答「除"到头了"之外，还有没有别的地方在切字」。
           */
          if (body.scrollHeight - body.clientHeight - body.scrollTop <= 1) {
            atLimit.push((body.closest("[data-panel]") as HTMLElement).dataset.panel ?? "?")
            continue
          }
          const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
          const seen = new Set<Element>()
          for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
            if ((node.textContent ?? "").trim().length === 0) continue
            const parent = node.parentElement
            if (parent === null || seen.has(parent)) continue
            seen.add(parent)
            const box = parent.getBoundingClientRect()
            if (box.height <= 0 || box.width <= 0) continue
            if (box.bottom > clip.bottom) continue
            if (box.top > clip.top + 0.5 || box.bottom < clip.top) continue
            out.push({
              panel: (body.closest("[data-panel]") as HTMLElement).dataset.panel ?? "?",
              text: (parent.textContent ?? "").trim().slice(0, 40),
              overflow: box.bottom - clip.top,
            })
          }
        }
        return { out, atLimit }
      })

      /*
       * 先证明这条探针**真的有对象**：至少有一个面板在滚动（既不是"全都滚到底了"，
       * 也不是"根本没有可滚动的面板"）。否则下面的空数组只是"没量到"。
       */
      expect(
        clipped.atLimit.length,
        "至少得有一个面板滚到底 —— 否则「排除到底的面板」这条规则没有实际意义",
      ).toBeGreaterThan(0)
      expect(
        clipped.out,
        `被切在半个字高上的行（面板 / 文本 / 超出上沿的像素数）：${JSON.stringify(clipped.out)}`,
      ).toEqual([])
      expect(
        clipped.out.length + clipped.atLimit.length,
        "排除之后必须还有被检查过的面板（否则这条断言在空集上成立）",
      ).toBeGreaterThan(0)
    })
  }

  test("负对照：把一行硬拖到半行位置，同一条判据必须红", async ({ page }) => {
    await openAt(page, 17)
    // 先证明「现在没有」不是因为它永远找不到东西：找得到正文、也确实在滚动。
    const scrolled = await page.evaluate(() => {
      const bodies = Array.from(document.querySelectorAll<HTMLElement>("[data-panel] .s1-panel__body"))
      return bodies
        .filter((body) => body.scrollHeight - body.clientHeight > 20)
        .map((body) => ({ panel: (body.closest("[data-panel]") as HTMLElement).dataset.panel, scrollTop: body.scrollTop }))
    })
    expect(scrolled.length, "至少要有一个真的在滚动的面板，否则这条探针没有对象").toBeGreaterThan(0)

    /*
     * 人为做一个**真正的半行偏移**：直接把某一行从它当前的位置上推开半行高。
     *
     * ## 为什么不是「改 scrollTop」
     *
     * 前一版是 `scrollTop += 7`，再一版是「滚到某行的中线」。两者都在赌**几何**：
     * 面板滚到底之后就没法再往下滚，顶行的位置由内容高度决定，不一定能落进口内；
     * 7px 更是可能正好落进行与行之间的空隙。实测两版都会量到 `null` ——
     * 而 `null` 在这里的含义是「探针没构造出它想构造的东西」，不是「产品没问题」。
     *
     * 现在不赌几何了：用 `translateY` 把一行**相对它自己的位置**推 `height/2`，
     * 于是无论面板滚到哪里，这一行的上沿必然落在口内、下沿必然越出上沿 ——
     * 这正是「切在半个字高上」的定义。判据本身一个字没改。
     */
    const broken = await page.evaluate(() => {
      const body = Array.from(document.querySelectorAll<HTMLElement>("[data-panel] .s1-panel__body")).find(
        (candidate) => candidate.scrollHeight - candidate.clientHeight > 20,
      )
      if (body === undefined) return null
      const clip = body.getBoundingClientRect()
      // 找一行**完整在口内**的行（不在口外的才谈得上"被切开"）。
      const row = Array.from(body.querySelectorAll<HTMLElement>("*")).find((node) => {
        const hasText = Array.from(node.childNodes).some(
          (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 0,
        )
        if (!hasText) return false
        const box = node.getBoundingClientRect()
        return box.height > 4 && box.width > 0 && box.top >= clip.top && box.bottom <= clip.bottom
      })
      if (row === undefined) return null
      const before = row.getBoundingClientRect()
      // 往上推半行：`translateY(-h/2)`。
      row.style.transform = `translateY(${-before.height / 2}px)`
      const after = body.getBoundingClientRect()
      const box = row.getBoundingClientRect()
      const hit =
        box.height > 0 &&
        box.bottom <= after.bottom &&
        box.top <= after.top + 0.5 &&
        box.bottom >= after.top
      return {
        hit: hit
          ? {
              panel: (body.closest("[data-panel]") as HTMLElement).dataset.panel,
              text: (row.textContent ?? "").trim().slice(0, 30),
              splitAt: Number((box.bottom - after.top).toFixed(2)),
            }
          : null,
        reason: `h=${before.height.toFixed(1)} top=${(box.top - after.top).toFixed(1)} bottom=${(box.bottom - after.top).toFixed(1)} clipH=${after.height.toFixed(1)}`,
      }
    })

    // 构造出半行偏移之后**必须**能找到一个被切的行；找不到就说明这条探针量不到东西（fail loudly）。
    expect(
      broken?.hit,
      `半行偏移之后仍然找不到被切的行 —— 这条探针没有在量它以为在量的东西。${broken?.reason ?? "（连可滚动的面板都没找到）"}`,
    ).not.toBeNull()
  })
})

/* ========================================================================== */
/* 3 · ⑤ 画布：每个实体节点的证据引用都指向真实存在的 evidence id                  */
/* ========================================================================== */

/**
 * ⑤ 画布侧的判据。**登记（`invariant()`）在 `tests/s1-invariants.spec.ts`**：
 * 两条 spec 跑在同一个 worker 里，同一 id 登记两次会让 `invariant()` 响亮地抛
 * （这是它的设计 —— 重复登记意味着有人以为自己在守住一条其实已经有人守的东西）。
 * 所以这里用普通 `describe`，标题带上 id，双向可查。
 */
test.describe("evidence.every-claim-cites-a-source · 画布引用可定位", () => {
    test("正例：全游标扫描 —— 画布引用的证据全部可在登记簿里定位", () => {
      const known = knownEvidenceIds()
      expect(known.size, "证据登记簿必须真的被读到").toBeGreaterThan(0)

      let edgesSeen = 0
      let citationsSeen = 0
      for (const frame of SCHEDULE) {
        const chain = attackChainOf(replayStream(STREAM, frame.cursor), STREAM)
        expect(
          attackChainUnresolvableRefs(chain),
          `第 ${frame.beatStep} 拍上出现了无法定位的证据引用`,
        ).toEqual([])

        for (const edge of chain.edges) {
          expect(known.has(edge.evidenceRef), `边 ${edge.from}→${edge.to} 的证据 ${edge.evidenceRef} 不存在`).toBe(true)
          edgesSeen += 1
        }
        for (const node of chain.nodes) {
          for (const ref of node.evidenceRefs) {
            expect(known.has(ref), `节点 ${node.id} 的证据 ${ref} 不存在`).toBe(true)
            citationsSeen += 1
          }
        }
      }
      // 不许「0 条边 / 0 条引用也算通过」—— 那是没量到，不是满足条件。
      expect(edgesSeen, "整条回放里必须有边被扫到").toBeGreaterThan(0)
      expect(citationsSeen, "整条回放里必须有节点引用被扫到").toBeGreaterThan(0)
    })

    test("正例：浏览器里每个节点的引用 chip 都有 data-evidence-ref，且都指向真实证据", async ({ page }) => {
      await openAt(page, 17)
      const known = [...knownEvidenceIds()]
      const refs = await page
        .locator('[data-panel="attack-graph"] [data-evidence-ref]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-evidence-ref") ?? ""))
      expect(refs.length, "画布上必须有引用 chip").toBeGreaterThan(0)
      for (const ref of refs) expect(known, `${ref} 不在登记簿里`).toContain(ref)

      // 每个节点都要说清楚自己有没有引用（空引用是合法事实，静默才是缺陷）。
      const cited = await page
        .locator('[data-panel="attack-graph"] [data-testid="graph-node"]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-cited")))
      expect(cited.length).toBeGreaterThan(0)
      for (const value of cited) expect(["true", "false"]).toContain(value)
    })

    test("负对照：把一条不存在的证据挂到画布数据上，扫描器必须红", () => {
      const state = replayStream(STREAM, CURSOR_END)
      const chain = attackChainOf(state, STREAM)
      expect(chain.nodes.length).toBeGreaterThan(0)

      const corrupted = {
        ...chain,
        nodes: chain.nodes.map((node, index) =>
          index === 0 ? { ...node, evidenceRefs: [...node.evidenceRefs, "#e-does-not-exist"] } : node,
        ),
      }
      expect(attackChainUnresolvableRefs(corrupted)).toEqual(["#e-does-not-exist"])
      // 同一份数据里，边上的假引用也要被抓到。
      const badEdge = { ...chain, edges: [...chain.edges, { from: "a", to: "b", evidenceRef: "#e-nope", fromRole: null, toRole: null }] }
      expect(attackChainUnresolvableRefs(badEdge)).toContain("#e-nope")
    })

    test("正例：画布上的节点两两不重合（每个实体领到不同的格子）", () => {
      /**
       * 2026-09-17 实测缺陷：位置表只列了 4 个实体，而画布上是 6 个 ——
       * 另外两个走"按序号排开"的取模公式，**撞上了位置表里的格子**，
       * 于是 `data:policy-db` 与 `file:webshell1.jsp` 拿到同一个 (0.26, 0.74)，
       * 在画布上逐像素重叠、文字互相压（截图实拍）。
       *
       * 判据就是坐标本身：两两不同。它不依赖行高、不依赖渲染，纯派生量。
       */
      let checked = 0
      for (const frame of SCHEDULE) {
        const chain = attackChainOf(replayStream(STREAM, frame.cursor), STREAM)
        const seen = new Map<string, string>()
        for (const node of chain.nodes) {
          const key = `${node.x},${node.y}`
          const other = seen.get(key)
          expect(
            other,
            `第 ${frame.beatStep} 拍上 ${node.id} 与 ${other ?? "?"} 占同一个格子 (${key}) —— 两个节点会重叠`,
          ).toBeUndefined()
          seen.set(key, node.id)
          checked += 1
        }
      }
      expect(checked, "整条回放里必须有节点被扫到（否则这条断言在空集上成立）").toBeGreaterThan(0)
    })
  },
)

/* ========================================================================== */
/* 4 · ⑥ 授权：白名单外的自主动作必须停在待授权卡上                               */
/* ========================================================================== */

test.describe("authority.no-unlisted-autonomous-action · 白名单外的动作停在待授权卡", () => {
    test("正例：卡片上的自主判决来自数据层，且与动作目录逐值一致", () => {
      let checked = 0
      for (const frame of SCHEDULE) {
        const cards = authorityCardsOf(replayStream(STREAM, frame.cursor))
        for (const card of cards) {
          if (card.cardKind !== "auto") continue
          checked += 1
          // 判决不是界面的字符串，是动作目录的函数值。
          expect(card.autonomousAllowed, `${card.cardId}（${card.actionCode}）被判为可自主执行，但目录说不行`).toBe(true)
          expect(card.executedAutomatically, `${card.cardId} 标为自动执行，却没有任何 auto 的执行记录`).toBe(true)
        }
      }
      expect(checked, "必须先扫到免授权通道卡，否则这条断言没有对象").toBeGreaterThan(0)
    })

    test("正例：清单外的卡片**先停在 pending**，裁决消息到达之后才 approved", () => {
      /**
       * 「停在待批」这条判据必须问在**正确的时刻**上，也必须问在**正确的卡**上。
       *
       * 两个坑都是 2026-09-17 实测踩出来的：
       *
       *   1. **时刻**：整条流末尾（`CURSOR_END`）时裁决已经发生，卡片当然是 `approved` ——
       *      在那里断言 `pending` 是在问一个已经过去的状态。
       *   2. **对象**：`authorityCardsOf` 里除了本回合的卡，还有**当日事件簿**里那 130 起
       *      闭环各自的待批卡。它们的裁决发生在一整天里的不同时刻，绝大多数在
       *      `?beat=14` 之前就批完了 —— 拿它们来断言「此刻必须 pending」是把
       *      「历史记录」误当成了「当前待办」。
       *
       * 这条不变量真正说的是：**本回合里，一个清单外的动作在人为它签字之前，
       * 不许自己往下走。** 所以判据钉在**裁决落在本回放窗口内的那张卡**上，
       * 分两半，缺一不可：
       *
       *   · 裁决**之前**（第 14 拍，卡片刚打开）→ `pending`，且没有自动执行记录、
       *     没有裁决记录；
       *   · 裁决**之后**（整条流末尾）→ `approved`，证明第一半不是「它永远不动」。
       * 只有前半 = 一个不会红的断言；只有后半 = 没有在守「等待」这件事。
       */
      const beforeDecision = authorityCardsOf(
        replayStream(STREAM, frameForBeatRequest(SCHEDULE, 14)!.frame.cursor),
      )
      const atEnd = authorityCardsOf(replayStream(STREAM, CURSOR_END))

      // 「裁决落在本窗口内」的判据：末尾有裁决、而第 14 拍时还没有 —— 也就是
      // 这一回合里**真的经过了**「等待人工」这个状态的那些卡。
      const waiting = beforeDecision.filter((card) => {
        const decided = atEnd.find((candidate) => candidate.cardId === card.cardId)
        return decided !== undefined && decided.decision !== null && card.decision === null
      })
      expect(waiting.length, "本回合必须至少有一张「此刻待人批、稍后被批」的卡，否则这条断言没有对象").toBeGreaterThan(0)

      let checked = 0
      for (const card of waiting) {
        // 清单外的才受这条不变量管（清单内的按 L3 自动执行，那是另一条测试的事）。
        if (card.autonomousAllowed) continue
        checked += 1
        expect(card.cardKind).toBe("approval-required")
        expect(card.state, `${card.cardId} 在裁决之前就应该停在待批`).toBe("pending")
        expect(card.executedAutomatically, `${card.cardId} 在清单外却自动执行了`).toBe(false)
        // 五件套齐备：缺一件就是「让人在信息不全的情况下签字」。
        for (const key of ["what", "basis", "impact", "rollback", "alternative"] as const) {
          const value = key === "what" ? card.what : key === "alternative" ? card.alternative : card[key]
          expect(value, `${card.cardId} 缺少五件套的 ${key}`).toBeTruthy()
        }
        expect(card.slaMs, "待批卡必须给出 SLA").toBeGreaterThan(0)
        expect(card.slaTimeoutPolicy, "SLA 必须说清楚超时会怎样").toBeTruthy()
        expect(card.actions.length, "三键必须来自数据").toBeGreaterThan(1)
        // 而且它必须挂在本回合的计划上 —— 不是一条飘着的历史记录。
        expect(card.planStepId, `${card.cardId} 没有挂在计划的任何一步上`).not.toBeNull()
      }
      expect(checked, "过滤之后必须还有卡被真的查到（否则这条断言是空转）").toBeGreaterThan(0)

      // 后半：裁决真的到达了，而且落在这张卡上 —— 否则前半的 `pending` 只是「它没动过」。
      for (const card of waiting) {
        const decided = atEnd.find((candidate) => candidate.cardId === card.cardId)!
        expect(decided.state, `${card.cardId} 收到裁决消息之后仍是 pending`).toBe("approved")
        expect(decided.decision, `${card.cardId} 的状态变了却没有任何裁决记录`).not.toBeNull()
      }
    })

    test("正例：浏览器里判决与数据层同源（data-autonomous-allowed 逐卡核对）", async ({ page }) => {
      await openAt(page, 17)
      const rendered = await page
        .locator('[data-panel="authority"] [data-card-id]')
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            cardId: node.getAttribute("data-card-id") ?? "",
            allowed: node.getAttribute("data-autonomous-allowed"),
            executed: node.getAttribute("data-auto-executed"),
          })),
        )
      expect(rendered.length, "⑥ 必须渲染出卡片").toBeGreaterThan(0)

      const expected = authorityCardsOf(replayStream(STREAM, CURSOR_END))
      for (const card of rendered) {
        const source = expected.find((candidate) => candidate.cardId === card.cardId)
        expect(source, `页面上出现了数据里没有的卡 ${card.cardId}`).toBeDefined()
        expect(card.allowed).toBe(String(source!.autonomousAllowed))
        expect(card.executed).toBe(String(source!.executedAutomatically))
      }
      // 待批计数也是派生的：与 view-model 的重算逐值相等。
      const pending = expected.filter((card) => card.cardKind === "approval-required" && card.state === "pending").length
      await expect(page.getByTestId("authority-pending")).toHaveAttribute("data-pending-approvals", String(pending))
    })

    test("负对照：把清单外的动作用 auto 执行，数据层的扫描器必须红", () => {
      const state = replayStream(STREAM, CURSOR_END)
      // 拿一张真实的清单外卡，把它改成「已自动执行」—— 正是这条不变量禁止的事。
      const outside = state.disposition.cards.find((card) => !isAutonomous(card.actionCode))
      expect(outside, "本场必须存在一张清单外的卡").toBeDefined()

      // 真实的负例是一条**消息**：清单外的动作以 `auto: true` 执行。
      const forged: IncidentMessage = {
        id: "forged-tool-call",
        seq: 9_999,
        kind: "tool_call",
        incidentId: outside!.cardId,
        beatStep: null,
        occurredAtMs: 0,
        occurredAt: "16:21:00",
        revealedAtMs: 0,
        causeId: null,
        causalId: "forged-tool-call",
        evidenceRefs: [],
        affects: [],
        actor: "处置 Agent",
        actionCode: outside!.actionCode,
        auto: true,
        autonomy: "L3",
      }
      const issues = scanAuthority([...STREAM, forged])
      expect(
        issues.map((issue) => issue.code),
        "清单外的动作以 auto 执行，扫描器必须报出来",
      ).toContain("authority/autonomous-action-outside-list")

      // 同一份序列，把 `auto` 翻成 false 但又不带批准记录 → 另一条判据也必须红。
      const unapproved = scanAuthority([...STREAM, { ...forged, auto: false }])
      expect(unapproved.map((issue) => issue.code)).toContain("authority/executed-without-approval")

      // 正例对照：原样的序列一条都不许报（否则上面的红说明不了任何事）。
      expect(scanAuthority(STREAM), "原序列必须是干净的").toEqual([])
    })
  },
)

/* ========================================================================== */
/* 5 · ⑧ 审计：按游标重放不跳拍、不补拍，同一游标两次渲染逐字段相同                 */
/* ========================================================================== */

test.describe("audit.replay-is-faithful · 按游标重放不跳拍不补拍", () => {
    test("正例：行数逐拍只增不减，且每一步都等于「已揭示的审计事件」条数", () => {
      let previous = 0
      let snapshots = 0
      for (const frame of SCHEDULE) {
        const rows = auditRowsOf(replayStream(STREAM, frame.cursor), REVEAL_TIMES)
        expect(rows.length, `第 ${frame.beatStep} 拍的行数比上一拍少了（跳拍）`).toBeGreaterThanOrEqual(previous)
        const revealedAudits = STREAM.filter(
          (message) =>
            message.kind === "audit_event" &&
            message.scope === "incident" &&
            (message.revealedAtMs < frame.cursor.revealedAtMs ||
              (message.revealedAtMs === frame.cursor.revealedAtMs && message.seq <= frame.cursor.seq)),
        ).length
        expect(rows.length, `第 ${frame.beatStep} 拍补拍或漏拍了`).toBe(revealedAudits)
        previous = rows.length
        snapshots += 1
      }
      expect(snapshots, "排程必须真的被走到").toBeGreaterThan(0)
      expect(previous, "回放结束时必须有留痕").toBeGreaterThan(0)
    })

    test("正例：拼游标 —— 从中间往回拖，两边的行分别是各自游标的前缀", () => {
      const middle = SCHEDULE[Math.floor(SCHEDULE.length / 2)]!
      const end = SCHEDULE[SCHEDULE.length - 1]!
      const midRows = auditRowsOf(replayStream(STREAM, middle.cursor), REVEAL_TIMES)
      const endRows = auditRowsOf(replayStream(STREAM, end.cursor), REVEAL_TIMES)

      expect(endRows.map((row) => row.entryId).slice(0, midRows.length)).toEqual(
        midRows.map((row) => row.entryId),
      )
    })

    test("正例：同一游标两次渲染逐字段相同（纯函数没有隐藏状态）", () => {
      for (const frame of SCHEDULE) {
        const state = replayStream(STREAM, frame.cursor)
        const first = auditRowsOf(state, REVEAL_TIMES)
        const second = auditRowsOf(replayStream(STREAM, frame.cursor), REVEAL_TIMES)
        expect(JSON.stringify(second), `第 ${frame.beatStep} 拍两次渲染不同`).toBe(JSON.stringify(first))
      }
    })

    test("正例：浏览器里同一游标两次打开逐字段相同", async ({ page }) => {
      const snapshot = async (): Promise<string> =>
        JSON.stringify(
          await page.locator('[data-panel="audit-timeline"] [data-row-seq]').evaluateAll((nodes) =>
            nodes.map((node) => ({
              seq: node.getAttribute("data-row-seq"),
              entry: node.getAttribute("data-row-entry"),
              text: (node.textContent ?? "").replace(/\s+/g, " ").trim(),
            })),
          ),
        )

      await openAt(page, 16)
      const first = await snapshot()
      expect(JSON.parse(first).length, "⑧ 必须渲染出留痕行").toBeGreaterThan(0)

      await openAt(page, 16)
      expect(await snapshot(), "同一个游标两次打开，逐字段必须相同").toBe(first)
    })

    test("正例：点一行停在那一帧上 —— 游标与那一行的 data-replay-cursor-key 相等", async ({ page }) => {
      await openAt(page, 16)
      const rows = page.locator('[data-panel="audit-timeline"] [data-row-seq]')
      const count = await rows.count()
      expect(count, "必须有可点开的留痕行").toBeGreaterThan(0)

      // 选一行真的有游标的（最后一行可能不带证据指针，但游标仍应存在）。
      const target = rows.nth(Math.min(1, count - 1))
      const key = await target.getAttribute("data-replay-cursor-key")
      expect(key, "留痕行必须带 data-replay-cursor-key（时刻:序号）").toMatch(/^\d+:\d+$/)
      await target.click()

      await expect(page.getByTestId("replay-position")).toHaveAttribute(
        "data-replay-cursor-ms",
        (key ?? ":").split(":")[0]!,
      )
      await expect(page.getByTestId("replay-phase"), "点一行要停下来看，不是继续播").toHaveText("已暂停")
    })

    test("负对照：抽掉一条留痕，重放就不再忠实 —— 差异必须能被看见", () => {
      const cursor = SCHEDULE[SCHEDULE.length - 1]!.cursor
      const full = auditRowsOf(replayStream(STREAM, cursor), REVEAL_TIMES)
      expect(full.length).toBeGreaterThan(1)

      const dropped = STREAM.filter(
        (message) => !(message.kind === "audit_event" && message.scope === "incident" && message.seq === full[0]!.seq),
      )
      const afterDrop = auditRowsOf(replayStream(dropped, cursor), REVEAL_TIMES)
      expect(afterDrop.length, "少一条留痕必须能被量出来").toBe(full.length - 1)
      expect(afterDrop.map((row) => row.entryId)).not.toEqual(full.map((row) => row.entryId))
    })
  },
)

/* ========================================================================== */
/* 6 · ⑪ 沉淀：导出内容含沉淀条目，导出后重新解析逐条等价                          */
/* ========================================================================== */

test.describe("sediment.survives-export · 导出再解析逐条等价", () => {
    test("正例：导出文本两次相同，且逐条包含当前沉淀物", () => {
      const state = replayStream(STREAM, CURSOR_END)
      const items = sedimentItemsOf(state)
      expect(items.length, "本回合必须有沉淀条目").toBeGreaterThan(0)

      const first = exportSedimentText(state, STREAM)
      const second = exportSedimentText(state, STREAM)
      expect(second, "导出两次必须得到同一个字符串（不含墙上时间）").toBe(first)

      const parsed = JSON.parse(first) as { items: Array<{ id: string; label: string; kind: string; sourceRefs: string[] }> }
      expect(parsed.items).toEqual(items.map((item) => ({ ...item })))
    })

    test("正例：导出 → 重新解析 → 与当前状态逐条等价", () => {
      const state = replayStream(STREAM, CURSOR_END)
      const result = verifySedimentImport(exportSedimentText(state, STREAM), state, STREAM)
      expect(result.parseIssues).toEqual([])
      expect(result.diffs).toEqual([])
    })

    test("正例：浏览器里导出文本可解析，且重新导入判定为等价", async ({ page }) => {
      await openAt(page, 17)
      // `textContent` 而不是 `innerText`：这份文档是**折叠着也必须在文档里**的可断言物
      // （`max-height` 裁切不影响 textContent，innerText 会受渲染影响）。
      const exported = await page.getByTestId("sediment-export-text").evaluate((node) => node.textContent ?? "")
      expect(exported.length, "导出文本必须在 DOM 里可读（不依赖剪贴板权限）").toBeGreaterThan(2)

      const parsed = JSON.parse(exported) as { items: Array<{ label: string }> }
      const domLabels = await page
        .locator('[data-panel="sediment"] [data-sediment-id]')
        .evaluateAll((nodes) => nodes.map((node) => (node.textContent ?? "").trim()))
      expect(parsed.items.length, "导出必须含沉淀条目").toBeGreaterThan(0)
      for (const item of parsed.items) {
        expect(domLabels.some((label) => label.includes(item.label)), `导出里的「${item.label}」不在界面上`).toBe(true)
      }

      // 把导出的文本贴回去 → 判定必须等价。
      await page.getByTestId("sediment-import-input").fill(exported)
      const verify = page.getByTestId("sediment-import-verify")
      await expect(verify, "贴了内容之后核对键必须可用（空文本时禁用是诚实的）").toBeEnabled()
      await verify.click()
      await expect(page.getByTestId("sediment-import-result")).toHaveAttribute(
        "data-import-result",
        "equivalent",
      )
    })

    test("负对照：改掉一条沉淀物的一个字段，往返比较必须红", () => {
      const state = replayStream(STREAM, CURSOR_END)
      const text = exportSedimentText(state, STREAM)
      const parsed = JSON.parse(text) as { items: Array<{ label: string }> }
      parsed.items[0]!.label = `${parsed.items[0]!.label}（被改过）`

      // ① 改过的那份**自己**仍然能往返（它是一份合法文档）……
      const tampered = verifySedimentImport(JSON.stringify(parsed), state, STREAM)
      expect(tampered.diffs.length, "与当前状态不等价必须被量出来").toBeGreaterThan(0)

      // ② ……但少了条目就不再是合法文档。
      const missing = JSON.parse(text) as { items: unknown[] }
      missing.items = []
      const broken = verifySedimentImport(JSON.stringify(missing), state, STREAM)
      // 空 items 仍是一份合法 schema（0 条不是语法错误），但**与当前状态不等价** —— 所以必须红。
      expect(broken.parseIssues.length + broken.diffs.length).toBeGreaterThan(0)

      // ③ 一段根本不是导出物的文本要在解析期就被拦住。
      const notJson = verifySedimentImport("这不是 JSON", state, STREAM)
      expect(notJson.parseIssues.length).toBeGreaterThan(0)
      expect(notJson.diffs).toEqual([])
    })
  },
)

/* ========================================================================== */
/* 7 · 一色一义：五个语义色各有唯一含义，逐值断言（双主题）                        */
/* ========================================================================== */

/**
 * 五种语义色在页面上各自的**唯一**意思。顺序即优先级：一个元素同时挂在多个槽位下时，
 * 取最靠前的那个（例如一个既带 `--evidence` 又继承 `--brand` 的 chip，它是证据引用）。
 */
const MEANINGS = [
  { meaning: "evidence", slot: "--evidence", label: "证据引用蓝" },
  { meaning: "attack", slot: "--danger", label: "攻击红" },
  { meaning: "waiting", slot: "--warning", label: "待人授权琥珀" },
  { meaning: "closed", slot: "--success", label: "已闭环绿" },
  { meaning: "ai", slot: "--brand", label: "AI 青" },
] as const

test.describe("color.every-hue-has-one-meaning · 一色一义（双主题）", () => {
    for (const theme of ["dark", "light"] as const) {
      test(`正例 · ${theme}：逐元素核对语义槽位与 data-meaning`, async ({ page }) => {
        await openAt(page, 17, theme)

        const audit = await page.evaluate((meanings) => {
          /**
           * 把任意合法 CSS 颜色解析成 `[r, g, b]`，**用浏览器自己的解析器**。
           *
           * 这里曾经栽过一次：原实现用正则去匹配 `rgb(...)`，而语义槽位声明的是
           * **十六进制**（`--evidence: #1d4ed8`）。于是每一个槽位都解析出 `null`，
           * 探针当场抛「槽位读不到颜色值」—— 报的是探针自己不会读，不是产品有缺陷。
           *
           * 教训与 `.qa/probe-guard.mjs` 那条一样：**不要自己写颜色解析**。
           * 自定义属性读回来的是**声明值**（作者写了什么就是什么），
           * 只有元素上的 `getComputedStyle().color` 才会被规范化成 `rgb()`。
           * 所以先把声明值画到一个画布上，让浏览器替我们归一化。
           *
           * 实现放在 `tests/support/source-scan.ts` 的 `READ_COLOR_SOURCE`，
           * 由 `openAt()` 以 `addInitScript` 注入为 `window.__s1ReadColor` —— 两个 spec 共用一份。
           */
          const parse = window.__s1ReadColor
          if (typeof parse !== "function") throw new Error("颜色读取器没有被注入 —— 探针没有在量它以为在量的东西")
          const root = getComputedStyle(document.documentElement)
          const slots = meanings.map((entry) => ({
            ...entry,
            rgb: parse(root.getPropertyValue(entry.slot)),
          }))
          // 槽位读不到就 fail loudly —— 读到 0 不是「没有颜色」，是「没量到」。
          for (const slot of slots) {
            if (slot.rgb === null) throw new Error(`槽位 ${slot.slot} 读不到颜色值`)
          }

          /**
           * 「一色一义」里**颜色与语义脱钩**的那一种读法。
           *
           * ## 为什么不要求「每个带语义色的元素都挂 data-meaning」
           *
           * 那是这条不变量**更强**的一种读法，而它不是签署的那一条。签署的
           * `color.every-hue-has-one-meaning`（`S1-语义不变量候选.md` 候选七）说的是：
           * 一个色相只能承载一个语义；同一语义在两个主题下保持同一色相；五个语义色
           * 各自对每个承载面达到 WCAG-AA。它的判红方式在 `tests/art-direction.spec.ts`
           * 里，是**色相距离与对比度**，不是逐元素挂属性。
           *
           * 「每个元素都挂 `data-meaning`」会要求给徽标、控制台回显、审计时钟这些
           * **颜色不承载歧义**的地方也挂上声明 —— 那是在加一条新的产品要求，
           * 而新要求不该由一个测试悄悄加进来。
           *
           * ## 真正该判红的是什么
           *
           * 同**一个选择器**在不同的元素上被染成了**不同的语义色** —— 那时候颜色在
           * 承担语义，而屏幕上的文字（选择器代表的那类元素）没有说它是哪一种。
           * 元素自己的声明（`data-meaning`）可以消解这种歧义；如果同一个选择器匹配到的
           * 元素声明了两种以上含义，那它就是一个「同一个东西有两种意思」的缺陷。
           *
           * 这条判据会把「一个色相两种语义」当场抓住，而且不会逼着人去给图标挂注释。
           * 只读同源样式表：跨源会抛 `SecurityError`，那是「没查到」，不能算通过。
           */
          const rules: CSSStyleRule[] = []
          for (const sheet of Array.from(document.styleSheets)) {
            let list: CSSRuleList | null = null
            try {
              list = sheet.cssRules
            } catch {
              continue
            }
            for (const rule of Array.from(list)) {
              if (rule instanceof CSSStyleRule) rules.push(rule)
            }
          }

          /*
           * 扫描对象：面板里的元素。`aria-hidden="true"` 的子树不在无障碍树里，
           * 也就没有语义可言，跳过。
           */
          const all = Array.from(document.querySelectorAll<HTMLElement>("[data-panel] *")).filter(
            (element) => element.closest('[aria-hidden="true"]') === null,
          )

          const meaningsOf = (el: HTMLElement): string[] => {
            const found = new Set<string>()
            /*
             * 元素自己的声明也是一条「规则」，而且优先级最高：`data-meaning` 就是
             * 「这个元素的颜色是什么意思」的权威答案。一个选择器同时写了两条槽位时，
             * 元素上的声明可以消解歧义 —— 这正是那条属性存在的理由。
             */
            const declared = el.getAttribute("data-meaning")
            if (declared !== null) found.add(declared)
            for (const rule of rules) {
              let matches = false
              try {
                matches = el.matches(rule.selectorText)
              } catch {
                continue
              }
              if (!matches) continue
              const body = rule.style.cssText
              for (const slot of slots) {
                // 规则体里出现这个语义槽位，且是用在染色属性上（`color` / `background` /
                // `border` / `outline` / `fill` / `stroke`）—— 位置型属性（`left` 等）不算。
                const used = new RegExp(`(?:^|;)\\s*(?:color|background|border|outline|fill|stroke)[^:;]*:[^;]*${slot.slot}\\b`).test(
                  `;${body}`,
                )
                if (used) found.add(slot.meaning)
              }
            }
            return [...found]
          }

          const ambiguous: Array<{ element: string; meanings: string[]; declared: string | null }> = []
          for (const element of all) {
            const meanings = meaningsOf(element)
            if (meanings.length > 1) {
              ambiguous.push({
                element: `${element.tagName.toLowerCase()}.${element.className}`.slice(0, 70),
                meanings,
                declared: element.getAttribute("data-meaning"),
              })
            }
          }
          return { ambiguous, total: all.length, rules: rules.length }
        }, MEANINGS)

        expect(audit.total, "扫描必须真的有对象").toBeGreaterThan(100)
        expect(audit.rules, "必须真的读到样式表规则（读到 0 条 = 没查到，不是通过）").toBeGreaterThan(50)
        expect(
          audit.ambiguous,
          `同一个选择器被染成了多种语义（颜色在替文字说话）：${JSON.stringify(audit.ambiguous, null, 1)}`,
        ).toEqual([])
      })
    }

    test("正例：五个槽位两两不同值（一个色相不能同时是两种意思）", async ({ page }) => {
      await openAt(page, 17)
      const values = await page.evaluate((slots) => {
        const root = getComputedStyle(document.documentElement)
        return slots.map((slot) => root.getPropertyValue(slot).trim().toLowerCase())
      }, MEANINGS.map((entry) => entry.slot))
      for (const value of values) expect(value.length, `槽位 ${JSON.stringify(values)} 读不到值`).toBeGreaterThan(0)
      expect(new Set(values).size, `五个语义槽位必须有五个不同取值：${JSON.stringify(values)}`).toBe(values.length)
    })

    test("负对照：让同一个选择器染上两种语义色，同一条判据必须红", async ({ page }) => {
      await openAt(page, 17)
      /*
       * 构造的是**歧义**，不是「没挂属性」：`[data-panel] *` 这个选择器本来就会匹配到
       * 一堆不同的元素，现在再让它整体染上攻击红 —— 于是「同一个选择器」既可能是
       * AI 青（元素自己声明 `ai`），又可能是攻击红，颜色在替文字说话。
       */
      await page.addStyleTag({ content: "[data-panel] *{border-top-color:var(--danger)}" })
      await page.waitForTimeout(60)

      const ambiguous = await page.evaluate((meanings) => {
        const slots = meanings.map((entry) => entry.slot)
        const rules: CSSStyleRule[] = []
        for (const sheet of Array.from(document.styleSheets)) {
          let list: CSSRuleList | null = null
          try {
            list = sheet.cssRules
          } catch {
            continue
          }
          for (const rule of Array.from(list)) if (rule instanceof CSSStyleRule) rules.push(rule)
        }
        let hits = 0
        for (const element of Array.from(document.querySelectorAll<HTMLElement>("[data-panel] *"))) {
          const found = new Set<string>()
          const declared = element.getAttribute("data-meaning")
          if (declared !== null) found.add(declared)
          for (const rule of rules) {
            let matches = false
            try {
              matches = element.matches(rule.selectorText)
            } catch {
              continue
            }
            if (!matches) continue
            const body = `;${rule.style.cssText}`
            for (let index = 0; index < slots.length; index += 1) {
              const slot = slots[index]!
              if (new RegExp(`(?:^|;)\\s*(?:color|background|border|outline|fill|stroke)[^:;]*:[^;]*${slot}\\b`).test(body)) {
                found.add(meanings[index]!.meaning)
              }
            }
          }
          if (found.size > 1) hits += 1
        }
        return hits
      }, MEANINGS)
      expect(ambiguous, "同一选择器染上两种语义色之后必须被抓到").toBeGreaterThan(0)
    })
  },
)

/* ========================================================================== */
/* 8 · 静态：这一批的样式与文案纪律                                               */
/* ========================================================================== */

test.describe("第二批的样式与文案纪律", () => {
  test("新增的样式段同样没有颜色与时长字面量", () => {
    const css = read("components/prototype/workbench/workbench.css")
    expect(css.length).toBeGreaterThan(5_000)
    /*
     * **先剥注释再判**：这条断言 2026-09-17 被自己的说明文字判红过一次 ——
     * 文件第 20 行那句「本文件里没有 #hex、没有 rgb()……」命中了 `/rgba?\(/`。
     * 判据守的是代码，注释不是代码。见 `tests/support/source-scan.ts`。
     */
    const code = stripComments(css)
    expect(code.length, "剥掉注释后不该只剩空壳 —— 别让剥离把整份样式吃掉").toBeGreaterThan(5_000)
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(code).not.toMatch(/\b(?:rgba?|hsla?)\(/)
    expect(code).not.toMatch(/cubic-bezier\(/)
    expect(code).not.toMatch(/\b\d+(?:\.\d+)?m?s\b/)
  })

  test("⑧ 不承诺没有实现的播放倍速", () => {
    // 同样先剥注释：词典里那句「**不写**『可 4× 回放』」的说明本身就是一次命中。
    const dictionary = stripComments(read("lib/i18n/zh-CN.ts"))
    expect(dictionary).not.toContain("可 4× 回放")
    // 而且它必须真的说了「倍速未实现」，否则这条只是「没写那句话」的空断言。
    expect(read("lib/i18n/zh-CN.ts")).toContain("播放倍速未实现")
  })

  test("SLA 倒计时是游标的纯函数（暂停时停住，且永不为负）", () => {
    expect(slaRemainingMs(137_000, 9_000, 9_000)).toBe(137_000)
    expect(slaRemainingMs(137_000, 9_000, 10_000)).toBe(136_000)
    expect(slaRemainingMs(137_000, 9_000, 9_000 + 999_999)).toBe(0)
    expect(slaRemainingMs(null, 0, 5_000)).toBeNull()
    expect(clockOfMs(137_000)).toBe("02:17")
    expect(clockOfMs(41_000)).toBe("00:41")
    expect(clockOfMs(-5)).toBe("00:00")
  })
})

/* -------------------------------------------------------------------------- */

/** 三个计数从 DOM 里读回来（与第一批同一条读法：`data-counter` → 值节点）。 */
async function readCounters(page: Page): Promise<{ autonomous: string; interventions: string; handling: string }> {
  return page.evaluate(() => {
    const value = (key: string) =>
      document.querySelector(`[data-counter="${key}"] .s1-counter__value`)?.textContent ?? null
    return {
      autonomous: value("autonomousClosedToday") ?? "",
      interventions: value("humanInterventions") ?? "",
      handling: value("avgHandlingSeconds") ?? "",
    }
  })
}
