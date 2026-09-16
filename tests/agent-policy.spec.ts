import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, test } from "@playwright/test"

import {
  KEY_VALUE_PATHS,
  PolicyScopeError,
  UPSTREAM_NOTE_MARKER,
  assertNonVacuousPolicyScan,
  blockAnchors,
  collectPolicyDocs,
  compareManagedBlock,
  detectUpstreamReuse,
  inspectCiWorkflow,
  inspectPackageWiring,
  renderManagedBlock,
  scanProhibitionConflicts,
  schemaConstAt,
  validateAgainstSchema,
  valueAtDotPath,
} from "../scripts/lib/agent-policy.mjs"
import { stripComments } from "../scripts/lib/kits-seam.mjs"

/**
 * The agent-policy gate (Factory v1.3 · POLICY).
 *
 * These are the executable form of what `AGENTS.md`'s managed block states in
 * prose. The suite spends most of its effort on the *negative* cases, because
 * the rule this gate replaced — v1.2's flat ban on "Multi-agent orchestration" —
 * was not wrong about a detail. It was unenforceable in both directions: nobody
 * could follow it and nobody could break it, so nothing noticed either way.
 *
 * A gate that only proves it passes on a good tree proves very little.
 */

const ROOT = process.cwd()
const GUARD = join(ROOT, "scripts/guard-agent-policy.mjs")
const read = (path: string) => readFileSync(join(ROOT, path), "utf8")

/**
 * This repository's lock is a **product** lock.
 *
 * The baseline's governance lock has `kind`, `managedSurfaces[]` and
 * `unresolved[]`; the product lock has `factoryVersion`, the derivation source,
 * the initialization stage, the Kits state, the deployment identity and prose
 * `notes[]`. The difference is not cosmetic and it is not a free choice: the
 * role of the tree decides the shape, and a product that writes the baseline
 * shape satisfies the other `oneOf` branch and would pass silently. So the
 * shape itself is pinned here — see `detectLockShape` in
 * `scripts/lib/agent-policy.mjs` and the root control plane's
 * `contracts/factory-lock.schema.json`.
 */
type ProductFactoryLock = {
  schemaVersion: number
  factoryVersion: string
  baseline: { repo: string; commit: string; dirty: boolean }
  generatedAt: string
  stage: "baseline" | "product"
  initContractSha256: string | null
  kits: { lockPath: string; registryVersion: string | null; sourceCommit: string | null } | null
  deployment: { provider: "vercel"; projectName: string; productionBranch: string | null } | null
  upgradedBy: string | null
  notes: string[]
}

const policy = JSON.parse(read("factory-policy.json"))
const schema = JSON.parse(read("lib/factory-policy.schema.json"))
const lock: ProductFactoryLock = JSON.parse(read("factory.lock.json"))

/** The exact line v1.2 shipped. It must never come back unnoticed. */
const LEGACY_BAN =
  "- ❌ 禁止加入 Database / Supabase / Authentication / Docker / Kubernetes / Monorepo / " +
  "Turborepo / Microservices / Backend service / MCP / Multi-agent orchestration / " +
  "GitHub Actions / Vercel API & CLI automation / Cloudflare / 任何新的 deployment platform。这些以后再处理。"

/* -------------------------------------------------------------------------- */
/* the gate runs and passes on this tree                                       */
/* -------------------------------------------------------------------------- */

test("the gate passes on this repository", () => {
  const stdout = execFileSync(process.execPath, [GUARD], { cwd: ROOT, encoding: "utf8" })
  expect(stdout).toContain("Agent policy OK")
  expect(stdout).toContain(policy.modelRouting.provider)
})

test("a tampered policy fails the gate end to end", () => {
  const dir = mkdtempSync(join(tmpdir(), "factory-policy-"))
  const tampered = structuredClone(policy)
  // The one value the whole boundary rests on, flipped to its opposite.
  tampered.agentOrchestration.dshSubagents = "forbidden"
  const path = join(dir, "tampered-policy.json")
  writeFileSync(path, JSON.stringify(tampered, null, 2))

  let output = ""
  let failed = false
  try {
    execFileSync(process.execPath, [GUARD, "--policy", path], { cwd: ROOT, encoding: "utf8", stdio: "pipe" })
  } catch (error) {
    failed = true
    output = String((error as { stdout?: string }).stdout ?? "")
  }
  expect(failed, "改了关键值还绿灯 = 门禁没有真的在读它").toBe(true)
  expect(output).toContain("[policy/schema]")
})

/* -------------------------------------------------------------------------- */
/* §1 — the prohibition conflict scan                                          */
/* -------------------------------------------------------------------------- */

