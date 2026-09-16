/**
 * Product Semantic Contract — Factory v1.2 (N4 / F11).
 *
 * ===========================================================================
 * What this is for
 * ===========================================================================
 * The Visual Manifest answers "what does it look like". It has no place to put
 * the other half of a product's identity:
 *
 *     resolved ≠ accepted-as-limitation
 *     an AI suggestion may not enter a Finding
 *     a derived fact and a human disposition are not the same state
 *
 * Those are **semantic** constraints, not visual ones, and the third prototype
 * proved what happens without a home for them: all 18 invariants existed, they
 * were well written, they were enforced by tests — and nothing outside
 * `tests/invariants.spec.ts` could see them. The product's most load-bearing
 * decisions were invisible to every tool, every checklist entry and every
 * successor reading the repo.
 *
 * ===========================================================================
 * What this module is, and what it refuses to be
 * ===========================================================================
 * It is a **registration surface plus a consistency gate**. It checks:
 *
 *   1. is a declaration well-formed?           (shape, id, statement, kind)
 *   2. is there an enforcement for it?          (declared → registered)
 *   3. is every registration declared?          (registered → declared)
 *
 * It does **not** know what any invariant means. It cannot: `statement` is
 * prose in the product's own language, and `id` is opaque to this file. There
 * is deliberately no code here that could invent, infer or rewrite a
 * declaration — Factory v1.2 must never guess a product's semantics from its
 * code, its UI or its state machine. The judgement is the human's; this is the
 * paper it is written on.
 *
 * Zero invariants is a legitimate product. An empty `invariants` array is a
 * decision, and a different one from "nobody asked the question" — see
 * `docs/product-initialization.md`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

// The same "prose is not code" discipline the Kits seam gate uses: a doc comment
// that shows an example registration is not a registration. (Learned the hard
// way here too — this module's own spec documents the call shape.)
import { stripComments } from "./kits-seam.mjs"

/** Where the contract lives, by convention, relative to the product root. */
export const CONTRACT_FILENAME = "product-contract.json"

/** Contract schema version. A different number is a different contract. */
export const SCHEMA_VERSION = 1

/**
 * How an invariant is enforced.
 *
 * One value today, on purpose. `test` means "a test in this repo registers this
 * id", which is the only kind this gate can verify end to end. A `manual` kind
 * would read as an escape hatch that quietly turns the bidirectional check into
 * a one-way one, so it is not here; if a real case appears, it arrives with its
 * own verification rule rather than as a hole.
 */
export const ENFORCEMENT_KINDS = ["test"]

/**
 * Invariant id grammar: dotted, lowercase, kebab segments, at least two
 * segments (`finding.confidence-bounded`).
 *
 * Machine-readable and language-free, so an id survives a copy rewrite, a
 * translation and a renamed test. The third prototype's own describe titles
 * already read this way (`evidence.all-resolvable`, `citation.roundtrip`) —
 * this grammar is what they were reaching for.
 */
export const ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/

/** Minimum meaningful statement length. "Don't break it" is not a statement. */
export const MIN_STATEMENT_LENGTH = 12

/** Fields a declaration may carry. Anything else is rejected, not ignored. */
const KNOWN_FIELDS = new Set(["id", "statement", "enforcement"])

/** Fields the contract document may carry. */
const KNOWN_TOP_LEVEL = new Set(["$schema", "schemaVersion", "invariants"])

/**
 * The registration call a test uses. Literal ids only — see `scanRegistrations`.
 */
