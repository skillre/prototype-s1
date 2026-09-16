#!/usr/bin/env node
/**
 * Prototype Kits · Installer CLI
 *
 * ===========================================================================
 * 两种模式，不要混淆
 * ===========================================================================
 *
 * **Delivery Mode（正式交付）—— 本文件的模式：源码安装**
 *
 *   pnpm kits add --target ../my-prototype --style cinematic --components …
 *
 *   资产被**复制进产品**，说明符被重写成相对路径，产品的 package.json 不变。
 *   装完之后 Kits 仓库可以不存在 —— 产品照样 install / typecheck / build。
 *   代价：升级需要重新跑 add（Kits 升级不会自动流到产品）。
 *
 * **Development Mode（Kits 开发 / 实验）—— 不使用本文件**
 *
 *   在产品里写 `link:../prototype-kits/<pkg>` + Next 的
 *   transpilePackages / externalDir / turbopack.root。
 *   优点：改 Kits 立刻生效，适合改资产本身、做 Style Migration 调查。
 *   代价：产品与 Kits 的目录结构、React 类型版本强耦合，不能作为交付方案。
 *   见 docs/integration.md「Development Mode」一节。
 *
 * ===========================================================================
 * 命令
 * ===========================================================================
 *
 *   kits add    正式安装资产（唯一的写操作；其余命令都是只读）
 *   kits list   查看 registry 里的可用 / 已批准资产
 *   kits doctor 体检：React 兼容性 / 托管文件完整性 / lock / 缺依赖
 *   kits diff   比较已安装版本与当前 Kits 的差异
 *
 * 设计约束：
 *   - 零运行时依赖（只用 node: 内置模块）—— 它必须能在裸产品里跑
 *   - `--dry-run` 对每个命令都有意义
 *   - 出错时给出可执行的下一步，而不是堆栈
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CODES, KitsError } from "./lib/errors.mjs";
import { loadRegistry, isInstallableType } from "./lib/registry.mjs";
import { plan, apply, verify } from "./lib/installer.mjs";
import {
  auditCompatibility,
  describeUpstream,
  SUPPORTED_REACT_RANGE,
} from "./lib/compat.mjs";
import { DEFAULT_LAYOUT, readLock, writeLock, buildLock } from "./lib/lock.mjs";
import {
  writeAdapters,
  expectedAdapterFiles,
  ADAPTER_TEMPLATE_VERSION,
} from "./lib/adapters.mjs";
import { findManagedImports, boundaryVerdict } from "./lib/boundary.mjs";
import {
  SEAM_VERSION,
  SEAM_DIR,
  evaluateSeam,
  seamScaffold,
} from "./lib/seam.mjs";

/* -------------------------------------------------------------------------- */
/* 参数解析                                                                    */
/* -------------------------------------------------------------------------- */

const COMMANDS = new Set(["add", "list", "doctor", "diff", "help", "--help", "-h"]);

function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token.startsWith("--")) {
      const [key, inline] = token.slice(2).split("=");
      if (inline !== undefined) {
        flags[key] = inline;
      } else if (rest[i + 1] && !rest[i + 1].startsWith("--")) {
        flags[key] = rest[i + 1];
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(token);
    }
  }
  return { command, flags, positional };
}

const splitList = (value) =>
  String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** 把 --kits=id 形式的 style 参数归一化成数组。 */
const styleIds = (value) => splitList(value);

/* -------------------------------------------------------------------------- */
/* 输出                                                                        */
/* -------------------------------------------------------------------------- */

const c = {
  dim: (s) => `\u001b[2m${s}\u001b[0m`,
  bold: (s) => `\u001b[1m${s}\u001b[0m`,
  green: (s) => `\u001b[32m${s}\u001b[0m`,
  red: (s) => `\u001b[31m${s}\u001b[0m`,
  yellow: (s) => `\u001b[33m${s}\u001b[0m`,
  cyan: (s) => `\u001b[36m${s}\u001b[0m`,
};

/*
 * 状态四态而不是三态：v0.2 起有 `na`（不适用）。
 * 「不适用」既不是通过也不是失败 —— 一个"没有托管区可越界"的检查被判成 pass，
 * 就是 K5 要消灭的那种静默通过。K-03 的 state 列同理，但那是另一根轴。
 */
const MARK = {
  pass: c.green("✓"),
  warn: c.yellow("!"),
  fail: c.red("✗"),
  na: c.dim("–"),
};

function header(title) {
  console.log(`\n${c.bold(title)}`);
}

/* -------------------------------------------------------------------------- */
/* 路径工具                                                                    */
/* -------------------------------------------------------------------------- */

/** 找到产品根（含 package.json 的目录）。 */
function resolveTarget(target) {
  const root = path.resolve(target);
  if (!existsSync(path.join(root, "package.json"))) {
    throw new KitsError(
      CODES.TARGET_NOT_A_PACKAGE,
      `目标目录里没有 package.json：${root}`,
      "`--target` 必须指向一个 Node 项目根。",
    );
  }
  return root;
}

