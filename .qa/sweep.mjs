#!/usr/bin/env node
/**
 * Prototype Factory · Browser QA sweep (shared by local and remote runs) — v1.2
 *
 * ===========================================================================
 * One sweep, two origins
 * ===========================================================================
 * This module is the *whole* QA contract: every check, every probe, every
 * threshold, all of it. It has two entry points:
 *
 *   `.qa/browser-qa.mjs`   LOCAL_MANAGED — starts its own dev server, stops it
 *   `.qa/online-qa.mjs`    REMOTE        — talks to a base URL it does not own
 *
 * They cannot drift apart, because there is nothing to drift: the origin is one
 * variable, and everything else is this file. A second sweep would be a second
 * truth about what "QA passed" means — and per `scripts/doctor-gate.mjs`, when
 * two implementations disagree, the weaker one is the one that reports green.
 *
 * The checks below are unchanged from v1.1 and keep their own recorded reasons:
 *
 * ------------
 * The executable form of the Factory's QA contract. It sweeps every discovered
 * route across every configured viewport and theme and asserts the things that
 * a code review cannot: real console output, real layout boxes, the real
 * accessibility tree, real media-query states.
 *
 * Product-agnostic by construction: routes, viewports, themes and tolerances
 * come from `.qa/qa.config.mjs`. Nothing here knows a route name.
 *
 * The five checks that were added after real regressions
 * -----------------------------------------------------
 *  1. VIEWPORT EXPANSION + OVERFLOW are measured three ways, because
 *     `scrollWidth - innerWidth` alone reports a false green: Chromium silently
 *     widens the *layout* viewport to fit overflowing content, which can make
 *     the difference zero while `innerWidth` is no longer the width you asked
 *     for. So we also assert the requested width was actually honoured, and that
 *     the page cannot be scrolled sideways.
 *
 *  2. NO INVISIBLE SEMANTICS. Being visible is not the same as being *in the
 *     accessibility tree*. `aria-hidden="true"` on a real content ancestor
 *     silently prunes the whole subtree while looking perfect on screen. This
 *     cost a real regression once, so DOM counts are now compared against the
 *     browser's own accessibility tree per role.
 *
 *     Role-count parity is **necessary, not sufficient**, and nothing in this
 *     script may be read as claiming otherwise: pruning removes nodes from
 *     *both* sides of the comparison, so a fully hidden subtree keeps the two
 *     counts equal. The paired `aria-hidden`-host scan is what catches the
 *     actual defect. Two checks, kept together on purpose.
 *
 *  3. PROBE INTEGRITY. Every numeric probe passes through `measure()`, which
 *     fails loudly on a missing selector or a non-finite value. The failure it
 *     prevents is specific and nasty: `Math.abs(NaN - expected) > tolerance` is
 *     `false`, so a probe that measured *nothing* used to report success.
 *
 *  4. REDUCED MOTION + COARSE POINTER + INTERSECTION-OBSERVER FAILURE. Content
 *     must be visible without hover, without animation, and even when the
 *     observer that was supposed to reveal it never fires.
 *
 *  5. PORT ISOLATION. This script starts its own dev server on a dedicated port
 *     and stops only that child. It refuses to attach to a server it did not
 *     start — see `scripts/check-qa-port.mjs` for why.
 *
 *  6. STYLE-LOADED (v1.2). Every route is compared against the browser's own
 *     unstyled baseline, measured in the same context. A page whose computed
 *     style matches the default state in every channel is an unstyled document —
 *     and in that state every other check on this list still passes, which is
 *     how the third prototype shipped one. See `.qa/style-presence.mjs`.
 *
 * Usage
 * -----
 *   pnpm qa                 # full sweep
 *   pnpm qa --routes=/demo  # subset
 *   pnpm qa --headed        # watch it
 */

