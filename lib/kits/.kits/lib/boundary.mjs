/**
 * 边界检查 —— 产品代码不得直接 import 托管区。
 *
 * ===========================================================================
 * 为什么这条要单独做成一个检查
 * ===========================================================================
 * Kits 的整条 Distribution 设计只有一个承重点：
 *
 *     installed/（Kits 托管，重新安装会覆盖）
 *          ↓
 *     adapters/（产品托管，Kits 永不覆盖）
 *          ↓
 *     产品代码
 *
 * 产品代码只依赖 adapters/。这样升级 Kits 时托管区被覆盖，产品的引用面不动。
 *
 * 但如果产品代码直接 `import … from "../installed/cinematic/index"`，
 * 中间那一层就被绕过去了 —— 适配层退化成一个装饰品，升级时产品的 import
 * 路径全部失效。**而且它不会报错，只会让"升级很安全"这个承诺变成假的。**
 *
 * 第二次真实 Source Installation 正好发生了这件事：产品需要从 style pack 里
 * 取 motion 刻度去做 `motionToCssVars()`，而 v0.1.0 的安装器只给 style 生成了
 * CSS 缝、没有 TS 缝，产品**没有合规的路可走**，只好越界。
 *
 * 那次教训是双份的：
 *   1. 工具链没给合规的路，产品就会违规 → 补 TS 缝（K-04）；
 *   2. 越界必须被看见，否则下一次还会发生 → 这个检查（v0.1.1 §7）。
 *
 * ===========================================================================
 * 检查的范围
 * ===========================================================================
 *   - 扫描产品的源码文件（.ts/.tsx/.js/.jsx/.mjs/.css）
 *   - **不扫描** Kits 自己的托管区与 CLI 副本（installed/、.kits/）——
 *     从 adapters/ 与 .kits/ 指向 installed/ 是**设计如此**，不是违规
 *   - 跳过 node_modules / .next / dist / build / out / coverage
 *   - 只认 import / export … from / @import 里的说明符，不看注释与散文
 *     （复用 installer 的 scanSpecifiers，规则与安装器保持一致）
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { scanSpecifiers } from "./installer.mjs";
import { DEFAULT_LAYOUT } from "./lock.mjs";

/** 默认跳过：这些目录里的东西不是产品源码。 */
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  ".turbo",
  ".vercel",
  "dist",
  "build",
  "out",
  "coverage",
  ".cache",
]);

const SOURCE_EXT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|css)$/;

/**
 * 产品源码通常住在这里。
 *
 * 为什么需要它：一个"扫过 0 个文件、0 个违规"的检查，和一个"扫过 200 个文件、
 * 0 个违规"的检查，打印出来长得一模一样 —— 而前者什么都没检查。
 * 所以判定必须知道**范围根在哪**、**扫到几个文件**，见 boundaryVerdict()。
 */
export const PRODUCT_SOURCE_ROOTS = [
  "app",
  "src",
  "components",
  "lib",
  "pages",
  "hooks",
  "stores",
  "scripts",
];

/**
 * 读产品的路径别名（tsconfig.json 的 compilerOptions.paths）。
 *
 * 需要它是因为越界有两种写法：
 *   "../installed/cinematic/index"     ← 相对路径
 *   "@/lib/kits/installed/…"           ← 别名路径
 * 只查前者会漏掉后者，而后者在产品里更常见（Next 默认就是 @/*）。
 *
 * @returns {Array<{prefix:string, targets:string[]}>}
 */
export function readPathAliases(productRoot) {
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const file = path.join(productRoot, name);
    let raw;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    // tsconfig 允许注释与尾随逗号；Kits 的产物不用，简单剥离即可。
    const cleaned = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
      .replace(/,(\s*[}\]])/g, "$1");
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      continue;
    }
    const paths = parsed?.compilerOptions?.paths;
    if (!paths || typeof paths !== "object") continue;
    return Object.entries(paths)
      .filter(([key, value]) => key.endsWith("/*") && Array.isArray(value) && value.length)
      .map(([key, value]) => ({
        prefix: key.slice(0, -1), // "@/" 保留结尾斜杠
        targets: value.filter((v) => typeof v === "string"),
      }));
  }
  return [];
}

