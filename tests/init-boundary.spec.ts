import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { expect, test } from "@playwright/test"

import {
  FACTORY_LANDING_MARKER,
  INIT_CONTRACT_FILENAME,
  INIT_SCHEMA_VERSION,
  InitScopeError,
  REFERENCE_SAMPLE_MARKER,
  assertNonVacuousInitScan,
  classifyPath,
  formatInitReport,
  scanInitBoundary,
  validateInitContract,
} from "../scripts/lib/init-boundary.mjs"
import { stripComments, walkScoped } from "../scripts/lib/kits-seam.mjs"

/**
 * The initialization boundary (Factory v1.2 · INIT).
 *
 * What is being tested is not "the Reference Sample exists" — it is that the
 * three layers are *named*, that the naming is machine-readable, and that the
 * dangerous state (a half-initialized copy) fails loudly.
 */

const ROOT = process.cwd()
const read = (path: string) => readFileSync(join(ROOT, path), "utf8")
const CONTRACT = JSON.parse(read(INIT_CONTRACT_FILENAME))

/** A tree that is structurally a product; individual files are overridden per test. */
const PRODUCT_FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "prototype-observability", version: "0.1.0" }),
  "README.md": "# Observability Console\n\n一个自建原型。\n",
  "app/layout.tsx": `export const metadata = { title: { default: "Observability Console" } }\nexport default function L({ children }) { return children }\n`,
  "app/page.tsx": `export default function P() { return <main>hello</main> }\n`,
  "app/not-found.tsx": `export default function N() { return <main>404</main> }\n`,
  "lib/i18n/zh-CN.ts": `export const zhCN = { brand: { name: "观测台" } }\n`,
}

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "factory-init-"))
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

const productContract = (overrides: Record<string, unknown> = {}) => ({
  ...CONTRACT,
  stage: "product",
  ...overrides,
})

/**
 * The same contract, declaring itself the baseline.
 *
 * Used by the two tests that exercise the **baseline** half of the scanner: a
 * tree that renamed its package (or lost its landing marker) may not keep
 * calling itself the Factory. Those tests are about the scanner's double-edged
 * rule, so they must feed it a baseline claim — this repository is a product.
 */
const baselineContract = { ...CONTRACT, stage: "baseline" }

const checks = (scan: { violations: Array<{ check: string }> }) => scan.violations.map((v) => v.check)

/* -------------------------------------------------------------------------- */
/* §15.1 / §15.2 / §15.10 — this tree, and the Sample's own space               */
/* -------------------------------------------------------------------------- */

test.describe("this product tree", () => {
  test("declares itself a product, and the initialization surface carries no residue", () => {
    // 基线里这一条断言的是 `stage = baseline` + 身份完好。本仓是**产品**，所以
    // 同一个问题换成产品那一半：stage 是 product，而且初始化面上没有残留身份。
    const scan = scanInitBoundary(ROOT, CONTRACT)
    assertNonVacuousInitScan(scan)
    expect(scan.stage).toBe("product")
    expect(scan.violations, formatInitReport(scan)).toEqual([])
    expect(scan.scanned).toBeGreaterThan(0)
  })

  test("the sample-owned paths are declared, and the deletion is real", () => {
    const scan = scanInitBoundary(ROOT, CONTRACT)
    // 边界声明的语义是「身份豁免只在这些路径里生效」——所以清单本身要留着，
    // 将来那些路径万一回来，豁免也只在里面生效。
    expect(CONTRACT.sampleOwned).toContain("app/crm/")
    expect(CONTRACT.sampleOwned).toContain("app/demo/")
    // 而它必须是一句真话：清单里列出来的路径，一条都不能还在树上。
    expect(scan.excluded, "sampleOwned 列出的路径必须真的已经不存在（否则 excluded > 0）").toBe(0)
    for (const entry of CONTRACT.sampleOwned as string[]) {
      const rel = entry.endsWith("/") ? entry.slice(0, -1) : entry
      expect(existsSync(join(ROOT, rel)), `${entry} 列在 sampleOwned 里，但它还在树上`).toBe(false)
    }
  })

  test("path classification is three-way and sample-owned wins", () => {
    // 路径已经不存在，但分类器仍然必须把那个前缀判为 sample：分类是关于**边界**
    // 的，不是关于「现在有没有这个文件」的。
    expect(classifyPath("app/crm/page.tsx", CONTRACT)).toBe("sample")
    expect(classifyPath("app/_sample/dashboard-skeleton.tsx", CONTRACT)).toBe("sample")
    expect(classifyPath("app/page.tsx", CONTRACT)).toBe("initialization")
    expect(classifyPath("components/layout/sidebar.tsx", CONTRACT)).toBe("core")
    expect(classifyPath("scripts/verify-init.mjs", CONTRACT)).toBe("core")
  })

  test("a baseline that has been renamed may not keep calling itself a baseline", () => {
    // THE dodge this design closes: leave `stage` alone and never be checked.
    const root = fixture({
      ...PRODUCT_FILES,
      [INIT_CONTRACT_FILENAME]: JSON.stringify(baselineContract),
      "app/page.tsx": `<main ${FACTORY_LANDING_MARKER}>x</main>`,
      "app/layout.tsx": `export const metadata = { title: { default: "${CONTRACT.baselineIdentity.metadataTitle}" } }`,
    })
    const scan = scanInitBoundary(root, baselineContract)
    expect(checks(scan)).toContain("init/stage-mismatch")
  })
})

