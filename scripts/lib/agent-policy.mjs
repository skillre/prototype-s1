/**
 * Factory Core agent policy — the enforcement side of policy 1.3.0.
 *
 * WHAT THIS REPLACES
 * ------------------
 * v1.2 forbade "Multi-agent orchestration" in one flat list, next to Docker and
 * Supabase. That rule was wrong in both directions at once:
 *
 *   - too wide: splitting work across DSH subagents is how the Factory is
 *     *supposed* to work. A blanket ban makes the correct workflow a violation,
 *     and a rule everyone breaks is a rule that protects nothing.
 *   - too vague: the thing that must never ship is an orchestration *framework*
 *     inside the product's runtime — the app must not depend on an agent
 *     scheduler to render a page. That part was never named.
 *
 * v1.3.0 states the boundary instead of a ban, and puts it somewhere machine
 * readable: `factory-policy.json` holds the values, `AGENTS.md` holds a managed
 * block rendered from them, and this module is what makes the three agree.
 *
 * THE THREE SOURCES, AND WHO OWNS WHICH
 * -------------------------------------
 *   factory-policy.json        values            (human edits, schema-validated)
 *   lib/factory-policy.schema.json  key values   (the `const`s: the source of truth)
 *   AGENTS.md managed block    prose            (rendered, verified verbatim)
 *   factory.lock.json          what is locked   (baseline version + SHA + surfaces)
 *
 * The guard does not keep a second copy of the policy values: it reads them out
 * of the schema and cross-checks the JSON, the block and the prose against them.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM
 * -----------------------------------
 * The block is verified against its renderer, not against the world. A change
 * that edits the schema `const`, the policy JSON and the block together is a
 * coherent policy change and this gate will pass it — as it should; that is a
 * reviewed diff on a file whose whole purpose is to be edited deliberately.
 * What the gate *does* refuse is silent disagreement between the three, and a
 * renderer that has quietly stopped stating a rule (see BLOCK_ANCHORS).
 */

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

export const POLICY_FILENAME = "factory-policy.json"
export const LOCK_FILENAME = "factory.lock.json"
export const POLICY_SCHEMA_PATH = "lib/factory-policy.schema.json"
export const LOCK_SCHEMA_PATH = "lib/factory-lock.schema.json"
export const AGENTS_FILENAME = "AGENTS.md"
export const README_FILENAME = "README.md"
export const CI_WORKFLOW_PATH = ".github/workflows/ci.yml"

/** The upstream reusable workflow CI wants to call — present here so one string describes it. */
export const UPSTREAM_CONTROL_REPO = "skillre/prototype-factory-control"
export const UPSTREAM_REUSABLE_WORKFLOW = `${UPSTREAM_CONTROL_REPO}/.github/workflows/reusable-prototype-ci.yml@v1`
/** Lock entry that must exist while the upstream workflow is NOT actually called. */
export const UPSTREAM_LOCK_ID = "upstream/control-repo"

/**
 * The two lock shapes that exist in this workspace, and who gets which.
 *
 * `factory.lock.json` means two different things depending on the tree it sits
 * in, and both are real (see the root control plane's
 * `contracts/factory-lock.schema.json`, which describes them with `oneOf`):
 *
 *   governance-baseline  the Factory baseline's own lock: `kind:
 *                        "factory-baseline"`, baseline identity, managed policy
 *                        version, the managed-surface list, and an
 *                        `unresolved[]` section that makes "don't guess the
 *                        unknown" mechanical.
 *   product              a derived product's lock: `factoryVersion`, where the
 *                        baseline came from, the initialization stage, the Kits
 *                        state, the deployment identity and prose notes.
 *
 * A gate that only knew the first shape would reject the second one outright —
 * which is the "a check that cannot run is not a check that passed" failure this
 * module keeps removing. Both are supported, and which one applies is
 * *detected*, never assumed from the repository's name.
 */
export const LOCK_SHAPE_BASELINE = "governance-baseline"
export const LOCK_SHAPE_PRODUCT = "product"

/**
 * Which shape a parsed lock is.
 *
 * @param {unknown} lock
 * @returns {"governance-baseline"|"product"|null} `null` = neither shape.
 */
