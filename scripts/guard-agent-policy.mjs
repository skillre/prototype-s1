#!/usr/bin/env node
/**
 * Factory Core agent-policy gate (Factory v1.3 · POLICY).
 *
 * Answers one question, mechanically: **does this tree still agree with the
 * agent policy it claims to follow — and is that policy the one it says it is?**
 *
 * The failure it exists for is the "Multi-agent orchestration" line in v1.2.
 * One flat prohibition, sitting in a list next to Docker, banned the workflow
 * the Factory actually depends on: splitting work across DSH subagents. Nobody
 * could follow it and nobody could break it — which made it invisible. The rule
 * that was *needed* ("no orchestration framework in product application code")
 * was never written down at all.
 *
 * So the gate checks three things that can drift apart, in every direction:
 *
 *   1. `factory-policy.json` ↔ `lib/factory-policy.schema.json`
 *      Key values are read out of the schema's `const`s and compared. The guard
 *      keeps no second copy of the values, so relaxing the schema cannot make a
 *      mismatch disappear — it makes the named key-value checks fail.
 *
 *   2. `AGENTS.md` managed block ↔ the renderer
 *      The block is verified **verbatim** against `renderManagedBlock(policy)`.
 *      Before that, the render (and the file's copy, if present) must state every
 *      rule in `BLOCK_ANCHORS` — a template that quietly drops "部署授权" fails
 *      here instead of shrinking into something that matches a truncated file.
 *
 *   3. Prose ↔ the boundary
 *      Any line that prohibits something Subagent-shaped must name its scope.
 *      An unscoped ban is a conflict: it also bans the host-side workflow.
 *
 * Plus the surfaces that make the policy real rather than aspirational: the
 * baseline lock, `package.json`, and the CI workflow (no Vercel CLI/token, no
 * parallel test/qa, and the policy gate itself running in CI).
 *
 *   pnpm factory:agents
 *   pnpm factory:agents --json
 *   pnpm factory:agents --print-block   # 同步管理块用（只打印，不写文件）
 *
 * Exit: 0 ok (warnings allowed) · 1 invalid · 2 missing
 */

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"

import {
  AGENTS_FILENAME,
  CI_WORKFLOW_PATH,
  KEY_VALUE_PATHS,
  LOCK_FILENAME,
  LOCK_SCHEMA_PATH,
  LOCK_SHAPE_BASELINE,
  LOCK_SHAPE_PRODUCT,
  POLICY_FILENAME,
  POLICY_SCHEMA_PATH,
  PolicyScopeError,
  UPSTREAM_LOCK_ID,
  UPSTREAM_NOTE_MARKER,
  UPSTREAM_REUSABLE_WORKFLOW,
  assertNonVacuousPolicyScan,
  blockAnchors,
  compareManagedBlock,
  detectLockShape,
  inspectCiWorkflow,
  inspectPackageWiring,
  formatPolicyReport,
  readJsonFile,
  renderManagedBlock,
  scanProhibitionConflicts,
  schemaConstAt,
  validateAgainstSchema,
  valueAtDotPath,
  collectPolicyDocs,
} from "./lib/agent-policy.mjs"

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
/**
 * `--policy` accepts an absolute path as-is. `join(root, "/tmp/x.json")` silently
 * produces `<root>/tmp/x.json` (only `resolve` would reset), which turns a
 * clear "wrong file" error into a confusing "file not found" one — the exact
 * shape of failure this gate is supposed to refuse.
 */
const policyFlag = flags.get("policy")
const policyPath =
  policyFlag === undefined
    ? join(projectRoot, POLICY_FILENAME)
    : isAbsolute(String(policyFlag))
      ? String(policyFlag)
      : join(projectRoot, String(policyFlag))
const issues = []
const warnings = []

const fail = (code, message) => issues.push({ code, message })
const warn = (code, message) => warnings.push({ code, message })
const read = (rel) => readFileSync(join(projectRoot, rel), "utf8")

