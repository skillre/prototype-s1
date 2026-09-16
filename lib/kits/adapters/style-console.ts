/**
 * Kits 适配层 · console · 由 `kits add` 生成（v0.2.0）
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
 *          export { <本文件导出的名字> as <角色名> } from "./console"
 *        然后产品代码 import 那个**角色文件**。
 *        换资产只改这一行，产品代码零改动。见 adapters/seam/README.md。
 *
 *   2. 直接用本文件（v0.1.x 的做法）：import … from "@/lib/kits/adapters/console"
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

import {
  consoleMotion,
  consoleProfile,
  consoleMeta,
} from "../installed/console/index";
import { motionToCssVars } from "../installed/contracts/index";

/**
 * Style Pack 的 TS 缝 —— 产品的**唯一**入口。
 *
 * 这一层的存在意义：产品需要 pack 的动效刻度去把 CSS 变量注入 <html>，
 * 而这件事在 v0.1.0 只能靠 `import … from "../installed/…"` 完成 ——
 * 那越过了适配层。现在产品只 import 这里。
 *
 * `motionToCssVars` 来自**正式安装的契约层**（installed/contracts），
 * 不是这里手写的映射表。曾经有一版产品把 13 行变量映射抄进自己代码，
 * Kits 改名变量时它不会报错，只会静默失效。
 */
export const stylePackId = "console" as const;

/** pack 的动效刻度（TS 形态）。改它不会影响视觉，视觉走下面的 CSS 变量。 */
export const stylePackMotion = consoleMotion;

/**
 * 注入 <html style={…}> 的 CSS 变量表。
 * 这是契约层编译器的输出，不是手抄的映射。
 */
export const stylePackMotionVars: Record<string, string> =
  motionToCssVars(stylePackMotion);

/** pack 的视觉性格画像（十个维度）。 */
export const stylePackProfile = consoleProfile;

/** pack 的元信息：id / name / selector / cssEntry。 */
export const stylePackMeta = consoleMeta;

/** 声明 pack 作用域要用的选择器（等价于 `[data-kits-pack="console"]`）。 */
export const stylePackSelector = stylePackMeta.selector;