export function detectLockShape(lock) {
  if (!isPlainObject(lock)) return null
  if (lock.kind === "factory-baseline") return LOCK_SHAPE_BASELINE
  if (typeof lock.factoryVersion === "string") return LOCK_SHAPE_PRODUCT
  return null
}

/**
 * String a **product** lock must mention in its `notes` while the upstream
 * reusable workflow is not actually being called.
 *
 * The baseline lock records that unknown in `unresolved[]`, where it can be
 * checked precisely (`value` must be `null`, `probe` must say how it was
 * checked). The product shape has no such section — so the same rule ("an
 * inactive upstream call must still be written down as unknown") is carried by
 * the notes text. Dropping it for products would make one of the two shapes
 * strictly weaker, and the weaker shape is always the one that reports green.
 */
export const UPSTREAM_NOTE_MARKER = "prototype-factory-control"

/**
 * Raised when a scan had nothing to look at. Mirrors `InitScopeError` /
 * `SeamScopeError`: an empty scan is not a clean scan, it is a check that did
 * not run, and it must never be reported as a pass.
 */
export class PolicyScopeError extends Error {
  constructor(message) {
    super(message)
    this.name = "PolicyScopeError"
  }
}

/* -------------------------------------------------------------------------- */
/* a small JSON Schema subset validator                                        */
/* -------------------------------------------------------------------------- */

/**
 * Evaluating the *schema* instead of hand-copying its constants is the point:
 * if someone relaxes a `const` in `lib/factory-policy.schema.json`, the policy
 * JSON stops being validated against it — and the named key-value checks below
 * immediately have nothing to compare against, so they fail loudly rather than
 * silently agreeing with a weakened schema.
 *
 * Supported keywords: $ref (local), type, const, enum, pattern, minLength,
 * maxLength, minItems, maxItems, uniqueItems, required, properties,
 * additionalProperties, items, allOf, anyOf, oneOf. Unknown keywords are
 * ignored — and counted as `ignoredKeywords`, so an unsupported keyword can
 * never masquerade as a satisfied one.
 */
const SUPPORTED_KEYWORDS = new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "title",
  "description",
  "default",
  "examples",
  "type",
  "const",
  "enum",
  "pattern",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "uniqueItems",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "allOf",
  "anyOf",
  "oneOf",
])

function jsonTypeOf(value) {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function deepEqual(a, b) {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a).sort()
    const bKeys = Object.keys(b).sort()
    return (
      aKeys.length === bKeys.length &&
      aKeys.every((key, index) => key === bKeys[index] && deepEqual(a[key], b[key]))
    )
  }
  return false
}

function matchesType(value, expected) {
  if (expected === "integer") return Number.isInteger(value)
  if (expected === "number") return typeof value === "number" && Number.isFinite(value)
  return jsonTypeOf(value) === expected
}

function resolveRef(ref, rootSchema) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return undefined
  let node = rootSchema
  for (const rawKey of ref.slice(2).split("/")) {
    const key = rawKey.replace(/~1/g, "/").replace(/~0/g, "~")
    if (!isPlainObject(node) || !(key in node)) return undefined
    node = node[key]
  }
  return node
}

/**
 * Validate `value` against `schema`.
 *
 * @returns {{ ok: boolean, issues: Array<{code: string, path: string, message: string}>,
 *             checks: number, keyValueChecks: number, ignoredKeywords: string[] }}
 */
