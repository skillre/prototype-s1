/**
 * Kits seam gate — Factory v1.2 (F9 + F10).
 *
 * ===========================================================================
 * The defect this replaces
 * ===========================================================================
 * Factory v1.1 asserted "no Kits asset id appears in the source" by walking
 * `lib/` **in full**. That was true for the Factory (which ships no install) and
 * false for every product that had ever run `kits add`:
 *
 *   - `lib/kits/installed/**` is *named after the assets* — `insight-reveal/`,
 *     `data-cursor/`, `instrument/`. A correct installation therefore failed the
 *     Factory's own contract test.
 *   - `lib/kits/adapters/**` contains the generated `style-<pack>.ts` /
 *     `<asset>.tsx` seams, which are *definitionally* asset-named.
 *   - Meanwhile the Kits adapter recipe told the product to
 *     `import … from "@/lib/kits/adapters/<asset-id>"` — so the rule and the
 *     recipe contradicted each other, and the only way to satisfy both was to
 *     patch the Factory.
 *
 * Third prototype: patched. That is the wrong direction — a Factory rule whose
 * fix is per-product is not a Factory rule.
 *
 * ===========================================================================
 * The doctrine, restated as three tiers
 * ===========================================================================
 *
 *   Tier 1 · Kits-managed        lib/kits/installed/**   lib/kits/.kits/**
 *                                lib/kits/kits.lock.json
 *          Reinstallation overwrites these. They are *supposed* to know asset
 *          ids — that is what they are. Asset ids are legal here.
 *
 *   Tier 2 · adapter seam        lib/kits/adapters/**
 *          Product-owned, and the designated place where an asset id is
 *          *translated into a product-stable name*. `style.ts` may re-export
 *          `style-instrument.css`; `pointer.tsx` may re-export `data-cursor`.
 *          Asset ids are legal here too — this is the one directory whose whole
 *          job is to know them.
 *
 *   Tier 3 · product code        app/** components/** hooks/** stores/**
 *                                scripts/** lib/** (except lib/kits/**)
 *          Must never learn an asset id. `Product → neutral adapter → generated
 *          adapter → installed` is the only legal dependency direction, and
 *          tier 3 is where it starts.
 *
 * The rule that survives is the one that was always the point:
 *
 *     **Product logic must not know a specific Kits asset identity.**
 *
 * The rule that dies is the over-broad proxy: "asset ids may not appear anywhere
 * under lib/". Tier 3 is still scanned in full, so this is a scope correction,
 * not an amnesty — see `assertNonVacuousScan()`, which refuses to let a scan
 * that found no files report success.
 *
 * Two things this gate deliberately does **not** do:
 *
 *   1. It does not relax the predicate. `import { InsightReveal } from
 *      "@/lib/kits/installed/insight-reveal"` is still a violation, and so is
 *      `@/lib/kits/adapters/insight-reveal` — the fix for "the scan was too
 *      wide" is a correct scope, never a weaker rule.
 *   2. It does not grade prose. Comments are stripped before both rules run,
 *      and mentions that survive only in comments are counted and printed. The
 *      third prototype's `research-shell.css` names `instrument` ten times in
 *      its design record; a scanner that fails on that is damaging the product
 *      it claims to protect.
 *
 * ===========================================================================
 * What belongs to Kits and what belongs to the Factory
 * ===========================================================================
 * Kits' own `boundary.mjs` answers "did product code bypass `installed/`?" and it
 * does so well — but it can only run when a Kits install exists, and it says
 * nothing about asset *identity* (F10). The Factory gate answers the identity
 * question, and additionally restates the bypass rule as a **floor** so a
 * product with no install (and the Factory itself) is still checked rather than
 * silently unverified.
 *
 * The Factory does **not** generate adapters. Producing the neutral skeleton is
 * Kits v0.2 / K4. A second generator in the Factory would be a second truth
 * about the adapter contract, and per `doctor-gate.mjs` the weaker of two
 * implementations is the one that reports green.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/* -------------------------------------------------------------------------- */
/* Scope definition — one source of truth for both scanners                    */
/* -------------------------------------------------------------------------- */

/** The whole Kits tree. Never product source; never scanned by the rules below. */
export const KITS_ROOT = "lib/kits"

