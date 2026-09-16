#!/usr/bin/env node
/**
 * Initialization boundary gate (Factory v1.2 · INIT).
 *
 * Answers one question, mechanically: **is this tree the Factory baseline, or a
 * product — and if it says it is one, is it actually that one?**
 *
 * The failure it exists for is not "the Reference Sample is still here". It is
 * a half-initialized copy: package renamed, sample's product name still in the
 * metadata, homepage still pointing at the CRM as if that were the product.
 *
 *   pnpm factory:init
 *   pnpm factory:init --json
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import {
  INIT_CONTRACT_FILENAME,
  InitScopeError,
  assertNonVacuousInitScan,
  formatInitReport,
  scanInitBoundary,
  validateInitContract,
} from "./lib/init-boundary.mjs"

const EXIT = { OK: 0, INVALID: 1, MISSING: 2 }

const argv = process.argv.slice(2)
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

const projectRoot = process.cwd()
const asJson = flags.get("json") === true
const contractPath = flags.get("contract")
  ? String(flags.get("contract"))
  : join(projectRoot, INIT_CONTRACT_FILENAME)

function emit(report) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return
  }
  process.stdout.write("\n\u001b[1mPrototype Factory · Initialization boundary\u001b[0m\n")
  for (const line of report.lines) process.stdout.write(`${line}\n`)
  process.stdout.write("\n")
}

if (!existsSync(contractPath)) {
  emit({
    ok: false,
    status: "missing",
    contractPath,
    lines: [`✗ 没有找到初始化边界契约：${contractPath}`],
    issues: [{ code: "init/missing-file" }],
  })
  process.exit(EXIT.MISSING)
}

let contract
try {
  contract = JSON.parse(readFileSync(contractPath, "utf8"))
} catch (error) {
  emit({
    ok: false,
    status: "unreadable",
    contractPath,
    lines: [`✗ 无法解析 ${contractPath}：${error.message}`],
    issues: [{ code: "init/unreadable" }],
  })
  process.exit(EXIT.INVALID)
}

const validation = validateInitContract(contract)
if (!validation.ok) {
  emit({
    ok: false,
    status: "invalid",
    contractPath,
    issues: validation.issues,
    lines: [
      `✗ [init/invalid] ${contractPath}`,
      ...validation.issues.map((issue) => `  ✗ [${issue.code}] ${issue.path} — ${issue.message}`),
    ],
  })
  process.exit(EXIT.INVALID)
}

let scan
try {
  scan = scanInitBoundary(projectRoot, contract)
  assertNonVacuousInitScan(scan)
} catch (error) {
  if (!(error instanceof InitScopeError)) throw error
  emit({
    ok: false,
    status: "vacuous",
    contractPath,
    lines: [`✗ ${error.message}`],
    issues: [{ code: "init/vacuous-scan" }],
  })
  process.exit(EXIT.INVALID)
}

const ok = scan.violations.length === 0
const lines = formatInitReport(scan).split("\n")
lines.push("")
lines.push(
  ok
    ? scan.stage === "baseline"
      ? "✓ Initialization boundary OK（Factory baseline 本身是合法状态）"
      : "✓ Initialization boundary OK（已是产品，且初始化面上没有残留身份）"
    : "✗ Initialization boundary 未通过：初始化面上仍有不该出现的身份",
)

emit({
  ok,
  status: ok ? scan.stage : "residue",
  contractPath,
  stage: scan.stage,
  scannedFiles: scan.scanned,
  excludedFiles: scan.excluded,
  violations: scan.violations,
  lines,
})

if (!ok) process.exit(EXIT.INVALID)