export function validateAgainstSchema(value, schema) {
  const issues = []
  const ignored = new Set()
  const ctx = { root: schema, issues, ignored, checks: 0, keyValueChecks: 0 }

  const fail = (path, message) => {
    issues.push({ code: "policy/schema", path: path || "(root)", message })
  }

  const walk = (node, nodeSchema, path) => {
    if (nodeSchema === undefined || nodeSchema === true) return
    if (nodeSchema === false) {
      ctx.checks += 1
      fail(path, "schema 为 false：这里不接受任何值")
      return
    }
    if (!isPlainObject(nodeSchema)) return

    if (typeof nodeSchema.$ref === "string") {
      const resolved = resolveRef(nodeSchema.$ref, ctx.root)
      ctx.checks += 1
      if (resolved === undefined) fail(path, `无法解析 $ref ${nodeSchema.$ref}`)
      else walk(node, resolved, path)
    }

    for (const keyword of Object.keys(nodeSchema)) {
      if (!SUPPORTED_KEYWORDS.has(keyword)) ignored.add(keyword)
    }

    if ("type" in nodeSchema) {
      ctx.checks += 1
      const expected = nodeSchema.type
      const ok = Array.isArray(expected)
        ? expected.some((candidate) => matchesType(node, candidate))
        : matchesType(node, expected)
      if (!ok) {
        fail(path, `类型必须是 ${Array.isArray(expected) ? expected.join(" | ") : expected}，实际是 ${jsonTypeOf(node)}`)
        return
      }
    }

    if ("const" in nodeSchema) {
      ctx.checks += 1
      ctx.keyValueChecks += 1
      if (!deepEqual(node, nodeSchema.const)) {
        fail(path, `必须是 ${JSON.stringify(nodeSchema.const)}，实际是 ${JSON.stringify(node)}`)
      }
    }

    if (Array.isArray(nodeSchema.enum)) {
      ctx.checks += 1
      ctx.keyValueChecks += 1
      if (!nodeSchema.enum.some((candidate) => deepEqual(node, candidate))) {
        fail(path, `必须是 ${nodeSchema.enum.map((v) => JSON.stringify(v)).join(" | ")} 之一，实际是 ${JSON.stringify(node)}`)
      }
    }

    if ("pattern" in nodeSchema) {
      ctx.checks += 1
      if (typeof node !== "string" || !new RegExp(nodeSchema.pattern).test(node)) {
        fail(path, `必须匹配 /${nodeSchema.pattern}/，实际是 ${JSON.stringify(node)}`)
      }
    }

    if ("minLength" in nodeSchema) {
      ctx.checks += 1
      if (typeof node !== "string" || node.length < nodeSchema.minLength) {
        fail(path, `长度不得小于 ${nodeSchema.minLength}`)
      }
    }

    if ("maxLength" in nodeSchema) {
      ctx.checks += 1
      if (typeof node === "string" && node.length > nodeSchema.maxLength) {
        fail(path, `长度不得超过 ${nodeSchema.maxLength}`)
      }
    }

    if ("minItems" in nodeSchema) {
      ctx.checks += 1
      if (!Array.isArray(node) || node.length < nodeSchema.minItems) {
        fail(path, `条目数不得少于 ${nodeSchema.minItems}`)
      }
    }

    if ("maxItems" in nodeSchema) {
      ctx.checks += 1
      if (Array.isArray(node) && node.length > nodeSchema.maxItems) {
        fail(path, `条目数不得超过 ${nodeSchema.maxItems}`)
      }
    }

    if ("uniqueItems" in nodeSchema && nodeSchema.uniqueItems) {
      ctx.checks += 1
      if (Array.isArray(node)) {
        const seen = new Set()
        for (const item of node) {
          const key = JSON.stringify(item)
          if (seen.has(key)) fail(path, `条目必须唯一，重复：${key}`)
          seen.add(key)
        }
      }
    }

    if ("items" in nodeSchema && Array.isArray(node)) {
      node.forEach((item, index) => walk(item, nodeSchema.items, `${path}[${index}]`))
    }

    if ("required" in nodeSchema && isPlainObject(node)) {
      for (const key of nodeSchema.required) {
        ctx.checks += 1
        if (!(key in node)) fail(path, `缺少必填字段 ${key}`)
      }
    }

    const properties = isPlainObject(nodeSchema.properties) ? nodeSchema.properties : undefined
    if (properties && isPlainObject(node)) {
      for (const [key, childSchema] of Object.entries(properties)) {
        if (key in node) walk(node[key], childSchema, path ? `${path}.${key}` : key)
      }
    }

    if (nodeSchema.additionalProperties === false && isPlainObject(node)) {
      const known = new Set(Object.keys(properties ?? {}))
      for (const key of Object.keys(node)) {
        ctx.checks += 1
        if (!known.has(key)) fail(path, `出现未声明的字段 ${key}（schema 声明 additionalProperties: false）`)
      }
    }

    // Combinators are not implemented. Refusing loudly is the only honest
    // option: silently skipping a `oneOf` would turn a real constraint into a
    // satisfied one, which is the failure mode this whole module exists to stop.
    for (const keyword of ["allOf", "anyOf", "oneOf"]) {
      const branches = nodeSchema[keyword]
      if (!Array.isArray(branches) || branches.length === 0) continue
      ctx.checks += 1
      fail(path, `schema 用了 ${keyword}，而本校验器不实现它——拒绝静默跳过，请改写 schema`)
    }
  }

  walk(value, schema, "")

  return {
    ok: issues.length === 0,
    issues,
    checks: ctx.checks,
    keyValueChecks: ctx.keyValueChecks,
    ignoredKeywords: [...ignored].sort(),
  }
}

