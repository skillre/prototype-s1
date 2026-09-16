/**
 * Release contract — Factory v1.2 (RELEASE).
 *
 * ===========================================================================
 * Why a state machine and not a boolean
 * ===========================================================================
 * The third prototype's release had four separate authorization boundaries that
 * a single "ship it" flag would have collapsed into one:
 *
 *   - the source release (merge to `main`, push a tag)
 *   - the Production deployment (a one-time, separate authorization)
 *   - the human visual acceptance (a person looking at a Preview)
 *   - the housekeeping afterwards (bypass secrets, protection settings, tags)
 *
 * "Ready" is therefore a **state**, not a boolean:
 *
 *   NOT READY → READY FOR HUMAN VISUAL ACCEPTANCE → READY TO RELEASE SOURCE
 *             → READY TO DEPLOY PRODUCTION
 *
 * Each arrow has a prerequisite that a machine can check, except the one that
 * cannot: no program decides whether the thing looks right. That step is the
 * human's, and this module's job is to refuse to skip past it.
 *
 * ===========================================================================
 * One fact, one place
 * ===========================================================================
 * Deployment authorization, identity verification and the URL-access verdict
 * already live in `scripts/lib/deploy-contract.mjs` (Phase A). They are
 * **re-exported and consumed**, never re-implemented: two answers to "may I push
 * this branch" is exactly the kind of second truth this Factory keeps deleting.
 */

import { assertProductionMatchesRC, productionPushPreflight, verifyDeploymentIdentity } from "./deploy-contract.mjs"

export { assertProductionMatchesRC, productionPushPreflight, verifyDeploymentIdentity }

/** The release states, in order. */
export const RELEASE_STATES = [
  "NOT READY",
  "READY FOR HUMAN VISUAL ACCEPTANCE",
  "READY TO RELEASE SOURCE",
  "READY TO DEPLOY PRODUCTION",
]

/** Local gates that must all be green before anything is a release candidate. */
export const REQUIRED_LOCAL_GATES = ["lint", "typecheck", "test", "build", "qa"]

/** A commit SHA, full or unambiguous prefix (≥ 8 chars), as a release candidate. */
export const RC_SHA_PATTERN = /^[0-9a-f]{8,40}$/

/**
 * A deployment record as read back from the platform's read-only API.
 *
 * Deliberately loose: the field spellings (`gitSource.sha`,
 * `meta.githubCommitSha`, `readyState`, `state`, …) are known in exactly one
 * place — `verifyDeploymentIdentity` in the DEPLOY contract — and this module
 * never re-reads them itself. Re-declaring a narrow shape here would be the
 * second truth about "what a deployment record is".
 *
 * @typedef {Record<string, unknown>} DeploymentRecord
 */

const fullSha = (sha) => typeof sha === "string" && RC_SHA_PATTERN.test(sha)

/**
 * Where is this release?
 *
 * @param {{
 *   rc?: { sha?: string },
 *   localGates?: Record<string, boolean>,
 *   preview?: DeploymentRecord | null,
 *   onlineQa?: { ok?: boolean, sha?: string } | null,
 *   hva?: "pending" | "passed" | null,
 *   productionAuthorized?: boolean,
 * }} input
 * @returns {{state: string, reasons: string[], blockers: string[]}}
 */
