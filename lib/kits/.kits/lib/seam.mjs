/**
 * 中性适配接缝（neutral adapter seam）—— Kits v0.2 · K4。
 *
 * ===========================================================================
 * 它解决的那个问题
 * ===========================================================================
 * v0.1.1 的适配层只生成**资产名文件**：`data-cursor.tsx` / `insight-reveal.tsx` /
 * `style-instrument.ts`。于是产品要 import 就得在源码里写出资产名：
 *
 *     import { DataCursor } from "@/lib/kits/adapters/data-cursor"
 *
 * 那句话把「这个产品用哪一个 Kits 资产」焊进了产品代码。换一个指针实现
 * （或换一套风格）时，产品不是改一行配置，而是改每一个调用点 ——
 * 而 Kits 契约承诺的恰恰是「升级/替换不动产品代码」。
 *
 * 唯一的例外是 `style-pack.ts`：Kits 早就在做「稳定别名 → 资产名文件」
 * 这件事，只是只做了一格（主 Style Pack）。K4 把这个机制**正式化**：
 * 让产品可以面向稳定语义入口，而不是具体资产身份。
 *
 * ===========================================================================
 * Kits 在这里**不做**什么（这条边界比做什么更重要）
 * ===========================================================================
 * 哪个组件在产品里承担什么语义角色，是**产品决策**，不是 Kits 能推断的事实。
 * 现有 metadata 里没有任何机器可读的 role / capability / adapterRole 字段
 * —— `components/<id>/manifest.json` 的 `adapter` 是一段**政策说明**
 * （required / reason / swapInThirdParty），不是角色名；
 * `effects/manifest.json` 只有 `class` 与 `pack`；registry 也没有角色字段。
 *
 * 所以 Kits **不从文件名猜角色**（`data-cursor` → "pointer"？那是猜），
 * 也不替产品写映射。它生成的是：
 *
 *     adapters/seam/           ← 机制与状态（本模块负责生成）
 *       README.md               doctrine + 绑定方法
 *       seam.json               **产品声明**：角色 → 资产 id
 *       _template.ts            复制-改名-填一行的模板
 *     adapters/<角色>.ts(x)     ← 产品自己建的角色文件（产品所有，Kits 永不覆盖）
 *
 * 于是三件事同时成立：
 *   1. 产品代码可以只 import `@/lib/kits/adapters/pointer`，不出现资产 id；
 *   2. 换资产时改的是**产品自己的角色文件**里那一行，产品代码零改动；
 *   3. 绑定状态是**可检查的**：`seam.json` 的声明与 `adapters/` 下的角色文件
 *      双向核对，`kits doctor` 会把缺口说出来 —— 而不是静默当作通过。
 *
 * ===========================================================================
 * 所有权
 * ===========================================================================
 * `adapters/**` 整体属于**产品**（installer 只在文件不存在时生成，永不覆盖）。
 * seam 的三件产物也一样：Kits scaffolding 一次，之后归产品。
 * 因此它们**不进** `kits.lock.json` 的 `files[]`（那是 Kits 托管区的 checksum 清单），
 * doctor 也不把它们当成托管文件来核对 —— 它们被**单独**检查（见 evaluateSeam）。
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { adapterFilesFor, expectedAdapterFiles } from "./adapters.mjs";
import { DEFAULT_LAYOUT } from "./lock.mjs";

/** seam 产物自身的版本。跟着模板一起演进；写进 seam.json 供 doctor 迁移判断。 */
export const SEAM_VERSION = "0.2.0";

/** seam 目录（相对 adapterRoot）。 */
export const SEAM_DIR = "seam";

/** 角色文件的扩展名集合。产品写 .ts 或 .tsx 都算。 */
const ROLE_EXT = [".ts", ".tsx"];

const seamRel = (name) => `${SEAM_DIR}/${name}`;

/**
 * 每个已安装资产对应的**资产名适配文件**（相对 adapterRoot）。
 *
 * 复用 `adapterFilesFor()` —— 生成器与 seam 必须对"哪个文件承载哪个资产"
 * 有同一个答案，否则模板里的相对路径会在某些资产上指向不存在的文件。
 *
 * @param {any[]} assets
 * @param {{ isPrimaryStyle?: boolean }} [options]
 * @returns {Map<string, string>} asset id → adapter relPath（不含 adapterRoot）
 */
