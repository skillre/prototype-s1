/**
 * Kits 适配层 · evidence-chip · 由 `kits add` 生成（v0.1.0）
 *
 * ===========================================================================
 * 这个文件属于**产品**，不属于 Kits。
 * ===========================================================================
 *
 *   lib/kits/installed/   Kits 托管区 —— 重新安装会覆盖，产品只读
 *   lib/kits/adapters/    ← 你在这里 —— Kits 永不覆盖这个目录
 *
 * 产品代码有两种合规写法：
 *
 *   1. 角色文件（推荐，v0.2 起）—— 产品代码不出现资产 id：
 *        lib/kits/adapters/<角色>.tsx   ← 你写，一行 re-export
 *          export { <本文件导出的名字> as <角色名> } from "./evidence-chip"
 *        然后产品代码 import 那个**角色文件**。
 *        换资产只改这一行，产品代码零改动。见 adapters/seam/README.md。
 *
 *   2. 直接用本文件（v0.1.x 的做法）：import … from "@/lib/kits/adapters/evidence-chip"
 *      —— 这条路仍然有效，但资产名会出现在产品代码里，换资产要改所有调用点。
 *
 * 两种写法都**不要**直接 import 托管区。这样 Kits 升级时产品的引用面不动。
 *
 * 想改行为（换实现、覆盖品牌色、加自己的降级）就在本文件里改 ——
 * `kits add` 不会覆盖它，`kits doctor` 也不会把它算作「被改动的托管文件」。
 *
 * 注意 import 路径**不带扩展名**：Kits 源码内部用具名扩展名（workspace 的
 * 源码分发一直开着 allowImportingTsExtensions），但那不该成为产品的要求。
 * 安装器在写盘时会把 .ts / .tsx 剥掉，因此产品不需要改任何 tsconfig。
 */

"use client";
/* 组件源码自己引入它的结构样式，因此产品不需要单独 import CSS。 */

export {
  EvidenceChip,
  EvidenceChip as default,
  type EvidenceChipProps,
} from "../installed/evidence-chip/index";