/** Tier 1: reinstallation overwrites these. */
export const MANAGED_TREES = ["lib/kits/installed", "lib/kits/.kits"]

/** Tier 2: product-owned seam; the legal home of an asset id. */
export const ADAPTER_SEAM = "lib/kits/adapters"

/**
 * Tier 3 roots: the product source the two rules are actually about.
 *
 * `tests/` and `docs/` are deliberately absent. A test fixture is allowed to be
 * concrete — the Factory's own contract spec holds a list of asset ids on
 * purpose — and a documentation example that could never say the word
 * "instrument" would be useless. What must stay ignorant is the code that
 * ships, which is exactly this list.
 */
export const PRODUCT_SOURCE_ROOTS = ["app", "components", "hooks", "stores", "lib", "scripts"]

/**
 * Roots that must exist for a scan to mean anything.
 *
 * A missing root is not "nothing to check" — it is "the check did not run". The
 * Factory baseline always has `app/` and `lib/`; if either is gone, the tree is
 * not a product and the gate must fail rather than report zero violations.
 */
export const REQUIRED_SCOPE_ROOTS = ["app", "lib"]

/** Directories that are never product source. */
export const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  ".turbo",
  ".vercel",
  "dist",
  "build",
  "out",
  "coverage",
  "test-results",
])

/** Extensions that can carry an import or a styling hook. */
export const SOURCE_EXT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|css)$/

/** Raised when a scan cannot be trusted to have measured anything. */
export class SeamScopeError extends Error {}

/* -------------------------------------------------------------------------- */
/* Walking                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Walk `roots` under `root`, skipping `skipDirs`, and never descending into
 * `excludeTrees`.
 *
 * Excluded files are **counted**, not silently dropped: the report has to show
 * how much of the tree the exemption covers, otherwise "we excluded lib/kits"
 * and "we excluded almost everything" look identical from the outside.
 *
 * @param {string} root
 * @param {{ roots?: string[], skipDirs?: Set<string>, excludeTrees?: string[] }} [options]
 * @returns {{ files: string[], excluded: number }} repo-relative POSIX paths
 */
export function walkScoped(root, options = {}) {
  const { roots = [], skipDirs = SKIP_DIRS, excludeTrees = [] } = options
  /** @type {string[]} */
  const files = []
  let excluded = 0

  const isExcluded = (rel) =>
    excludeTrees.some((tree) => rel === tree || rel.startsWith(`${tree}/`))

  const visit = (relDir) => {
    let entries
    try {
      entries = readdirSync(join(root, relDir || "."), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name.startsWith(".")) continue
      if (skipDirs.has(entry.name)) continue
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (isExcluded(rel)) {
          excluded += countFiles(join(root, rel))
          continue
        }
        visit(rel)
      } else if (entry.isFile() && SOURCE_EXT.test(entry.name)) {
        if (isExcluded(rel)) {
          excluded += 1
          continue
        }
        files.push(rel)
      }
    }
  }

  for (const dir of roots) if (existsSync(join(root, dir))) visit(dir)
  return { files: files.sort(), excluded }
}

/** Count the source files under a tree that gets excluded, for the report. */
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
      if (SKIP_DIRS.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile() && SOURCE_EXT.test(entry.name)) n += 1
    }
  }
  return n
}

/* -------------------------------------------------------------------------- */
/* Install discovery                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Read what a Kits install says is in play.
 *
 * The id set is **read from the tree, never from a list in this file**: an id
 * list here would be a second, staler copy of the Kits registry, which is the
 * exact failure `docs/visual-manifest.md` warns about.
 *
 * It is also narrower than the lock file on purpose. An id counts as an *asset
 * identity* only when both hold:
 *
 *   1. it is installed (`lib/kits/installed/<id>` or named by the lock), and
 *   2. a **generated, asset-named adapter** exists for it
 *      (`<id>.tsx`, `style-<id>.ts`, `effect-<id>.css`, …).
 *
 * Condition 2 is what keeps this rule precise. The lock also carries `cli`,
 * `contracts` and `react-utils`; `cli` is a substring of "client" and
 * "contracts" is an ordinary English word a product may legitimately use. Those
 * never get a generated adapter, so they are not identities a product could leak
 * — and treating them as such would produce a gate that fails on prose.
 *
 * @returns {{
 *   present: boolean,
 *   lockFile: string | null,
 *   installedEntries: string[],
 *   adapterEntries: string[],
 *   assetIds: string[],
 *   assetAdapterModules: string[],
 * }}
 */