/* -------------------------------------------------------------------------- */
/* the managed block                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Every rule the managed block must state. The guard always renders the block
 * and checks it against this list *before* comparing it to AGENTS.md, so a
 * template edit that quietly drops a rule fails here — the block cannot shrink
 * into something that merely happens to match a truncated file.
 */
export function blockAnchors(policy) {
  const routing = policy?.modelRouting ?? {}
  return [
    { id: "orchestration/allowed", pattern: /允许并要求/, hint: "必须写明 DSH 宿主内多 Subagent 是允许且被要求的" },
    { id: "orchestration/host", pattern: /DSH\s*宿主/, hint: "必须点名宿主" },
    { id: "orchestration/subagents", pattern: /Subagent/, hint: "必须点明 Subagent" },
    { id: "orchestration/forbidden", pattern: /禁止[\s\S]{0,120}产品应用代码/, hint: "必须把禁令限定在产品应用代码" },
    { id: "orchestration/frameworks", pattern: /编排框架|编排运行时/, hint: "必须点名被禁的东西是编排框架/运行时" },
    { id: "routing/provider", pattern: new RegExp(escapeRegExp(String(routing.provider ?? "\u0000"))), hint: "必须写明 provider" },
    { id: "routing/model", pattern: new RegExp(escapeRegExp(String(routing.model ?? "\u0000"))), hint: "必须写明 model" },
    { id: "routing/effort", pattern: new RegExp(escapeRegExp(String(routing.reasoningEffort ?? "\u0000"))), hint: "必须写明 reasoning effort" },
    { id: "concurrency/worktree", pattern: /单\s*worktree\s*单写者/, hint: "必须写明单 worktree 单写者" },
    { id: "concurrency/shared-paths", pattern: /共享路径单\s*owner/, hint: "必须写明共享路径单 owner" },
    { id: "concurrency/test-and-qa", pattern: /test\s*\/\s*qa[\s\S]{0,40}串行/i, hint: "必须写明 test/qa 串行" },
    { id: "gate/hva", pattern: /HVA/, hint: "必须写明人工视觉验收" },
    { id: "gate/deployment", pattern: /部署授权/, hint: "必须写明部署授权" },
  ]
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Render the canonical managed block from the policy.
 *
 * The block is generated, not written by hand: `--print-block` prints exactly
 * this text, and the guard verifies AGENTS.md contains it verbatim. One writer,
 * one reader, no drift.
 */
export function renderManagedBlock(policy) {
  // `end` is not read here: the closing marker is rebuilt from `marker`, so the
  // block's END cannot disagree with its BEGIN about which marker it is.
  const { begin, marker } = policy.managedBlock
  const routing = policy.modelRouting
  const concurrency = policy.concurrency
  const orchestration = policy.agentOrchestration
  const authorization = policy.authorization

  return [
    begin,
    `> 本块由 \`pnpm factory:agents --print-block\` 从 \`factory-policy.json\` 渲染，\`pnpm factory:agents\` 逐字校验。`,
    `> **不要手工编辑块内文字**：改 \`factory-policy.json\`（其关键值由 \`${POLICY_SCHEMA_PATH}\` 钉住），再同步本块。块外仍是人类写的文档。`,
    "",
    `## Factory Core Policy v${policy.policyVersion}（Agent 编排与并发）`,
    "",
    "- **Agent 编排边界（是边界，不是禁令）**：**允许并要求**在 **DSH 宿主**内用多 **Subagent** 拆分与并行任务；",
    `  **禁止**在**产品应用代码**里引入编排框架或编排运行时。`,
    `  - 允许：${orchestration.allowedScope}`,
    `  - 禁止：${orchestration.forbiddenScope}`,
    `  - 判据：\`app\` \`components\` \`lib\` \`hooks\` \`stores\` \`scripts\` 不得 import 编排 SDK；\`package.json\` 的运行时依赖不得出现编排框架。宿主侧的 Subagent 调用不是产品代码，不受此限。`,
    `- **模型路由**：provider \`${routing.provider}\` / model \`${routing.model}\` / reasoning effort \`${routing.reasoningEffort}\`（${routing.verifiedOn} 与 DSH 模型目录核对）。Subagent 默认走这条路由；改路由先改 \`${POLICY_FILENAME}\`。`,
    `- **单 worktree 单写者**（\`${concurrency.worktree}\`）：同一棵工作副本同一时间只有一个写者；要并行写就各自独立 worktree。两个写者共享一棵树，冲突不是概率问题，是时间问题。`,
    `- **共享路径单 owner**（\`${concurrency.sharedPaths}\`）：\`${AGENTS_FILENAME}\`、\`package.json\`、\`${POLICY_FILENAME}\`、\`${LOCK_FILENAME}\`、契约 schema 与门禁脚本这类共享面，同一时间只有一个 owner，其余 agent 只读。`,
    `- **test / qa 串行**（\`${concurrency.testAndQa}\`）：\`pnpm test\` 与 \`pnpm qa\` **永不并发**（Next 16 dev server 按项目加锁，并行只会在错误的 server 上出结果）。CI 里同样不得拆成两个并行 job。`,
    `- **HVA（人工视觉验收）**：\`${authorization.humanVisualAcceptance}\` —— 没有 HVA 就没有发布；Agent 不能替人验收，未完成时状态只能是 \`READY FOR HUMAN VISUAL ACCEPTANCE\`。`,
    `- **部署授权**：\`${authorization.deployment}\` —— 源码发布 ≠ Production 部署。没有用户明确授权，不创建/提升 Production 部署、不改 Deployment Protection、不 push Production Branch。详见 \`docs/vercel-bootstrap.md\` 第 0 节与 \`docs/release-runbook.md\`。`,
    "",
    `机器可读副本：\`${POLICY_FILENAME}\` · 关键值：\`${POLICY_SCHEMA_PATH}\` · 基线锁：\`${LOCK_FILENAME}\` · 校验器：\`scripts/guard-agent-policy.mjs\`（\`pnpm factory:agents\`）。`,
    `<!-- END:${marker} -->`,
  ].join("\n")
}

/** The `<marker>` in `<!-- BEGIN:<marker> vX -->` — read back out of the policy. */
export function extractBlock(agentsText, policy) {
  const begin = policy.managedBlock.begin
  const end = policy.managedBlock.end
  const beginIndex = agentsText.indexOf(begin)
  const endIndex = agentsText.indexOf(end)
  const extraBegin = agentsText.indexOf(begin, beginIndex + 1)
  const extraEnd = agentsText.indexOf(end, endIndex + 1)
  return {
    beginIndex,
    endIndex,
    beginCount: extraBegin === -1 && beginIndex !== -1 ? 1 : countOccurrences(agentsText, begin),
    endCount: extraEnd === -1 && endIndex !== -1 ? 1 : countOccurrences(agentsText, end),
  }
}

function countOccurrences(text, needle) {
  let count = 0
  let index = text.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = text.indexOf(needle, index + needle.length)
  }
  return count
}

