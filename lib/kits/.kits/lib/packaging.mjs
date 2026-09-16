/**
 * 打包与完整性。
 *
 * 两件事：
 *   1. `resolvePackageSpecifier` —— 把裸包说明符（`@kits/contracts`）解析成
 *      包内的真实文件。**读包的 exports 映射**，不猜目录约定。
 *   2. checksum —— 安装清单里每个文件的内容哈希，`kits doctor` 用它发现
 *      「Kits 托管区被手工改过」以及「上游资产变了」。
 */

import { createHash } from "node:crypto";
import { readFileSync, existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { CODES, fail } from "./errors.mjs";

/** 内容哈希：sha256 前 16 位十六进制（够碰撞抵抗，且人能读）。 */
export function hashContent(buffer) {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

export function hashFile(file) {
  return hashContent(readFileSync(file));
}

/**
 * 用 Node 自己的解析器读 package.json（不跟随 pnpm 的 symlink 语义之外的猜测）。
 * @param {string} dir 包目录
 */
export function readPackageManifest(dir) {
  const file = path.join(dir, "package.json");
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * 把一个 exports 目标（可以是 string / array / 条件对象）拍平成一个相对路径。
 * 只接受字符串与条件对象里的 import/default/require —— Kits 是源码分发，
 * 不存在多层条件解析的需求。
 */
function pickExportTarget(target) {
  if (typeof target === "string") return target;
  if (Array.isArray(target)) {
    for (const entry of target) {
      const picked = pickExportTarget(entry);
      if (picked) return picked;
    }
    return null;
  }
  if (target && typeof target === "object") {
    // 源码分发：优先 import，其次 default，最后 require
    for (const key of ["import", "default", "require", "types"]) {
      if (key in target) {
        const picked = pickExportTarget(target[key]);
        if (picked) return picked;
      }
    }
  }
  return null;
}

/**
 * 解析 `exports`：支持 "." 子路径与通配（`"./*": "./src/*.ts"`）。
 * 返回包内**相对路径**（以 ./ 开头）或 null。
 */
export function resolveExportPath(pkgDir, subpath) {
  const manifest = readPackageManifest(pkgDir);
  if (!manifest?.exports) return null;

  const exportsField = manifest.exports;
  const key = subpath === "" || subpath === "." ? "." : `./${subpath}`;

  // 形式 A：exports 是条件对象本身（只有 "." 入口）
  if (
    typeof exportsField === "object" &&
    !Array.isArray(exportsField) &&
    !Object.keys(exportsField).some((k) => k.startsWith("."))
  ) {
    return key === "." ? pickExportTarget(exportsField) : null;
  }

  if (typeof exportsField === "string") {
    return key === "." ? exportsField : null;
  }

  if (key in exportsField) return pickExportTarget(exportsField[key]);

  // 通配子路径："./*" 或 "./prefix/*"
  const entries = Object.keys(exportsField).filter(
    (k) => k.includes("*") && k !== ".",
  );
  for (const pattern of entries) {
    const [prefix, suffix = ""] = pattern.split("*");
    if (key.startsWith(prefix) && key.endsWith(suffix)) {
      const middle = key.slice(prefix.length, key.length - suffix.length);
      const target = pickExportTarget(exportsField[pattern]);
      if (target) return target.replace("*", middle);
    }
  }
  return null;
}

/**
 * 把裸包说明符解析成「Kits 仓库内的绝对文件路径 + 包元信息」。
 *
 * @param {string} kitsRoot
 * @param {string} specifier 例如 "@kits/contracts" 或 "@kits/style-cinematic/tokens.css"
 * @param {Map<string, {id:string, dir:string, dest:string}>} byPackageName
 */
export function resolvePackageSpecifier(kitsRoot, specifier, byPackageName) {
  for (const [name, info] of byPackageName) {
    if (specifier === name || specifier.startsWith(`${name}/`)) {
      const subpath = specifier === name ? "" : specifier.slice(name.length + 1);
      const rel = resolveExportPath(info.dir, subpath);
      if (!rel) {
        fail(
          CODES.DEPENDENCY_UNRESOLVED,
          `${name} 没有导出子路径「${subpath || "."}」`,
          `包在 ${path.relative(kitsRoot, info.dir)}；请把它加入该包的 exports。`,
        );
      }
      const abs = path.join(info.dir, rel.replace(/^\.\//, ""));
      if (!existsSync(abs)) {
        fail(
          CODES.DEPENDENCY_UNRESOLVED,
          `${name} 的 exports 指向了不存在的文件：${rel}`,
        );
      }
      return { packageName: name, packageInfo: info, file: realpathSync(abs), subpath };
    }
  }
  return null;
}

/** 把绝对路径转成 POSIX 风格（清单里跨平台可读）。 */
export const toPosix = (p) => p.split(path.sep).join("/");