export function readKitsInstall(root) {
  const lockRel = `${KITS_ROOT}/kits.lock.json`
  const lockAbs = join(root, lockRel)
  const installedDir = join(root, "lib/kits/installed")
  const adapterDir = join(root, ADAPTER_SEAM)

  /** @type {string[]} */
  let installedEntries = []
  if (existsSync(installedDir)) {
    try {
      installedEntries = readdirSync(installedDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() || entry.isFile())
        .map((entry) => entry.name.replace(/\.[^.]*$/, ""))
        .sort()
    } catch {
      installedEntries = []
    }
  }

  /** @type {string[]} */
  let adapterEntries = []
  if (existsSync(adapterDir)) {
    try {
      adapterEntries = readdirSync(adapterDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && SOURCE_EXT.test(entry.name))
        .map((entry) => entry.name.replace(/\.[^.]*$/, ""))
        .sort()
    } catch {
      adapterEntries = []
    }
  }

  const installed = new Set(installedEntries)
  const assetIds = new Set()
  const assetAdapterModules = new Set()
  for (const entry of adapterEntries) {
    // `style-instrument` / `effect-paper-grain` → the id that seam was generated
    // for; `pointer` / `structure` / `style-pack` → nothing installed, ignored.
    const stripped = entry.replace(/^(?:style|effect)-/, "")
    for (const candidate of [entry, stripped]) {
      if (!installed.has(candidate)) continue
      assetIds.add(candidate)
      // The module name as a product would have to write it in an import:
      // `@/lib/kits/adapters/style-instrument`, not the bare id.
      assetAdapterModules.add(entry)
    }
  }

  return {
    present: existsSync(lockAbs) || existsSync(installedDir),
    lockFile: existsSync(lockAbs) ? lockRel : null,
    installedEntries,
    adapterEntries,
    assetIds: [...assetIds].sort(),
    assetAdapterModules: [...assetAdapterModules].sort(),
  }
}

/* -------------------------------------------------------------------------- */
/* Specifier scanning                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Remove block and line comments.
 *
 * Both rules below are about what a file **does**. Prose is a different thing
 * and must not be graded as code — the Factory already settled this argument for
 * its port guard: "a config that documents `never reuse port 3000` necessarily
 * contains the string `3000`". The same holds here, and it is not hypothetical:
 * the third prototype's `components/research/research-shell.css` names
 * `instrument` ten times, entirely in the header that records why the pack
 * needed a dark-palette bridge. That file is a design record; deleting its
 * reasoning to satisfy a scanner would be the scanner damaging the product.
 *
 * Mentions that survive only in comments are **counted and reported** rather
 * than ignored, so the exemption is visible in the output instead of being an
 * invisible hole.
 */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

/**
 * Literal module specifiers in a source file.
 *
 * Deliberately static-only: `import … from "…"`, `import "…"`, `export … from
 * "…"`, `import("…")` and CSS `@import "…"`. A specifier assembled at runtime
 * is not visible here, and pretending otherwise would mean shipping a parser.
 * The limit is real and is stated rather than papered over — what it cannot see,
 * `kits doctor` may, and a human reviewing the diff always can.
 *
 * Multi-line imports are the reason this scans the whole content instead of
 * line by line: `} from "@/lib/kits/adapters/pointer"` is a real line in a real
 * product, and a line scanner never sees the `import`.
 */
