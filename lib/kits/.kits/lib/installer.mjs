/**
 * 源码安装器。
 *
 * 把「Kits 仓库里的 approved 资产」安装成「产品自己拥有的一份源码」。
 *
 * ---------------------------------------------------------------------------
 * 为什么不是 cp -R
 * ---------------------------------------------------------------------------
 * 直接复制会留下三个洞：
 *   1. 资产之间的**裸包说明符**（`@kits/contracts`）在产品里解析不了；
 *   2. 没有状态记录 —— 下次升级无从判断哪些文件是 Kits 管的、哪些是人改的；
 *   3. 失败时留下半安装状态。
 *
 * 因此这里是三段式：
 *   plan()   纯计算，不碰磁盘 → 可 dry-run
 *   apply()  写入 + 清单 + 生成适配层 → 失败自动回滚
 *   verify() 读回来核对 checksum
 *
 * ---------------------------------------------------------------------------
 * 依赖重写：裸说明符 → 相对路径
 * ---------------------------------------------------------------------------
 * 安装后**不依赖任何 node_modules 解析**。所有 `@kits/*` 说明符都被重写成
 * 指向已安装文件的相对路径。于是：
 *   - 产品不需要为 Kits 配 transpilePackages / externalDir / turbopack.root
 *   - 把 Kits 仓库整个删掉，产品照样 install / typecheck / build
 * 这两条是 Distribution 成功的判据（见测试 standalone-fixture）。
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { CODES, fail } from "./errors.mjs";
import { hashContent, resolvePackageSpecifier, toPosix } from "./packaging.mjs";
import { resolveDependencies } from "./registry.mjs";

/** 托管区内部布局。产品只应该 import `adapters/` 与 `.kits/`。 */
export const INSTALLED_ROOT = "lib/kits";
export const MANAGED_DIR = `${INSTALLED_ROOT}/installed`;
export const AGENT_DIR = `${INSTALLED_ROOT}/.kits`;
export const ADAPTER_DIR = `${INSTALLED_ROOT}/adapters`;
export const LOCK_FILE = `${INSTALLED_ROOT}/kits.lock.json`;
export const LOCK_SCHEMA_VERSION = 1;

/* -------------------------------------------------------------------------- */
/* 安装位置                                                                    */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* 说明符扫描                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Kits 用到的全部导入形态。刻意用一组正则而不是完整解析器：
 * Kits 是**自己的**源码，语法收敛；解析器会引入依赖，而 Installer
 * 必须能在一个什么都没有的产品里裸跑。
 *
 * 覆盖：
 *   import x from "s"         import "s"          import x, { y } from "s"
 *   import type { T } from "s"                     export ... from "s"
 *   @import "s";              @import url("s");
 */
/**
 * 去掉注释后的正文 —— **只用于发现说明符**，不用于输出。
 *
 * 为什么必须去注释（v0.1.1 修 K-06）：
 * 说明符扫描是纯正则的，它分不清代码与注释。于是一段解释性的注释
 *
 *     //   packages/cli/README.md:  import { X } from "@kits/insight-reveal";
 *
 * 会被当成真实依赖，安装器随即因为"引用了未安装的包"而失败 ——
 * 注释里的示例反过来把安装本身弄挂了。
 *
 * 注意两点：
 *   1. 返回值**绝不**用于写盘。重写仍然作用于原文（split/join），
 *      否则会破坏文件内容。这里只是"清单"。
 *   2. **行注释必须先剥**。反过来会出事：一句行注释里如果出现 `/*`
 *      （例如「从不 import lib/kits/installed 里的东西」写成路径通配），
 *      块注释剥离会把从这里一直到下一个注释结尾之间的**真实 import**
 *      一起吃掉 —— 那些说明符就不会被发现，也就不会被重写。
 *      行注释先走，`/*` 就随整行一起消失了。
 *   3. 行注释用 `(^|[^:])` 保护 `http://` 这类 URL，避免把
 *      `xmlns='http://www.w3.org/2000/svg'` 之后的内容整行吃掉。
 *
 * @param {string} content
 */
