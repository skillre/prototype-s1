/**
 * 兼容性审计 —— 目标产品的 React / Next / TypeScript 版本。
 *
 * ---------------------------------------------------------------------------
 * 这条规则的来历（一次真实事故）
 * ---------------------------------------------------------------------------
 * 第一次真实 Style Migration 里，产品侧的 `pnpm typecheck` 与 `pnpm build`
 * 同时失败在 **Kits 自己的源文件**上：
 *
 *   ../prototype-kits/components/insight-reveal/insight-reveal.tsx(92,7): TS2322
 *   Type 'Ref<never>' is not assignable to type '… & … & …'
 *     Two different types with this name exist, but they are unrelated.
 *
 * 现场看像是那一行 `ref as React.Ref<never>` 的锅。真实根因是：
 *
 *   产品  @types/react  →  19.2.18
 *   Kits  @types/react  →  19.3.0
 *
 * 源码分发 + 符号链接意味着 TS 会**用 Kits 自己那份** @types/react 去检查
 * Kits 的文件，于是同一次编译里出现两份 `VoidOrUndefinedOnly`。
 *
 * 这个错误对使用者毫无指向性：它出现在别人的文件里，报的是类型不兼容，
 * 而修法是「把两个仓库的 @types/react 对齐」。
 *
 * 因此本模块的目标不是"阻止安装"，而是**在安装/检查阶段把这件事说清楚**。
 *
 * ---------------------------------------------------------------------------
 * 两种场景，两套判据（v0.1.1 修 K-03）
 * ---------------------------------------------------------------------------
 * 上面那条规则只对 **Development Mode（Local Link）** 成立：那时 Kits 源码
 * 在**别人的目录**里，用**别人的** @types/react 编译，两份类型身份冲突。
 *
 * **Delivery Mode（Source Installation）** 下 Kits 源码是产品自己的源码，
 * 走产品自己的编译器，模块图里只有**一份** @types/react —— 这种冲突在
 * 结构上不可能发生。
 *
 * v0.1.0 的 doctor 没区分这两者，于是留下一个更糟的毛病：Kits 仓库不可见时
 * `kitsTypesMajor` 是 null，判据写成
 *     const sameMajor = kitsTypesMajor === null || targetMajor === kitsTypesMajor;
 * 直接**空过**，却仍然打印"与 Kits 解析到同一 major（19）"。
 * 一句无法被验证的结论被说成了已验证的结论。
 *
 * v0.1.1 起每个检查都带一个 `state`，明确说明"这个结论是靠什么得到的"：
 *
 *   verified               直接读到了**实际解析出的版本**并据此判定
 *   compatible             未读到上游；依据**声明的支持区间**判定
 *   upstream-unavailable   既读不到上游、也没有可用的声明区间 → 无法判定（warn，不静默）
 *   not-applicable         本次安装不涉及需要 React 类型对齐的资产
 *
 * 关键区别只有一条：**"依据声明区间推出"不等于"与上游实际版本比对过"**。
 * v0.1.0 把前者打印成了后者。
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Kits 组件支持的 React peer 区间。
 *
 * 这是**兜底常量**：正常路径下区间来自安装时写进 lock 的
 * `compat.declaredReactRange`（真正的"安装元数据"）。只有老安装
 * （v0.1.0 装的，lock 里没有这个字段）才会落回这里。
 */
export const SUPPORTED_REACT_RANGE = "^18.0.0 || ^19.0.0";

/** 从 semver 字符串里取 major。 */
function majorOf(range) {
  const match = String(range ?? "").match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

/**
 * 判断一个 major 是否落在声明的区间里。
 *
 * Kits 的区间写法收敛为 `^X.Y.Z || ^A.B.C`（见各 package.json 的
 * peerDependencies），因此这里只需正确地取出所有 major 并做成员判断，
 * 不需要引入 semver 解析器 —— Installer 必须能在裸产品里零依赖运行。
 *
 * @param {number|null} major
 * @param {string|null} range
 * @returns {boolean|null} null = 区间不可解析
 */
export function majorSatisfiesRange(major, range) {
  if (major === null || major === undefined) return null;
  if (!range) return null;
  const majors = String(range)
    .split("||")
    .map((part) => part.trim())
    .map((part) => part.match(/\^?\s*(\d+)/))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  if (majors.length === 0) return null;
  return majors.includes(major);
}

/**
 * 读目标产品的实际版本。只看**解析结果**，不看声明：
 * 声明 `^19` 而实际装的是 18 的情况必须被发现。
 *
 * @param {string} productRoot
 */
export function readTargetVersions(productRoot) {
  const pkgFile = path.join(productRoot, "package.json");
  if (!existsSync(pkgFile)) return null;
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
  const declared = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
  };

  const resolved = {};
  /**
   * 每个版本号是**从哪来的**。这一列决定了结论的强度：
   *   "resolved"  = node_modules 里真实装着的版本（可以直接比对）
   *   "declared"  = 只有 package.json 里的区间（"^5" —— 它不是一个版本）
   *
   * 少了这一列就会出现 v0.1.0 那类错误：产品还没 `pnpm install`，
   * doctor 拿着 `"^5"` 当作已解析的版本，并把"依据声明区间"说成"已核验"。
   */
  const from = {};
  for (const name of [
    "react",
    "react-dom",
    "@types/react",
    "@types/react-dom",
    "next",
    "typescript",
  ]) {
    const installed = readResolvedVersion(productRoot, name);
    resolved[name] = installed ?? declared[name] ?? null;
    from[name] = installed ? "resolved" : declared[name] ? "declared" : "absent";
  }
  return { declared, resolved, from };
}