test("the v1.2 blanket ban is caught, with the reason named", () => {
  const result = scanProhibitionConflicts([{ path: "AGENTS.md", text: LEGACY_BAN }])
  expect(result.conflicts).toHaveLength(1)
  expect(result.conflicts[0].code).toBe("policy/unscoped-prohibition")
  expect(result.conflicts[0].line).toBe(1)
  expect(result.linesScanned).toBe(1)
})

test("a scoped prohibition is not a conflict", () => {
  const scoped = [
    "- ❌ 禁止在**产品应用代码**里引入编排框架或编排运行时。",
    "- ❌ 禁止在产品代码及其运行时依赖里出现 agent framework / orchestrator runtime / 多 agent 调度依赖。",
  ].join("\n")
  expect(scanProhibitionConflicts([{ path: "AGENTS.md", text: scoped }]).conflicts).toEqual([])
})

test("stating the allowance is not a prohibition", () => {
  const allowance = "- ✅ DSH 宿主侧的**多 Subagent 编排**：允许并要求，边界见管理块。"
  const result = scanProhibitionConflicts([{ path: "AGENTS.md", text: allowance }])
  expect(result.conflicts).toEqual([])
  // …and it was actually examined, rather than skipped as "no term found".
  expect(result.linesScanned).toBe(1)
})

test("the real docs are scanned, and the scan is not vacuous", () => {
  const docs = collectPolicyDocs(ROOT)
  const scan = scanProhibitionConflicts(docs)
  assertNonVacuousPolicyScan(scan) // throws if filesScanned / linesScanned is 0
  expect(scan.filesScanned).toBeGreaterThan(1)
  expect(scan.linesScanned).toBeGreaterThan(100)
  expect(scan.conflicts).toEqual([])
})

test("a scan that looked at nothing refuses to be called a pass", () => {
  expect(() => assertNonVacuousPolicyScan({ filesScanned: 0, linesScanned: 0 })).toThrow(PolicyScopeError)
  expect(() => assertNonVacuousPolicyScan({ filesScanned: 4, linesScanned: 0 })).toThrow(/0 行/)
})

/* -------------------------------------------------------------------------- */
/* §2 — the managed block is rendered, then verified verbatim                  */
/* -------------------------------------------------------------------------- */

test("the renderer still states every rule the policy is about", () => {
  const anchors = blockAnchors(policy)
  expect(anchors.length).toBeGreaterThanOrEqual(12)
  const rendered = renderManagedBlock(policy)
  for (const anchor of anchors) {
    expect(anchor.pattern.test(rendered), `管理块缺少规则：${anchor.id} — ${anchor.hint}`).toBe(true)
  }
})

test("AGENTS.md's block is exactly what the policy renders", () => {
  const result = compareManagedBlock(read("AGENTS.md"), policy)
  expect(result.ok, result.message).toBe(true)
})

test("an edited block is reported as drift, not waved through", () => {
  const agents = read("AGENTS.md")
  const drifted = agents.replace("没有 HVA 就没有发布", "验收可以晚点再说")
  expect(drifted).not.toBe(agents)

  const result = compareManagedBlock(drifted, policy)
  expect(result.ok).toBe(false)
  expect(result.reason).toBe("drift")
  expect(result.message).toContain("第一处差异")
})

test("a missing or duplicated marker is its own failure, not drift", () => {
  const agents = read("AGENTS.md")
  const withoutEnd = agents.replace(policy.managedBlock.end, "")
  expect(compareManagedBlock(withoutEnd, policy).reason).toBe("markers")

  const duplicated = agents.replace(policy.managedBlock.begin, `${policy.managedBlock.begin}\n${policy.managedBlock.begin}`)
  expect(compareManagedBlock(duplicated, policy).reason).toBe("markers")
})

/* -------------------------------------------------------------------------- */
/* §3 — key values live in the schema, once                                    */
/* -------------------------------------------------------------------------- */

test("every key value is pinned as a const, and the policy agrees with it", () => {
  expect(KEY_VALUE_PATHS.length).toBeGreaterThanOrEqual(15)
  for (const dotPath of KEY_VALUE_PATHS) {
    const declared = schemaConstAt(schema, dotPath)
    expect(declared.declared, `${dotPath} 没有被 schema 钉成 const`).toBe(true)
    expect(valueAtDotPath(policy, dotPath), dotPath).toBe(declared.value)
  }
})

