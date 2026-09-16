/**
 * Initialization boundary — Factory v1.2 (INIT = F5 + F6 + F7 + identity).
 *
 * ===========================================================================
 * The three layers this file names
 * ===========================================================================
 * `prototype-starter` contains three different things, and until v1.2 they were
 * only distinguishable by reading the repo:
 *
 *   A · Factory Core          copied into every product: shell primitives, the
 *                             token layer, the QA harness, the contracts, the
 *                             scripts. `components/**`, `lib/**`, `scripts/**`,
 *                             `.qa/**`, `tests/**` (core specs).
 *   B · Reference Sample      exists to demonstrate and teach, and must never
 *                             become a new product's identity: `app/crm/**`,
 *                             `app/demo/**`, `app/sample-command-center.css`,
 *                             and the specs that exercise them.
 *   C · Initialization        the files a new product must check, rewrite or
 *       Surface               delete before it is a product rather than a copy:
 *                             `package.json`, `README.md`, `app/layout.tsx`,
 *                             `app/page.tsx`, `app/not-found.tsx`, the i18n
 *                             dictionary.
 *
 * The failure this prevents is not "the sample exists". It is **a half-renamed
 * product**: a tree that changed its package name and left the sample's product
 * name, metadata and home-page entry pointing at the CRM.
 *
 * ===========================================================================
 * Why the stage is declared, and then checked
 * ===========================================================================
 * The Factory itself is a legitimate state (it *is* the baseline), and so is an
 * initialized product. Nothing intrinsic distinguishes them, so `stage` is
 * declared in `init-contract.json` — and then cross-checked against reality in
 * both directions:
 *
 *   stage: "baseline"  the baseline identity must still be intact. Rename the
 *                      package and this fails: you cannot half-initialize and
 *                      keep calling yourself the Factory.
 *   stage: "product"   none of the baseline's or the sample's identity may
 *                      remain in the initialization surface.
 *
 * That closes the only dodge (leaving `stage` alone) by making it require the
 * tree to actually still be the Factory.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, sep } from "node:path"

import { stripComments } from "./kits-seam.mjs"

export const INIT_CONTRACT_FILENAME = "init-contract.json"
export const INIT_SCHEMA_VERSION = 1

/** Stages a tree can declare itself to be in. */
export const STAGES = ["baseline", "product"]

/**
 * Marker a landing page carries while it is still the Factory's own landing.
 * The scanner looks for it in `app/page.tsx`; the initialization checklist says
 * to remove it when the product writes its own.
 */
export const FACTORY_LANDING_MARKER = "data-factory-landing"

/**
 * Marker that labels a Reference Sample entry on a landing page.
 * A product may keep the sample; it may not present it as the product.
 */
export const REFERENCE_SAMPLE_MARKER = "data-reference-sample"

const KNOWN_TOP_LEVEL = new Set([
  "$schema",
  "schemaVersion",
  "stage",
  "baselineIdentity",
  "sampleOwned",
  "productFacing",
  "sampleMarkers",
])

export class InitScopeError extends Error {}

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0

/** Structural validation of the boundary contract itself. */
export function validateInitContract(input) {
  const issues = []
  const push = (path, code, message) => issues.push({ path, severity: "error", code, message })

  if (!isPlainObject(input)) {
    return { ok: false, issues: [{ path: "$", severity: "error", code: "init/not-an-object", message: "init-contract.json 必须是对象。" }] }
  }
  for (const key of Object.keys(input)) {
    if (!KNOWN_TOP_LEVEL.has(key)) push(key, "init/unknown-field", `未知字段 \`${key}\`。`)
  }
  if (input.schemaVersion !== INIT_SCHEMA_VERSION) {
    push("schemaVersion", "init/unsupported-schema-version", `schemaVersion 必须是 ${INIT_SCHEMA_VERSION}。`)
  }
  if (!STAGES.includes(input.stage)) {
    push("stage", "init/unknown-stage", `stage 必须是 ${STAGES.join(" / ")}，当前是 ${JSON.stringify(input.stage)}。`)
  }
  if (!isPlainObject(input.baselineIdentity)) {
    push("baselineIdentity", "init/missing-field", "缺少 baselineIdentity。")
  } else {
    for (const field of ["packageName", "metadataTitle", "landingMarker"]) {
      if (!isNonEmptyString(input.baselineIdentity[field])) {
        push(`baselineIdentity.${field}`, "init/missing-field", `baselineIdentity.${field} 必须是非空字符串。`)
      }
    }
  }
  for (const field of ["sampleOwned", "productFacing", "sampleMarkers"]) {
    const value = input[field]
    if (!Array.isArray(value) || value.length === 0) {
      push(field, "init/missing-field", `${field} 必须是非空数组。`)
      continue
    }
    value.forEach((entry, index) => {
      if (!isNonEmptyString(entry)) push(`${field}[${index}]`, "init/empty-entry", `${field}[${index}] 必须是非空字符串。`)
    })
  }
  return { ok: issues.length === 0, issues }
}