/** 读 node_modules 里真实安装的版本。 */
function readResolvedVersion(productRoot, name) {
  const file = path.join(productRoot, "node_modules", name, "package.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")).version ?? null;
  } catch {
    return null;
  }
}

/**
 * 审计结果。
 *
 * @param {string} productRoot
 * @param {{
 *   kitsReactTypesVersion?: string|null,
 *   kitsTypesMajor?: number|null,
 *   upstreamAvailable?: boolean,
 *   upstreamNote?: string,
 *   supportedReactRange?: string|null,
 *   rangeSource?: string,
 *   installedComponents?: number,
 * }} kitsInfo
 * @returns {{ ok: boolean, checks: Array<{id:string,status:"pass"|"warn"|"fail",state:string,detail:string,hint?:string}> }}
 */
export function auditCompatibility(productRoot, kitsInfo = {}) {
  const checks = [];
  const versions = readTargetVersions(productRoot);

  if (!versions) {
    checks.push({
      id: "target-manifest",
      status: "fail",
      state: "not-applicable",
      detail: "目标目录里没有 package.json",
      hint: "`kits add --target <产品根>` 必须指向一个 Node 项目根。",
    });
    return { ok: false, checks };
  }

  const react = versions.resolved["react"];
  const reactTypes = versions.resolved["@types/react"];
  /** 版本号是否来自 node_modules 里真实安装的包（而非 package.json 的区间）。 */
  const installed = (name) => versions.from[name] === "resolved";
  const bothInstalled = (...names) => names.every(installed);
  const notYet = (name) =>
    installed(name) ? "" : "（来自 package.json 声明，尚未安装依赖）";

  const upstreamAvailable = Boolean(
    kitsInfo.upstreamAvailable ??
      (kitsInfo.kitsTypesMajor !== null && kitsInfo.kitsTypesMajor !== undefined),
  );
  const range = kitsInfo.supportedReactRange ?? SUPPORTED_REACT_RANGE;
  const rangeSource = kitsInfo.rangeSource ?? "Kits 当前版本";
  const installedComponents = kitsInfo.installedComponents ?? null;

  // --- React 本体 ---------------------------------------------------------
  if (!react) {
    checks.push({
      id: "react-present",
      status: "fail",
      state: "not-applicable",
      detail: "目标项目没有解析到 react",
      hint: "Kits 的 Signature Component 需要 React ^18 || ^19。",
    });
  } else {
    const major = majorOf(react);
    const ok = major === 18 || major === 19;
    checks.push({
      id: "react-major",
      status: ok ? "pass" : "fail",
      state: "compatible",
      detail:
        `react ${react}${notYet("react")}（支持 ${range}` +
        `${upstreamAvailable ? "" : `；区间来自 ${rangeSource}`}）` +
        (upstreamAvailable ? "" : " —— 未读到上游 Kits，按声明区间判定"),
      hint: ok ? undefined : "把 react 升级到 18 或 19，或改用不依赖 react 的 style / effect 资产。",
    });
  }

  // --- @types/react 的 major 一致性（事故现场这一条是空的） ---------------
  if (!reactTypes) {
    checks.push({
      id: "react-types-present",
      status: "warn",
      state: "not-applicable",
      detail: "目标项目没有解析到 @types/react",
      hint: "TypeScript 项目应安装 @types/react；否则 Kits 的组件源码无法被类型检查。",
    });
  } else {
    const targetMajor = majorOf(reactTypes);

    if (installedComponents === 0) {
      /*
       * 没有装任何组件 = 产品不会编译 Kits 的 .tsx，
       * 这条检查在本次安装里没有对象。报 not-applicable 而不是假装通过。
       */
      checks.push({
        id: "react-types-major-parity",
        status: "pass",
        state: "not-applicable",
        detail: `本次安装没有 Signature Component（只装了 style / effect），React 类型对齐不适用；@types/react ${reactTypes}`,
      });
    } else if (upstreamAvailable) {
      const kitsTypesMajor = kitsInfo.kitsTypesMajor ?? null;
      const sameMajor = targetMajor === kitsTypesMajor;
      const directComparison = installed("@types/react");
      checks.push({
        id: "react-types-major-parity",
        status: sameMajor ? "pass" : "fail",
        // 两边都是真实安装的版本才叫"核验过"；只读了 package.json 的区间就只能算"依据声明"。
        state: directComparison ? "verified" : "compatible",
        detail: sameMajor
          ? `@types/react ${reactTypes}${notYet("@types/react")}，与上游 Kits 解析到的 ${kitsInfo.kitsReactTypesVersion ?? "?"} 同 major（${targetMajor}）`
          : `@types/react 版本漂移：目标 ${reactTypes}（major ${targetMajor}）vs 上游 Kits ${kitsInfo.kitsReactTypesVersion ?? "?"}（major ${kitsTypesMajor}）`,
        hint: sameMajor
          ? undefined
          : `把两边对齐到同一个 minor 亦可。最省事的做法是把产品的 @types/react 钉到与 Kits 相同的版本。` +
            `漂移的后果是 Kits 自己的源文件会在你的 tsc 里报出「Two different types with this name exist」这类错误 —— 错误指向 Kits，根因在版本。`,
      });
    } else {
      /*
       * 独立（standalone）场景：读不到上游解析版本，于是**不能**声称"与上游相同"。
       * 能验的是另一件事：产品的 @types/react major 是否落在 Kits 声明的支持区间内。
       *
       * 再说一次为什么这就够了：Source Installation 之后，模块图里只有产品这一份
       * @types/react，Development Mode 那种"两份类型身份打架"在这里不可能发生。
       */
      const within = majorSatisfiesRange(targetMajor, range);
      if (within === null) {
        checks.push({
          id: "react-types-major-parity",
          status: "warn",
          state: "upstream-unavailable",
          detail: `@types/react ${reactTypes}（major ${targetMajor}）；上游 Kits 不可见，且没有可用的声明区间 → 本次无法判定类型对齐`,
          hint:
            `不是"通过"，只是"没查"。要真正核验，用 --kits <prototype-kits 路径> 指向 Kits 仓库后重跑；` +
            `或在有 Kits 仓库的环境里跑 ` +
            "`kits doctor`。",
        });
      } else {
        checks.push({
          id: "react-types-major-parity",
          status: within ? "pass" : "fail",
          state: "compatible",
          detail: within
            ? `@types/react ${reactTypes}${notYet("@types/react")}（major ${targetMajor}）落在 Kits 声明的 ${range} 内 —— 未读到上游，**未做上游比对**`
            : `@types/react ${reactTypes}${notYet("@types/react")}（major ${targetMajor}）**不在** Kits 声明的 ${range} 内`,
          hint: within
            ? undefined
            : `把 @types/react 换成 ${range} 覆盖的 major。区间来自 ${rangeSource}。`,
        });
      }
    }
  }

  // --- React 与 @types/react 的 major 应当一致 ----------------------------
  if (react && reactTypes) {
    const a = majorOf(react);
    const b = majorOf(reactTypes);
    checks.push({
      id: "react-vs-types-major",
      status: a === b ? "pass" : "warn",
      state: bothInstalled("react", "@types/react") ? "verified" : "compatible",
      detail:
        a === b
          ? `react ${react} 与 @types/react ${reactTypes} 的 major 一致`
          : `react major ${a} 与 @types/react major ${b} 不一致`,
      hint: a === b ? undefined : "@types/react 的 major 通常应与 react 一致。",
    });
  }

  // --- TypeScript --------------------------------------------------------
  const ts = versions.resolved["typescript"];
  checks.push({
    id: "typescript-present",
    status: ts ? "pass" : "warn",
    // 只有真的从 node_modules 读到版本才叫 verified；读到 "^5" 只是声明。
    state: installed("typescript") ? "verified" : ts ? "compatible" : "not-applicable",
    detail: ts ? `typescript ${ts}${notYet("typescript")}` : "没有解析到 typescript",
    hint: ts ? undefined : "Kits 是源码分发（.ts/.tsx），产品需要 TypeScript 才能编译它。",
  });

  const ok = !checks.some((c) => c.status === "fail");
  return { ok, checks, versions, mode: upstreamAvailable ? "upstream" : "standalone" };
}

/**
 * 判定上游 Kits 是否可读，并说明理由。doctor 用它决定走哪套判据。
 *
 * @param {{ kitsRoot: string|null, kitsTypesVersion: string|null, discovered: boolean }} info
 */
export function describeUpstream(info) {
  if (!info.discovered || !info.kitsRoot) {
    return {
      available: false,
      note: "未找到 Kits 仓库（独立安装模式）",
    };
  }
  if (!info.kitsTypesVersion) {
    return {
      available: false,
      note: `找到了 Kits 仓库（${info.kitsRoot}）但它自己的 node_modules 里没有 @types/react —— 依赖未安装，无法读取上游解析版本`,
    };
  }
  return {
    available: true,
    note: `Kits 仓库 ${info.kitsRoot} · @types/react ${info.kitsTypesVersion}`,
  };
}
