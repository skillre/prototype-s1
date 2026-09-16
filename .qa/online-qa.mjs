#!/usr/bin/env node
/**
 * Prototype Factory · Online QA — REMOTE (v1.2)
 *
 * ===========================================================================
 * What this is
 * ===========================================================================
 * The same sweep, pointed at a URL this run does not own. `pnpm qa` proves the
 * tree is correct in a dev server; it cannot prove that a **deployment** serves
 * the right commit over HTTPS behind a platform's protection layer. The third
 * prototype shipped through a Preview whose stylesheet never reached the
 * browser — the local sweep cannot see that class of failure at all, and a
 * deployed one can (same probes, real URL).
 *
 * ===========================================================================
 * What this is NOT
 * ===========================================================================
 * It is an **observer**, never an orchestrator. It does not deploy, does not
 * create or link a project, does not promote, does not merge or tag, and it
 * never touches a credential's lifecycle:
 *
 *   - no local server is started (REMOTE mode has no server to manage);
 *   - no bypass token is created — if one is needed and nobody supplied one,
 *     the run STOPS and says so;
 *   - a secret provided by the operator is consumed as a request header only:
 *     never printed, never persisted, never committed;
 *   - deployment mutation belongs to `scripts/verify-deployment.mjs`, which is
 *     a different tool with a different authorization contract.
 *
 * ===========================================================================
 * Reachability is not pass/fail
 * ===========================================================================
 * A protected Preview answers `302 → vercel.com/sso` (or 401). That is the
 * platform working, **not** a broken deployment, and not "public" either. The
 * three states are kept apart on purpose — see `docs/release-runbook.md`.
 *
 *   pnpm qa:online --base-url=https://x-preview.vercel.app \
 *     --identity=deployment.json --expect-sha=<rc-sha>
 *
 *   QA_ONLINE_BYPASS_SECRET=… pnpm qa:online --base-url=…   # authorized bypass
 */

import { existsSync, readFileSync } from "node:fs"

import {
  classifyUrlAccess,
  verifyDeploymentIdentity,
} from "../scripts/lib/deploy-contract.mjs"
import { resolveRoutes, reportSweep, runSweep } from "./sweep.mjs"

const EXIT = { OK: 0, FAIL: 1, USAGE: 2 }

/**
 * Env var that carries an **already-authorized** automation bypass secret.
 *
 * `vercel curl` creates one as a side effect; that side effect is governed by
 * the DEPLOY contract and is not this runner's business. Here the secret is an
 * input, and only ever an input.
 */
const BYPASS_ENV = "QA_ONLINE_BYPASS_SECRET"

/** Header the platform expects for an automation bypass. */
const BYPASS_HEADER = "x-vercel-protection-bypass"

export function parseArgs(argv) {
  const flags = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith("--")) continue
    const [name, inline] = token.slice(2).split("=")
    if (inline !== undefined) flags.set(name, inline)
    else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      flags.set(name, argv[index + 1])
      index += 1
    } else flags.set(name, true)
  }
  return flags
}

/**
 * Decide whether online QA can run, and report which of the three reachability
 * states the URL is in.
 *
 * @returns {Promise<{access: "public"|"protected"|"unreachable", status: number|null, location: string|null, message: string}>}
 */
export async function probeAccess(baseUrl, { fetchImpl = fetch } = {}) {
  let response
  try {
    response = await fetchImpl(baseUrl, { redirect: "manual", headers: { "cache-control": "no-cache" } })
  } catch (error) {
    return {
      access: "unreachable",
      status: null,
      location: null,
      message: `无法连接 ${baseUrl}：${error.message}。「连不上」既不是 protected 也不是失败的原因——先确认地址与网络。`,
    }
  }
  const location = response.headers.get("location")
  const verdict = classifyUrlAccess({ status: response.status, location })
  return {
    access: verdict.publicLabelAllowed ? "public" : verdict.access === "redirect" ? "protected" : verdict.access,
    status: response.status,
    location,
    message: verdict.message,
  }
}