export function evaluateRelease(input = {}) {
  const reasons = []
  const blockers = []
  const { rc, localGates = {}, preview, onlineQa, hva = null, productionAuthorized = false } = input

  // 1 · an RC is a SHA, not "the latest commit on the branch"
  if (!rc || !fullSha(rc.sha)) {
    blockers.push(
      "没有一个明确的 RC SHA。RC 不是「feature branch 上最新的 commit」，是一个具体、可引用的 SHA" +
        " —— 本地门禁、Preview、在线 QA、人工验收、Production、tag 全都围着它转。",
    )
    return { state: "NOT READY", reasons, blockers }
  }
  reasons.push(`RC = ${rc.sha}`)

  // 2 · local gates
  const failedGates = REQUIRED_LOCAL_GATES.filter((gate) => localGates[gate] !== true)
  if (failedGates.length > 0) {
    blockers.push(`本地门禁未全绿：${failedGates.join(", ")}`)
    return { state: "NOT READY", reasons, blockers }
  }
  reasons.push(`本地门禁全绿（${REQUIRED_LOCAL_GATES.join(" · ")}）`)

  // 3 · the Preview must be the same commit
  if (!preview) {
    blockers.push("没有 Preview 的身份记录。URL 不能推断 target/ref/SHA，必须有部署记录。")
    return { state: "NOT READY", reasons, blockers }
  }
  const previewIdentity = verifyDeploymentIdentity(preview)
  if (!previewIdentity.ok) {
    blockers.push(`Preview 身份不完整：${previewIdentity.missing.join(", ")}`)
    return { state: "NOT READY", reasons, blockers }
  }
  if (previewIdentity.described.sha !== rc.sha) {
    blockers.push(
      `Preview 的 SHA（${previewIdentity.described.sha}）≠ RC SHA（${rc.sha}）—— ` +
        "验收过的和部署上的不是同一版。",
    )
    return { state: "NOT READY", reasons, blockers }
  }
  reasons.push(`Preview target=${previewIdentity.described.target} ref=${previewIdentity.described.ref} SHA=RC`)

  // 4 · online QA on that Preview
  if (!onlineQa || onlineQa.ok !== true) {
    blockers.push("在线 QA 未通过（本地 production build 的绿色不等于部署环境下的绿色）。")
    return { state: "NOT READY", reasons, blockers }
  }
  if (onlineQa.sha && onlineQa.sha !== rc.sha) {
    blockers.push(`在线 QA 跑在 ${onlineQa.sha} 上，不是 RC（${rc.sha}）。`)
    return { state: "NOT READY", reasons, blockers }
  }
  reasons.push("在线 QA 通过（同一个 RC SHA）")

  // 5 · the human step. No machine may pass this one on its own.
  if (hva !== "passed") {
    reasons.push("机器能证明的到此为止：人工视觉验收（HVA）仍 pending")
    return { state: "READY FOR HUMAN VISUAL ACCEPTANCE", reasons, blockers }
  }
  reasons.push("人工视觉验收已通过（机器只是记录这个事实）")

  // 6 · source release vs Production: two different authorizations
  if (!productionAuthorized) {
    reasons.push("已具备源码发布条件；Production 部署**未授权**（它需要单独的一次性明确授权）")
    return { state: "READY TO RELEASE SOURCE", reasons, blockers }
  }
  reasons.push("Production 部署已获一次性明确授权")
  return { state: "READY TO DEPLOY PRODUCTION", reasons, blockers }
}

/* -------------------------------------------------------------------------- */
/* Tag contract                                                                */
/* -------------------------------------------------------------------------- */

const TAG_NAME_PATTERN = /^v\d+\.\d+\.\d+$/

/**
 * A release tag points at the commit that was accepted — nothing else.
 *
 * Why this is worth a check: the tag is what a future reader treats as "the
 * version that shipped". If it points at a later commit (a follow-up polish
 * commit on `main`, say), then the artifact everyone can download is not the
 * artifact that was verified, and no test run will ever notice. An **annotated**
 * tag is required as well: a lightweight tag is a bare ref with no message, no
 * tagger and no date — it cannot carry the "this is the accepted RC" statement.
 *
 * @param {{name: string, type: "tag" | "commit", targetSha: string, rcSha: string}} tag
 */
export function assertTagTarget(tag) {
  if (!tag || typeof tag !== "object") {
    return { ok: false, reason: "没有 tag 信息可检查。" }
  }
  if (tag.type !== "tag") {
    return {
      ok: false,
      reason: `\`${tag.name}\` 是轻量 tag（lightweight）。发布 tag 必须是 annotated —— 只有 annotated tag 才带 tagger、日期与说明。`,
    }
  }
  if (!TAG_NAME_PATTERN.test(String(tag.name))) {
    return { ok: false, reason: `tag 名 \`${tag.name}\` 不合法：应当是 \`v<major>.<minor>.<patch>\`。` }
  }
  if (tag.targetSha !== tag.rcSha) {
    return {
      ok: false,
      reason:
        `tag 指向 ${tag.targetSha}，已验收的 RC 是 ${tag.rcSha}。` +
        " tag 是未来读者眼中「发布了哪一版」的唯一凭据，它必须指向验收过的那个 commit。",
    }
  }
  return { ok: true, reason: `annotated tag \`${tag.name}\` → ${tag.targetSha} == RC` }
}

/* -------------------------------------------------------------------------- */
/* Production verification                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `readyState === "READY"` is necessary and nowhere near sufficient.
 *
 * Multi-evidence, because each single signal has a known failure mode:
 *   - `target`/`ref`/`sha` say what was built; a URL alias says nothing;
 *   - a deployment can be READY while the domain still serves the previous one
 *     (the alias is what users actually hit);
 *   - the routes can 200 while the page is unstyled, which is why the online
 *     sweep is part of the evidence rather than an optional extra;
 *   - the platform's `live` flag does not track production-serving, so it is
 *     never used as the deciding signal.
 *
 * @param {{
 *   identity: DeploymentRecord,
 *   rcSha: string,
 *   productionBranch: string,
 *   aliasServing: boolean | null,
 *   routeStatuses?: Array<{route: string, status: number}>,
 *   onlineQa?: { ok?: boolean } | null,
 * }} input
 */