/* -------------------------------------------------------------------------- */
/* §15.3 / §15.5 / §15.6 / §15.7 — a product, and the residues that fail it     */
/* -------------------------------------------------------------------------- */

test.describe("an initialized product", () => {
  test("a clean product passes", () => {
    const scan = scanInitBoundary(fixture(PRODUCT_FILES), productContract())
    expect(scan.violations, formatInitReport(scan)).toEqual([])
    expect(scan.scanned).toBe(6)
  })

  test("keeping the Reference Sample is legal — as long as it is labelled", () => {
    const root = fixture({
      ...PRODUCT_FILES,
      "app/crm/page.tsx": `export default function P() { return null }\n`,
      "app/page.tsx": `export default function P() { return <main><section ${REFERENCE_SAMPLE_MARKER}><a href="/crm">示例</a></section></main> }\n`,
    })
    const scan = scanInitBoundary(root, productContract())
    expect(scan.violations).toEqual([])
    expect(scan.excluded, "保留的 sample 依然被计为豁免").toBeGreaterThan(0)
  })

  test("still writing prototype-starter as the package name FAILS", () => {
    const root = fixture({
      ...PRODUCT_FILES,
      "package.json": JSON.stringify({ name: CONTRACT.baselineIdentity.packageName }),
    })
    expect(checks(scanInitBoundary(root, productContract()))).toContain("init/package-identity")
  })

  test("still carrying the Starter metadata title FAILS", () => {
    const root = fixture({
      ...PRODUCT_FILES,
      "app/layout.tsx": `export const metadata = { title: "${CONTRACT.baselineIdentity.metadataTitle}" }\n`,
    })
    expect(checks(scanInitBoundary(root, productContract()))).toContain("init/metadata-identity")
  })

  test("still shipping the Factory landing FAILS", () => {
    const root = fixture({
      ...PRODUCT_FILES,
      "app/page.tsx": `<main ${FACTORY_LANDING_MARKER}><a href="/crm">AI CRM</a></main>\n`,
    })
    expect(checks(scanInitBoundary(root, productContract()))).toContain("init/homepage-not-replaced")
  })

  test("pointing the home page at the CRM without labelling it FAILS", () => {
    const root = fixture({
      ...PRODUCT_FILES,
      "app/page.tsx": `export default function P() { return <main><a href="/crm">主入口</a></main> }\n`,
    })
    expect(checks(scanInitBoundary(root, productContract()))).toContain("init/homepage-entry")
  })

  test("a sample brand name on the initialization surface FAILS", () => {
    const root = fixture({
      ...PRODUCT_FILES,
      "lib/i18n/zh-CN.ts": `export const zhCN = { brand: { name: "智悟云" } }\n`,
    })
    expect(checks(scanInitBoundary(root, productContract()))).toContain("init/sample-identity")
  })

  test("prose is not code: a commented-out marker does not satisfy the check", () => {
    // The marker appears in the file, but only inside a comment. A baseline
    // claim needs it to be *real*.
    const root = fixture({
      ...PRODUCT_FILES,
      [INIT_CONTRACT_FILENAME]: JSON.stringify(baselineContract),
      "app/layout.tsx": `export const metadata = { title: { default: "${CONTRACT.baselineIdentity.metadataTitle}" } }`,
      "app/page.tsx": `// ${FACTORY_LANDING_MARKER}\nexport default function P() { return <main>hi</main> }\n`,
    })
    expect(checks(scanInitBoundary(root, baselineContract))).toContain("init/stage-mismatch")
  })
})