export function seamAdapters(assets, options = {}) {
  const primaryStyleId = assets.find((a) => a.type === "style")?.id ?? null;
  const map = new Map();
  for (const asset of assets) {
    const files = adapterFilesFor(asset, {
      isPrimaryStyle: asset.id === primaryStyleId || options.isPrimaryStyle === true,
      effectMeta: options.effectMeta,
    });
    // TS / TSX 缝才是可 import 的入口；CSS 缝（style-*.css / effect-*.css）不是。
    const ts = files.find(
      (f) => f.relPath.endsWith(".ts") || f.relPath.endsWith(".tsx"),
    );
    if (ts) map.set(asset.id, ts.relPath);
  }
  return map;
}

/** seam 目录下应由 `kits add` 生成的文件（相对 adapterRoot）。 */
export function expectedSeamFiles() {
  return [seamRel("README.md"), seamRel("seam.json"), seamRel("_template.ts")];
}

/* -------------------------------------------------------------------------- */
/* 生成                                                                       */
/* -------------------------------------------------------------------------- */

const README = `# adapters/seam/ —— 中性适配接缝

这个目录属于**产品**，不属于 Kits。\`kits add\` 只在文件不存在时生成，**永不覆盖**。

## 为什么需要它

\`lib/kits/adapters/<资产名>.tsx\` 这类文件**里面**可以出现资产 id（这一层的工作
就是把它翻译成产品稳定名），但**产品代码**不应该出现：

\`\`\`
产品代码  →  角色文件（你写，稳定的名字）  →  资产适配文件（Kits 生成）  →  installed/
\`\`\`

直接写 \`import { DataCursor } from "@/lib/kits/adapters/data-cursor"\` 的问题是：
换一个指针实现时，你要改的是**每一个调用点**，而不是一行。

## 怎么绑定（三步）

1. 在 \`seam.json\` 的 \`bindings\` 里声明角色 → 资产 id：

   \`\`\`json
   { "seamVersion": "${SEAM_VERSION}", "bindings": { "pointer": "data-cursor" } }
   \`\`\`

2. 复制 \`_template.ts\`，改名为角色名（例如 \`pointer.tsx\`），把里面那一行
   换成真实导出：

   \`\`\`tsx
   export { DataCursor as Pointer, type DataCursorProps as PointerProps } from "../data-cursor"
   \`\`\`

3. 产品代码只 import 角色文件：

   \`\`\`tsx
   import { Pointer } from "@/lib/kits/adapters/pointer"
   \`\`\`

换资产 = 改这两处，**产品代码不动**。

## Kits 为什么替你选不了角色

哪个组件在你的产品里承担「指针」「结构」「数据」这些语义，是**产品决策**。
Kits 的 metadata 里没有角色字段（\`manifest.adapter\` 是一段政策说明，不是角色名），
所以 Kits 不从文件名猜 —— \`data-cursor\` 是不是「pointer」由你说了算。

Kits 能保证的是**机制可检查**：\`kits doctor\` 会把

- 声明了绑定、却没有对应角色文件
- 有角色文件、却没有声明绑定
- 绑定指向的资产不在本次安装里

三种情况分别报出来。声明与实现在两个方向上都不允许静默缺席。
`;

const template = `/**
 * Kits v0.2 · 中性角色文件模板（\`adapters/seam/_template.ts\`）
 *
 * 用法：把这个文件**复制**成你的角色名，例如 adapters/pointer.tsx，
 * 然后按下面两步填空。不要直接 import 本文件。
 *
 * 它属于**产品**：Kits 只在文件不存在时生成，永不覆盖。
 */

// 第 1 步 · 在 ../seam/seam.json 的 bindings 里声明角色 → 资产 id：
//
//   { "seamVersion": "${SEAM_VERSION}", "bindings": { "<角色名>": "<资产 id>" } }
//
// 资产 id 从哪来：看同目录下的资产适配文件（例如 ../data-cursor.tsx 对应
// 资产 id "data-cursor"），或跑 \`kits doctor\`，它会把本次安装里可绑定的资产列出来。

// 第 2 步 · 把下面这行换成真实导出（去掉注释），相对路径指向资产适配文件：
//
//   export {
//     <资产导出的组件名> as <角色名>,
//     type <资产导出的 Props> as <角色名 Props>,
//   } from "../<资产适配文件名>"
//
// 例（资产是 data-cursor、角色是 pointer）：
//
//   export { DataCursor as Pointer, type DataCursorProps as PointerProps } from "../data-cursor"

export {};
`;

/**
 * seam 的初始产物（内容，不落盘）。
 *
 * @param {{ layout?: typeof DEFAULT_LAYOUT }} [options]
 * @returns {Array<{relPath: string, content: string}>} relPath 相对 adapterRoot
 */