/**
 * Normalise for comparison: trailing whitespace per line and the trailing
 * newline are not policy. Everything else — wording, order, punctuation — is.
 */
function normaliseBlock(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n+$/, "")
}

/** Compare the block found in AGENTS.md with the canonical render. */
export function compareManagedBlock(agentsText, policy) {
  const placement = extractBlock(agentsText, policy)
  if (placement.beginCount !== 1 || placement.endCount !== 1) {
    return {
      ok: false,
      reason: "markers",
      found: placement,
      message: `管理块标记必须各出现且仅出现一次：找到 BEGIN × ${placement.beginCount}、END × ${placement.endCount}`,
    }
  }
  if (placement.beginIndex > placement.endIndex) {
    return { ok: false, reason: "order", found: placement, message: "END 标记出现在 BEGIN 之前" }
  }

  const endMarkerIndex = placement.endIndex + policy.managedBlock.end.length
  const actual = agentsText.slice(placement.beginIndex, endMarkerIndex)
  const expected = renderManagedBlock(policy)
  if (normaliseBlock(actual) === normaliseBlock(expected)) {
    return { ok: true, reason: "match", found: placement, expected, actual }
  }

  const actualLines = normaliseBlock(actual).split("\n")
  const expectedLines = normaliseBlock(expected).split("\n")
  const firstDiff = expectedLines.findIndex((line, index) => line !== actualLines[index])
  return {
    ok: false,
    reason: "drift",
    found: placement,
    expected,
    actual,
    message:
      `管理块与 \`factory-policy.json\` 渲染结果不一致（第一处差异在第 ${firstDiff + 1} 行）\n` +
      `  - 期望：${expectedLines[firstDiff] ?? "(缺失)"}\n` +
      `  - 实际：${actualLines[firstDiff] ?? "(缺失)"}`,
  }
}

