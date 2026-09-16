/**
 * Style-presence bundle — Factory v1.2 (N3 / F12).
 *
 * ===========================================================================
 * The defect this exists for
 * ===========================================================================
 * The third prototype shipped a route whose stylesheet never reached the
 * browser. App Router bundles CSS **per module graph**, so a route that renders
 * a component which does not itself `import "./x.css"` gets none of it. In that
 * state the page was:
 *
 *   - free of errors and warnings,
 *   - complete in the DOM (every element present, every `data-testid` findable),
 *   - green in `pnpm test`, `pnpm qa`, the console checks, the overflow checks
 *     and the accessibility tree.
 *
 * It was, in fact, an unstyled HTML document. Nothing in the Factory's toolkit
 * could see that, because every check asked "is this element correct?" and none
 * asked "did the stylesheet load at all?".
 *
 * ===========================================================================
 * Why the obvious probes are not allowed
 * ===========================================================================
 * Each of these measures a proxy that is green in exactly the broken state:
 *
 *   `document.styleSheets.length > 0`   The root layout's stylesheet is still
 *                                       there; the route's is not.
 *   "the CSS request happened"          Same: a 200 on a stylesheet is not the
 *                                       same stylesheet the page needs.
 *   "a CSS variable is declared"        Declaration is not application, and a
 *                                       variable on the wrong element resolves
 *                                       to nothing (see docs/browser-qa.md §3).
 *   `fontFamily !== ""`                 The UA default font is a non-empty
 *                                       string. This assertion cannot fail —
 *                                       verified: an unstyled page reports
 *                                       `"Times"`, not `""`.
 *   a product class name                The Factory knows no product classes,
 *                                       and the product's own names are exactly
 *                                       what would have to be guessed.
 *
 * So the bundle is built on the only thing that cannot lie: **final computed
 * style, compared against the same browser's unstyled baseline**.
 *
 * ===========================================================================
 * The design: differential, not absolute
 * ===========================================================================
 * Absolute expectations ("the body margin must be 0px") encode one product's
 * reset as a universal law. Instead the sweep renders a bare document — no
 * author CSS at all, nothing but the browser — and measures it in the *same
 * browser context* as the page under test. The page then has to look different
 * from the browser's own default in at least `stylePresenceMinChannels`
 * independent style domains.
 *
 * That is what makes it generic across products: it asserts a *relation*
 * ("this page is not the browser default"), not a value. It carries no route
 * name, no class name, no marker, no token name, and no assumption that the
 * product draws a border.
 *
 * Measured on this Factory (light theme, Chromium 141):
 *
 *   channel       UA baseline              Factory baseline        contract
 *   box-reset     margin 8px / 8px         0px / 0px               differs
 *   type          "Times"                  "Geist, … sans-serif"    differs
 *   surface       rgba(0, 0, 0, 0)         lab(97.9058 -0.49 …)     differs
 *   ink           rgb(0, 0, 0)             lab(4.78297 …)           differs
 *
 * With `app/globals.css` removed from the root layout the same probe returns
 * the UA column for every row — the mutated page is byte-identical to the
 * baseline, which is the whole point: the check fails at `style-loaded`, by
 * measurement, not by luck.
 *
 * ===========================================================================
 * Known limit (stated, not hidden)
 * ===========================================================================
 * This detects a page that is **in the browser-default state**. It does not
 * detect a route whose *root* stylesheet loaded while a route-local stylesheet
 * did not — the third prototype's precise shape, where `globals.css` was still
 * applied and only `research-shell.css` was missing. No product-agnostic
 * computed-style probe can see that: "route-local CSS" is product knowledge by
 * definition, and the signal that caught it there was a product-specific
 * assertion (`.rs-finding__section` must have a non-zero bottom border).
 *
 * The Factory therefore guarantees the general case and documents the specific
 * one as a product responsibility. See `docs/browser-qa.md` §7.
 */

/**
 * A document with no author CSS whatsoever.
 *
 * `setContent` on a fresh page replaces `about:blank`, so this renders under the
 * UA stylesheet alone — which is exactly the state being measured.
 */
