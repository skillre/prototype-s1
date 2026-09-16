import { expect, test } from "@playwright/test"
import type { BrowserContext, Page } from "@playwright/test"

import {
  CONTENT_VISIBLE_PROBE,
  DOM_SEMANTIC_COUNT,
  INVISIBLE_SEMANTICS_VIOLATIONS,
  LAYOUT_PROBE,
} from "../.qa/probes.mjs"
import { ProbeError, expectRatio, measure } from "../.qa/probe-guard.mjs"
import { accessibilityRoleCounts } from "../.qa/ax-tree.mjs"

/**
 * Shapes returned by the probes in `.qa/probes.mjs`.
 *
 * The probes are plain `.mjs` (they must run in a page context), so their
 * results arrive untyped. These interfaces declare what the tests rely on —
 * narrow on purpose: if a probe stops returning a field, the test fails to
 * compile rather than reading `undefined` and passing.
 */
interface LayoutProbeResult {
  innerWidth: number
  clientWidth: number
  scrollWidth: number
  bodyScrollWidth: number
}
interface ContentProbeResult {
  height: number
  textLength: number
  fadedRoots: number
}
interface SemanticsViolation {
  tag: string
  testid: string | null
  interactive: number
}

/**
 * Tests for the QA probes themselves.
 *
 * These do not test the application; they test the *detectors*. A QA sweep is
 * only worth its output if its probes actually fire on the defects they claim to
 * catch, and the defects in this file are the ones that were observed in
 * production runs — silently passing, or reporting a mismatch that came from the
 * probe rather than the product.
 *
 * Each detector is therefore checked twice: it must fire on a page that has the
 * defect, and stay quiet on a page that does not.
 */

/* -------------------------------------------------------------------------- */
/* §11 — probe integrity                                                       */
/* -------------------------------------------------------------------------- */

test.describe("numeric probe guard", () => {
  test("returns a finite measurement", async () => {
    await expect(measure("t", "ok", () => 42)).resolves.toBe(42)
  })

  test("rejects NaN, Infinity, non-numbers, and unexplained zero", async () => {
    await expect(measure("t", "nan", () => Number.NaN)).rejects.toThrow(ProbeError)
    await expect(measure("t", "inf", () => Number.POSITIVE_INFINITY)).rejects.toThrow(ProbeError)
    await expect(
      measure("t", "string", () => "12" as unknown as number),
    ).rejects.toThrow(ProbeError)
    await expect(
      measure("t", "undefined", () => undefined as unknown as number),
    ).rejects.toThrow(ProbeError)
    await expect(measure("t", "zero", () => 0)).rejects.toThrow(ProbeError)
  })

  test("allows an explicit zero only when the caller says zero is valid", async () => {
    await expect(measure("t", "zero", () => 0, { allowZero: true })).resolves.toBe(0)
  })

  test("turns a throwing selector lookup into a labelled failure", async () => {
    await expect(
      measure("t", "missing", () => {
        throw new Error("selector not found")
      }),
    ).rejects.toThrow(/无法测量/)
  })

  test("catches the exact false-green this guard exists for", async () => {
    // The original bug, reproduced. A probe measured nothing (0), divided by
    // nothing, and the *naive* assertion passed — because every comparison
    // against NaN is false. QA reported green; the feature was never verified.
    const falseGreen = Math.abs(Number.NaN - 1.5) > 0.02
    expect(falseGreen, "裸比较确实会静默通过——这正是问题所在").toBe(false)

    // The guard turns that same situation into a loud failure.
    await expect(
      expectRatio("t", "scale", () => Number.NaN, 1.5, 0.02),
    ).rejects.toThrow(ProbeError)
    await expect(
      expectRatio("t", "resolved-to-nothing", () => 0 / 0, 1.5, 0.02),
    ).rejects.toThrow(/非有限值/)
  })

  test("accepts a measurement inside tolerance and rejects one outside", async () => {
    await expect(expectRatio("t", "in-band", () => 1.5, 1.5, 0.02)).resolves.toBe(1.5)
    await expect(expectRatio("t", "out-of-band", () => 1.9, 1.5, 0.02)).rejects.toThrow(/偏差/)
  })
})

/* -------------------------------------------------------------------------- */
/* §9 — three independent mobile criteria                                      */
/* -------------------------------------------------------------------------- */