/* -------------------------------------------------------------------------- */
/* prohibition conflicts                                                       */
/* -------------------------------------------------------------------------- */

const MULTI_AGENT_TERM = /(multi-?agent|多\s*agent|多\s*sub-?agent|sub-?agent)/i
const PROHIBITION = /(禁止|不得|不允许|严禁|forbid|forbidden|must not|❌)/
const SCOPE_QUALIFIER = /(产品应用代码|产品代码|产品运行时|应用代码|运行时依赖|产品依赖|product (application )?code)/i

/**
 * A prohibition that mentions subagents must say *what it is prohibiting*.
 *
 * "禁止 Multi-agent orchestration" fails this scan: it bans the term, so it also
 * bans the host-side workflow the policy requires. "禁止在产品应用代码里引入编排
 * 框架" passes: the scope is named. This is the check that would have caught
 * v1.2 on the day it was written.
 */
export function scanProhibitionConflicts(files) {
  const conflicts = []
  let linesScanned = 0

  for (const { path, text } of files) {
    text.split("\n").forEach((line, index) => {
      linesScanned += 1
      if (!MULTI_AGENT_TERM.test(line)) return
      if (!PROHIBITION.test(line)) return
      const qualifier = line.match(SCOPE_QUALIFIER)
      if (qualifier) return
      conflicts.push({
        code: "policy/unscoped-prohibition",
        path,
        line: index + 1,
        message:
          "禁令提到了 Subagent/Multi-agent，却没有限定范围——这会连宿主侧合法的多 Subagent 一起ban掉。",
        text: line.trim(),
      })
    })
  }

  return { conflicts, linesScanned, filesScanned: files.length }
}

/* -------------------------------------------------------------------------- */
/* CI workflow                                                                 */
/* -------------------------------------------------------------------------- */

/** An *active* call, not a comment mentioning one: YAML comments start with `#`. */
export function detectUpstreamReuse(ciText) {
  const active = []
  ciText.split("\n").forEach((line, index) => {
    if (/^\s*uses:\s*skillre\/prototype-factory-control\//.test(line)) {
      active.push({ line: index + 1, text: line.trim() })
    }
  })
  return active
}

/**
 * Split the `jobs:` mapping into job blocks.
 *
 * Deliberately small: it only needs to answer "which job runs `pnpm qa`, and
 * does it depend on the job that runs `pnpm test`". If `jobs:` is missing the
 * caller must fail — not fall through with zero jobs.
 */
export function parseJobs(ciText) {
  const lines = ciText.split("\n")
  const jobsIndex = lines.findIndex((line) => /^jobs:\s*$/.test(line))
  if (jobsIndex === -1) return { found: false, jobs: [] }

  const jobs = []
  let current = null
  for (let index = jobsIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^\S/.test(line) && line.trim() !== "") break
    const match = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/)
    if (match) {
      current = { name: match[1], line: index + 1, body: [] }
      jobs.push(current)
      continue
    }
    if (current) current.body.push(line)
  }
  return { found: true, jobs }
}

