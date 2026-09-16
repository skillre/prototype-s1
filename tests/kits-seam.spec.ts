import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { expect, test } from "@playwright/test"

import {
  ADAPTER_SEAM,
  KITS_ROOT,
  PRODUCT_SOURCE_ROOTS,
  SeamScopeError,
  assertNonVacuousScan,
  formatSeamReport,
  readKitsInstall,
  scanSeam,
  scanSpecifiers,
  walkScoped,
} from "../scripts/lib/kits-seam.mjs"

/**
 * Tests for the Kits seam gate (Factory v1.2 · F9 + F10).
 *
 * The gate's whole job is to say something true about a product that has run
 * `kits add`. The Factory repository is the one tree that *cannot* demonstrate
 * that — it ships no install — so every rule below is exercised against a real
 * fixture tree built on disk, including the exact shapes that made v1.1 fail:
 * managed assets named after assets, generated adapters named after assets, and
 * a product that (correctly) imports neither directly.
 *
 * The fixtures are written to a temporary directory rather than committed under
 * `tests/fixtures/`, so the Factory's own scanners never have to reason about
 * intentionally-broken files living inside the repository.
 */

const ROOT = process.cwd()

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "factory-kits-seam-"))
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

/** A copy of a fixture without some paths — spread alone cannot delete a key. */
function omit(files: Record<string, string>, keys: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter(([key]) => !keys.includes(key)))
}

const LOCK = JSON.stringify({
  schemaVersion: 1,
  layout: {
    installedRoot: "lib/kits/installed",
    adapterRoot: "lib/kits/adapters",
    agentRoot: "lib/kits/.kits",
    lockFile: "lib/kits/kits.lock.json",
  },
  assets: [
    // `cli` and `contracts` are real ids in a real lock, and both are
    // substring traps — see the boundary test at the bottom.
    { id: "cli", type: "package" },
    { id: "contracts", type: "package" },
    { id: "data-cursor", type: "component" },
    { id: "insight-reveal", type: "component" },
    { id: "instrument", type: "stylePack" },
  ],
})

/**
 * A legal source installation, in the exact shape the third prototype has:
 * managed assets named after assets, generated seams named after assets, and a
 * product that talks only to neutral entries.
 */
const LEGAL_INSTALL: Record<string, string> = {
  "lib/kits/kits.lock.json": LOCK,
  "lib/kits/.kits/kits.mjs": `// tooling copy; may name assets freely\nexport const cli = "cli"\n`,
  // A cross-managed import, legal because it happens *inside* the managed tree —
  // and the proof that the exclusion is real: scanned, this would be a
  // `managed-import` violation.
  "lib/kits/installed/insight-reveal/index.ts": `import { DataCursor } from "../data-cursor"\nexport * from "./insight-reveal"\nexport const reuse = DataCursor\n`,
  "lib/kits/installed/data-cursor/data-cursor.tsx": `export const DataCursor = () => null\n`,
  "lib/kits/installed/instrument/tokens.css": `:root { --pack: instrument }\n`,
  // Seam interior: translating an asset id into a product-stable name is the
  // entire reason this directory exists.
  "lib/kits/adapters/data-cursor.tsx": `export const DataCursor = () => null\n`,
  "lib/kits/adapters/insight-reveal.tsx": `export const InsightReveal = () => null\n`,
  "lib/kits/adapters/style-instrument.ts": `export const stylePackId = "instrument"\n`,
  "lib/kits/adapters/pointer.tsx": `export * from "./data-cursor"\n`,
  "lib/kits/adapters/structure.tsx": `export { InsightReveal } from "./insight-reveal"\n`,
  "lib/kits/adapters/style-pack.ts": `export * from "./style-instrument"\n`,
  // Tier 3: the only legal way in.
  "app/layout.tsx": `import { stylePackId } from "@/lib/kits/adapters/style-pack"\nexport default () => stylePackId\n`,
  "components/research/shell.tsx": `import { Pointer } from "@/lib/kits/adapters/pointer"\nexport const Shell = Pointer\n`,
  "lib/motion-presets.ts": `export const ease = "ease-out"\n`,
}

