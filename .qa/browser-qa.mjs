#!/usr/bin/env node
/**
 * Prototype Factory · Browser QA sweep — LOCAL_MANAGED (v1.2)
 *
 * This entry point owns exactly one thing the sweep does not: **a dev server it
 * started itself, and stops itself.**
 *
 *   - it refuses to attach to a server it did not spawn (`scripts/check-qa-port.mjs`
 *     runs first, wired into `pnpm test`/`pnpm qa`; `reuseExistingServer: false`);
 *   - it spawns `pnpm dev` detached, so `process.kill(-pid)` reaches the real
 *     `next-server` grandchild instead of leaving it orphaned on the port;
 *   - on failure it prints the server's own output rather than guessing, and it
 *     knows about Next 16's **per-project** dev-server lock (`.next/dev/lock`).
 *
 * Everything else — every check, every threshold, every probe — lives in
 * `.qa/sweep.mjs`, shared with the remote runner (`.qa/online-qa.mjs`).
 * See `docs/browser-qa.md` for the standard, `docs/release-runbook.md` for where
 * the remote run fits in a release.
 *
 * Usage
 * -----
 *   pnpm qa                 # full sweep
 *   pnpm qa --routes=/demo  # subset
 *   pnpm qa --headed        # watch it
 *   pnpm qa --json          # machine-readable report
 */

import { spawn } from "node:child_process"
import { createConnection } from "node:net"

import { QA_HOST, QA_ORIGIN, QA_PORT, themes, viewports } from "./qa.config.mjs"
import { reportSweep, resolveRoutes, runSweep } from "./sweep.mjs"

/**
 * Progress line for the server *this* entry point manages.
 *
 * Not `note()`: that list belongs to a sweep run, and the local runner prints
 * these after the sweep has already been reported.
 */
function serverNote(message) {
  process.stdout.write(`  \u001b[33m!\u001b[0m ${message}\n`)
}

/* -------------------------------------------------------------------------- */
/* Server lifecycle (section 5)                                                */
/* -------------------------------------------------------------------------- */

function isPortInUse(host, port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port })
    const settle = (inUse) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(inUse)
    }
    socket.setTimeout(700)
    socket.once("connect", () => settle(true))
    socket.once("timeout", () => settle(false))
    socket.once("error", () => settle(false))
  })
}

async function waitForServer(origin, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin, { redirect: "manual" })
      if (response.status < 500) return true
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  return false
}

/**
 * Start the dev server ourselves, always.
 *
 * We never attach to a server we did not spawn: an unrelated process answering
 * on this port would make every assertion below meaningless while still
 * reporting green.
 *
 * The child is spawned **detached**, i.e. as its own process group, because
 * `pnpm dev` is a wrapper: killing the `pnpm` process leaves the real
 * `next-server` grandchild orphaned and holding the port. That is not
 * hypothetical — the first version of this script leaked exactly that way, and
 * the next run then failed the port guard. Killing the process *group* is what
 * makes "only stop what you started" actually true.
 */
async function startOwnServer(projectRoot) {
  if (await isPortInUse(QA_HOST, QA_PORT)) {
    throw new Error(
      `QA 端口 ${QA_HOST}:${QA_PORT} 已被占用。\n` +
        "  QA 不复用任何已存在的 server：一旦接到别的进程上，整套断言都会在错误的页面上通过。\n" +
        `  查看占用者：lsof -nP -iTCP:${QA_PORT} -sTCP:LISTEN\n` +
        "  确认那确实属于当前任务后再单独停止它。\n" +
        '  不要用 pkill -f "next dev" / pkill -f "next-server"（会误杀同机其它原型）。',
    )
  }
  const child = spawn(
    "pnpm",
    ["dev", "--hostname", QA_HOST, "--port", String(QA_PORT)],
    {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      detached: true,
    },
  )
  // Keep the server's own output. It is discarded on the happy path, but on a
  // startup failure it is the only thing that explains *why* — a compile error,
  // a stale project lock, a missing dependency. Printing it beats guessing.
  const serverOutput = []
  const capture = (chunk) => {
    serverOutput.push(chunk.toString())
    if (serverOutput.length > 200) serverOutput.shift()
  }
  child.stdout.on("data", capture)
  child.stderr.on("data", capture)

  const ready = await waitForServer(QA_ORIGIN)
  if (!ready) {
    await stopOwnServer(child)
    throw new Error(
      `dev server 未能在 ${QA_ORIGIN} 就绪。\n` +
        serverDiagnosis(serverOutput.join("")) +
        "  server 自己的输出（最后 40 行）：\n" +
        serverOutput
          .join("")
          .split("\n")
          .slice(-40)
          .map((line) => `    │ ${line}`)
          .join("\n"),
    )
  }
  return child
}

