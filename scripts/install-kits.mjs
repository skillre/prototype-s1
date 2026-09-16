#!/usr/bin/env node
/**
 * Install Prototype Kits assets into a prototype, driven by its Visual Manifest.
 *
 * This is the Factory's entry point into **Source Installation**. It is a thin,
 * opinionated wrapper around the real Kits CLI — it does not package, rewrite,
 * or lock anything itself. The Factory's contribution is the *order* of
 * operations, and the ownership rules it refuses to let you skip:
 *
 *   manifest → validate → cross-check registry → `kits add --dry-run`
 *            → `kits add` → doctor → lock must exist → ownership reminder
 *
 * Usage
 * -----
 *   pnpm factory:kits                              # dry-run (safe, default)
 *   pnpm factory:kits --write                      # actually install
 *   pnpm factory:kits --write --kits ../prototype-kits
 *
 * After this runs, `lib/kits/installed/**` is Kits-managed and must never be
 * hand-edited. Hand-written integration goes in `lib/kits/adapters/**`, which
 * Kits never overwrites. See docs/kits-ownership.md.
 */

import { existsSync } from "node:fs"
import { join } from "node:path"

import {
  EXIT,
  crossCheckManifest,
  glyph,
  heading,
  loadKitsRegistry,
  loadManifest,
  parseArgs,
  resolveKitsRoot,
  runKitsCli,
} from "./lib/kits-runtime.mjs"

const { flags } = parseArgs(process.argv.slice(2))
const projectRoot =
  typeof flags.get("target") === "string" ? flags.get("target") : process.cwd()
const write = flags.get("write") === true

function fail(message, code = EXIT.INVALID) {
  heading("Prototype Factory · Kits Source Installation")
  process.stdout.write(`${glyph.bad} ${message}\n`)
  process.exit(code)
}

/* -- 1. Art Direction Gate ------------------------------------------------ */

const loaded = loadManifest(projectRoot, flags.get("manifest"))
if (!loaded.ok) fail(loaded.detail)

const manifest = loaded.manifest
heading("Prototype Factory · Kits Source Installation")
process.stdout.write(`${glyph.ok} manifest   ${loaded.path}\n`)
process.stdout.write(
  `  productType=${manifest.productType} · stylePack=${manifest.stylePack}\n` +
    `  signatureComponents=[${manifest.signatureComponents.join(", ") || "—"}] · effects=[${manifest.effects.join(", ") || "—"}]\n` +
    `  motionDirection=${manifest.motionDirection} · density=${manifest.density}\n` +
    `  avoid=[${manifest.avoid.join(", ")}]\n`,
)

/* -- 2. Locate Kits (required here — you cannot install from nothing) ----- */

const kits = resolveKitsRoot({
  explicit: typeof flags.get("kits") === "string" ? flags.get("kits") : undefined,
  projectRoot,
})
if (!kits) {
  fail(
    "找不到 Prototype Kits 仓库，无法安装。\n" +
      "  Source Installation 必须从一个 Kits checkout 出发（安装完成后就不再需要它了）。\n" +
      "  指定方式：`--kits ../prototype-kits`，或设置 KITS_ROOT。",
    EXIT.MISSING,
  )
}
process.stdout.write(`${glyph.ok} kits       ${kits.root}\n`)

/* -- 3. Refuse to install anything the registry has not approved ---------- */

const registry = loadKitsRegistry(kits.registry)
if (!registry.ok) fail(registry.detail, EXIT.MISSING)

const crossIssues = crossCheckManifest(manifest, registry)
if (crossIssues.length > 0) {
  process.stdout.write(`${glyph.bad} manifest 引用了 registry 里不存在或未批准的资产：\n`)
  for (const issue of crossIssues) {
    process.stdout.write(`    ${glyph.bad} [${issue.code}] ${issue.path} — ${issue.message}\n`)
  }
  process.exit(EXIT.INVALID)
}
process.stdout.write(
  `${glyph.ok} registry   ${registry.registryVersion} — 所有引用均为 approved 资产\n`,
)

/* -- 4. Build the `kits add` invocation from the manifest ----------------- */

const addArgs = ["add", "--target", projectRoot, "--kits", kits.root, "--style", manifest.stylePack]
if (manifest.signatureComponents.length > 0) {
  addArgs.push("--components", manifest.signatureComponents.join(","))
}
if (manifest.effects.length > 0) {
  addArgs.push("--effects", manifest.effects.join(","))
}

/* -- 5. Dry-run first. Always. ------------------------------------------- */

heading(write ? "1/2 · kits add" : "1/1 · kits add --dry-run")
if (!write) {
  addArgs.push("--dry-run")
} else {
  process.stdout.write(
    "  （先跑一次 --dry-run 看计划；确认后再加 --write。这里直接执行真实安装。）\n",
  )
}

const add = runKitsCli(kits.cli, addArgs, { dryRun: !write })
if (!add.ok) fail(`kits add 失败（exit ${add.status ?? "n/a"}）。`)

/* -- 6. Verify the lock, then doctor ------------------------------------- */

const lockPath = join(projectRoot, "lib", "kits", "kits.lock.json")

if (!write) {
  heading("计划（dry-run，未写入任何文件）")
  process.stdout.write(`${glyph.ok} kits add --dry-run 通过\n`)
  process.stdout.write(
    "\n确认无误后执行真实安装：\n  pnpm factory:kits --write\n",
  )
  process.exit(EXIT.OK)
}

if (!existsSync(lockPath)) {
  fail(
    `kits add 声称成功，但没有生成 lock：${lockPath}\n` +
      "  lock 是安装状态的唯一凭据，缺失即视为安装失败（不允许「看起来装上了」）。",
  )
}
process.stdout.write(`\n${glyph.ok} lock       ${lockPath}\n`)

heading("2/2 · kits doctor")
const doctor = runKitsCli(kits.cli, ["doctor", "--target", projectRoot, "--kits", kits.root])
if (!doctor.ok) {
  fail(
    "kits doctor 未通过。安装状态不可信，禁止在此状态下声称安装完成。\n" +
      "  doctor 的结论是正式质量门，不是建议。",
  )
}

/* -- 7. Ownership reminder — the rules that must survive this script ------ */

heading("Ownership contract（安装后生效）")
process.stdout.write(
  [
    `  ${glyph.ok} lib/kits/installed/     Kits-managed —— 重新安装会整体覆盖，禁止手工修改`,
    `  ${glyph.ok} lib/kits/.kits/         Kits-managed tooling`,
    `  ${glyph.ok} lib/kits/kits.lock.json Kits-managed state（安装状态的唯一凭据）`,
    `  ${glyph.ok} lib/kits/adapters/      Product-owned —— Kits 永不覆盖，手写集成放这里`,
    "",
    "  产品代码必须走 adapter，不得直接 import installed/*：",
    "    Product → adapters/ → installed/",
    "",
    "  升级 = 重新跑 `kits add`，不是手工 patch installed asset。",
    "  详见 docs/kits-ownership.md",
    "",
  ].join("\n"),
)
process.exit(EXIT.OK)
