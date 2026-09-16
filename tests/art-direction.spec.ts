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
  const cssChain = () => ({
    globals: read("app/globals.css"),
    bridge: read("lib/kits/adapters/s1-tokens.css"),
    pack: JSON.parse(read("visual-manifest.json")).stylePack as string,
  })

  test("globals.css reaches the pack through the adapter bridge, never the managed tree", () => {
    const { globals, bridge, pack } = cssChain()

    // One entry point, and it is the product-owned adapter seam.
    expect(globals).toContain('@import "../lib/kits/adapters/s1-tokens.css"')
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
    expect(measured.background, "深色主题的画布 = pack 的画布").toBe(measured.packCanvas)
    expect(measured.hairline).toBe(measured.packRule)

    // ④ and it reached the canvas, not just the token table
    expect(measured.bodyBackground, "body 必须有实体底色").not.toBe("rgba(0, 0, 0, 0)")
    expect(measured.bodyBackground).not.toBe("rgb(255, 255, 255)")
  })

  test("the light theme stays the Factory neutral layer, so the two-theme sweep stays real", async ({
    page,
  }) => {
    const pack = JSON.parse(read("visual-manifest.json")).stylePack as string

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ colorScheme: "light" })
    await page.goto("/", { waitUntil: "domcontentloaded" })

    const measured = (await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement)
      return {
        scope: document.documentElement.getAttribute("data-kits-pack"),
        background: root.getPropertyValue("--background").trim(),
        packCanvas: root.getPropertyValue("--kits-color-canvas").trim(),
      }
    })) as Record<string, string | null>

    expect(measured.scope).toBe(pack)
    // 浅色主题仍然是中性层取值，不是 pack 的深色画布 —— console 的
    // `darkDirection.strategy` 是 single-theme，把它全局接死等于替人退役浅色主题，
    // 那是一次产品决定，不是这一步可以顺手做的事（见适配层里的说明）。
    expect(measured.background).not.toBe(measured.packCanvas)
  })
})
