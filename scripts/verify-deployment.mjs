#!/usr/bin/env node
/**
 * Deployment gate — Factory v1.2 (DEPLOY).
 *
 * The runnable half of the deployment authorization contract. Everything it
 * knows lives in `scripts/lib/deploy-contract.mjs` and
 * `docs/vercel-bootstrap.md`; this file is only the entry point, so that the
 * rules can be *executed* instead of remembered.
 *
 * It performs **no network call and holds no credentials**. Deployment records
 * are passed in as JSON that the agent already obtained from a read-only source
 * (`vercel inspect --json`, or `GET /v13/deployments/{id}`). That boundary is
 * deliberate: `AGENTS.md` forbids putting Vercel API/CLI automation into a
 * prototype project, and a tool that can deploy is a tool that can deploy by
 * accident. A tool that can only *judge* a deployment cannot.
 *
 * Usage
 * -----
 *   # B · before pushing: would this push create Production?
 *   node scripts/verify-deployment.mjs preflight \
 *     --branch feature/ai-research [--production-branch main] [--authorized]
 *
 *   # C + F · after deploying: is this the deployment we accepted?
 *   node scripts/verify-deployment.mjs verify \
 *     --deployment deployment.json [--rc <accepted-sha>]
 *
 *   # D · is this URL actually public?
 *   node scripts/verify-deployment.mjs access --status 302 --location https://…
 *
 * Exit code 0 = proceed / verified · 1 = STOP or failed verification.
 */

import { readFileSync } from "node:fs"

import {
  DEPLOYMENT_ACTIONS,
  assertProductionMatchesRC,
  classifyUrlAccess,
  productionPushPreflight,
  verifyDeploymentIdentity,
} from "./lib/deploy-contract.mjs"

function parseFlags(argv) {
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

const line = (text = "") => process.stdout.write(`${text}\n`)

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    throw new Error(`无法读取部署记录 ${path}：${error.message}`)
  }
}

function commandPreflight(flags) {
  const result = productionPushPreflight({
    branch: flags.get("branch"),
    productionBranch: flags.get("production-branch"),
    authorized: flags.get("authorized") === true || flags.get("authorized") === "true",
  })

  line()
  line(result.decision === "STOP" ? "✗ STOP" : "✓ PROCEED")
  line(result.message)
  line()
  return result.decision === "STOP" ? 1 : 0
}

function commandVerify(flags) {
  const path = flags.get("deployment")
  if (typeof path !== "string") throw new Error("verify 需要 --deployment <file>")

  const record = readJson(path)
  const identity = verifyDeploymentIdentity(record)
  line()
  if (!identity.ok) {
    line("✗ 部署身份验证失败")
    line(identity.message)
    line()
    return 1
  }
  line(`✓ 部署身份 ${identity.message}`)

  const rcSha = flags.get("rc")
  if (typeof rcSha === "string") {
    const match = assertProductionMatchesRC(record, rcSha)
    line(match.ok ? `✓ ${match.reason}` : `✗ ${match.reason}`)
    line()
    return match.ok ? 0 : 1
  }

  line("  （未提供 --rc，只验证了身份；发布验证必须比对已验收 RC 的 SHA）")
  line()
  return 0
}

function commandAccess(flags) {
  const status = Number(flags.get("status"))
  const result = classifyUrlAccess({ status, location: flags.get("location") })
  line()
  line(`${result.publicLabelAllowed ? "✓" : "✗"} ${result.access}`)
  line(result.message)
  line()
  return result.publicLabelAllowed ? 0 : 1
}

function commandActions() {
  line()
  line("部署动作与授权要求：")
  for (const action of DEPLOYMENT_ACTIONS) {
    const mark = action.authorization === "none" ? " " : "!"
    line(`  ${mark} ${action.id.padEnd(28)} ${action.authorization === "none" ? "无需授权" : "需要用户明确授权"}`)
    if (action.disclosure) line(`      副作用：${action.sideEffect}`)
  }
  line()
  return 0
}

const [command, ...rest] = process.argv.slice(2)
const flags = parseFlags(rest)

const commands = {
  preflight: commandPreflight,
  verify: commandVerify,
  access: commandAccess,
  actions: commandActions,
}

if (typeof commands[command] !== "function") {
  process.stderr.write(
    `未知命令：${command ?? "(空)"}\n用法：verify-deployment.mjs <preflight|verify|access|actions> [flags]\n`,
  )
  process.exit(2)
}

try {
  process.exit(commands[command](flags))
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(2)
}
