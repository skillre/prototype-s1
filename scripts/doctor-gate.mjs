#!/usr/bin/env node
/**
 * Kits doctor gate.
 *
 * WHAT THIS IS — AND WHAT IT DELIBERATELY IS NOT
 * ----------------------------------------------
 * It **calls** `kits doctor`. It does not re-implement it.
 *
 * This distinction is the whole design. `kits doctor` owns the authoritative
 * checks — managed-file integrity against the lock, the adapter/installed
 * boundary scan, React compatibility. Factory v1.1 must not grow a second,
 * slightly-different copy of those rules: two implementations of an ownership
 * rule is two sources of truth, and the weaker one always wins because it is the
 * one that reports green.
 *
 * So this script's entire job is: decide whether a check is applicable, invoke
 * the real one, and translate its outcome into an exit code — while being
 * honest about what it could not verify.
 *
 * Three outcomes, deliberately distinct
 * -------------------------------------
 *   not-installed          no `lib/kits/` in this project. A prototype that uses
 *                          no Kits assets is a supported state, not a failure.
 *                          Exit 0, and it says so instead of implying a pass.
 *   verified               install present + Kits reachable → real doctor run.
 *   upstream-unavailable   install present but the Kits checkout is gone (the
 *                          normal state of an independently delivered product).
 *                          Managed-file integrity still runs from the lock; the
 *                          upstream comparison is explicitly reported as NOT
 *                          done rather than assumed to be fine.
 *
 * Usage: `pnpm qa:doctor [--kits ../prototype-kits]`
 */

import { existsSync } from "node:fs"
import { join } from "node:path"

import {
  EXIT,
  glyph,
  heading,
  parseArgs,
  resolveKitsRoot,
  runKitsCli,
} from "./lib/kits-runtime.mjs"

const { flags } = parseArgs(process.argv.slice(2))
const projectRoot = process.cwd()

const installedRoot = join(projectRoot, "lib", "kits", "installed")
const lockPath = join(projectRoot, "lib", "kits", "kits.lock.json")
const installedCli = join(projectRoot, "lib", "kits", ".kits", "kits.mjs")

heading("Prototype Factory · Kits doctor gate")

/* -- Not installed: a supported state ------------------------------------- */

if (!existsSync(installedRoot) && !existsSync(lockPath)) {
  process.stdout.write(
    `${glyph.ok} [not-installed] 本项目没有 Kits 安装（lib/kits/ 不存在）。\n` +
      "  这是一个受支持的状态：不使用任何 Kits 资产的原型不需要安装。\n" +
      "  此时没有可体检的托管文件，因此**没有执行任何联网/上游比对**，本行不代表“通过”。\n" +
      "  需要安装：先写 visual-manifest.json，再跑 `pnpm factory:kits --write`。\n",
  )
  process.exit(EXIT.OK)
}

/* -- Installed: the lock is the source of truth ---------------------------- */

if (!existsSync(lockPath)) {
  process.stdout.write(
    `${glyph.bad} lib/kits/installed/ 存在但没有 lock：${lockPath}\n` +
      "  lock 是安装状态的唯一凭据。缺失即视为安装损坏——不能凭“文件都在”就认为装好了。\n" +
      "  修复：重新跑 `pnpm factory:kits --write`（禁止手工补 lock）。\n",
  )
  process.exit(EXIT.INVALID)
}
process.stdout.write(`${glyph.ok} lock       ${lockPath}\n`)

if (!existsSync(installedCli)) {
  process.stdout.write(
    `${glyph.bad} 找不到已安装的 Kits CLI：${installedCli}\n` +
      "  Installer 自身也是 Kits 托管资产。缺失说明安装不完整。\n" +
      "  修复：重新跑 `pnpm factory:kits --write`。\n",
  )
  process.exit(EXIT.INVALID)
}

/* -- Invoke the real doctor ------------------------------------------------ */

const kits = resolveKitsRoot({
  explicit: typeof flags.get("kits") === "string" ? flags.get("kits") : undefined,
  projectRoot,
})

if (!kits) {
  process.stdout.write(
    `${glyph.warn} upstream-kits [upstream-unavailable] 未找到 Kits 仓库（独立交付后的正常状态）。\n` +
      "              → doctor 仍会校验托管文件与 lock 的一致性；\n" +
      "                但**不会与上游比对**版本/资产，这一点不会被当作通过条件。\n" +
      "              → 想比对：`--kits ../prototype-kits` 或设置 KITS_ROOT。\n",
  )
}

// 用的是**产品内**那份 CLI（lib/kits/.kits/kits.mjs），因为体检对象是产品的安装状态；
// 上游只在可以比对时作为 --kits 传入。
const doctorArgs = ["doctor", "--target", projectRoot]
if (kits) doctorArgs.push("--kits", kits.root)

const result = runKitsCli(installedCli, doctorArgs, { dryRun: false })

process.stdout.write("\n")
if (!result.ok) {
  process.stdout.write(
    `${glyph.bad} doctor 未通过（exit ${result.status ?? "n/a"}）。\n` +
      "  doctor 是正式质量门，不是建议：安装状态不可信时，禁止声称安装完成 / 交付完成。\n",
  )
  process.exit(EXIT.INVALID)
}

process.stdout.write(
  `${glyph.ok} doctor 通过${kits ? " [verified]" : " [upstream-unavailable]"}。\n`,
)
process.exit(EXIT.OK)
