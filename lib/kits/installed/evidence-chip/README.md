# Signature Component · EvidenceChip

> **一条可点开的证据引用**：`[类别] [#引用号] [它说的是什么] [×条数]`。
> 它解决的不是"好看"，而是**归属** —— 一条结论旁边的引用必须能被一眼认出、
> 被键盘到达、被自动化清点。

| | |
|---|---|
| **内部 API** | `1.0.0` |
| **status** | `approved` |
| **performance** | **A** · ≈0.7 KB gzip JS + ≈0.8 KB gzip CSS · 挂载后零持续成本 |
| **SSR** | ✅ 兼容（无 window / document / 能力探测；服务端 HTML 就是完整的一句引用） |
| **mobile** | ✅ 允许（`true`，内建降级；见 §5） |
| **reduced-motion** | ✅ 内建降级（颜色状态立即切换，信息不丢） |
| **第三方运行时** | 无（零依赖，只有 React peer 与 `@kits/react-utils`） |

---

## 0. 它不做什么（先读这一节）

这是本组件最容易用错的地方 —— 它**只**负责"这是一条可点开的证据引用"这件事：

| 不负责 | 归谁 |
|---|---|
| 找证据、拉数据 | 产品 |
| 抽屉内容 | 产品（chip 只提供 `drawerId` 与 `expanded`） |
| 点击后去哪（路由 / 展开 / 侧栏） | 产品（`onActivate`） |
| 焦点接管（打开后焦点进不进抽屉） | 产品 |
| 发明文案（类别词、描述、条数） | 产品 |

判断有没有用错，一句话：**把 chip 拿掉之后，产品还能不能工作？**
如果答案是不能（例如"抽屉内容存在 chip 里"），那说明它被当成产品组件用了。

---

## 1. 契约：产品只能这样调用

```tsx
import { EvidenceChip } from "@kits/evidence-chip";

<EvidenceChip
  category="证据"
  evidenceId="e-41"
  label="原始报文"
  expanded={open === "e-41"}
  drawerId="evidence-drawer"
  onActivate={setOpen}
/>

{/* 无引用号的补充引用：同类手法指纹合并了 2 条 → 渲染「手法指纹匹配 ×2」 */}
<EvidenceChip label="手法指纹匹配" count={2} onActivate={setOpen} />

{/* 只读视图：没有 onActivate → 渲染 span，不进 Tab 顺序 */}
<EvidenceChip category="证据" evidenceId="e-79" label="文件 hash" />
```

### Props

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `label` | `string` | **必填** | 这条引用说的是什么（产品文案） |
| `evidenceId` | `string` | — | 引用号（`e-41`）；组件负责 `#` 这个记号的渲染 |
| `count` | `number` | — | 合并条数；只有 `> 1` 才渲染 `×n` |
| `category` | `string` | — | 类别词（「证据」）；省略 = 不渲染 |
| `tone` | `"neutral" \| "brand" \| "signal" \| "critical"` | （不设置） | 语义语调；省略时引用号走 pack 的引用色槽位 |
| `intensity` | `"none" \| "subtle" \| "medium" \| "strong"` | `medium` | 只调引用号下划线的厚度 |
| `expanded` | `boolean` | — | 抽屉是否已打开 → `aria-expanded` |
| `drawerId` | `string` | — | 抽屉的 DOM id → `aria-controls` |
| `onActivate` | `(evidenceId?: string) => void` | — | 省略时**渲染 span 而不是 button** |
| `disableMotion` | `boolean` | `false` | 仅产品级开关 |

### 明确不暴露（传入即契约违规）

```
color / backgroundColor / borderColor / 任何 hex
borderWidth / radius / padding / gap / fontSize
duration / easing / delay / transition
underline / textDecorationThickness / letterSpacing / textTransform
icon / glyph（# 是引用语法的固定记号，不是可换图标）
width / maxWidth / whiteSpace
抽屉内容 / 打开动画 / 焦点接管 / 路由 / 数据获取
```

### DOM 契约

| 属性 | 何时存在 | 值 |
|---|---|---|
| `data-kits-component` | 总是 | `"evidence-chip"`（button 与 span 两种形态都带） |
| `data-kits-evidence-id` | 有引用号时 | 引用号本身 |
| `data-kits-evidence-count` | 真的渲染了 `×n` 时 | 条数 |
| `data-kits-evidence-expanded` | 产品给了 `expanded` 时 | `"true"` / `"false"` |

元素类型由 `onActivate` 的有无决定，**不是**可配置项：不可点开的引用不该出现在
Tab 顺序里，而"点开不动的 button"比一个静态标记更糟。

---

## 2. 同一份 JSX，四种格位

下面四列**没有任何一项需要产品改代码** —— 差异全部来自 pack 的 token。

