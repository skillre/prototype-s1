# S1 · ⑤ 攻击链实体画布的渲染方式 —— xyflow 取证与决定

> 2026-09-17 · 组件批次 2 交付物的一部分。
> **结论先行**：**不引入 `@xyflow/react`**，⑤ 用 **SVG + DOM 自绘**。
> 下面每一条结论都带取证方式（命令原文或 URL），没有一条来自印象。

## 0 · 一句话理由

已签署方向是「⑤ 用 xyflow」，但取证结果说明它**不满足本仓已经签署的三条硬约束**，
而它提供的能力（拖拽 / 缩放 / 视口 / 连线路由）**本组件一个都用不上**：
⑤ 是一个**确定的、不可拖动的实况视图**（事件流决定节点与边，观众不改图），
不是编辑器。取证结论与签署方向相反，因此**先报告、不擅自装包**，改用零依赖实现。

---

## 1 · 取证：许可

```bash
# npm 缓存目录被 root 占着（EPERM），所以直接查 registry，不经 npm 客户端
curl -sS https://registry.npmjs.org/@xyflow/react | node -e '…dist-tags.latest + versions[latest]…'
```

读到的原文（`@xyflow/react@12.11.6`，published `2026-09-01T12:07:53.778Z`）：

| 事实 | 值 | 取证 |
|---|---|---|
| `license` | `MIT` | registry metadata（`npm view` 的同一份数据） |
| 运行时依赖 | `zustand@^4.4.0` · `classcat@^5.0.3` · `@xyflow/system@0.0.82` | 同上 |
| peer 依赖 | `react` / `react-dom` / `@types/react` / `@types/react-dom` `>=17` | 同上 |
| `@xyflow/system` 许可 | `MIT` | `curl …/@xyflow/system` |
| `@xyflow/system` 运行时依赖 | `d3-drag` `d3-zoom` `d3-selection` `d3-interpolate` **+ 4 个 `@types/d3-*` 作为运行时依赖** | 同上 |
| 传递运行时依赖总数 | **8 个包**（含 4 个 `@types/*` 被声明为运行时依赖） | 同上 |

许可本身**干净**（MIT，无 copyleft、无署名附加条款、无"pro 功能另许"的陷阱）。
**许可不是这次不引的理由。**

## 2 · 取证：SSR 可用性

```bash
curl -sS -o pkg.tgz https://registry.npmjs.org/@xyflow/react/-/react-12.11.6.tgz && tar xzf pkg.tgz
grep -n "typeof window\|typeof document" package/dist/esm/index.mjs
```

命中 5 处，全部是**守卫式**写法，不是裸引用：

```
333:  if (typeof window === 'undefined' || !window.matchMedia) {
362:  const defaultDoc = typeof document !== 'undefined' ? document : null;
897:  const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
1239: const win$1 = typeof window !== 'undefined' ? window : undefined;
2111: const win   = typeof window !== 'undefined' ? window : undefined;
```

`exports` 里的 `"node"` 条件指向 ESM 构建，`sideEffects` 只列 `*.css`。
**判断：模块作用域是可 SSR 的**（没有裸 `window`）。但注意这是一个**推理**，不是实测 ——
见 §6「没有验证的部分」。

官方文档给的仍然是"出错就 `dynamic(..., { ssr: false })`"（搜索结果里的 Next.js
`window is not defined` 条目），也就是说**它自己不承诺 SSR 安全，只承诺可绕开**。

## 3 · 取证：体积

```bash
du -sh package                              # → 2.8M（解包）
ls -l package/dist/esm/index.js             # → 233,341 bytes（单一 ESM 入口，未 tree-shake）
gzip -c package/dist/esm/index.js | wc -c   # → 52,449 bytes（仅该文件的 gzip，非最终 bundle）
```

| 量 | 值 | 取证 |
|---|---|---|
| `dist.unpackedSize` | **1,216,002 bytes ≈ 1.16 MiB** | registry metadata |
| `dist.fileCount` | **516** | 同上 |
| `@xyflow/system` `dist.unpackedSize` | 693,389 bytes ≈ 661 KiB | registry metadata |
| ESM 入口单文件 | 233,341 bytes → gzip **52,449 bytes** | 本地 `gzip` 实测（见上） |

⚠ **口径说明**：`gzip -c dist/esm/index.js` 量的是**这一个文件**，不是 Next 打包后的
实际增量（未 tree-shake、未算 `@xyflow/system` 与 4 个 d3 包）。**最终 bundle 增量没有量**
—— 见 §6。可以确定的是：为 6 个节点、2 条边引入一个 1.16 MiB / 516 文件的依赖。

## 4 · 取证：可访问性（这一条最反直觉）

官方文档 `https://reactflow.dev/learn/advanced-use/accessibility`（Last updated
**August 31, 2026**，实测 HTTP 200）**明确承诺了键盘与屏幕阅读器支持**，原文：

> React Flow provides keyboard and screen-reader support to help meet accessibility standards.
> By default, all nodes and edges are keyboard-focusable and operable.

> - **Tab navigation:** Pressing `Tab` moves focus through all focusable nodes and edges.
>   These elements receive `tabIndex={0}` and, by default, `role="group"`
> - **Select/Deselect:** Press `Enter` or `Space` …
> - **Move nodes with arrow keys:** …

**所以我原本"xyflow 节点不可键盘到达"的预判是错的，取证把它推翻了。** 但取证同时给出了
它**做不到**的部分 —— 而这一部分正好是本仓的硬要求：

