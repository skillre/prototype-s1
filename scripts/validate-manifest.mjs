#!/usr/bin/env node
/**
 * Validate a Visual Manifest.
 *
 * Two passes, in this order:
 *   1. **Structural** — always available, never needs the Kits repo. Owned by
 *      `lib/visual-manifest.ts`.
 *   2. **Upstream** — checks that `stylePack` / `signatureComponents` /
 *      `effects` resolve to `approved` assets in the Kits registry. Only
 *      possible when the Kits checkout is reachable.
 *
 * The second pass is reported honestly. When Kits is absent this prints
 * `[upstream-unavailable]` and says in as many words that **no upstream
 * comparison was performed**. It must never imply agreement it did not verify —
 * a standalone prototype is a normal state for Source Installation, and a tool
 * that overstates its own certainty is worse than one that admits its limits.
 *
 *   pnpm factory:manifest
 *   pnpm factory:manifest --manifest path/to/visual-manifest.json --kits ../prototype-kits
 */

import { existsSync } from "node:fs"
import { join } from "node:path"

import {
  EXIT,
  crossCheckManifest,
  crossCheckPackProfile,
  loadPackManifest,
  glyph,
  heading,
  loadKitsRegistry,
  loadManifest,
  parseArgs,
  resolveKitsRoot,
} from "./lib/kits-runtime.mjs"

const { flags } = parseArgs(process.argv.slice(2))
const projectRoot = process.cwd()
const asJson = flags.get("json") === true

function emit(report) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return
  }
  heading("Prototype Factory · Visual Manifest")
  for (const line of report.lines) process.stdout.write(`${line}\n`)
}

const loaded = loadManifest(projectRoot, flags.get("manifest"))
if (!loaded.ok) {
  emit({
    ok: false,
    status: "invalid",
    manifestPath: loaded.path,
    lines: [`${glyph.bad} ${loaded.detail}`],
    issues: [{ code: "manifest/unusable", weight: "error" }],
  })
  process.exit(EXIT.INVALID)
}

const manifest = loaded.manifest
const lines = [`${glyph.ok} structure     ${loaded.path}`]
const issues = []

const kits = resolveKitsRoot({
  explicit: typeof flags.get("kits") === "string" ? flags.get("kits") : undefined,
  projectRoot,
})

