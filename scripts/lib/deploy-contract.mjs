/**
 * Deployment authorization contract — Factory v1.2 (DEPLOY).
 *
 * ===========================================================================
 * Why this exists
 * ===========================================================================
 * The third prototype's release phase produced six facts that were **not in any
 * Factory document**, and two of them can violate a user's authorization
 * boundary without anyone intending it:
 *
 *   1. Pushing the configured Production Branch can create a **Production**
 *      deployment automatically. It is not a neutral `git push`.
 *   2. The REST `POST /v13/deployments` `gitSource` path picks its own target
 *      semantics. `target` cannot be inferred from the branch name — it has to
 *      be read back.
 *   3. A Preview URL can be behind SSO protection while the project's own
 *      production domain answers anonymously. "Preview is protected" says
 *      nothing about production.
 *   4. `vercel curl` can create an `automation-bypass` secret as a *side
 *      effect*. A command that looks like `curl` mutates platform state.
 *   5. Creating or linking a Vercel Project is an infrastructure change.
 *   6. A Production deployment is a separate, one-time authorization.
 *
 * The Factory's job is to make those facts unavoidable rather than
 * rediscoverable.
 *
 * ===========================================================================
 * What this module is, and what it is not
 * ===========================================================================
 * It is **data plus pure functions**: the authorization matrix, and the three
 * checks that can be made mechanical (pre-push preflight, deployment identity,
 * Production-vs-RC equality). It holds no credentials, performs no network
 * call, and never shells out to `vercel`.
 *
 * That is deliberate. `AGENTS.md` forbids adding Vercel API/CLI automation to a
 * prototype project, and the prohibition is right: a repo that can drive a
 * deployment platform is a repo that can deploy by accident. So this module
 * reads a deployment record the agent already obtained (`vercel inspect --json`
 * or the REST API, both read-only), and judges it. The authorization rules stay
 * in `docs/vercel-bootstrap.md` and `AGENTS.md`, where an agent actually reads
 * them; this file is the part that a machine can enforce on its own.
 */

/**
 * Authorization levels.
 *
 * `explicit-user-authorization` means the *user* said so, for *this* action, in
 * *this* session. "The task mentioned deploying" is not authorization to create
 * a project; "the user approved the Preview" is not authorization to create a
 * Production deployment.
 */
export const REQUIRES_AUTHORIZATION = "explicit-user-authorization"
export const REQUIRES_NOTHING = "none"

/**
 * Every deployment-side action an agent could take.
 *
 * This table is the contract. `docs/vercel-bootstrap.md` restates it for humans
 * and `tests/deploy-contract.spec.ts` asserts the two cannot drift.
 */
export const DEPLOYMENT_ACTIONS = [
  {
    id: "read-deployment-state",
    label: "读取部署列表 / 单个部署的状态",
    authorization: REQUIRES_NOTHING,
    note: "只读。凭证是 user-managed state，Agent 可以读结果，但不拥有认证状态。",
  },
  {
    id: "create-project",
    label: "创建 Vercel Project",
    authorization: REQUIRES_AUTHORIZATION,
    note: "基础设施变更。项目被删除/转移时报告并停止，不要顺手新建一个。",
  },
  {
    id: "link-project",
    label: "link project（写入 .vercel/、绑定仓库）",
    authorization: REQUIRES_AUTHORIZATION,
    note: "这是把本地目录接到一个真实项目上，等于选定了部署目标。",
  },
  {
    id: "change-production-branch",
    label: "修改 Production Branch",
    authorization: REQUIRES_AUTHORIZATION,
    note: "改这一项等于改「哪个分支会直接进生产」。",
  },
  {
    id: "change-deployment-protection",
    label: "修改 Deployment Protection / SSO",
    authorization: REQUIRES_AUTHORIZATION,
    note: "保护策略是安全设置，不是构建配置。",
  },
  {
    id: "create-production-deployment",
    label: "创建 Production deployment",
    authorization: REQUIRES_AUTHORIZATION,
    note: "必须单独获得一次性明确授权，并且只能发布已验收的 RC SHA。",
  },
  {
    id: "promote-preview",
    label: "把 Preview 提升为 Production",
    authorization: REQUIRES_AUTHORIZATION,
    note: "与创建 Production 同级：它会改变对外提供的那一版。",
  },
  {
    id: "create-bypass-token",
    label: "创建 / 使用 automation bypass secret",
    authorization: REQUIRES_AUTHORIZATION,
    sideEffectOf: "vercel curl",
    sideEffect: "命令本身会自动创建一个 automation-bypass secret（平台状态变更）。",
    disclosure: "required",
    note:
      "看起来像普通 curl，实际会写平台状态。执行前说明，或执行后立即明确披露" +
      "（包括「是谁创建的、scope 是什么、是否仍然存在」）。不得当普通 curl 处理。",
  },
  {
    id: "push-production-branch",
    label: "push 到 Production Branch",
    authorization: REQUIRES_AUTHORIZATION,
    preflight: "production-push",
    note:
      "可能自动创建 Production deployment。必须在 push **之前**探测并 STOP；" +
      "不允许「先 push 再 cancel」——Production 可能已经建成，而取消不是回滚。",
  },
  {
    id: "merge-to-main",
    label: "merge feature branch → main",
    authorization: REQUIRES_AUTHORIZATION,
    note: "Agent 默认禁止自动 merge，即使 Preview 全绿。",
  },
]

