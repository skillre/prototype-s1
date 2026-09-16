import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  STYLE_PRESENCE_CHANNELS,
  STYLE_PRESENCE_PROBE,
  StylePresenceError,
  UA_BASELINE_DOCUMENT,
  assertBaselineIsUnstyled,
  compareStylePresence,
  describeStylePresence,
} from "../.qa/style-presence.mjs"

/**
 * Tests for the style-presence detector (Factory v1.2 · N3).
 *
 * Same contract as `tests/qa-probes.spec.ts`: these do not test the application,
 * they test the thing that claims to detect a defect. The defect here is a page
 * that is in the browser's default state — no stylesheet reached it — while
 * every other check in the Factory is green.
 *
 * Each property is therefore pinned twice: it must fire on a page that has the
 * defect, and stay quiet on a page that does not.
 */

const styled = (body: string) => `<!doctype html><html><head><meta charset="utf-8">
<style>
  body { margin: 0; font-family: "Helvetica Neue", Helvetica, sans-serif; background-color: rgb(250, 250, 250); color: rgb(17, 17, 17); }
</style></head><body>${body}</body></html>`

const partiallyStyled = (body: string) => `<!doctype html><html><head><meta charset="utf-8">
<style>
  body { margin: 0; font-family: "Georgia", serif; }
</style></head><body>${body}</body></html>`

const oneChannelStyled = (body: string) => `<!doctype html><html><head><meta charset="utf-8">
<style>
  body { margin: 0; }
</style></head><body>${body}</body></html>`

/** Shape returned by `STYLE_PRESENCE_PROBE`. */
interface StyleSample {
  bodyMarginTop: number
  bodyMarginLeft: number
  bodyFontFamily: string
  bodyBackgroundColor: string
  bodyColor: string
  contentTag: string
  contentColor: string
  contentFontFamily: string
}

async function sample(page: Page, html: string): Promise<StyleSample> {
  await page.setContent(html)
  return (await page.evaluate(STYLE_PRESENCE_PROBE)) as StyleSample
}

/** A synthetic sample with every field present, for the unit-level checks. */
const sampleOf = (overrides: Record<string, unknown> = {}) => ({
  bodyMarginTop: 0,
  bodyMarginLeft: 0,
  bodyFontFamily: "Geist, sans-serif",
  bodyBackgroundColor: "rgb(255, 255, 255)",
  bodyColor: "rgb(10, 10, 10)",
  contentTag: "main",
  contentColor: "rgb(10, 10, 10)",
  contentFontFamily: "Geist, sans-serif",
  ...overrides,
})

const uaSample = () =>
  sampleOf({
    bodyMarginTop: 8,
    bodyMarginLeft: 8,
    bodyFontFamily: "Times",
    bodyBackgroundColor: "rgba(0, 0, 0, 0)",
    bodyColor: "rgb(0, 0, 0)",
    contentTag: "body",
    contentColor: "rgb(0, 0, 0)",
    contentFontFamily: "Times",
  })

/* -------------------------------------------------------------------------- */
/* §12 — the failure path must exist                                           */
/* -------------------------------------------------------------------------- */

