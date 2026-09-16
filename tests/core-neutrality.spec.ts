import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

import {
  STYLE_PRESENCE_PROBE,
  UA_BASELINE_DOCUMENT,
  compareStylePresence,
} from "../.qa/style-presence.mjs"
import { walkScoped } from "../scripts/lib/kits-seam.mjs"
import { invariant } from "./support/product-contract"

/**
 * Core neutrality (Factory v1.2 · N1 = F3 + F4).
 *
 * The claim being tested is not "the Reference Sample got prettier or plainer".
 * It is narrower and checkable:
 *
 *   **A route that opts into nothing must not inherit Art Direction personality.**
 *
 * Two halves, because either alone can be satisfied dishonestly:
 *
 *   static   — where the personality lives, and that the Core primitives that
 *              consume it all have a neutral default;
 *   runtime  — what a neutral surface and a sample surface actually compute.
 *
 * The runtime half also re-asserts the Phase A style-presence gate on both, so
 * "neutral" can never be achieved by deleting the stylesheet.
 */

const ROOT = process.cwd()
const read = (path: string) => readFileSync(join(ROOT, path), "utf8")

/** Everything that reads as lighting / glow / halo rather than as structure. */
const PERSONALITY_PATTERN =
  /--ambient-|--hero-|--chart-glow|\bambient-wash\b|\bambient-grid\b|\bhero-wash\b|\bsurface-sheen\b|\bchart-glow\b|\blive-halo\b/

/**
 * Core files that name a personality token directly, and the gate each must
 * keep. A file that is not here may not mention one at all; a file that is here
 * must still contain the opt-in test named below.
 *
 * This is "no new glow defaults" (N1 · AC 9) as data: adding a reference without
 * declaring its opt-in fails, and so does removing the default that makes the
 * opt-in meaningful.
 */
const GATED_PERSONALITY_CONSUMERS: Record<string, string[]> = {
  "components/layout/sidebar.tsx": ["brand.sheen ?", "status.pulse ?"],
  "components/prototype/ai-summary-panel.tsx": ["glow = false"],
  "components/prototype/open-section.tsx": ['ambient = "none"'],
  // The capability itself. It paints nothing unless a caller asks, so the
  // neutrality rule lands on its callers — see CAPABILITY_DEFAULTS.
  "components/prototype/ambient-backdrop.tsx": ["export function AmbientBackdrop"],
}

/**
 * Core components that consume the personality layer **indirectly**, through the
 * capability component, and the neutral default each must keep.
 *
 * These two are why "the capability stays, the default changes" is the right
 * fix: the shell keeps the ability to be lit, and stops lighting itself.
 */
const CAPABILITY_DEFAULTS: Record<string, string> = {
  "components/layout/page-container.tsx": "ambient = false",
  "components/prototype/command-palette.tsx": "ambient = false",
}

/* -------------------------------------------------------------------------- */
/* static — where the personality lives                                        */
/* -------------------------------------------------------------------------- */