| | editorial | cinematic | instrument | console |
|---|---|---|---|---|
| 圆角（`--kits-radius-control`） | 0 | 8px | 2px | 0 |
| 边界（`--kits-border-width-strong`） | 1px | 1px | 2px | 2px |
| 引用号颜色（`--kits-data-series-3`） | 次墨色 | 紫 | 灰 | **证据引用蓝** |
| 标签排版（`--kits-label-transform`） | uppercase | none | uppercase | uppercase |
| 字体（`--kits-font-mono`） | 等宽栈 | 等宽栈 | 等宽栈 | JetBrains Mono 栈 |
| 表面 | 纸（无纹理叠加） | 深色玻璃 | 面板 | 面板（0 圆角格位） |

四种 pack 里，chip 的**内容与结构完全一致**：类别词、引用号、描述、条数、
以及三个状态（悬停/已展开、键盘焦点、按下）。

> **为什么边界用强档线宽**：editorial 与 cinematic 的 `--kits-border-width` 是 0
> （它们的表面不画边框），而一条没有边界的引用就只是一个词。所以 chip 取
> `--kits-border-width-strong` —— 线仍然由 pack 决定粗细与颜色，组件只决定
> 「这里必须有边界」。
>
> **为什么引用号强制 `text-transform: none`**：pack 可以把它排成大写，
> 但 `e-41` 是**匹配键**而不是文案；风格不得把引用号改写成 `E-41`。
> 这是全组件唯一一处显式反抗 pack 排版的地方。

---

## 3. 降级（三层，全部内建）

1. **触屏**：hover 强调态改为常驻 + 抬高触控目标（CSS，见 §5）；
2. **reduced-motion**：颜色过渡归零，状态立即切换（CSS + 契约层）；
3. **JS 失败 / 未水合**：它是一条静态标记 —— 引用号、描述、条数全部是**可见文本**，
   不依赖任何运行时。脚本没了，引用还在。

第 3 条是刻意的设计：这个组件没有任何"挂载后才出现"的内容，
因此服务端 HTML 与客户端首帧逐字节一致，不存在 hydration mismatch。

---

## 4. SSR / Next.js 兼容性

- 组件带 `"use client"`（它要接 `onActivate`），但**渲染期不碰任何全局对象**：
  没有 `window` / `document` / `navigator`，没有 `matchMedia`，没有 `IntersectionObserver`；
- 不注册任何监听（没有指针跟随、没有能力探测），因此没有"服务端不知道、客户端才知道"
  的分支 —— 服务端产出的 HTML 就是一条完整可读的引用；
- 样式只读 `var(--kits-*)`：未绑定任何 pack 时回落到契约层的中立值，页面依然可用；
- 在 Next.js App Router 里可直接放进 Server Component 的子树（它自己声明了客户端边界）。

---

## 5. 移动端降级

`mobileCompatible: true`（**允许**在移动端使用，不等于"推荐"—— 见 manifest 的 `recommendedFor`）。

| 触发 | `(hover: none) or (pointer: coarse)` |
|---|---|
| hover 强调 | 改为**常驻**（触屏没有 hover，所以静止态就是强调态） |
| 触控目标 | 最小高度取 `--kits-control-height`（契约层 2.25rem / editorial 2.5rem / cinematic 2.25rem / instrument 1.75rem / console 2.375rem） |
| 指针监听 | 无（组件从不注册 pointer 事件，因此没有悬停残留态） |
| 内容 | **零损失**：类别词、引用号、描述、条数在触屏与桌面完全一致 |

> 注意 instrument 的那一档：它的控件高度是 28px —— 那套 pack 自己就把移动端列进
> `avoidFor`。chip 跟随 pack，而不是替 pack 发明一个更大的尺寸。

---

## 6. reduced-motion 降级

- 组件**没有**位移、缩放、模糊、循环动画；唯一的动效是颜色过渡；
- `prefers-reduced-motion: reduce` 下把时长归零 → 状态切换立即生效；
- **状态一个都不取消**：悬停/已展开、键盘焦点、按下依然有可见反馈
  （"减少动效"不是"减少信息"）；
- 两层机制：契约层把 `--kits-dur-*` 强制归零（`!important`）+ 组件 CSS 的显式媒体查询；
- 产品级开关 `disableMotion` 走同一条路径（渲染 `--still` 类），产品不需要自己写分支。

---

## 7. 无障碍（accessibility notes）