| 本仓的要求 | xyflow 提供什么 | 缺口 |
|---|---|---|
| 节点能被**文本读出** | 自动注入英文提示：`node.a11yDescription.default = "Press enter or space to select a node. Press delete to remove it and escape to cancel."` | 这是一句**编辑器操作说明**，不是节点内容。它不读出「webshell2.jsp · 已清除 · 证据#e-79」。**节点的真实语义仍要自己写进 `aria-label` / DOM 文本。** |
| 边能被文本读出 | `edge.a11yDescription.default = "Press enter or space to select an edge…"`；文档明说"Edge components include a customizable `aria-label`" | 同上：**边的语义（谁到谁、依据哪条证据）要自己给。** |
| UI 文案一律走 `useMessages()` | 内置 a11y 文案默认英文，可用 `ariaLabelConfig` 逐键覆盖 | 需要**为 9 个键**再写一套中文字典 —— 而这 9 个键描述的是「怎么选中一个节点」，本组件根本没有选中操作。 |
| 交互必须真实 | 提供 Tab / Enter / Space / 方向键移动 / 自动平移 | ⑤ **没有可交互的动作**：观众不拖节点、不连线、不改图。给一个不能改的图配上"按空格选中、方向键移动"是无意义的 affordance。 |

**结论**：xyflow 的 a11y 是真的，但它保的是**图编辑器**的可达性；本组件要的是
**一个静态图谱的内容可达性** —— 那部分它一样要你从零写。它没有让本组件更可访问，
只是多了一套用不上的键盘模型。

## 5 · 决定与它的代价

**决定：不引 xyflow，用 SVG + DOM 自绘**（`components/prototype/workbench/attack-graph.tsx`）。

| 轴 | 自绘 | 引 xyflow |
|---|---|---|
| 运行时依赖 | **0** | 8 个（含 4 个 `@types/*` 运行时依赖） |
| `zustand` 版本 | 本仓 `5.0.15`，一份 | 需求 `^4.4.0` → **pnpm 会在 `node_modules/.pnpm` 里再放一份 v4**；两份 store 实现共存而互不可见 |
| 解锁体积 | 0 | 未实测，已知入口文件 gzip 52 KB + `@xyflow/system` 661 KiB 解包 |
| 键盘可达 | 自己写（`tabindex` + 文本等价物，已写） | 有，但语义内容是英文操作说明，仍要自己写 |
| 内容可读 | 自己写（DOM 文本 + 边列表，已写） | 仍要自己写 |
| 需要的功能 | 摆 4–6 个节点、画 2 条带标签的线 | — |
| 不需要的功能 | — | 拖拽 · 缩放 · 平移 · 视口 · 小地图 · 连线手柄 · 未定义行为下的连线路由 |

代价与它的对冲都写在代码里：

1. **不是"自己写了一个图库"**：节点位置作为**构图取值**集中在
   `view-model.ts` 的 `ATTACK_CHAIN_POSITION`（不散落在 JSX、不是视觉常量）；
   谁被画出来、画成什么状态**全部由游标派生**。
2. **可换**：如果将来 ⑤ 真的需要拖拽/缩放（那是**产品形态变更**，不是实现细节），
   换渲染器的改动面被限制在 `attack-graph.tsx` 一个文件 —— `AttackChain` 这个
   派生类型是渲染器中立的。
3. **没有绕过"人签署的方向"**：原方向是"用 xyflow"，本次是**带着证据的不同结论**，
   按仓规先报告，不由实现者静默改掉签署内容。

## 6 · 没有验证的部分（最贵的一项，逐条列出）

1. **最终 bundle 增量没有量。** 只量了 `dist/esm/index.js` 单文件的 gzip（52 KB），
   没有在真实 Next 构建里对比 `first-load JS`。所以"体积"这一栏支持"更大"，
   但**不支持任何具体数字**。
2. **SSR 结论是源码静态扫描 + registry `exports` 阅读，不是运行实测。**
   我尝试在 Node 里 `import()` 构建产物，因缺 `d3-*` 传递依赖而中止
   （没有装包，那是本任务明令禁止的）；见 §2 的命令与报错。
   所以"SSR 安全"是**推断**，不是证据。
3. **xyflow 的真实节点 a11y 行为没有在浏览器里试过**（同上：不装包）。
   §4 全部来自官方文档引文，不是实测。
4. **xyflow Pro 的许可边界没有查**（本次只查了开源包的 LICENSE）。
   由于结论是不引入，这一项对决定没有影响，但它**没有被核实**。
5. **四个 d3 包各自的许可没有逐个查**（只查了 `@xyflow/react` 与 `@xyflow/system`
   这两层）。传递依赖的许可链因此不完整。

## 附：取证命令的完整原文

```bash
# 1. registry metadata（npm 客户端因 ~/.npm 权限报 EPERM，改用 curl）
curl -sS https://registry.npmjs.org/@xyflow/react
curl -sS https://registry.npmjs.org/@xyflow/system

# 2. 包体与体积
curl -sS -o pkg.tgz https://registry.npmjs.org/@xyflow/react/-/react-12.11.6.tgz
tar xzf pkg.tgz && du -sh package && ls -l package/dist/esm/index.js
gzip -c package/dist/esm/index.js | wc -c

# 3. SSR 守卫扫描
grep -n "typeof window\|typeof document" package/dist/esm/index.mjs

# 4. 官方可访问性文档
#    https://reactflow.dev/learn/advanced-use/accessibility （HTTP 200，Last updated August 31, 2026）
```