/* -------------------------------------------------------------------------- */
/* CI + package wiring                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The CI contract, as a pure function of the workflow text.
 *
 * Kept out of the CLI on purpose: every rule below is a claim about a file, and
 * a claim that cannot be exercised against a synthetic file is a claim nobody
 * has tested. The spec drives these with deliberately-broken workflows.
 *
 * @returns {{ problems: Array<{code: string, message: string}>, upstreamReuse: Array<{line: number, text: string}>, jobs: number }}
 */
export function inspectCiWorkflow(ciText) {
  const problems = []
  const lines = ciText.split("\n")

  if (!ciText.includes("pnpm factory:agents")) {
    problems.push({ code: "ci/no-policy-gate", message: "CI 没有跑 `pnpm factory:agents`：策略门禁在 CI 里缺席" })
  }

  const vercelCli = lines.findIndex((line) =>
    /\b(vercel|npx vercel)\s+(deploy|pull|link|promote|env|curl|build)\b|npx\s+vercel\b|uses:\s*vercel\//i.test(line),
  )
  if (vercelCli !== -1) {
    problems.push({
      code: "ci/vercel-cli",
      message: `第 ${vercelCli + 1} 行出现 Vercel CLI/action 调用——CI 只做质量门，不用 Vercel CLI/token`,
    })
  }

  const vercelToken = lines.findIndex((line) =>
    /VERCEL_TOKEN|VERCEL_AUTOMATION_BYPASS|vercel-protection-bypass|--token\b/i.test(line),
  )
  if (vercelToken !== -1) {
    problems.push({
      code: "ci/deployment-credential",
      message: `第 ${vercelToken + 1} 行出现部署凭据——CI 不得持久化也不得使用部署 token`,
    })
  }

  const parsed = parseJobs(ciText)
  if (!parsed.found || parsed.jobs.length === 0) {
    problems.push({
      code: "ci/jobs-unparsed",
      message: "解析不到 `jobs:` 段（或没有 job）——无法证明 test/qa 串行，不作为通过",
    })
  } else {
    const runs = (job, command) => job.body.some((line) => new RegExp(`pnpm ${command}(\\s|$)`).test(line))
    const testJobs = parsed.jobs.filter((job) => runs(job, "test"))
    const qaJobs = parsed.jobs.filter((job) => runs(job, "qa"))

    if (testJobs.length === 0) problems.push({ code: "ci/no-test-job", message: "CI 里没有 job 跑 `pnpm test`" })
    if (qaJobs.length === 0) problems.push({ code: "ci/no-qa-job", message: "CI 里没有 job 跑 `pnpm qa`" })

    const overlapping = qaJobs.filter((qa) => testJobs.some((test) => test.name === qa.name))
    if (overlapping.length > 0) {
      problems.push({
        code: "ci/test-qa-same-job",
        message: `job \`${overlapping[0].name}\` 同时跑 test 与 qa——两者永不并发，必须拆成串行 job`,
      })
    }

    for (const qa of qaJobs) {
      const needs = qa.body.find((line) => /^\s*needs:/.test(line))
      const dependsOnTest = needs && testJobs.some((test) => needs.includes(test.name))
      if (!dependsOnTest) {
        problems.push({
          code: "ci/test-qa-not-serial",
          message: `job \`${qa.name}\` 跑 qa 却没有 \`needs:\` 依赖跑 test 的 job——串行没有被机器表达`,
        })
      }
    }
  }

  return { problems, upstreamReuse: detectUpstreamReuse(ciText), jobs: parsed.jobs.length }
}

/**
 * `package.json` wiring: the gate must exist and must be the first item of
 * `check`. A policy gate that is not wired into the aggregate script is a gate
 * that runs when someone remembers to run it.
 *
 * @returns {{ problems: Array<{code: string, message: string}> }}
 */
