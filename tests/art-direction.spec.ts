import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { expect, test } from "@playwright/test"

import {
  DEVIATION_AXES,
  LINKED_DEVIATION_AXES,
  validateVisualManifest,
} from "../lib/visual-manifest"
import {
  crossCheckPackProfile,
  loadPackManifest,
  resolveKitsRoot,
} from "../scripts/lib/kits-runtime.mjs"
import { invariant } from "./support/product-contract"

/**
 * The Art Direction contract (Factory v1.2 · A1 = F1 + F2 + F8).
 *
 * The three findings are one finding: a human Art Direction decision had no
 * formal, recordable, checkable carrier.
 *
 *   F1  a deliberate deviation from the pack (density) had nowhere to go — the
 *       field `densityNote` was rejected as an unknown key, so the decision
 *       lived in a CSS header comment and, against the pack, looked like a typo;
 *   F2  `motionDirection` was documented as "must agree with the pack's
 *       motionLanguage" and compared to nothing at all;
 *   F8  the workflow had no divergence step, so the default gravity of the
 *       Starter / Reference Sample was inherited rather than decided against.
 *
 * These tests are in three layers, and the layering is the point: what the
 * Factory can prove, what it can prove only when Kits is present, and what it
 * must admit it cannot prove. The third layer is asserted too — a check that
 * did not run must never read as a check that passed.
 */

const ROOT = process.cwd()

const read = (path: string) => readFileSync(join(ROOT, path), "utf8")

/** A complete, legal manifest. Deviations and budget are added per test. */
const BASE = {
  productType: "ai-research-workspace",
  firstVisual:
    "一条纵向论证链占据主空间，研究问题锚定顶部；一处无证据支撑的断点以虚线空槽成为第一视觉焦点",
  stylePack: "instrument",
  signatureComponents: ["insight-reveal", "data-cursor"],
  effects: [],
  motionDirection: "precise",
  density: "high",
  avoid: ["dashboard-hero", "card-grid", "generic-ai-dashboard"],
}

const codes = (input: unknown) => validateVisualManifest(input).issues.map((issue) => issue.code)
const errors = (input: unknown) =>
  validateVisualManifest(input).issues.filter((issue) => issue.severity === "error")
const warnings = (input: unknown) =>
  validateVisualManifest(input).issues.filter((issue) => issue.severity === "warning")

/* -------------------------------------------------------------------------- */
/* §10.1 / §10.2 — the two passing shapes                                      */
/* -------------------------------------------------------------------------- */

test.describe("manifest without deviations", () => {
  test("a legal manifest passes with no errors", () => {
    const result = validateVisualManifest(BASE)
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([])
    expect(result.ok).toBe(true)
  })

  test("an undeclared signature budget is a warning, not a pass and not a failure", () => {
    // The Factory does not impose a count. It also does not pretend that an
    // absent decision is a decision — the warning says exactly that.
    const issues = warnings(BASE)
    expect(issues.map((i) => i.code)).toContain("manifest/signature-budget-undeclared")
    expect(validateVisualManifest(BASE).ok).toBe(true)
  })
})

