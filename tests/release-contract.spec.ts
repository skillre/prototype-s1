import { readFileSync } from "node:fs"
import { join } from "node:path"

import { expect, test } from "@playwright/test"

import * as deployContract from "../scripts/lib/deploy-contract.mjs"
import * as releaseContract from "../scripts/lib/release-contract.mjs"

import {
  HOUSEKEEPING_ITEMS,
  RC_SHA_PATTERN,
  RELEASE_STATES,
  REQUIRED_LOCAL_GATES,
  assertTagTarget,
  evaluateHousekeeping,
  evaluateRelease,
  formatReleaseReport,
  verifyProduction,
} from "../scripts/lib/release-contract.mjs"

/**
 * Tests for the release contract (Factory v1.2 · RELEASE).
 *
 * What is being pinned here is mostly *refusal*: a release candidate that is a
 * moving branch name, a Preview built from a different commit, a machine that
 * declares itself ready without a human having looked, a tag pointing at a later
 * commit, a Production deployment that answers 200 while the domain still serves
 * the previous version, and a housekeeping list that reports "done" because
 * nobody looked.
 *
 * Any of those, left untested, produces the same output as success.
 */

const ROOT = process.cwd()
const readDoc = (path: string) => readFileSync(join(ROOT, path), "utf8")

const RC = "3858f3cdc953d4de0be1019c0ad654d754d4cb64"
const OTHER = "ae07caf76b4848e810ef11049bca5c2c3517cef4"

const GREEN_GATES = { lint: true, typecheck: true, test: true, build: true, qa: true }

const previewRecord = (sha: string) => ({
  id: "dpl_preview_1",
  url: "prototype-ai-research-7f3c2a-preview.vercel.app",
  target: "preview",
  readyState: "READY",
  gitSource: { ref: "feature/ai-research", sha },
})

const productionRecord = (sha: string, extra: Record<string, unknown> = {}) => ({
  id: "dpl_production_1",
  url: "prototype-ai-research.vercel.app",
  target: "production",
  readyState: "READY",
  gitSource: { ref: "main", sha },
  ...extra,
})

const READY_INPUT = {
  rc: { sha: RC },
  localGates: GREEN_GATES,
  preview: previewRecord(RC),
  onlineQa: { ok: true, sha: RC },
  hva: "passed" as const,
  productionAuthorized: true,
}

/* -------------------------------------------------------------------------- */
/* RC: a SHA, not "the latest commit on the branch"                            */
/* -------------------------------------------------------------------------- */

test.describe("RC 是一个明确的 SHA", () => {
  test("没有 RC → NOT READY，并说明「最新 commit」不算 RC", () => {
    const result = evaluateRelease({})
    expect(result.state).toBe("NOT READY")
    expect(result.blockers.join("\n")).toContain("明确的 RC SHA")
    expect(result.blockers.join("\n")).toContain("不是「feature branch 上最新的 commit」")
  })

  test("分支名不是 RC", () => {
    for (const value of ["feature/ai-research", "main", "HEAD", "latest", ""]) {
      const result = evaluateRelease({ ...READY_INPUT, rc: { sha: value } })
      expect(result.state, `rc=${value}`).toBe("NOT READY")
    }
  })

  test("短 SHA 太短不算 RC（必须是无歧义前缀，≥ 8 位）", () => {
    expect(RC_SHA_PATTERN.test("3858f3c")).toBe(false)
    expect(RC_SHA_PATTERN.test("3858f3cd")).toBe(true)
    expect(RC_SHA_PATTERN.test(RC)).toBe(true)

    const result = evaluateRelease({ ...READY_INPUT, rc: { sha: "3858f3c" } })
    expect(result.state).toBe("NOT READY")
  })

  test("本地门禁是五道，缺一道就不是候选", () => {
    expect(REQUIRED_LOCAL_GATES).toEqual(["lint", "typecheck", "test", "build", "qa"])

    for (const gate of REQUIRED_LOCAL_GATES) {
      const gates: Record<string, boolean> = { ...GREEN_GATES, [gate]: false }
      const result = evaluateRelease({ ...READY_INPUT, localGates: gates })
      expect(result.state, gate).toBe("NOT READY")
      expect(result.blockers.join("\n")).toContain(gate)
    }

    // …and "we didn't run it" is not green either.
    const partial = evaluateRelease({ ...READY_INPUT, localGates: { lint: true, typecheck: true } })
    expect(partial.state).toBe("NOT READY")
    expect(partial.blockers.join("\n")).toContain("qa")
  })
})