test.describe("style presence · the probe can fail", () => {
  test("a page in the browser-default state is NOT styled", async ({ page }) => {
    // This is the whole point of the check. Both documents are author-CSS-free,
    // so the comparison must report zero differing channels — the same answer it
    // gave for the third prototype's unstyled route.
    const baseline = await sample(page, UA_BASELINE_DOCUMENT)
    const bare = await sample(page, `<!doctype html><html><body><main><p>no css</p></main></body></html>`)

    const result = compareStylePresence(baseline, bare)
    expect(result.styled, "没有作者样式的页面不能被判为有样式").toBe(false)
    expect(result.differing).toEqual([])
    expect(result.missing).toEqual(STYLE_PRESENCE_CHANNELS.map((c: { id: string }) => c.id))
  })

  test("the failure message quotes the measurement, not a verdict", async ({ page }) => {
    const baseline = await sample(page, UA_BASELINE_DOCUMENT)
    const bare = await sample(page, `<!doctype html><html><body><p>no css</p></body></html>`)
    const message = describeStylePresence(compareStylePresence(baseline, bare), baseline, bare)

    expect(message).toContain("style-loaded")
    expect(message).toContain("浏览器默认样式态")
    // The two numbers a human needs to see are printed, so the failure can be
    // argued with instead of merely believed.
    expect(message).toContain(`body margin ${bare.bodyMarginTop}`)
    expect(message).toContain(`font ${bare.bodyFontFamily}`)
  })

  test("one differing channel is not enough", async ({ page }) => {
    // Quorum matters: a single property can differ for reasons that have nothing
    // to do with "the stylesheet loaded".
    const baseline = await sample(page, UA_BASELINE_DOCUMENT)
    const one = await sample(page, oneChannelStyled("<main><p>only a reset</p></main>"))

    const result = compareStylePresence(baseline, one)
    expect(result.differing, "只重置了 margin").toEqual(["box-reset"])
    expect(result.styled, "单个通道不同不足以判定样式是加载的").toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* §11 — and it must pass on a page that is genuinely styled                   */
/* -------------------------------------------------------------------------- */

test.describe("style presence · the probe stays quiet when styled", () => {
  test("a fully styled page differs in every channel", async ({ page }) => {
    const baseline = await sample(page, UA_BASELINE_DOCUMENT)
    const actual = await sample(page, styled("<main><p>styled</p></main>"))

    const result = compareStylePresence(baseline, actual)
    expect(result.differing).toEqual(STYLE_PRESENCE_CHANNELS.map((c: { id: string }) => c.id))
    expect(result.styled).toBe(true)
  })

  test("a page that only resets and re-types still passes", async ({ page }) => {
    // The threshold must not require a product to paint every domain; two
    // independent ones is the documented bar.
    const baseline = await sample(page, UA_BASELINE_DOCUMENT)
    const actual = await sample(page, partiallyStyled("<main><p>two channels</p></main>"))

    const result = compareStylePresence(baseline, actual)
    expect(result.differing).toEqual(["box-reset", "type"])
    expect(result.styled).toBe(true)
  })

  test("the real Factory pages are styled", async ({ page }) => {
    // End-to-end, in the mandatory `pnpm test` gate: the detector must not
    // false-fail the application it ships with.
    //
    // 这一条以前跑 `["/", "/demo"]`。Reference Sample 删除后本仓只剩一条路由，
    // 所以列表变成 `["/"]` —— 检查本身、通道数与判定阈值一个都没有放宽。
    const baseline = await sample(page, UA_BASELINE_DOCUMENT)

    for (const route of ["/"]) {
      await page.goto(route, { waitUntil: "domcontentloaded" })
      const actual = (await page.evaluate(STYLE_PRESENCE_PROBE)) as StyleSample
      const result = compareStylePresence(baseline, actual)
      expect(
        result.styled,
        `${route} 应当是应用样式态，实测不同通道 ${JSON.stringify(result.differing)}`,
      ).toBe(true)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* §10 — the forbidden proxies                                                 */
/* -------------------------------------------------------------------------- */

test.describe("style presence · probe integrity", () => {
  test("the probe does not count stylesheets or watch network requests", () => {
    // `document.styleSheets.length` is green in the exact broken state: the root
    // layout's sheet is still there, the route's is not.
    expect(STYLE_PRESENCE_PROBE).not.toContain("styleSheets")
    expect(STYLE_PRESENCE_PROBE).not.toContain("sheetCount")
    // No `.matches(...)`, no `querySelectorAll("link[rel=stylesheet]")`.
    expect(STYLE_PRESENCE_PROBE).not.toMatch(/link\[rel/)
  })

  test("the probe reads computed style only", () => {
    expect(STYLE_PRESENCE_PROBE).toContain("getComputedStyle")
    // A declared-but-unresolved custom property is not application. The probe
    // may read no custom property at all.
    expect(STYLE_PRESENCE_PROBE).not.toContain("getPropertyValue")
    expect(STYLE_PRESENCE_PROBE).not.toContain("--")
  })

  test("the probe references no product class and injects no marker", () => {
    const selectors = [...STYLE_PRESENCE_PROBE.matchAll(/querySelector(?:All)?\(\s*[`"']([^`"']+)[`"']/g)].map(
      (match) => match[1],
    )
    expect(selectors.length, "探针必须能选到内容根").toBeGreaterThan(0)
    for (const selector of selectors) {
      expect(selector, `选择器不得含 class：${selector}`).not.toMatch(/\.[a-zA-Z_]/)
      expect(selector, `选择器不得含 id：${selector}`).not.toMatch(/#[a-zA-Z_]/)
    }
    expect(STYLE_PRESENCE_PROBE).not.toContain("data-")
    expect(STYLE_PRESENCE_PROBE).not.toContain("createElement")
  })

  test("a non-empty font family is never treated as evidence", async ({ page }) => {
    // The assertion that could not fail: the UA default reports "Times", not "".
    const baseline = await sample(page, UA_BASELINE_DOCUMENT)
    expect(baseline.bodyFontFamily.length).toBeGreaterThan(0)
    expect(baseline.bodyFontFamily).not.toBe("")
    expect(baseline.bodyFontFamily.toLowerCase()).toContain("times")
  })

  test("an unmeasured sample fails loudly instead of looking styled", () => {
    for (const broken of [null, undefined, "styled", 42, {}]) {
      expect(() => assertBaselineIsUnstyled(broken), `baseline ${JSON.stringify(broken)} 必须失败`).toThrow(
        StylePresenceError,
      )
      expect(() => compareStylePresence(broken, uaSample())).toThrow(StylePresenceError)
    }

    // Present shape, missing measurement: the `0/0 = NaN` class of failure.
    expect(() => compareStylePresence(uaSample(), sampleOf({ bodyMarginTop: Number.NaN }))).toThrow(
      /不是有限数值/,
    )
    expect(() => compareStylePresence(uaSample(), sampleOf({ bodyFontFamily: "" }))).toThrow(/为空/)
    expect(() => compareStylePresence(uaSample(), sampleOf({ contentColor: null }))).toThrow(
      StylePresenceError,
    )
  })

  test("a contaminated baseline is a probe fault, not a product finding", () => {
    // If the reference document itself has author CSS, every comparison after it
    // is meaningless — so it must never be accepted as a reference.
    expect(() => assertBaselineIsUnstyled(sampleOf({ bodyMarginTop: 0 }))).toThrow(/参照物被污染/)
  })
})

/* -------------------------------------------------------------------------- */
/* §13 — the pairing rule is pinned where an agent reads it                    */
/* -------------------------------------------------------------------------- */

/**
 * "Role-count parity is necessary, not sufficient" is the one sentence that
 * keeps the Invisible Semantics detector from being read as a clean bill of
 * health. A paired check that is half-forgotten is the failure it guards
 * against, so the statement is asserted rather than trusted to survive edits.
 */
test.describe("DOM == AX is documented as necessary, not sufficient", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8")

  test("the sweep, the standard and AGENTS.md all say it", () => {
    const sweep = read(".qa/sweep.mjs")
    expect(sweep).toMatch(/necessary, not sufficient/i)
    expect(sweep).toMatch(/aria-hidden`-host scan/)

    const doc = read("docs/browser-qa.md")
    expect(doc).toContain("必要条件")
    expect(doc).toMatch(/不是「没有 Invisible Semantics」的充分条件/)
    expect(doc).toMatch(/被隐藏宿主扫描/)

    const agents = read("AGENTS.md")
    expect(agents).toMatch(/DOM == AX` 是必要条件，不是充分条件/)
    expect(agents).toMatch(/两条检查必须同时存在/)
  })

  test("the paired detector still exists and is still wired in", () => {
    // If the aria-hidden-host scan is ever removed, parity becomes the only
    // check — and parity cannot see a fully pruned subtree.
    const sweep = read(".qa/sweep.mjs")
    expect(sweep).toContain("INVISIBLE_SEMANTICS_VIOLATIONS")
    expect(sweep).toContain("no interactive content under aria-hidden")
  })
})
