import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, test } from "@playwright/test"

import {
  DEPLOYMENT_ACTIONS,
  REQUIRES_AUTHORIZATION,
  REQUIRES_NOTHING,
  assertProductionMatchesRC,
  classifyUrlAccess,
  deploymentAction,
  productionPushPreflight,
  verifyDeploymentIdentity,
} from "../scripts/lib/deploy-contract.mjs"

/**
 * Tests for the deployment authorization contract (Factory v1.2 · DEPLOY).
 *
 * Every rule here is one of the six facts the third prototype's release phase
 * discovered the hard way. They are asserted twice on purpose — once as data
 * (the matrix cannot drift from the checks), and once as prose (the document an
 * agent actually reads says the same thing).
 *
 * The gate itself is exercised through its real CLI, so "the contract exists"
 * and "the contract can stop a release" are different assertions.
 */

const ROOT = process.cwd()
const GATE = join(ROOT, "scripts/verify-deployment.mjs")

const readDoc = (path: string) => readFileSync(join(ROOT, path), "utf8")

function runGate(args: string[]): { status: number; stdout: string } {
  try {
    const stdout = execFileSync(process.execPath, [GATE, ...args], { encoding: "utf8" })
    return { status: 0, stdout }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return { status: failure.status ?? -1, stdout: `${failure.stdout ?? ""}${failure.stderr ?? ""}` }
  }
}

function recordFile(record: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "factory-deploy-"))
  const path = join(dir, "deployment.json")
  writeFileSync(path, JSON.stringify(record, null, 2))
  return path
}

/** The shape `GET /v13/deployments/{id}` returns for a real Production deploy. */
const DEPLOYMENT = {
  id: "dpl_6tTd2bncso6pNHSV535QqaZDGw1F",
  url: "prototype-ai-research-abc.vercel.app",
  target: "production",
  readyState: "READY",
  gitSource: { type: "github", ref: "main", sha: "3858f3cdc953d4de0be1019c0ad654d754d4cb64" },
}

/* -------------------------------------------------------------------------- */
/* A — the authorization matrix                                                */
/* -------------------------------------------------------------------------- */