/* -------------------------------------------------------------------------- */
/* Every step is about the SAME commit                                         */
/* -------------------------------------------------------------------------- */

test.describe("每一步都必须说同一个 SHA", () => {
  test("Preview 与 RC 不同版本 → NOT READY", () => {
    const result = evaluateRelease({ ...READY_INPUT, preview: previewRecord(OTHER) })
    expect(result.state).toBe("NOT READY")
    expect(result.blockers.join("\n")).toContain("验收过的和部署上的不是同一版")
  })

  test("没有部署记录 / 身份不完整 → NOT READY，并强调 URL 不能推断", () => {
    const missingRecord = evaluateRelease({ ...READY_INPUT, preview: null })
    expect(missingRecord.state).toBe("NOT READY")
    expect(missingRecord.blockers.join("\n")).toContain("URL 不能推断 target/ref/SHA")

    const incomplete = evaluateRelease({
      ...READY_INPUT,
      preview: { target: "preview", gitSource: { ref: "feature/ai-research" } },
    })
    expect(incomplete.state).toBe("NOT READY")
    expect(incomplete.blockers.join("\n")).toContain("身份不完整")
  })

  test("在线 QA 未通过 / 跑在别的 SHA 上 → NOT READY", () => {
    const notRun = evaluateRelease({ ...READY_INPUT, onlineQa: null })
    expect(notRun.state).toBe("NOT READY")
    expect(notRun.blockers.join("\n")).toContain("在线 QA 未通过")

    const wrongSha = evaluateRelease({ ...READY_INPUT, onlineQa: { ok: true, sha: OTHER } })
    expect(wrongSha.state).toBe("NOT READY")
    expect(wrongSha.blockers.join("\n")).toContain(`不是 RC`)
  })
})

/* -------------------------------------------------------------------------- */
/* Three states, with the human in the middle                                  */
/* -------------------------------------------------------------------------- */

test.describe("发布状态有三档以上，源码发布与 Production 授权分开", () => {
  test("机器能证明的到此为止：HVA pending 时只能是 READY FOR HUMAN VISUAL ACCEPTANCE", () => {
    for (const hva of [null, "pending"] as const) {
      const result = evaluateRelease({ ...READY_INPUT, hva, productionAuthorized: true })
      expect(result.state).toBe("READY FOR HUMAN VISUAL ACCEPTANCE")
      expect(result.reasons.join("\n")).toContain("人工视觉验收（HVA）仍 pending")
      // Even with a Production authorization on the table, the human gate wins.
      expect(result.state).not.toBe("READY TO RELEASE SOURCE")
      expect(result.state).not.toBe("READY TO DEPLOY PRODUCTION")
    }
  })

  test("HVA 通过但未授权 Production → READY TO RELEASE SOURCE（而不是可以上线）", () => {
    const result = evaluateRelease({ ...READY_INPUT, productionAuthorized: false })
    expect(result.state).toBe("READY TO RELEASE SOURCE")
    expect(result.reasons.join("\n")).toContain("Production 部署**未授权**")
  })

  test("HVA 通过 + 一次性授权 → READY TO DEPLOY PRODUCTION", () => {
    const result = evaluateRelease(READY_INPUT)
    expect(result.state).toBe("READY TO DEPLOY PRODUCTION")
    expect(result.reasons.join("\n")).toContain("一次性明确授权")
  })

  test("状态表里没有 READY FOR RELEASE 这个状态", () => {
    expect(RELEASE_STATES).toHaveLength(4)
    expect(RELEASE_STATES).not.toContain("READY FOR RELEASE")

    const report = formatReleaseReport(evaluateRelease({ ...READY_INPUT, hva: "pending" }))
    expect(report).toContain("READY FOR HUMAN VISUAL ACCEPTANCE")
    expect(report).not.toContain("READY FOR RELEASE")
  })

  test("文档里出现 READY FOR RELEASE 的地方，全都是在否认它", () => {
    const docs = [
      "docs/release-runbook.md",
      "docs/vercel-bootstrap.md",
      "docs/browser-qa.md",
      "docs/prototype-creation-workflow.md",
      "AGENTS.md",
      "skills/git-delivery/SKILL.md",
    ]

    let mentions = 0
    for (const path of docs) {
      for (const line of readDoc(path).split("\n")) {
        if (!line.includes("READY FOR RELEASE")) continue
        mentions += 1
        expect(line, `${path}: ${line}`).toMatch(/没有|不是|不许说|不存在|never/)
      }
    }
    // Non-vacuous: the phrase really is discussed, and always as a negation.
    expect(mentions).toBeGreaterThan(0)
  })
})