test("the schema actually constrains the boundary — a flipped value is rejected", () => {
  const tampered = structuredClone(policy)
  tampered.agentOrchestration.dshSubagents = "forbidden"
  tampered.agentOrchestration.productAppFrameworks = "allowed"
  const result = validateAgainstSchema(tampered, schema)
  expect(result.ok).toBe(false)
  expect(result.issues.some((issue) => issue.path.includes("agentOrchestration"))).toBe(true)
})

test("relaxing the schema cannot hide a drift — the check loses its reference and fails", () => {
  const relaxed = structuredClone(schema)
  delete relaxed.properties.agentOrchestration.properties.dshSubagents.const
  // The guard fails when a key value is not pinned (`policy/key-value-not-pinned`),
  // so a missing const is a loud failure rather than a silent pass.
  expect(schemaConstAt(relaxed, "agentOrchestration.dshSubagents").declared).toBe(false)
  expect(schemaConstAt(schema, "agentOrchestration.dshSubagents").value).toBe("required")
})

test("the enforcement code keeps no copy of the policy values", () => {
  for (const file of ["scripts/guard-agent-policy.mjs", "scripts/lib/agent-policy.mjs"]) {
    const code = stripComments(read(file))
    for (const token of [
      policy.modelRouting.provider,
      policy.modelRouting.model,
      policy.managedBlock.begin,
      policy.managedBlock.end,
    ]) {
      expect(code.includes(token), `${file} 抄了一份 ${token}——值只应存在于 schema/policy`).toBe(false)
    }
  }
})

/* -------------------------------------------------------------------------- */
/* §4 — the lock: 未知不猜                                                      */
/* -------------------------------------------------------------------------- */

test("the lock conforms to its schema, and says the same stage as the initialization boundary", () => {
  const lockSchema = JSON.parse(read("lib/factory-lock.schema.json"))
  const result = validateAgainstSchema(lock, lockSchema)
  expect(result.ok, JSON.stringify(result.issues)).toBe(true)

  // The SHAPE is pinned, not just its validity: a product lock written in the
  // baseline's shape satisfies the other `oneOf` branch and passes silently.
  expect((lock as Record<string, unknown>).kind, "product 锁没有 kind 字段").toBeUndefined()
  expect(lock.factoryVersion).toMatch(/^\d+\.\d+\.\d+$/)
  expect(lock.baseline.commit).toMatch(/^[0-9a-f]{40}$/)
  expect(lock.baseline.dirty).toBe(false)

  // `stage` is a word that appears in two files, and "the lock says product
  // while the boundary contract still says baseline" is exactly the
  // half-initialized state the boundary exists to prevent.
  const init = JSON.parse(read("init-contract.json"))
  expect(lock.stage).toBe(init.stage)
  expect(lock.stage).toBe("product")

  // The lock pins WHICH version of the initialization contract it belongs to.
  // A stale hash means the lock describes a contract that no longer exists.
  const digest = createHash("sha256")
    .update(readFileSync(join(ROOT, "init-contract.json")))
    .digest("hex")
  expect(lock.initContractSha256, "锁必须钉住 init-contract.json 的哈希").toBe(digest)
})

test("unmatched facts are recorded as unknown, never guessed", () => {
  // The product shape has no `unresolved[]`; the same rule is carried by
  // `notes[]`, and the upstream reusable workflow is the fact it must mention
  // while it stays unused.
  expect(lock.notes.length).toBeGreaterThan(0)
  expect(lock.notes.join("\n")).toContain(UPSTREAM_NOTE_MARKER)
  for (const note of lock.notes) expect(note.trim().length).toBeGreaterThan(20)

  // Kits: either "no install" (`null` — not verified, so no version number may
  // appear) or a claim that can be **read back**. A hand-copied version string
  // is a fact with no owner; the gate re-reads the lock file for the same
  // reason, and this test would rather fail here than let the two drift.
  if (lock.kits === null) {
    expect(lock.notes.join("\n")).toMatch(/Kits/)
  } else {
    const kitsLock = JSON.parse(read(lock.kits.lockPath))
    expect(lock.kits.registryVersion).toBe(kitsLock.registryVersion)
    expect(lock.kits.sourceCommit).toBe(kitsLock.source.commit)
  }

  // Deployment identity: nothing has been read back from Vercel, so nothing is
  // asserted. A guessed project name is worse than an explicit null.
  expect(lock.deployment, "部署身份未经核实就必须是 null，不能猜一个项目名").toBeNull()
})

/* -------------------------------------------------------------------------- */
/* §5 — CI: a quality gate, never a deployment path                            */
/* -------------------------------------------------------------------------- */

const GOOD_CI = [
  "jobs:",
  "  gate:",
  "    steps:",
  "      - run: pnpm factory:agents",
  "      - run: pnpm test",
  "  browser-qa:",
  "    needs: gate",
  "    steps:",
  "      - run: pnpm qa",
].join("\n")

