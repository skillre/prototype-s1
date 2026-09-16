import { readFileSync, readdirSync, existsSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

import { expect, test } from "@playwright/test"

import {
  isVacuousFirstVisual,
  validateVisualManifest,
} from "../lib/visual-manifest"
import {
  QA_ORIGIN,
  QA_PORT,
  routes as configuredRoutes,
} from "../.qa/qa.config.mjs"
import {
  KITS_ROOT,
  PRODUCT_SOURCE_ROOTS,
  stripComments,
  walkScoped,
} from "../scripts/lib/kits-seam.mjs"

/**
 * Factory v1.1 contract tests.
 *
 * These are the executable form of the rules AGENTS.md states in prose. They
 * need no browser — they are about the Factory's own shape — and they exist
 * because a rule that is only written down is a rule that will be violated
 * silently on the next prototype.
 *
 * Scope note: these assert the **Factory's** contracts (boundaries, manifest
 * shape, QA config, ownership docs). They deliberately do not assert product
 * behaviour, which is what the product specs are for.
 */

const ROOT = process.cwd()

/** Walk a directory, returning repo-relative paths of files matching a filter. */
function walk(
  dir: string,
  filter: (path: string) => boolean,
  out: string[] = [],
): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full, filter, out)
    } else if (filter(full)) {
      out.push(relative(ROOT, full).split(sep).join("/"))
    }
  }
  return out
}

const SOURCE_FILES = walk(ROOT, (p) => /\.(ts|tsx)$/.test(p) && !p.includes(`${sep}node_modules`))

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8")
}

/**
 * Source with comments removed.
 *
 * Config files explain the hazards they avoid, which means they name them — a
 * config that documents "never reuse port 3000" necessarily contains the string
 * "3000". Assertions about what a file *does* must therefore look at code, not
 * prose.
 */
function readCode(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
}

/* -------------------------------------------------------------------------- */
/* §4 — shared components must not depend on any product                       */
/* -------------------------------------------------------------------------- */

/**
 * Modules a shared Core component may never import.
 *
 * These are the product-owned trees: Zustand stores, product mock data, and the
 * product's route components. A shared component that imports one of them can
 * only ever work for that one product — which is how v1.0.0's TopNav ended up
 * hard-wired to the demo store, and why a brand-new prototype silently rendered
 * another product's account name.
 *
 * 本轮的初始化把样例的业务数据层一起删掉了（`lib/crm-data.ts` · `lib/mock-data.ts` ·
 * `lib/insights.ts` · `lib/ai-summary.ts` · `lib/activity-groups.ts` 与两个 store）。
 * 那几个具名条目因此从「现在存在的东西」变成「不许再通过共享组件回来的东西」——
 * 规则不变，只是取证方向反了。真正仍然直接生效的是前两条（`@/stores/` 与 `@/app/`）：
 * S1 自己的数据层会落在那里。
 */
const FORBIDDEN_FOR_SHARED = [
  "@/stores/",
  "@/lib/crm-data",
  "@/lib/mock-data",
  "@/lib/insights",
  "@/lib/ai-summary",
  "@/lib/activity-groups",
  "@/app/",
]

const SHARED_DIRS = ["components/layout", "components/prototype", "components/motion"]

test("shared components import no product store or product data", () => {
  const offenders = []

  for (const dir of SHARED_DIRS) {
    for (const file of walk(join(ROOT, dir), (p) => /\.(ts|tsx)$/.test(p))) {
      const contents = read(file)
      for (const line of contents.split("\n")) {
        const isImport = /^\s*(import|export)\s/.test(line)
        if (!isImport) continue
        const hit = FORBIDDEN_FOR_SHARED.find((needle) => line.includes(`"${needle}`))
        if (hit) offenders.push(`${file}: ${line.trim()}`)
      }
    }
  }

  expect(
    offenders,
    "共享组件不得 import 产品 store / 产品数据 / 产品路由。\n" +
      "数据、动作、导航、通知、账户必须由调用方注入（见 AGENTS.md 与 docs/visual-manifest.md）。",
  ).toEqual([])
})