/* -------------------------------------------------------------------------- */
/* Tag                                                                        */
/* -------------------------------------------------------------------------- */

test.describe("annotated tag 指向已验收的 RC", () => {
  test("annotated + 指向 RC → ok", () => {
    const result = assertTagTarget({ name: "v1.2.0", type: "tag", targetSha: RC, rcSha: RC })
    expect(result.ok).toBe(true)
    expect(result.reason).toContain("== RC")
  })

  test("轻量 tag 被拒绝", () => {
    const result = assertTagTarget({ name: "v1.2.0", type: "commit", targetSha: RC, rcSha: RC })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("轻量")
  })

  test("tag 名不合语法被拒绝", () => {
    for (const name of ["1.2.0", "v1.2", "release-1.2.0", "v1.2.0-rc1"]) {
      expect(assertTagTarget({ name, type: "tag", targetSha: RC, rcSha: RC }).ok, name).toBe(false)
    }
  })

  test("tag 指向更晚的 commit → 拒绝，并说明「发布的那一版 ≠ 验证过的那一版」", () => {
    const result = assertTagTarget({ name: "v1.2.0", type: "tag", targetSha: OTHER, rcSha: RC })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("已验收的 RC")
    expect(result.reason).toContain("未来读者眼中「发布了哪一版」的唯一凭据")
  })
})

/* -------------------------------------------------------------------------- */
/* Production: multi-evidence                                                  */
/* -------------------------------------------------------------------------- */

test.describe("Production 验收是多证据的", () => {
  const ONLINE_QA = { ok: true }
  const ROUTES = [
    { route: "/", status: 200 },
    { route: "/demo", status: 200 },
  ]

  const verify = (overrides: Record<string, unknown> = {}) =>
    verifyProduction({
      identity: productionRecord(RC),
      rcSha: RC,
      productionBranch: "main",
      aliasServing: true,
      routeStatuses: ROUTES,
      onlineQa: ONLINE_QA,
      ...overrides,
    })

  test("全部证据齐备 → ok，且每条证据都被列出来", () => {
    const result = verify()
    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.evidence.join("\n")).toContain("target = production")
    expect(result.evidence.join("\n")).toContain("alias")
    expect(result.evidence.join("\n")).toContain("核心路由 HTTP 正常")
    expect(result.evidence.join("\n")).toContain("在线 QA 在 Production 上通过")
  })

  test("readyState READY 单独不构成证据：目标/分支/SHA 各自都要对", () => {
    expect(verify({ identity: productionRecord(RC, { target: "preview" }) }).missing.join("\n")).toContain(
      "不是 production",
    )
    expect(
      verify({ identity: { ...productionRecord(RC), gitSource: { ref: "feature/x", sha: RC } } }).missing.join("\n"),
    ).toContain("期望配置的 production branch")
    expect(verify({ identity: productionRecord(OTHER) }).missing.join("\n")).toContain("≠ 已验收 RC 的 SHA")
  })

  test("没有证据表明域名正在服务这一版 → 不通过", () => {
    const result = verify({ aliasServing: null })
    expect(result.ok).toBe(false)
    expect(result.missing.join("\n")).toContain("alias")
  })

  test("核心路由的 HTTP 证据缺失或异常 → 不通过", () => {
    expect(verify({ routeStatuses: [] }).missing.join("\n")).toContain("没有核心路由的 HTTP 证据")
    const broken = verify({
      routeStatuses: [
        { route: "/", status: 200 },
        { route: "/demo", status: 500 },
      ],
    })
    expect(broken.ok).toBe(false)
    expect(broken.missing.join("\n")).toContain("/demo=500")
  })

  test("没有对 Production 跑过在线 QA → 不通过（200 不等于有样式）", () => {
    const result = verify({ onlineQa: null })
    expect(result.ok).toBe(false)
    expect(result.missing.join("\n")).toContain("HTTP 200 不等于有样式")
  })

  test("平台的 live 字段不作为判据", () => {
    // A record that *claims* live:true while the alias is not serving it must
    // still fail — `live` is not read by the contract at all.
    const result = verify({ identity: productionRecord(RC, { live: true }), aliasServing: false })
    expect(result.ok).toBe(false)
    expect(result.missing.join("\n")).toContain("alias")

    const source = readDoc("scripts/lib/release-contract.mjs")
    expect(source).not.toMatch(/\blive\b\s*===|\.live\b/)
  })
})

