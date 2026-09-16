# @kits/cli

> **Installer —— 把 Kits 的 approved 资产安装成产品自己拥有的一份源码。**
> 零运行时依赖（只用 `node:` 内置模块），因此它能在"什么都没有"的产品里裸跑。

```bash
kits add     --target ../my-prototype --style cinematic \
             --components animated-grid,data-cursor,insight-reveal \
             --effects ambient-glow
kits list
kits doctor
kits diff
```

---

## 为什么不是 `cp -R`

直接复制会留下三个洞，每一个都会在真实交付里咬人：

1. **说明符解析不了。** 资产之间用裸包说明符互相引用
   （`@kits/contracts`、`@kits/react-utils`），复制到产品后这些名字没有意义。
2. **没有状态。** 下次升级无从判断哪些文件是 Kits 管的、哪些是人改过的。
3. **失败会留下半安装状态。**

因此本 CLI 是**三段式**：

```
plan()    纯计算，不碰磁盘   → 可 --dry-run
apply()   写入 + 清单 + 适配层，失败自动回滚
verify()  读回来核对 checksum
```

---

## 命令

### `kits add`

唯一的写操作。做四件事：

1. **门禁**：只接受 `registry/assets.json` 里 `status = approved` 的资产。
   门禁在**读取层**（`lib/registry.mjs`），因此 `list` / `doctor` / 测试
   走的是同一套判据，没有任何一条路径能绕过它。
2. **依赖解析**：按 registry 里声明的 `dependencies` 做拓扑排序，带环检测。
3. **兼容性校验**：React major、`@types/react` 与 Kits 的 major 一致性、
   TypeScript 是否存在。**在动磁盘之前**失败。
4. **写入 + 清单 + 适配层**。

```bash
kits add --target ../p --style cinematic --components a,b --dry-run   # 只打印计划
```

### `kits list`

查看 registry 里可安装（已批准）的资产。`--all` 连未批准的一起列出。

### `kits doctor`

体检。九项检查：lock 存在性与 schema、来源 commit、**托管文件 checksum**、
托管区多出来的文件、依赖图闭合、React 兼容性、`@types/react` 版本漂移、
TypeScript、适配层完整性。失败项给出**可执行的下一步**而不是堆栈。

```bash
node lib/kits/.kits/kits.mjs doctor   # 产品里就有，不需要 Kits 仓库
```

### `kits diff`

比较已安装版本与当前 Kits 的差异（新版本、状态变化、上游已移除、
上游新增未安装）。这一条**需要 Kits 仓库在场** —— 它的定义就是"与上游比"。

---

## 安装后的目录

```
lib/kits/
├── installed/         Kits 托管区（只读；重新安装会覆盖）
├── adapters/          产品托管区（Kits 永不覆盖）
├── .kits/             Installer 自身（本包的一份副本）
└── kits.lock.json     安装清单
```

**两个目录，两种所有权** —— 这条边界是 Kits 契约里那句
「产品只被允许依赖内部稳定 API」的落地：

- 产品代码只 import `adapters/`
- 升级 Kits 覆盖 `installed/` 时，产品的适配层与调用方一行不改
- `kits add` 只在适配层文件**不存在**时生成它，因此你改过的永远不会被覆盖

---

## Installer Rules（可被测试逐条验证）

| # | 规则 | 实现位置 | 测试 |
|---|---|---|---|
| 1 | 只安装 `status = approved` | `lib/registry.mjs` 的 `requireApproved` | `installer.spec.ts` |
| 2 | 自动解析依赖（含环检测） | `resolveDependencies` | 同上 |
| 3 | 校验 React / Next 兼容性 | `lib/compat.mjs` | 同上 |
| 4 | 校验 checksum | `verify()` + lock | 同上 |
| 5 | 不覆盖未知人工修改 | `apply()` 只清托管区；`writeAdapters` 只补不存在 | 同上 |
| 6 | 支持 dry-run | `plan()` 与 `apply()` 分离 | 同上 |
| 7 | 输出安装 diff | `cmdAdd` 的版本比较段 | 手动 |
| 8 | 重复运行 idempotent | 托管区整体替换 + 适配层保守 | 同上 |
| 9 | 失败不留半安装状态 | `apply()` 的 snapshot/rollback | 同上 |

**禁止**：`cp -R` 之后不记录状态。

---

## 依赖重写：裸说明符 → 相对路径，并**剥掉源码扩展名**

安装后产品不依赖任何 `node_modules` 解析：

```diff
- import { useReveal } from "@kits/react-utils";
+ import { useReveal } from "../react-utils/index";
```

```diff
- import { cx } from "./contract";
+ import { cx } from "./contract";
```

第二步（剥扩展名）是实测踩出来的：Kits 源码内部用具名扩展名
（workspace 的源码分发一直开着 `allowImportingTsExtensions`），
但装进产品后**产品会被迫打开同一个 flag**，否则每个相对 import 报 TS5097。

「安装后不要求产品改任何配置」是 Source Installation 的核心承诺，
因此扩展名在写盘时被剥掉。`.css` / `.json` 等真实扩展名保留。

---

## 与 Local Link（Development Mode）的分工

| | Source Installation（本 CLI） | Local Link |
|---|---|---|
| 面向 | **产品交付** | Kits 开发 / 实验 / Style Migration 调查 |
| 机制 | 复制进 `lib/kits/installed/` | `link:../prototype-kits/<pkg>` |
| 产品 `package.json` | **没有** `@kits/*` | 有 `@kits/*` |
| Next 配置 | **不需要**任何 Kits 相关配置 | `transpilePackages` + `externalDir` + `turbopack.root` |
| React 类型 | 各自独立，互不影响 | 两边必须同 major |
| 改 Kits 是否立刻生效 | 否（要重新 `kits add`） | 是 |
| 删掉 Kits 仓库还能 build | **能** | 不能 |

两条路径都必须存在，但**不能把第二条当作交付方案** ——
第一次真实集成暴露的五个缺口，全部是那种耦合的产物。

判据（CI 里可断言）：`node scripts/verify-standalone.mjs`
会把 Kits 仓库**改名移走**，然后要求 fixture 仍然 typecheck + build。
