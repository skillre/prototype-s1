#!/usr/bin/env node
/**
 * 工作台截图 —— **给人看的证据**（HVA 用），不是"看起来没问题"的替代品。
 *
 * ```
 * node scripts/capture-workbench.mjs            # 连一个已经在跑的 dev server
 * node scripts/capture-workbench.mjs --port=3310
 * ```
 *
 * ## 它为什么存在
 *
 * `STH-人眼验收清单.md` 要求人在 **1680×1050 双主题**下看真实画面。
 * 截图是那份验收的输入之一，而"截图"这件事最容易变成一次性的手工操作：
 * 下一个人想复现时，只能靠记忆复原当时开了哪一帧、哪个主题、哪个视口。
 * 所以这里把三件事写死成参数：**视口 1680×1050**（设计画布，scale = 1）、
 * **深 / 浅两套主题**、**若干固定帧**（开场、第 12 拍、第 17 拍）。
 *
 * ## 它不做什么
 *
 *   · **不启动 server**（同 `qa:online` 的立场：观察者不编排）。它连一个已经存在的
 *     地址，连不上就报错退出 —— 不会自己去拉一个 server 起来，那会与 `pnpm test` /
 *     `pnpm qa` 抢 3310 这个独占端口。
 *   · **不判断画面对不对**。它只落文件。判红是 `pnpm test` 的事，判"好不好看"是人的事。
 *
 * 产物落在 `.qa/out/`（已 gitignore），文件名带帧号与主题，例如
 * `b3-beat17-dark.png`。
 */

import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { chromium } from "../.qa/playwright-runtime.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, "..", ".qa", "out")

const args = new Map(
  process.argv.slice(2).map((raw) => {
    const [key, value = "true"] = raw.replace(/^--/, "").split("=")
    return [key, value]
  }),
)
const port = args.get("port") ?? "3310"
const origin = `http://127.0.0.1:${port}`

/** 设计画布：这一条不许改 —— 改了就量的不是设计稿的骨架。 */
const VIEWPORT = { width: 1680, height: 1050 }
/** 固定帧：开场、重规划之后、回放终点。 */
const FRAMES = [
  { slug: "open", query: "?autoplay=0" },
  { slug: "beat12", query: "?beat=12&autoplay=0" },
  { slug: "beat17", query: "?beat=17&autoplay=0" },
  /*
   * ⑫ 只在**展开**时存在（它是一个悬浮面）—— 不点一下，截图上就永远没有它。
   * 所以这一帧带一个动作：先点开花名册，再截。
   */
  { slug: "beat17-roster", query: "?beat=17&autoplay=0", click: '[data-testid="roster-toggle"]' },
]
const THEMES = ["dark", "light"]

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const written = []

  try {
    for (const theme of THEMES) {
      for (const frame of FRAMES) {
        const context = await browser.newContext({
          viewport: VIEWPORT,
          colorScheme: theme,
        })
        const page = await context.newPage()
        await page.goto(`${origin}/workbench${frame.query}`, { waitUntil: "domcontentloaded" })
        // 等 scale 落到 1（1680×1050 下不缩放）——「页面能看见」不等于「布局已经 settle」。
        await page.waitForFunction(
          () => document.querySelector(".sth-canvas")?.getAttribute("data-scale") === "1.0000",
          undefined,
          { timeout: 15_000 },
        )
        // 等三列都离开 loading（回放装载完之前截到的是空壳）。
        await page.waitForFunction(
          () =>
            document.querySelectorAll('[data-panel][data-panel-status="loading"]').length === 0,
          undefined,
          { timeout: 15_000 },
        )
        if (frame.click !== undefined) {
          await page.locator(frame.click).click()
          // 展开是一次真的状态变化；等它画完再截，免得截到中间的半帧。
          await page.waitForTimeout(150)
        }
        const file = join(OUT, `b3-${frame.slug}-${theme}.png`)
        await page.screenshot({ path: file })
        written.push(file)
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }

  /*
   * 输出走 `process.stdout` 而**不是**那个同名的全局对象。
   *
   * 这不是风格偏好：Kits 的 seam 门禁是**子串**规则（`tests/kits-seam.spec.ts`），
   * 而 `scripts/**` 在它的扫描范围里 —— 那个全局对象的点号写法里正好含着一个 Kits 资产 id
   * （2026-09-17 实测：本文件第一次落盘时门禁报 `kits/asset-id-in-product`）。
   * 本仓其它脚本（`check-qa-port.mjs` / `doctor-gate.mjs`）同样走 `process.stdout`。
   */
  process.stdout.write(`已写出 ${written.length} 张（1680×1050）：\n`)
  for (const file of written) process.stdout.write(`  ${file}\n`)
}

main().catch((error) => {
  process.stderr.write(
    `截图失败：${error instanceof Error ? error.message : String(error)}\n` +
      `  它连的是 ${origin}。请先在另一个终端起 dev server：\n` +
      `    pnpm dev --hostname 127.0.0.1 --port ${port}\n` +
      `  （脚本自己不拉 server：那会与 pnpm test / pnpm qa 抢 3310 这个独占端口。）\n`,
  )
  process.exitCode = 1
})