export function verifyProduction(input) {
  const { identity, rcSha, productionBranch, aliasServing, routeStatuses = [], onlineQa } = input
  const evidence = []
  const missing = []

  const described = verifyDeploymentIdentity(identity)
  if (!described.ok) {
    return { ok: false, evidence, missing: [`部署身份不完整：${described.missing.join(", ")}`] }
  }
  const d = described.described

  if (d.target !== "production") {
    missing.push(`target 是 \`${d.target}\`，不是 production`)
  } else {
    evidence.push("target = production")
  }
  if (d.ref !== productionBranch) {
    missing.push(`git ref 是 \`${d.ref}\`，期望配置的 production branch \`${productionBranch}\``)
  } else {
    evidence.push(`git ref = ${d.ref}`)
  }
  const shaMatch = assertProductionMatchesRC(identity, rcSha)
  if (!shaMatch.ok) {
    missing.push(shaMatch.reason)
  } else {
    evidence.push(`SHA == RC（${rcSha}）`)
    evidence.push(`readyState = ${d.readyState}`)
  }

  if (aliasServing !== true) {
    missing.push("没有证据表明 production alias / 自定义域正在服务这个 deployment")
  } else {
    evidence.push("production alias / domain 正在服务这个 deployment")
  }

  if (routeStatuses.length === 0) {
    missing.push("没有核心路由的 HTTP 证据")
  } else {
    const bad = routeStatuses.filter((entry) => entry.status < 200 || entry.status >= 400)
    if (bad.length > 0) {
      missing.push(`核心路由异常：${bad.map((entry) => `${entry.route}=${entry.status}`).join(", ")}`)
    } else {
      evidence.push(`核心路由 HTTP 正常（${routeStatuses.map((entry) => entry.route).join(", ")}）`)
    }
  }

  if (!onlineQa || onlineQa.ok !== true) {
    missing.push("没有对 Production 跑过在线 QA（HTTP 200 不等于有样式、可访问、无溢出）")
  } else {
    evidence.push("在线 QA 在 Production 上通过")
  }

  return { ok: missing.length === 0, evidence, missing }
}

/* -------------------------------------------------------------------------- */
/* Housekeeping                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Release housekeeping, as a checklist with a machine-checkable subset.
 *
 * The lesson behind it: the release is not finished when Production answers
 * 200. It is finished when the automation-bypass secret that `vercel curl`
 * created as a side effect is gone, the temporary credentials used to do the
 * work are gone with it, protection settings are the ones you intended, the
 * working tree is clean, and local / remote / tag agree. Those are the things a
 * "we shipped it" message tends to leave behind.
 */
export const HOUSEKEEPING_ITEMS = [
  {
    id: "bypass-removed",
    label: "automation bypass secret 是否仍然存在（应已清理）",
    kind: "machine",
  },
  {
    id: "temp-credentials-cleared",
    label: "临时 credential / 一次性环境变量是否已清理（没有留在 shell、仓库或 CI 里）",
    kind: "human",
  },
  {
    id: "protection-unchanged",
    label: "Deployment Protection 未被意外改变",
    kind: "machine",
  },
  {
    id: "working-tree-clean",
    label: "working tree clean",
    kind: "machine",
  },
  {
    id: "shas-aligned",
    label: "local / origin / tag 三者 SHA 对齐",
    kind: "machine",
  },
  {
    id: "artifacts-outside-repo",
    label: "截图 / 报告 / 临时脚本不在 repo 内",
    kind: "machine",
  },
  {
    id: "canceled-is-history",
    label: "被取消的 deployment 只作为历史，没有被当成一次发布",
    kind: "human",
  },
  {
    id: "feature-branch-decided",
    label: "feature branch 保留还是删除，已明确决定",
    kind: "human",
  },
  {
    id: "copy-backlog",
    label: "文案 / polish backlog 已记录（不偷偷塞进发布）",
    kind: "human",
  },
]

/**
 * Evaluate what can be evaluated.
 *
 * Anything not evidenced stays `pending` — never `done`. "We forgot to look" and
 * "it is fine" must not produce the same output, which is the same rule the
 * probe guard, the seam scanner and the init scanner all follow.
 *
 * @param {Record<string, boolean|undefined>} evidence keyed by item id
 */
export function evaluateHousekeeping(evidence = {}) {
  return HOUSEKEEPING_ITEMS.map((item) => {
    if (item.kind === "human") {
      return { ...item, status: evidence[item.id] === true ? "done" : "pending" }
    }
    const value = evidence[item.id]
    return { ...item, status: value === true ? "done" : value === false ? "failed" : "pending" }
  })
}

/** Human-readable release report. */
export function formatReleaseReport({ state, reasons, blockers }) {
  const lines = [`状态：${state}`]
  for (const reason of reasons) lines.push(`  ✓ ${reason}`)
  for (const blocker of blockers) lines.push(`  ✗ ${blocker}`)
  return lines.join("\n")
}