/**
 * 把一个说明符解析成"相对产品根的路径"（POSIX），解析不了就返回 null。
 *
 * @param {string} spec
 * @param {string} fromDir   发起 import 的文件所在目录（相对产品根，POSIX）
 * @param {Array<{prefix:string, targets:string[]}>} aliases
 */
export function resolveSpecifier(spec, fromDir, aliases) {
  if (spec.startsWith(".")) {
    const joined = path.posix.normalize(path.posix.join(fromDir, spec));
    return joined.startsWith("..") ? null : joined;
  }
  for (const alias of aliases) {
    if (!spec.startsWith(alias.prefix)) continue;
    const rest = spec.slice(alias.prefix.length);
    for (const target of alias.targets) {
      /*
       * tsconfig 的 paths 目标几乎总是带一个 `*`：
       *   "@/*": ["./*"]        → 产品根
       *   "@/*": ["./src/*"]    → src/
       * 把 `*` 替换成 rest 才是解析结果。**不能**只做字符串拼接 ——
       * `"./*"` 去掉开头的 `./` 之后只剩一个 `*`，直接拼接会得到一个
       * 以 `*` 开头的畸形路径，永远匹配不上托管区。
       * （第一次实现就踩了这个：别名越界被静默放过，靠兜底规则才补回来。）
       */
      const star = target.lastIndexOf("*");
      const joined = path.posix.normalize(
        star < 0 ? `${target}/${rest}` : `${target.slice(0, star)}${rest}`,
      );
      return joined.startsWith("..") ? null : joined;
    }
  }
  return null;
}

/** 判断一个已解析路径是否落在某个托管目录里。 */
function insideManaged(resolved, managedRoots) {
  return managedRoots.some(
    (root) => resolved === root || resolved.startsWith(`${root}/`),
  );
}

/**
 * 遍历产品源码。
 *
 * @param {string} root 产品根
 * @param {string[]} skipRoots 相对产品根、不扫描的目录
 */
function* walkSource(root, skipRoots) {
  const stack = [""];
  while (stack.length) {
    const relDir = stack.pop();
    const absDir = path.join(root, relDir);
    let entries;
    try {
      entries = readdirSync(absDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.startsWith(".") && entry !== ".") continue;
      if (SKIP_DIRS.has(entry)) continue;
      const rel = relDir ? `${relDir}/${entry}` : entry;
      if (skipRoots.some((m) => rel === m || rel.startsWith(`${m}/`))) continue;
      const abs = path.join(root, rel);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(rel);
      } else if (st.isFile() && SOURCE_EXT.test(entry)) {
        yield { rel, abs };
      }
    }
  }
}

/**
 * 找出产品源码里绕过适配层、直接引用托管区的说明符。
 *
 * v0.2：除 `violations` 与 `scanned` 之外还返回**范围证据**（`excluded` /
 * `roots`）。原因是这把检查接进 doctor 时，"扫到 0 个文件也算通过" 是一条
 * 正式的静默失败路径 —— 判定需要知道检查到底有没有发生，见 `boundaryVerdict()`。
 *
 * @param {{ productRoot: string, layout?: typeof DEFAULT_LAYOUT }} options
 * @returns {{
 *   violations: Array<{file:string, line:number|null, spec:string, reason:string, resolved:string|null}>,
 *   scanned: number,
 *   excluded: number,
 *   roots: { present: string[], missing: string[] },
 * }}
 */