export const UA_BASELINE_DOCUMENT = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ua baseline</title></head><body><p>ua baseline</p></body></html>`

/** Raised when a style-presence measurement cannot be trusted. */
export class StylePresenceError extends Error {}

/**
 * Read the raw computed-style facts the bundle compares.
 *
 * No verdict is returned — the thresholds stay in one place, in the sweep, next
 * to every other threshold (same contract as `.qa/probes.mjs`).
 */
export const STYLE_PRESENCE_PROBE = `(() => {
  const body = document.body
  if (!body) return null
  const content =
    document.querySelector("main") ||
    document.querySelector('[role="main"]') ||
    body
  const bodyStyle = getComputedStyle(body)
  const contentStyle = getComputedStyle(content)
  return {
    bodyMarginTop: parseFloat(bodyStyle.marginTop),
    bodyMarginLeft: parseFloat(bodyStyle.marginLeft),
    bodyFontFamily: bodyStyle.fontFamily,
    bodyBackgroundColor: bodyStyle.backgroundColor,
    bodyColor: bodyStyle.color,
    contentTag: content.tagName.toLowerCase(),
    contentColor: contentStyle.color,
    contentFontFamily: contentStyle.fontFamily,
  }
})()`

const normalizeFamily = (value) => value.toLowerCase().replace(/\s+/g, " ").trim()

/**
 * Independent style domains.
 *
 * Four of them, in three different categories (geometry, typography, paint), so
 * a quorum cannot be satisfied by one stylesheet rule that happens to set two
 * related properties. `border-width` is deliberately not among them: the
 * Factory must work for products that draw no borders.
 */
export const STYLE_PRESENCE_CHANNELS = [
  {
    id: "box-reset",
    label: "盒模型重置（body margin）",
    differs: (base, actual) =>
      Math.abs(actual.bodyMarginTop - base.bodyMarginTop) > 0.5 ||
      Math.abs(actual.bodyMarginLeft - base.bodyMarginLeft) > 0.5,
  },
  {
    id: "type",
    label: "字体栈（应用声明 vs UA 默认）",
    differs: (base, actual) =>
      normalizeFamily(actual.bodyFontFamily) !== normalizeFamily(base.bodyFontFamily),
  },
  {
    id: "surface",
    label: "画布底色（body background）",
    differs: (base, actual) => actual.bodyBackgroundColor !== base.bodyBackgroundColor,
  },
  {
    id: "ink",
    label: "内容前景色（content root color）",
    differs: (base, actual) => actual.contentColor !== base.contentColor,
  },
]

const NUMERIC_FIELDS = ["bodyMarginTop", "bodyMarginLeft"]
const STRING_FIELDS = [
  "bodyFontFamily",
  "bodyBackgroundColor",
  "bodyColor",
  "contentColor",
  "contentFontFamily",
]

/**
 * Refuse to compare a measurement that is not a measurement.
 *
 * The failure this prevents is the one QA has already been burned by: a probe
 * that measured nothing returning `undefined`, and every comparison against
 * `undefined` being quietly false. A styled page and an unmeasured page must
 * never be the same answer.
 */
export function assertSample(stage, sample) {
  if (!sample || typeof sample !== "object") {
    throw new StylePresenceError(
      `${stage}: style-presence 探针没有返回测量结果（${JSON.stringify(sample)}）——` +
        "「没量到」不能当成「没有样式问题」。",
    )
  }
  for (const field of NUMERIC_FIELDS) {
    const value = sample[field]
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new StylePresenceError(
        `${stage}: ${field} 不是有限数值（${JSON.stringify(value)}）——探针没有真正完成测量。`,
      )
    }
  }
  for (const field of STRING_FIELDS) {
    const value = sample[field]
    if (typeof value !== "string" || value.trim() === "") {
      throw new StylePresenceError(
        `${stage}: ${field} 为空（${JSON.stringify(value)}）——计算样式永远不该为空，说明测量失败。`,
      )
    }
  }
}

/**
 * The baseline must itself be unstyled.
 *
 * If the reference document ever acquires author CSS, the comparison silently
 * becomes "does the page differ from another styled page" — a question with no
 * wrong answers. Chromium's UA stylesheet gives `body` an 8px margin; a zero
 * here means the baseline was contaminated and every result after it is void.
 */
export function assertBaselineIsUnstyled(sample) {
  assertSample("baseline", sample)
  if (sample.bodyMarginTop === 0) {
    throw new StylePresenceError(
      "baseline 文档不是浏览器默认状态（body margin 为 0）——" +
        "参照物被污染，之后的比较全部无意义。这属于探针故障，不是产品缺陷。",
    )
  }
}

/**
 * Compare a page against the UA baseline.
 *
 * @returns {{
 *   styled: boolean,
 *   differing: string[],
 *   missing: string[],
 *   minChannels: number,
 * }}
 */
export function compareStylePresence(baseline, actual, { minChannels = 2 } = {}) {
  assertBaselineIsUnstyled(baseline)
  assertSample("page", actual)

  const differing = []
  const missing = []
  for (const channel of STYLE_PRESENCE_CHANNELS) {
    if (channel.differs(baseline, actual)) differing.push(channel.id)
    else missing.push(channel.id)
  }

  return {
    styled: differing.length >= minChannels,
    differing,
    missing,
    minChannels,
  }
}

/** The failure message. It has to show the measurement, not assert a verdict. */
export function describeStylePresence(comparison, baseline, actual) {
  const channelList = STYLE_PRESENCE_CHANNELS.map((channel) => channel.id).join(" / ")
  return (
    `style-loaded: 这一页处于**浏览器默认样式态**——` +
    `${comparison.differing.length}/${STYLE_PRESENCE_CHANNELS.length} 个样式通道与 UA baseline 不同` +
    `（要求 ≥ ${comparison.minChannels}；通道：${channelList}）。\n` +
    "      Web App Router 按模块图打包 CSS：某条路由的样式表没有进入它的模块图时，" +
    "页面不报错、DOM 完整、测试全绿，只是变成一份没写 CSS 的 HTML。\n" +
    `      实测 UA baseline：body margin ${baseline.bodyMarginTop}/${baseline.bodyMarginLeft}px · ` +
    `font ${baseline.bodyFontFamily} · bg ${baseline.bodyBackgroundColor} · ink ${baseline.contentColor}\n` +
    `      本页实测：        body margin ${actual.bodyMarginTop}/${actual.bodyMarginLeft}px · ` +
    `font ${actual.bodyFontFamily} · bg ${actual.bodyBackgroundColor} · ink ${actual.contentColor}`
  )
}