export function inspectPackageWiring(pkg) {
  const problems = []
  const scripts = pkg?.scripts ?? {}

  if (!scripts["factory:agents"]) {
    problems.push({ code: "package/missing-script", message: "package.json 没有 `factory:agents` 脚本——策略门禁没有被接上" })
  } else if (!String(scripts["factory:agents"]).includes("scripts/guard-agent-policy.mjs")) {
    problems.push({
      code: "package/script-target",
      message: `\`factory:agents\` 没有指向 scripts/guard-agent-policy.mjs：${scripts["factory:agents"]}`,
    })
  }

  if (!/^\s*pnpm factory:agents\s*&&/.test(String(scripts.check ?? ""))) {
    problems.push({
      code: "package/check-order",
      message: `\`check\` 必须以 \`pnpm factory:agents &&\` 开头（它是第一项门禁），实际是：${scripts.check}`,
    })
  }

  return { problems }
}

/* -------------------------------------------------------------------------- */
/* reporting                                                                   */
/* -------------------------------------------------------------------------- */

/** Read the `const` declared at a dot path, e.g. `agentOrchestration.dshSubagents`. */
export function schemaConstAt(schema, dotPath) {
  let node = schema
  for (const key of dotPath.split(".")) {
    const properties = isPlainObject(node?.properties) ? node.properties : undefined
    if (!properties || !(key in properties)) return { declared: false, value: undefined }
    node = properties[key]
  }
  if (isPlainObject(node) && "const" in node) return { declared: true, value: node.const }
  return { declared: false, value: undefined }
}

/**
 * The key values the policy is *about*. The expected value is not written here:
 * it is read out of the schema, so there is exactly one place to change.
 */
export const KEY_VALUE_PATHS = [
  "schemaVersion",
  "managedBlock.marker",
  "managedBlock.version",
  "managedBlock.begin",
  "managedBlock.end",
  "agentOrchestration.host",
  "agentOrchestration.dshSubagents",
  "agentOrchestration.productAppFrameworks",
  "modelRouting.provider",
  "modelRouting.model",
  "modelRouting.reasoningEffort",
  "concurrency.worktree",
  "concurrency.sharedPaths",
  "concurrency.testAndQa",
  "authorization.humanVisualAcceptance",
  "authorization.deployment",
]

export function readJsonFile(path) {
  const text = readFileSync(path, "utf8")
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, error }
  }
}

export function valueAtDotPath(value, dotPath) {
  let node = value
  for (const key of dotPath.split(".")) {
    if (node === null || typeof node !== "object" || !(key in node)) return undefined
    node = node[key]
  }
  return node
}

/** Docs that state agent-facing rules — scanned in full for prohibition conflicts. */
export function collectPolicyDocs(root) {
  const files = []
  for (const rel of [AGENTS_FILENAME, README_FILENAME]) {
    const path = join(root, rel)
    if (existsSync(path)) files.push({ path: rel, text: readFileSync(path, "utf8") })
  }

  const docsDir = join(root, "docs")
  if (existsSync(docsDir)) {
    const walk = (relDir) => {
      for (const entry of readdirSync(join(root, relDir), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        if (entry.name.startsWith(".")) continue
        const rel = `${relDir}/${entry.name}`
        if (entry.isDirectory()) walk(rel)
        else if (entry.name.endsWith(".md")) files.push({ path: rel, text: readFileSync(join(root, rel), "utf8") })
      }
    }
    walk("docs")
  }
  return files
}

export function assertNonVacuousPolicyScan(scan) {
  if (scan.filesScanned === 0) {
    throw new PolicyScopeError("扫过 0 个文档：0-scan 不能判 PASS。")
  }
  if (scan.linesScanned === 0) {
    throw new PolicyScopeError("扫过 0 行文本：0-scan 不能判 PASS。")
  }
}

export function formatPolicyReport(report) {
  const lines = []
  lines.push(`  策略 v${report.policyVersion} · 基线 starter v${report.starterVersion} · 受管面 ${report.managedSurfaces} 个`)
  lines.push(`  schema 断言 ${report.schemaChecks} 条（关键值 ${report.keyValueChecks} 条）· 管理块锚点 ${report.anchorsChecked} 条`)
  lines.push(`  文档扫描 ${report.filesScanned} 个文件 / ${report.linesScanned} 行`)
  lines.push(`  管理块：${report.blockStatus}`)
  lines.push(`  模型路由：${report.route}`)
  lines.push(`  CI：${report.ciStatus}`)
  for (const warning of report.warnings ?? []) lines.push(`  ⚠ [${warning.code}] ${warning.message}`)
  return lines.join("\n")
}
