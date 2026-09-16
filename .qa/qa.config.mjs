/**
 * Prototype Factory · Browser QA configuration.
 *
 * Single source of truth for the QA sweep. Everything a product needs to change
 * lives here — routes, viewports, themes, tolerance — so the sweep script itself
 * stays product-agnostic and never learns a route name.
 *
 * This file is imported by three consumers:
 *   - `.qa/browser-qa.mjs`   the sweep
 *   - `playwright.config.ts` the e2e runner's port/host
 *   - `scripts/check-qa-port.mjs` the pre-flight guard
 *
 * A product derived from the Factory edits ONLY this file.
 */

/**
 * The QA port. Deliberately NOT 3000.
 *
 * 3000 is Next's default, which means every prototype on this machine, plus any
 * stray `next dev`, races for it. Ports already claimed by siblings when this
 * prototype was derived (2026-09-16): 3100 (hub) · 3200 (starter) · 3210
 * (finance) · 3230 (research) · 3300 (kits). S1 takes 3310.
 *
 * The port is *pinned* rather than left to Next's auto-increment, because
 * auto-increment is how a test run silently ends up talking to a different
 * server than the one it started.
 *
 * 端口值本身是人签署的决定（见根目录 `S1-原型建设方案.md` 决定 3）。
 */
export const QA_PORT = 3310

/** Host the QA server binds to. 127.0.0.1 avoids exposing the dev server. */
export const QA_HOST = "127.0.0.1"

/** Full origin, used as Playwright's `baseURL`. */
export const QA_ORIGIN = `http://${QA_HOST}:${QA_PORT}`

/**
 * Routes to sweep.
 *
 * `null` means "discover every route from `app/`" — the default, and the reason
 * this script has no product routes baked into it. Set an explicit array to
 * sweep a subset (e.g. a single feature branch's routes).
 *
 * Dynamic segments (`[id]`) cannot be discovered statically; list the concrete
 * paths for those under `extraRoutes`.
 */
export const routes = null

/**
 * Routes that exist but cannot be discovered from the filesystem — dynamic
 * segments, or pages you want exercised with real ids.
 * @type {string[]}
 */
export const extraRoutes = []

/** Routes deliberately excluded from the sweep (e.g. heavy paywalls, redirects). */
/** @type {string[]} */
export const excludeRoutes = []

/**
 * Viewports every route is swept at.
 *
 * **The mobile viewport is deliberately absent.** The reason, verbatim, as
 * signed by the human owner of this product
 * （`S1-原型建设方案.md` 已签署的决定 4，签署日 2026-09-16）:
 *
 *   「S1 是 16:9 单屏不加滚动的控制台，产品形态不提供移动端；投屏环境为固定 16:9。因此 QA 扫 desktop 双主题，不做移动视口扫描。这不是放弃适配，是产品形态的声明。」
 *
 * Two consequences that are accepted here rather than overlooked:
 *   - the sweep's coarse-pointer comparison needs one fine and one touch
 *     viewport; with a single viewport it takes its own documented
 *     "跳过并说明" branch (see `.qa/sweep.mjs`). That is allowed — **do not
 *     re-add a mobile viewport just to make those checks run**.
 *   - `themes` stays `["dark", "light"]`: the matrix is still
 *     `routes × desktop × 2 themes`, so the dark/light sweep is not reduced.
 */
export const viewports = [
  { name: "desktop", width: 1440, height: 900, mobile: false, touch: false },
]

/** Colour schemes every route × viewport is swept at. */
export const themes = ["dark", "light"]

/** Milliseconds to settle after navigation before measuring. */
export const settleMs = 450

/**
 * Tolerance in CSS pixels for the viewport-expansion and overflow checks.
 *
 * The checks are written so this is the *only* slack: a scrollbar or a
 * fractional device-pixel-ratio rounding needs ~1px, and anything larger than
 * that is a real layout bug rather than noise.
 */
export const tolerancePx = 1

/**
 * Ratio threshold for the coarse-pointer spacing check.
 *
 * A touch target's spacing must differ measurably between fine and coarse
 * pointers. `0.02` is tight enough to catch "the media query never applied" and
 * loose enough to survive sub-pixel rounding.
 */
export const pointerRatioTolerance = 0.02

/**
 * Quorum for the style-presence bundle (Factory v1.2 · N3).
 *
 * Every route must differ from a same-browser **unstyled baseline** in at least
 * this many independent style domains — `box-reset` · `type` · `surface` ·
 * `ink`. A page that matches the browser default in all four is not a styled
 * page with a bug; it is an unstyled page.
 *
 * Why 2 and not 4: 4 would make the gate depend on the product painting every
 * domain (a product that only resets margins and sets a font would fail while
 * being perfectly styled). Why not 1: a single differing property is weak
 * evidence — it is exactly what one stray rule produces.
 *
 * Measured on this Factory: 4/4 channels differ. With the root stylesheet
 * removed: 0/4.
 */
export const stylePresenceMinChannels = 2

/** Fail the run if any numeric probe cannot be measured. Always leave on. */
export const failOnUnmeasurableProbe = true