test.describe("mobile layout criteria", () => {
  test("detects horizontal overflow that fits the naive metric too", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.setContent(
      `<style>body{margin:0}#wide{width:2000px;height:40px;background:#333}</style><div id="wide"></div>`,
    )
    const layout = (await page.evaluate(LAYOUT_PROBE)) as LayoutProbeResult
    expect(layout.scrollWidth - 390, "scrollWidth 判据应当命中").toBeGreaterThan(1)

    const scrollX = await page.evaluate(() => {
      window.scrollTo(9999, 0)
      return window.scrollX
    })
    expect(scrollX, "scrollX 判据应当命中——页面确实可以横向平移").toBeGreaterThan(1)
  })

  test("stays quiet on a page that does not overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.setContent(
      `<style>body{margin:0}div{width:100%}</style><div>fits</div>`,
    )
    const layout = (await page.evaluate(LAYOUT_PROBE)) as LayoutProbeResult
    expect(layout.scrollWidth - 390).toBeLessThanOrEqual(1)
    const scrollX = await page.evaluate(() => {
      window.scrollTo(9999, 0)
      return window.scrollX
    })
    expect(Math.abs(scrollX)).toBeLessThanOrEqual(1)
  })

  test("catches viewport expansion, which the naive metric reports as clean", async ({
    browser,
  }) => {
    // THE false green. A mobile-emulated page with no viewport meta gets a
    // layout viewport far wider than the device. `scrollWidth - innerWidth` is
    // then ZERO — "no overflow" — while every element is laid out for a screen
    // the user does not have. Only comparing innerWidth against the *requested*
    // width catches it.
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
    })
    const page = await context.newPage()
    try {
      await page.setContent(`<style>body{margin:0}main{padding:8px}</style><main>content</main>`)
      const layout = (await page.evaluate(LAYOUT_PROBE)) as LayoutProbeResult

      const naiveDelta = layout.scrollWidth - layout.innerWidth
      expect(
        Math.abs(naiveDelta),
        "裸判据（scrollWidth - innerWidth）在这类页面上接近 0，会假绿",
      ).toBeLessThanOrEqual(1)

      const expansion = layout.innerWidth - 390
      expect(expansion, "innerWidth 判据必须命中：布局视口被扩张了").toBeGreaterThan(1)
    } finally {
      await context.close()
    }
  })

  test("catches content that is present but invisible by default", async ({ page }) => {
    await page.setContent(
      `<main><div style="opacity:0">这段内容永远不可见</div></main>`,
    )
    const state = (await page.evaluate(CONTENT_VISIBLE_PROBE)) as ContentProbeResult
    expect(state.fadedRoots, "opacity:0 的内容区块应当被发现").toBeGreaterThan(0)

    await page.setContent(`<main><div>可见内容</div></main>`)
    const healthy = (await page.evaluate(CONTENT_VISIBLE_PROBE)) as ContentProbeResult
    expect(healthy.fadedRoots).toBe(0)
    expect(healthy.textLength).toBeGreaterThan(0)
  })
})

/* -------------------------------------------------------------------------- */
/* §10 — No Invisible Semantics                                                */
/* -------------------------------------------------------------------------- */

async function axRoleCount(context: BrowserContext, page: Page, role: string) {
  const session = await context.newCDPSession(page)
  try {
    const counts = await accessibilityRoleCounts(session)
    return counts.get(role) ?? 0
  } finally {
    await session.detach()
  }
}

const axButtonCount = (context: BrowserContext, page: Page) => axRoleCount(context, page, "button")
const axHeadingCount = (context: BrowserContext, page: Page) => axRoleCount(context, page, "heading")