export function stripComments(content) {
  return content
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const SPECIFIER_PATTERNS = [
  // import / export ... from "spec"
  /(?<head>\b(?:import|export)\b[\s\S]*?\bfrom\s*)(?<q>["'])(?<spec>[^"']+)\k<q>/g,
  /*
   * 副作用导入：import "spec"
   *
   * `(?<!@)` 是必需的：没有它，CSS 的 `@import "x"` 会**同时**被这一条和
   * 下一条匹配，同一个说明符被收集两次。对安装器无害（重写是 split/join，
   * 幂等），但任何基于 scanSpecifiers 逐条报告的消费者都会看到重复项
   * —— v0.1.1 的边界检查（boundary.mjs）第一次跑就撞上了这个。
   */
  /(?<!@)(?<head>\bimport\s*)(?<q>["'])(?<spec>[^"']+)\k<q>/g,
  // CSS：@import "spec" / @import url("spec")
  /(?<head>@import\s+(?:url\(\s*)?)(?<q>["'])(?<spec>[^"']+)\k<q>/g,
];

/**
 * 抽出文件里的全部 import/export 说明符，并分类。
 *
 * 三类，重写规则不同：
 *   kits      `@kits/…`        → 换成相对路径
 *   relative  `./x.ts`         → 去掉 .ts/.tsx 扩展名
 *   bare      `react` / `./x.css` → 原样保留
 */
export function scanSpecifiers(content) {
  /** @type {Array<{spec:string, kind:"kits"|"relative"|"other"}>} */
  const found = [];
  const body = stripComments(content);
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(body)) !== null) {
      const spec = match.groups?.spec;
      if (!spec) continue;
      if (spec.startsWith("@kits/")) found.push({ spec, kind: "kits" });
      else if (spec.startsWith(".")) found.push({ spec, kind: "relative" });
      else found.push({ spec, kind: "other" });
    }
  }
  return found;
}

/** 只收集 Kits 包说明符（用于依赖解析）。 */
export function collectKitsSpecifiers(content) {
  return [...new Set(scanSpecifiers(content).filter((s) => s.kind === "kits").map((s) => s.spec))];
}

/**
 * 文档文件不参与依赖解析。
 *
 * ===========================================================================
 * 为什么（v0.1.1 修 K-06）
 * ===========================================================================
 * 说明符扫描原本一视同仁地扫**所有**被安装的文件，包括 README.md。
 * 而 README 里到处是代码示例：
 *
 *     packages/contracts/README.md:  import { cinematicMotion } from "@kits/style-cinematic";
 *     packages/cli/README.md:        import { InsightReveal } from "@kits/insight-reveal";
 *
 * 这些是**文档**，不是运行时依赖。但安装器把它们当成了"文件引用了某个
 * 未安装的包"，于是直接 DEPENDENCY_UNRESOLVED 失败：
 *
 *     kits add --style editorial        → ✗ contracts/README.md 引用了 @kits/style-cinematic
 *     kits add --style cinematic        → ✗ .kits/README.md 引用了 @kits/react-utils
 *     （不带 --components 时）
 *
 * 也就是说 v0.1.0 的 `kits add` 只有"cinematic + 组件 + 效果"这一个组合能跑通 ——
 * 换一套 pack、或者只装样式不装组件，都会失败。这不是"依赖没登记"，
 * 是扫描把文档读成了代码。
 *
 * 文档照常安装进产品（它们是有用的），只是不再被当作依赖载体。
 * 文档里的示例也**不应该**被改写成相对路径 —— 示例要展示的是规范的
 * 包说明符。
 */
const DOCUMENTATION_EXT = /\.(?:md|mdx|txt)$/i;

export function isDocumentationFile(name) {
  return DOCUMENTATION_EXT.test(name);
}

/* -------------------------------------------------------------------------- */
/* plan                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 计算安装计划。**不写磁盘。**
 *
 * @returns {{
 *   assets: any[],
 *   edges: any[],
 *   files: Array<{src:string,dest:string,kind:string,assetId:string,specifiers:string[]}>,
 *   packages: Map<string,{id:string,dir:string,dest:string}>,
 *   warnings: string[],
 * }}
 */
export function plan({ kitsRoot, assetsById, ids }) {
  const { ordered, edges } = resolveDependencies(assetsById, ids);

  /*
   * 每个资产的两件事：
   *   packageRoot  它的文件在 Kits 仓库里的根（用于解析包说明符）
   *   destRoot     它被安装到产品的哪个目录
   *
   * 注册到 byPackageName 的**只有真正拥有包的资产**（style / component /
   * package）。effect 是共享包里的单个文件，不能作为说明符解析目标 ——
   * 它的契约也要求"Effect 必须是纯 CSS"，即它不 import 任何 @kits/*。
   */
  const byPackageName = new Map();
  const assetInfo = new Map();

  for (const asset of ordered) {
    const assetPath = path.resolve(kitsRoot, asset.path);
    if (!existsSync(assetPath)) {
      fail(
        CODES.ASSET_PATH_MISSING,
        `资产「${asset.id}」的 path 不存在：${asset.path}`,
        "registry 里的 path 必须相对 Kits 仓库根。",
      );
    }
    const isDir = statIsDir(assetPath);
    /*
     * Installer 自身装在 `.kits/`，与资产托管区分开：
     *   installed/  资产（产品只读）
     *   .kits/      CLI（安装后产品在 Kits 仓库不存在时也能跑 doctor）
     * 分开还有一个好处：`.kits/` 是点目录，不会被"产品源码"的 glob 扫到。
     */
    const destRoot = asset.id === "cli" ? AGENT_DIR : `${MANAGED_DIR}/${asset.id}`;

    const info = {
      id: asset.id,
      type: asset.type,
      destRoot,
      /** 显式文件清单（相对 Kits 根）；给出时优先于目录扫描。 */
      explicitFiles: asset.files ?? null,
      /** 目录扫描的起点。 */
      scanRoot: isDir ? assetPath : path.dirname(assetPath),
      /** 一个资产是否拥有整个包（决定它能否作为说明符解析目标）。 */
      ownsPackage: isDir && asset.type !== "effect",
    };
    assetInfo.set(asset.id, info);

    if (!info.ownsPackage) continue;
    const pkgFile = path.join(assetPath, "package.json");
    if (!existsSync(pkgFile)) {
      fail(
        CODES.ASSET_PATH_MISSING,
        `资产「${asset.id}」目录里没有 package.json：${asset.path}`,
        "拥有包的资产（style / component / package）必须是一个可解析的包。",
      );
    }
    const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
    if (!byPackageName.has(pkg.name)) {
      byPackageName.set(pkg.name, { id: asset.id, name: pkg.name, dir: assetPath, dest: destRoot });
    }
  }

  /** @type {Map<string, any>} */
  const files = new Map();
  const warnings = [];

  for (const asset of ordered) {
    const info = assetInfo.get(asset.id);

    if (info.explicitFiles) {
      // 显式清单：每个路径按 basename 落到该资产的安装目录
      for (const rel of info.explicitFiles) {
        const abs = path.resolve(kitsRoot, rel);
        if (!existsSync(abs)) {
          fail(CODES.ASSET_PATH_MISSING, `资产「${asset.id}」声明的文件不存在：${rel}`);
        }
        const dest = `${info.destRoot}/${path.basename(rel)}`;
        const content = readFileSync(abs, "utf8");
        files.set(dest, {
          assetId: asset.id,
          src: abs,
          dest,
          kind: "asset",
          specifiers: isDocumentationFile(rel) ? [] : collectKitsSpecifiers(content),
        });
      }
      continue;
    }

    const walk = (absDir, relDir) => {
      for (const entry of readdirSorted(absDir)) {
        const abs = path.join(absDir, entry);
        const rel = relDir ? `${relDir}/${entry}` : entry;
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        if (statIsDir(abs)) {
          walk(abs, rel);
          continue;
        }
        // 不安装包清单与 demo：demo 是 Kits 的展示件，不属于产品
        if (entry === "package.json" || entry === "demo.tsx") continue;
        const dest = `${info.destRoot}/${rel}`;
        const content = readFileSync(abs, "utf8");
        files.set(dest, {
          assetId: asset.id,
          src: abs,
          dest,
          kind: "asset",
          // 文档不参与依赖解析，理由见 isDocumentationFile 的注释（K-06）。
          specifiers: isDocumentationFile(entry) ? [] : collectKitsSpecifiers(content),
        });
      }
    };
    walk(info.scanRoot, "");
  }

  // 解析每个文件的裸说明符 → 目标文件（目标是**安装后的路径**）
  for (const file of files.values()) {
    file.resolved = [];
    for (const spec of file.specifiers) {
      const hit = resolvePackageSpecifier(kitsRoot, spec, byPackageName);
      if (!hit) {
        fail(
          CODES.DEPENDENCY_UNRESOLVED,
          `${file.dest} 引用了未知的 Kits 包：「${spec}」`,
          "该包不在本次安装计划里。检查 registry 的 dependencies 是否漏了这一条。",
        );
      }
      const relInPackage = path.relative(hit.packageInfo.dir, hit.file);
      const destRel = `${hit.packageInfo.dest}/${toPosix(relInPackage)}`;
      file.resolved.push({ spec, destRel });
    }
  }

  return {
    assets: ordered,
    edges,
    files: [...files.values()].sort((a, b) => a.dest.localeCompare(b.dest)),
    packages: byPackageName,
    warnings,
  };
}

/* -------------------------------------------------------------------------- */
/* 目录工具                                                                    */
/* -------------------------------------------------------------------------- */

function readdirSorted(dir) {
  return readdirSync(dir).sort();
}

function statIsDir(p) {
  return statSync(p).isDirectory();
}

/* -------------------------------------------------------------------------- */
/* 说明符重写                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 把文件里的裸包说明符全部换成指向已安装文件的**相对路径**。
 *
 * 为什么用相对路径而不是 tsconfig paths 别名：
 * 别名要求产品改 tsconfig，多一个能被写错的地方；而相对路径是自足的 ——
 * 产品只要拿到这套文件就能编译，不需要任何额外配置。这也是
 * 「删掉 Kits 仓库仍然 build 得起来」的前提。
 *
 * @param {string} content
 * @param {{spec:string,destRel:string}[]} resolved
 * @param {string} selfDest 该文件自己的安装后相对路径（用于算相对距离）
 */
export function rewriteSpecifiers(content, resolved, selfDest) {
  const selfDir = path.posix.dirname(toPosix(selfDest));
  const map = new Map(resolved.map((r) => [r.spec, r.destRel]));

  const replacements = [];
  for (const { spec, kind } of scanSpecifiers(content)) {
    if (kind === "kits") {
      const destRel = map.get(spec);
      if (!destRel) continue;
      let rel = path.posix.relative(selfDir, toPosix(destRel));
      if (!rel.startsWith(".")) rel = `./${rel}`;
      replacements.push([spec, stripSourceExtension(rel)]);
    } else if (kind === "relative") {
      /*
       * 相对路径里的 .ts / .tsx 扩展名必须去掉。
       *
       * Kits 源码内部用具名扩展名（`./contract.ts`），因为它是 workspace 内
       * 的源码分发，`allowImportingTsExtensions` 一直开着。但那是**Kits 的**
       * 编译配置 —— 装进产品之后，产品会被迫打开同一个 flag，否则每个相对
       * import 都报 TS5097。
       *
       * 「安装后不要求产品改配置」是 Source Installation 的核心承诺，
       * 因此扩展名在这一步被剥掉，变成 bundler 的普通解析。
       * .css / .json 等真实扩展名保留（它们参与不了扩展名推断）。
       */
      const stripped = stripSourceExtension(spec);
      if (stripped !== spec) replacements.push([spec, stripped]);
    }
  }

  let out = content;
  for (const [from, to] of replacements) {
    out = out.split(`"${from}"`).join(`"${to}"`);
    out = out.split(`'${from}'`).join(`'${to}'`);
  }
  return out;
}

/** 去掉 .ts / .tsx 扩展名，其它扩展名保持不动。 */
export function stripSourceExtension(spec) {
  return spec.replace(/\.tsx?$/, "");
}

/* -------------------------------------------------------------------------- */
/* apply                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 写入安装计划。**失败自动回滚。**
 *
 * 回滚策略：写入前先快照托管区里会被触碰的全部既有文件内容
 * （新文件记为"原本不存在"），出错时按快照恢复/删除。
 * 这样"失败时不留下半安装状态"是可验证的事实，而不是承诺。
 *
 * @param {object} args
 * @param {import('./installer.mjs').Plan} args.plan
 * @param {string} args.productRoot
 * @param {typeof import('./lock.mjs').DEFAULT_LAYOUT[keyof typeof import('./lock.mjs').DEFAULT_LAYOUT] extends never ? never : any} args.layout
 * @param {any[]} args.adapters 由 writeAdapters 返回的结果（已写入或跳过）
 * @param {() => void} [args.afterWrite] 写入完成后、返回前的回调（用于写 lock）
 * @param {Array<{relPath: string, content: string}>} [args.extras]
 *   产品所有的脚手架文件（v0.2：中性接缝 `adapters/seam/**`）。
 *   语义与适配层一致 —— **只在不存在时生成，永不覆盖**；区别是它们跟着
 *   托管区一起进入这次事务的快照，因此失败时会一起回滚，
 *   不会留下"半个 skeleton"。
 */
export function apply({ plan, productRoot, layout, onWritten, extras = [] }) {
  const installedRootAbs = path.join(productRoot, layout.installedRoot);

  /** @type {Map<string, {existed:boolean, content:string|null}>} */
  const snapshot = new Map();
  const written = [];
  const extrasWritten = [];
  const extrasKept = [];

  const absFor = (destRel) => path.join(productRoot, destRel);

  try {
    // --- 1. 清理托管区（Kits 拥有它；重新安装就是替换） -------------------
    // 只删托管区，绝不触碰 adapters/ 与 lock 之外的任何产品文件。
    rmSync(installedRootAbs, { recursive: true, force: true });
    mkdirSync(installedRootAbs, { recursive: true });

    // --- 2. 逐文件重写 + 写入 -------------------------------------------
    for (const file of plan.files) {
      const abs = absFor(file.dest);
      const original = existsSync(abs) ? readFileSync(abs, "utf8") : null;
      snapshot.set(abs, { existed: original !== null, content: original });

      const content = rewriteSpecifiers(
        readFileSync(file.src, "utf8"),
        file.resolved,
        file.dest,
      );
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, content, "utf8");
      written.push({
        assetId: file.assetId,
        src: file.src,
        dest: file.dest,
        checksum: hashContent(content),
      });
    }

    // --- 2b. 产品所有的脚手架（keep-if-exists），同样纳入快照 --------------
    /*
     * 它属于产品：已存在就跳过（`kits add` 永不覆盖产品改动）。
     * 但"新建的那几个"必须可回滚 —— 否则一次中途失败会留下半套 skeleton，
     * 而下次 `kits add` 会因为"文件已存在"而永远不去补全它。
     */
    for (const extra of extras) {
      const abs = absFor(extra.relPath);
      if (existsSync(abs)) {
        extrasKept.push(extra.relPath);
        continue;
      }
      snapshot.set(abs, { existed: false, content: null });
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, extra.content, "utf8");
      extrasWritten.push(extra.relPath);
    }

    if (onWritten) onWritten(written);

    return { written, extrasWritten, extrasKept };
  } catch (error) {
    // --- 3. 回滚 ---------------------------------------------------------
    for (const [abs, prev] of snapshot) {
      try {
        if (prev.existed) writeFileSync(abs, prev.content, "utf8");
        else if (existsSync(abs)) rmSync(abs, { force: true });
      } catch {
        // 回滚期间的失败不再抛出（否则会掩盖原始错误）
      }
    }
    // 托管区整体清掉，保证不留残骸
    rmSync(installedRootAbs, { recursive: true, force: true });
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* verify                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 读回托管区，核对每个文件的 checksum。
 * `kits doctor` 与「托管文件被改过」检测都用它。
 *
 * @returns {{ ok: boolean, checked: number, modified: string[], missing: string[], extra: string[] }}
 */
export function verify({ productRoot, lock }) {
  const modified = [];
  const missing = [];
  const expected = new Set();

  for (const entry of lock.files ?? []) {
    expected.add(entry.path);
    const abs = path.join(productRoot, entry.path);
    if (!existsSync(abs)) {
      missing.push(entry.path);
      continue;
    }
    const actual = hashContent(readFileSync(abs, "utf8"));
    if (actual !== entry.checksum) modified.push(entry.path);
  }

  // 托管区里多出来的文件（不是 Kits 装的）
  const extra = [];
  const installedRootAbs = path.join(productRoot, lock.layout?.installedRoot ?? "lib/kits/installed");
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSorted(dir)) {
      const abs = path.join(dir, entry);
      if (statIsDir(abs)) {
        walk(abs);
        continue;
      }
      const rel = toPosix(path.relative(productRoot, abs));
      if (!expected.has(rel)) extra.push(rel);
    }
  };
  walk(installedRootAbs);

  return {
    ok: modified.length === 0 && missing.length === 0,
    checked: expected.size,
    modified,
    missing,
    extra,
  };
}