test.describe("the neutral layer", () => {
  test("globals.css carries no ambient / hero / glow token or utility", () => {
    const css = read("app/globals.css")
    for (const needle of [
      "--ambient-",
      "--hero-",
      "--chart-glow",
      "ambient-wash",
      "ambient-grid",
      "hero-wash",
      "surface-sheen",
      "chart-glow",
      "live-halo",
      "ambient-drift",
    ]) {
      expect(css, `中性层不得出现 ${needle}`).not.toContain(needle)
    }
  })

  test("the personality capability still exists — it moved out of Core, it was not deleted", () => {
    // 基线版本检查的是 Reference Sample 的性格层（`app/sample-command-center.css`），
    // 那一层连同样例一起被删掉了。这条断言的**原意**从来不是「那个文件必须在」，
    // 而是「性格没有消失，它只是搬到了必须显式 opt-in 的地方」——所以它现在检查
    // 能力本身：能力仍然可以被调用（AmbientBackdrop 仍然会画那层光），
    // 而默认仍然是关的（CAPABILITY_DEFAULTS 在下面每一条都被断言）。
    const capability = read("components/prototype/ambient-backdrop.tsx")
    for (const needle of ["ambient-wash", "ambient-grid", "hero"]) {
      expect(capability, `能力组件必须仍然能表达 ${needle}`).toContain(needle)
    }
    expect(capability).toContain("export function AmbientBackdrop")
    expect(capability).toContain("pointer-events-none")
  })

  test("no surface imports a personality stylesheet any more", () => {
    // 原意：**性格层只能跟着显式 import 它的模块图走**，不能泄漏到没被决定的界面上。
    // 样例删除之后，合法的 import 数量就是 0；任何一条 import 回来都必须是一次
    // 显式决定，而不是顺手带回。中性层自己的 globals.css 里一个性格 token 都没有
    // （上面那条测试），所以这里的两条合起来仍然守住了 N1 的机制。
    const { files } = walkScoped(ROOT, { roots: ["app", "components"], excludeTrees: [] })
    const IMPORT_RE = /^\s*import\s+["'][^"']*sample-command-center\.css["']/m
    const importers = files.filter((file) => IMPORT_RE.test(read(file)))
    expect(new Set(importers), "没有任何界面再 import 那层样例性格").toEqual(new Set())
    expect(existsSync(join(ROOT, "app/sample-command-center.css")), "性格层文件本身已随样例删除").toBe(
      false,
    )
  })

  test("every Core consumer of personality is gated, and keeps its neutral default", () => {
    const { files } = walkScoped(ROOT, { roots: ["components"], excludeTrees: [] })
    const offenders: string[] = []

    for (const file of files) {
      if (!PERSONALITY_PATTERN.test(read(file))) continue
      const gates = GATED_PERSONALITY_CONSUMERS[file]
      if (!gates) {
        offenders.push(`${file} — 未声明 gate`)
        continue
      }
      const source = read(file)
      for (const gate of gates) {
        if (!source.includes(gate)) offenders.push(`${file} — 缺少 gate: ${gate}`)
      }
    }

    expect(
      offenders,
      "共享组件要消费性格就必须显式 opt-in（默认关闭）。新增引用请同时更新 GATED_PERSONALITY_CONSUMERS。",
    ).toEqual([])
  })

  test("the declared gate list has no stale entries", () => {
    for (const file of Object.keys(GATED_PERSONALITY_CONSUMERS)) {
      expect(PERSONALITY_PATTERN.test(read(file)), `${file} 已不再消费性格，请从清单里移除`).toBe(true)
    }
  })

  test("the capability keeps its neutral default", () => {
    // "The ability stays, the default changes." Both halves are asserted: the
    // opt-in must exist AND must default to off.
    for (const [file, gate] of Object.entries(CAPABILITY_DEFAULTS)) {
      const source = read(file)
      expect(source, `${file} 必须保留中性默认：${gate}`).toContain(gate)
      expect(source, `${file} 必须仍然具备这个能力`).toContain("AmbientBackdrop")
    }
  })

  test("the neutral shell is still a designed shell", () => {
    // Neutral is not "empty". These must NOT have been removed along with the
    // personality: structure, type, surfaces, focus, rules.
    const css = read("app/globals.css")
    for (const needle of [
      "--background",
      "--foreground",
      "--surface",
      "--muted-foreground",
      "--border",
      "--hairline",
      "--ring",
      "--radius",
      "font-sans",
      "@utility section-tick",
      "@utility kbd-chip",
    ]) {
      expect(css, `中性层必须保留 ${needle}`).toContain(needle)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* runtime — what a neutral surface computes                                   */
/* -------------------------------------------------------------------------- */

const NEUTRAL_ROUTE = "/this-route-does-not-exist"

const TOKEN_PROBE = `(() => {
  const root = getComputedStyle(document.documentElement)
  const read = (name) => root.getPropertyValue(name).trim()
  const personality = [
    "--ambient-brand",
    "--ambient-warm",
    "--ambient-hero-brand",
    "--ambient-grid",
    "--ambient-ring",
    "--hero-base",
    "--chart-glow",
  ]
  return {
    personalityDeclared: personality.filter((name) => read(name) !== ""),
    neutral: {
      background: read("--background"),
      foreground: read("--foreground"),
      border: read("--border"),
      ring: read("--ring"),
    },
    personalityElements: document.querySelectorAll(
      ".ambient-wash, .ambient-grid, .hero-wash, .surface-sheen, .chart-glow",
    ).length,
  }
})()`

/**
 * WCAG contrast, measured on the *computed* colours.
 *
 * The colours are rasterised through a canvas because the computed values come
 * back as `lab()` / `oklab()` — parsing those by hand would be a second colour
 * implementation, and the browser already has one.
 */
const CONTRAST_PROBE = `(() => {
  const canvas = document.createElement("canvas")
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext("2d")
  const raster = (color) => {
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return { r, g, b, a }
  }
  const luminance = ({ r, g, b }) => {
    const channel = (value) => {
      const scaled = value / 255
      return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  }
  const surface = raster(getComputedStyle(document.body).backgroundColor)
  const textEl = document.querySelector("main p") || document.querySelector("main") || document.body
  const ink = raster(getComputedStyle(textEl).color)
  const light = luminance(surface)
  const dark = luminance(ink)
  return {
    surface,
    ink,
    ratio: (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05),
    sampledTag: textEl.tagName.toLowerCase(),
  }
})()`

interface TokenProbeResult {
  personalityDeclared: string[]
  neutral: Record<string, string>
  personalityElements: number
}
interface ContrastProbeResult {
  surface: { r: number; g: number; b: number; a: number }
  ink: { r: number; g: number; b: number; a: number }
  ratio: number
  sampledTag: string
}

async function styleBaseline(page: Page, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme })
  await page.setContent(UA_BASELINE_DOCUMENT)
  return page.evaluate(STYLE_PRESENCE_PROBE)
}

test.describe("a route that opts into nothing", () => {
  test("does not inherit the ambient / hero / glow tokens", async ({ page }) => {
    await page.goto(NEUTRAL_ROUTE, { waitUntil: "domcontentloaded" })
    const result = (await page.evaluate(TOKEN_PROBE)) as TokenProbeResult

    expect(result.personalityDeclared, "中性路由不得解析出性格 token").toEqual([])
    expect(result.personalityElements, "中性路由不得出现性格元素").toBe(0)
    // …while still being a styled page: the neutral layer is present.
    expect(result.neutral.background).not.toBe("")
    expect(result.neutral.foreground).not.toBe("")
    expect(result.neutral.border).not.toBe("")
  })

  test("is still a styled page — Phase A's gate must not be gamed", async ({ page }) => {
    const baseline = await styleBaseline(page, "light")
    await page.goto(NEUTRAL_ROUTE, { waitUntil: "domcontentloaded" })
    const sample = await page.evaluate(STYLE_PRESENCE_PROBE)
    const presence = compareStylePresence(baseline, sample, { minChannels: 2 })
    expect(presence.styled, `中性路由仍必须是有样式的页面（不同通道 ${JSON.stringify(presence.differing)}）`).toBe(
      true,
    )
  })

  test("is readable in both themes", async ({ page }) => {
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme })
      await page.goto(NEUTRAL_ROUTE, { waitUntil: "domcontentloaded" })
      const contrast = (await page.evaluate(CONTRAST_PROBE)) as ContrastProbeResult

      expect(contrast.surface.a, `${theme}: body 必须有实体底色（不能透明）`).toBeGreaterThan(0)
      expect(
        contrast.ratio,
        `${theme}: 正文对比度 ${contrast.ratio.toFixed(2)} 过低（底色 ${JSON.stringify(contrast.surface)} / 文字 ${JSON.stringify(contrast.ink)}）`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })
})

test.describe("the product's own surfaces opt into nothing (for now)", () => {
  /**
   * 基线版本这一节叫「the Reference Sample opts in explicitly」，检查的是**正向**：
   * `/crm` 与 `/demo` 显式 opt-in 之后确实拿到了性格（sheen / live-halo / 环境光），
   * 而 `/` 拿到了 hero 光。样例删除之后不存在任何 opt-in 的界面，所以正向的
   * 浏览器断言没有对象了 —— 但**被守的性质还在**，而且更强：
   *
   *   • S1 的首屏必须是**中性面**：不声明性格 token、不渲染性格元素。
   *     这不是「暂时没有」，而是 `visual-manifest.json` 的 avoid 里写明的两条
   *     （`glow-everywhere` / `ambient-light-layer`）—— 控制台的光只应来自真实状态。
   *   • 中性 ≠ 无设计：它同时必须仍然是有样式、可读的页面（下面两条）。
   *   • T1 那条「能力仍然在」由 `the personality capability still exists` 守，
   *     所以这一节不需要为了「正向用例」去造一个带环境光的页面。
   */
  test("/ is a neutral surface — no ambient light, no hero glow", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(300)
    const result = (await page.evaluate(TOKEN_PROBE)) as TokenProbeResult

    expect(result.personalityDeclared, "首屏不得解析出性格 token").toEqual([])
    expect(result.personalityElements, "首屏不得出现环境光 / hero 光元素").toBe(0)
    expect(result.neutral.background).not.toBe("")
    expect(result.neutral.foreground).not.toBe("")
  })

  test("the product's surfaces are styled too", async ({ page }) => {
    const baseline = await styleBaseline(page, "light")
    for (const route of ["/"]) {
      await page.goto(route, { waitUntil: "domcontentloaded" })
      const sample = await page.evaluate(STYLE_PRESENCE_PROBE)
      const presence = compareStylePresence(baseline, sample, { minChannels: 2 })
      expect(presence.styled, `${route} 必须仍然是有样式的页面`).toBe(true)
    }
  })

  test("reduced motion: no infinite animation anywhere", async ({ browser }) => {
    // 原意是「性格层的动效在 reduced-motion 下必须塌掉」。样例删除后本仓没有动效
    // （首屏是 Server Component，动效语言是 event-driven，首页没有状态变化），
    // 所以这条检查现在是**下界**而不是证明：它保证第一个动效被加进来时，
    // 无限循环的那一类不会绕过 reduced-motion。
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    })
    try {
      const page = await context.newPage()
      await page.goto("/", { waitUntil: "domcontentloaded" })
      await page.waitForTimeout(300)
      const running = await page.evaluate(
        `document.getAnimations().filter((a) => a.playState === "running" && a.effect &&
          a.effect.getComputedTiming().iterations === Infinity).length`,
      )
      expect(running, "reduced-motion 下不得有无限循环动画").toBe(0)
    } finally {
      await context.close()
    }
  })
})

/* -------------------------------------------------------------------------- */
/* the registered invariant                                                    */
/* -------------------------------------------------------------------------- */

invariant(
  "factory.core-not-art-directed",
  "Factory Core 的默认输出不携带 Art Direction personality",
  () => {
    test("中性层无性格 token，且每个消费性格的共享组件都保留了中性默认", () => {
      expect(PERSONALITY_PATTERN.test(read("app/globals.css")), "globals.css 不得含性格 token").toBe(
        false,
      )
      for (const [file, gates] of Object.entries(GATED_PERSONALITY_CONSUMERS)) {
        for (const gate of gates) {
          expect(read(file), `${file} 必须保留 gate：${gate}`).toContain(gate)
        }
      }
      for (const [file, gate] of Object.entries(CAPABILITY_DEFAULTS)) {
        expect(read(file), `${file} 必须保留中性默认：${gate}`).toContain(gate)
      }
    })
  },
)
