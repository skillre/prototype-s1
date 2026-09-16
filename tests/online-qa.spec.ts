import { execFile } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { expect, test } from "@playwright/test"

import { parseArgs, probeAccess } from "../.qa/online-qa.mjs"
import { QA_ORIGIN } from "../.qa/qa.config.mjs"
import { runSweep } from "../.qa/sweep.mjs"

const execFileAsync = promisify(execFile)

/**
 * Tests for the online (REMOTE) QA entry point — Factory v1.2 · ONLINE.
 *
 * The thing under test is an **observer**: it sweeps a URL this run does not
 * own, and its job is to refuse to answer when it cannot know what it is looking
 * at. So most of these tests are about what the runner does *not* do — it does
 * not treat protection as a deployment failure, does not call a protected URL
 * public, does not create a bypass token, does not start a server, does not
 * mutate a deployment, and does not print a secret.
 *
 * Two properties are pinned structurally as well as behaviourally
 * (`prose is not code` cuts both ways: a test that only reads a document proves
 * the document exists, not that the runner obeys it).
 *
 * `QA_ORIGIN` is the dev server Playwright starts for this suite — i.e. a URL
 * owned by *somebody else*, which is exactly the REMOTE contract. Runs that
 * would sweep every discovered route are trimmed with `--routes=/`.
 */

const ROOT = process.cwd()
const RUNNER = join(ROOT, ".qa/online-qa.mjs")
const LOCAL_ENTRY = join(ROOT, ".qa/browser-qa.mjs")
const SWEEP = join(ROOT, ".qa/sweep.mjs")

/** A real Preview deployment record (shape returned by `GET /v13/deployments/{id}`). */
const PREVIEW_RECORD = {
  id: "dpl_5Qm2hZcLk9sVd3rXbT1pNwY8aKfE",
  url: "prototype-ai-research-7f3c2a-preview.vercel.app",
  target: "preview",
  readyState: "READY",
  gitSource: { type: "github", ref: "feature/ai-research", sha: "3858f3cdc953d4de0be1019c0ad654d754d4cb64" },
}

const readSource = (path: string) => readFileSync(path, "utf8")

function recordFile(record: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "factory-online-"))
  const path = join(dir, "deployment.json")
  writeFileSync(path, typeof record === "string" ? record : JSON.stringify(record, null, 2))
  return path
}

interface RunResult {
  status: number
  stdout: string
  stderr: string
}

/**
 * Run the real CLI.
 *
 * Asynchronous on purpose: the fixtures in this file are HTTP servers living in
 * *this* process, so a synchronous `execFileSync` would block the event loop
 * that has to answer them — and the child would see a hung connection, not a
 * protected URL. (That failure was observed, not theorised.)
 */
async function runRunner(args: string[], env: Record<string, string> = {}): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [RUNNER, ...args], {
      encoding: "utf8",
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, QA_ONLINE_BYPASS_SECRET: "", ...env },
    })
    return { status: 0, stdout, stderr }
  } catch (error) {
    const failure = error as { code?: unknown; stdout?: string; stderr?: string }
    return {
      status: typeof failure.code === "number" ? failure.code : -1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    }
  }
}

type FixtureMode =
  | "public"
  | "sso"
  | "unauthorized"
  | "other-redirect"
  | "bare-page"
  | "overflow-desktop"
  | "header-only"
  | "invisible-semantics"

interface Fixture {
  origin: string
  requests: Array<{ method: string; path: string; bypass: string | undefined }>
  close: () => Promise<void>
}

/**
 * A tiny origin, so that "protected" and "public" are real HTTP states rather
 * than mocks. Port 0 = an ephemeral port, so nothing races with the QA port.
 */