export const REGISTRATION_PATTERN = /\binvariant\(\s*["']([^"']+)["']/g

export class ContractScopeError extends Error {}

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0

/**
 * Structural validation (level 1). Pure: no filesystem, no product knowledge.
 *
 * @param {unknown} input
 * @returns {{ok: boolean, issues: Array<{path: string, severity: "error"|"warning", code: string, message: string}>}}
 */
export function validateProductContract(input) {
  const issues = []

  if (!isPlainObject(input)) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          severity: "error",
          code: "contract/not-an-object",
          message: "Product Semantic Contract 必须是一个 JSON 对象。",
        },
      ],
    }
  }

  for (const key of Object.keys(input)) {
    if (!KNOWN_TOP_LEVEL.has(key)) {
      issues.push({
        path: key,
        severity: "error",
        code: "contract/unknown-field",
        message: `未知字段 \`${key}\`。契约的字段集合是封闭的；写错字段名通常意味着某个决定没有被记录。`,
      })
    }
  }

  if (input.schemaVersion !== SCHEMA_VERSION) {
    issues.push({
      path: "schemaVersion",
      severity: "error",
      code: "contract/unsupported-schema-version",
      message: `\`schemaVersion\` 必须是 ${SCHEMA_VERSION}，当前是 ${JSON.stringify(input.schemaVersion)}。`,
    })
  }

  if (input.invariants === undefined) {
    issues.push({
      path: "invariants",
      severity: "error",
      code: "contract/missing-field",
      message: "缺少 `invariants`。空数组是合法的（0 条不变量是一个决定），但没有这一栏说明没人回答过这个问题。",
    })
    return { ok: false, issues }
  }
  if (!Array.isArray(input.invariants)) {
    issues.push({
      path: "invariants",
      severity: "error",
      code: "contract/not-an-array",
      message: "`invariants` 必须是数组。",
    })
    return { ok: false, issues }
  }

  const seen = new Map()

  input.invariants.forEach((entry, index) => {
    const path = `invariants[${index}]`
    if (!isPlainObject(entry)) {
      issues.push({
        path,
        severity: "error",
        code: "contract/not-an-object",
        message: `${path} 必须是一个对象：{ id, statement, enforcement }。`,
      })
      return
    }

    for (const key of Object.keys(entry)) {
      if (!KNOWN_FIELDS.has(key)) {
        issues.push({
          path: `${path}.${key}`,
          severity: "error",
          code: "contract/unknown-field",
          message: `${path} 有未知字段 \`${key}\`。合法字段：${[...KNOWN_FIELDS].join(", ")}。`,
        })
      }
    }

    const id = entry.id
    if (id === undefined) {
      issues.push({
        path: `${path}.id`,
        severity: "error",
        code: "contract/missing-field",
        message: `${path} 缺少 \`id\`。`,
      })
    } else if (!isNonEmptyString(id)) {
      issues.push({
        path: `${path}.id`,
        severity: "error",
        code: "contract/empty-field",
        message: `${path}.id 必须是非空字符串。`,
      })
    } else if (!ID_PATTERN.test(id)) {
      issues.push({
        path: `${path}.id`,
        severity: "error",
        code: "contract/invalid-id",
        message:
          `\`${id}\` 不是合法 id：必须是「小写字母开头、点分段」的形式，例如 \`tension.resolved-requires-fact-change\`。` +
          " id 要稳定、机器可读、不依赖中文文案，也不依赖测试标题的自然语言。",
      })
    } else {
      const previous = seen.get(id)
      if (previous !== undefined) {
        issues.push({
          path: `${path}.id`,
          severity: "error",
          code: "contract/duplicate-id",
          message: `id \`${id}\` 与 invariants[${previous}] 重复。同一个不变量只能声明一次。`,
        })
      } else {
        seen.set(id, index)
      }
    }

    const statement = entry.statement
    if (statement === undefined) {
      issues.push({
        path: `${path}.statement`,
        severity: "error",
        code: "contract/missing-field",
        message: `${path} 缺少 \`statement\`。`,
      })
    } else if (!isNonEmptyString(statement)) {
      issues.push({
        path: `${path}.statement`,
        severity: "error",
        code: "contract/empty-field",
        message: `${path}.statement 必须是非空字符串。`,
      })
    } else if (statement.trim().length < MIN_STATEMENT_LENGTH) {
      issues.push({
        path: `${path}.statement`,
        severity: "error",
        code: "contract/statement-too-short",
        message:
          `\`${statement}\` 太短（${statement.trim().length} 字，至少 ${MIN_STATEMENT_LENGTH} 字）。` +
          " 这句话是下一个人唯一的上下文：写清「什么绝不能发生」。",
      })
    }

    const enforcement = entry.enforcement
    if (enforcement === undefined) {
      issues.push({
        path: `${path}.enforcement`,
        severity: "error",
        code: "contract/missing-field",
        message: `${path} 缺少 \`enforcement\`。声明一条不变量而不说它由谁守，等于没有守。`,
      })
    } else if (!ENFORCEMENT_KINDS.includes(enforcement)) {
      issues.push({
        path: `${path}.enforcement`,
        severity: "error",
        code: "contract/unknown-enforcement",
        message: `未知的 enforcement：${JSON.stringify(enforcement)}。合法取值：${ENFORCEMENT_KINDS.join(", ")}。`,
      })
    }
  })

  if (input.invariants.length === 0) {
    issues.push({
      path: "invariants",
      severity: "warning",
      code: "contract/no-invariants",
      message:
        "0 条不变量：合法（不是每个产品都有必须守住的语义），但它必须是一个决定，而不是没人问过。" +
        " 见 docs/product-initialization.md 第 7 步。",
    })
  }

  return { ok: issues.every((issue) => issue.severity !== "error"), issues }
}

/* -------------------------------------------------------------------------- */
/* Registration scan                                                           */
/* -------------------------------------------------------------------------- */

function* walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries.sort()) {
    if (entry === "node_modules" || entry.startsWith(".")) continue
    const full = join(dir, entry)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) yield* walk(full, out)
    else if (/\.(ts|tsx|mts|cts|js|mjs)$/.test(entry)) yield full
  }
}

