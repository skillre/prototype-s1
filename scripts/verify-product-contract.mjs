#!/usr/bin/env node
/**
 * Product Semantic Contract gate (Factory v1.2 · N4 / F11).
 *
 * Two levels, in this order:
 *   1. **shape**     — is each declaration well-formed? (`scripts/lib/product-contract.mjs`)
 *   2. **wiring**    — declared ↔ registered, in both directions.
 *
 * The second level is the point. The third prototype's invariants were all
 * written and all enforced; nothing outside their spec file could tell. A
 * declaration with no test is a promise, a test with no declaration is a
 * rumour, and this gate refuses to accept either silently.
 *
 *   pnpm factory:contract
 *   pnpm factory:contract --contract path/to/product-contract.json --json
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import {
  CONTRACT_FILENAME,
  ContractScopeError,
  assertNonVacuousScan,
  crossCheckContract,
  formatContractReport,
  scanRegistrations,
  validateProductContract,
} from "./lib/product-contract.mjs"

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
  : join(projectRoot, CONTRACT_FILENAME)

function emit(report) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return
  }
  process.stdout.write("\n\u001b[1mPrototype Factory · Product Semantic Contract\u001b[0m\n")
  for (const line of report.lines) process.stdout.write(`${line}\n`)
  process.stdout.write("\n")
}

const missing = () => {
  emit({
    ok: false,
    status: "missing",
    contractPath,
    lines: [
      `✗ 没有找到 Product Semantic Contract：${contractPath}`,
      "  File 必须存在，内容可以为空：`{\"schemaVersion\": 1, \"invariants\": []}`。",
      "  没有这个文件，说明「这个产品绝不能在哪件事上出错」从来没有被问过 —— 见 docs/product-initialization.md 第 7 步。",
    ],
    issues: [{ code: "contract/missing-file" }],
  })
  process.exit(EXIT.MISSING)
}

if (!existsSync(contractPath)) missing()

let contract
try {
  contract = JSON.parse(readFileSync(contractPath, "utf8"))
} catch (error) {
  emit({
    ok: false,
    status: "unreadable",
    contractPath,
    lines: [`✗ 无法解析 ${contractPath}：${error.message}`],
    issues: [{ code: "contract/unreadable" }],
  })
  process.exit(EXIT.INVALID)
}

const validation = validateProductContract(contract)
const lines = [`✓ shape        ${contractPath}`]
if (!validation.ok) {
  lines.length = 0
  lines.push(`✗ [contract/invalid] ${contractPath}`)
  for (const issue of validation.issues) {
    lines.push(`  ${issue.severity === "error" ? "✗" : "!"} [${issue.code}] ${issue.path} — ${issue.message}`)
  }
  emit({ ok: false, status: "invalid", contractPath, issues: validation.issues, lines })
  process.exit(EXIT.INVALID)
}

for (const issue of validation.issues) {
  lines.push(`! [${issue.code}] ${issue.path} — ${issue.message}`)
}

const registrationScan = scanRegistrations(projectRoot)
try {
  assertNonVacuousScan(registrationScan, { declaredCount: contract.invariants.length })
} catch (error) {
  if (!(error instanceof ContractScopeError)) throw error
  emit({
    ok: false,
    status: "vacuous",
    contractPath,
    lines: [`✗ ${error.message}`],
    issues: [{ code: "contract/vacuous-scan" }],
  })
  process.exit(EXIT.INVALID)
}

const crossCheck = crossCheckContract(contract, registrationScan.registrations)
lines.push(
  ...formatContractReport({ contract, registrationScan, crossCheck, contractPath })
    .split("\n")
    .filter((line, index) => index > 0 && line.trim() !== ""),
)

const ok = crossCheck.ok
lines.push("")
lines.push(
  ok
    ? `✓ Product Semantic Contract OK（${contract.invariants.length} 条，全部双向核对）`
    : "✗ Product Semantic Contract 未通过：声明与 enforcement 对不上",
)

emit({
  ok,
  status: ok ? "verified" : "mismatch",
  contractPath,
  invariants: contract.invariants.length,
  registered: registrationScan.registrations.length,
  scannedFiles: registrationScan.scanned,
  issues: crossCheck.issues,
  lines,
})

if (!ok) process.exit(EXIT.INVALID)