function emit(report, exitCode) {
  if (asJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  else {
    process.stdout.write("\n\u001b[1mPrototype Factory · Agent policy (v1.3)\u001b[0m\n")
    for (const line of report.lines ?? []) process.stdout.write(`${line}\n`)
    process.stdout.write("\n")
  }
  process.exit(exitCode)
}

function missing(code, message) {
  emit({
    ok: false,
    status: "missing",
    issues: [...issues, { code, message }],
    warnings,
    lines: [`✗ [${code}] ${message}`],
  }, EXIT.MISSING)
}

/* -------------------------------------------------------------------------- */
/* 1 — artifacts                                                               */
/* -------------------------------------------------------------------------- */

if (!existsSync(policyPath)) missing("policy/missing-file", `没有找到策略文件：${policyPath}`)

const policyRead = readJsonFile(policyPath)
if (!policyRead.ok) {
  emit({
    ok: false,
    status: "unreadable",
    issues: [{ code: "policy/unreadable", message: `无法解析 ${policyPath}：${policyRead.error.message}` }],
    lines: [`✗ [policy/unreadable] 无法解析 ${policyPath}：${policyRead.error.message}`],
  }, EXIT.INVALID)
}
const policy = policyRead.value

const schemaRead = readJsonFile(join(projectRoot, POLICY_SCHEMA_PATH))
if (!schemaRead.ok) missing("policy/missing-schema", `没有找到或无法解析 schema：${POLICY_SCHEMA_PATH}`)
const schema = schemaRead.value

/* -------------------------------------------------------------------------- */
/* 2 — schema validation (the values in the policy must satisfy the schema)     */
/* -------------------------------------------------------------------------- */

const policyValidation = validateAgainstSchema(policy, schema)
for (const issue of policyValidation.issues) {
  fail("policy/schema", `${issue.path} — ${issue.message}`)
}

let lockValidation = { ok: true, issues: [], checks: 0, keyValueChecks: 0 }
let lock = null
const lockPath = join(projectRoot, LOCK_FILENAME)
if (!existsSync(lockPath)) {
  fail("policy/missing-lock", `没有找到基线锁：${LOCK_FILENAME}`)
} else {
  const lockRead = readJsonFile(lockPath)
  if (!lockRead.ok) {
    fail("policy/unreadable-lock", `无法解析 ${LOCK_FILENAME}：${lockRead.error.message}`)
  } else {
    lock = lockRead.value
    const lockSchemaRead = readJsonFile(join(projectRoot, LOCK_SCHEMA_PATH))
    if (!lockSchemaRead.ok) {
      fail("policy/missing-lock-schema", `没有找到或无法解析 schema：${LOCK_SCHEMA_PATH}`)
    } else {
      lockValidation = validateAgainstSchema(lock, lockSchemaRead.value)
      for (const issue of lockValidation.issues) {
        fail("lock/schema", `${LOCK_FILENAME}${issue.path ? ` · ${issue.path}` : ""} — ${issue.message}`)
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 3 — key values: read from the schema, compare against the policy            */
/* -------------------------------------------------------------------------- */

let keyValuesChecked = 0
for (const dotPath of KEY_VALUE_PATHS) {
  const declared = schemaConstAt(schema, dotPath)
  if (!declared.declared) {
    fail(
      "policy/key-value-not-pinned",
      `${POLICY_SCHEMA_PATH} 没有把 ${dotPath} 钉成 const —— 关键值没有被固定，策略可以悄悄变成任何值`,
    )
    continue
  }
  keyValuesChecked += 1
  const actual = valueAtDotPath(policy, dotPath)
  if (actual !== declared.value) {
    fail(
      "policy/key-value-drift",
      `${dotPath}：schema 钉住 ${JSON.stringify(declared.value)}，策略里是 ${JSON.stringify(actual)}`,
    )
  }
}

/* -------------------------------------------------------------------------- */
/* 4 — the renderer must still state every rule                                */
/* -------------------------------------------------------------------------- */

const anchors = blockAnchors(policy)
let rendered = ""
if (issues.length === 0) {
  rendered = renderManagedBlock(policy)
  for (const anchor of anchors) {
    if (!anchor.pattern.test(rendered)) {
      fail("policy/block-anchor-missing", `渲染出来的管理块没有写明「${anchor.id}」：${anchor.hint}`)
    }
  }
  if (anchors.length === 0) {
    fail("policy/block-anchors-empty", "BLOCK_ANCHORS 是空的——没有任何规则被守住，这不能算 PASS")
  }
}

/* -------------------------------------------------------------------------- */
/* the CI workflow is read once: the lock section and the CI section must be    */
/* looking at the same file, not at two independently-read copies               */
/* -------------------------------------------------------------------------- */

const ciPath = join(projectRoot, CI_WORKFLOW_PATH)
const ciExists = existsSync(ciPath)
const ciInspection = ciExists
  ? inspectCiWorkflow(readFileSync(ciPath, "utf8"))
  : { problems: [], upstreamReuse: [], jobs: 0 }

/* -------------------------------------------------------------------------- */
/* 5 — the managed block in AGENTS.md                                          */
/* -------------------------------------------------------------------------- */

/**
 * `--print-block` is the sync path, so it must be usable in the exact state
 * that needs syncing: a tree whose AGENTS.md block is missing or stale. It
 * therefore runs *after* the policy itself has been validated (sections 1–4)
 * and *before* AGENTS.md is compared. A broken policy still refuses to print —
 * syncing docs to an invalid contract is how bad rules get distributed.
 */
if (flags.get("print-block") === true) {
  if (issues.length > 0) {
    process.stderr.write("策略本身有问题，先修好再同步管理块：\n")
    for (const issue of issues) process.stderr.write(`  ✗ [${issue.code}] ${issue.message}\n`)
    process.exit(EXIT.INVALID)
  }
  process.stdout.write(`${renderManagedBlock(policy)}\n`)
  process.exit(EXIT.OK)
}

let blockStatus = "not-checked"
let blockMatch = null
const agentsPath = join(projectRoot, AGENTS_FILENAME)
if (!existsSync(agentsPath)) {
  fail("policy/missing-agents", `没有找到 ${AGENTS_FILENAME}`)
} else if (rendered) {
  const agentsText = read(AGENTS_FILENAME)
  blockMatch = compareManagedBlock(agentsText, policy)
  if (blockMatch.ok) {
    blockStatus = `✓ ${policy.managedBlock.begin} 与策略一致（逐字匹配）`
  } else {
    blockStatus = `✗ ${blockMatch.message}`
    fail(
      `policy/managed-block-${blockMatch.reason}`,
      `${blockMatch.message}\n  同步：\`pnpm factory:agents --print-block\``,
    )
  }

  for (const anchor of anchors) {
    if (!anchor.pattern.test(agentsText)) {
      fail("policy/agents-anchor-missing", `${AGENTS_FILENAME} 里找不到「${anchor.id}」：${anchor.hint}`)
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 6 — prohibition conflicts across the docs                                   */
/* -------------------------------------------------------------------------- */

let scan = { conflicts: [], linesScanned: 0, filesScanned: 0 }
try {
  const docs = collectPolicyDocs(projectRoot)
  scan = scanProhibitionConflicts(docs)
  assertNonVacuousPolicyScan(scan)
} catch (error) {
  if (error instanceof PolicyScopeError) {
    fail("policy/vacuous-scan", error.message)
  } else throw error
}

for (const conflict of scan.conflicts) {
  fail(
    conflict.code,
    `${conflict.path}:${conflict.line} — ${conflict.message}\n     ${conflict.text}\n` +
      `     改成写明范围，例如「禁止在产品应用代码里引入编排框架」。`,
  )
}

/* -------------------------------------------------------------------------- */
/* 7 — route values must be stated in the block                                */
/* -------------------------------------------------------------------------- */

const routing = policy.modelRouting ?? {}
const routeTokens = [routing.provider, routing.model, routing.reasoningEffort].map((token) => String(token))
const route = routeTokens.join(" / ")
if (blockMatch?.ok) {
  const blockText = rendered
  for (const token of routeTokens) {
    if (!blockText.includes(token)) {
      fail("policy/route-missing", `管理块没有写出路由值 ${JSON.stringify(token)}`)
    }
  }
  const distinct = new Set(routeTokens)
  if (distinct.size !== routeTokens.length) {
    fail("policy/route-ambiguous", `路由三元组存在重复值：${route}`)
  }
}

/* -------------------------------------------------------------------------- */
/* 8 — the lock                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One file, two shapes — and which one applies is **detected, never assumed**.
 *
 * `prototype-starter` (the baseline) writes a **governance-baseline** lock: it is
 * the thing that *is* the Factory, so its lock records its own identity, the
 * policy version governing it, the surfaces that policy manages, and an
 * `unresolved[]` list that makes "do not guess the unknown" mechanical.
 *
 * A derived product writes a **product** lock: which factory version it tracks,
 * where the baseline came from, which initialization stage it is in, what Kits it
 * has installed, and where it deploys. It has no managed-surface list and no
 * `unresolved[]` — those belong to a baseline's governance lock.
 *
 * Both are validated here, because a gate that only knew one shape would reject
 * the other one — and then someone would delete the check instead of fixing it.
 * The rule that holds in *both* shapes is the same: **a tree may not claim a
 * state it is not in.** For the baseline that is `stage: "baseline"` against its
 * package identity; for a product it is `stage` against `init-contract.json`.
 * A product lock that says `product` while the boundary contract still says
 * `baseline` is a half-initialized tree, and it fails here instead of being
 * discovered by the next reader.
 */

let starterVersion = String(policy.policyVersion)
let managedSurfaces = 0
let lockShape = null
let stageStatus = "not-checked"
if (lock) {
  lockShape = detectLockShape(lock)
  if (lockShape === null) {
    fail(
      "lock/shape-unknown",
      `${LOCK_FILENAME} 既不是治理锁（没有 kind: "factory-baseline"），也不是产品锁（没有 factoryVersion）——` +
        "两种形状都不是，就没有任何一种校验能作用在它上面。两种形状的定义见根控制面 contracts/factory-lock.schema.json。",
    )
  }
}

if (lock && lockShape === LOCK_SHAPE_BASELINE) {
  starterVersion = String(lock.starter?.version ?? "?")
  managedSurfaces = (lock.managedSurfaces ?? []).length

  if (lock.policy?.version !== policy.policyVersion) {
    fail(
      "lock/policy-version-drift",
      `${LOCK_FILENAME} 记录 policy ${JSON.stringify(lock.policy?.version)}，策略文件是 ${JSON.stringify(policy.policyVersion)}`,
    )
  }

  for (const rel of lock.managedSurfaces ?? []) {
    if (!existsSync(join(projectRoot, rel))) {
      fail("lock/managed-surface-missing", `${LOCK_FILENAME} 把 ${rel} 列为受管面，但它不存在——列一个不存在的路径等于没有管理它`)
    }
  }

  for (const entry of lock.unresolved ?? []) {
    if (entry.value !== null) {
      fail("lock/guessed-value", `${LOCK_FILENAME} 的 ${entry.id} 不是 null——未知不猜：不能核实的值只能是 null`)
    }
    if (!entry.probe) {
      fail("lock/unprobed-unknown", `${LOCK_FILENAME} 的 ${entry.id} 没有写 probe——未知必须写清楚怎么核的、结果是什么`)
    }
  }

  const activeReuse = ciInspection.upstreamReuse
  const recordedUnknown = (lock.unresolved ?? []).some((entry) => entry.id === UPSTREAM_LOCK_ID)
  if (activeReuse.length > 0 && recordedUnknown) {
    fail(
      "lock/upstream-contradiction",
      `${CI_WORKFLOW_PATH} 已经在调用 ${UPSTREAM_REUSABLE_WORKFLOW}，但 ${LOCK_FILENAME} 仍把 ${UPSTREAM_LOCK_ID} 记为未知`,
    )
  }
  if (activeReuse.length === 0 && !recordedUnknown) {
    fail(
      "lock/upstream-unrecorded",
      `${CI_WORKFLOW_PATH} 没有调用上游 reusable workflow，${LOCK_FILENAME} 必须把 ${UPSTREAM_LOCK_ID} 记为未知（value: null）`,
    )
  }

  const initPath = join(projectRoot, "init-contract.json")
  const pkgRead = existsSync(join(projectRoot, "package.json")) ? readJsonFile(join(projectRoot, "package.json")) : null
  if (pkgRead?.ok && existsSync(initPath)) {
    const init = readJsonFile(initPath)
    if (init.ok && init.value.stage === "baseline") {
      if (lock.starter?.packageName !== pkgRead.value.name) {
        fail(
          "lock/baseline-identity-drift",
          `stage=baseline，但 ${LOCK_FILENAME} 记的是 ${JSON.stringify(lock.starter?.packageName)}，package.json 是 ${JSON.stringify(pkgRead.value.name)}`,
        )
      }
      if (lock.starter?.version !== pkgRead.value.version) {
        fail(
          "lock/baseline-version-drift",
          `stage=baseline，但 ${LOCK_FILENAME} 记的是 v${lock.starter?.version}，package.json 是 v${pkgRead.value.version}`,
        )
      }
    }
  }

  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim()
    if (head !== lock.starter?.commit) {
      warn(
        "lock/head-advanced",
        `HEAD ${head.slice(0, 7)} 不等于锁里的基线 SHA ${String(lock.starter?.commit).slice(0, 7)}。` +
          `锁记的是升级那一刻的快照，HEAD 前进本身不是违规——但两个值必须都能解释。`,
      )
    }
  } catch {
    warn("lock/head-unknown", "拿不到 git HEAD（不在 git 仓库里或没有 git）。未做 SHA 比对，不代表通过。")
  }
}

/* -------------------------------------------------------------------------- */
/* 8b — the product lock                                                       */
/* -------------------------------------------------------------------------- */

if (lock && lockShape === LOCK_SHAPE_PRODUCT) {
  starterVersion = String(lock.factoryVersion ?? "?")
  managedSurfaces = 0

  // 8b.1 — stage must agree with the initialization boundary.
  //
  // This is the check the shape needs and the schema cannot make: `stage` is a
  // word in two files, and "the lock says product while the boundary contract
  // still says baseline" is precisely the half-initialized state the boundary
  // exists to prevent. A schema cannot compare two files; a gate can.
  const initPath = join(projectRoot, "init-contract.json")
  if (!existsSync(initPath)) {
    fail(
      "lock/stage-unverifiable",
      "产品锁的 stage 必须与 init-contract.json 对账，但找不到 init-contract.json ——「没核对」不是「核对通过」。",
    )
  } else {
    const initRead = readJsonFile(initPath)
    if (!initRead.ok) {
      fail("lock/init-unreadable", `无法解析 init-contract.json：${initRead.error.message}`)
    } else if (lock.stage !== initRead.value.stage) {
      fail(
        "lock/stage-mismatch",
        `${LOCK_FILENAME} 的 stage = ${JSON.stringify(lock.stage)}，init-contract.json 是 ${JSON.stringify(initRead.value.stage)}。` +
          "两处必须说同一件事——不一致就是半初始化状态。",
      )
    } else {
      stageStatus = `✓ stage=${lock.stage} 与 init-contract.json 一致`
    }

    if (typeof lock.initContractSha256 === "string") {
      const actual = createHash("sha256").update(readFileSync(initPath)).digest("hex")
      if (actual !== lock.initContractSha256) {
        fail(
          "lock/init-contract-stale",
          `${LOCK_FILENAME} 记的 initContractSha256 与磁盘上的 init-contract.json 不一致` +
            `（锁记 ${lock.initContractSha256.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…）——锁钉住的是另一版初始化契约。改了契约就要同时更新锁。`,
        )
      }
    } else {
      warn("lock/init-contract-unpinned", `${LOCK_FILENAME} 没有记 initContractSha256，钉不住它对应哪一版初始化契约。`)
    }
  }

  // 8b.2 — the Kits facts must be READ from the Kits lock, not retyped into this
  // one. A hand-copied version number is a fact with no owner, and it is exactly
  // the kind of value that silently stops matching the thing it describes.
  if (lock.kits && typeof lock.kits === "object") {
    const kitsPath = join(projectRoot, String(lock.kits.lockPath ?? ""))
    if (!existsSync(kitsPath)) {
      fail("lock/kits-missing", `${LOCK_FILENAME} 把 ${lock.kits.lockPath} 记为 Kits 锁，但它不存在——列一个读不到的路径等于没有记。`)
    } else {
      const kitsRead = readJsonFile(kitsPath)
      if (!kitsRead.ok) {
        fail("lock/kits-unreadable", `无法解析 ${lock.kits.lockPath}：${kitsRead.error.message}`)
      } else {
        const actualRegistry = kitsRead.value.registryVersion ?? null
        const actualCommit = kitsRead.value.source?.commit ?? null
        if (actualRegistry !== lock.kits.registryVersion) {
          fail(
            "lock/kits-registry-drift",
            `${lock.kits.lockPath} 的 registryVersion 是 ${JSON.stringify(actualRegistry)}，锁里写的是 ${JSON.stringify(lock.kits.registryVersion)}`,
          )
        }
        if (actualCommit !== lock.kits.sourceCommit) {
          fail(
            "lock/kits-commit-drift",
            `${lock.kits.lockPath} 的 source.commit 是 ${JSON.stringify(actualCommit)}，锁里写的是 ${JSON.stringify(lock.kits.sourceCommit)}`,
          )
        }
      }
    }
  } else {
    warn(
      "lock/kits-unpinned",
      `${LOCK_FILENAME} 没有记 Kits 安装状态。装了 Kits 的产品锁应当记，且值必须读自 lib/kits/kits.lock.json。`,
    )
  }

  // 8b.3 — the upstream unknown must still be written down. See
  // UPSTREAM_NOTE_MARKER: the product shape carries this in prose because it has
  // no `unresolved[]`, and dropping the rule for one shape would make that shape
  // the weaker one.
  const activeReuse = ciInspection.upstreamReuse
  const recordedUnknown = (lock.notes ?? []).join("\n").includes(UPSTREAM_NOTE_MARKER)
  if (activeReuse.length > 0 && !recordedUnknown) {
    warn(
      "lock/upstream-notes",
      `${CI_WORKFLOW_PATH} 已经在调用 ${UPSTREAM_REUSABLE_WORKFLOW}，notes 里却没有提到上游——记录该更新了。`,
    )
  }
  if (activeReuse.length === 0 && !recordedUnknown) {
    fail(
      "lock/upstream-unrecorded",
      `${CI_WORKFLOW_PATH} 没有调用上游 reusable workflow，产品锁的 notes 必须写明上游（${UPSTREAM_NOTE_MARKER}）仍未核实——` +
        "未知不猜，但也不能不写下来。",
    )
  }

  // 8b.4 — a derivation from a dirty baseline is not reproducible, and saying so
  // costs one warning now instead of one afternoon later.
  if (lock.baseline?.dirty === true) {
    warn("lock/baseline-dirty", `${LOCK_FILENAME} 记 baseline.dirty = true：这次派生不可复现，别把它当成可重建的起点。`)
  }
}

/* -------------------------------------------------------------------------- */
/* 9 — package.json must run this gate, first                                  */
/* -------------------------------------------------------------------------- */

const pkgPath = join(projectRoot, "package.json")
if (!existsSync(pkgPath)) {
  fail("policy/missing-package", "没有找到 package.json")
} else {
  const pkgRead = readJsonFile(pkgPath)
  if (!pkgRead.ok) fail("policy/unreadable-package", `无法解析 package.json：${pkgRead.error.message}`)
  else {
    for (const problem of inspectPackageWiring(pkgRead.value).problems) fail(problem.code, problem.message)
  }
}

/* -------------------------------------------------------------------------- */
/* 10 — CI workflow                                                            */
/* -------------------------------------------------------------------------- */

let ciStatus = "not-checked"
if (!ciExists) {
  fail("ci/missing", `没有找到 ${CI_WORKFLOW_PATH}`)
} else if (ciInspection.problems.length === 0) {
  ciStatus = `✓ ${CI_WORKFLOW_PATH}：质量门自包含、无 Vercel CLI/token、test 与 qa 串行（${ciInspection.jobs} 个 job）`
} else {
  ciStatus = `✗ ${ciInspection.problems.length} 个问题`
  for (const problem of ciInspection.problems) fail(problem.code, `${CI_WORKFLOW_PATH} — ${problem.message}`)
}

/* -------------------------------------------------------------------------- */
/* report                                                                      */
/* -------------------------------------------------------------------------- */

const totalChecks =
  policyValidation.checks + lockValidation.checks + keyValuesChecked + anchors.length + scan.filesScanned

if (totalChecks === 0) {
  fail("policy/vacuous", "总共执行了 0 条断言——0-scan 不能判 PASS")
}

const ok = issues.length === 0
const report = {
  ok,
  status: ok ? "ok" : "invalid",
  policyVersion: policy.policyVersion,
  starterVersion,
  lockShape,
  stageStatus,
  route,
  managedSurfaces,
  schemaChecks: policyValidation.checks + lockValidation.checks,
  keyValueChecks: policyValidation.keyValueChecks + lockValidation.keyValueChecks,
  anchorsChecked: anchors.length,
  filesScanned: scan.filesScanned,
  linesScanned: scan.linesScanned,
  upstreamReuseActive: ciInspection.upstreamReuse.length > 0,
  ignoredSchemaKeywords: policyValidation.ignoredKeywords,
  blockStatus,
  ciStatus,
  issues,
  warnings,
}

report.lines = [
  formatPolicyReport(report),
  `  锁：${LOCK_FILENAME} · 形状 ${lockShape ?? "?"} · stage ${stageStatus}`,
  ...(report.ignoredSchemaKeywords.length > 0
    ? [`  ⚠ schema 里有未实现的关键字（已计入检查队列，不会被当作满足）：${report.ignoredSchemaKeywords.join(", ")}`]
    : []),
  ...(ok
    ? ["", "✓ Agent policy OK：编排边界明确，策略、schema、管理块与 CI 一致。"]
    : ["", `✗ Agent policy 未通过：${issues.length} 个问题。`, ...issues.map((issue) => `  ✗ [${issue.code}] ${issue.message}`)]),
]

emit(report, ok ? EXIT.OK : EXIT.INVALID)
