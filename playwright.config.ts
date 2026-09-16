import { defineConfig, devices } from "@playwright/test"

import { QA_HOST, QA_ORIGIN, QA_PORT } from "./.qa/qa.config.mjs"

/**
 * Playwright config — Factory v1.1.
 *
 * PORT ISOLATION (the important part)
 * -----------------------------------
 * v1.0.0 pointed `baseURL` and `webServer.url` at `http://localhost:3000` and set
 * `reuseExistingServer: !process.env.CI`. That combination has a specific, nasty
 * failure mode: Playwright's readiness probe is a plain HTTP GET whose success
 * condition is `200 <= status < 404`, and when it succeeds while
 * `reuseExistingServer` is truthy, Playwright returns immediately **without
 * checking that the responder is this app**. Port 3000 is Next's default, so a
 * stale dev server — or any sibling prototype — answering `/` would be adopted as
 * the app under test, and the whole suite could go green against the wrong page.
 *
 * (The sibling prototypes already work around this: hub pins 3100, ai-finance
 * 3210, ai-research 3230, kits 3300, and the Factory baseline keeps 3200. This
 * product pins 3310.)
 *
 * Factory v1.1 therefore:
 *   - pins a dedicated port that is not 3000 and not another prototype's
 *     (`QA_PORT` in `.qa/qa.config.mjs` — one source of truth),
 *   - pins the dev server to that port explicitly, so Next can never auto-bump
 *     to 3311 while `baseURL` still points at 3310,
 *   - sets `reuseExistingServer: false` unconditionally — the server is always
 *     started and always stopped by this run, so teardown can only ever kill a
 *     process we own,
 *   - leaves an occupied port to the pre-flight guard
 *     (`scripts/check-qa-port.mjs`, wired into the `test` script), which fails
 *     loudly and names the process instead of letting Playwright hang for 180s.
 *
 * Run it through `pnpm test` so the guard executes first; running
 * `pnpm exec playwright test` directly skips the guard (Playwright will still
 * refuse to reuse, it just reports less helpfully).
 */

const DEV_COMMAND = `pnpm dev --hostname ${QA_HOST} --port ${QA_PORT}`

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: QA_ORIGIN,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: DEV_COMMAND,
    // Readiness only. Points at `/` because that route always exists, so this
    // config stays independent of which routes a given product ships.
    url: `${QA_ORIGIN}/`,
    // Never adopt an existing server. Not `!process.env.CI` — always false.
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