test("a serial, credential-free workflow passes", () => {
  expect(inspectCiWorkflow(GOOD_CI).problems).toEqual([])
  expect(inspectCiWorkflow(GOOD_CI).jobs).toBe(2)
})

test("running test and qa in one job is caught", () => {
  const sameJob = GOOD_CI.replace("      - run: pnpm test", "      - run: pnpm test\n      - run: pnpm qa")
  const codes = inspectCiWorkflow(sameJob).problems.map((problem) => problem.code)
  expect(codes).toContain("ci/test-qa-same-job")
})

test("a qa job that does not depend on the test job is caught", () => {
  const noNeeds = GOOD_CI.replace("    needs: gate\n", "")
  const codes = inspectCiWorkflow(noNeeds).problems.map((problem) => problem.code)
  expect(codes).toContain("ci/test-qa-not-serial")
})

test("CI may not hold deployment credentials or call the Vercel CLI", () => {
  const withCli = `${GOOD_CI}\n      - run: ${["npx", "vercel", "deploy"].join(" ")}`
  expect(inspectCiWorkflow(withCli).problems.map((problem) => problem.code)).toContain("ci/vercel-cli")

  const tokenName = ["VERCEL", "TOKEN"].join("_")
  const withToken = `${GOOD_CI}\n    env:\n      ${tokenName}: \${{ secrets.${tokenName} }}`
  expect(inspectCiWorkflow(withToken).problems.map((problem) => problem.code)).toContain("ci/deployment-credential")
})

test("a workflow that drops the policy gate is caught", () => {
  const withoutGate = GOOD_CI.replace("      - run: pnpm factory:agents\n", "")
  expect(inspectCiWorkflow(withoutGate).problems.map((problem) => problem.code)).toContain("ci/no-policy-gate")
})

test("a workflow with no jobs section cannot be reported as serial", () => {
  const problems = inspectCiWorkflow("on: push\n").problems.map((problem) => problem.code)
  expect(problems).toContain("ci/jobs-unparsed")
})

test("this repository's workflow satisfies the contract, and calls nothing upstream", () => {
  const ci = read(".github/workflows/ci.yml")
  expect(inspectCiWorkflow(ci).problems).toEqual([])

  // The upstream switch is *commented out* on purpose — a comment is not a call.
  expect(detectUpstreamReuse(ci)).toEqual([])
  const active = "    uses: skillre/prototype-factory-control/.github/workflows/reusable-prototype-ci.yml@v1"
  expect(detectUpstreamReuse(active)).toHaveLength(1)

  // …and while it is commented out, the lock must say so. The product shape
  // carries that unknown in `notes[]` instead of `unresolved[]`; dropping it
  // would make one of the two shapes strictly weaker.
  expect(lock.notes.join("\n")).toContain(UPSTREAM_NOTE_MARKER)
})

test("the policy gate runs before anything else is called green in CI", () => {
  const ci = read(".github/workflows/ci.yml")
  const agentsLine = ci.indexOf("pnpm factory:agents")
  expect(agentsLine).toBeGreaterThan(-1)
  for (const later of ["pnpm lint", "pnpm typecheck", "pnpm test"]) {
    expect(ci.indexOf(later), `${later} 必须排在策略门禁之后`).toBeGreaterThan(agentsLine)
  }
})

/* -------------------------------------------------------------------------- */
/* §6 — wiring: the gate must actually run                                     */
/* -------------------------------------------------------------------------- */

test("package.json runs the gate, as the first item of check", () => {
  const pkg = JSON.parse(read("package.json"))
  expect(inspectPackageWiring(pkg).problems).toEqual([])
  expect(pkg.scripts.check.startsWith("pnpm factory:agents &&")).toBe(true)
})

test("a gate that is present but not wired is caught", () => {
  const pkg = JSON.parse(read("package.json"))

  const late = structuredClone(pkg)
  late.scripts.check = "pnpm lint && pnpm factory:agents"
  expect(inspectPackageWiring(late).problems.map((problem) => problem.code)).toContain("package/check-order")

  const missing = structuredClone(pkg)
  delete missing.scripts["factory:agents"]
  expect(inspectPackageWiring(missing).problems.map((problem) => problem.code)).toContain("package/missing-script")

  const wrongTarget = structuredClone(pkg)
  wrongTarget.scripts["factory:agents"] = "node scripts/something-else.mjs"
  expect(inspectPackageWiring(wrongTarget).problems.map((problem) => problem.code)).toContain("package/script-target")
})