export function scanSpecifiers(source) {
  const stripped = stripComments(source)

  const found = []
  const patterns = [
    /\b(?:import|export)\b[^;'"`]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /(?:^|[\s;])import\s+["']([^"']+)["']/g,
    /@import\s+(?:url\(\s*)?["']([^"']+)["']/g,
  ]
  for (const pattern of patterns) {
    for (const match of stripped.matchAll(pattern)) found.push(match[1])
  }
  return [...new Set(found)]
}

/** Resolve a literal specifier to a repo-relative POSIX path, or null. */
function resolveSpecifier(relFile, spec) {
  if (spec.startsWith("@/")) return normalizePath(spec.slice(2))
  if (spec.startsWith("./") || spec.startsWith("../")) {
    const dir = relFile.includes("/") ? relFile.slice(0, relFile.lastIndexOf("/")) : ""
    return normalizePath(`${dir}/${spec}`)
  }
  return null
}

/** Collapse `a/b/../c` and leading `./` without touching the filesystem. */
function normalizePath(value) {
  const out = []
  for (const part of value.split("/")) {
    if (part === "" || part === ".") continue
    if (part === "..") out.pop()
    else out.push(part)
  }
  return out.join("/")
}

const within = (resolved, tree) => resolved === tree || resolved.startsWith(`${tree}/`)

/** The last path segment of a specifier, with any extension removed. */
function moduleNameOf(spec) {
  const last = spec.split("/").pop() ?? ""
  return last.replace(/\.[^.]*$/, "")
}

/**
 * A boundary-aware pattern for one asset id.
 *
 * `includes(id)` is not usable here: `cli` matches "client", and a gate that
 * fires on the word "client" is worse than no gate. An id must appear as a whole
 * token — not glued to an identifier character or a hyphen on either side — but
 * it may still carry a path or extension around it (`"data-cursor"`,
 * `./data-cursor.tsx`, `data-kits-data-cursor`).
 */
export function assetIdPattern(id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`)
}

/** How many whole-token occurrences of `id` a chunk of source contains. */
function countAssetIds(source, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return source.match(new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, "g"))?.length ?? 0
}

/* -------------------------------------------------------------------------- */
/* The scan                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Scan tier 3 for the two seam violations.
 *
 * @param {string} root project root
 * @returns {{
 *   scopeRoots: string[],
 *   missingRoots: string[],
 *   scanned: number,
 *   excluded: number,
 *   install: ReturnType<typeof readKitsInstall>,
 *   commentMentions: Array<{file: string, id: string}>,
 *   violations: Array<{kind: string, file: string, detail: string, why: string}>,
 * }}
 */
export function scanSeam(root) {
  const install = readKitsInstall(root)
  const scopeRoots = PRODUCT_SOURCE_ROOTS.filter((dir) => existsSync(join(root, dir)))
  const missingRoots = REQUIRED_SCOPE_ROOTS.filter((dir) => !existsSync(join(root, dir)))

  const { files, excluded } = walkScoped(root, {
    roots: scopeRoots,
    excludeTrees: [KITS_ROOT],
  })

  /** @type {Array<{kind: string, file: string, detail: string, why: string}>} */
  const violations = []
  /** @type {Array<{file: string, id: string, count: number}>} */
  const commentMentions = []
  const seen = new Set()
  const push = (violation) => {
    const key = `${violation.kind}|${violation.file}|${violation.detail}`
    if (seen.has(key)) return
    seen.add(key)
    violations.push(violation)
  }

  for (const file of files) {
    let contents
    try {
      contents = readFileSync(join(root, file), "utf8")
    } catch {
      // An unreadable file is not an absence of a violation. It is counted in
      // `scanned` and reported, so it can never quietly reduce coverage.
      push({
        kind: "kits/unreadable",
        file,
        detail: "文件无法读取",
        why: "无法读取的源文件是未检查的覆盖缺口，不是没有违规。",
      })
      continue
    }

    // Grade the code, not the prose. See `stripComments()`.
    const code = stripComments(contents)

    for (const id of install.assetIds) {
      if (countAssetIds(code, id) > 0) {
        push({
          kind: "kits/asset-id-in-product",
          file,
          detail: `"${id}"`,
          why:
            "产品逻辑不应该知道具体 Kits asset identity。把它收进 lib/kits/adapters/ 的中性入口，" +
            "产品代码只 import 那个入口。",
        })
      } else {
        const inCommentsOnly = countAssetIds(contents, id)
        if (inCommentsOnly > 0) commentMentions.push({ file, id, count: inCommentsOnly })
      }
    }

    for (const spec of scanSpecifiers(code)) {
      const resolved = resolveSpecifier(file, spec)

      if (spec.startsWith("@kits/")) {
        push({
          kind: "kits/bare-specifier",
          file,
          detail: spec,
          why: "源码安装必须把 @kits/* 重写成相对路径或 @/ 别名，否则产品依赖一个并不存在的包。",
        })
        continue
      }
      if (!resolved) continue

      if (MANAGED_TREES.some((tree) => within(resolved, tree))) {
        push({
          kind: "kits/managed-import",
          file,
          detail: spec,
          why:
            "托管区（installed/、.kits/）重新安装时会被整体覆盖。产品必须走 adapters/，" +
            "否则 Kits 升级会让引用路径静默失效。",
        })
        continue
      }

      if (within(resolved, ADAPTER_SEAM) && install.assetAdapterModules.includes(moduleNameOf(spec))) {
        push({
          kind: "kits/asset-adapter-import",
          file,
          detail: spec,
          why:
            "这个 adapter 是以资产名生成的（资产 id 就在路径里）。产品要 import 的是" +
            " lib/kits/adapters/ 里的中性入口；换 pack 时只改那一处。",
        })
      }
    }
  }

  return {
    scopeRoots,
    missingRoots,
    scanned: files.length,
    excluded,
    install,
    commentMentions,
    violations,
  }
}

/**
 * Refuse to let a scan that measured nothing report success.
 *
 * This is the Factory's answer to the asymmetry behind Kits K5: a scanner whose
 * output is "0 violations" is indistinguishable from a scanner whose scope
 * silently resolved to nothing. Kits' `boundary` prints `scanned 0` and passes;
 * this one throws, because the Factory must not copy a gate that can go green
 * without looking.
 */
export function assertNonVacuousScan(scan) {
  if (scan.missingRoots.length > 0) {
    throw new SeamScopeError(
      `Kits seam gate 的范围不完整：缺少 ${scan.missingRoots.join(", ")}。\n` +
        "  范围根缺失不是「没有可检查的东西」，而是「检查没有发生」——拒绝判 PASS。",
    )
  }
  if (scan.scopeRoots.length === 0) {
    throw new SeamScopeError(
      "Kits seam gate 的范围为空：一个产品源根都没有找到。0 files scanned 不能判 PASS。",
    )
  }
  if (scan.scanned === 0) {
    throw new SeamScopeError(
      "Kits seam gate 扫过 0 个产品源文件。\n" +
        "  「0 个文件里没有违规」和「检查没跑」在输出上是一样的，所以这里必须失败。",
    )
  }
  return scan
}

/** Human-readable report. Printed, not inferred — the counts are the evidence. */
export function formatSeamReport(scan) {
  const { install } = scan
  const lines = [
    "Kits seam gate (F9 + F10)",
    `  install   ${install.present ? `source-installed${install.lockFile ? ` · ${install.lockFile}` : ""}` : "absent（未安装 Kits）"}`,
    `  assetIds  ${install.assetIds.length > 0 ? install.assetIds.join(", ") : "（无：没有安装就没有 asset identity 可泄漏）"}`,
    `  资产名缝   ${install.assetAdapterModules.length > 0 ? install.assetAdapterModules.join(", ") : "（无）"}  ← 产品不得 import 这些模块`,
    `  scope     ${scan.scopeRoots.join(", ")}`,
    `  scanned   ${scan.scanned} 个产品源文件`,
    `  excluded  ${scan.excluded} 个文件在 ${KITS_ROOT}/**（Kits-managed + adapter seam）`,
    `  violations ${scan.violations.length}`,
  ]
  if (scan.commentMentions.length > 0) {
    const total = scan.commentMentions.reduce((n, mention) => n + mention.count, 0)
    const byFile = new Map()
    for (const mention of scan.commentMentions) {
      byFile.set(mention.file, (byFile.get(mention.file) ?? 0) + mention.count)
    }
    lines.push(
      `  注释提及   ${total} 处（按 prose 处理，不计违规）：` +
        [...byFile].map(([file, n]) => `${file} ×${n}`).join(", "),
    )
  }
  if (!install.present) {
    lines.push(
      "  注意      未安装 Kits 时，asset-identity 规则无事可做（没有 id 可泄漏）；",
      "            managed-import 规则仍然有效。这不代表「已与上游比对」。",
    )
  }
  for (const violation of scan.violations) {
    lines.push(`  ✗ [${violation.kind}] ${violation.file} ${violation.detail}`, `      ${violation.why}`)
  }
  return lines.join("\n")
}