| 项 | 做法 |
|---|---|
| 可点开形态 | **真 `<button type="button">`**：Enter / Space 原生激活，Tab 顺序 = 文档顺序 |
| 只读形态 | 渲染 `<span>`：不进 Tab 顺序，也不会被读成"可操作但按下去没反应" |
| 可访问名 | **等于可见文本**（类别 + 引用号 + 描述 + 条数）。计数刻意不写 `aria-label` —— 同一条 chip 上不该有两套真相，量词也不是原子件该发明的文案 |
| 状态 | `expanded` → `aria-expanded`；`drawerId` → `aria-controls`（由产品给定，chip 不自己保存抽屉状态） |
| 焦点 | `:focus-visible` 用 pack 的 `--kits-focus-ring-*` 三件套，随 pack 变化但始终可见 |
| 颜色 | 不是唯一编码：每条引用都自带引用号与描述文字；`tone="critical"` 同样不替代文字 |
| 对比度 | 由 pack 的 ink / ink-muted 承担（例：console 最差面 6.20:1 ≥ AA 4.5:1） |
| 引用号 | `text-transform: none` + `white-space: nowrap`：引用号不得被大写改写、也不得折成两段 |

**已知的取舍**：屏幕阅读器朗读计数时的顺序是「…描述 乘号 2」（因为计数不写
`aria-label`）。需要更明确的口径时，把名词写进 `label`，例如
`label="手法指纹匹配"`，而不是给 chip 加一个只读给机器听的别名。

---

## 8. 性能分级

| | |
|---|---|
| **分类** | **A**（静态 CSS） |
| **实测体积** | JS 1,265 B min / **659 B gzip**；CSS 2,628 B min / **764 B gzip**（`esbuild --minify`，React 与 `@kits/react-utils` 外置） |
| **持续成本** | **0** —— 没有观察器、没有 rAF、没有定时器、没有监听器；挂载后只在状态变化时改三个颜色属性 |
| **不用的东西** | `backdrop-filter` / `filter` / `box-shadow` / `mix-blend-mode` —— 这四项是本仓库把资产降到 B 档的原因，本组件一个都不用 |

同屏 20 条 chip 的成本是 20 个 inline-flex 盒子，不是 20 个监听器。
真正的规模敏感点是 DOM 节点数，而不是这个组件。

---

## 9. Adapter：换掉底层时产品不用改

链路：`外部 chip/tag 组件 → Adapter → 内部稳定 API → 产品`

第三方 chip 类组件通常把「多小、多圆、什么色、什么动画」直接放在 props 上
（`size` / `variant` / `color` / `radius` / `transition`）。映射方式：

| 内部 API | 映射到 |
|---|---|
| `category` / `evidenceId` / `label` / `count` | 第三方的文本与分段 |
| `tone` | 第三方的颜色槽位（产品不传颜色） |
| `intensity` | 第三方的强调档位（产品不传数值） |
| 尺寸 / 圆角 / 边框 / 字体 / 时长 | **不由产品传** —— 来自 pack 的 token |

替换内部实现时，产品的调用形状**一行不改**，DOM 契约（`data-kits-evidence-*`）保持不变。

---

## 10. 相关资产

- 组件角色：[`styles/console/manifest.json`](../../styles/console/manifest.json)
  的 `signatureComponents` —— console 的「证据引用蓝」（`--kits-data-series-3`）
  正是为这类引用留的槽位，因此它是本组件唯一担任 `signature` 的 pack；
- 效果：**无**（组件自带的结构线不依赖任何 Effect Pack）；
- 参考板：**尚未建立**（`references/evidence-chip/` 不存在）。本组件的设计参考是
  S1 设计稿里的真实形态（`证据#e-41 原始报文` / `#e-77 进程链 tomcat→cmd` /
  `#e-79 文件 hash` / 无编号的 `手法指纹匹配×2`）与"引用标记"的既有共识，
  不是某个第三方页面；需要参考板时再按
  [`references/README.md`](../../references/README.md) 的规则补；
- 技能：[`skills/visual-direction/SKILL.md`](../../skills/visual-direction/SKILL.md)。

---

## 11. 已验证 / 未验证

**已验证**（`pnpm factory:agents` · `registry` · `lint` · `typecheck` · `test` · `build` ·
`verify:standalone` · `qa` 全绿）：

- 四套 pack 的并排舞台上都能渲染（Playground `/components`，桌面与 390px 视口截图）；
- 契约：hex 禁令、`use client`、README 的五个段落、manifest 的降级字段、
  registry ↔ manifest 的角色与标签双向一致；
- 零第三方运行时（`dependencies` 只有 `@kits/react-utils`，peer 只有 React / ReactDOM）。

**未验证**：

- 与真实屏幕阅读器（VoiceOver / NVDA）的朗读实测 —— 无障碍结论基于 DOM 契约与
  ARIA 规范，不是听测结果；
- 50 条以上 chip 同屏的实际渲染成本（结论基于"无监听器"的结构，不是压测数据）；
- 与某个具体第三方 chip 库的真实替换演练（§9 是映射设计，不是跑过的迁移）。

---

## 12. Changelog

| 版本 | 变更 |
|---|---|
| `0.1.0` | 首个版本：四块内容（类别 / 引用号 / 描述 / 条数）、两种形态（button / span）、三层降级、零第三方运行时 |