/* -------------------------------------------------------------------------- */
/* Path classification                                                         */
/* -------------------------------------------------------------------------- */

const normalize = (path) => path.split(sep).join("/")
const isDirEntry = (entry) => entry.endsWith("/")

/**
 * Which of the three layers a repo-relative path belongs to.
 *
 * `sampleOwned` wins over everything: the point of the boundary is that the
 * sample may keep its own identity where it lives. Everything not listed is
 * Core (A) — which is safe by construction, because the checks below only ever
 * run over `productFacing` (C).
 */
export function classifyPath(path, contract) {
  const rel = normalize(path)
  for (const entry of contract.sampleOwned ?? []) {
    if (isDirEntry(entry) ? rel === entry.slice(0, -1) || rel.startsWith(entry) : rel === entry) {
      return "sample"
    }
  }
  if ((contract.productFacing ?? []).includes(rel)) return "initialization"
  return "core"
}

/** Count files under a directory, for the report's excluded column. */
function countFiles(absDir) {
  let n = 0
  const stack = [absDir]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else n += 1
    }
  }
  return n
}

/* -------------------------------------------------------------------------- */
/* The scan                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Scan the initialization surface.
 *
 * @param {string} root
 * @param {object} contract parsed init-contract.json
 * @returns {{
 *   stage: string,
 *   scanned: number,
 *   excluded: number,
 *   files: string[],
 *   missing: string[],
 *   violations: Array<{check: string, file: string, detail: string, why: string}>,
 * }}
 */
