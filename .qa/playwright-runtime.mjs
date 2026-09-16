/**
 * Playwright runtime for the QA sweep.
 *
 * Kept as its own module for one reason: it turns "Playwright is not installed"
 * from an opaque module-resolution stack trace into an actionable message. The
 * Factory must be runnable by an agent from a clean clone, and the first failure
 * a clean clone hits is the missing browser, not a code bug.
 */

let playwright

try {
  // `@playwright/test` re-exports the browser types and `chromium`. Importing it
  // (rather than `playwright`) means the QA sweep and `pnpm test` share exactly
  // one installed version — there is no second copy to drift.
  playwright = await import("@playwright/test")
} catch (error) {
  throw new Error(
    "无法加载 @playwright/test。\n" +
      "  1. pnpm install\n" +
      "  2. pnpm exec playwright install chromium\n" +
      `原始错误：${error.message}`,
  )
}

export const { chromium } = playwright