export function findManagedImports({ productRoot, layout = DEFAULT_LAYOUT }) {
  const installedRoot = layout.installedRoot; // lib/kits/installed
  const agentRoot = layout.agentRoot; // lib/kits/.kits
  const adapterRoot = layout.adapterRoot; // lib/kits/adapters

  /*
   * 两份清单，不能合并 —— 它们的语义不同：
   *
   *   skipRoots       这些目录里的文件**不被扫描**。
   *                   adapters/ 在列表里：从适配层指向 installed/ 正是设计本身。
   *                   .kits/ 在列表里：installer 自己当然要读托管区。
   *
   *   forbiddenRoots  指向这些目录的引用**算越界**。
   *                   adapters/ 不在这里 —— 从产品代码 import adapters/ 才是对的。
   *
   * 把两者混在一起会造成两个方向的错误：要么漏报产品越界，
   * 要么把适配层自己的合法引用报成违规（v0.1.1 第一次实现就踩了后者）。
   */
  const skipRoots = [installedRoot, agentRoot, adapterRoot];
  const forbiddenRoots = [installedRoot, agentRoot];
  const aliases = readPathAliases(productRoot);

  const violations = [];
  let scanned = 0;

  for (const { rel, abs } of walkSource(productRoot, skipRoots)) {
    let content;
    try {
      content = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    scanned += 1;
    if (!content.includes("installed") && !content.includes("@kits/")) continue;

    const fromDir = path.posix.dirname(rel) === "." ? "" : path.posix.dirname(rel);
    for (const { spec } of scanSpecifiers(content)) {
      // 1. 裸包说明符：源码安装必须把它们全部重写成相对路径
      if (spec.startsWith("@kits/")) {
        violations.push({
          file: rel,
          line: lineOf(content, spec),
          spec,
          resolved: null,
          reason: "引用了 @kits/* 裸包说明符 —— 源码安装后产品不应再依赖 Kits 包",
        });
        continue;
      }
      // 2. 相对 / 别名路径落到托管区
      const resolved = resolveSpecifier(spec, fromDir, aliases);
      if (resolved && insideManaged(resolved, forbiddenRoots)) {
        violations.push({
          file: rel,
          line: lineOf(content, spec),
          spec,
          resolved,
          reason: `直接引用了托管区（${resolved}）—— 应从 adapters/ 引用`,
        });
        continue;
      }

      /*
       * 3. 兜底：说明符里**字面**含有托管区路径。
       *
       * 为什么需要这一条：别名解析依赖产品的 tsconfig.json。产品没有
       * tsconfig（或在里面用了别的别名）时，`@/lib/kits/installed/…`
       * 会解析不出来，于是越界被**静默放过** —— 这比误报更糟。
       * 布局路径是 Kits 自己定的，直接按文本匹配既准确又不依赖配置。
       */
      const literal = spec.replace(/^[@~][^/]*\//, "/");
      if (
        forbiddenRoots.some(
          (root) => literal === `/${root}` || literal.startsWith(`/${root}/`),
        )
      ) {
        violations.push({
          file: rel,
          line: lineOf(content, spec),
          spec,
          resolved: null,
          reason: `说明符字面指向托管区（${forbiddenRoots.find((r) => literal.startsWith(`/${r}`))}）—— 应从 adapters/ 引用`,
        });
      }
    }
  }

  const present = PRODUCT_SOURCE_ROOTS.filter((root) =>
    statIsDirectory(path.join(productRoot, root)),
  );

  return {
    violations,
    scanned,
    excluded: countSourceFiles(productRoot, skipRoots),
    roots: {
      present,
      missing: PRODUCT_SOURCE_ROOTS.filter((root) => !present.includes(root)),
    },
  };
}

/** 目录存在且是目录。 */
function statIsDirectory(abs) {
  try {
    return statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 统计被跳过的源码文件数（托管区 / 适配层里的 .ts/.tsx/.css …）。
 *
 * 它不是"违规"，而是让 doctor 能把范围说完整：扫了 N 个、跳过 M 个
 * （M 全部属于 `installed/`、`.kits/`、`adapters/`）。
 */
function countSourceFiles(root, relDirs) {
  let total = 0;
  for (const relDir of relDirs) {
    const abs = path.join(root, relDir);
    const stack = [abs];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const child = path.join(dir, entry);
        let st;
        try {
          st = statSync(child);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          if (SKIP_DIRS.has(entry)) continue;
          stack.push(child);
        } else if (st.isFile() && SOURCE_EXT.test(entry)) {
          total += 1;
        }
      }
    }
  }
  return total;
}

/**
 * 把一次扫描变成一个**可以负责的结论**。
 *
 * 判定顺序（顺序本身是契约）：
 *   1. Kits 没安装            → not-applicable（**不是** pass：没有托管区可越界，
 *                              这句话不是"检查通过"）
 *   2. 没有任何产品源码根      → fail（范围根缺失 = 检查没有发生）
 *   3. 有根、但扫到 0 个文件   → fail（0 个文件里发现 0 个违规 ≠ 通过）
 *   4. 有违规                  → fail
 *   5. 其余                    → pass（并且必须能说出 scanned / excluded）
 *
 * @param {{ productRoot: string, layout?: typeof DEFAULT_LAYOUT, scan: ReturnType<typeof findManagedImports>, installPresent: boolean }} args
 * @returns {{ status: "pass"|"fail"|"not-applicable", state: string|null, detail: string, hint: string|null, scanned: number, excluded: number, violations: any[] }}
 */
export function boundaryVerdict({ productRoot, layout = DEFAULT_LAYOUT, scan, installPresent }) {
  const counts = `扫过 ${scan.scanned} 个产品源文件 · 跳过 ${scan.excluded} 个（${layout.installedRoot}/、${layout.agentRoot}/、${layout.adapterRoot}/）`;

  if (!installPresent) {
    return {
      status: "not-applicable",
      state: "not-installed",
      detail: `not-installed：没有 ${layout.lockFile}，没有托管区可越界 —— 不适用（不是通过）`,
      hint: "先 `kits add` 安装资产；装好之后这条检查才会真的扫描。",
      scanned: scan.scanned,
      excluded: scan.excluded,
      violations: [],
    };
  }

  if (scan.roots.present.length === 0) {
    return {
      status: "fail",
      state: "vacuous-scan",
      detail: `检查没有发生：${productRoot} 下找不到任何产品源码根（${PRODUCT_SOURCE_ROOTS.join(" / ")}）`,
      hint: "范围根缺失不是「没有可检查的东西」，而是「检查没有执行」。确认 --target 指对了产品根。",
      scanned: scan.scanned,
      excluded: scan.excluded,
      violations: [],
    };
  }

  if (scan.scanned === 0) {
    return {
      status: "fail",
      state: "vacuous-scan",
      detail: `检查没有发生：扫描范围内 0 个产品源文件（0 个文件里发现 0 个违规 ≠ 通过）`,
      hint: "产品源码要么不在这些根下，要么扩展名不在扫描集合里。范围不完整时不允许判 PASS。",
      scanned: scan.scanned,
      excluded: scan.excluded,
      violations: [],
    };
  }

  if (scan.violations.length) {
    const shown = scan.violations
      .slice(0, 3)
      .map((v) => `${v.file}${v.line ? `:${v.line}` : ""} → ${v.spec}`)
      .join(" · ");
    return {
      status: "fail",
      state: null,
      detail: `${scan.violations.length} 处产品源码绕过适配层直接引用托管区（${counts}）`,
      hint: `从 adapters/ 走。Kits 托管区会被下次安装覆盖：${shown}`,
      scanned: scan.scanned,
      excluded: scan.excluded,
      violations: scan.violations,
    };
  }

  return {
    status: "pass",
    state: null,
    detail: `没有绕过适配层的引用（${counts}）`,
    hint: null,
    scanned: scan.scanned,
    excluded: scan.excluded,
    violations: [],
  };
}

/** 找到某个说明符在文件里第一次出现的行号（1 起）。 */
function lineOf(content, spec) {
  const needle = `"${spec}"`;
  const single = `'${spec}'`;
  let index = content.indexOf(needle);
  if (index < 0) index = content.indexOf(single);
  if (index < 0) return null;
  return content.slice(0, index).split("\n").length;
}