async function startFixture(mode: FixtureMode): Promise<Fixture> {
  const requests: Fixture["requests"] = []
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://fixture.invalid").pathname
    const bypass = request.headers["x-vercel-protection-bypass"]
    requests.push({
      method: request.method ?? "",
      path,
      bypass: typeof bypass === "string" ? bypass : undefined,
    })

    if (mode === "sso" || (mode === "header-only" && bypass === undefined)) {
      response.writeHead(302, { location: "https://vercel.com/sso-api?url=https%3A%2F%2Ffixture.invalid%2F" })
      response.end()
      return
    }
    if (mode === "unauthorized") {
      response.writeHead(401, { "content-type": "text/plain" })
      response.end("Authentication required")
      return
    }
    if (mode === "other-redirect") {
      response.writeHead(307, { location: "https://example.com/elsewhere" })
      response.end()
      return
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    if (mode === "bare-page") {
      response.end(
        "<!doctype html><html><head><title>bare</title></head><body><main><p>裸页面</p></main></body></html>",
      )
      return
    }
    if (mode === "overflow-desktop") {
      // 一条 2000px 宽的块：在 1440px 的桌面视口下必然横向溢出。本仓的视口矩阵
      // 只有 desktop（见 `.qa/qa.config.mjs` 里那段签署理由），所以「布局判据真的
      // 在 REMOTE 里执行了」必须用一个**桌面能触发**的缺陷来证明，而不是那个只在
      // 移动上下文里出现的布局视口扩张。
      response.end(
        '<!doctype html><html><head><title>overflow</title></head><body><main><p>溢出</p></main><div style="width:2000px;height:40px;background:#333"></div></body></html>',
      )
      return
    }
    if (mode === "invisible-semantics") {
      // The AI Finance K-01 shape: a real content ancestor carrying aria-hidden,
      // with a live control inside it. Styled, so style-presence stays quiet and
      // the only finding is the semantics one.
      response.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>hidden host</title>
<style>
  html, body { margin: 0; }
  body { font-family: "Helvetica Neue", Helvetica, sans-serif; background-color: rgb(250, 250, 250); color: rgb(17, 17, 17); }
  main { max-width: 60rem; margin: 0 auto; padding: 24px; }
</style></head><body>
<main>
  <h1>隐藏宿主</h1>
  <section aria-hidden="true"><button type="button">仍然可聚焦</button></section>
</main>
</body></html>`)
      return
    }
    response.end("<!doctype html><html><head><title>fixture</title></head><body><main><p>ok</p></main></body></html>")
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}

test.describe.configure({ timeout: 180_000 })

/* -------------------------------------------------------------------------- */
/* Reachability is three states, not pass/fail                                 */
/* -------------------------------------------------------------------------- */

test.describe("可达性是三分，不是通过/失败", () => {
  test("匿名 2xx → public", async () => {
    const fixture = await startFixture("public")
    try {
      const access = await probeAccess(fixture.origin)
      expect(access.access).toBe("public")
      expect(access.status).toBe(200)
    } finally {
      await fixture.close()
    }
  })

  test("302 跳 SSO → protected，不得称为 public", async () => {
    const fixture = await startFixture("sso")
    try {
      const access = await probeAccess(fixture.origin)
      expect(access.access).toBe("protected")
      expect(access.access).not.toBe("public")
      expect(access.location).toContain("sso")
      expect(access.message).toContain("protected")
    } finally {
      await fixture.close()
    }
  })

  test("401 → protected（不是失败，也不是 public）", async () => {
    const fixture = await startFixture("unauthorized")
    try {
      const access = await probeAccess(fixture.origin)
      expect(access.access).toBe("protected")
      expect(access.message).toContain("不得称为 public")
    } finally {
      await fixture.close()
    }
  })

  test("302 但不是 SSO → 仍然不是 public", async () => {
    const fixture = await startFixture("other-redirect")
    try {
      const access = await probeAccess(fixture.origin)
      expect(access.access).not.toBe("public")
      expect(access.message).toContain("跟随重定向后重新判断")
    } finally {
      await fixture.close()
    }
  })

  test("连不上 → unreachable，且不被说成 protected 或失败", async () => {
    const closed = await startFixture("public")
    const origin = closed.origin
    await closed.close()

    const access = await probeAccess(origin)
    expect(access.access).toBe("unreachable")
    expect(access.status).toBeNull()
    expect(access.message).toContain("无法连接")
  })
})

/* -------------------------------------------------------------------------- */
/* Refusing to run                                                             */
/* -------------------------------------------------------------------------- */

test.describe("无法确知自己在看什么的时候，runner 拒绝运行", () => {
  test("没有 --base-url → 用法错误（exit 2），并说明这是 REMOTE", async () => {
    const result = await runRunner([])
    expect(result.status).toBe(2)
    const output = `${result.stdout}${result.stderr}`
    expect(output).toContain("缺少 --base-url")
    expect(output).toContain("REMOTE")
    expect(output).toContain("不会启动本地 server")
  })

  test("受 SSO 保护且没有 secret → exit 1，并明说这不是部署失败", async () => {
    const fixture = await startFixture("sso")
    try {
      const result = await runRunner([`--base-url=${fixture.origin}`])
      const output = `${result.stdout}${result.stderr}`

      expect(result.status).toBe(1)
      expect(output).toContain("这个 URL 受保护（这不是部署失败）")
      expect(output).toContain("QA_ONLINE_BYPASS_SECRET")
      expect(output).not.toContain("✗ QA FAILED")
      // It must not quietly answer the question anyway.
      expect(output).not.toContain("QA OK")
    } finally {
      await fixture.close()
    }
  })

  test("给了期望值却没有部署记录 → 不跑（无法确认 ≠ 确认过没问题）", async () => {
    const result = await runRunner([`--base-url=${QA_ORIGIN}`, "--expect-sha=3858f3cdc953d4de0be1019c0ad654d754d4cb64"])
    const output = `${result.stdout}${result.stderr}`

    expect(result.status).toBe(1)
    expect(output).toContain("NOT RUN")
    expect(output).toContain("无法确认")
    expect(output).not.toContain("QA OK")
  })

  test("部署记录读不出来 → 不跑", async () => {
    const notJson = recordFile("{ not json")
    const missing = join(tmpdir(), "factory-online-does-not-exist.json")

    for (const path of [notJson, missing]) {
      const result = await runRunner([`--base-url=${QA_ORIGIN}`, `--identity=${path}`])
      const output = `${result.stdout}${result.stderr}`
      expect(result.status).toBe(1)
      expect(output).toContain("NOT RUN")
      expect(output).not.toContain("QA OK")
    }
  })

  test("身份不完整（缺 readyState）→ 不跑", async () => {
    const path = recordFile({
      id: "dpl_incomplete",
      target: "preview",
      gitSource: { ref: "feature/x", sha: "3858f3cdc953d4de0be1019c0ad654d754d4cb64" },
    })
    const result = await runRunner([`--base-url=${QA_ORIGIN}`, `--identity=${path}`])
    const output = `${result.stdout}${result.stderr}`

    expect(result.status).toBe(1)
    expect(output).toContain("部署身份不完整")
    expect(output).toContain("readyState")
    expect(output).not.toContain("QA OK")
  })

  test("身份与期望不一致 → 在跑 QA **之前** STOP", async () => {
    const path = recordFile(PREVIEW_RECORD)
    const result = await runRunner([
      `--base-url=${QA_ORIGIN}`,
      `--identity=${path}`,
      "--expect-ref=feature/something-else",
    ])
    const output = `${result.stdout}${result.stderr}`

    expect(result.status).toBe(1)
    expect(output).toContain("STOP")
    expect(output).toContain("期望 feature/something-else")
    expect(output).toContain("正是这一步要防的事")
    // The sweep never ran: no check result, no pass.
    expect(output).not.toContain("QA OK")
    expect(output).not.toContain("项检查")
  })
})

/* -------------------------------------------------------------------------- */
/* An observer, never an orchestrator                                          */
/* -------------------------------------------------------------------------- */

test.describe("只观察，不编排", () => {
  test("在线入口不启动 server，也不持有 server 生命周期", () => {
    const online = readSource(RUNNER)
    const local = readSource(LOCAL_ENTRY)

    // Non-vacuous: the local entry *does* own a server, so the absence below is
    // a real difference between the two modes rather than a property of the repo.
    expect(local).toContain('from "node:child_process"')
    expect(local).toContain("startOwnServer")

    expect(online).not.toContain("node:child_process")
    expect(online).not.toContain("spawn(")
    expect(online).not.toContain("next dev")
    expect(online).not.toContain("check-qa-port")
    expect(online).toContain("REMOTE")
  })

  test("在线入口不碰部署：没有 vercel CLI，没有写文件，没有 token 创建", () => {
    const online = readSource(RUNNER)

    expect(online).not.toMatch(/vercel\s+(deploy|promote|link|project)/)
    expect(online).not.toContain("writeFileSync")
    expect(online).not.toContain("appendFileSync")
    expect(online).not.toContain("createBypassToken")
    // The secret exists as an input and a header, in one place each.
    expect(online.match(/QA_ONLINE_BYPASS_SECRET/g)?.length).toBeGreaterThan(0)
    expect(online).toContain("x-vercel-protection-bypass")
  })

  test("扫描别人的 URL 时只发 GET，且不请求任何部署/令牌端点", async () => {
    const fixture = await startFixture("bare-page")
    try {
      await runSweep({ origin: fixture.origin, routes: ["/"] })
      expect(fixture.requests.length).toBeGreaterThan(0)

      const methods = [...new Set(fixture.requests.map((entry) => entry.method))]
      expect(methods).toEqual(["GET"])

      const suspicious = fixture.requests.filter((entry) =>
        /deployments|bypass|token|protection|api\/v\d/i.test(entry.path),
      )
      expect(suspicious).toEqual([])
    } finally {
      await fixture.close()
    }
  })

  test("它扫描的 server 不被它关掉（server 归别人管）", async () => {
    const before = await fetch(`${QA_ORIGIN}/`)
    expect(before.status).toBe(200)

    const result = await runRunner([
      `--base-url=${QA_ORIGIN}`,
      `--identity=${recordFile(PREVIEW_RECORD)}`,
      "--expect-ref=feature/ai-research",
      "--routes=/",
    ])
    expect(result.status).toBe(0)

    const after = await fetch(`${QA_ORIGIN}/`)
    expect(after.status).toBe(200)
  })

  test("secret 只作为请求头进入，不打印、不持久化", async () => {
    const secret = "s3cr3t-bypass-do-not-leak"
    const fixture = await startFixture("header-only")
    try {
      const result = await runRunner([`--base-url=${fixture.origin}`, "--routes=/"], {
        QA_ONLINE_BYPASS_SECRET: secret,
      })
      const output = `${result.stdout}${result.stderr}`

      // It really was sent — as a header, on the page requests.
      const withHeader = fixture.requests.filter((entry) => entry.bypass === secret)
      expect(withHeader.length).toBeGreaterThan(0)

      // …and it never appears in anything this run produced.
      expect(output).not.toContain(secret)
      expect(output).toContain("不打印、不持久化")
    } finally {
      await fixture.close()
    }
  })
})

/* -------------------------------------------------------------------------- */
/* The same criteria as the local sweep                                        */
/* -------------------------------------------------------------------------- */

test.describe("线上扫描与本地扫描共用同一套判据", () => {
  test("两个入口都只从 `.qa/sweep.mjs` 拿判据（没有第二套真相）", () => {
    for (const entry of [LOCAL_ENTRY, RUNNER]) {
      const source = readSource(entry)
      expect(source).toContain('from "./sweep.mjs"')
      expect(source).toContain("runSweep")
      // Probes are imported by the sweep, never by an entry point — a second
      // entry point that imported its own probes would be a second truth.
      expect(source).not.toContain("probe-guard.mjs")
      expect(source).not.toContain("style-presence.mjs")
      expect(source).not.toContain("ax-tree.mjs")
      expect(source).not.toContain("probes.mjs")
    }

    const sweep = readSource(SWEEP)
    for (const probe of ["probe-guard.mjs", "style-presence.mjs", "ax-tree.mjs", "probes.mjs"]) {
      expect(sweep).toContain(probe)
    }
    expect(sweep).toContain("stylePresenceMinChannels")
  })

  test("对着别人的 URL 跑，判据真的执行了（不是空扫描）", async () => {
    const result = await runSweep({ origin: QA_ORIGIN, routes: ["/"] })

    // A run that measured nothing must never look like a run that passed.
    expect(result.checksRun).toBeGreaterThan(0)
    expect(result.failures).toEqual([])
  })

  test("REMOTE 也跑真实的布局与样式判据（裸页面与横向溢出都会被抓住）", async () => {
    const fixture = await startFixture("bare-page")
    try {
      const result = await runSweep({ origin: fixture.origin, routes: ["/"] })
      const failures = result.failures.join("\n")

      // The unstyled baseline comparison runs online too. This is the criterion
      // that catches an unstyled page from a remote origin, and it quotes the
      // measurement rather than a verdict.
      expect(failures).toContain("style-loaded")
      expect(failures).toContain("浏览器默认样式态")
      expect(failures).toContain("UA baseline")
      expect(result.checksRun).toBeGreaterThan(5)
    } finally {
      await fixture.close()
    }

    // 基线的这一条断言的是 `viewport expansion`：一个**只在移动上下文里**出现的
    // 症状（无 viewport meta 时 Chromium 会扩张布局视口）。本产品已按人签署的决定
    // 把移动视口从矩阵里移除，所以那个字符串不再可能出现 —— 但「REMOTE 执行真实
    // 布局判据」这条性质不能跟着消失，改为用桌面会触发的同一类缺陷取证：
    // 2000px 的块在 1440px 视口下必须被判横向溢出。
    const overflowing = await startFixture("overflow-desktop")
    try {
      const result = await runSweep({ origin: overflowing.origin, routes: ["/"] })
      const failures = result.failures.join("\n")
      expect(failures).toContain("horizontal overflow")
      // 并且它复述的是量到的两个数字（+ 超出多少），不是一个判断词。
      expect(failures).toMatch(
        /horizontal overflow: documentElement\.scrollWidth \d+px > 请求宽度 1440px（超出 \d+px）/,
      )
    } finally {
      await overflowing.close()
    }
  })

  test("REMOTE 也跑 No Invisible Semantics（DOM==AX 的配套扫描真的在线上生效）", async () => {
    const fixture = await startFixture("invisible-semantics")
    try {
      const result = await runSweep({ origin: fixture.origin, routes: ["/"] })
      const failures = result.failures.join("\n")

      // Parity alone stays quiet here — pruning removes the node from *both*
      // sides — so the paired aria-hidden-host scan is what has to fire.
      expect(failures).toContain("aria-hidden 祖先里仍有可交互内容")
      expect(failures).toContain("装饰性元素才允许 aria-hidden")
    } finally {
      await fixture.close()
    }
  })

  test("--json 输出的是一份可解析的机器报告（且仍然不含 secret）", async () => {
    const secret = "s3cr3t-bypass-do-not-leak"
    const result = await runRunner(
      [
        `--base-url=${QA_ORIGIN}`,
        `--identity=${recordFile(PREVIEW_RECORD)}`,
        `--expect-sha=${PREVIEW_RECORD.gitSource.sha}`,
        "--expect-ref=feature/ai-research",
        "--routes=/",
        "--json",
      ],
      { QA_ONLINE_BYPASS_SECRET: secret },
    )

    expect(result.status).toBe(0)
    const report = JSON.parse(result.stdout) as {
      ok: boolean
      status: string
      baseUrl: string
      access: { access: string }
      identity: { verified: boolean; target: string; ref: string; sha: string }
      expectations: { sha: string | null }
      bypass: string
      checksRun: number
      failures: string[]
    }

    expect(report.ok).toBe(true)
    expect(report.status).toBe("passed")
    expect(report.baseUrl).toBe(QA_ORIGIN)
    expect(report.access.access).toBe("public")
    expect(report.identity.verified).toBe(true)
    expect(report.identity.target).toBe("preview")
    expect(report.identity.sha).toBe(PREVIEW_RECORD.gitSource.sha)
    expect(report.checksRun).toBeGreaterThan(0)
    expect(report.failures).toEqual([])
    expect(report.bypass).toBe("present (redacted)")
    expect(result.stdout).not.toContain(secret)
    expect(result.stderr).not.toContain(secret)
  })
})

/* -------------------------------------------------------------------------- */
/* Argument plumbing                                                           */
/* -------------------------------------------------------------------------- */

test.describe("参数解析", () => {
  test("--flag=value 与 --flag value 两种写法都认", () => {
    const inline = parseArgs(["--base-url=https://x.test", "--expect-sha=abc12345"])
    expect(inline.get("base-url")).toBe("https://x.test")
    expect(inline.get("expect-sha")).toBe("abc12345")

    const spaced = parseArgs(["--base-url", "https://y.test", "--routes=/a,/b"])
    expect(spaced.get("base-url")).toBe("https://y.test")
    expect(spaced.get("routes")).toBe("/a,/b")
  })
})