export function scanInitBoundary(root, contract) {
  const files = []
  const missing = []
  const violations = []
  let excluded = 0

  for (const entry of contract.sampleOwned ?? []) {
    const abs = join(root, isDirEntry(entry) ? entry.slice(0, -1) : entry)
    if (existsSync(abs)) excluded += isDirEntry(entry) ? countFiles(abs) : 1
  }

  const readFile = (rel) => {
    if (!existsSync(join(root, rel))) {
      missing.push(rel)
      return null
    }
    files.push(rel)
    try {
      return readFileSync(join(root, rel), "utf8")
    } catch {
      violations.push({
        check: "init/unreadable",
        file: rel,
        detail: "文件无法读取",
        why: "读不到的文件是未检查的覆盖缺口，不是没有残留。",
      })
      return null
    }
  }

  const identity = contract.baselineIdentity ?? {}
  const samples = contract.sampleMarkers ?? []
  const productStage = contract.stage === "product"

  // Read the whole initialization surface first, whatever the stage: an
  // existence check on every declared file is the floor, and `scanned` must
  // mean "files actually inspected" rather than "files a check happened to
  // touch".
  /** @type {Map<string, string>} */
  const surface = new Map()
  for (const rel of contract.productFacing ?? []) {
    const contents = readFile(rel)
    if (contents !== null) surface.set(rel, contents)
  }

  // 1 · The Reference Sample's own names must not sit on the initialization
  //     surface of a *product*. The Factory's own dictionary legitimately holds
  //     the sample's copy (that is where the sample gets its words), so this
  //     check belongs to the product stage.
  for (const [rel, contents] of productStage ? surface : []) {
    for (const marker of samples) {
      if (contents.includes(marker)) {
        violations.push({
          check: "init/sample-identity",
          file: rel,
          detail: `"${marker}"`,
          why: "Reference Sample 的身份出现在 Product-facing 文件里。把它留在 sample-owned 路径内。",
        })
      }
    }
  }

  const packageJson = readFile("package.json")
  const layout = readFile("app/layout.tsx")
  // Prose is not code: a marker inside a comment must not satisfy a structural
  // check, or the check becomes a spelling test.
  const landing = surface.has("app/page.tsx") ? stripComments(surface.get("app/page.tsx")) : null
  const layoutCode = layout === null ? null : stripComments(layout)

  if (packageJson !== null) {
    let name = null
    try {
      name = JSON.parse(packageJson).name
    } catch {
      violations.push({
        check: "init/package-unreadable",
        file: "package.json",
        detail: "无法解析",
        why: "包身份是初始化边界的一部分，读不出来就无法判断。",
      })
    }
    if (productStage) {
      if (name === identity.packageName) {
        violations.push({
          check: "init/package-identity",
          file: "package.json",
          detail: `name 仍是 "${name}"`,
          why: "新产品的包名必须改掉 baseline 的名字（这是初始化的第一步）。",
        })
      }
    } else if (name !== identity.packageName) {
      violations.push({
        check: "init/stage-mismatch",
        file: "package.json",
        detail: `name = "${name}"，但 stage 是 baseline`,
        why:
          `contract 说这是 Factory baseline，可是包名已经不是 \`${identity.packageName}\`。` +
          " 要么改回去，要么把 stage 改成 product 并完成初始化清单。",
      })
    }
  }

  if (layoutCode !== null) {
    const isBaselineTitle =
      typeof identity.metadataTitle === "string" && layoutCode.includes(identity.metadataTitle)
    if (productStage && isBaselineTitle) {
      violations.push({
        check: "init/metadata-identity",
        file: "app/layout.tsx",
        detail: `metadata 仍是 "${identity.metadataTitle}"`,
        why: "新产品的 <title> 不能还是 Starter 的标题——它是最容易被忽略、也最容易被看到的一处身份。",
      })
    }
    if (!productStage && !isBaselineTitle) {
      violations.push({
        check: "init/stage-mismatch",
        file: "app/layout.tsx",
        detail: `metadata 里找不到 "${identity.metadataTitle}"`,
        why: "contract 说这是 baseline，但 baseline 标题已经不在了。把 stage 改成 product，或把标题改回去。",
      })
    }
  }

  if (landing !== null) {
    const hasFactoryMarker = landing.includes(identity.landingMarker ?? FACTORY_LANDING_MARKER)
    const linksSample = landing.includes('"/crm') || landing.includes("'/crm")
    const labelsSample = landing.includes(REFERENCE_SAMPLE_MARKER)

    if (productStage) {
      if (hasFactoryMarker) {
        violations.push({
          check: "init/homepage-not-replaced",
          file: "app/page.tsx",
          detail: `仍带 ${identity.landingMarker}`,
          why: "首页还是 Factory 的落地页。产品要写自己的首页，并移除这个标记。",
        })
      }
      if (linksSample && !labelsSample) {
        violations.push({
          check: "init/homepage-entry",
          file: "app/page.tsx",
          detail: "首页链接 /crm 但没有 Reference Sample 标记",
          why:
            "Reference Sample 可以被保留，但不能被当成产品的主入口。" +
            ` 保留就必须显式标注（${REFERENCE_SAMPLE_MARKER}），否则请删掉这个入口。`,
        })
      }
    } else if (!hasFactoryMarker) {
      violations.push({
        check: "init/stage-mismatch",
        file: "app/page.tsx",
        detail: `首页缺少 ${identity.landingMarker ?? FACTORY_LANDING_MARKER}`,
        why: "contract 说这是 baseline，但 Factory 落地页标记不见了。把 stage 改成 product，或恢复落地页。",
      })
    }
  }

  return {
    stage: contract.stage,
    scanned: new Set(files).size,
    excluded,
    files: [...new Set(files)].sort(),
    missing,
    violations,
  }
}

/**
 * A scan that measured nothing cannot report success.
 *
 * Same rule as every other Factory scanner: "no residue found" and "nothing was
 * read" must not produce the same output.
 */
export function assertNonVacuousInitScan(scan) {
  if (scan.missing.length > 0) {
    throw new InitScopeError(
      `初始化边界不完整：契约里的这些 Product-facing 文件不存在 —— ${scan.missing.join(", ")}。\n` +
        "  声明了却读不到，等于没有检查。",
    )
  }
  if (scan.scanned === 0) {
    throw new InitScopeError("扫过 0 个 Product-facing 文件：0 scanned 不能判 PASS。")
  }
  return scan
}

/** Human-readable report. */
export function formatInitReport(scan) {
  const lines = [
    "Initialization boundary (INIT / F5 + F6 + F7 + identity)",
    `  stage        ${scan.stage}${scan.stage === "baseline" ? "（Factory baseline：Reference Sample 允许存在，identity 检查不适用）" : ""}`,
    `  productFacing ${scan.scanned} 个文件被检查`,
    `  sampleOwned   ${scan.excluded} 个文件被豁免（Reference Sample 可以在自己的路径里说自己的名字）`,
    `  violations   ${scan.violations.length}`,
  ]
  if (scan.stage === "baseline") {
    lines.push(
      "  注意         这是 Factory baseline，不是产品。派生新原型时读 docs/product-initialization.md。",
    )
  }
  for (const violation of scan.violations) {
    lines.push(`  ✗ [${violation.check}] ${violation.file} — ${violation.detail}`, `      ${violation.why}`)
  }
  return lines.join("\n")
}
