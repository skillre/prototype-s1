/**
 * 适配层生成。
 *
 * ---------------------------------------------------------------------------
 * 两个目录，两种所有权
 * ---------------------------------------------------------------------------
 *   installed/   Kits 托管区。属于 Kits，会被重新安装覆盖；产品只读。
 *   adapters/    产品托管区。属于产品，**Kits 永不覆盖**。
 *
 * 这条边界是 Kits 契约里那句「产品只被允许依赖内部稳定 API」的落地方式：
 * 产品 import 的是 adapters/，不是 installed/。
 * 于是升级 Kits（覆盖 installed/）不会碰到产品写的任何一行；
 * 而产品要换实现、加品牌色覆盖、改降级策略，都在 adapters/ 里做。
 *
 * ---------------------------------------------------------------------------
 * 生成器的行为
 * ---------------------------------------------------------------------------
 *   - 文件**不存在** → 生成
 *   - 文件已存在   → 跳过，并报告「保留产品版本」
 *   - 永不覆盖，永不删除
 *
 * 这是 Installer Rules 的第 5 条（不覆盖未知人工修改）在适配层上的体现。
 *
 * ---------------------------------------------------------------------------
 * 三类资产，三条缝（v0.1.1 补齐）
 * ---------------------------------------------------------------------------
 *                        CSS 缝                  TS 缝
 *   style pack      style-<id>.css          style-<id>.ts + style-pack.ts
 *   component       （组件自己 import）      <id>.tsx
 *   effect          effect-<id>.css         effect-<id>.ts
 *
 * v0.1.0 只给 style 生成了 CSS 缝，没有 TS 缝。后果在第二次真实 Source
 * Installation 里立刻显形：产品想拿 `cinematicMotion` 去做
 * `motionToCssVars()`，而 CSS 缝里没有 TS 出口，于是它只能
 *     import … from "../installed/cinematic/index"
 * —— 直接越过适配层去读托管区。契约说"产品不得依赖托管区"，但工具链没给
 * 合规的路，产品就只好违规。**K-04 修的是这个：把缝补上。**
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_LAYOUT } from "./lock.mjs";

/**
 * 适配层模板的版本。它跟着 Kits 版本走，写进 lock，用来让 `kits doctor`
 * 在**离线/独立**状态下也能发现「你的适配层是旧模板生成的」——
 * 那是它唯一能拿到的信号（standalone 下重新生成需要 Kits 仓库，做不到）。
 */
export const ADAPTER_TEMPLATE_VERSION = "0.2.0";

const BANNER = (assetId, version) => `/**
 * Kits 适配层 · ${assetId} · 由 \`kits add\` 生成（v${version}）
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
 *          export { <本文件导出的名字> as <角色名> } from "./${assetId}"
 *        然后产品代码 import 那个**角色文件**。
 *        换资产只改这一行，产品代码零改动。见 adapters/seam/README.md。
 *
 *   2. 直接用本文件（v0.1.x 的做法）：import … from "@/lib/kits/adapters/${assetId}"
 *      —— 这条路仍然有效，但资产名会出现在产品代码里，换资产要改所有调用点。
 *
 * 两种写法都**不要**直接 import 托管区。这样 Kits 升级时产品的引用面不动。
 *
 * 想改行为（换实现、覆盖品牌色、加自己的降级）就在本文件里改 ——
 * \`kits add\` 不会覆盖它，\`kits doctor\` 也不会把它算作「被改动的托管文件」。
 *
 * 注意 import 路径**不带扩展名**：Kits 源码内部用具名扩展名（workspace 的
 * 源码分发一直开着 allowImportingTsExtensions），但那不该成为产品的要求。
 * 安装器在写盘时会把 .ts / .tsx 剥掉，因此产品不需要改任何 tsconfig。
 */

`;

/**
 * 同一条边界，写给 CSS 缝。
 *
 * `extraLines` 拼在注释**内部**。这一点必须由生成器保证 —— v0.1.1 第一次
 * 实现把补充说明写在函数返回之后，于是注释早早闭合、正文落在注释外面，
 * 生成出一段语法错误的 CSS（PostCSS 报 "Unexpected end of input"，
 * 而且直到 standalone build 才炸出来）。所有拼接都留在函数里就不会再发生。
 */