/**
 * Find every `invariant("<id>", …)` registration under `roots`.
 *
 * Static, and honest about it: an id assembled at runtime is invisible here.
 * Comments are stripped first — a commented-out registration is not one, and a
 * documentation example must not count as a declaration of intent.
 * The helper in `tests/support/product-contract.ts` takes the id as its first
 * argument and rejects a non-id at runtime, so the failure mode of a computed
 * id is a loud test failure rather than a silent pass.
 *
 * @param {string} root
 * @param {{ roots?: string[] }} [options]
 * @returns {{ registrations: Array<{id: string, file: string}>, scanned: number, files: string[] }}
 */
export function scanRegistrations(root, options = {}) {
  const roots = options.roots ?? ["tests"]
  const files = []
  for (const dir of roots) {
    const abs = join(root, dir)
    if (!existsSync(abs)) continue
    for (const full of walk(abs)) files.push(relative(root, full).split(sep).join("/"))
  }
  files.sort()

  const registrations = []
  for (const file of files) {
    let contents
    try {
      contents = stripComments(readFileSync(join(root, file), "utf8"))
    } catch {
      continue
    }
    for (const match of contents.matchAll(REGISTRATION_PATTERN)) {
      registrations.push({ id: match[1], file })
    }
  }
  return { registrations, scanned: files.length, files }
}

/* -------------------------------------------------------------------------- */
/* The bidirectional check                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Level 2 — declared ↔ registered, in both directions.
 *
 * @param {{[key: string]: any, invariants?: Array<{id: string, enforcement?: string}>}} contract
 * @param {Array<{id: string, file: string}>} registrations
 * @returns {{ok: boolean, issues: Array<{path: string, code: string, message: string}>}}
 */
export function crossCheckContract(contract, registrations) {
  const issues = []
  const declared = new Map()
  for (const entry of contract.invariants ?? []) {
    if (entry && typeof entry.id === "string") declared.set(entry.id, entry)
  }
  const registered = new Map()
  for (const registration of registrations) {
    if (!registered.has(registration.id)) registered.set(registration.id, [])
    registered.get(registration.id).push(registration.file)
  }

  for (const [id, entry] of declared) {
    const files = registered.get(id)
    if (entry.enforcement !== "test") continue
    if (!files || files.length === 0) {
      issues.push({
        path: id,
        code: "contract/unregistered",
        message:
          `\`${id}\` 声明了 enforcement: "test"，但没有任何测试登记它。` +
          " 用 tests/support/product-contract.ts 的 invariant() 包住对应的 describe，或者改掉这条声明。",
      })
    }
  }

  for (const [id, files] of registered) {
    if (!declared.has(id)) {
      issues.push({
        path: id,
        code: "contract/undeclared",
        message:
          `测试登记了 \`${id}\`（${files.join(", ")}），但契约没有声明它。` +
          " 测试里存在的不变量必须在 product-contract.json 里有一个正式的家。",
      })
    }
  }

  return { ok: issues.length === 0, issues }
}

/**
 * A scan that measured nothing cannot report success.
 *
 * Same rule as the Kits seam gate: "every declared invariant is enforced" and
 * "no test file was read" must never produce the same output.
 */
export function assertNonVacuousScan(scan, { declaredCount = 0 } = {}) {
  if (scan.scanned === 0) {
    throw new ContractScopeError(
      `没有扫描到任何测试文件（roots: tests）。\n` +
        `  「${declaredCount} 条 invariant 全部有 enforcement」和「根本没检查」在输出上是一样的，所以这里必须失败。`,
    )
  }
  return scan
}

/** Human-readable report. Counts are the evidence. */
export function formatContractReport({ contract, registrationScan, crossCheck, contractPath }) {
  const declared = contract?.invariants?.length ?? 0
  const byKind = {}
  for (const entry of contract?.invariants ?? []) {
    byKind[entry.enforcement] = (byKind[entry.enforcement] ?? 0) + 1
  }
  const lines = [
    "Product Semantic Contract (F11 / N4)",
    `  contract     ${contractPath}`,
    `  invariants   ${declared} 条${declared === 0 ? "（0 条合法——但它必须是一个决定）" : ""}`,
  ]
  if (declared > 0) {
    lines.push(`  enforcement  ${Object.entries(byKind).map(([k, n]) => `${k} ×${n}`).join(" · ")}`)
  }
  lines.push(
    `  scanned      ${registrationScan.scanned} 个测试文件，${registrationScan.registrations.length} 处登记`,
  )
  for (const issue of crossCheck?.issues ?? []) {
    lines.push(`  ✗ [${issue.code}] ${issue.path} — ${issue.message}`)
  }
  return lines.join("\n")
}