/* -------------------------------------------------------------------------- */
/* §15.7 — the scanner cannot pass by measuring nothing                        */
/* -------------------------------------------------------------------------- */

test.describe("vacuity", () => {
  test("zero scanned files FAILS", () => {
    const root = fixture({ [INIT_CONTRACT_FILENAME]: JSON.stringify(productContract()) })
    const scan = scanInitBoundary(root, productContract())
    expect(scan.scanned).toBe(0)
    expect(scan.missing.length).toBeGreaterThan(0)
    expect(() => assertNonVacuousInitScan(scan)).toThrow(InitScopeError)
    expect(() => assertNonVacuousInitScan(scan)).toThrow(/0 scanned|不存在/)
  })

  test("a declared file that is missing FAILS instead of being skipped", () => {
    const { "app/page.tsx": dropped, ...withoutLanding } = PRODUCT_FILES
    expect(dropped).toBeDefined()
    const scan = scanInitBoundary(fixture(withoutLanding), productContract())
    expect(scan.missing).toContain("app/page.tsx")
    expect(() => assertNonVacuousInitScan(scan)).toThrow(/app\/page\.tsx/)
  })
})

/* -------------------------------------------------------------------------- */
/* the contract document itself                                                */
/* -------------------------------------------------------------------------- */

test.describe("the boundary contract", () => {
  test("validates, and is closed", () => {
    expect(validateInitContract(CONTRACT).ok).toBe(true)
    const codes = (input: unknown) =>
      validateInitContract(input).issues.map((issue: { code: string }) => issue.code)
    expect(codes({ ...CONTRACT, stage: "half" })).toContain("init/unknown-stage")
    expect(codes({ ...CONTRACT, schemaVersion: 99 })).toContain("init/unsupported-schema-version")
    expect(codes({ ...CONTRACT, extra: 1 })).toContain("init/unknown-field")
    expect(codes({ ...CONTRACT, sampleOwned: [] })).toContain("init/missing-field")
    expect(validateInitContract(null).ok).toBe(false)
  })

  test("the schema and the module agree", () => {
    const schema = JSON.parse(read("lib/init-contract.schema.json"))
    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties.schemaVersion.const).toBe(INIT_SCHEMA_VERSION)
    expect(new Set(schema.properties.stage.enum)).toEqual(new Set(["baseline", "product"]))
    expect(new Set(schema.required)).toEqual(
      new Set(["schemaVersion", "stage", "baselineIdentity", "sampleOwned", "productFacing", "sampleMarkers"]),
    )
  })

  test("the gate exits 0 / 1 / 2 for pass / residue / missing", () => {
    const run = (cwd: string) => {
      try {
        const stdout = execFileSync(process.execPath, [join(ROOT, "scripts/verify-init.mjs")], {
          encoding: "utf8",
          cwd,
        })
        return { status: 0, stdout }
      } catch (error) {
        const failure = error as { status?: number; stdout?: string; stderr?: string }
        return { status: failure.status ?? -1, stdout: `${failure.stdout ?? ""}${failure.stderr ?? ""}` }
      }
    }

    expect(run(ROOT).status).toBe(0)

    const productRoot = fixture({
      ...PRODUCT_FILES,
      [INIT_CONTRACT_FILENAME]: JSON.stringify(productContract()),
    })
    expect(run(productRoot).status, "干净的产品应当通过").toBe(0)

    const residueRoot = fixture({
      ...PRODUCT_FILES,
      [INIT_CONTRACT_FILENAME]: JSON.stringify(productContract()),
      "package.json": JSON.stringify({ name: CONTRACT.baselineIdentity.packageName }),
    })
    const residue = run(residueRoot)
    expect(residue.status).toBe(1)
    expect(residue.stdout).toContain("init/package-identity")

    const missingRoot = fixture({ "README.md": "x" })
    expect(run(missingRoot).status).toBe(2)
  })
})