import {
  excludeRoutes,
  extraRoutes,
  pointerRatioTolerance,
  routes as configuredRoutes,
  settleMs,
  stylePresenceMinChannels,
  themes,
  tolerancePx,
  viewports,
} from "./qa.config.mjs"
import { readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

import {
  CONTENT_VISIBLE_PROBE,
  DOM_SEMANTIC_COUNT,
  INVISIBLE_SEMANTICS_VIOLATIONS,
  LAYOUT_PROBE,
  POINTER_PROBE,
} from "./probes.mjs"
import {
  STYLE_PRESENCE_CHANNELS,
  STYLE_PRESENCE_PROBE,
  StylePresenceError,
  UA_BASELINE_DOCUMENT,
  assertBaselineIsUnstyled,
  compareStylePresence,
  describeStylePresence,
} from "./style-presence.mjs"
import { accessibilityRoleCounts } from "./ax-tree.mjs"
import { ProbeError, measure } from "./probe-guard.mjs"

/* -------------------------------------------------------------------------- */
/* Result bookkeeping                                                          */
/* -------------------------------------------------------------------------- */

const failures = []
const notes = []
let checksRun = 0

function fail(where, message) {
  checksRun += 1
  failures.push(`${where} — ${message}`)
}

function ok(where, message) {
  checksRun += 1
  if (process.env.QA_VERBOSE === "1") process.stdout.write(`    ✓ ${where} ${message}\n`)
}

function note(message) {
  notes.push(message)
}

/* -------------------------------------------------------------------------- */
/* Probe integrity (section 3)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * `measure()` is **imported, never re-derived**.
 *
 * v1.1 carried a private copy of the guard inside this file. That copy was
 * byte-for-byte close to `.qa/probe-guard.mjs` and not identical (its "got 0"
 * message differed) — which is the failure mode this Factory deletes everywhere
 * else: the guard that `tests/qa-probes.spec.ts` proves is loud was *not* the
 * guard the sweep actually ran. One implementation, imported, and the module
 * that owns it is the module that gets tested.
 */

/* -------------------------------------------------------------------------- */
/* Route discovery — no hardcoded product routes                               */
/* -------------------------------------------------------------------------- */

function discoverRoutes(appDir) {
  const found = new Set()
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (!statSync(full).isDirectory()) {
        if (entry === "page.tsx" || entry === "page.ts" || entry === "page.jsx") {
          const rel = relative(appDir, dir).split(sep).filter(Boolean)
          found.add(rel.length === 0 ? "/" : `/${rel.join("/")}`)
        }
        continue
      }
      walk(full)
    }
  }
  walk(appDir)
  return [...found]
}

/**
 * Which routes a sweep should visit.
 *
 * Shared by both entry points on purpose: `--routes=` wins, then
 * `.qa/qa.config.mjs`'s `routes`, then filesystem discovery. The remote runner
 * resolves the same list from the same checkout, so "what got swept" means the
 * same thing locally and online.
 */
export function resolveRoutes(projectRoot, overrideList = null) {
  // Precedence: explicit --routes= → qa.config's `routes` → filesystem discovery.
  const base = overrideList ?? configuredRoutes ?? discoverRoutes(join(projectRoot, "app"))
  const all = [...new Set([...base, ...extraRoutes])]
  const dynamic = all.filter((route) => route.includes("["))
  const usable = all.filter((route) => !route.includes("[") && !excludeRoutes.includes(route))
  return { usable: usable.sort(), dynamic }
}

/* -------------------------------------------------------------------------- */
/* In-page probes                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The unstyled reference, measured once per (context, theme) and cached.
 *
 * It must be the *same browser* — a hard-coded "UA default is 8px / Times"
 * would be a statement about this machine's locale and font configuration, not
 * about the browser. Rendering a bare document in the same context makes the
 * comparison three-way honest: same engine, same locale, same media emulation.
 */
const styleBaselines = new WeakMap()

async function styleBaseline(context, theme) {
  let byTheme = styleBaselines.get(context)
  if (!byTheme) {
    byTheme = new Map()
    styleBaselines.set(context, byTheme)
  }
  if (byTheme.has(theme)) return byTheme.get(theme)

  const page = await context.newPage()
  try {
    await page.emulateMedia({ colorScheme: theme })
    await page.setContent(UA_BASELINE_DOCUMENT)
    const sample = await page.evaluate(STYLE_PRESENCE_PROBE)
    // A contaminated baseline makes every later comparison meaningless, so it
    // fails as a probe fault rather than being accepted as a reference.
    assertBaselineIsUnstyled(sample)
    byTheme.set(theme, sample)
    return sample
  } finally {
    await page.close()
  }
}

/* -------------------------------------------------------------------------- */
/* One page check                                                              */
/* -------------------------------------------------------------------------- */