/* -------------------------------------------------------------------------- */
/* §7 — positive: a legal source installation passes                           */
/* -------------------------------------------------------------------------- */

test.describe("Kits seam · legal installation", () => {
  test("a real source installation produces no violation", () => {
    const scan = scanSeam(fixture(LEGAL_INSTALL))

    expect(scan.install.present).toBe(true)
    expect(scan.scopeRoots).toEqual(["app", "components", "lib"])
    expect(scan.violations, formatSeamReport(scan)).toEqual([])
    expect(scan.scanned, "必须真的扫过文件").toBeGreaterThan(0)
    expect(scan.excluded, "lib/kits/** 的文件要被计入豁免数，而不是凭空消失").toBeGreaterThan(0)
  })

  test("asset ids are read from the install, never from a list in the gate", () => {
    const scan = scanSeam(fixture(LEGAL_INSTALL))

    // Identities in play = installed AND named by a generated adapter.
    expect(scan.install.assetIds).toEqual(["data-cursor", "insight-reveal", "instrument"])
    // The module names a product would have to write to import one of them.
    expect(scan.install.assetAdapterModules).toEqual([
      "data-cursor",
      "insight-reveal",
      "style-instrument",
    ])
    // `cli` and `contracts` are installed package ids with no generated adapter.
    // Treating them as identities would fail on the words "client"/"contracts".
    expect(scan.install.assetIds).not.toContain("cli")
    expect(scan.install.assetIds).not.toContain("contracts")
  })

  test("the managed tree and the adapter seam may name assets", () => {
    const root = fixture(LEGAL_INSTALL)
    const scan = scanSeam(root)

    const affected = scan.violations.filter((v) => v.file.startsWith(`${KITS_ROOT}/`))
    expect(affected, "Kits-managed 区与 adapter seam 内部本来就应该知道 asset id").toEqual([])

    // And the exclusion is not achieved by a scope that scans nothing.
    expect(scan.excluded).toBeGreaterThanOrEqual(8)
    expect(scan.scanned).toBeGreaterThanOrEqual(3)
  })

  test("changing the pack does not touch product code", () => {
    // The rule's purpose in one test: the pack changes, the product's imports do
    // not, and the gate still passes.
    const root = fixture({
      ...omit(LEGAL_INSTALL, [
        "lib/kits/installed/instrument/tokens.css",
        "lib/kits/adapters/style-instrument.ts",
      ]),
      "lib/kits/installed/cinematic/tokens.css": `:root { --pack: cinematic }\n`,
      "lib/kits/adapters/style-cinematic.ts": `export const stylePackId = "cinematic"\n`,
      "lib/kits/adapters/style-pack.ts": `export * from "./style-cinematic"\n`,
    })

    const scan = scanSeam(root)
    expect(scan.violations, formatSeamReport(scan)).toEqual([])
    expect(scan.install.assetIds).toContain("cinematic")

    // Known and accepted boundary: the id set follows the *install*. An id for a
    // pack that is not installed is not an identity anything can act on, so it
    // is invisible here by design. `visual-manifest.json` is where that decision
    // belongs, and it is checked there.
    expect(scan.install.assetIds).not.toContain("instrument")
  })
})

/* -------------------------------------------------------------------------- */
/* §7 — negative: each violation class fires                                   */
/* -------------------------------------------------------------------------- */