test("shared layout requires product identity to be injected", () => {
  // Comment-stripped: the files explain what was removed, and explaining it
  // means naming it. What matters is the code, not the note.
  const sidebar = readCode("components/layout/sidebar.tsx")
  const topNav = readCode("components/layout/top-nav.tsx")

  // A default here is a Factory opinion about what the product is called.
  expect(sidebar).not.toContain("defaultNavItems")
  expect(sidebar).not.toMatch(/brand\?\s*:/)
  expect(sidebar).not.toMatch(/user\?\s*:/)

  // TopNav's data source must be required, not optional-with-a-store-fallback.
  expect(topNav).not.toContain("useDashboardStore")
  expect(topNav).toContain("dataSource: TopNavDataSource")
  expect(topNav).not.toMatch(/dataSource\?\s*:/)
})

/* -------------------------------------------------------------------------- */
/* §2 / §5 — Factory Core must stay ignorant of specific Style Packs            */
/* -------------------------------------------------------------------------- */

/**
 * Asset ids owned by Prototype Kits. Factory Core source must not name them.
 *
 * This is the mechanical answer to "is the Factory still unaware of specific
 * Style Packs?". `docs/` and `tests/` are excluded on purpose: a documentation
 * example is allowed to be concrete, and a test fixture is not Core source.
 * The moment one of these ids appears in Core *code*, the Factory has learned a
 * Kits value it should have read from the registry at runtime.
 *
 * Two scope corrections came out of the third prototype (v1.2 · F9), and both
 * are visible in the test below rather than hidden in it:
 *
 *   1. `lib/kits/**` is excluded. After a real `kits add`, `installed/` and the
 *      generated adapter seams are *named after assets* — that is what they are.
 *      v1.1 walked `lib/` in full, so a **correct installation** failed this
 *      test, and the only way to satisfy it was to patch the Factory inside
 *      every product. The third prototype's `tests/factory-contract.spec.ts`
 *      carries exactly that patch.
 *   2. Comments are stripped. Grading prose as code is the mistake this file
 *      already refuses to make elsewhere ("a config that documents `never reuse
 *      port 3000` necessarily contains the string `3000`"). It is not
 *      hypothetical here either: `scripts/lib/kits-seam.mjs` documents the seam
 *      by naming the ids it exists to catch, and the third prototype's
 *      `research-shell.css` names its pack ten times in its design record.
 *
 * Neither correction is an amnesty: `tests/kits-seam.spec.ts` re-checks the
 * identity rule with a scope that follows the install, and refuses to report
 * success when it scanned no files.
 */
const KITS_ASSET_IDS = [
  "cinematic",
  "editorial",
  "instrument",
  "animated-grid",
  "data-cursor",
  "insight-reveal",
  "interactive-hero",
  "spotlight-surface",
  "ambient-glow",
  "paper-grain",
  "scanline-sweep",
]

test("Factory Core source names no specific Kits asset", () => {
  const offenders: string[] = []
  const { files, excluded } = walkScoped(ROOT, {
    roots: PRODUCT_SOURCE_ROOTS,
    excludeTrees: [KITS_ROOT],
  })

  // A scan that looked at nothing must not be able to report a clean tree.
  expect(files.length, "Core 扫描必须真的扫到文件").toBeGreaterThan(0)

  for (const file of files) {
    const code = stripComments(read(file))
    for (const id of KITS_ASSET_IDS) {
      if (code.includes(id)) offenders.push(`${file} → "${id}"`)
    }
  }

  expect(
    offenders,
    "Factory Core 不得包含具体 Kits 资产 id。可选值必须在运行时从 Kits registry 读取，\n" +
      "否则新增一个 Style Pack 就会让 Factory 静默过期（见 docs/visual-manifest.md）。",
  ).toEqual([])
  expect(excluded, `lib/kits/** 的豁免计数（本次 ${excluded} 个文件）应当是可报告的`).toBeGreaterThanOrEqual(0)
})

/* -------------------------------------------------------------------------- */
/* §5 — Visual Manifest contract                                               */
/* -------------------------------------------------------------------------- */

const VALID_MANIFEST = {
  productType: "ai-finance-console",
  firstVisual: "深色空间里从左上打下来的环境光，标题浮在光里，下方一条发光曲线",
  stylePack: "some-pack",
  signatureComponents: ["a-component"],
  effects: ["an-effect"],
  motionDirection: "atmospheric",
  density: "medium",
  avoid: ["generic-ai-dashboard", "card-everywhere"],
}

test("Visual Manifest: a complete manifest validates", () => {
  const result = validateVisualManifest(VALID_MANIFEST)
  // `ok` means "no errors". Warnings are advice, and v1.2 added one: an
  // undeclared signature budget is a decision the Factory refuses to make on the
  // product's behalf, so it says so out loud instead of assuming a number. The
  // budget contract itself is tested in tests/art-direction.spec.ts.
  expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([])
  expect(result.issues.map((issue) => issue.code)).toEqual(["manifest/signature-budget-undeclared"])
  expect(result.ok).toBe(true)
})

