# @kits/contracts

> **Kits 唯一一份契约定义。纯 TypeScript，零 React 依赖。**

```ts
import {
  motionToCssVars,
  assertStylePackMotion,
  MOTION_ROLES,
  ASSET_STATUS,
  type StylePackMotion,
  type StylePackProfile,
} from "@kits/contracts";

import type { Intensity, Tone } from "@kits/contracts";
```

CSS 侧：`import "@kits/contracts/tokens.css";`

---

## 这个包解决什么问题

第一次真实产品集成暴露了一个**不可见**的缺陷：

`motionToCssVars()` —— 契约里"TS 动效刻度进入 CSS 的唯一通道" —— 存在于
`styles/_contract/contract.ts`，但：

- 任何一个包的 `exports` 都没有暴露这个文件；
- style pack 的 `index.ts` 只 re-export 了 `cinematicMotion`，没 re-export 它；
- 契约类型 `StylePackMotion` / `StylePackProfile` 同样拿不到。

于是消费方只有两条路：硬穿 exports 边界，或者**把 13 行变量表手抄一遍**。
那个产品选了后者 —— 一次静默的脱钩：Kits 改了动效刻度，产品手抄的副本不会跟着变。

同时，同一份 Style Pack Contract 在仓库里存在**两个副本**
（`styles/_contract/contract.ts` 与 `components/_shared/contract.ts` 的后半段），
两边会各自漂移，而消费方无从判断哪份是真的。

这个包把两件事一起修掉：**契约只有一份，且它是公开 API。**

---

## 导出面

| 导出 | 用途 |
|---|---|
| `motionToCssVars(motion)` | 把一份 `motion.ts` 编译成 `--kits-*` CSS 变量 |
| `assertStylePackMotion(value)` | 运行时校验 pack 的 motion 形状（交互动效 ≤1000ms 等） |
| `ASSET_STATUS` / `ASSET_TYPE` | 资产生命周期与类型（与 registry 一一对应） |
| 十个维度枚举 | `TYPE_VOICE` / `SPACING_RHYTHM` / `DENSITY` / `RADIUS_PHILOSOPHY` / `BORDER_TREATMENT` / `SURFACE_TREATMENT` / `NAVIGATION_FEEL` / `DATA_LANGUAGE` / `MOTION_LANGUAGE` / `HIERARCHY_METHOD` |
| `MOTION_ROLES` | `enter` / `interact` / `ambient` / `data` |
| `StylePackMotion` / `StylePackProfile` | 契约类型 |
| `COMPONENT_API_VERSION` / `Intensity` / `Tone` / `INTENSITY_SCALE` / `TONE_VAR` | 组件契约的词汇 |
| `cx` / `resolveToneVars` | 组件的结构工具 |
| `tokens.css` | 变量词汇表 + 中立兜底值（未绑定 pack 时页面仍可读） |

> 组件专属的 `Intensity` / `Tone` / `cx` 曾散落在 `components/_shared/contract.ts`，
> 现在也收敛到 `contract.ts` 的同一份文件里，由本包统一导出。

---

## 为什么它可以没有 React

契约是**纯词汇表与纯函数**：枚举、类型、13 行变量映射、一个断言函数。
它不渲染任何东西，因此 `styles/*`（那三个 pack 一行 React 都没用）
不需要为了引用类型而拖进 React —— 第一版的 `peerDependencies: {"react": ">=18"}`
就是这样加错的。

组件侧的 React 依赖在 [`@kits/react-utils`](../react-utils/README.md)。

---

## 消费方怎么用

**Style Pack 作者**：`import type { StylePackMotion } from "@kits/contracts";`

**产品（Local Link 模式）**：

```ts
import { cinematicMotion } from "@kits/style-cinematic";
import { motionToCssVars } from "@kits/contracts";

const vars = motionToCssVars(cinematicMotion); // 注入 <html> 的 inline style
```

**产品（Source Installation 模式）**：不需要直接用它 ——
`kits add` 会把契约装进 `lib/kits/installed/contracts/`，
并把所有 `@kits/contracts` 说明符重写成相对路径。

---

## 边界

- ❌ 不放 React hook（那是 react-utils）
- ❌ 不放具体风格的取值（那是 style pack）
- ❌ 不放组件的实现（那是 components/*）
- ✅ 只放"风格可以用哪些话来说"这件事本身

契约的演进节奏见 [docs/architecture.md](../../docs/architecture.md)「契约层」一节；
分发机制见 [docs/distribution.md](../../docs/distribution.md)。