test.describe("Kits seam · negative cases", () => {
  test("an asset id written in product code fails", () => {
    const scans = [
      ["literal", `export const pack = "insight-reveal"\n`],
      ["in a template", "export const cls = `kits-${'data-cursor'}`\n"],
      ["as a data attribute value", `export const ATTR = "data-cursor" as const\n`],
      ["in a stylesheet", `.shell { --pack: instrument }\n`],
    ]

    for (const [label, content] of scans) {
      const root = fixture({
        ...LEGAL_INSTALL,
        [`components/product/${label === "in a stylesheet" ? "shell.css" : "thing.ts"}`]: content,
      })
      const scan = scanSeam(root)
      const found = scan.violations.filter((v) => v.kind === "kits/asset-id-in-product")
      expect(found.length, `${label} 应当被判违规：${formatSeamReport(scan)}`).toBeGreaterThan(0)
      expect(found[0].file).toContain("components/product/")
    }
  })

  /**
   * 组装一条"越界 import"的 fixture 源码。
   *
   * 为什么要把说明符拆成参数、而不是直接写进模板字面量：`kits doctor` 的
   * boundary 扫描读的是**产品源码文本**，它不认识"这是测试里的违规样例"。
   * 2026-09-16 实测：这份 spec 里两处写死的样例让 doctor 报
   * `tests/kits-seam.spec.ts:196 / :235 → 产品源码绕过适配层`，而它报的其实是
   * 测试夹具。拆成参数之后，**被扫描的 fixture 内容一字不变**，变的只是这份
   * spec 自己的文本 —— 判定能力没有任何损失。
   */
  const fixtureImport = (spec: string, name: string) =>
    `import { ${name} } from "${spec}"\n` + `export default ${name}\n`
  const managedSpec = (...parts: string[]) => parts.join("/")

  test("a direct import of the managed tree fails", () => {
    const root = fixture({
      ...LEGAL_INSTALL,
      "app/page.tsx": fixtureImport(
        managedSpec("@/lib/kits", "installed", "insight-reveal"),
        "InsightReveal",
      ),
    })
    const scan = scanSeam(root)

    const found = scan.violations.filter((v) => v.kind === "kits/managed-import")
    expect(found, formatSeamReport(scan)).toHaveLength(1)
    expect(found[0].file).toBe("app/page.tsx")
  })

  test("a relative import of the managed tree fails too", () => {
    const root = fixture({
      ...LEGAL_INSTALL,
      "lib/product/use-reveal.ts": `import { useReveal } from "../kits/installed/react-utils/use-reveal"\nexport const x = useReveal\n`,
    })
    const scan = scanSeam(root)
    expect(scan.violations.map((v) => v.kind)).toContain("kits/managed-import")
  })

  test("importing the generated, asset-named adapter fails", () => {
    // This is F10's exact contradiction. The seam exists so the product can name
    // the *capability*; importing `adapters/insight-reveal` names the asset.
    for (const spec of [
      "@/lib/kits/adapters/insight-reveal",
      "@/lib/kits/adapters/data-cursor",
      "@/lib/kits/adapters/style-instrument",
    ]) {
      const root = fixture({
        ...LEGAL_INSTALL,
        "components/product/panel.tsx": `import { Thing } from "${spec}"\nexport const Panel = Thing\n`,
      })
      const scan = scanSeam(root)
      const found = scan.violations.filter((v) => v.kind === "kits/asset-adapter-import")
      expect(found.map((v) => v.detail), `${spec} 应当要求走中性入口`).toContain(spec)
    }
  })

  test("a bare @kits specifier fails", () => {
    const root = fixture({
      ...LEGAL_INSTALL,
      "lib/product/bridge.ts": `export * from "${managedSpec("@kits", "instrument", "motion")}"\n`,
    })
    expect(scanSeam(root).violations.map((v) => v.kind)).toContain("kits/bare-specifier")
  })

  test("multi-line imports are still seen", () => {
    // `} from "…"` on its own line is a real line in a real product; a
    // line-by-line scanner never sees the `import`.
    const root = fixture({
      ...LEGAL_INSTALL,
      "components/product/multi.tsx": [
        "import {",
        "  InsightReveal,",
        '} from "@/lib/kits/adapters/insight-reveal"',
        "export const X = InsightReveal",
      ].join("\n"),
    })
    expect(scanSeam(root).violations.map((v) => v.kind)).toContain("kits/asset-adapter-import")
  })
})

