#!/usr/bin/env node
/**
 * Pre-flight QA port guard.
 *
 * WHY THIS EXISTS
 * ---------------
 * Playwright's `reuseExistingServer` will adopt *any* HTTP server that answers
 * the readiness URL with a 2xx/3xx — it performs no identity check whatsoever.
 * A stale dev server, or another prototype on the same port, therefore becomes
 * "the app under test", and the entire suite can go green against the wrong
 * page. That is not a theoretical hazard: it is the failure mode this Factory
 * was created to stop, and every sibling prototype on this machine races for the
 * same ports.
 *
 * Two independent defences, because either alone is insufficient:
 *   1. `reuseExistingServer: false` in playwright.config.ts — never adopt.
 *   2. This guard — fail *before* Playwright starts, with a message that names
 *      the process holding the port, instead of a confusing 180s timeout.
 *
 * It refuses to guess. It does not kill anything: killing an unknown process is
 * how you take down somebody else's work. It reports and exits non-zero.
 *
 * Usage: `node scripts/check-qa-port.mjs [port]`
 */

import { createConnection } from "node:net"

import { QA_HOST, QA_PORT } from "../.qa/qa.config.mjs"

const port = Number(process.argv[2] ?? QA_PORT)

/** Attempt one TCP connection. Resolves true when something is listening. */
function isPortInUse(host, candidatePort) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port: candidatePort })
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

const inUse = await isPortInUse(QA_HOST, port)

if (inUse) {
  const lines = [
    "",
    `\u001b[1mQA 端口被占用：${QA_HOST}:${port}\u001b[0m`,
    "",
    "QA 必须由当前 test run 自己启动 server，绝不复用已经存在的进程：",
    "Playwright 的 reuseExistingServer 只判断「有东西应答」，不判断「是不是这个应用」，",
    "一旦复用命中别的 server，整套断言会在错误的页面上通过。",
    "",
    "所以这里选择 fail loudly，而不是替你猜。请先确认这个端口上是什么，再决定是否停止它：",
    "",
    `  lsof -nP -iTCP:${port} -sTCP:LISTEN`,
    "",
    "不要使用 `pkill -f \"next dev\"` / `pkill -f \"next-server\"` —— 那会杀掉同机其它原型，",
    "甚至你自己的开发服务器。只停止你确认属于当前任务的那一个进程。",
    "",
    "换一个端口：改 .qa/qa.config.mjs 的 QA_PORT，",
    `或临时：node scripts/check-qa-port.mjs ${port + 1}`,
    "",
  ]
  process.stderr.write(lines.join("\n"))
  process.exit(1)
}

process.stdout.write(`\u001b[32m✓\u001b[0m QA 端口可用 ${QA_HOST}:${port}\n`)
process.exit(0)
