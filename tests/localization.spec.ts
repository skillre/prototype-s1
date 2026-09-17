import { test, expect, type Page } from "@playwright/test"
import { LOCALIZED_ROUTES, expectFullyLocalized, findUntranslated } from "./support/localization"
import { zhCN } from "../lib/i18n/zh-CN"

/**
 * 本地化完整性（English Leakage Audit）。
 *
 * 覆盖本仓**真实存在**的界面：首屏（`/`）与 404。判定规则集中在
 * `tests/support/localization.ts`，这里只负责「把页面打开、然后断言」。
 *
 * 初始化边界阶段的覆盖范围比基线小，这是事实而不是妥协：样例路由（CRM 与内置演示）
 * 已经删除，STH 的组件层还没有开始实现，所以此刻能打开的页面确实只有这两条。
 * 已经删掉的那部分覆盖由下面的「词典」describe 顶上 —— 那些浮层（命令面板、账户菜单、
 * 通知、原型状态、个人资料、退出登录、引导向导、AI 摘要）的**默认文案已经住在词典里**，
 * 接线那天就会出现在真实界面上；先把它们检查掉，比等接线之后再补便宜。
 */

async function waitReady(page: Page) {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 })
}

test.describe("界面文案零英文泄漏", () => {
  test("html 声明 zh-CN", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN")
  })

  for (const route of LOCALIZED_ROUTES) {
    test(`${route} 渲染后没有未翻译的界面文案`, async ({ page }) => {
      await page.goto(route)
      await waitReady(page)
      await expectFullyLocalized(page, route)
    })
  }
})

test.describe("浮层与共享组件：默认文案已经住在词典里", () => {
  /**
   * 把词典里的**静态字符串**摊平。函数值（参数化模板，如
   * `page: (value) => \`第 ${value} 页\``）被跳过：调用一个模板函数需要参数，
   * 而用假参数去判定翻译质量会把探针的噪音当成产品的问题。模板的中文骨架在源码里、
   * 由人读；这里守的是那些**直接渲染到界面上**的静态文案。
   */
  function collectStrings(node: unknown, out: string[] = []): string[] {
    if (typeof node === "string") {
      out.push(node)
      return out
    }
    if (node && typeof node === "object") {
      for (const value of Object.values(node as Record<string, unknown>)) collectStrings(value, out)
    }
    return out
  }

  test("词典里的静态文案没有未翻译的西文", () => {
    // 这一条覆盖共享组件（CommandPalette / TopNav / Pagination / DetailDrawer /
    // OnboardingWizard / AiSummaryPanel / ProfileDialog / SignOutDialog …）的默认文案：
    // 它们现在没有可点开的实例，但文案本身已经存在，漏翻会在这里先红。
    const collected = collectStrings(zhCN)
    expect(collected.length, "词典必须真的被扫到内容").toBeGreaterThan(20)
    expect(findUntranslated(collected), "词典里出现了未翻译的西文文案").toEqual([])
  })
})

test.describe("首屏与 404", () => {
  test("首屏说的是 STH 自己的产品身份", async ({ page }) => {
    await page.goto("/")
    const h1 = page.getByRole("heading", { level: 1 })
    await expect(h1).toBeVisible()
    await expect(h1).toContainText("STH")
    // 首屏必须说清楚「这是什么产品」，而不是只有一句品牌名。
    await expect(page.getByText("AI 原生安全运营工作台").first()).toBeVisible()
    // 而且它必须诚实地标出阶段。**这一条跟着阶段事实走**（与 `landing` 文案同一条规矩：
    // 哪一批落盘了就改一次，否则这一页会开始说谎）——
    // 2026-09-17 组件批次 3 落盘之后，Agent 侧已经没有「待实现的面板」，只剩**待人决定的事项**：
    // 人眼验收与发布授权。所以这里钉的是那两件事，而不是上一批的「尚未开始」。
    await expect(page.getByText("待人决定的事项").first()).toBeVisible()
    await expect(page.getByText("人眼验收").first()).toBeVisible()
    await expect(page.getByText("发布授权").first()).toBeVisible()
    await expectFullyLocalized(page, "首屏")
  })

  test("404 页保留本地化", async ({ page }) => {
    await page.goto("/nowhere")
    await expect(page.getByTestId("app-not-found")).toBeVisible()
    await expectFullyLocalized(page, "404")
  })
})

test.describe("主题 token", () => {
  const TOKEN_NAMES = [
    "--background",
    "--surface",
    "--elevated",
    "--interactive",
    "--foreground",
    "--muted",
    "--border",
    "--accent",
    "--accent-soft",
    "--success",
    "--warning",
    "--danger",
    "--info",
    "--brand",
    "--elevation-subtle",
    "--elevation-card",
    "--elevation-floating",
    "--duration-press",
    "--duration-enter",
    "--duration-drawer",
    "--motion-ease-spring",
    "--radius",
  ]

  const readTokens = (page: Page) =>
    page.evaluate((names: string[]) => {
      const style = getComputedStyle(document.documentElement)
      return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name).trim()]))
    }, TOKEN_NAMES)

  test("Light 与 Dark 都提供完整的语义 token 且取值不同", async ({ page }) => {
    // 基线版本点的是 `/crm` 页上的主题切换按钮。首屏是 Server Component、没有状态，
    // 不存在那个按钮，但**被检查的性质没有变**：两套主题都必须解析出完整的语义 token，
    // 而且取值必须真的不同，否则「暗色主题」等于没生效。
    // 主题由 `<html>` 上的 class 承载、由系统偏好驱动，所以这里用 emulateMedia 驱动它，
    // 而不是去点一个不存在的按钮（也不要为了这条测试往首屏加一个假控件）。
    await page.emulateMedia({ colorScheme: "light" })
    await page.goto("/")
    await expect(page.locator("html")).not.toHaveClass(/dark/)
    const light = await readTokens(page)
    for (const [name, value] of Object.entries(light)) {
      expect(value, `${name} 必须在浅色主题下被声明`).not.toBe("")
    }

    await page.emulateMedia({ colorScheme: "dark" })
    await page.reload()
    await expect(page.locator("html")).toHaveClass(/dark/)
    const dark = await readTokens(page)
    for (const [name, value] of Object.entries(dark)) {
      expect(value, `${name} 必须在深色主题下被声明`).not.toBe("")
    }

    expect(dark["--background"]).not.toBe(light["--background"])
    expect(dark["--surface"]).not.toBe(light["--surface"])
    expect(dark["--elevation-card"]).not.toBe(light["--elevation-card"])
  })
})