/**
 * Turn Next's most confusing startup failure into an actionable message.
 *
 * `next dev` takes a **per-project** singleton lock (`.next/dev/lock`), not a
 * per-port one. So a second dev server for this project refuses to start *even
 * on a different port* — and if a previous server was killed uncleanly, its
 * stale pid in that lock keeps blocking every later run while the port itself
 * looks perfectly free. The bare error ("Another next dev server is already
 * running") points at a symptom in the wrong place.
 */
function serverDiagnosis(output) {
  if (!/Another next dev server is already running/i.test(output)) return ""
  const pid = output.match(/- PID:\s+(\d+)/)?.[1]
  return (
    "  ⚠ Next 16 的 dev server 是**按项目**加锁的（.next/dev/lock），不是按端口。\n" +
    "    同一个项目不能再起第二个 `next dev`，即使端口不同；而且上一次被强杀的服务\n" +
    "    会在 lock 里留下过期 pid，让之后每一次启动都失败——而端口看起来是空的。\n" +
    (pid
      ? `    定位到的 pid：${pid}。确认它属于本项目后再停止：kill -9 ${pid}\n`
      : "") +
    "    另外：`pnpm test` 与 `pnpm qa` 不能同时跑，它们抢同一个项目锁。\n"
  )
}

/** Stop only the process group this run started, then confirm the port is free. */
async function stopOwnServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const signal = (name) => {
    try {
      // Negative pid targets the whole group (we spawned detached).
      process.kill(-child.pid, name)
    } catch {
      try {
        child.kill(name)
      } catch {
        /* already gone */
      }
    }
  }
  signal("SIGTERM")
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 150))
    if (!(await isPortInUse(QA_HOST, QA_PORT))) {
      serverNote(`QA server 已停止（pid ${child.pid} 进程组），端口 ${QA_PORT} 已释放`)
      return
    }
  }
  signal("SIGKILL")
  await new Promise((resolve) => setTimeout(resolve, 400))
  if (await isPortInUse(QA_HOST, QA_PORT)) {
    serverNote(
      `QA server 可能未完全停止：端口 ${QA_PORT} 仍被占用（pid ${child.pid}）。` +
        "下次运行会由端口守卫拦下并给出定位命令。",
    )
  } else {
    serverNote(`QA server 已在 SIGKILL 后停止（pid ${child.pid}）`)
  }
}


/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

async function main() {
  const projectRoot = process.cwd()
  const routeOverride = process.argv.find((arg) => arg.startsWith("--routes="))
  const overrideList = routeOverride
    ? routeOverride.slice("--routes=".length).split(",").map((r) => r.trim()).filter(Boolean)
    : null
  const json = process.argv.includes("--json")

  const { usable, dynamic } = resolveRoutes(projectRoot, overrideList)
  if (dynamic.length > 0) {
    process.stderr.write(
      `动态路由无法静态发现，已跳过：${dynamic.join(", ")}（用 .qa/qa.config.mjs 的 extraRoutes 补具体路径）\n`,
    )
  }
  if (usable.length === 0) {
    process.stderr.write("没有可扫描的路由。请检查 .qa/qa.config.mjs 或 app/ 目录。\n")
    process.exit(1)
  }

  if (!json) {
    process.stdout.write(
      `\n\u001b[1mPrototype Factory · Browser QA (local)\u001b[0m\n` +
        `  mode      LOCAL_MANAGED（本次运行自己起 server、自己停）\n` +
        `  origin    ${QA_ORIGIN}\n` +
        `  routes    ${usable.length} 条（${usable.join(", ")}）\n` +
        `  viewports ${viewports.map((v) => `${v.name} ${v.width}×${v.height}`).join(" · ")}\n` +
        `  themes    ${themes.join(" · ")}\n`,
    )
  }

  let child = null
  let result
  try {
    child = await startOwnServer(projectRoot)
    if (!json) process.stdout.write(`  server    已由本次运行启动（pid ${child.pid}）\n\n`)
    result = await runSweep({
      origin: QA_ORIGIN,
      routes: usable,
      headed: process.argv.includes("--headed"),
    })
  } catch (error) {
    result = { failures: [`environment — ${error.message}`], notes: [], checksRun: 1 }
  } finally {
    await stopOwnServer(child)
  }

  const code = reportSweep(result, { label: "Browser QA (local)", json, origin: QA_ORIGIN })
  if (json) for (const line of result.notes) process.stderr.write(`${line}\n`)
  process.exit(code)
}

main().catch((error) => {
  process.stderr.write(`QA 运行失败: ${error?.stack ?? error}\n`)
  process.exit(1)
})