/* -------------------------------------------------------------------------- */
/* §17 — the sample layer must not be orphaned by an init sweep                */
/* -------------------------------------------------------------------------- */

test.describe("sample deletion leaves no half-state behind", () => {
  const SAMPLE_CSS = "app/sample-command-center.css"

  test("the stylesheet is gone, and nothing imports it", () => {
    // 原意：init 清扫不能留下「引用了已经不存在的样式表」这种半状态 —— 那会得到
    // 一条完全没有 CSS 的路由（N3 失败），而且构建期才炸。
    // 样例整体删除之后，检查对象从「三个样例入口都 import 它」变成「没有任何文件
    // import 它」，性质没有变：模块不存在就不允许被引用。
    expect(existsSync(join(ROOT, SAMPLE_CSS)), "性格层文件本身已删除").toBe(false)
    const { files } = walkScoped(ROOT, { roots: ["app", "components"], excludeTrees: [] })
    const importRe = /^\s*import\s+["'][^"']*sample-command-center\.css["']/m
    expect(files.filter((file) => importRe.test(read(file))), "没有文件再 import 已删除的样式表").toEqual(
      [],
    )
  })

  test("the boundary still declares what the sample owned, and none of it is left", () => {
    const sampleOwned = CONTRACT.sampleOwned as string[]
    for (const prefix of ["app/crm/", "app/demo/", "app/_sample/"]) {
      expect(sampleOwned, `${prefix} 必须仍在边界清单里（豁免只在那里生效）`).toContain(prefix)
    }
    expect(sampleOwned).toContain(SAMPLE_CSS)
    // 清单的每一条都要能在磁盘上被证伪：列了就必须真的删了。
    for (const entry of sampleOwned) {
      const rel = entry.endsWith("/") ? entry.slice(0, -1) : entry
      expect(existsSync(join(ROOT, rel)), `${entry} 列在 sampleOwned 里，但它还在树上`).toBe(false)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* §10 / §21 — F5, F6, F7 and the workflow order                               */
/* -------------------------------------------------------------------------- */

test.describe("F5 · F6 · F7", () => {
  test("F5: the Core loading state carries no product composition", () => {
    // Comment-stripped: the file *explains* what it no longer assumes, and
    // explaining it means naming it.
    const rawCore = read("components/prototype/loading-state.tsx")
    const core = stripComments(rawCore)
    // No hero, no fixed metric strip, no product's divider table.
    expect(core).not.toContain("METRIC_DIVIDERS")
    expect(core).not.toContain("lg:grid-cols-4")
    expect(core).not.toMatch(/hero/i)
    // The intent is documented… (prose)
    expect(rawCore).toMatch(/Structure only/)
    // …and the code has no product composition left. (code)

    // 基线版本的后半段检查「样例自己的骨架住在样例里，并被两个样例界面共用」。
    // 样例删除之后那句话没有对象了，但**同一件事必须仍然成立**：那份骨架形态
    // 不能借着删除又溜回 Core。所以这里改成反方向取证 —— 它跟着样例一起消失，
    // 而且没有任何界面还在引用它。
    expect(existsSync(join(ROOT, "app/_sample/dashboard-skeleton.tsx"))).toBe(false)
    const { files } = walkScoped(ROOT, { roots: ["app", "components"], excludeTrees: [] })
    for (const needle of ["DashboardSkeleton", "METRIC_DIVIDERS"]) {
      const consumers = files.filter((file) => stripComments(read(file)).includes(needle))
      expect(consumers, `${needle} 已经随样例删除，不该还有界面引用它`).toEqual([])
    }
  })

  test("F6: no Core component is invisible dead inventory", () => {
    // F6 reported `profile-dialog` as having zero importers. That is no longer
    // true — but the real lesson is that dead inventory was invisible. This
    // keeps it visible: an unused component must be *declared*, with a reason.
    //
    // 样例删除之后，这份清单从 4 条变成 28 条：CRM 与内置演示是这些共享能力的
    // 主要调用方，删掉它们，调用方就没了。**这并不是缺陷**，而是初始化的真实
    // 形状 —— 这些是 Factory Core 提供的能力，S1 的组件层接线时才会用到它们。
    // 基线版本已经把话说明白了：声明它，而不是因为样例不用就删掉一个能力。
    const UNEXERCISED: Record<string, string> = {
      "components/layout/mobile-nav.tsx": "Core 外壳：移动端导航，S1 的 16:9 单屏形态不使用；能力保留",
      "components/layout/page-container.tsx": "Core 外壳：页面容器（含 ambient opt-in，默认关闭）",
      "components/layout/top-nav.tsx": "Core 外壳：顶栏（身份与数据源必须由调用方注入）",
      "components/motion/page-transition.tsx": "Core 动效原语：页面切换，S1 的动效语言是 event-driven",
      "components/motion/slide-in.tsx": "Core 动效原语：入场位移，本产品暂未使用",
      "components/motion/stagger-container.tsx": "Core 动效原语：列表逐项入场，本产品暂未使用",
      "components/prototype/ai-summary-panel.tsx": "Core 能力：结论面板，S1 的研判流会用它",
      "components/prototype/chart-card.tsx": "Core 能力：Recharts 卡片外壳，本产品暂未使用",
      "components/prototype/command-palette.tsx": "Core 能力：命令面板，S1 的键盘优先导航会用它",
      "components/prototype/data-table.tsx": "Core 能力：数据表，S1 的审计时间线会用它",
      "components/prototype/detail-drawer.tsx": "Core 能力：详情抽屉，证据引用点开时会用它",
      "components/prototype/empty-state.tsx": "Core 三态之一：空态，组件层接线时使用",
      "components/prototype/error-state.tsx": "Core 三态之一：错误态，组件层接线时使用",
      "components/prototype/filter-bar.tsx": "Core 能力：筛选栏，组件层接线时使用",
      "components/prototype/loading-state.tsx": "Core 三态之一：加载态，组件层接线时使用",
      "components/prototype/metric-strip.tsx": "Core 能力：指标带，态势指挥条会用它",
      "components/prototype/onboarding-wizard.tsx": "Core 能力：多步向导，本产品暂未使用",
      "components/prototype/open-section.tsx": "Core 能力：开放区块（含 ambient opt-in，默认 none）",
      "components/prototype/pagination.tsx": "Core 能力：分页，本产品暂未使用",
      "components/prototype/profile-dialog.tsx": "Core 能力：个人资料浮层——F6 当年的原始案例，现在由本清单承担可见性",
      "components/prototype/section-heading.tsx": "Core 能力：区块标题，组件层接线时使用",
      "components/prototype/sign-out-dialog.tsx": "Core 能力：退出登录浮层，本产品暂未使用",
      "components/prototype/stats-card.tsx": "Core 能力：指标卡片，本产品暂未使用",
      "components/ui/checkbox.tsx": "Core primitive：shadcn 复选框，本产品暂未使用",
      "components/ui/radio-group.tsx": "Core primitive：shadcn 单选组，本产品暂未使用",
      "components/ui/select.tsx": "Core primitive：shadcn 选择器，本产品暂未使用",
      "components/ui/switch.tsx": "Core primitive：shadcn 开关，本产品暂未使用",
      "components/ui/tabs.tsx": "Core primitive：shadcn 页签，本产品暂未使用",
    }

    const { files } = walkScoped(ROOT, { roots: ["components"], excludeTrees: [] })
    const sources = walkScoped(ROOT, { roots: ["app", "components", "tests"], excludeTrees: [] }).files
    const offenders: string[] = []

    for (const file of files) {
      if (!file.endsWith(".tsx")) continue
      const modulePath = file.replace(/\.tsx$/, "").split("/").pop()
      // Matched against an import specifier's tail, not against any mention.
      const importRe = new RegExp(`["'][^"']*/${modulePath}["']`)
      const referenced = sources.some((other) => other !== file && importRe.test(read(other)))
      if (!referenced && !UNEXERCISED[file]) offenders.push(file)
    }

    expect(
      offenders,
      "未使用的共享组件必须显式声明（附理由），否则它会悄悄烂在那里 —— 见 UNEXERCISED。",
    ).toEqual([])

    // And the declared list must not go stale.
    for (const [file, reason] of Object.entries(UNEXERCISED)) {
      expect(reason.length).toBeGreaterThan(8)
      expect(read(file).length, `${file} 存在且非空`).toBeGreaterThan(200)
    }

    // F6's actual named case: `profile-dialog` used to be dead inventory that
    // nothing could see. It is in the list now — visible, with a reason — which
    // is the fix. When the first S1 surface imports it, this line moves to that
    // surface and the entry comes off the list.
    expect(Object.keys(UNEXERCISED)).toContain("components/prototype/profile-dialog.tsx")
  })

  test("F7: the shell is an optional capability, not a forced product IA", () => {
    // Core's root layout may not impose a navigation structure: a product that
    // is not navigated by a sidebar must be able to keep it out entirely.
    const layout = read("app/layout.tsx")
    for (const shell of ["Sidebar", "TopNav", "MobileNav"]) {
      expect(layout, `app/layout.tsx 不得引入 ${shell}`).not.toContain(shell)
    }
    // The shell primitives exist as capabilities…
    for (const file of ["components/layout/sidebar.tsx", "components/layout/top-nav.tsx", "components/layout/mobile-nav.tsx"]) {
      expect(read(file)).toContain("export function")
    }
    // …and nothing in this product wires them up yet. 「可选」的意思就是：产品
    // 没有被外壳导航，就完全不引入它。基线版本这一句是「只有 Reference Sample
    // 使用它们」；样例删除之后，正确的说法是「没有任何界面使用它们」—— S1 自己的
    // 外壳（或它决定不用外壳）是后续工单的事，不是这一轮可以替人决定的。
    const { files } = walkScoped(ROOT, { roots: ["app"], excludeTrees: [] })
    const shellImports = files.filter((file) =>
      /from\s+["'][^"']*components\/layout\/(sidebar|top-nav|mobile-nav)["']/.test(read(file)),
    )
    expect(shellImports, "本阶段没有任何界面引入外壳").toEqual([])
    for (const doc of ["docs/product-initialization.md", "AGENTS.md"]) {
      expect(read(doc), `${doc} 必须写明 shell 是可选的`).toMatch(/Shell 是.?\*\*可选能力\*\*|Shell 是可选能力|可选能力/)
    }
  })

  test("the workflow puts semantic decisions before the UI", () => {
    const doc = read("docs/prototype-creation-workflow.md")
    const semantics = doc.indexOf("### 4 · Product Semantic Invariants")
    const divergence = doc.indexOf("### 5 · Art Direction Divergence")
    const manifest = doc.indexOf("### 6 · Visual Manifest")
    const build = doc.indexOf("### 10 · Build")
    const contract = doc.indexOf("pnpm factory:contract", semantics)

    expect(semantics, "语义不变量必须是独立一步").toBeGreaterThan(-1)
    expect(semantics).toBeLessThan(divergence)
    expect(divergence).toBeLessThan(manifest)
    expect(manifest, "Manifest 在 Build 之前").toBeLessThan(build)
    expect(contract, "这一步要有机器化的收口命令").toBeGreaterThan(semantics)

    for (const needle of [
      "Product Model",
      "Product Semantic Invariants",
      "Art Direction Divergence",
      "Visual Manifest",
      "Human Art Direction Gate",
      "Kits Source Installation",
      "adapter",
      "Browser QA",
      "部署",
    ]) {
      expect(doc, `workflow 必须包含 ${needle}`).toContain(needle)
    }
  })

  test("the initialization checklist covers the thirteen areas", () => {
    const doc = read("docs/product-initialization.md")
    for (const area of [
      "Product identity",
      "Reference Sample boundary",
      "Product Model",
      "Product Semantic Contract",
      "Art Direction divergence",
      "Visual Manifest",
      "Human Art Direction Gate",
      "Kits installation",
      "Adapter seam",
      "Route / QA registration",
      "Localization residue",
      "Deployment ownership",
      "Git branch baseline",
    ]) {
      expect(doc, `清单必须覆盖 ${area}`).toContain(area)
    }
    // It is a checklist, not a 50-step manual.
    expect(doc.split("\n").length).toBeLessThan(220)
    // And it names the three layers, machine-readable and in prose.
    for (const layer of ["Factory Core", "Reference Sample", "Initialization Surface"]) {
      expect(doc).toContain(layer)
      expect(read("AGENTS.md")).toContain(layer)
    }
  })
})