/** Look up one action. Throws on an unknown id rather than returning undefined. */
export function deploymentAction(id) {
  const action = DEPLOYMENT_ACTIONS.find((entry) => entry.id === id)
  if (!action) throw new Error(`未知的部署动作：${id}`)
  return action
}

/* -------------------------------------------------------------------------- */
/* B. Pre-push preflight                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Would pushing `branch` create a Production deployment, and may we?
 *
 * The order matters more than the answer. When the production branch is
 * *unknown*, the decision is STOP — not "probably fine". The failure this
 * prevents is a push that a careful agent would have cancelled, except there is
 * no cancelling a Production deployment that has already been created.
 *
 * @param {{ branch: string, productionBranch?: string | null, authorized?: boolean }} input
 * @returns {{ decision: "PROCEED" | "STOP", triggersProduction: boolean | null, message: string }}
 */
export function productionPushPreflight({ branch, productionBranch = null, authorized = false }) {
  if (!branch) throw new Error("productionPushPreflight 需要 branch")
  if (!productionBranch) {
    return {
      decision: "STOP",
      triggersProduction: null,
      message:
        `未知 Production Branch。\n` +
        `  push ${branch} 之前必须先确定项目当前的 Production Branch（问用户，或读取只读的部署配置）。\n` +
        `  「不知道」不能被当成「不会触发生产」：Production deployment 建起来之后没有 cancel 可以撤销。`,
    }
  }

  const triggersProduction = branch === productionBranch
  if (!triggersProduction) {
    return {
      decision: "PROCEED",
      triggersProduction: false,
      message: `${branch} 不是 Production Branch（${productionBranch}）→ push 产生 Preview。`,
    }
  }
  if (!authorized) {
    return {
      decision: "STOP",
      triggersProduction: true,
      message:
        `${branch} **就是** Production Branch（${productionBranch}）：这次 push 可能自动创建 Production deployment。\n` +
        `  这是基础设施动作，需要用户对「这一版、这一次」的明确授权。\n` +
        `  不要先 push 再 cancel —— 先停止并请求授权。`,
    }
  }
  return {
    decision: "PROCEED",
    triggersProduction: true,
    message:
      `已授权 push ${branch}（Production Branch）。\n` +
      `  授权只覆盖这一次；落地后仍必须验证：target / git ref / git SHA / readyState，` +
      `并确认 Production 的 SHA == 已验收的 RC SHA。`,
  }
}

/* -------------------------------------------------------------------------- */
/* C. Deployment identity                                                      */
/* -------------------------------------------------------------------------- */

const firstString = (...values) => values.find((value) => typeof value === "string" && value.trim() !== "")

/**
 * Read a deployment's identity out of whatever the tool returned.
 *
 * Both shapes occur in practice: the REST API nests them under `gitSource`,
 * while older CLI/API payloads put them in `meta.github*`. Accepting both is not
 * laxity — it is the difference between "this check needs a specific flag" and
 * "this check runs".
 */
export function describeDeployment(record) {
  if (!record || typeof record !== "object") return null
  const git = record.gitSource ?? {}
  return {
    id: firstString(record.id, record.uid, record.url, record.name) ?? null,
    url: firstString(record.url, record.alias?.[0]) ?? null,
    target: firstString(record.target, record.environment) ?? null,
    ref: firstString(git.ref, record.meta?.githubCommitRef, record.git?.ref) ?? null,
    sha: firstString(git.sha, record.meta?.githubCommitSha, record.git?.sha) ?? null,
    readyState: firstString(record.readyState, record.state) ?? null,
  }
}

/**
 * C: identity comes from `target` + `git ref` + `git SHA` + `readyState`.
 *
 * A URL is not an identity. `https://x-git-branch-team.vercel.app` looks like a
 * branch URL and can be aliased to anything; the API's own fields are the only
 * statement about what was actually built.
 */