function emit(report, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return
  }
  process.stdout.write("\n\u001b[1mPrototype Factory · Online QA (remote)\u001b[0m\n")
  for (const line of report.lines) process.stdout.write(`${line}\n`)
  process.stdout.write("\n")
}

async function main() {
  const flags = parseArgs(process.argv.slice(2))
  const asJson = flags.get("json") === true
  const baseUrl = typeof flags.get("base-url") === "string" ? flags.get("base-url") : null
  const bypassSecret = process.env[BYPASS_ENV] ?? null

  if (!baseUrl) {
    emit(
      {
        ok: false,
        status: "usage",
        lines: [
          "✗ 缺少 --base-url。",
          "  用法：pnpm qa:online --base-url=https://<deployment> [--identity=<json>] [--expect-sha=<sha>] [--expect-ref=<ref>] [--expect-target=preview|production]",
          "  这是 REMOTE 模式：不会启动本地 server，也不会碰任何部署。",
        ],
      },
      asJson,
    )
    process.exit(EXIT.USAGE)
  }

  const lines = [`  base-url  ${baseUrl}`]

  // ---- reachability ------------------------------------------------------
  const access = await probeAccess(baseUrl)
  lines.push(`  access    ${access.access}（HTTP ${access.status ?? "—"}${access.location ? ` → ${access.location}` : ""}）`)
  lines.push(`            ${access.message}`)

  if (access.access === "unreachable") {
    lines.push("")
    lines.push("✗ NOT RUN — 地址不可达")
    emit({ ok: false, status: "unreachable", baseUrl, access, lines }, asJson)
    process.exit(EXIT.FAIL)
  }
  if (access.access === "protected" && !bypassSecret) {
    lines.push("")
    lines.push("✗ NOT RUN — 这个 URL 受保护（这不是部署失败）")
    lines.push("  受 SSO / Deployment Protection 保护的 Preview 是平台的正常工作状态。")
    lines.push(`  要跑在线 QA：由**用户**提供已授权的 bypass secret，放进 ${BYPASS_ENV} 环境变量；`)
    lines.push("  本 runner 不会自己创建 token，也不会关闭保护（那是 DEPLOY contract 管的事）。")
    emit({ ok: false, status: "protected", baseUrl, access, lines }, asJson)
    process.exit(EXIT.FAIL)
  }

  // ---- identity BEFORE any QA -------------------------------------------
  const expectSha = typeof flags.get("expect-sha") === "string" ? flags.get("expect-sha") : null
  const expectRef = typeof flags.get("expect-ref") === "string" ? flags.get("expect-ref") : null
  const expectTarget = typeof flags.get("expect-target") === "string" ? flags.get("expect-target") : null
  const identityPath = typeof flags.get("identity") === "string" ? flags.get("identity") : null
  const expectations = { sha: expectSha, ref: expectRef, target: expectTarget }
  const hasExpectations = Object.values(expectations).some(Boolean)

  let identity = { provided: false, verified: false, described: null }
  if (identityPath) {
    if (!existsSync(identityPath)) {
      lines.push(`\n✗ NOT RUN — 找不到 deployment record：${identityPath}`)
      emit({ ok: false, status: "identity-missing", baseUrl, access, lines }, asJson)
      process.exit(EXIT.FAIL)
    }
    let record
    try {
      record = JSON.parse(readFileSync(identityPath, "utf8"))
    } catch (error) {
      lines.push(`\n✗ NOT RUN — 无法解析 deployment record：${error.message}`)
      emit({ ok: false, status: "identity-unreadable", baseUrl, access, lines }, asJson)
      process.exit(EXIT.FAIL)
    }
    const described = verifyDeploymentIdentity(record)
    identity = { provided: true, verified: described.ok, described: described.described }
    if (!described.ok) {
      lines.push(`\n✗ NOT RUN — 部署身份不完整：${described.message}`)
      emit({ ok: false, status: "identity-incomplete", baseUrl, access, identity, lines }, asJson)
      process.exit(EXIT.FAIL)
    }
    lines.push(
      `  identity  ${described.described.target} · ${described.described.ref} @ ${described.described.sha.slice(0, 12)} · ${described.described.readyState}`,
    )
  } else if (hasExpectations) {
    // Expectations without a record cannot be checked — and "cannot be checked"
    // must never be reported as "checked and fine".
    lines.push("")
    lines.push("✗ NOT RUN — 给了期望值，却没有给 deployment record（--identity=<json>）")
    lines.push("  无法确认这次 QA 跑的是不是你指定那一版，所以不跑。")
    emit({ ok: false, status: "identity-unverifiable", baseUrl, access, lines }, asJson)
    process.exit(EXIT.FAIL)
  } else {
    lines.push("  identity  未提供（本次不验证 target / ref / SHA）")
  }

  const mismatches = []
  if (identity.provided && identity.described) {
    for (const [label, expected, actual] of [
      ["target", expectTarget, identity.described.target],
      ["ref", expectRef, identity.described.ref],
      ["SHA", expectSha, identity.described.sha],
    ]) {
      if (!expected) continue
      const matches =
        label === "SHA"
          ? actual === expected || (expected.length >= 7 && actual.startsWith(expected))
          : actual === expected
      if (!matches) mismatches.push(`${label}: 期望 ${expected}，实际 ${actual}`)
    }
  }
  if (mismatches.length > 0) {
    lines.push("")
    lines.push(`✗ STOP — 部署身份与期望不一致：${mismatches.join(" · ")}`)
    lines.push("  对「看起来是对的 URL」跑完 QA 再说通过，正是这一步要防的事。")
    emit({ ok: false, status: "identity-mismatch", baseUrl, access, identity, mismatches, lines }, asJson)
    process.exit(EXIT.FAIL)
  }

  // ---- the sweep ---------------------------------------------------------
  const projectRoot = process.cwd()
  const routeOverride = typeof flags.get("routes") === "string" ? flags.get("routes") : null
  const overrideList = routeOverride ? routeOverride.split(",").map((r) => r.trim()).filter(Boolean) : null
  const { usable, dynamic } = resolveRoutes(projectRoot, overrideList)
  if (usable.length === 0) {
    lines.push("\n✗ NOT RUN — 没有可扫描的路由")
    emit({ ok: false, status: "no-routes", baseUrl, access, lines }, asJson)
    process.exit(EXIT.FAIL)
  }

  const extraHeaders = bypassSecret ? { [BYPASS_HEADER]: bypassSecret } : {}
  lines.push(`  bypass    bypass secret ${bypassSecret ? "已提供（不打印、不持久化）" : "未提供"}`)
  lines.push(`  routes    ${usable.length} 条${dynamic.length > 0 ? `（跳过动态段：${dynamic.join(", ")}）` : ""}`)
  lines.push("")

  const sweep = await runSweep({ origin: baseUrl, routes: usable, extraHeaders })
  const passed = sweep.failures.length === 0

  // `--json` emits exactly ONE JSON document on stdout, notes on stderr — the
  // same contract the local entry point keeps. An observer whose machine-readable
  // output cannot be parsed by a machine is not machine-readable.
  if (asJson) {
    for (const line of sweep.notes) process.stderr.write(`${line}\n`)
    emit(
      {
        ok: passed,
        status: passed ? "passed" : "failed",
        baseUrl,
        access: { access: access.access, status: access.status },
        identity: {
          provided: identity.provided,
          verified: identity.verified,
          target: identity.described?.target ?? null,
          ref: identity.described?.ref ?? null,
          sha: identity.described?.sha ?? null,
        },
        expectations,
        bypass: bypassSecret ? "present (redacted)" : "absent",
        routes: usable,
        checksRun: sweep.checksRun,
        failures: sweep.failures,
        lines,
      },
      true,
    )
    process.exit(passed ? EXIT.OK : EXIT.FAIL)
  }

  emit({ lines }, false)
  process.exit(reportSweep(sweep, { label: "Online QA (remote)", origin: baseUrl }))
}

// Only run when invoked directly; the tests import the helpers above.
if (process.argv[1] && process.argv[1].endsWith("online-qa.mjs")) {
  main().catch((error) => {
    process.stderr.write(`在线 QA 运行失败: ${error?.stack ?? error}\n`)
    process.exit(EXIT.FAIL)
  })
}