/* -------------------------------------------------------------------------- */
/* The DEPLOY contract is consumed, not re-implemented                          */
/* -------------------------------------------------------------------------- */

test.describe("DEPLOY 契约是复用的，不是复制的", () => {
  test("三个授权/身份/可访问性函数是同一个函数对象", () => {
    expect(releaseContract.productionPushPreflight).toBe(deployContract.productionPushPreflight)
    expect(releaseContract.verifyDeploymentIdentity).toBe(deployContract.verifyDeploymentIdentity)
    expect(releaseContract.assertProductionMatchesRC).toBe(deployContract.assertProductionMatchesRC)
  })

  test("push 到 Production Branch：未知 → STOP；已知且是它 → STOP；授权后才 PROCEED", () => {
    expect(deployContract.productionPushPreflight({ branch: "main" }).decision).toBe("STOP")
    expect(deployContract.productionPushPreflight({ branch: "main", productionBranch: "main" }).decision).toBe("STOP")
    expect(
      deployContract.productionPushPreflight({ branch: "main", productionBranch: "main", authorized: true }).decision,
    ).toBe("PROCEED")
    expect(
      deployContract.productionPushPreflight({ branch: "feature/x", productionBranch: "main" }).decision,
    ).toBe("PROCEED")

    const stop = deployContract.productionPushPreflight({ branch: "main", productionBranch: "main" })
    expect(stop.triggersProduction).toBe(true)
    expect(stop.message).toContain("不要先 push 再 cancel")
  })

  test("受保护的 URL 仍然不得称为 public", () => {
    const verdict = deployContract.classifyUrlAccess({ status: 302, location: "https://vercel.com/sso-api" })
    expect(verdict.access).toBe("protected")
    expect(verdict.publicLabelAllowed).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* Housekeeping                                                               */
/* -------------------------------------------------------------------------- */

test.describe("housekeeping 是正式步骤，不是收尾随手一提", () => {
  test("九项，机器能查的五项、只能人确认的四项", () => {
    expect(HOUSEKEEPING_ITEMS).toHaveLength(9)
    expect(HOUSEKEEPING_ITEMS.filter((item) => item.kind === "machine")).toHaveLength(5)
    expect(HOUSEKEEPING_ITEMS.filter((item) => item.kind === "human")).toHaveLength(4)

    const ids = HOUSEKEEPING_ITEMS.map((item) => item.id)
    for (const required of [
      "bypass-removed",
      "temp-credentials-cleared",
      "protection-unchanged",
      "working-tree-clean",
      "shas-aligned",
      "artifacts-outside-repo",
      "canceled-is-history",
      "feature-branch-decided",
      "copy-backlog",
    ]) {
      expect(ids).toContain(required)
    }
  })

  test("没有证据一律 pending —— 「忘了看」不能和「没问题」长得一样", () => {
    const empty = evaluateHousekeeping({})
    expect(empty.every((item) => item.status === "pending")).toBe(true)
    expect(empty.some((item) => item.status === "done")).toBe(false)

    const failed = evaluateHousekeeping({ "bypass-removed": false })
    expect(failed.find((item) => item.id === "bypass-removed")?.status).toBe("failed")

    const done = evaluateHousekeeping({ "bypass-removed": true, "feature-branch-decided": true })
    expect(done.find((item) => item.id === "bypass-removed")?.status).toBe("done")
    expect(done.find((item) => item.id === "feature-branch-decided")?.status).toBe("done")
    // Only an explicit `true` counts — a truthy non-boolean must not be read as
    // "confirmed" by either kind of item.
    const truthyNonBoolean = evaluateHousekeeping({ "copy-backlog": "yes" } as unknown as Record<string, boolean>)
    expect(truthyNonBoolean.find((item) => item.id === "copy-backlog")?.status).toBe("pending")
  })
})

/* -------------------------------------------------------------------------- */
/* The documents an agent actually reads say the same thing                     */
/* -------------------------------------------------------------------------- */

test.describe("runbook 与实现说的是同一件事", () => {
  const runbook = readDoc("docs/release-runbook.md")
  const qaDoc = readDoc("docs/browser-qa.md")
  const bootstrap = readDoc("docs/vercel-bootstrap.md")
  const workflow = readDoc("docs/prototype-creation-workflow.md")
  const agents = readDoc("AGENTS.md")
  const skill = readDoc("skills/git-delivery/SKILL.md")

  test("runbook 引用了 DEPLOY 契约，而不是自己发明一套", () => {
    expect(runbook).toContain("docs/vercel-bootstrap.md` 第 0 节")
    expect(runbook).toContain("scripts/lib/deploy-contract.mjs")
    expect(runbook).toContain("scripts/lib/release-contract.mjs")
  })

  test("runbook 里的状态名与 RELEASE_STATES 一致", () => {
    for (const state of RELEASE_STATES) {
      expect(runbook, state).toContain(state)
    }
  })

  test("push Production Branch 之前 STOP，且不允许「先 push 再 cancel」", () => {
    expect(runbook).toContain("先 STOP")
    expect(runbook).toContain("不允许「先 push 再 cancel」")
    expect(bootstrap).toContain("不允许「先 push 再取消」")
    expect(agents).toContain("不允许先 push 再 cancel")
  })

  test("ff-only：不假设 mergeCommit.sha 存在，也不制造 merge commit", () => {
    expect(runbook).toContain("ff-only")
    expect(runbook).toContain("mergeCommit.sha")
    expect(runbook).toContain("不要为了「有个 SHA 可以引用」而制造 merge commit")
  })

  test("tag 规矩：annotated、指向 RC、不 push --tags", () => {
    expect(runbook).toContain("git tag -a")
    expect(runbook).toContain("不要 `git push --tags`")
    expect(runbook).toContain("tag 的 target 必须等于 RC SHA")
    expect(agents).toContain("不要 `git push --tags`")
  })

  test("Production 多证据与「live 不作为判据」写进了文档", () => {
    expect(runbook).toContain("`live` 字段")
    expect(runbook).toContain("不作为判据")
    expect(bootstrap).toContain("`live` 字段**不作为判据**")
  })

  test("在线 QA 的观察者边界与 protected 语义在 QA 文档里", () => {
    expect(qaDoc).toContain("## 8 · Online QA")
    expect(qaDoc).toContain("不部署 · 不创建/连接 Project · 不 promote · 不 merge · 不 tag")
    expect(qaDoc).toContain("**protected**")
    expect(qaDoc).toContain("既不许报成「部署失败」")
    // …and the online entry point is reachable from the docs that agents read.
    expect(workflow).toContain("pnpm qa:online")
    expect(agents).toContain("pnpm qa:online")
    expect(skill).toContain("pnpm qa:online")
  })

  test("T1 被记成 troubleshooting 签名，而不是「慢就等于 T1」", () => {
    expect(qaDoc).toContain("## 9 · T1")
    expect(qaDoc).toContain("重跑一次")
    expect(qaDoc).toContain("「跑得慢」不等于 T1")
    expect(qaDoc).toContain("不许降级成 T1")
  })

  test("housekeeping 与 Release 段落进了 AGENTS.md 和 git-delivery skill", () => {
    expect(agents).toContain("### 发布（RELEASE）")
    expect(agents).toContain("docs/release-runbook.md")
    expect(skill).toContain("docs/release-runbook.md")
    expect(workflow).toContain("docs/release-runbook.md")
  })

  test("第三 Prototype 的十二条线上教训都被写进文档（不是被写成一个故事）", () => {
    const docs = { runbook, qaDoc, bootstrap, workflow, agents, skill }
    const lessons: Array<[string, keyof typeof docs, string]> = [
      ["Vercel GitHub integration 会自动产生部署", "bootstrap", "GitHub"],
      ["受保护的 Preview", "qaDoc", "SSO"],
      ["automation bypass 是副作用", "bootstrap", "automation-bypass"],
      ["push main 会触发 Production", "bootstrap", "自动创建 Production"],
      ["API 部署的 target 语义有歧义", "bootstrap", "target 语义不能靠猜"],
      ["Preview 必须核对 SHA", "runbook", "SHA ≠ RC"],
      ["Production 需要 alias 证据", "runbook", "正在服务这一个"],
      ["tag 在 RC 被验证之后才打", "runbook", "annotated"],
      ["本地 production QA ≠ 线上 QA", "qaDoc", "本地绿了不等于部署上是对的"],
      ["human acceptance ≠ machine QA", "runbook", "不在机器的证据范围内"],
      ["被取消的 Production deployment ≠ 一次发布", "runbook", "cancel 不是回滚"],
      ["automation bypass 之后的 secret 清理", "runbook", "automation bypass secret 是否仍然存在"],
    ]

    for (const [lesson, where, needle] of lessons) {
      expect(docs[where], `${lesson} → ${where}`).toContain(needle)
    }
  })
})