/**
 * 找到 Kits 仓库根。
 * CLI 自身可能被安装在产品里（lib/kits/.kits/），那种情况下 --kits 必须显式给。
 */
function resolveKitsRoot(flags) {
  if (flags.kits) return path.resolve(String(flags.kits));
  // 默认：CLI 位于 <kits>/packages/cli/kits.mjs
  const here = path.dirname(fileURLToPath(import.meta.url));
  const guess = path.resolve(here, "../..");
  if (existsSync(path.join(guess, "registry", "assets.json"))) return guess;
  throw new KitsError(
    CODES.REGISTRY_MISSING,
    "找不到 Kits 仓库根",
    "用 `--kits /path/to/prototype-kits` 显式指定。",
  );
}

/** 读 Kits 当前 git commit（用于 lock 的可追溯性）。 */
function readKitsCommit(kitsRoot) {
  try {
    const { execFileSync } = require_node_child_process();
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: kitsRoot,
      encoding: "utf8",
    }).trim();
    const dirty =
      execFileSync("git", ["status", "--porcelain"], { cwd: kitsRoot, encoding: "utf8" }).trim()
        .length > 0;
    return { commit: head, dirty };
  } catch {
    return { commit: null, dirty: false };
  }
}

// 延迟引入 child_process：只有读 commit 时才需要它，
// 而 `kits doctor` 在无 git 的环境里也必须能跑。
import * as childProcessModule from "node:child_process";
function require_node_child_process() {
  return childProcessModule;
}

/** Kits 侧的 @types/react 版本（用于兼容性比对）。 */
function readKitsTypesVersion(kitsRoot) {
  const candidates = [
    path.join(kitsRoot, "node_modules/@types/react/package.json"),
    path.join(kitsRoot, "playground/node_modules/@types/react/package.json"),
  ];
  for (const file of candidates) {
    if (existsSync(file)) {
      try {
        return JSON.parse(readFileSync(file, "utf8")).version ?? null;
      } catch {
        /* 继续 */
      }
    }
  }
  return null;
}

/**
 * 一次性判定"上游是否可读"，并把理由带回来。
 *
 * doctor 需要区分三件事（v0.1.1 修 K-03）：
 *   1. 读到了上游的 @types/react  → 可以做真正的同 major 比对（verified）
 *   2. 找不到 Kits 仓库但库内声明可读 → 只能按声明区间判定（compatible）
 *   3. 两者都没有 → 明确报"无法判定"，**不许**静默通过
 */
function probeUpstream({ flags, discovered }) {
  const kitsRoot = flags.kits ? path.resolve(String(flags.kits)) : discovered;
  const exists = kitsRoot ? existsSync(path.join(kitsRoot, "registry", "assets.json")) : false;
  const version = exists ? readKitsTypesVersion(kitsRoot) : null;
  const described = describeUpstream({
    kitsRoot: exists ? kitsRoot : null,
    kitsTypesVersion: version,
    discovered: exists,
  });
  return { ...described, kitsRoot: exists ? kitsRoot : null, kitsTypesVersion: version };
}

const majorOf = (v) => {
  const m = String(v ?? "").match(/(\d+)/);
  return m ? Number(m[1]) : null;
};

/* -------------------------------------------------------------------------- */
/* kits list                                                                  */
/* -------------------------------------------------------------------------- */

function cmdList({ flags }) {
  const kitsRoot = resolveKitsRoot(flags);
  const { registry, assetsById } = loadRegistry(kitsRoot);

  const showAll = Boolean(flags.all);
  const rows = [...assetsById.values()].filter(
    (a) => showAll || (isInstallableType(a.type) && a.status === "approved"),
  );

  header(`Prototype Kits · ${registry.registryVersion ?? "v0.1"} · ${path.relative(process.cwd(), kitsRoot) || "."}`);
  console.log(
    c.dim(
      showAll
        ? "全部资产（含未批准）"
        : "已批准且可源码安装（status=approved，type ∈ style/component/effect/package）",
    ),
  );
  console.log();

  const byType = new Map();
  for (const a of rows) {
    if (!byType.has(a.type)) byType.set(a.type, []);
    byType.get(a.type).push(a);
  }

  for (const [type, list] of [...byType.entries()].sort()) {
    console.log(c.bold(`  ${type}`));
    for (const a of list.sort((x, y) => x.id.localeCompare(y.id))) {
      const status = a.status === "approved" ? c.green("approved") : c.yellow(a.status);
      const deps = (a.dependencies ?? []).length ? c.dim(` → ${a.dependencies.map((d) => (typeof d === "string" ? d : d.id)).join(", ")}`) : "";
      console.log(`    ${a.id.padEnd(22)} ${String(a.version).padEnd(8)} ${status}${deps}`);
    }
    console.log();
  }

  if (!showAll) {
    const hidden = [...assetsById.values()].filter(
      (a) => !isInstallableType(a.type) || a.status !== "approved",
    );
    if (hidden.length) {
      console.log(c.dim(`  （另有 ${hidden.length} 项未列出：未批准或非文件资产 —— 用 --all 查看）`));
    }
  }
  console.log();
  console.log(c.dim("  安装：kits add --target <产品根> --style <id> --components <id,id> [--effects <id>]"));
}