let status
if (!kits) {
  status = "upstream-unavailable"
  lines.push(
    `${glyph.warn} upstream-kits [upstream-unavailable] 未找到 Kits 仓库（独立安装模式的正常状态）。`,
  )
  lines.push(
    "              → 本次**未做上游比对**：stylePack / signatureComponents / effects 的 id 是否存在于 registry、是否 approved，均未验证。",
  )
  lines.push(
    "              → 想比对：`pnpm factory:manifest --kits ../prototype-kits`，或设置 KITS_ROOT。",
  )
} else {
  const registry = loadKitsRegistry(kits.registry)
  if (!registry.ok) {
    status = "upstream-unavailable"
    lines.push(`${glyph.warn} upstream-kits [upstream-unavailable] ${registry.detail}`)
    lines.push("              → 本次**未做上游比对**。")
  } else {
    const crossIssues = crossCheckManifest(manifest, registry)
    issues.push(...crossIssues)

    /*
     * Level 3 — the pack's own profile.
     *
     * Level 1 (`lib/visual-manifest.ts`) checked the *shape* of the decision.
     * Level 2 checked that the manifest agrees with itself. This is the only
     * level that can answer "does the declared motion language match the pack
     * you actually chose?" — and it is possible only because the pack manifest
     * exposes `motion.language` / `profile.density`.
     */
    const packLoaded = loadPackManifest(kits.root, registry, manifest.stylePack)
    let profileStatus = "unverifiable"
    if (!packLoaded.ok) {
      lines.push(
        `${glyph.warn} pack-profile [unverifiable] ${packLoaded.detail ?? packLoaded.reason}`,
      )
      lines.push(
        "              → motionDirection / density **未与 pack 比对**——这不等于它们一致。",
      )
    } else {
      const profile = crossCheckPackProfile(manifest, packLoaded.value)
      profileStatus = profile.status
      for (const check of profile.checked) {
        if (check.declared.toLowerCase() === check.packValue.toLowerCase()) {
          lines.push(
            `${glyph.ok} pack-profile ${check.label}: \`${check.declared}\` == pack \`${check.packValue}\`（${check.packLabel}）`,
          )
        } else if (check.recorded) {
          lines.push(
            `${glyph.warn} pack-profile [recorded-deviation] ${check.label} \`${check.declared}\` ≠ pack \`${check.packValue}\` — 已在 deviations 里记录理由，不算失败`,
          )
        }
        // A mismatch that is NOT recorded is printed as an error below.
      }
      for (const skipped of profile.unverifiable) {
        lines.push(
          `${glyph.warn} pack-profile [unverifiable] ${skipped.label}: pack \`${packLoaded.value.id}\` ${skipped.reason}`,
        )
      }
      for (const issue of profile.issues) {
        lines.push(`              ${glyph.bad} [${issue.code}] ${issue.path} — ${issue.message}`)
      }
    }

    if (crossIssues.length > 0 || profileStatus === "mismatch") {
      status = "invalid"
      lines.push(`${glyph.bad} upstream-kits [mismatch] registry ${registry.registryVersion}`)
      for (const issue of crossIssues) {
        lines.push(`              ${glyph.bad} [${issue.code}] ${issue.path} — ${issue.message}`)
      }
    } else if (profileStatus === "unverifiable") {
      status = "upstream-unavailable"
      lines.push(
        `${glyph.warn} upstream-kits [partial] registry ${registry.registryVersion}：id 已比对，**pack profile 未比对**`,
      )
    } else {
      status = "verified"
      lines.push(
        `${glyph.ok} upstream-kits [verified] registry ${registry.registryVersion} @ ${kits.root}`,
      )
      lines.push(
        `              stylePack=${manifest.stylePack} · components=[${manifest.signatureComponents.join(", ")}] · effects=[${manifest.effects.join(", ") || "—"}] 全部为 approved 资产。`,
      )
    }
  }
}

/* ---- the decisions themselves, printed so a missing one is visible ------- */

const budget = manifest.signatureComponentBudget
lines.push(
  budget === undefined
    ? `${glyph.warn} decisions     签名组件上限：**未声明**（Factory 不代填，也不把「没写」当通过）`
    : `${glyph.ok} decisions     签名组件上限：${budget}（当前 ${manifest.signatureComponents.length}）`,
)

const deviations = Array.isArray(manifest.deviations) ? manifest.deviations : []
if (deviations.length === 0) {
  lines.push(`${glyph.ok} decisions     有意偏离：0 条`)
} else {
  lines.push(`${glyph.ok} decisions     有意偏离：${deviations.length} 条（记录，不是自动批准）`)
  for (const deviation of deviations) {
    lines.push(
      `              · ${deviation.axis}: \`${deviation.from}\` → \`${deviation.to}\` — ${deviation.reason}`,
    )
  }
}

const lockPath = join(projectRoot, "lib", "kits", "kits.lock.json")
lines.push(
  existsSync(lockPath)
    ? `${glyph.ok} kits.lock     已生成 → ${lockPath}`
    : `${glyph.warn} kits.lock     尚未安装（还没跑过 \`pnpm factory:kits --write\`）`,
)

const ok = status !== "invalid"
lines.push("")
lines.push(ok ? `${glyph.ok} Visual Manifest OK (${status})` : `${glyph.bad} Visual Manifest 未通过`)

emit({ ok, status, manifestPath: loaded.path, issues, lines })

if (!ok) process.exit(EXIT.INVALID)