test.describe("deployment authorization", () => {
  const MUST_ASK = [
    "create-project",
    "link-project",
    "change-production-branch",
    "change-deployment-protection",
    "create-production-deployment",
    "promote-preview",
    "create-bypass-token",
    "push-production-branch",
    "merge-to-main",
  ]

  test("every infrastructure action demands explicit user authorization", () => {
    for (const id of MUST_ASK) {
      expect(deploymentAction(id).authorization, `${id} 必须要求明确授权`).toBe(REQUIRES_AUTHORIZATION)
    }
    // Reading state is the one thing an agent may do unasked.
    expect(deploymentAction("read-deployment-state").authorization).toBe(REQUIRES_NOTHING)
  })

  test("the matrix is not empty or duplicated", () => {
    const ids = DEPLOYMENT_ACTIONS.map((action: { id: string }) => action.id)
    expect(ids.length).toBeGreaterThanOrEqual(10)
    expect(new Set(ids).size).toBe(ids.length)
    expect(() => deploymentAction("does-not-exist")).toThrow(/未知的部署动作/)
  })

  test("the document names every action in the matrix", () => {
    // Drift guard: the table in `docs/vercel-bootstrap.md` is the version an
    // agent reads, and it must not fall behind the machine-readable one.
    const doc = readDoc("docs/vercel-bootstrap.md")
    for (const action of DEPLOYMENT_ACTIONS) {
      expect(doc, `checklist 必须写明动作 ${action.id}`).toContain(action.id)
    }
    expect(doc).toContain("Production Branch")
    expect(doc).toContain("Deployment Protection")
  })

  test("AGENTS.md carries the same boundary", () => {
    const agents = readDoc("AGENTS.md")
    expect(agents).toContain("创建 Vercel Project")
    expect(agents).toMatch(/Production deployment/)
    expect(agents).toMatch(/Production Branch/)
    expect(agents).toContain("docs/vercel-bootstrap.md")
  })

  test("the gate holds no credentials and makes no network call", () => {
    // AGENTS.md forbids adding Vercel API/CLI automation to a prototype project.
    // A gate that can only judge a deployment cannot deploy by accident.
    for (const file of ["scripts/lib/deploy-contract.mjs", "scripts/verify-deployment.mjs"]) {
      const source = readDoc(file)
      expect(source, `${file} 不得发起网络请求`).not.toContain("fetch(")
      expect(source, `${file} 不得调用 vercel CLI`).not.toMatch(/child_process|execFile|spawn\(/)
      expect(source, `${file} 不得读取凭证`).not.toMatch(/VERCEL_TOKEN|VERCEL_ORG_ID|VERCEL_PROJECT_ID/)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* B — production branch push is not a neutral push                            */
/* -------------------------------------------------------------------------- */

test.describe("production branch push", () => {
  test("pushing the production branch without authorization is a STOP", () => {
    const result = productionPushPreflight({ branch: "main", productionBranch: "main" })
    expect(result.triggersProduction).toBe(true)
    expect(result.decision).toBe("STOP")
    // The rule that matters: decide *before* the push. Cancelling afterwards is
    // not a rollback — the Production deployment already existed.
    expect(result.message).toContain("不要先 push 再 cancel")
  })

  test("an unknown production branch is also a STOP", () => {
    const unknown = productionPushPreflight({ branch: "main" })
    expect(unknown.decision).toBe("STOP")
    expect(unknown.triggersProduction).toBeNull()

    // Even with authorization in hand: if you do not know which branch is
    // production, you cannot know what this push will create.
    expect(productionPushPreflight({ branch: "main", authorized: true }).decision).toBe("STOP")
  })

  test("a feature branch push proceeds", () => {
    const result = productionPushPreflight({ branch: "feature/research", productionBranch: "main" })
    expect(result.decision).toBe("PROCEED")
    expect(result.triggersProduction).toBe(false)
  })

  test("an authorized production push proceeds, with the follow-up attached", () => {
    const result = productionPushPreflight({
      branch: "main",
      productionBranch: "main",
      authorized: true,
    })
    expect(result.decision).toBe("PROCEED")
    // Authorization to push is never authorization to skip verification.
    expect(result.message).toContain("readyState")
    expect(result.message).toContain("SHA")
  })

  test("the gate really stops it, and really lets it through", () => {
    const blocked = runGate(["preflight", "--branch", "main", "--production-branch", "main"])
    expect(blocked.status, "未授权的生产分支 push 必须非零退出").toBe(1)
    expect(blocked.stdout).toContain("STOP")

    const allowed = runGate([
      "preflight",
      "--branch",
      "main",
      "--production-branch",
      "main",
      "--authorized",
    ])
    expect(allowed.status).toBe(0)
    expect(allowed.stdout).toContain("PROCEED")

    const unknown = runGate(["preflight", "--branch", "main"])
    expect(unknown.status, "Production Branch 未知时也必须 STOP").toBe(1)

    const feature = runGate(["preflight", "--branch", "feature/x", "--production-branch", "main"])
    expect(feature.status).toBe(0)
  })
})

/* -------------------------------------------------------------------------- */
/* C — identity is target + ref + SHA + readyState, never the URL              */
/* -------------------------------------------------------------------------- */

test.describe("deployment identity", () => {
  test("a complete record identifies the deployment", () => {
    const result = verifyDeploymentIdentity(DEPLOYMENT)
    expect(result.ok).toBe(true)
    expect(result.isProduction).toBe(true)
    expect(result.described?.ref).toBe("main")
  })

  test("each required field is required", () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ["target", { ...DEPLOYMENT, target: undefined }, "target"],
      ["sha", { ...DEPLOYMENT, gitSource: { ref: "main" } }, "git SHA"],
      ["ref", { ...DEPLOYMENT, gitSource: { sha: "abc" } }, "git ref"],
      ["readyState", { ...DEPLOYMENT, readyState: undefined }, "readyState"],
      ["id", { ...DEPLOYMENT, id: undefined, url: undefined }, "id"],
    ]

    for (const [label, record, missing] of cases) {
      const result = verifyDeploymentIdentity(record)
      expect(result.ok, `${label} 缺失时必须失败`).toBe(false)
      expect(result.missing).toContain(missing)
    }
  })

  test("a URL on its own proves nothing", () => {
    // `https://x-git-main-team.vercel.app` looks like a branch URL and is just an
    // alias. It says nothing about what was built.
    for (const record of [
      { url: "prototype-x-git-main-team.vercel.app" },
      { alias: ["prototype-x.vercel.app"] },
      null,
      "prototype-x.vercel.app",
    ]) {
      const result = verifyDeploymentIdentity(record)
      expect(result.ok, `${JSON.stringify(record)} 不足以判定身份`).toBe(false)
    }
  })

  test("the older meta.github* shape is understood too", () => {
    // Refusing it would not make the check stricter — it would make it not run.
    const result = verifyDeploymentIdentity({
      uid: "dpl_x",
      target: "preview",
      state: "READY",
      meta: { githubCommitRef: "feature/x", githubCommitSha: "a".repeat(40) },
    })
    expect(result.ok).toBe(true)
    expect(result.isPreview).toBe(true)
  })

  test("the gate exits non-zero on an incomplete record", () => {
    const result = runGate(["verify", "--deployment", recordFile({ url: "x.vercel.app" })])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("部署身份不完整")
    expect(result.stdout).toContain("git SHA")
  })
})

/* -------------------------------------------------------------------------- */
/* D — a protected URL is never called public                                  */
/* -------------------------------------------------------------------------- */

test.describe("URL accessibility", () => {
  test("only an anonymous 2xx supports the word public", () => {
    expect(classifyUrlAccess({ status: 200 }).publicLabelAllowed).toBe(true)

    for (const [status, location] of [
      [401, undefined],
      [403, undefined],
      [302, "https://vercel.com/sso/…"],
      [307, "https://vercel.com/sso/…"],
      [302, undefined],
      [500, undefined],
    ] as Array<[number, string | undefined]>) {
      const result = classifyUrlAccess({ status, location })
      expect(result.publicLabelAllowed, `${status} 不得称为 public`).toBe(false)
    }
  })

  test("an SSO redirect is classified as protected, not as a redirect", () => {
    expect(classifyUrlAccess({ status: 302, location: "https://vercel.com/sso/abc" }).access).toBe(
      "protected",
    )
    // A plain redirect is still not evidence of public access.
    const plain = classifyUrlAccess({ status: 301, location: "https://example.com/new" })
    expect(plain.access).toBe("redirect")
    expect(plain.publicLabelAllowed).toBe(false)
  })

  test("no status code means unknown, and unknown is not public", () => {
    for (const input of [undefined, {}, { status: "200" }, { status: Number.NaN }]) {
      const result = classifyUrlAccess(input as { status?: number })
      expect(result.access).toBe("unknown")
      expect(result.publicLabelAllowed).toBe(false)
    }
  })

  test("the gate exits non-zero for a protected URL", () => {
    const result = runGate([
      "access",
      "--status",
      "302",
      "--location",
      "https://vercel.com/sso/abc",
    ])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("protected")
  })
})

/* -------------------------------------------------------------------------- */
/* E — the bypass secret is a side effect, not an ordinary curl                */
/* -------------------------------------------------------------------------- */

test.describe("automation bypass", () => {
  test("the side effect is declared as data", () => {
    const action = deploymentAction("create-bypass-token")
    expect(action.sideEffectOf).toBe("vercel curl")
    expect(action.sideEffect).toMatch(/automation-bypass/)
    expect(action.disclosure).toBe("required")
  })

  test("the documents say it too", () => {
    for (const file of [
      "docs/vercel-bootstrap.md",
      "AGENTS.md",
      "skills/git-delivery/SKILL.md",
    ]) {
      const doc = readDoc(file)
      expect(doc, `${file} 必须写明 vercel curl 的副作用`).toContain("vercel curl")
      expect(doc, `${file} 必须写明 automation bypass secret`).toContain("automation bypass")
    }
    const doc = readDoc("docs/vercel-bootstrap.md")
    expect(doc).toMatch(/执行前说明|执行后.*披露/)
  })

  test("the action list is printable, side effect included", () => {
    const result = runGate(["actions"])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("create-bypass-token")
    expect(result.stdout).toContain("automation-bypass")
  })
})

/* -------------------------------------------------------------------------- */
/* F — Production must be the accepted RC                                      */
/* -------------------------------------------------------------------------- */

test.describe("production release", () => {
  const RC = DEPLOYMENT.gitSource.sha

  test("the accepted commit is the only acceptable Production", () => {
    expect(assertProductionMatchesRC(DEPLOYMENT, RC).ok).toBe(true)
    // A short SHA is accepted only as an unambiguous prefix of the full one.
    expect(assertProductionMatchesRC(DEPLOYMENT, RC.slice(0, 12)).ok).toBe(true)
  })

  test("a different commit is not a release", () => {
    const result = assertProductionMatchesRC(DEPLOYMENT, "0".repeat(40))
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("≠ 已验收 RC")
  })

  test("a Preview is not a Production release", () => {
    const result = assertProductionMatchesRC({ ...DEPLOYMENT, target: "preview" }, RC)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("不是 production")
  })

  test("SHA match is not enough if it never became READY", () => {
    const result = assertProductionMatchesRC({ ...DEPLOYMENT, readyState: "BUILDING" }, RC)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("READY")
  })

  test("no accepted SHA means no verification", () => {
    expect(assertProductionMatchesRC(DEPLOYMENT, undefined).ok).toBe(false)
    expect(assertProductionMatchesRC(DEPLOYMENT, "").reason).toContain("没有比对的发布不算验证")
  })

  test("the gate reports both the match and the mismatch", () => {
    const ok = runGate(["verify", "--deployment", recordFile(DEPLOYMENT), "--rc", RC])
    expect(ok.status).toBe(0)
    expect(ok.stdout).toContain("已验收 RC")

    const bad = runGate(["verify", "--deployment", recordFile(DEPLOYMENT), "--rc", "0".repeat(40)])
    expect(bad.status).toBe(1)
  })

  test("the delivery skill embeds the preflight before the push", () => {
    const skill = readDoc("skills/git-delivery/SKILL.md")
    const preflightAt = skill.indexOf("verify-deployment.mjs preflight")
    const pushAt = skill.indexOf("git push -u origin feature/")
    expect(preflightAt, "交付 Skill 必须先做预检").toBeGreaterThan(-1)
    expect(pushAt).toBeGreaterThan(-1)
    expect(preflightAt, "预检必须出现在 push 之前").toBeLessThan(pushAt)
  })
})