/* -------------------------------------------------------------------------- */
/* kits add                                                                   */
/* -------------------------------------------------------------------------- */

function cmdAdd({ flags }) {
  const target = flags.target;
  if (!target) {
    throw new KitsError(CODES.BAD_USAGE, "缺少 --target", "例：kits add --target ../my-prototype --style cinematic --components animated-grid");
  }

  const kitsRoot = resolveKitsRoot(flags);
  const productRoot = resolveTarget(target);
  const dryRun = Boolean(flags["dry-run"]);
  const layout = { ...DEFAULT_LAYOUT };

  const styles = styleIds(flags.style);
  const components = splitList(flags.components);
  const effects = splitList(flags.effects);
  const explicit = splitList(flags.assets);

  /*
   * `cli` 是每次安装的隐式依赖：装完之后产品要能自己跑 `kits doctor` /
   * `kits diff`，而这要求 Installer 存在于产品里（而不是存在于 Kits 仓库里）。
   * 这正是"删掉 Kits 仓库产品仍能工作"的一部分。
   */
  const requested = [...styles, ...components, ...effects, ...explicit, "cli"];
  if (requested.length === 0) {
    throw new KitsError(
      CODES.BAD_USAGE,
      "没有指定任何资产",
      "用 --style / --components / --effects，或 --assets 直接给 id。",
    );
  }

  // --- 兼容性门禁（在动磁盘之前） -----------------------------------------
  const kitsTypesVersion = readKitsTypesVersion(kitsRoot);
  const compat = auditCompatibility(productRoot, {
    kitsReactTypesVersion: kitsTypesVersion,
    kitsTypesMajor: majorOf(kitsTypesVersion),
    supportedReactRange: SUPPORTED_REACT_RANGE,
    rangeSource: "Kits 当前版本声明的 peer 区间",
    // 安装时尚未写 lock，因此还不知道最终会装哪些组件 —— 传 null 表示"未知"，
    // 让 react-types-major-parity 走正常的比对分支而不是 not-applicable。
    installedComponents: null,
  });
  if (!compat.ok) {
    const failed = compat.checks.filter((x) => x.status === "fail");
    throw new KitsError(
      CODES.REACT_INCOMPATIBLE,
      `目标项目与本版 Kits 不兼容：\n${failed.map((f) => `  · ${f.id}: ${f.detail}`).join("\n")}`,
      failed.map((f) => (f.hint ? `  → ${f.hint}` : "")).filter(Boolean).join("\n"),
    );
  }

  // --- 计划（纯计算，不碰磁盘） -------------------------------------------
  const { registry, assetsById } = loadRegistry(kitsRoot);
  const installPlan = plan({ kitsRoot, assetsById, ids: requested });

  header(`kits add ${dryRun ? c.yellow("(dry-run)") : ""}`);
  console.log(`  kits     ${c.dim(kitsRoot)}`);
  console.log(`  target   ${c.dim(productRoot)}`);
  console.log();

  console.log(c.bold(`  解析出 ${installPlan.assets.length} 个资产（含依赖）：`));
  for (const a of installPlan.assets) {
    const direct = requested.includes(a.id) ? "" : c.dim("  ← 依赖");
    console.log(`    ${a.type.padEnd(10)} ${a.id.padEnd(22)} ${a.version}${direct}`);
  }
  console.log();

  const existing = readLock(productRoot, layout);
  if (existing) {
    header("  与已安装版本比较");
    const before = new Map(existing.assets.map((a) => [a.id, a.version]));
    for (const a of installPlan.assets) {
      const prev = before.get(a.id);
      if (!prev) console.log(`    ${c.green("+ 新增")} ${a.id} ${a.version}`);
      else if (prev !== a.version) console.log(`    ${c.yellow("~ 升级")} ${a.id} ${prev} → ${a.version}`);
      else console.log(`    ${c.dim("= 不变")} ${a.id} ${a.version}`);
    }
    for (const [id] of before) {
      if (!installPlan.assets.some((a) => a.id === id)) {
        console.log(`    ${c.red("- 移除")} ${id} ${c.dim("（不再本次安装计划里）")}`);
      }
    }
    console.log();
  }

  console.log(c.bold(`  将要写入 ${installPlan.files.length} 个文件：`));
  for (const f of installPlan.files) {
    console.log(`    ${c.dim("+")} ${f.dest}`);
  }
  console.log();

  if (dryRun) {
    console.log(c.yellow("  dry-run：没有写入任何文件。去掉 --dry-run 执行安装。"));
    return { code: 0 };
  }

  // --- 写入 ---------------------------------------------------------------
  let lock = null;
  /*
   * 中性接缝（v0.2 · K4）与托管区走**同一个事务**：
   * 它们是产品所有的文件（已存在则保留、永不覆盖），但"新建的那几个"必须
   * 跟着这次事务回滚 —— 否则一次中途失败会留下半套 skeleton，
   * 而下次 `kits add` 会因为文件已存在而永远不去补全它。
   */
  const seamFiles = seamScaffold({ layout }).map((file) => ({
    relPath: path.posix.join(layout.adapterRoot, file.relPath),
    content: file.content,
  }));
  const applied = apply({
    plan: installPlan,
    productRoot,
    layout,
    extras: seamFiles,
    onWritten: (written) => {
      lock = buildLock({
        plan: installPlan,
        registry,
        source: readKitsCommit(kitsRoot),
        layout,
        installedAt: new Date().toISOString(),
        written,
        compat: {
          declaredReactRange: SUPPORTED_REACT_RANGE,
          kitsTypesVersion,
        },
      });
      writeLock(productRoot, layout, lock);
    },
  });

  const adapterResult = writeAdapters({
    productRoot,
    layout,
    assets: installPlan.assets,
    kitsRoot,
  });

  /*
   * 适配层的结果要写回 lock：doctor 在**独立**状态下（Kits 仓库不存在）
   * 无法重新生成适配层来比对，只能靠这两个字段判断"模板是不是旧版本的"。
   */
  lock.adapters = {
    templateVersion: adapterResult.templateVersion,
    written: adapterResult.written,
    kept: adapterResult.kept,
  };

  /*
   * 中性接缝同样是**产品所有**：写进 lock 只是为了 doctor 能区分
   * 「v0.1.1 装的、还没有接缝」与「有了但被删了」。它不在 files[] 里 ——
   * files[] 是托管区 checksum 清单，接缝不属于托管区。
   */
  lock.seam = {
    version: SEAM_VERSION,
    file: `${layout.adapterRoot}/${SEAM_DIR}/seam.json`,
    written: applied.extrasWritten,
    kept: applied.extrasKept,
  };
  writeLock(productRoot, layout, lock);

  header("  写入完成");
  console.log(`    Kits 托管区   ${c.dim(`${layout.installedRoot}/`)}  ${installPlan.files.length} 个文件`);
  console.log(`    安装清单      ${c.dim(layout.lockFile)}`);
  console.log(`    适配层        ${c.dim(`${layout.adapterRoot}/`)}  ${adapterResult.written.length} 新建 / ${adapterResult.kept.length} 保留产品版本`);
  console.log(
    `    中性接缝      ${c.dim(`${layout.adapterRoot}/${SEAM_DIR}/`)}  ${applied.extrasWritten.length} 新建 / ${applied.extrasKept.length} 保留产品版本`,
  );
  console.log();

  if (adapterResult.kept.length) {
    console.log(c.dim("  保留（已存在，Kits 不覆盖产品文件）："));
    for (const f of adapterResult.kept) console.log(c.dim(`    · ${f}`));
    console.log();
  }

  console.log(c.bold("  下一步"));
  const styleAdapter = styles.length ? `${layout.adapterRoot}/style-${styles[0]}.css` : null;
  if (styleAdapter) {
    console.log(`    1. 在全局样式里引入 pack：${c.cyan(`@import "@/${styleAdapter}";`)}`);
  }
  if (components.length) {
    console.log(`    2. 产品代码只 import 适配层（v0.2 起推荐走中性接缝见下）：`);
    for (const id of components) {
      console.log(c.cyan(`         import { ${pascal(id)} } from "@/lib/kits/adapters/${id}";`));
    }
  }
  console.log(
    `    ${c.dim("·")} 不想让产品代码出现资产 id：把「角色 → 资产」写进 ${c.dim(`${layout.adapterRoot}/${SEAM_DIR}/seam.json`)}，` +
      `再从 ${c.dim(`${layout.adapterRoot}/${SEAM_DIR}/_template.ts`)} 复制一个角色文件，产品只 import 那个文件。`,
  );
  if (styles.length) {
    console.log(
      `    3. 注入 pack 的动效变量：${c.cyan(`import { stylePackMotionVars } from "@/lib/kits/adapters/style-pack";`)}`,
    );
    console.log(
      c.dim(`       <html data-kits-pack="${styles[0]}" style={stylePackMotionVars}>`),
    );
  }
  console.log(
    `    4. 声明 pack 作用域：${c.cyan(`<html data-kits-pack="${styles[0] ?? "cinematic"}">`)}`,
  );
  console.log(`    5. 体检：${c.cyan("kits doctor")}`);
  console.log();

  return { code: 0 };
}