export function seamScaffold(options = {}) {
  const layout = options.layout ?? DEFAULT_LAYOUT;
  const state = {
    seamVersion: SEAM_VERSION,
    generatedBy: "kits add",
    adapterRoot: layout.adapterRoot,
    bindings: {},
    notes: [
      "bindings 的键是你选的语义角色名（pointer / structure / data / style …），值是本次安装里的 asset id。",
      "Kits 不替你决定哪个资产承担哪个角色 —— 这是产品决策，不是可以推断的事实。",
      "绑定之后，在 adapters/ 下建一个同名角色文件（见 _template.ts），产品代码只 import 那个文件。",
      "声明与实现双向核对：kits doctor 会报出「声明无文件」「文件无声明」「绑定指向不在本次安装里的资产」三种缺口。",
    ],
  };
  return [
    { relPath: seamRel("README.md"), content: README },
    { relPath: seamRel("seam.json"), content: `${JSON.stringify(state, null, 2)}\n` },
    { relPath: seamRel("_template.ts"), content: template },
  ];
}

/* -------------------------------------------------------------------------- */
/* 读取与判定                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 读产品的 seam 声明。文件不存在（v0.1.1 装的）不是错误，是**迁移状态**。
 *
 * @returns {{ present: boolean, readable: boolean, version: string|null, bindings: Record<string,string>, error: string|null, file: string }}
 */
export function readSeamState({ productRoot, layout = DEFAULT_LAYOUT }) {
  const file = path.join(productRoot, layout.adapterRoot, seamRel("seam.json"));
  if (!existsSync(file)) {
    return { present: false, readable: false, version: null, bindings: {}, error: null, file };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return {
      present: true,
      readable: false,
      version: null,
      bindings: {},
      error: error.message,
      file,
    };
  }
  const bindings = {};
  if (parsed?.bindings && typeof parsed.bindings === "object" && !Array.isArray(parsed.bindings)) {
    for (const [role, asset] of Object.entries(parsed.bindings)) {
      if (typeof asset === "string" && asset.trim()) bindings[role] = asset.trim();
    }
  }
  return {
    present: true,
    readable: true,
    version: typeof parsed?.seamVersion === "string" ? parsed.seamVersion : null,
    bindings,
    error: null,
    file,
  };
}

/**
 * `adapters/` 下的**产品自有**角色文件。
 *
 * 定义：adapterRoot 下**直接**的文件里，既不是 Kits 生成的适配文件
 * （`expectedAdapterFiles`），也不是 seam 目录内容，且扩展名是 .ts/.tsx 的。
 * 这就是「产品自己写的稳定语义入口」—— 也被 `kits doctor` 用来做双向核对。
 *
 * @returns {string[]} 相对 adapterRoot 的文件名（含扩展名，已排序）
 */
export function findRoleFiles({ productRoot, layout = DEFAULT_LAYOUT, assets = [] }) {
  const adapterRootAbs = path.join(productRoot, layout.adapterRoot);
  let entries;
  try {
    entries = readdirSync(adapterRootAbs);
  } catch {
    return [];
  }
  // Kits 本次生成的适配文件不算角色文件：它们由 installer 管理（只在缺失时补），
  // 也就是 Tier 2 的"资产名那一侧"。
  const generated = new Set(expectedAdapterFiles(assets));
  const roles = [];
  for (const entry of entries) {
    if (!ROLE_EXT.some((ext) => entry.endsWith(ext))) continue;
    if (generated.has(entry)) continue;
    const abs = path.join(adapterRootAbs, entry);
    try {
      if (!statSync(abs).isFile()) continue;
    } catch {
      continue;
    }
    roles.push(entry);
  }
  return roles.sort();
}

/** 角色文件 → 角色名：`pointer.tsx` → `pointer`。 */
export function roleNameOf(fileName) {
  for (const ext of ROLE_EXT) {
    if (fileName.endsWith(ext)) return fileName.slice(0, -ext.length);
  }
  return fileName;
}

/**
 * 判定 seam 的状态。这是 K4 的**判据**，不是建议。
 *
 * 三种缺口都要说出来（声明 ↔ 实现双向核对）：
 *   - binding 指向的资产**不在本次安装**里  → fail：安装已经无法兑现这条声明
 *   - 声明了绑定但**没有角色文件**           → warn：产品还没写完，模板就是那个 TODO
 *   - 有角色文件但**没有声明**               → warn：实现存在、声明缺席（下一个读者看不出它绑给谁）
 *   - 角色文件**覆盖了 Kits 生成的文件名**   → fail：那会让 `kits add` 的产物与产品文件同名
 *
 * `kits 未安装`（没有 lock）时返回 not-applicable —— 不适用**不等于**通过。
 *
 * @param {{ productRoot: string, layout?: typeof DEFAULT_LAYOUT, lock: any|null }} args
 */
