# @kits/react-utils

> **组件共享运行时。只依赖 React。**

```ts
import {
  useMotionAllowed,
  useFinePointer,
  usePrefersReducedMotion,
  useReveal,
  useElementPointer,
  useParallaxLayers,
  cx,
  resolveToneVars,
  type Intensity,
  type Tone,
} from "@kits/react-utils";
```

---

## 这个包解决什么问题

第一版里组件靠**向上跨包的相对路径**引用共享代码：

```
components/animated-grid/animated-grid.tsx  →  ../_shared/contract.ts
components/data-cursor/data-cursor.tsx      →  ../_shared/env.ts
```

两个后果，都在第一次真实集成时暴露：

1. **包无法被独立安装。** pnpm 的 `file:` 依赖只复制包目录本身 ——
   复制之后 `_shared/` 不存在，构建立刻失败。`link:` 能跑，但那要求
   产品与 Kits 共享同一棵目录树，正是 Distribution 要摆脱的东西。
2. **共享代码没有版本、没有边界、没有审计条目。** 它既不属于哪个组件，
   也不出现在 registry 里，因此"哪些代码进了产品"这件事对它是失效的。

抽成包之后：每个组件 `dependencies: {"@kits/react-utils": "workspace:*"}`，
依赖图由 registry 显式声明，安装器按拓扑序解析，产品拿到的是**自足的一份源码**。

---

## 导出面

### 能力探测（SSR 安全，首帧恒为保守值）

| Hook | 用途 |
|---|---|
| `usePrefersReducedMotion(forced?)` | 用户是否要求减少动效；**订阅运行中的偏好变化** |
| `useFinePointer()` | 是否有精确指针（鼠标/触控笔）；触屏返回 false |
| `useMotionAllowed(disableMotion?)` | 综合判据；返回 false 时组件应当**完全不注册监听** |

三条原则（写在源码顶部）：SSR 首帧保守 → 与服务端 HTML 逐字节一致，不存在
hydration mismatch；监听变化而非只读一次；产品不需要写任何 `matchMedia`。

### 指针与揭示

| Hook | 用途 |
|---|---|
| `useElementPointer` | 元素内的指针坐标 → CSS 变量（rAF 合并） |
| `useParallaxLayers(disableMotion?)` | 把 `[data-kits-depth]` 子元素转成视差层 |
| `useReveal({ disableMotion, once })` | 共享单例 `IntersectionObserver`，供 reveal 类组件使用 |

### 组件契约

`COMPONENT_API_VERSION`、`PerformanceClass`、`Intensity`、`INTENSITY_SCALE`、
`Tone`、`TONE_VAR`、`MotionFallbackProps`、`LayoutProps`、`cx`、`resolveToneVars`。

> Style Pack 的契约（`motionToCssVars` 等）**不在这里** —— 它在
> [`@kits/contracts`](../contracts/README.md)，因为那是纯 TS、零 React。

---

## 版本策略

```jsonc
"peerDependencies": { "react": "^18.0.0 || ^19.0.0" },
"devDependencies": { "@types/react": "^19.3.0", "react": "^19.2.0" }
```

**为什么不带自己的 React 副本**：Kits 的组件是源码分发，消费方会用自己的
React 与 `@types/react` 编译它们。若本包自带一份副本，就会在同一次编译里
出现两份 `VoidOrUndefinedOnly` —— 那正是第一次集成里
`insight-reveal.tsx(92,7): TS2322` 的真实根因（产品 19.2.18 / Kits 19.3.0）。

现在这件事有了守卫：`kits doctor` 的 `react-types-major-parity` 检查会在
两边的 `@types/react` major 不一致时直接报错，并说明修法，
而不是让产品在自己的 `tsc` 里收到一条指向 Kits 文件的费解错误。

`devDependencies` 只是为了让本仓库能对这几个文件做类型检查。

---

## 边界

- ❌ 不放 Style Pack 的契约（那是 `@kits/contracts`，纯 TS 零 React）
- ❌ 不放组件的实现（那是 `components/*`）
- ✅ 只放"每个组件都要用的那几件事"