test("Visual Manifest: missing required fields are reported", () => {
  // Deliberately drop `stylePack` to prove a missing required field is caught.
  const { stylePack: dropped, ...withoutPack } = VALID_MANIFEST
  expect(dropped).toBe(VALID_MANIFEST.stylePack)
  const result = validateVisualManifest(withoutPack)
  expect(result.ok).toBe(false)
  expect(result.issues.map((i) => i.code)).toContain("manifest/missing-field")
  expect(result.issues.map((i) => i.path)).toContain("stylePack")
})

test("Visual Manifest: an impression-only firstVisual is rejected", () => {
  for (const vague of ["现代简洁", "modern, clean and minimal", "高端大气上档次"]) {
    expect(isVacuousFirstVisual(vague), `应判定为空话: ${vague}`).toBe(true)
    const result = validateVisualManifest({ ...VALID_MANIFEST, firstVisual: vague })
    expect(result.ok).toBe(false)
    expect(result.issues.map((i) => i.code)).toContain("manifest/first-visual-vacuous")
  }
})

test("Visual Manifest: a concrete firstVisual is accepted", () => {
  const result = validateVisualManifest(VALID_MANIFEST)
  expect(isVacuousFirstVisual(VALID_MANIFEST.firstVisual)).toBe(false)
  expect(result.ok).toBe(true)
})

test("Visual Manifest: an empty avoid list is an error, an empty effects list is not", () => {
  // `avoid` is the manifest's load-bearing field — an empty list means the one
  // decision that constrains the default aesthetic was never made.
  const noAvoid = validateVisualManifest({ ...VALID_MANIFEST, avoid: [] })
  expect(noAvoid.ok).toBe(false)
  expect(noAvoid.issues.map((i) => i.code)).toContain("manifest/avoid-empty")

  // "No effects" is a legitimate decision, and a different one from "forgot".
  const noEffects = validateVisualManifest({ ...VALID_MANIFEST, effects: [] })
  expect(noEffects.ok).toBe(true)
})

test("Visual Manifest: unknown fields are rejected, not ignored", () => {
  const result = validateVisualManifest({ ...VALID_MANIFEST, stylepack: "typo" })
  expect(result.ok).toBe(false)
  expect(result.issues.map((i) => i.code)).toContain("manifest/unknown-field")
})

test("Visual Manifest: non-object input fails rather than passing silently", () => {
  for (const input of [null, undefined, "cinematic", 42, []]) {
    expect(validateVisualManifest(input).ok, `输入 ${JSON.stringify(input)} 应失败`).toBe(false)
  }
})

test("Visual Manifest: schema and TS contract agree on the required field set", () => {
  const schema = JSON.parse(read("lib/visual-manifest.schema.json"))
  const tsSource = read("lib/visual-manifest.ts")

  expect(schema.type).toBe("object")
  expect(schema.additionalProperties).toBe(false)
  expect(new Set(schema.required)).toEqual(
    new Set([
      "productType",
      "firstVisual",
      "stylePack",
      "signatureComponents",
      "effects",
      "motionDirection",
      "density",
      "avoid",
    ]),
  )

  // The schema must describe SHAPE only. An enum of pack ids here would make
  // Factory Core a second, staler copy of the Kits registry.
  const stylePack = schema.properties.stylePack
  expect(stylePack).toBeDefined()
  expect(stylePack.enum).toBeUndefined()
  for (const id of KITS_ASSET_IDS) expect(tsSource).not.toContain(id)
})

/* -------------------------------------------------------------------------- */
/* §14 — the QA sweep must not hard-code product routes                        */
/* -------------------------------------------------------------------------- */