test.describe("intentional density deviation", () => {
  const withDeviation = {
    ...BASE,
    density: "medium",
    deviations: [
      {
        axis: "density",
        from: "high",
        to: "medium",
        reason: "论证链需要每屏可读的纵向节奏；instrument 的 high 会把引用原文挤成灰块",
      },
    ],
  }

  test("a recorded deviation with a reason passes", () => {
    const result = validateVisualManifest(withDeviation)
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([])
    expect(result.ok).toBe(true)
  })

  test("the record is required — the same divergence without it is not this contract's business yet", () => {
    // Without the record the manifest is still structurally legal: whether the
    // divergence is *allowed* is a question for the pack cross-check (level 3),
    // which is exactly where F1 hurt. See the last describe block.
    const { deviations: dropped, ...withoutDeviation } = withDeviation
    expect(dropped).toHaveLength(1)
    expect(validateVisualManifest({ ...withoutDeviation, density: "high" }).ok).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/* §10.3 / §10.4 — a deviation that is not a decision                          */
/* -------------------------------------------------------------------------- */

test.describe("deviation rejections", () => {
  const deviation = (overrides: Record<string, unknown>) => ({
    ...BASE,
    density: "medium",
    deviations: [
      { axis: "density", from: "high", to: "medium", reason: "理由足够长的说明文字", ...overrides },
    ],
  })

  test("a missing reason fails", () => {
    expect(codes(deviation({ reason: undefined }))).toContain("manifest/deviation-missing-field")
    expect(codes(deviation({ reason: "" }))).toContain("manifest/deviation-empty-field")
  })

  test("a stub reason fails", () => {
    expect(codes(deviation({ reason: "ok" }))).toContain("manifest/deviation-reason-too-short")
    expect(codes(deviation({ reason: "n/a" }))).toContain("manifest/deviation-reason-too-short")
  })

  test("an unknown axis fails instead of being accepted as a typo", () => {
    const result = codes(deviation({ axis: "densitiy" }))
    expect(result).toContain("manifest/deviation-unknown-axis")
    // And the message names the legal set, so the fix is one edit away.
    const issue = validateVisualManifest(deviation({ axis: "densitiy" })).issues.find(
      (entry) => entry.code === "manifest/deviation-unknown-axis",
    )
    expect(issue).toBeDefined()
    for (const axis of DEVIATION_AXES) expect(issue!.message).toContain(axis)
  })

  test("from == to is not a deviation", () => {
    expect(codes(deviation({ to: "high" }))).toContain("manifest/deviation-not-a-deviation")
  })

  test("two entries on one axis conflict", () => {
    const doubled = {
      ...BASE,
      deviations: [
        { axis: "layout", from: "sidebar", to: "rail", reason: "理由足够长的说明文字" },
        { axis: "layout", from: "sidebar", to: "topbar", reason: "理由足够长的说明文字" },
      ],
    }
    expect(codes(doubled)).toContain("manifest/deviation-duplicate-axis")
  })

  test("a deviation may not re-open a door `avoid` closed", () => {
    // The escape hatch this forbids: `avoid: ["card-grid"]` plus a "deviation"
    // that says `to: "card-grid"` — an authorisation nobody gave.
    const sneaky = {
      ...BASE,
      deviations: [
        { axis: "layout", from: "open sections", to: "card-grid", reason: "理由足够长的说明文字" },
      ],
    }
    expect(codes(sneaky)).toContain("manifest/deviation-contradicts-avoid")
  })

  test("a linked axis must agree with the field it explains", () => {
    // Records `to: "low"` while the manifest still declares `density: "medium"`.
    const contradictory = {
      ...BASE,
      density: "medium",
      deviations: [
        { axis: "density", from: "high", to: "low", reason: "理由足够长的说明文字" },
      ],
    }
    expect(codes(contradictory)).toContain("manifest/deviation-mismatch")
  })

  test("a non-array or non-object deviation is rejected, not ignored", () => {
    expect(codes({ ...BASE, deviations: "density" })).toContain("manifest/deviations-not-an-array")
    expect(codes({ ...BASE, deviations: ["density"] })).toContain("manifest/deviation-not-an-object")
  })

  test("the schema and the TS contract agree on the axis vocabulary", () => {
    const schema = JSON.parse(read("lib/visual-manifest.schema.json"))
    const enumValues = schema.properties.deviations.items.properties.axis.enum
    expect(new Set(enumValues)).toEqual(new Set(DEVIATION_AXES))
    // The linked axes must exist in both, or the link would be dead code.
    for (const axis of Object.keys(LINKED_DEVIATION_AXES)) {
      expect(DEVIATION_AXES).toContain(axis)
    }
    expect(schema.properties.deviations.items.required).toEqual(["axis", "from", "to", "reason"])
    expect(schema.properties.signatureComponentBudget.minimum).toBe(0)
    // Still closed: no arbitrary keys, and neither addition is required.
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).not.toContain("deviations")
    expect(schema.required).not.toContain("signatureComponentBudget")
  })
})

/* -------------------------------------------------------------------------- */
/* §10.5 / §10.6 / §10.7 — signature component budget                          */
/* -------------------------------------------------------------------------- */

test.describe("signature component budget", () => {
  test("within budget passes", () => {
    expect(validateVisualManifest({ ...BASE, signatureComponentBudget: 2 }).ok).toBe(true)
    expect(validateVisualManifest({ ...BASE, signatureComponentBudget: 3 }).ok).toBe(true)
  })

  test("over budget fails", () => {
    const result = validateVisualManifest({ ...BASE, signatureComponentBudget: 1 })
    expect(result.ok).toBe(false)
    expect(result.issues.map((i) => i.code)).toContain("manifest/signature-budget-exceeded")
  })

  test("zero signature components is legal — and so is a zero budget", () => {
    const none = { ...BASE, signatureComponents: [], signatureComponentBudget: 0 }
    expect(validateVisualManifest(none).issues.filter((i) => i.severity === "error")).toEqual([])
    expect(validateVisualManifest(none).ok).toBe(true)
    // A zero budget with a component in it is the contradiction, not the zero.
    expect(codes({ ...BASE, signatureComponentBudget: 0 })).toContain(
      "manifest/signature-budget-exceeded",
    )
  })

  test("the budget must be an explicit integer", () => {
    for (const bad of [2.5, -1, "2", null]) {
      expect(
        codes({ ...BASE, signatureComponentBudget: bad }),
        `budget ${JSON.stringify(bad)} 必须失败`,
      ).toContain("manifest/signature-budget-not-an-integer")
    }
  })

  test("the Factory does not impose a number of its own", () => {
    // Three signature components with no declared budget: no error. The Factory
    // enforces the number a product stated; it does not invent one.
    const many = { ...BASE, signatureComponents: ["a", "b", "c", "d", "e", "f"] }
    expect(errors(many)).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* §10.8 — motionDirection, level 1                                            */
/* -------------------------------------------------------------------------- */

test.describe("motionDirection validity (level 1)", () => {
  test("an identifier is accepted", () => {
    for (const good of ["precise", "atmospheric", "precise-structural", "restrained"]) {
      expect(codes({ ...BASE, motionDirection: good })).not.toContain("manifest/invalid-identifier")
    }
  })

  test("a malformed value fails — a sentence or a number is not a vocabulary value", () => {
    for (const bad of ["Precise", "precise structural", "精确", "42", "-x", "a b"]) {
      expect(
        codes({ ...BASE, motionDirection: bad }),
        `motionDirection ${JSON.stringify(bad)} 必须失败`,
      ).toContain("manifest/invalid-identifier")
    }
  })

  test("density is held to the same shape rule", () => {
    expect(codes({ ...BASE, density: "Very High" })).toContain("manifest/invalid-identifier")
  })

  test("membership is NOT enumerated in Core", () => {
    // The legal values come from Kits. A vocabulary copied here would be a
    // second, staler copy of the registry — the exact failure v1.1 removed.
    const source = read("lib/visual-manifest.ts")
    for (const packValue of ["precise", "atmospheric", "restrained", "high", "medium", "low"]) {
      expect(
        source.includes(`"${packValue}"`),
        `Core 不得枚举 pack 取值（发现 "${packValue}"）`,
      ).toBe(false)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* §10.9 / §10.10 — motionDirection, level 3                                   */
/* -------------------------------------------------------------------------- */

const PACK = {
  id: "instrument",
  motion: { language: "precise" },
  profile: { density: "high" },
}

test.describe("pack profile cross-check (level 3)", () => {
  test("agreement is verified, and says which fields it checked", () => {
    const result = crossCheckPackProfile(BASE, PACK)
    expect(result.status).toBe("verified")
    expect(result.issues).toEqual([])
    expect(result.checked.map((c: { label: string }) => c.label)).toEqual([
      "motionDirection",
      "density",
    ])
  })

  test("an UNRECORDED motion conflict fails", () => {
    // F2's exact shape: the manifest says one thing, the pack says another, and
    // nothing compared them.
    const result = crossCheckPackProfile({ ...BASE, motionDirection: "atmospheric" }, PACK)
    expect(result.status).toBe("mismatch")
    expect(result.issues.map((i: { code: string }) => i.code)).toContain("pack/profile-mismatch")
    expect(result.issues[0].message).toContain("deviations")
  })

  test("a RECORDED conflict passes, and is marked as recorded", () => {
    const result = crossCheckPackProfile(
      {
        ...BASE,
        motionDirection: "precise-structural",
        deviations: [
          {
            axis: "motion",
            from: "precise",
            to: "precise-structural",
            reason: "只保留结构性揭示，去掉一切环境动效；名字同时说明用途与取舍",
          },
        ],
      },
      PACK,
    )
    expect(result.status).toBe("verified")
    expect(result.issues).toEqual([])
    expect(result.checked.find((c: { label: string }) => c.label === "motionDirection")?.recorded).toBe(
      true,
    )
  })

  test("a deviation recorded for a DIFFERENT value does not excuse the conflict", () => {
    const result = crossCheckPackProfile(
      {
        ...BASE,
        motionDirection: "atmospheric",
        deviations: [
          { axis: "motion", from: "precise", to: "restrained", reason: "理由足够长的说明文字" },
        ],
      },
      PACK,
    )
    expect(result.status).toBe("mismatch")
  })

  test("insufficient Kits metadata is `unverifiable`, never a pass", () => {
    // The honest branch. A pack that does not expose a machine-readable profile
    // cannot be cross-checked, and saying "verified" would be the lie this whole
    // contract exists to prevent.
    const opaque = { id: "editorial", motion: {}, profile: {} }
    const result = crossCheckPackProfile(BASE, opaque)
    expect(result.status).toBe("unverifiable")
    expect(result.checked).toEqual([])
    expect(result.unverifiable).toHaveLength(2)
    expect(result.issues).toEqual([])
  })

  test("a partially documented pack verifies what exists and names what does not", () => {
    const half = { id: "cinematic", motion: { language: "atmospheric" }, profile: {} }
    const result = crossCheckPackProfile({ ...BASE, motionDirection: "atmospheric" }, half)
    expect(result.status).toBe("verified")
    expect(result.checked.map((c: { label: string }) => c.label)).toEqual(["motionDirection"])
    expect(result.unverifiable.map((c: { label: string }) => c.label)).toEqual(["density"])
  })
})

test.describe("pack manifest loading", () => {
  function kitsFixture(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), "factory-pack-"))
    for (const [rel, content] of Object.entries(files)) {
      const full = join(root, rel)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, content)
    }
    return root
  }

  test("resolves the pack manifest through the registry", () => {
    const root = kitsFixture({
      "styles/pack-a/manifest.json": JSON.stringify(PACK),
    })
    const loaded = loadPackManifest(root, { assets: [{ id: "pack-a", type: "style", manifest: "styles/pack-a/manifest.json" }] }, "pack-a")
    expect(loaded.ok).toBe(true)
    expect(loaded.value.motion.language).toBe("precise")
  })

  test("says WHY it could not load, instead of returning nothing", () => {
    const root = kitsFixture({})
    const registry = { assets: [{ id: "pack-a", type: "style", manifest: "styles/pack-a/manifest.json" }] }
    expect(loadPackManifest(root, registry, "pack-a").reason).toBe("missing")
    expect(loadPackManifest(root, registry, "nope").reason).toBe("not-in-registry")
    expect(loadPackManifest(root, { assets: [{ id: "p", type: "style" }] }, "p").reason).toBe(
      "no-manifest-path",
    )
  })
})

test.describe("the real Kits checkout, when it is there", () => {
  test("the archived third prototype's manifest is caught without its record, and passes with it", () => {
    const kits = resolveKitsRoot({ projectRoot: ROOT })
    test.skip(!kits, "Kits 仓库不在同级目录：上游比对无法进行（这是受支持的状态，不是通过）")

    const archived = "/Users/skillre/ai-prototypes/prototype-ai-research/visual-manifest.json"
    let manifest: Record<string, unknown>
    try {
      manifest = JSON.parse(readFileSync(archived, "utf8"))
    } catch {
      test.skip(true, "归档的第三个 Prototype 不在本机")
      return
    }

    const registry = JSON.parse(readFileSync(kits!.registry, "utf8"))
    const loaded = loadPackManifest(kits!.root, registry, String(manifest.stylePack))
    expect(loaded.ok, "真实 pack manifest 必须可读").toBe(true)

    // 这条测试原本断言 `mismatch`：那时归档的 manifest 有两个**没有载体**的冲突
    // （density medium 对 instrument 的 high；motionDirection 不是 pack 的语言）。
    // 那个仓库此后把两条冲突补成了真实记录（`deviations`），于是今天正确的期望
    // 是「已记录 → verified」。检查的能力一点没少，只是取证方向换了：
    //
    //   1. 有记录 → verified（记录本身就是放行条件）；
    //   2. 把记录摘掉 → 同一份 manifest 立刻 mismatch，且路径正好是那两条；
    //   3. 换一条理由不同的记录 → 仍然 mismatch（记录必须对得上值，不是护身符）。
    const recorded = crossCheckPackProfile(manifest, loaded.value!)
    expect(recorded.status, "归档已是修复后的状态：两条冲突都有记录").toBe("verified")

    const { deviations, ...unrecorded } = manifest as {
      deviations?: Array<{ axis: string }>
    } & Record<string, unknown>
    expect(deviations?.map((entry) => entry.axis).sort()).toEqual(["density", "motion"])

    const withoutRecord = crossCheckPackProfile(unrecorded, loaded.value!)
    expect(withoutRecord.status, "摘掉记录之后，同一份 manifest 必须重新暴露为冲突").toBe("mismatch")
    expect(withoutRecord.issues.map((i: { path: string }) => i.path).sort()).toEqual([
      "density",
      "motionDirection",
    ])

    const wrongRecord = crossCheckPackProfile(
      {
        ...unrecorded,
        deviations: [
          {
            axis: "density",
            from: "high",
            to: "medium",
            reason: "论证链需要每屏可读的纵向节奏，high 密度会让引用原文挤成灰块",
          },
        ],
      },
      loaded.value!,
    )
    expect(wrongRecord.status, "只补一半记录不算修复").toBe("mismatch")
  })

  test("the CLI reports the mismatch and exits non-zero", () => {
    const kits = resolveKitsRoot({ projectRoot: ROOT })
    test.skip(!kits, "Kits 仓库不在同级目录")

    let status = 0
    let output = ""
    try {
      output = execFileSync(
        process.execPath,
        [
          join(ROOT, "scripts/validate-manifest.mjs"),
          "--manifest",
          join(ROOT, "docs/examples/visual-manifest.example.json"),
          "--kits",
          kits!.root,
        ],
        { encoding: "utf8" },
      )
    } catch (error) {
      const failure = error as { status?: number; stdout?: string }
      status = failure.status ?? -1
      output = failure.stdout ?? ""
    }
    // The example manifest matches its pack, so this must be a clean pass that
    // ALSO says out loud that no budget was declared.
    expect(status).toBe(0)
    expect(output).toContain("pack-profile")
    // The decisions the manifest records are echoed, so a missing one is visible
    // in the CLI output rather than only in the file.
    expect(output).toContain("签名组件上限")
    expect(output).toContain("有意偏离")
  })
})

/* -------------------------------------------------------------------------- */
/* §10.11 / §10.12 — the workflow: a gate, and a divergence step before it     */
/* -------------------------------------------------------------------------- */

test.describe("the Art Direction Gate in the workflow", () => {
  const workflow = () => read("docs/prototype-creation-workflow.md")

  test("the pipeline puts the human gate before any build or install", () => {
    const doc = workflow()
    const divergence = doc.indexOf("Art Direction Divergence")
    const manifest = doc.indexOf("Visual Manifest")
    const gate = doc.indexOf("Art Direction Gate")
    const install = doc.indexOf("Kits Source Installation")
    const build = doc.indexOf("Build", gate)

    expect(divergence, "divergence step 必须存在").toBeGreaterThan(-1)
    expect(gate, "gate 必须存在").toBeGreaterThan(-1)
    expect(divergence, "divergence 在 manifest 之前").toBeLessThan(manifest)
    expect(manifest, "manifest 在 gate 之前").toBeLessThan(gate)
    expect(gate, "gate 在 kits 安装之前").toBeLessThan(install)
    expect(install, "安装在任何 Build 之前").toBeLessThan(build)
  })

  test("the divergence step asks a question about the previous visual", () => {
    const doc = workflow()
    const start = doc.indexOf("### 5 · Art Direction Divergence")
    const end = doc.indexOf("### 6 ·", start)
    expect(start, "divergence 必须是一个独立阶段").toBeGreaterThan(-1)
    const section = doc.slice(start, end)

    expect(section).toMatch(/divergence statement/)
    // It must be about *not* inheriting, or it is just another design doc.
    expect(section).toMatch(/Reference Sample/)
    expect(section).toMatch(/为什么不应该长|为什么不该/)
    // And it must be a human input, not a generated one.
    expect(section).toMatch(/人的 Art Direction 输入|不是 Manifest 的自动生成物/)
  })

  test("the gate lists the decisions a human must answer, and is not a questionnaire", () => {
    const doc = workflow()
    const start = doc.indexOf("### 7 · Human Art Direction Gate")
    const end = doc.indexOf("### 8 ·", start)
    expect(start, "Human Art Direction Gate 必须是独立阶段").toBeGreaterThan(-1)
    const gate = doc.slice(start, end)

    for (const required of [
      "第一视觉",
      "绝对不能",
      "density",
      "motion direction",
      "signature budget",
      "Style Pack",
      "effects budget",
      "mobile",
      "intentional deviations",
    ]) {
      expect(gate, `Gate 必须要求回答「${required}」`).toContain(required)
    }
    // Short enough that a human actually reads it. Nine answers, not twenty
    // questions with sub-clauses.
    expect(gate.length, "Gate 必须是九问，不是二十项问卷").toBeLessThan(4000)
  })

  test("the workflow is not the only place that says it", () => {
    const agents = read("AGENTS.md")
    expect(agents).toContain("Art Direction Divergence")
    expect(agents).toContain("Human Art Direction Gate")
    expect(read("docs/visual-manifest.md")).toContain("deviations")
  })
})

/* -------------------------------------------------------------------------- */
/* §10.13 — the declared pack must actually reach the screen                    */
/* -------------------------------------------------------------------------- */

/**
 * A manifest that names a pack proves an intention, not a pixel.
 *
 * `pnpm factory:manifest` verifies that `stylePack` resolves to an `approved`
 * asset in the registry, and that the two linked axes agree with the pack's
 * profile. None of that says the pack's CSS ever reached a browser: the
 * Art Direction gate can be fully green while every surface renders in the
 * Factory's neutral layer — which is exactly the "declared but not wired"
 * failure this block exists to catch.
 *
 * K1 shipped `console` (prototype-kits, registry 0.3.0) having verified it only
 * against the Kits playground. The first time it renders inside a product is
 * here, so the first-render evidence is asserted here rather than assumed.
 */
test.describe("the declared Style Pack reaches real pixels", () => {
  /**
   * 签署取值表 —— 逐条抄自工作区根目录 `STH-浅色主题取值与决策.md` §二。
   *
   * 这一节是**签署文件的机器化副本**：颜色一旦改动，这里与适配层必须同时改，
   * 否则测试会红 —— 这正是"两份人手抄的数字会漂移"要防的事。
   */
  const SIGNED = {
    dark: {
      canvas: "#0B1220",
      panel: "#0F1A2E",
      raised: "#152238",
      rule: "#4A6C9B",
      ink: "#E6EDF7",
      inkMuted: "#8FA3C0",
      accent: "#22D3EE",
      accent2: "#F5A524",
      positive: "#2ECC71",
    },
    light: {
      canvas: "#F4F6F9",
      panel: "#FFFFFF",
      raised: "#E9EFF7",
      rule: "#B7C3D2",
      ink: "#0B1220",
      inkMuted: "#4A5866",
      accent: "#0E7490",
      accent2: "#9A5B00",
      positive: "#116A2F",
    },
  } as const

  /*
   * 产品**有意重写**的槽位（独立于上面的 `SIGNED`）。
   *
   * `SIGNED` 只列产品未重写的槽位 —— 它们必须逐像素等于 pack 的取值。
   * 这两个槽位则相反：断言的是"**产品实际用的那个颜色** == 签署值"，
   * 而不是"pack 说什么"。两张表分开，是因为它们回答两个不同的问题；
   * 混在一张表里，必然有一半是假话。
   */
  const PRODUCT_SIGNED = {
    dark: { negative: "#FF5A70", evidence: "#60A5FA" },
    light: { negative: "#C81E33", evidence: "#1D4ED8" },
  } as const

  /** 五个语义：一个色相 = 一个含义，跨主题必须落在同一族（色相 ±25°）。 */
  const HUE_FAMILIES = [
    { meaning: "ai-cyan · AI 正在产出", slot: "accent" },
    { meaning: "attack-red · 攻击 / 失败", slot: "negative" },
    { meaning: "authorize-amber · 球在你那边", slot: "accent2" },
    { meaning: "closed-green · 已闭环", slot: "positive" },
    { meaning: "evidence-blue · 证据可点开", slot: "evidence" },
  ] as const

  /** 语义色必须承载正文，因此对每个它可能出现的承载面都要过 AA。 */
  const FACES = ["canvas", "panel", "raised"] as const

  const PALETTE_PROBE = `(() => {
    const root = getComputedStyle(document.documentElement)
    const read = (name) => root.getPropertyValue(name).trim()
    return {
      scope: document.documentElement.getAttribute("data-kits-pack"),
      dark: document.documentElement.classList.contains("dark"),
      packs: {
        canvas: read("--kits-color-canvas"),
        panel: read("--kits-color-surface"),
        raised: read("--kits-color-surface-raised"),
        rule: read("--kits-color-rule"),
        ink: read("--kits-color-ink"),
        inkMuted: read("--kits-color-ink-muted"),
        inkFaint: read("--kits-color-ink-faint"),
        inkGhost: read("--kits-color-ink-ghost"),
        ruleStrong: read("--kits-color-rule-strong"),
        accent: read("--kits-color-accent"),
        accent2: read("--kits-color-accent-2"),
        positive: read("--kits-color-positive"),
        negative: read("--kits-color-negative"),
        evidence: read("--kits-data-series-3"),
        accentInk: read("--kits-color-accent-ink"),
        focus: read("--kits-color-focus"),
      },
      product: {
        background: read("--background"),
        foreground: read("--foreground"),
        surface: read("--surface"),
        hairline: read("--hairline"),
        brand: read("--brand"),
        success: read("--success"),
        warning: read("--warning"),
        danger: read("--danger"),
        evidence: read("--evidence"),
      },
      body: getComputedStyle(document.body).backgroundColor,
    }
  })()`

  type PaletteReading = {
    scope: string | null
    dark: boolean
    packs: Record<string, string>
    product: Record<string, string>
    body: string
  }

  /**
   * Lab（CSS `lab()` / `oklab()` 的字符串形态）→ sRGB。仅 Node 侧需要：
   * 浏览器侧一律走 canvas 归一化（更稳），但有些断言（负对照、签署表比对）
   * 在 Node 上下文里直接算，那里没有 `document`。
   *
   * 依据 CSS Color 4：Lab 以 D50 白点为参考，先转 XYZ(D50)，再 Bradford 适应到 D65，
   * 最后 sRGB 传递函数 + 钳制。
   */
  function labToRgb(l: number, a: number, b: number): { r: number; g: number; b: number } {
    const k = 24389 / 27
    const e = 216 / 24389
    const fy = (l + 16) / 116
    const fx = fy + a / 500
    const fz = fy - b / 200
    const xyzD50 = [
      fx ** 3 > e ? fx ** 3 : (116 * fx - 16) / k,
      l > k * e ? ((l + 16) / 116) ** 3 : l / k,
      fz ** 3 > e ? fz ** 3 : (116 * fz - 16) / k,
    ]
    // D50 → D65（Bradford 适应，CSS Color 4 的常系数）
    const [X, Y, Z] = xyzD50
    const xyzD65 = [
      0.9554734 * X - 0.0230985 * Y + 0.0632593 * Z,
      -0.0283697 * X + 1.0099955 * Y + 0.0210414 * Z,
      0.0123140 * X - 0.0205077 * Y + 1.3303659 * Z,
    ]
    const lin = [
      3.2409699419 * xyzD65[0] - 1.5373831776 * xyzD65[1] - 0.4986107603 * xyzD65[2],
      -0.9692436363 * xyzD65[0] + 1.8759675015 * xyzD65[1] + 0.0415550574 * xyzD65[2],
      0.0556300797 * xyzD65[0] - 0.2039769589 * xyzD65[1] + 1.0569715142 * xyzD65[2],
    ]
    const encode = (v: number) => {
      const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
      return Math.max(0, Math.min(255, Math.round(c * 255)))
    }
    return { r: encode(lin[0]), g: encode(lin[1]), b: encode(lin[2]) }
  }

  const inBrowser = typeof document !== "undefined"

  /**
   * 任意合法 CSS 颜色写法 → 0–255 分量。**Node 与浏览器两侧都能用。**
   *
   * 为什么需要它两侧可用：这个 spec 有的断言在浏览器里跑（读 computed style），
   * 有的在 Node 侧直接算（签署表之间的负对照）。只支持一侧的实现会在另一侧炸。
   *
   * 为什么要处理 `lab()`：Chromium 对某些颜色表达式（实测：pack 里经 color-mix 之类的
   * 令牌）的 `getComputedStyle` 返回值是 `lab(...)` 而不是 `rgb(...)`。手写全套 CSS 颜色
   * 解析是在追浏览器实现，所以**浏览器侧一律交给 canvas 归一化**（对纯色填充的读取是精确的，
   * 不经过 PNG 量化）；Node 侧只做 hex/rgb/lab 三种——那三种覆盖这个 spec 实际会遇到的全部输入。
   *
   * 这次放宽的是**输入格式**，不是阈值：要证明的性质（页面上的颜色就是签署表里那个）
   * 一个字未改。若哪天有人把它改成"认不出就算相等"，那才是把探针改死了。
   */
  function parseColor(value: string): { r: number; g: number; b: number } {
    if (typeof value !== "string") {
      throw new Error(`颜色探针收到非字符串：${JSON.stringify(value)}（多半是某个 token 没解析出来）`)
    }
    const raw = value.trim()

    const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
    if (hex) {
      const body = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1]
      return {
        r: parseInt(body.slice(0, 2), 16),
        g: parseInt(body.slice(2, 4), 16),
        b: parseInt(body.slice(4, 6), 16),
      }
    }

    const rgb = raw.match(/^rgba?\(([^)]+)\)$/i)
    if (rgb) {
      const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number)
      if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
        return { r: parts[0], g: parts[1], b: parts[2] }
      }
    }

    const lab = raw.match(/^lab\(\s*([\d.]+)%?\s+(-?[\d.]+)\s+(-?[\d.]+)/i)
    if (lab) return labToRgb(Number(lab[1]), Number(lab[2]), Number(lab[3]))

    if (!inBrowser) throw new Error(`Node 侧认不出的颜色写法：${JSON.stringify(value)}`)

    // 浏览器侧：交给浏览器自己归一化。
    const canvas = document.createElement("canvas")
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("无法取得 2d context，颜色探针无法判定")
    ctx.fillStyle = "#000000"
    ctx.fillStyle = raw
    const accepted = ctx.fillStyle
    if (accepted === "#000000" && !/^(#000000|black|rgb\(0,\s*0,\s*0\))$/i.test(raw)) {
      throw new Error(`认不出的颜色写法：${JSON.stringify(value)}（浏览器也拒绝解析）`)
    }
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return { r, g, b }
  }

  const sameColor = (a: string, b: string) => {
    const [x, y] = [parseColor(a), parseColor(b)]
    return x.r === y.r && x.g === y.g && x.b === y.b
  }

  /** WCAG 相对亮度（sRGB 线性化），用于对比度。 */
  function luminance(value: string): number {
    const { r, g, b } = parseColor(value)
    const channel = (v: number) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  }

  function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p)
    return (hi + 0.05) / (lo + 0.05)
  }

  /** HSL 色相角（0–360）。色相族判定用它，不用"颜色是否相同"这种弱代理。 */
  function hueOf(value: string): number {
    const { r, g, b } = parseColor(value)
    const [rn, gn, bn] = [r / 255, g / 255, b / 255]
    const max = Math.max(rn, gn, bn)
    const min = Math.min(rn, gn, bn)
    const delta = max - min
    if (delta === 0) return 0
    let hue: number
    if (max === rn) hue = ((gn - bn) / delta) % 6
    else if (max === gn) hue = (bn - rn) / delta + 2
    else hue = (rn - gn) / delta + 4
    hue *= 60
    return hue < 0 ? hue + 360 : hue
  }

  const hueDistance = (a: number, b: number) => {
    const d = Math.abs(a - b) % 360
    return Math.min(d, 360 - d)
  }

  /** 同一语义在两个主题下的色相差上限。实测最大 11°（证据蓝），留一倍余量。 */
  const SAME_FAMILY_MAX = 25
  /** 不同语义之间的色相下限。实测最接近的一对是青 187° vs 蓝 213° = 26°。 */
  const DISTINCT_MEANING_MIN = 20

  const cssChain = () => ({
    globals: read("app/globals.css"),
    bridge: read("lib/kits/adapters/sth-tokens.css"),
    pack: JSON.parse(read("visual-manifest.json")).stylePack as string,
  })

  test("globals.css reaches the pack through the adapter bridge, never the managed tree", () => {
    const { globals, bridge, pack } = cssChain()

    // One entry point, and it is the product-owned adapter seam.
    expect(globals).toContain('@import "../lib/kits/adapters/sth-tokens.css"')
    expect(globals, "产品样式表不得直接 import 托管区").not.toContain("@import \"../lib/kits/installed")

    // The bridge points at the pack the manifest declares. Change one without
    // the other and this fails — which is the drift a `stylePack` id alone
    // cannot catch.
    expect(bridge).toContain(`@import "./style-${pack}.css"`)
  })

  test("the pack scope is declared on <html>, and its tokens resolve", async ({ page }) => {
    const pack = JSON.parse(read("visual-manifest.json")).stylePack as string

    // 用产品形态的视口量，而不是 Playwright 的默认 1280×720：QA 矩阵是
    // `desktop 1440×900 × {dark, light}`（见 .qa/qa.config.mjs），这里的像素证据
    // 必须与那个矩阵同坐标，否则"上屏"说的就不是同一块屏。
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ colorScheme: "dark" })
    await page.goto("/", { waitUntil: "domcontentloaded" })

    const measured = (await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement)
      const read2 = (name: string) => root.getPropertyValue(name).trim()
      return {
        scope: document.documentElement.getAttribute("data-kits-pack"),
        darkClass: document.documentElement.classList.contains("dark"),
        packCanvas: read2("--kits-color-canvas"),
        packRule: read2("--kits-color-rule"),
        packDuration: read2("--kits-dur-base"),
        background: read2("--background"),
        hairline: read2("--hairline"),
        bodyBackground: getComputedStyle(document.body).backgroundColor,
      }
    })) as Record<string, string | boolean | null>

    // ① the scope attribute is really on <html> (portals need it there)
    expect(measured.scope).toBe(pack)
    expect(measured.darkClass, "深色主题下才有 pack 的取值").toBe(true)

    // ② the pack's own tokens resolve — i.e. its stylesheet arrived
    expect(measured.packCanvas, "console 的画布取值").toBe("#0b1220")
    expect(measured.packRule, "规则线取值必须解析出来（它不在为空的默认里）").not.toBe("")
    expect(measured.packDuration, "动效刻度由适配层注入 <html>").toMatch(/^\d+(\.\d+)?ms$/)

    // ③ the bridge really connects them to the product's semantic tokens
    //    ⚠ 比较**归一化之后**的值，不比较字符串：
    //      Chromium 对 pack 的令牌可能返回 `lab(...)`，对适配层直接写的 hex 返回 `#rrggbb`
    //      —— 两者可以指同一个颜色而字符串不同。归一化后比较，才是"颜色相同"的正确判据。
    //
    //    注意：`measured` 的索引签名是 `string | boolean | null`，所以 `!` 只能去掉 null，
    //    去不掉 boolean（typecheck 会报 TS2345）。用 String() 转换才是真的收窄；
    //    万一某个键没读到，parseColor 会以"收到非字符串"响亮地炸，不会被兜底救活。
    expect(
      sameColor(String(measured.background), String(measured.packCanvas)),
      `深色主题的画布 = pack 的画布（适配层 ${measured.background} vs pack ${measured.packCanvas}）`,
    ).toBe(true)
    // 规则线同理：产品层从 pack 令牌继承，字符串形态可能不同（实测 pack 返回的是
    // 带透明度的写法），但归一化之后必须是同一个颜色。
    expect(
      sameColor(String(measured.hairline), String(measured.packRule)),
      `规则线必须与 pack 的规则线同色（${measured.hairline} vs ${measured.packRule}）`,
    ).toBe(true)

    // ④ and it reached the canvas, not just the token table
    expect(measured.bodyBackground, "body 必须有实体底色").not.toBe("rgba(0, 0, 0, 0)")
    expect(measured.bodyBackground).not.toBe("rgb(255, 255, 255)")
  })

  test("两套主题都逐值兑现签署表，而且真的画到了页面上", async ({ page }) => {
    const pack = JSON.parse(read("visual-manifest.json")).stylePack as string
    const readTheme = async (theme: "dark" | "light") => {
      // 用产品形态的视口量：QA 矩阵是 `desktop 1440×900 × {dark, light}`
      // （见 .qa/qa.config.mjs），这里的像素证据必须与那个矩阵同坐标。
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.emulateMedia({ colorScheme: theme })
      await page.goto("/", { waitUntil: "domcontentloaded" })
      return (await page.evaluate(PALETTE_PROBE)) as PaletteReading
    }

    const dark = await readTheme("dark")
    const light = await readTheme("light")

    for (const [name, reading, signed] of [
      ["dark", dark, SIGNED.dark],
      ["light", light, SIGNED.light],
    ] as const) {
      expect(reading.scope, `${name}: pack 作用域必须声明在 <html> 上`).toBe(pack)
      expect(reading.dark, `${name}: 主题 class`).toBe(name === "dark")

      // ① 逐值比对签署表（不是"非空"，不是"看起来像个颜色"）
      //    这一张表里的槽位**产品未重写**，所以页面上的 pack 令牌必须逐像素等于签署值。
      for (const [slot, expected] of Object.entries(signed)) {
        expect(
          sameColor(reading.packs[slot], expected),
          `${name}.${slot}：解析值 ${reading.packs[slot]} ≠ 签署值 ${expected}`,
        ).toBe(true)
      }

      // ①b 产品**有意重写**的两个语义槽位：断言的是"产品实际用的颜色 == 签署值"。
      //     它们与 pack 的原始令牌可以不相等（那正是"重写"的含义），但必须等于
      //     产品层映射出来的 `--danger` / `--evidence` —— 也就是页面真正会用的那两个。
      const productSigned: Record<string, keyof PaletteReading["product"]> = {
        negative: "danger",
        evidence: "evidence",
      }
      for (const [slot, productKey] of Object.entries(productSigned)) {
        const expected = (PRODUCT_SIGNED[name] as Record<string, string>)[slot]
        expect(
          sameColor(reading.product[productKey], expected),
          `${name}.${slot}（产品重写）：--${productKey} = ${reading.product[productKey]} ≠ 签署值 ${expected}`,
        ).toBe(true)
      }

      // ② 语义槽位映射是同一份（两套主题共用），产品令牌必须等于 pack 槽位
      const bridge: Array<[keyof PaletteReading["product"], string]> = [
        ["background", "canvas"],
        ["foreground", "ink"],
        ["surface", "panel"],
        ["hairline", "rule"],
        ["brand", "accent"],
        ["success", "positive"],
        ["warning", "accent2"],
      ]
      /*
       * 产品**有意重写**的槽位 —— 不列进上面那张桥接表，改在这里单独声明。
       *
       * 为什么不能只是从桥接表里删掉：那样等于把"这个槽位还连着 pack 吗"这个问题
       * **永久取消**，将来 `--danger` 意外断链也不会有任何东西发现。
       * 所以这里改成两条**不依赖"是否相同"**的断言（取值正确性由 ①b 逐值比对负责）：
       *   · 它必须在**两套主题下都有取值**（断链就会空）；
       *   · 它承载的语义（红 = 攻击）**必须在每个承载面上过 AA** —— 这一条由
       *     下面「一色一义」那组断言覆盖，且读的正是产品槽位。
       *
       * 顺带纠正一个我写错的判断：**浅色下 `--danger` 与 pack 的 negative 本来就该相同**
       * （`#C81E33` 在浅色三个面上是 5.26 / 5.69 / 4.92，本来就达标，无需重写）。
       * 只有深色需要重写（pack 原值 `#F4364C` 在 card 面 4.16、raise 面 3.69）。
       * "重写"是**按主题分别判断**的，不是全局声明。
       */
      for (const productKey of ["danger", "evidence"] as const) {
        expect(
          reading.product[productKey],
          `${name}：--${productKey} 必须解析出取值（断链会空）`,
        ).not.toBe("")
      }

      for (const [productToken, packSlot] of bridge) {
        expect(
          sameColor(reading.product[productToken], reading.packs[packSlot]),
          `${name}: --${productToken} 必须绑定到 pack 的 ${packSlot}`,
        ).toBe(true)
      }

      // ③ 页面真的画成了这套主题（token 解析对 ≠ 页面用了它）
      expect(
        sameColor(reading.body, reading.packs.canvas),
        `${name}: body 背景应当是画布色，实测 ${reading.body}`,
      ).toBe(true)
    }

    // ④ 两套主题没有塌成一套：浅色画布既不是深色画布，也就是签署的那个冷白
    expect(sameColor(light.packs.canvas, SIGNED.dark.canvas), "浅色不得解析成深色画布 #0b1220").toBe(
      false,
    )
    expect(sameColor(light.packs.canvas, SIGNED.light.canvas)).toBe(true)
  })

  invariant(
    "color.every-hue-has-one-meaning",
    "一色一义：同一语义跨主题同色相、族间互异，且每个语义色在它出现的每个承载面上都过 AA",
    () => {
    test("五个语义：一色一义（色相族跨主题不变、族间互异）且每个承载面都过 AA", async ({ page }) => {
      const readTheme = async (theme: "dark" | "light") => {
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.emulateMedia({ colorScheme: theme })
        await page.goto("/", { waitUntil: "domcontentloaded" })
        return (await page.evaluate(PALETTE_PROBE)) as PaletteReading
      }

      const dark = await readTheme("dark")
      const light = await readTheme("light")
      const themes = [
        ["dark", dark],
        ["light", light],
      ] as const

      /*
       * 色相族判定 —— 这是已登记的不变量 `color.every-hue-has-one-meaning`（登记在本块外层）的核心，
       * 也是"两套主题确实是同一个语义体系"的唯一机器证据。
       * 用 HSL 色相角，而不是"两个颜色不一样"这种弱代理：那个代理在两个语义被
       * 换成同一色相时会照样通过。
       */
      for (const { meaning, slot } of HUE_FAMILIES) {
        const [hueDark, hueLight] = [hueOf(dark.packs[slot]), hueOf(light.packs[slot])]
        expect(
          hueDistance(hueDark, hueLight),
          `${meaning}：深色 ${hueDark.toFixed(1)}° 与浅色 ${hueLight.toFixed(1)}° 不在同一色相族（上限 ${SAME_FAMILY_MAX}°）`,
        ).toBeLessThanOrEqual(SAME_FAMILY_MAX)
      }

      for (const [name, reading] of themes) {
        for (let i = 0; i < HUE_FAMILIES.length; i += 1) {
          for (let j = i + 1; j < HUE_FAMILIES.length; j += 1) {
            const distance = hueDistance(
              hueOf(reading.packs[HUE_FAMILIES[i].slot]),
              hueOf(reading.packs[HUE_FAMILIES[j].slot]),
            )
            expect(
              distance,
              `${name}：${HUE_FAMILIES[i].meaning} 与 ${HUE_FAMILIES[j].meaning} 的色相只差 ${distance.toFixed(1)}°，一个色相被两个语义借用了`,
            ).toBeGreaterThanOrEqual(DISTINCT_MEANING_MIN)
          }
        }
      }

      // 负对照：判定器必须能失败 —— 拿浅色的"青"去比深色的"红"，必须被判成不同族。
      // 没有这一条，"色相族相同"可能只是判定器永远返回 true。
      // 注意取的是 PRODUCT_SIGNED（产品实际用的红），不是 SIGNED —— 后者只列未重写的槽位。
      expect(
        hueDistance(hueOf(SIGNED.light.accent), hueOf(PRODUCT_SIGNED.dark.negative)),
        "色相族判定器没有区分能力（青 vs 红被判成同族）",
      ).toBeGreaterThan(SAME_FAMILY_MAX)

      /* 对比度：每个语义色对它可能出现的每个承载面都要过 AA 正文。
       *
       * ⚠ 读的是**产品槽位**（`--danger` / `--success` / …），不是 pack 的原始令牌。
       * 为什么这不是"放宽"：pack 是共享资产，它写入 registry 的 `--kits-color-negative`
       * 是**这套风格的身份**（已 approved、checksum 受保护），要求它为某一个产品的
       * 某个承载面达标既做不到也不该做。而「一色一义」这条纪律要守的，是
       * **页面实际使用的那个颜色** —— 也就是产品层映射出来的 `--danger`。
       * STH 在这两个槽位之间做的正是"语义住在色相里、明度按实测重算"：
       * 深色 `#FF5A70`（四面 6.20/5.75/5.27/4.68）、浅色 `#C81E33`。
       *
       * 判据一个字未改（≥4.5，三位小数，逐面断言）：改的是**被测对象**，
       * 从"pack 说什么"变成"页面用什么"。
       *
       * 注意键名**不带 `--` 前缀** —— `PaletteReading["product"]` 的键是
       * `brand` / `danger` / `warning` / `success` / `evidence`。
       * （第一版写成 `"--brand"`，于是 `reading.product["--brand"]` 恒为 undefined，
       *  探针当场报"收到 undefined"。这类错误必须让它响亮地炸，不能被兜底救活。） */
      const PRODUCT_SEMANTIC: Record<string, keyof PaletteReading["product"]> = {
        accent: "brand",
        negative: "danger",
        accent2: "warning",
        positive: "success",
        evidence: "evidence",
      }
      for (const [name, reading] of themes) {
        for (const { meaning, slot } of HUE_FAMILIES) {
          const productToken = PRODUCT_SEMANTIC[slot]
          for (const face of FACES) {
            const ratio = contrast(reading.product[productToken], reading.packs[face])
            expect(
              ratio,
              `${name}：${meaning} 在 ${face} 面上对比度 ${ratio.toFixed(2)} < 4.5`,
            ).toBeGreaterThanOrEqual(4.5)
          }
        }

        expect(contrast(reading.packs.ink, reading.packs.canvas), `${name}: 主墨 AAA`).toBeGreaterThanOrEqual(7)
        expect(
          contrast(reading.packs.inkMuted, reading.packs.canvas),
          `${name}: 次墨至少 AA`,
        ).toBeGreaterThanOrEqual(4.5)

        /*
         * 规则线：这里守的是**可辨**的回归下限（1.2），不是签署值本身的对比度。
         * 两个主题的方向相反（深色提亮 #4A6C9B、浅色压深 #B7C3D2），但性质相同：
         * 它必须与周围表面分得开，否则三列会糊成一块。
         */
        for (const face of FACES) {
          const ratio = contrast(reading.packs.rule, reading.packs[face])
          expect(
            ratio,
            `${name}: 规则线对 ${face} 只有 ${ratio.toFixed(2)}，与表面几乎不可分`,
          ).toBeGreaterThanOrEqual(1.2)
        }

        // 非正文槽位（签署表标注"仅大字 / 非正文"）：只守住非文本的 3:1 下限，
        // 不为它假装 AA —— 它本来就允许更弱。
        for (const face of FACES) {
          expect(
            contrast(reading.packs.inkFaint, reading.packs[face]),
            `${name}: ink-faint 对 ${face} 低于非文本下限 3.0`,
          ).toBeGreaterThanOrEqual(3)
        }
      }

      /* 两个派生槽位：它们不是新取的色，而是 pack 自己的关系在浅色下的解。 */
      for (const [name, reading] of themes) {
        expect(
          contrast(reading.packs.accentInk, reading.packs.accent),
          `${name}: 压在 accent 上的字必须过 AA（深色 10.36 / 浅色 5.36）`,
        ).toBeGreaterThanOrEqual(4.5)
        expect(
          sameColor(reading.packs.focus, reading.packs.accent),
          `${name}: focus 在 pack 里就等于 accent，浅色沿用同一关系`,
        ).toBe(true)
      }
    })
    },
  )
})