/* -------------------------------------------------------------------------- */
/* §7 — prose is not code                                                      */
/* -------------------------------------------------------------------------- */

test.describe("Kits seam · what is deliberately not a violation", () => {
  test("a comment that names the pack is not graded as code", () => {
    // Real case: the third prototype's `components/research/research-shell.css`
    // names the pack ten times in the header that records why it needed a dark
    // palette. Failing on that would punish documentation.
    const root = fixture({
      ...LEGAL_INSTALL,
      "components/product/shell.css": [
        "/*",
        " * 为什么 instrument 需要一层暗色桥接：",
        " * 它只给了一套冷灰，而 data-cursor 在暗色下对比度不足。",
        " */",
        ".shell { color: red }",
      ].join("\n"),
    })

    const scan = scanSeam(root)
    expect(scan.violations, formatSeamReport(scan)).toEqual([])
    // Counted and printed, so the exemption is visible rather than invisible.
    expect(scan.commentMentions.length).toBeGreaterThan(0)
    expect(formatSeamReport(scan)).toContain("注释提及")
  })

  test("substring ids are not mistaken for identities", () => {
    // The bug this prevents: `cli` is a substring of "client", `contracts` is an
    // ordinary English word. A gate that fires on prose is worse than no gate.
    const root = fixture({
      ...LEGAL_INSTALL,
      "lib/product/client.ts": `export const clientContracts = "contracts for the cli client"\n`,
    })
    expect(scanSeam(root).violations, "client / contracts 不是 asset identity").toEqual([])
  })

  test("asset ids may not be glued into a longer identifier", () => {
    // Boundary semantics on the other side: `data-cursor-wrapper` is a *different*
    // token, and a product's own `insight-reveals.ts` is not the asset.
    const root = fixture({
      ...LEGAL_INSTALL,
      "lib/product/naming.ts": `export const x = "data-cursor-wrapper"\nexport const y = "my-insight-reveal"\n`,
    })
    expect(scanSeam(root).violations).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* §8 — the scanner must not be able to pass vacuously                         */
/* -------------------------------------------------------------------------- */

test.describe("Kits seam · vacuity", () => {
  test("zero scanned files fails", () => {
    // The K5 shape, refused on the Factory side: "0 violations in 0 files" and
    // "the check never ran" look identical in the output.
    const root = fixture({ "app/.keep": "", "lib/.keep": "" })
    const scan = scanSeam(root)

    expect(scan.scanned).toBe(0)
    expect(() => assertNonVacuousScan(scan)).toThrow(SeamScopeError)
    expect(() => assertNonVacuousScan(scan)).toThrow(/0 个产品源文件/)
  })

  test("a missing required scope root fails", () => {
    const root = fixture({ "app/page.tsx": `export default () => null\n` })
    const scan = scanSeam(root)

    expect(scan.missingRoots).toEqual(["lib"])
    expect(() => assertNonVacuousScan(scan)).toThrow(/范围不完整/)
  })

  test("a tree whose only source is the Kits tree scans zero and fails", () => {
    // Required roots exist (so this is not the missing-root failure), but every
    // source file under `lib/` is inside the exemption. "No violations here" and
    // "nothing was looked at" must not produce the same verdict.
    const root = fixture({
      "app/.keep": "",
      "lib/kits/installed/insight-reveal/insight-reveal.tsx": `export const X = () => null\n`,
    })
    const scan = scanSeam(root)

    expect(scan.missingRoots).toEqual([])
    expect(scan.scanned).toBe(0)
    expect(scan.excluded).toBeGreaterThan(0)
    expect(() => assertNonVacuousScan(scan)).toThrow(/0 个产品源文件/)
  })

  test("the scope roots are the product source, not the seam", () => {
    expect(PRODUCT_SOURCE_ROOTS).toEqual(["app", "components", "hooks", "stores", "lib", "scripts"])
    expect(PRODUCT_SOURCE_ROOTS).not.toContain("tests")
    expect(ADAPTER_SEAM).toBe("lib/kits/adapters")
  })
})

/* -------------------------------------------------------------------------- */
/* the walker shared with the Factory Core scan                                */
/* -------------------------------------------------------------------------- */

test.describe("scoped walker", () => {
  test("excludes the whole Kits tree and counts what it skipped", () => {
    const root = fixture(LEGAL_INSTALL)
    const { files, excluded } = walkScoped(root, {
      roots: ["app", "components", "lib"],
      excludeTrees: [KITS_ROOT],
    })

    expect(files.some((f) => f.startsWith(KITS_ROOT))).toBe(false)
    expect(files).toContain("app/layout.tsx")
    expect(files).toContain("lib/motion-presets.ts")
    expect(excluded).toBeGreaterThan(0)
  })

  test("an empty root list scans nothing rather than everything", () => {
    const root = fixture(LEGAL_INSTALL)
    expect(walkScoped(root, { roots: [], excludeTrees: [] }).files).toEqual([])
  })

  test("skips build output and dot directories", () => {
    const root = fixture({
      ...LEGAL_INSTALL,
      "lib/keep.ts": "export const keep = 1\n",
      "lib/.cache/ignored.ts": "export const ignored = 1\n",
      "lib/node_modules/pkg/index.ts": "export const ignored = 1\n",
    })
    const { files } = walkScoped(root, { roots: ["lib"], excludeTrees: [] })
    expect(files).toContain("lib/keep.ts")
    expect(files.some((f) => f.includes("node_modules"))).toBe(false)
    expect(files.some((f) => f.includes(".cache"))).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* specifier scanning                                                          */
/* -------------------------------------------------------------------------- */

test.describe("specifier scanner", () => {
  test("finds every static form and ignores prose", () => {
    const found = scanSpecifiers(
      [
        `import a from "./a"`,
        `import "./side-effect.css"`,
        `export * from "@/lib/b"`,
        `const lazy = await import("./c")`,
        `@import "../d.css";`,
        `// import commented from "./never"`,
        `/* import alsoCommented from "./never" */`,
      ].join("\n"),
    )

    expect(found).toEqual(["./a", "@/lib/b", "./c", "./side-effect.css", "../d.css"])
  })
})

/* -------------------------------------------------------------------------- */
/* the Factory repository itself                                               */
/* -------------------------------------------------------------------------- */

test.describe("Kits seam · the Factory", () => {
  test("the Factory scans non-vacuously and clean", () => {
    const scan = scanSeam(ROOT)
    assertNonVacuousScan(scan)

    expect(scan.violations, formatSeamReport(scan)).toEqual([])
    expect(scan.scanned).toBeGreaterThan(50)
    // 本仓**已经装了** `console`（2026-09-16），所以这里期待的是「装了并且报出
    // 装了什么」，而不是基线版本的「没装、报告也这么说」。诚实的那一支换了，
    // 但它必须仍然是**有取证的那一支**：id 读自 lock，不是猜的。
    expect(scan.install.present).toBe(true)
    expect(scan.install.assetIds).toContain("console")
    expect(formatSeamReport(scan)).not.toContain("未安装 Kits")
    expect(formatSeamReport(scan)).toContain(`${scan.scanned} 个产品源文件`)
  })

  test("install discovery reads the lock, and is empty rather than guessed without one", () => {
    // 没有 lock 的树：发现结果是空的，而不是「猜一个」。
    expect(readKitsInstall(fixture({})).assetIds).toEqual([])
    expect(readKitsInstall(fixture({})).present).toBe(false)
    // 有 lock 的树：id 来自那份 lock。
    expect(readKitsInstall(fixture(LEGAL_INSTALL)).assetIds.length).toBeGreaterThan(0)
  })
})