export function verifyDeploymentIdentity(record) {
  const described = describeDeployment(record)
  if (!described) {
    return { ok: false, missing: ["deployment record"], described: null, message: "没有部署记录可验证。" }
  }

  const missing = []
  if (!described.id) missing.push("id")
  if (!described.target) missing.push("target")
  if (!described.ref) missing.push("git ref")
  if (!described.sha) missing.push("git SHA")
  if (!described.readyState) missing.push("readyState")

  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      described,
      message:
        `部署身份不完整：缺少 ${missing.join(", ")}。\n` +
        "  不能靠 URL 判断这是哪一版、是 Preview 还是 Production——" +
        "URL 只是别名，target / ref / SHA / readyState 才是事实。",
    }
  }

  const isProduction = described.target === "production"
  return {
    ok: true,
    missing: [],
    described,
    isProduction,
    isPreview: described.target === "preview",
    message:
      `${described.target} · ${described.ref} @ ${described.sha.slice(0, 12)} · ${described.readyState}`,
  }
}

/* -------------------------------------------------------------------------- */
/* D. URL accessibility                                                        */
/* -------------------------------------------------------------------------- */

const SSO_HINTS = [/\/sso(\/|$|\?)/i, /vercel\.com\/sso/i, /_vercel\/sso/i, /sso-protection/i]

/**
 * D: never call a protected URL "public".
 *
 * The label is a claim about what an anonymous visitor gets. Only a 2xx answer
 * to an anonymous request supports that claim; a redirect does not, because the
 * redirect itself is what tells you nothing was served.
 */
export function classifyUrlAccess({ status, location } = {}) {
  if (typeof status !== "number" || !Number.isFinite(status)) {
    return {
      access: "unknown",
      publicLabelAllowed: false,
      message: "没有状态码，无法判断可访问性——不得称为 public。",
    }
  }
  if (status >= 200 && status < 300) {
    return { access: "public", publicLabelAllowed: true, message: `匿名请求 ${status}：可以称为 public。` }
  }
  if (status === 401 || status === 403) {
    return {
      access: "protected",
      publicLabelAllowed: false,
      message: `匿名请求 ${status}：受保护。不得称为 public。`,
    }
  }
  if (status >= 300 && status < 400) {
    const sso = SSO_HINTS.some((hint) => hint.test(location ?? ""))
    return {
      access: sso ? "protected" : "redirect",
      publicLabelAllowed: false,
      message:
        `匿名请求 ${status}${location ? ` → ${location}` : ""}：` +
        (sso
          ? "重定向到 SSO 保护，属于 protected。"
          : "重定向本身不能证明公开——跟随重定向后重新判断。"),
    }
  }
  return {
    access: "unknown",
    publicLabelAllowed: false,
    message: `匿名请求 ${status}：无法归入 public / protected，不得称为 public。`,
  }
}

/* -------------------------------------------------------------------------- */
/* F. Production == accepted RC                                                */
/* -------------------------------------------------------------------------- */

/**
 * F: the Production deployment's SHA must be the SHA that was accepted.
 *
 * Not "a recent deploy", not "the branch head" — the same commit. A short SHA
 * is accepted only as an unambiguous prefix of the full one, because that is
 * how both humans and `vercel inspect` quote it.
 */
export function assertProductionMatchesRC(production, rcSha, { requireReady = true } = {}) {
  const identity = verifyDeploymentIdentity(production)
  if (!identity.ok) return { ok: false, reason: identity.message }
  if (!identity.isProduction) {
    return {
      ok: false,
      reason: `这个部署的 target 是 ${identity.described.target}，不是 production——不能当作发布结果。`,
    }
  }
  if (!rcSha) {
    return { ok: false, reason: "没有可比的已验收 RC SHA——没有比对的发布不算验证。" }
  }

  const sha = identity.described.sha
  const matches = sha === rcSha || (rcSha.length >= 7 && sha.startsWith(rcSha))
  if (!matches) {
    return {
      ok: false,
      reason:
        `Production 部署的 SHA (${sha}) ≠ 已验收 RC 的 SHA (${rcSha})。\n` +
        "  发布的必须是验收过的那一个 commit，而不是「最近一次部署」。",
    }
  }
  if (requireReady && identity.described.readyState !== "READY") {
    return {
      ok: false,
      reason: `SHA 匹配，但 readyState 是 ${identity.described.readyState}，不是 READY——尚未真正上线。`,
    }
  }
  return { ok: true, reason: `Production ${sha} == 已验收 RC，readyState READY。`, sha }
}