test("QA route config contains no product-specific route", () => {
  const config = read(".qa/qa.config.mjs")
  // Routes come from filesystem discovery unless a product opts into an explicit
  // list; either way the default must not name one product's pages.
  expect(configuredRoutes === null || Array.isArray(configuredRoutes)).toBe(true)
  expect(config).not.toMatch(/["'`]\/crm/)
  expect(config).not.toMatch(/["'`]\/demo/)
})

test("QA sweep discovers routes and never hard-codes them", () => {
  // v1.2: the sweep moved to `.qa/sweep.mjs` so the local and the remote runner
  // share one implementation; the entry point now only owns the local server.
  const sweep = read(".qa/sweep.mjs")
  expect(sweep).toContain("discoverRoutes")
  expect(sweep).not.toMatch(/["'`]\/crm/)
})

test("QA port is dedicated and not the framework default", () => {
  expect(QA_PORT).not.toBe(3000)
  expect(QA_ORIGIN).toBe(`http://127.0.0.1:${QA_PORT}`)
})

/* -------------------------------------------------------------------------- */
/* §15 — port isolation                                                        */
/* -------------------------------------------------------------------------- */

test("playwright config never reuses an existing server", () => {
  const config = readCode("playwright.config.ts")

  // `reuseExistingServer` is a plain HTTP probe with no identity check: it will
  // adopt any server answering the readiness URL. It must be off, always.
  expect(config).toContain("reuseExistingServer: false")
  expect(config).not.toMatch(/reuseExistingServer:\s*!process\.env\.CI/)

  // No framework-default port anywhere.
  expect(config).not.toContain("localhost:3000")
  expect(config).not.toContain(":3000")

  // The dev server must be pinned, or Next can auto-increment to 3201 while
  // baseURL still points at 3200.
  expect(config).toContain("--port")
  expect(config).toContain("QA_ORIGIN")
})

test("the port guard exists, is wired into the test script, and forbids pkill", () => {
  expect(existsSync(join(ROOT, "scripts/check-qa-port.mjs"))).toBe(true)

  const pkg = JSON.parse(read("package.json"))
  expect(pkg.scripts.test).toContain("check-qa-port")

  const guard = read("scripts/check-qa-port.mjs")
  // The rule is stated where an agent will actually read it: at the failure.
  expect(guard).toContain("pkill")
  expect(guard).toContain("lsof")
})

test("QA sweep stops only the process group it started", () => {
  const sweep = read(".qa/browser-qa.mjs")
  expect(sweep).toContain("detached: true")
  expect(sweep).toContain("process.kill(-child.pid")
  expect(sweep).toContain("isPortInUse")
})

/* -------------------------------------------------------------------------- */
/* §8 — Kits ownership contract                                                */
/* -------------------------------------------------------------------------- */

test("ownership doc names all four Kits paths and their owners", () => {
  const doc = read("docs/kits-ownership.md")
  for (const path of [
    "lib/kits/installed/",
    "lib/kits/.kits/",
    "lib/kits/kits.lock.json",
    "lib/kits/adapters/",
  ]) {
    expect(doc, `ownership 文档必须写明 ${path}`).toContain(path)
  }
  expect(doc).toMatch(/Kits-managed/)
  expect(doc).toMatch(/Product-owned/)
  // The two prohibitions are the whole point of the contract.
  expect(doc).toMatch(/禁止手工修改|不得手工/)
  expect(doc).toMatch(/不得直接 import|不要直接 import|禁止.*import.*installed/)
})

test("AGENTS.md states the ownership contract", () => {
  const agents = read("AGENTS.md")
  expect(agents).toContain("lib/kits/installed/")
  expect(agents).toContain("lib/kits/adapters/")
  expect(agents).toMatch(/Kits-managed/)
})

test("the Factory itself imports nothing from a Kits install", () => {
  const offenders = []
  for (const file of SOURCE_FILES) {
    if (file.startsWith("tests/")) continue
    const contents = read(file)
    for (const line of contents.split("\n")) {
      if (!/^\s*(import|export)\s/.test(line)) continue
      if (line.includes("kits/installed") || line.includes("@kits/")) {
        offenders.push(`${file}: ${line.trim()}`)
      }
    }
  }
  expect(
    offenders,
    "产品代码必须走 adapter：Product → adapters → installed。直接 import installed/* 会在重装时静默失效。",
  ).toEqual([])
})

test("the Factory's own install state is absent or consistent", () => {
  const installed = existsSync(join(ROOT, "lib/kits/installed"))
  const lock = existsSync(join(ROOT, "lib/kits/kits.lock.json"))
  // Either no install at all (the Factory ships none), or both present. A
  // half-installed tree is the state that must never be silently accepted.
  expect(
    installed === lock,
    "lib/kits/installed/ 与 kits.lock.json 必须同时存在或同时不存在",
  ).toBe(true)
})

test("the doctor gate is honest when there is no install", () => {
  const gate = read("scripts/doctor-gate.mjs")
  expect(gate).toContain("not-installed")
  // It must not claim verification it did not perform.
  expect(gate).toContain("不代表“通过”")
  expect(gate).toContain("upstream-unavailable")
  // And it must delegate rather than reimplement.
  expect(gate).toContain("kits.mjs")
  expect(gate).toMatch(/runKitsCli/)
})

/* -------------------------------------------------------------------------- */
/* §7 — the Kits installer is invoked, never reimplemented                     */
/* -------------------------------------------------------------------------- */

test("install-kits drives the real CLI from the manifest", () => {
  const script = read("scripts/install-kits.mjs")

  // Asset ids come from the manifest, never from a literal list.
  expect(script).toContain("manifest.stylePack")
  expect(script).toContain("manifest.signatureComponents")
  expect(script).toContain("manifest.effects")
  for (const id of KITS_ASSET_IDS) expect(script).not.toContain(id)

  // Dry-run is the default; writing requires an explicit flag.
  expect(script).toContain("--dry-run")
  expect(script).toContain('flags.get("write")')

  // Order of operations: add → lock must exist → doctor.
  const body = script
  expect(body.indexOf("kits add") < body.indexOf("kits doctor")).toBe(true)
  expect(body).toContain("existsSync(lockPath)")
})

test("kits runtime defers evaluation to the registry, not to a copied list", () => {
  const runtime = read("scripts/lib/kits-runtime.mjs")
  expect(runtime).toContain("assets.json")
  expect(runtime).toContain('status === "approved"')
  for (const id of KITS_ASSET_IDS) expect(runtime).not.toContain(id)
})

/* -------------------------------------------------------------------------- */
/* §16 — Vercel bootstrap + credential safety                                  */
/* -------------------------------------------------------------------------- */

test("the Vercel checklist covers the settings that were actually got wrong", () => {
  const doc = read("docs/vercel-bootstrap.md")
  for (const needle of [
    "Root Directory",
    "Output Directory",
    "Production Branch",
    "Framework Preset",
  ]) {
    expect(doc, `checklist 必须包含 ${needle}`).toContain(needle)
  }
  expect(doc).toMatch(/Deployment Protection/)
  expect(doc).toMatch(/feature\/\*/)
})

test("credentials are declared user-managed state", () => {
  const doc = read("docs/vercel-bootstrap.md")
  expect(doc).toMatch(/credentials/i)
  expect(doc).toMatch(/user-managed/)
  expect(doc).toMatch(/不得删除|不要删除|禁止删除/)
  expect(doc).toMatch(/CLI credentials|凭证/)
})

/* -------------------------------------------------------------------------- */
/* §9 / §10 / §11 / §12 — the QA contract is documented and enforced           */
/* -------------------------------------------------------------------------- */

test("the QA standard doc states the three mobile criteria and the a11y rule", () => {
  const doc = read("docs/browser-qa.md")
  expect(doc).toContain("innerWidth")
  expect(doc).toContain("scrollWidth")
  expect(doc).toContain("scrollX")
  expect(doc).toMatch(/No Invisible Semantics/)
  expect(doc).toContain("Number.isFinite")
  expect(doc).toMatch(/pointer: coarse|coarse/)
  expect(doc).toMatch(/prefers-reduced-motion|reduced-motion/)
  expect(doc).toContain("1440")
  expect(doc).toContain("390")
})

test("AGENTS.md carries the v1.1 gates an agent must follow", () => {
  const agents = read("AGENTS.md")
  expect(agents).toContain("Visual Manifest")
  expect(agents).toMatch(/Art Direction/)
  expect(agents).toMatch(/No Invisible Semantics/)
  expect(agents).toContain("Number.isFinite")
  expect(agents).toContain("reuseExistingServer")
  expect(agents).toMatch(/pkill/)
  expect(agents).toMatch(/invariant/i)
})

test("the prototype-creation workflow lists the gates in order", () => {
  const doc = read("docs/prototype-creation-workflow.md")
  for (const stage of [
    "Visual Manifest",
    "kits add",
    "Invariant",
    "Browser QA",
    "Human Visual Acceptance",
    "Hub registration",
  ]) {
    expect(doc, `流程必须包含 ${stage}`).toContain(stage)
  }
})

test("the interactive-prototype skill has the Art Direction checkpoint", () => {
  const skill = read("skills/interactive-prototype/SKILL.md")
  expect(skill).toContain("Visual Manifest")
  expect(skill).toMatch(/Art Direction/)
  expect(skill).toMatch(/human|人工/i)
})