export function evaluateSeam({ productRoot, layout = DEFAULT_LAYOUT, lock }) {
  if (!lock) {
    return {
      status: "not-applicable",
      reason: "not-installed：没有安装清单，没有接缝可核对",
      present: false,
      read: false,
      version: null,
      bound: [],
      unbound: [],
      dangling: [],
      declaredWithoutFile: [],
      fileWithoutDeclaration: [],
      nameCollisions: [],
      roleFiles: [],
      candidates: [],
    };
  }

  const assets = lock.assets ?? [];
  const state = readSeamState({ productRoot, layout });
  const known = new Set(assets.map((a) => a.id));
  const roleFiles = findRoleFiles({ productRoot, layout, assets });

  /*
   * seam 目录里的三个产物由 `kits add` 在**缺失时**生成。产品可以删掉任何
   * 一个（它们是产品所有的）—— 但 doctor 必须说得出来少了什么，
   * 否则"我删了模板"和"这套装本来就没有模板"看起来一样。
   */
  const expectedFiles = expectedSeamFiles();
  const filesMissing = expectedFiles.filter(
    (rel) => !existsSync(path.join(productRoot, layout.adapterRoot, rel)),
  );

  const roles = Object.keys(state.bindings);
  const bound = [];
  const dangling = [];
  for (const role of roles) {
    if (known.has(state.bindings[role])) bound.push(role);
    else dangling.push({ role, asset: state.bindings[role] });
  }

  const roleNames = new Set(roleFiles.map(roleNameOf));
  const declaredWithoutFile = bound.filter((role) => !roleNames.has(role));
  const fileWithoutDeclaration = [...roleNames].filter((role) => !roles.includes(role)).sort();

  /*
   * 角色名撞上 Kits 生成的文件名。
   *
   * 这不是洁癖：`adapters/data-cursor.tsx` 是生成文件，产品再写一个同名角色文件
   * 等于把它覆盖成产品自有文件（`findRoleFiles` 会把它当生成物排除），
   * 于是"声明 → 文件"这一对永远对不上，而产品也没有别的办法把它修好 ——
   * 只能换角色名。所以这里 fail，并且把两种名字都打出来。
   */
  const generatedRoleNames = new Set(expectedAdapterFiles(assets).map(roleNameOf));
  const nameCollisions = roles.filter((role) => generatedRoleNames.has(role));

  let status = "pass";
  let reason = null;
  if (!state.present) {
    status = "warn";
    reason =
      "没有 adapters/seam/ —— 这是 v0.1.1 风格的安装。重跑 `kits add` 会补上 seam scaffold（缺失才生成，不动你已改过的适配层）。";
  } else if (!state.readable) {
    status = "fail";
    reason = `adapters/seam/seam.json 不是合法 JSON：${state.error}`;
  } else if (dangling.length) {
    status = "fail";
    reason = `${dangling.length} 条绑定指向不在本次安装里的资产：${dangling
      .map((d) => `${d.role} → ${d.asset}`)
      .join(" · ")}`;
  } else if (nameCollisions.length) {
    status = "fail";
    reason = `角色名与资产 id 同名（${nameCollisions.join(", ")}）：角色文件会和 Kits 生成的文件撞名，换一个角色名。`;
  } else if (declaredWithoutFile.length || fileWithoutDeclaration.length) {
    status = "warn";
    reason = [
      declaredWithoutFile.length
        ? `声明了绑定但还没有角色文件：${declaredWithoutFile.join(", ")}`
        : null,
      fileWithoutDeclaration.length
        ? `有角色文件但 seam.json 里没有声明：${fileWithoutDeclaration.join(", ")}` +
          "（可能是上一次安装留下的生成文件 —— 删掉它，或把它声明成一个角色）"
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
  } else if (filesMissing.length) {
    status = "warn";
    reason = `seam 目录里少了 ${filesMissing.length} 个产物：${filesMissing.join(", ")}（重跑 \`kits add\` 会补）`;
  }

  return {
    status,
    reason,
    present: state.present,
    read: state.readable,
    version: state.version,
    bound: bound.sort(),
    unbound: state.readable ? [] : [],
    dangling,
    declaredWithoutFile,
    fileWithoutDeclaration,
    nameCollisions,
    roleFiles,
    filesMissing,
    candidates: assets.map((a) => ({ type: a.type, id: a.id })),
  };
}