test.describe("No Invisible Semantics", () => {
  test("an aria-hidden ancestor prunes interactive content from both counts", async ({
    context,
    page,
  }) => {
    await page.setContent(`
      <main>
        <button>visible one</button>
        <div aria-hidden="true"><button>pruned</button></div>
      </main>
    `)

    const domCount = await page.evaluate(DOM_SEMANTIC_COUNT("button, [role=button]"))
    const axCount = await axButtonCount(context, page)

    expect(domCount, "DOM 侧应排除被 aria-hidden 剪掉的按钮").toBe(1)
    expect(axCount, "无障碍树侧应一致").toBe(1)
    expect(domCount).toBe(axCount)
  })

  test("the DOM and accessibility tree agree when nothing is pruned", async ({
    context,
    page,
  }) => {
    await page.setContent(`
      <main>
        <button>one</button>
        <button>two</button>
        <div role="button" tabindex="0">three</div>
      </main>
    `)
    const domCount = await page.evaluate(DOM_SEMANTIC_COUNT("button, [role=button]"))
    const axCount = await axButtonCount(context, page)
    expect(domCount).toBe(3)
    expect(axCount).toBe(3)
  })

  test("role='presentation' follows the browser, not the spec on paper", async ({
    context,
    page,
  }) => {
    // Verified against Chromium before being encoded here:
    //   <button role="presentation">  → still exposes role=button
    //   <a href role="presentation">  → still exposes role=link
    //   <h2 role="presentation">      → heading removed
    //   <div role="presentation"><button>… → the child button is untouched
    // ARIA says presentation is ignored on elements whose native role cannot be
    // overridden. Modelling it uniformly makes the probe disagree with the
    // browser in one direction or the other, producing false mismatches.
    await page.setContent(`
      <main>
        <button role="presentation">strong native role survives</button>
        <button>real</button>
        <div role="presentation"><button>child keeps its semantics</button></div>
        <h2 role="presentation">heading removed</h2>
        <h2>heading kept</h2>
      </main>
    `)

    const domButtons = await page.evaluate(DOM_SEMANTIC_COUNT("button, [role=button]"))
    const axButtons = await axButtonCount(context, page)
    expect(domButtons, "强原生语义上的 presentation 被浏览器忽略，按钮仍然计入").toBe(3)
    expect(axButtons).toBe(3)

    const domHeadings = await page.evaluate(DOM_SEMANTIC_COUNT("h1, h2, h3, h4, h5, h6, [role=heading]"))
    const axHeadings = await axHeadingCount(context, page)
    expect(domHeadings, "heading 的 presentation 生效，只剩一个").toBe(1)
    expect(axHeadings).toBe(1)
  })

  test("display:none and inert subtrees are excluded from both counts", async ({
    context,
    page,
  }) => {
    await page.setContent(`
      <main>
        <button>visible</button>
        <div style="display:none"><button>hidden</button></div>
        <div inert><button>inert</button></div>
      </main>
    `)
    const domCount = await page.evaluate(DOM_SEMANTIC_COUNT("button, [role=button]"))
    const axCount = await axButtonCount(context, page)
    expect(domCount).toBe(1)
    expect(axCount).toBe(1)
  })

  test("flags an aria-hidden host that still contains focusable content", async ({ page }) => {
    await page.setContent(`
      <div data-testid="reveal-layer" aria-hidden="true">
        <button>查看该科目明细</button>
      </div>
    `)
    const violations = (await page.evaluate(INVISIBLE_SEMANTICS_VIOLATIONS)) as SemanticsViolation[]
    expect(violations).toHaveLength(1)
    expect(violations[0].testid).toBe("reveal-layer")
    expect(violations[0].interactive).toBe(1)
  })

  test("does not flag a purely decorative aria-hidden host", async ({ page }) => {
    await page.setContent(`
      <div aria-hidden="true"><span></span><svg><circle /></svg></div>
      <div aria-hidden="true"><p>纯装饰文案</p></div>
    `)
    const violations = (await page.evaluate(INVISIBLE_SEMANTICS_VIOLATIONS)) as SemanticsViolation[]
    expect(violations, "装饰性元素允许 aria-hidden").toEqual([])
  })

  test("sees through shadow DOM, where a shallow query cannot", async ({ context, page }) => {
    // The mismatch that made every route fail on the first sweep. The
    // accessibility tree includes shadow content; `document.querySelectorAll`
    // does not. A probe that only queried the light DOM reported a permanent
    // off-by-one that had nothing to do with the application.
    await page.setContent(`
      <main><button>light</button><div id="host"></div></main>
      <script>
        const root = document.getElementById('host').attachShadow({ mode: 'open' });
        root.innerHTML = '<button>shadow</button>';
      </script>
    `)
    const domCount = await page.evaluate(DOM_SEMANTIC_COUNT("button, [role=button]"))
    const axCount = await axButtonCount(context, page)
    expect(domCount, "影子树里的按钮也必须被数到").toBe(2)
    expect(axCount).toBe(2)
  })
})