function pascal(id) {
  return id
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

/* -------------------------------------------------------------------------- */
/* kits doctor                                                                */
/* -------------------------------------------------------------------------- */

/**
 * seam 的一行摘要。
 *
 * 三个数字都必须出现（绑定 / 角色文件 / 可绑定资产）：只报"接缝存在"
 * 和什么都不报没有区别 —— 读者需要知道它到底绑上了几个。
 */
function describeSeam(seam, layout) {
  const dir = `${layout.adapterRoot}/${SEAM_DIR}/`;
  if (seam.status === "not-applicable") {
    return `not-installed：没有 ${layout.lockFile}，接缝无从核对（不是通过）`;
  }
  if (!seam.present) return `没有 ${dir}（v0.1.1 风格的安装）`;
  /*
   * 读不出来时必须把**具体原因**带出来（哪一行、什么错），
   * 否则读者只知道"坏了"、不知道坏在哪 —— 那和没说差不多。
   */
  if (!seam.read) return `${dir}seam.json 存在但读不出来 —— ${seam.reason ?? "原因未记录"}`;
  const counts = `绑定 ${seam.bound.length} 个角色 · 角色文件 ${seam.roleFiles.length} 个 · 可绑定资产 ${seam.candidates.length} 个`;
  return seam.reason ? `${counts} —— ${seam.reason}` : counts;
}

function describeSeamHint(seam, layout) {
  const dir = `${layout.adapterRoot}/${SEAM_DIR}/`;
  if (seam.status === "not-applicable") return "先 `kits add` 安装资产。";
  if (!seam.present) return `重跑 \`kits add\` 会在缺失时生成 ${dir}（已存在的适配层文件一个都不动）。`;
  if (!seam.read) return `修好 ${dir}seam.json 的 JSON 语法。`;
  if (seam.dangling.length) {
    return "把 bindings 改成本次安装里的 asset id，或把那个资产重新装上。";
  }
  if (seam.nameCollisions.length) {
    return "角色文件不能和 Kits 生成的文件同名 —— 换一个角色名。";
  }
  if (seam.status === "warn") {
    return `按 ${dir}README.md 绑定：先声明角色 → 资产，再从 ${dir}_template.ts 复制一个角色文件。`;
  }
  return undefined;
}

/**
 * 三类归属数一遍（v0.2 · K4 §14.8）。
 *
 * 之前 doctor 只说"适配层文件都在"—— 读者分不出哪些是 Kits 生成、
 * 哪些是产品自己写的接缝。这三类文件的**更新规则完全不同**：
 * 托管区会被覆盖、生成文件只在缺失时补、产品自有接缝永不被碰。
 */
function describeOwnership({ lock, seam, layout }) {
  const managed = (lock.files ?? []).length;
  const generated = expectedAdapterFiles(lock.assets ?? []).length;
  return (
    `managed ${layout.installedRoot}/ ${managed} 个文件（checksum 受保护） · ` +
    `generated ${layout.adapterRoot}/ ${generated} 个适配文件（Kits 只在缺失时生成） · ` +
    `product-owned 接缝 ${seam.roleFiles.length} 个角色文件（Kits 永不覆盖）`
  );
}

function cmdDoctor({ flags }) {
  const productRoot = resolveTarget(flags.target ?? process.cwd());
  const layout = { ...DEFAULT_LAYOUT };
  const lock = readLock(productRoot, layout);

  header(`kits doctor · ${path.basename(productRoot)}`);
  console.log(`  ${c.dim(productRoot)}`);
  console.log();

  const checks = [];
  /*
   * 库层说的是 "not-applicable"（语义名），渲染层用 "na"（Mark 表里的短名）。
   * 在这里归一化，免得每个 push 点各写一遍，也免得漏掉一次就渲染成 undefined ——
   * "不适用"被打印成空字符串，恰恰又是 K5 要消灭的那种输出。
   */
  const statusOf = (status) => (status === "not-applicable" ? "na" : status);
  const push = (id, status, detail, hint, state) =>
    checks.push({ id, status: statusOf(status), detail, hint, state: state ?? null });

  // --- 1. 安装清单 --------------------------------------------------------
  if (!lock) {
    push("lock", "fail", `没有找到 ${layout.lockFile}`, "先用 `kits add` 安装资产。");
  } else {
    push(
      "lock",
      "pass",
      `schemaVersion ${lock.schemaVersion} · ${lock.assets.length} 个资产 · 装于 ${lock.generatedAt}`,
    );
    push(
      "lock-source",
      lock.source?.commit ? "pass" : "warn",
      lock.source?.commit
        ? `来源 commit ${String(lock.source.commit).slice(0, 8)}${lock.source.dirty ? c.yellow("（安装时 Kits 工作区有未提交改动）") : ""}`
        : "清单里没有记录来源 commit",
    );
  }

  // --- 2. 托管文件完整性 --------------------------------------------------
  if (lock) {
    const result = verify({ productRoot, lock });
    if (result.missing.length) {
      push("integrity", "fail", `托管区缺少 ${result.missing.length} 个文件`, `跑 \`kits add\` 重新安装。缺：${result.missing.slice(0, 3).join(", ")}`);
    } else if (result.modified.length) {
      push(
        "integrity",
        "fail",
        `有 ${result.modified.length} 个 Kits 托管文件被手工改过`,
        `托管区属于 Kits，修改会在下次安装时丢失。把这些改动移到 ${layout.adapterRoot}/。改过的文件：${result.modified.slice(0, 3).join(", ")}`,
      );
    } else {
      push("integrity", "pass", `${result.checked} 个托管文件 checksum 全部匹配`);
    }
    if (result.extra.length) {
      push(
        "integrity-extra",
        "warn",
        `托管区里有 ${result.extra.length} 个不属于本次安装的文件`,
        `它们不会被 Kits 管理，也不受保护：${result.extra.slice(0, 3).join(", ")}`,
      );
    }
  }

  // --- 3. 缺依赖 ----------------------------------------------------------
  if (lock) {
    const installed = new Set(lock.assets.map((a) => a.id));
    const missingDeps = (lock.dependencies ?? []).filter(
      (edge) => !installed.has(edge.to),
    );
    if (missingDeps.length) {
      push("dependencies", "fail", `有 ${missingDeps.length} 条依赖没有对应的已安装资产`, `跑 \`kits add\` 补齐：${missingDeps.map((d) => d.to).join(", ")}`);
    } else {
      push("dependencies", "pass", `${lock.assets.length} 个资产的依赖图闭合`);
    }
  }

  // --- 4. 上游可见性 ------------------------------------------------------
  /*
   * 先把"能不能读到上游"这件事本身报出来。它决定了后面 React 兼容性检查
   * 走哪套判据，也决定了那些检查的结论强度（state）。
   *
   * 独立安装（Kits 仓库不存在）**不是错误** —— 那正是 Source Installation
   * 的目标状态。但它必须被说出来，因为"读不到上游"和"与上游一致"是两件事，
   * v0.1.0 把它们打印成了同一句话（K-03）。
   */
  const upstream = probeUpstream({ flags, discovered: tryKitsRoot() });
  push(
    "upstream-kits",
    upstream.available ? "pass" : "warn",
    upstream.note,
    upstream.available
      ? undefined
      : "独立安装是 Source Installation 的正常状态。此状态下 doctor 不与上游比对，只校验「产品实际版本 ∈ 安装时声明的区间」。要真的比对，用 --kits <路径>。",
    upstream.available ? "verified" : "upstream-unavailable",
  );

  // --- 5. React / TypeScript 兼容性 --------------------------------------
  const declaredRange = lock?.compat?.declaredReactRange ?? null;
  const compat = auditCompatibility(productRoot, {
    kitsReactTypesVersion: upstream.kitsTypesVersion,
    kitsTypesMajor: majorOf(upstream.kitsTypesVersion),
    upstreamAvailable: upstream.available,
    supportedReactRange: declaredRange ?? SUPPORTED_REACT_RANGE,
    rangeSource: declaredRange
      ? `${layout.lockFile} 里安装时声明的区间`
      : "Kits 当前版本内置的 peer 区间（这份 lock 是 v0.1.0 装的，没有记录区间）",
    installedComponents: lock
      ? lock.assets.filter((a) => a.type === "component").length
      : null,
  });
  for (const check of compat.checks) {
    push(check.id, check.status, check.detail, check.hint, check.state);
  }

  // --- 6. 适配层存在性 + 模板版本 ----------------------------------------
  if (lock) {
    const adapterRoot = path.join(productRoot, layout.adapterRoot);
    const expected = expectedAdapterFiles(lock.assets);
    const missingAdapters = expected.filter((f) => !existsSync(path.join(adapterRoot, f)));
    if (missingAdapters.length) {
      push(
        "adapters",
        "warn",
        `缺少 ${missingAdapters.length} 个适配层文件`,
        `跑 \`kits add\` 会补齐（它只补不存在的文件）：${missingAdapters.join(", ")}`,
      );
    } else {
      push("adapters", "pass", `${expected.length} 个适配层文件都在`);
    }

    /*
     * 模板版本：适配层永远不被覆盖，因此"Kits 升级带来的新模板"不会自动
     * 流到产品的 adapters/。这是刻意的（那些文件属于产品），但必须被说出来。
     * standalone 下没法重新生成来比对 —— lock 里记的模板版本是唯一信号。
     */
    const recorded = lock.adapters?.templateVersion ?? null;
    if (recorded === ADAPTER_TEMPLATE_VERSION) {
      push("adapters-template", "pass", `适配层模板版本 ${recorded}`);
    } else {
      push(
        "adapters-template",
        "warn",
        recorded
          ? `适配层由旧模板 v${recorded} 生成，当前 Installer 是 v${ADAPTER_TEMPLATE_VERSION}`
          : "lock 里没有适配层模板版本（v0.1.0 装的）",
        `Kits 不会覆盖你改过的适配层。想要新模板：删掉该文件再跑 \`kits add\`（只补不存在的），或比对 \`kits diff\`。`,
      );
    }
  }

  // --- 7. 边界：产品源码不得直接引用托管区 --------------------------------
  /*
   * 这条是整条 Distribution 设计的承重点，因此失败而不是警告：
   * 产品一旦直接 import installed/，适配层就成了装饰品，
   * "升级 Kits 不动产品代码"这个承诺当场变假。
   *
   * v0.2（K5）：判定从两态变三态。过去「扫过 0 个产品源文件，没有绕过适配层的
   * 引用」会打印成通过 —— 那是这条正式质量门上的一条静默失败路径。
   * 现在：没有托管区 → not-applicable（**不是**通过；没有东西可以被越界），
   * 范围根缺失或扫到 0 个文件 → fail（检查没有发生）。
   */
  const scan = findManagedImports({ productRoot, layout });
  const boundary = boundaryVerdict({
    productRoot,
    layout,
    scan,
    installPresent: Boolean(lock),
  });
  push("boundary", boundary.status, boundary.detail, boundary.hint ?? undefined, boundary.state);

  // --- 8. 中性接缝：声明与实现双向核对（v0.2 · K4）------------------------
  const seam = evaluateSeam({ productRoot, layout, lock });
  push(
    "seam",
    seam.status,
    describeSeam(seam, layout),
    describeSeamHint(seam, layout),
    seam.status === "not-applicable" ? "not-installed" : null,
  );

  // --- 9. 三类归属：托管 / 生成 / 产品自有接缝 ----------------------------
  if (lock) {
    push("adapters-ownership", "pass", describeOwnership({ lock, seam, layout }));
  }

  // --- 输出 ---------------------------------------------------------------
  /*
   * state 是 v0.1.1 新增的一列：它说明**这个结论是靠什么得到的**。
   * 之所以要显式打印，是因为最危险的失败不是"检查失败"，而是
   * "检查没查到却报告为通过" —— v0.1.0 的 doctor 就在独立安装下
   * 打印过一句它其实无法验证的"与 Kits 解析到同一 major"（K-03）。
   * v0.2 起 status 也多了一态：`na`（不适用）。它既不是通过也不是失败。
   */
  for (const check of checks) {
    const state = check.state ? c.dim(`[${check.state}]`) : "";
    console.log(`  ${MARK[check.status]} ${check.id.padEnd(24)} ${state} ${check.detail}`);
    if (check.hint && check.status !== "pass") {
      console.log(`    ${c.dim("→")} ${c.dim(check.hint)}`);
    }
  }
  console.log();

  const failed = checks.filter((x) => x.status === "fail").length;
  const warned = checks.filter((x) => x.status === "warn").length;
  const na = checks.filter((x) => x.status === "na").length;
  const naNote = na ? c.dim(` · ${na} 项不适用`) : "";
  if (failed) {
    console.log(`  ${c.red(`✗ ${failed} 项失败`)}${warned ? c.yellow(` · ${warned} 项警告`) : ""}${naNote}`);
  } else if (warned) {
    console.log(`${c.yellow(`! 通过，但有 ${warned} 项警告`)}${naNote}`);
  } else if (na) {
    // 「全部通过」只允许在没有 na 的时候说：不适用不是通过。
    console.log(`${c.green("✓ 通过")}${naNote}`);
  } else {
    console.log(c.green("✓ 全部通过"));
  }
  console.log();

  return { code: failed ? 1 : 0 };
}

function tryKitsRoot() {
  try {
    return resolveKitsRoot({});
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* kits diff                                                                  */
/* -------------------------------------------------------------------------- */

function cmdDiff({ flags }) {
  const productRoot = resolveTarget(flags.target ?? process.cwd());
  const layout = { ...DEFAULT_LAYOUT };
  const lock = readLock(productRoot, layout);
  if (!lock) {
    throw new KitsError(CODES.LOCK_MISSING, `没有找到 ${layout.lockFile}`, "先安装：kits add …");
  }

  const kitsRoot = resolveKitsRoot(flags);
  const { assetsById } = loadRegistry(kitsRoot);

  header(`kits diff · 已安装 vs 当前 Kits`);
  console.log(`  ${c.dim(productRoot)}`);
  console.log();

  let changes = 0;
  for (const installed of lock.assets) {
    const current = assetsById.get(installed.id);
    if (!current) {
      console.log(`  ${c.red("✗ 上游已移除")} ${installed.id} ${c.dim(`（本地 ${installed.version}）`)}`);
      changes += 1;
      continue;
    }
    if (current.version !== installed.version) {
      console.log(`  ${c.yellow("~ 有新版本")} ${installed.id} ${installed.version} → ${current.version}`);
      changes += 1;
      continue;
    }
    if (current.status !== installed.status) {
      console.log(`  ${c.yellow("~ 状态变化")} ${installed.id} ${installed.status} → ${current.status}`);
      changes += 1;
      continue;
    }
    console.log(`  ${c.dim("= 一致")} ${installed.id} ${installed.version}`);
  }

  // 上游新增、但本地没装的
  const installedIds = new Set(lock.assets.map((a) => a.id));
  const upstreamNew = [...assetsById.values()].filter(
    (a) => isInstallableType(a.type) && a.status === "approved" && !installedIds.has(a.id),
  );
  if (upstreamNew.length) {
    console.log();
    console.log(c.dim("  上游还有未安装的已批准资产："));
    for (const a of upstreamNew) console.log(c.dim(`    · ${a.type} ${a.id} ${a.version}`));
  }

  /*
   * 中性接缝的状态（v0.2 · K4）。
   *
   * `kits diff` 过去只看资产 id/版本/状态，从不看 adapters/ —— 于是
   * "声明了绑定、但绑的资产已经不在本次安装里"这种情况在 diff 里完全隐形。
   * 接缝是产品自己的文件，Kits 不改它，但必须**说得出来**。
   */
  const seam = evaluateSeam({ productRoot, layout, lock });
  console.log();
  if (seam.status === "not-applicable") {
    console.log(c.dim("  中性接缝    —— 没有安装清单，不适用"));
  } else {
    const marker =
      seam.status === "fail" ? c.red("✗") : seam.status === "warn" ? c.yellow("!") : c.green("✓");
    console.log(
      `  ${marker} 中性接缝    ${c.dim(`${layout.adapterRoot}/${SEAM_DIR}/`)} 绑定 ${seam.bound.length} 个角色 · 角色文件 ${seam.roleFiles.length} 个 · 可绑定资产 ${seam.candidates.length} 个`,
    );
    if (seam.reason) console.log(`    ${c.dim("→")} ${c.dim(seam.reason)}`);
  }

  console.log();
  console.log(
    changes
      ? `${c.yellow(`${changes} 项有差异`)} —— 重新跑 \`kits add\` 即可同步（产品 adapters/ 不受影响）`
      : c.green("  已安装资产与当前 Kits 完全一致"),
  );
  console.log();

  return { code: 0 };
}

/* -------------------------------------------------------------------------- */
/* help                                                                       */
/* -------------------------------------------------------------------------- */

function cmdHelp() {
  console.log(`
${c.bold("Prototype Kits · Installer")}

${c.bold("用法")}
  kits <命令> [选项]

${c.bold("命令")}
  ${c.cyan("add")}     安装资产到产品（唯一的写操作）
  ${c.cyan("list")}    查看 registry 里的可用 / 已批准资产
  ${c.cyan("doctor")}  体检：React 兼容性 / 托管文件完整性 / lock / 缺依赖
  ${c.cyan("diff")}    比较已安装版本与当前 Kits 的差异

${c.bold("kits add")}
  --target <dir>            产品根（必填）
  --style <id[,id]>         Style Pack
  --components <id[,id]>    Signature Component
  --effects <id[,id]>       Effect Pack
  --assets <id[,id]>        直接指定资产 id
  --kits <dir>              Kits 仓库根（默认从 CLI 位置推断）
  --dry-run                 只打印计划，不写磁盘

${c.bold("kits list / doctor / diff")}
  --target <dir>            产品根（默认当前目录）
  --kits <dir>              Kits 仓库根
  --all                     list：连未批准资产一起列出

${c.bold("示例")}
  kits add --target ../my-prototype \\
    --style cinematic \\
    --components animated-grid,data-cursor,insight-reveal \\
    --effects ambient-glow --dry-run

  kits doctor --target ../my-prototype

${c.bold("安装后的目录")}
  lib/kits/
  ├── installed/       Kits 托管区（只读，重新安装会覆盖）
  ├── adapters/        产品托管区（Kits 永不覆盖）
  ├── .kits/           Installer 自身（本 CLI 的副本）
  └── kits.lock.json   安装清单

${c.dim("Development Mode（改 Kits 本身、做 Style Migration 调查）见 docs/integration.md。")}
`);
  return { code: 0 };
}

/* -------------------------------------------------------------------------- */
/* main                                                                       */
/* -------------------------------------------------------------------------- */

function main() {
  const argv = process.argv.slice(2);
  const { command, flags, positional } = parseArgs(argv);

  if (flags.version || flags.v) {
    console.log("kits 0.1.1");
    return 0;
  }
  if (!COMMANDS.has(command) || command === "help" || command === "--help" || command === "-h") {
    cmdHelp();
    return 0;
  }
  if (positional.length && command === "add") {
    throw new KitsError(CODES.BAD_USAGE, `无法识别的参数：${positional.join(" ")}`);
  }

  const result =
    command === "list"
      ? cmdList({ flags })
      : command === "add"
        ? cmdAdd({ flags })
        : command === "doctor"
          ? cmdDoctor({ flags })
          : cmdDiff({ flags });

  return result?.code ?? 0;
}

try {
  process.exitCode = main();
} catch (error) {
  if (error instanceof KitsError) {
    console.error(`\n${c.red(`✗ ${error.message}`)}`);
    if (error.hint) console.error(`  ${c.dim("→")} ${error.hint}`);
    console.error(c.dim(`\n  (${error.code})`));
  } else {
    console.error(`\n${c.red("✗ 未预期的错误")}`);
    console.error(error?.stack ?? error);
  }
  process.exitCode = 1;
}