async function checkPage(context, route, viewport, theme) {
  const where = `${route} · ${viewport.name} · ${theme}`
  const page = await context.newPage()

  const consoleErrors = []
  const pageErrors = []
  const requestFailures = []
  const badResponses = []

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  page.on("pageerror", (error) => pageErrors.push(error.message))
  page.on("requestfailed", (request) => {
    requestFailures.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText}`)
  })
  page.on("response", (response) => {
    if (response.status() >= 400) {
      badResponses.push(`${response.status()} ${response.url()}`)
    }
  })

  try {
    await page.emulateMedia({ colorScheme: theme })
    await page.goto(`${origin()}${route}`, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(settleMs)

    // ---- errors -----------------------------------------------------------
    if (consoleErrors.length > 0) fail(where, `console error ×${consoleErrors.length}: ${consoleErrors[0]}`)
    else ok(where, "console clean")

    if (pageErrors.length > 0) fail(where, `page error ×${pageErrors.length}: ${pageErrors[0]}`)
    else ok(where, "no page error")

    if (requestFailures.length > 0)
      fail(where, `request failure ×${requestFailures.length}: ${requestFailures[0]}`)
    else ok(where, "no request failure")

    if (badResponses.length > 0)
      fail(where, `HTTP ≥400 ×${badResponses.length}: ${badResponses[0]}`)
    else ok(where, "no bad response")

    // ---- layout: three independent criteria -------------------------------
    const layout = await page.evaluate(LAYOUT_PROBE)

    const widthDrift = Math.abs(layout.innerWidth - viewport.width)
    if (widthDrift > tolerancePx) {
      fail(
        where,
        `viewport expansion: 请求 ${viewport.width}px，实际 innerWidth ${layout.innerWidth}px（漂移 ${widthDrift}px）——` +
          "这是 Chromium 为容纳溢出内容自动扩张布局视口，scrollWidth-innerWidth 会因此假绿",
      )
    } else {
      ok(where, `viewport width honoured (${layout.innerWidth}px)`)
    }

    const overflow = layout.scrollWidth - viewport.width
    if (overflow > tolerancePx) {
      fail(
        where,
        `horizontal overflow: documentElement.scrollWidth ${layout.scrollWidth}px > 请求宽度 ${viewport.width}px（超出 ${overflow}px）`,
      )
    } else {
      ok(where, `no horizontal overflow (${layout.scrollWidth}px)`)
    }

    // The decisive one: can the page actually be panned sideways?
    const scrollX = await page.evaluate(async () => {
      window.scrollTo(9999, 0)
      await new Promise((r) => requestAnimationFrame(() => r()))
      const value = window.scrollX
      window.scrollTo(0, 0)
      return value
    })
    if (Math.abs(scrollX) > tolerancePx) {
      fail(where, `可横向滚动: scrollTo(9999,0) 后 scrollX=${scrollX}，页面确实能左右平移`)
    } else {
      ok(where, "not horizontally scrollable")
    }

    // ---- style-loaded: is this page the browser default? -------------------
    // Deliberately before the semantics checks: a page in the browser-default
    // state produces noise in everything downstream, and the first failure line
    // should name the actual cause.
    const baseline = await styleBaseline(context, theme)
    const styleSample = await page.evaluate(STYLE_PRESENCE_PROBE)
    const presence = compareStylePresence(baseline, styleSample, {
      minChannels: stylePresenceMinChannels,
    })
    if (!presence.styled) {
      fail(where, describeStylePresence(presence, baseline, styleSample))
    } else {
      ok(
        where,
        `style-loaded (${presence.differing.length}/${STYLE_PRESENCE_CHANNELS.length} 通道 ≠ UA baseline)`,
      )
    }

    // ---- No Invisible Semantics ------------------------------------------
    // Two complementary checks, neither sufficient alone: role-count parity
    // catches a subtree that was pruned, and the aria-hidden-host scan catches
    // interactive content inside a region that was deliberately hidden. A
    // pruned subtree satisfies both sides of the parity comparison, which is
    // why parity can never be the only check.
    const session = await context.newCDPSession(page)
    const axCounts = await accessibilityRoleCounts(session, note)
    await session.detach()

    const axCount = (role) => axCounts.get(role) ?? 0

    const roleSelectors = {
      button: "button, [role=button]",
      link: "a[href], [role=link]",
      heading: "h1, h2, h3, h4, h5, h6, [role=heading]",
    }

    for (const [role, selector] of Object.entries(roleSelectors)) {
      const domCount = await page.evaluate(DOM_SEMANTIC_COUNT(selector))
      const treeCount = axCount(role)
      if (domCount !== treeCount) {
        fail(
          where,
          `No Invisible Semantics (${role}): DOM ${domCount} ≠ 无障碍树 ${treeCount}` +
            "——看得到不等于 accessibility tree 看得到（典型原因：真实内容祖先被设了 aria-hidden）",
        )
      } else if (domCount > 0) {
        ok(where, `${role}: DOM ${domCount} == AX ${treeCount}`)
      }
    }

    const violations = await page.evaluate(INVISIBLE_SEMANTICS_VIOLATIONS)
    if (violations.length > 0) {
      const first = violations[0]
      fail(
        where,
        `aria-hidden 祖先里仍有可交互内容 ×${violations.length}：<${first.tag}${first.testid ? ` data-testid="${first.testid}"` : ""}> 含 ${first.interactive} 个可聚焦元素——装饰性元素才允许 aria-hidden`,
      )
    } else {
      ok(where, "no interactive content under aria-hidden")
    }

    // ---- content is visible by default -----------------------------------
    const visible = await page.evaluate(CONTENT_VISIBLE_PROBE)
    if (visible.height === 0 || visible.textLength === 0) {
      fail(where, `内容不可见: main 高度 ${visible.height}px，可见文本 ${visible.textLength} 字`)
    } else if (visible.fadedRoots > 0) {
      fail(where, `内容默认不可见: ${visible.fadedRoots} 个内容区块 opacity 为 0（不应依赖动画/观察者才可见）`)
    } else {
      ok(where, `content visible (${visible.height}px / ${visible.textLength} chars)`)
    }
  } catch (error) {
    if (error instanceof ProbeError || error instanceof StylePresenceError) fail(where, error.message)
    else fail(where, `检查过程异常: ${error.message}`)
  } finally {
    await page.close()
  }
}

/* -------------------------------------------------------------------------- */
/* Media / capability probes (section 4)                                       */
/* -------------------------------------------------------------------------- */

async function checkReducedMotion(context, route) {
  const where = `${route} · reduced-motion`
  const page = await context.newPage()
  try {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto(`${origin()}${route}`, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(settleMs)

    const state = await page.evaluate(CONTENT_VISIBLE_PROBE)
    if (state.height === 0 || state.textLength === 0) {
      fail(where, "reduced-motion 下内容不可见")
    } else if (state.fadedRoots > 0) {
      fail(where, `reduced-motion 下仍有 ${state.fadedRoots} 个内容区块 opacity 为 0——动画关闭后内容必须仍然存在`)
    } else {
      ok(where, "reduced-motion 下信息完整")
    }

    const running = await page.evaluate(
      `document.getAnimations().filter((a) => a.playState === "running" && a.effect &&
        a.effect.getComputedTiming().iterations === Infinity).length`,
    )
    if (running > 0) {
      fail(where, `reduced-motion 下仍有 ${running} 个无限循环动画在运行`)
    } else {
      ok(where, "无无限循环动画")
    }
  } catch (error) {
    if (error instanceof ProbeError || error instanceof StylePresenceError) fail(where, error.message)
    else fail(where, `检查过程异常: ${error.message}`)
  } finally {
    await page.close()
  }
}

/**
 * Coarse-pointer probe.
 *
 * `hasTouch` / `isMobile` are properties of the **browser context**, not of the
 * page viewport — resizing a page cannot turn `(pointer: coarse)` on. So the two
 * states are measured in two genuinely different contexts, which is also how a
 * real phone differs from a desktop.
 */
async function checkCoarsePointer(browser, route, extraHeaders = {}) {
  const where = `${route} · coarse-pointer`
  const fine = viewports.find((v) => !v.touch)
  const coarse = viewports.find((v) => v.touch)
  if (!fine || !coarse) {
    note("coarse-pointer 检查已跳过：需要至少一个 fine 与一个 touch viewport")
    return
  }

  const read = async (viewport) => {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.mobile,
      hasTouch: viewport.touch,
      deviceScaleFactor: 1,
      extraHTTPHeaders: extraHeaders,
    })
    const page = await context.newPage()
    try {
      await page.goto(`${origin()}${route}`, { waitUntil: "domcontentloaded" })
      await page.waitForTimeout(settleMs)
      return await page.evaluate(POINTER_PROBE)
    } finally {
      await context.close()
    }
  }

  try {
    const fineState = await read(fine)
    const coarseState = await read(coarse)

    if (coarseState.coarse !== true) {
      fail(where, "touch context 下 (pointer: coarse) 未匹配——触屏 CSS 分支根本没生效")
    } else {
      ok(where, "(pointer: coarse) matched")
    }
    if (fineState.coarse !== false) {
      fail(where, "fine context 下意外匹配了 (pointer: coarse)")
    }

    // 比例类断言只在两边都测到非零值时才比较；否则必须显式报错，不能靠 NaN 静默通过。
    if (fineState.scale > 0 || coarseState.scale > 0) {
      const ratio = await measure(
        where,
        "coarse/fine scale ratio",
        () => coarseState.scale / fineState.scale,
      )
      if (Math.abs(ratio - 1) < pointerRatioTolerance) {
        fail(where, `触屏缩放比例 ${ratio.toFixed(3)} 与细指针几乎相同——粗指针分支可能没生效`)
      } else {
        ok(where, `scale ratio ×${ratio.toFixed(2)}`)
      }
    } else {
      note(
        `${route}: 未声明 --kits-grid-cell-scale，跳过比例断言（该断言只在页面消费 Kits 间距契约时适用）`,
      )
    }
  } catch (error) {
    if (error instanceof ProbeError || error instanceof StylePresenceError) fail(where, error.message)
    else fail(where, `检查过程异常: ${error.message}`)
  }
}

/**
 * The page must not depend on IntersectionObserver to become visible.
 *
 * Reveal-on-scroll implementations routinely start at `opacity: 0` and wait for
 * the observer. If the observer is missing, unavailable, or simply never fires,
 * the content stays permanently invisible — and no screenshot of a
 * pre-scrolled-into-view state would show it.
 */
async function checkNoObserverDependency(context, route) {
  const where = `${route} · no-IntersectionObserver`
  const page = await context.newPage()
  try {
    await page.addInitScript(() => {
      delete window.IntersectionObserver
    })
    await page.goto(`${origin()}${route}`, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(settleMs)
    const state = await page.evaluate(CONTENT_VISIBLE_PROBE)
    if (state.height === 0 || state.textLength === 0) {
      fail(where, "没有 IntersectionObserver 时内容永久不可见")
    } else if (state.fadedRoots > 0) {
      fail(
        where,
        `没有 IntersectionObserver 时仍有 ${state.fadedRoots} 个区块不可见——内容可见性不能依赖观察者成功回调`,
      )
    } else {
      ok(where, "不依赖 IntersectionObserver")
    }
  } catch (error) {
    fail(where, `检查过程异常: ${error.message}`)
  } finally {
    await page.close()
  }
}


/* -------------------------------------------------------------------------- */
/* The sweep itself — shared by the local and the remote entry point            */
/* -------------------------------------------------------------------------- */

/**
 * Where the pages under test live.
 *
 * One variable, set once per run: the local sweep points it at the server this
 * run started, the remote sweep at a base URL somebody else is serving. Every
 * check below reads it from here, so there is exactly one sweep and exactly one
 * set of thresholds — `pnpm qa` and `pnpm qa:online` cannot drift apart.
 */
let sweepOrigin = null
const origin = () => sweepOrigin

/**
 * Sweep a set of routes at an origin.
 *
 * @param {{
 *   origin: string,
 *   routes: string[],
 *   extraHeaders?: Record<string, string>,
 *   headed?: boolean,
 * }} options
 * @returns {Promise<{failures: string[], notes: string[], checksRun: number}>}
 */
export async function runSweep({ origin: base, routes, extraHeaders = {}, headed = false }) {
  sweepOrigin = base.replace(/\/$/, "")
  failures.length = 0
  notes.length = 0
  checksRun = 0

  const { chromium } = await import("./playwright-runtime.mjs")
  const browser = await chromium.launch({ headless: !headed })
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.mobile,
        hasTouch: viewport.touch,
        deviceScaleFactor: 1,
        extraHTTPHeaders: extraHeaders,
      })
      try {
        for (const theme of themes) {
          for (const route of routes) {
            await checkPage(context, route, viewport, theme)
          }
        }
      } finally {
        await context.close()
      }
    }

    for (const route of routes) {
      const probeContext = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        extraHTTPHeaders: extraHeaders,
      })
      try {
        await checkReducedMotion(probeContext, route)
        await checkNoObserverDependency(probeContext, route)
      } finally {
        await probeContext.close()
      }
      await checkCoarsePointer(browser, route, extraHeaders)
    }
  } finally {
    await browser.close()
  }

  return { failures: [...failures], notes: [...notes], checksRun }
}

/** Print the shared result block. Returns the exit code. */
export function reportSweep({ failures: failed, notes: notesOut, checksRun: count }, { label = "Browser QA", json = false, origin: base } = {}) {
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ label, origin: base, ok: failed.length === 0, checksRun: count, failures: failed, notes: notesOut }, null, 2)}\n`,
    )
    return failed.length === 0 ? 0 : 1
  }
  for (const line of notesOut) process.stdout.write(`  \u001b[33m!\u001b[0m ${line}\n`)
  if (notesOut.length > 0) process.stdout.write("\n")
  if (failed.length > 0) {
    process.stdout.write(`\u001b[31m✗ QA FAILED\u001b[0m — ${failed.length}/${count} 项未通过\n\n`)
    for (const line of failed) process.stdout.write(`    ✗ ${line}\n`)
    process.stdout.write("\n")
    return 1
  }
  process.stdout.write(`\u001b[32m✓ QA OK\u001b[0m — ${count} 项检查全部通过\n\n`)
  return 0
}