const cssBanner = (assetId, version, kind, extraLines = []) => {
  const body = [
    `/* Kits 适配层 · ${kind} ${assetId} · v${version}`,
    " *",
    " * 这个文件属于**产品**。Kits 重新安装不会覆盖它。",
    ...(extraLines.length ? [" *", ...extraLines.map((l) => ` * ${l}`)] : []),
    " */",
  ];
  return body.join("\n");
};

/* -------------------------------------------------------------------------- */
/* 变量名 → 对象键                                                             */
/* -------------------------------------------------------------------------- */

/**
 * 求一组变量名的最长公共**段**前缀（以 `-` 分段，含结尾的 `-`）。
 *
 * 用公共前缀而不是"按 id 拼字面量"，是因为变量命名空间与资产 id 并不总是
 * 一致：资产 id 是 `ambient-glow`，而变量是 `--kits-effect-ambient-*`
 * （拼成 --kits-effect-ambient-glow-primary 会把 glow 说两遍）。
 * 从名字本身推前缀，规则只有一条，也不会因为改名而漂移。
 *
 * @param {string[]} names
 */
export function commonVariablePrefix(names) {
  if (names.length === 0) return "";
  const split = names.map((n) => n.split("-"));
  let depth = 0;
  for (;;) {
    const segment = split[0][depth];
    if (segment === undefined) break;
    const allMatch = split.every(
      // i === length-1 保证前缀永远吃不掉整个名字
      (parts) => parts[depth] === segment && depth < parts.length - 1,
    );
    if (!allMatch) break;
    depth += 1;
  }
  return depth === 0 ? "" : `${split[0].slice(0, depth).join("-")}-`;
}

/** `primary-falloff` → `primaryFalloff` */
function camel(key) {
  return key.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/**
 * 把变量名列表变成 `{ primaryFalloff: "--kits-effect-ambient-primary-falloff" }`
 * 这样的键值表。剩下的键为空时回退成 `value`（只有一个变量时会出现）。
 *
 * @param {string[]} names
 */
export function variableKeyMap(names) {
  const prefix = commonVariablePrefix(names);
  /** @type {Record<string,string>} */
  const map = {};
  for (const name of names) {
    const rest = name.slice(prefix.length);
    const key = camel(rest) || "value";
    map[key] = name;
  }
  return map;
}

/* -------------------------------------------------------------------------- */
/* 效果元信息                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 从 Kits 仓库读效果清单，取出生成 TS 缝需要的东西（类名 / 修饰类 / 公开变量）。
 *
 * TS 缝需要**字面量**而不是运行时 import：效果是纯 CSS，托管区里没有可
 * import 的模块。所以这里在生成时把清单里的数据烘焙进适配层。
 *
 * @param {string} kitsRoot
 * @param {any[]} assets
 * @returns {Map<string, {class?:string, modifiers:Record<string,string>, variables:string[]}>}
 */
export function loadEffectMetadata(kitsRoot, assets) {
  const effects = assets.filter((a) => a.type === "effect");
  const result = new Map();
  if (effects.length === 0) return result;

  const manifestRel = effects.find((a) => a.manifest)?.manifest ?? "effects/manifest.json";
  const manifestFile = path.join(kitsRoot, manifestRel);
  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  } catch {
    // 清单读不到不是致命错误：TS 缝会退化成只导出 id。
    return result;
  }

  for (const effect of manifest.effects ?? []) {
    result.set(effect.id, {
      class: effect.class,
      modifiers: effect.modifiers ?? {},
      variables: (effect.variables ?? []).map((v) => v.name).filter(Boolean),
    });
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* 各类型的缝                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 生成某资产的适配层内容。返回 [{ relPath, content }]
 *
 * @param {any} asset registry 条目
 * @param {{ isPrimaryStyle?: boolean, effectMeta?: Map<string, any> }} [options]
 */
export function adapterFilesFor(asset, options = {}) {
  // 从 adapters/ 到 installed/<id> 的相对路径
  const up = "../installed/";
  const base = `${up}${asset.id}`;
  const files = [];

  if (asset.type === "style") {
    files.push({
      relPath: `style-${asset.id}.css`,
      content: `${cssBanner(asset.id, asset.version, "Style Pack", [
        "引入顺序很重要：契约（含中立兜底值）在前，pack 在后。",
        "pack 自己的 tokens.css 已经 @import 了 @kits/contracts 的目标 ——",
        "安装时那条说明符已被重写成托管区内的相对路径，因此这里只需要引 pack。",
      ])}
@import "${base}/tokens.css";

/* 想覆盖品牌色，在这里写（只允许覆盖颜色）：
 *
 * [data-kits-pack="${asset.id}"] {
 *   --kits-color-accent: #your-brand;
 *   --kits-color-accent-ink: #ffffff;
 *   --kits-color-glow: rgb(... / 0.5);
 * }
 *
 * 排版 / 间距 / 密度 / 圆角 / 边界 / 动效一律不要覆盖 ——
 * 那是 pack 的身份，改掉之后就不再是这套风格了。需要不同性格请换 pack。
 */
`,
    });

    const names = styleExportNames(asset.id);
    files.push({
      relPath: `style-${asset.id}.ts`,
      content: `${BANNER(asset.id, asset.version)}import {
  ${names.motion},
  ${names.profile},
  ${names.meta},
} from "${base}/index";
import { motionToCssVars } from "${up}contracts/index";

/**
 * Style Pack 的 TS 缝 —— 产品的**唯一**入口。
 *
 * 这一层的存在意义：产品需要 pack 的动效刻度去把 CSS 变量注入 <html>，
 * 而这件事在 v0.1.0 只能靠 \`import … from "../installed/…"\` 完成 ——
 * 那越过了适配层。现在产品只 import 这里。
 *
 * \`motionToCssVars\` 来自**正式安装的契约层**（installed/contracts），
 * 不是这里手写的映射表。曾经有一版产品把 13 行变量映射抄进自己代码，
 * Kits 改名变量时它不会报错，只会静默失效。
 */
export const stylePackId = "${asset.id}" as const;

/** pack 的动效刻度（TS 形态）。改它不会影响视觉，视觉走下面的 CSS 变量。 */
export const stylePackMotion = ${names.motion};

/**
 * 注入 <html style={…}> 的 CSS 变量表。
 * 这是契约层编译器的输出，不是手抄的映射。
 */
export const stylePackMotionVars: Record<string, string> =
  motionToCssVars(stylePackMotion);

/** pack 的视觉性格画像（十个维度）。 */
export const stylePackProfile = ${names.profile};

/** pack 的元信息：id / name / selector / cssEntry。 */
export const stylePackMeta = ${names.meta};

/** 声明 pack 作用域要用的选择器（等价于 \`[data-kits-pack="${asset.id}"]\`）。 */
export const stylePackSelector = stylePackMeta.selector;
`,
    });

    /*
     * 稳定名字的别名缝。产品代码 import 的是它，因此**换 pack 时产品代码不动**：
     * 改一行 re-export 即可（这个文件属于产品，kits add 不会覆盖）。
     * 只有主 pack（--style 的第一个）会生成它。
     */
    if (options.isPrimaryStyle) {
      files.push({
        relPath: "style-pack.ts",
        content: `${BANNER("style-pack", asset.version)}/**
 * 当前 pack 的稳定入口 —— 产品代码 import 的是**这个路径**。
 *
 * 它只是 \`style-${asset.id}.ts\` 的别名，因此换 pack 时产品代码不用改：
 * 把下面这一行换成另一个 \`style-<id>\` 即可。
 *
 * 为什么要有别名：产品关心的是"当前用哪套风格"（一个产品语义），
 * 而不是"cinematic 这个资产"（一个具体实现）。直接 import
 * \`style-cinematic\` 会把资产名焊进产品代码，换风格就要全量改引用。
 *
 * 注意：本文件属于**产品**，Kits 永不覆盖它。因此换 pack 之后
 * \`kits add --style <新 pack>\` 只会**新建** \`style-<新 pack>.ts\`，
 * 不会替你改这一行 —— 这是刻意的，见 README 的「适配层所有权」一节。
 */
export * from "./style-${asset.id}";
`,
      });
    }
  }

  if (asset.type === "effect") {
    const entry = (asset.entry ?? "").split("/").pop() ?? "index.css";
    files.push({
      relPath: `effect-${asset.id}.css`,
      content: `${cssBanner(asset.id, asset.version, "Effect")}
@import "${base}/${entry}";
`,
    });

    const meta = options.effectMeta?.get(asset.id) ?? {
      class: undefined,
      modifiers: {},
      variables: [],
    };
    files.push({
      relPath: `effect-${asset.id}.ts`,
      content: `${BANNER(asset.id, asset.version)}/**
 * Effect 的 TS 缝。
 *
 * 效果是纯 CSS，托管区里没有可 import 的模块 —— 所以这里导出的是**标识符**
 * （类名与公开变量名），而不是实现。作用只有一个：让产品不必在 JSX / TS 里
 * 硬编码 Kits 的类名字符串，也不必硬编码变量名字符串。
 *
 * ⚠️ 变量名是**生成时**从 effects/manifest.json 烘焙进来的快照。
 * 升级 Kits 之后如果 Kits 改了变量名，这个文件不会自动更新
 * （它属于产品，installer 不覆盖）—— \`kits doctor\` 会提示模板已过期。
 */

/** 效果 id（与 registry / effects/manifest.json 一致）。 */
export const effectId = "${asset.id}" as const;

/** 容器类名。 */
export const effectClass = ${meta.class ? `"${meta.class}" as const` : "undefined"};

/**
 * 修饰类：显式开启可选行为。
 * ${
   Object.keys(meta.modifiers).length
     ? Object.entries(meta.modifiers)
         .map(([k, v]) => `*   ${k} → ${v}`)
         .join("\n * ")
     : "* 本效果没有修饰类。"
 }
 */
export const effectModifiers = ${JSON.stringify(meta.modifiers, null, 2)} as const;

/**
 * 公开变量名（Effect Contract）。产品只 override 这些，不碰效果内部的
 * 渐变实现。每个变量的默认值与含义见 effects/README.md。
 */
export const effectVars = ${JSON.stringify(variableKeyMap(meta.variables), null, 2)} as const;
`,
    });
  }

  if (asset.type === "component") {
    const name = asset.name ?? asset.id;
    files.push({
      relPath: `${asset.id}.tsx`,
      content: `${BANNER(asset.id, asset.version)}"use client";
/* 组件源码自己引入它的结构样式，因此产品不需要单独 import CSS。 */

export {
  ${name},
  ${name} as default,
  type ${name}Props,
} from "${base}/index";
`,
    });
  }

  return files;
}

/**
 * Style Pack 的导出名。约定：`<id>Motion` / `<id>Profile` / `<id>Meta`
 * —— 三个 pack 的 index.ts 都提供这三个名字（tests/adapter-seam.spec.ts 核对）。
 */
export function styleExportNames(id) {
  const stem = id
    .split("-")
    .map((s, i) => (i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)))
    .join("");
  return {
    motion: `${stem}Motion`,
    profile: `${stem}Profile`,
    meta: `${stem}Meta`,
  };
}

/**
 * 生成 adapters/index.ts 桶文件 + README。
 * 桶文件同样遵守「已存在则保留」。
 */
export function adapterScaffold() {
  return [
    {
      relPath: "README.md",
      content: `# adapters/ —— 产品托管区

这个目录属于**产品**，不属于 Kits。

\`\`\`
lib/kits/
├── installed/         Kits 托管区（只读，重新安装会覆盖）
├── adapters/          ← 你在这里（Kits 永不覆盖）
└── kits.lock.json     安装清单（Kits 托管）
\`\`\`

## 为什么要有这一层

Kits 的契约规定：**产品代码不得直接依赖组件 API**，因为组件实现随时
可能被替换。链路是：

\`\`\`
installed/（Kits 托管） → adapters/（你的稳定 API） → 产品代码
\`\`\`

产品只 import \`@/lib/kits/adapters/<asset>\`。升级 Kits 时托管区被覆盖，
而你的适配层与调用方一行不改。

## 三类资产、三条缝

| 资产类型 | CSS 缝 | TS 缝 |
|---|---|---|
| Style Pack | \`style-<id>.css\` | \`style-<id>.ts\` + \`style-pack.ts\`（主 pack 的稳定别名） |
| Signature Component | （组件自己 import） | \`<id>.tsx\` |
| Effect | \`effect-<id>.css\` | \`effect-<id>.ts\` |

产品代码**不要** import \`lib/kits/installed/*\`。\`kits doctor\` 会扫描产品
源码并对越界引用直接报 fail（安装器 / CLI 自身除外）。

## 你可以在这里做什么

- 覆盖品牌色（只允许颜色，见 \`style-*.css\` 里的注释）
- 覆盖效果的公开变量（见 \`effect-*.ts\` 的 \`effectVars\`）
- 把组件包成自己的产品语义（例如 \`<RunwayStage tone="brand" />\`）
- 强制关闭动效、替换实现、加测试友好的 testid

## 不要做什么

- 不要直接 import \`../installed/\`（那是托管区，会被覆盖）
- 不要把 Kits 的源码复制进这个目录（用 \`kits add\` 安装到 installed/）

## 重新生成

\`kits add\` 只在文件**不存在**时生成适配层。删掉某个文件再跑一次即可重新生成，
但你已经改过的文件永远不会被覆盖。

由此带来一个后果：**模板升级不会自动流到已存在的适配层**。
\`kits doctor\` 会把这件事报成 warn（\`adapters-template\`），并告诉你
"删掉该文件再跑 kits add 可以拿到新模板" —— 它不会替你覆盖。
`,
    },
  ];
}

/**
 * 一次安装**应当**生成的适配层文件清单（相对 adapters/）。
 *
 * doctor 与测试都用它，避免"生成器加了一条缝、检查清单忘了同步"这类漂移。
 * 注意它只看**路径**，不看内容 —— 内容由 emit 的「已存在则保留」决定。
 *
 * @param {any[]} assets
 */
export function expectedAdapterFiles(assets) {
  const primaryStyleId = assets.find((a) => a.type === "style")?.id ?? null;
  return [
    ...assets.flatMap((asset) =>
      adapterFilesFor(asset, { isPrimaryStyle: asset.id === primaryStyleId }).map(
        (file) => file.relPath,
      ),
    ),
    ...adapterScaffold().map((file) => file.relPath),
  ].sort();
}

/**
 * 把适配层写入产品。
 *
 * @returns {{ written: string[], kept: string[], templateVersion: string }}
 */
export function writeAdapters({
  productRoot,
  layout = DEFAULT_LAYOUT,
  assets,
  kitsRoot = null,
}) {
  const adapterRoot = path.join(productRoot, layout.adapterRoot);
  mkdirSync(adapterRoot, { recursive: true });

  const written = [];
  const kept = [];

  const emit = (relPath, content) => {
    const abs = path.join(adapterRoot, relPath);
    if (existsSync(abs)) {
      kept.push(`${layout.adapterRoot}/${relPath}`);
      return;
    }
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
    written.push(`${layout.adapterRoot}/${relPath}`);
  };

  const effectMeta = kitsRoot ? loadEffectMetadata(kitsRoot, assets) : new Map();
  const primaryStyleId = assets.find((a) => a.type === "style")?.id ?? null;

  for (const asset of assets) {
    for (const file of adapterFilesFor(asset, {
      isPrimaryStyle: asset.id === primaryStyleId,
      effectMeta,
    })) {
      emit(file.relPath, file.content);
    }
  }
  for (const file of adapterScaffold()) {
    emit(file.relPath, file.content);
  }

  return { written, kept, templateVersion: ADAPTER_TEMPLATE_VERSION };
}
