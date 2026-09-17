/**
 * Signature Component Contract —— 组件层的稳定 API 契约。
 *
 * ## 为什么需要这一层
 *
 * 产品的界面代码**不允许**直接依赖第三方组件 API。原因不是洁癖：
 *   1. 第三方组件随时可能改 prop 名、改默认值、改 DOM 结构；
 *   2. 第三方组件的 API 反映的是它作者的抽象，不是我们的产品语义；
 *   3. 换一个第三方实现时，如果产品直接依赖它，就是全站重构。
 *
 * 因此强制这条链路：
 *
 *     外部资产 → inspect → adapter → 内部稳定 API → Product
 *                                    ↑
 *                              你只被允许用这个
 *
 * ## 三条硬规则
 *
 * 1. **内部 API 只表达产品语义**，不表达实现细节：
 *    `<SpotlightSurface tone="brand" intensity="medium" />`
 *    —— 不是 `<FancyGlowCard glowColor="#4fd6ff" blurRadius={24} />`。
 * 2. **视觉字面量一律禁止**。组件的样式只管结构与行为；
 *    颜色/圆角/间距/动效全部来自 `var(--kits-*)`，由 Style Pack 决定。
 * 3. **降级是 API 的一部分**。移动端与 reduced-motion 的 fallback 由组件内建，
 *    产品不需要（也不允许）自己写 `matchMedia` 分支。
 *
 * ## 版本策略
 *
 * 内部 API 用 `apiVersion` 标注（SemVer）。**破坏性变更必须升 major**，
 * 且必须在 `CHANGELOG` 段说明迁移方式。产品代码只依赖 major。
 */

/** 组件 API 的当前大版本。产品只依赖 major。 */
export const COMPONENT_API_VERSION = "1.0.0";

/** 性能分级。A = 静态 CSS；B = 合成友好但有滤镜/混合成本；C = 需要 JS 持续驱动。 */
export type PerformanceClass = "A" | "B" | "C";

/**
 * 强度刻度 —— 组件用它代替具体的数值。
 * `none` 是合法且重要的取值：产品应当能一键关掉装饰。
 */
export type Intensity = "none" | "subtle" | "medium" | "strong";

/** 强度 → 乘数。组件把这个乘数写进 CSS 变量，具体像素由 pack 决定。 */
export const INTENSITY_SCALE: Record<Intensity, number> = {
  none: 0,
  subtle: 0.5,
  medium: 1,
  strong: 1.6,
};

/**
 * 语调 —— 语义化的强调方向，映射到 pack 的颜色槽位。
 * 产品说 `tone="brand"`，而不是 `color="#4fd6ff"`。
 */
export type Tone = "neutral" | "brand" | "signal" | "critical";

/** 语调 → pack 颜色变量名。`--kits-*` 由 Style Pack 定义，组件不写死颜色。 */
export const TONE_VAR: Record<Tone, string> = {
  neutral: "--kits-color-ink",
  brand: "--kits-color-accent",
  signal: "--kits-color-accent-2",
  critical: "--kits-color-negative",
};

/** 所有组件共有的降级开关（产品可显式关闭，但**不需要**自己实现降级）。 */
export interface MotionFallbackProps {
  /**
   * 强制关闭动效。默认 `false` —— 组件已经内建
   * `prefers-reduced-motion` 与触屏降级，产品通常**不需要**传这个 prop。
   * 只有「用户主动关闭动画」这类产品级开关才用它。
   */
  disableMotion?: boolean;
}

/** 所有组件共有的布局注入点。 */
export interface LayoutProps {
  className?: string;
  style?: React.CSSProperties;
  id?: string;
}

export function cx(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * 把强度与语调编译成组件级的 CSS 自定义属性。
 * 组件把它挂在根元素上，样式表里只读变量——这样组件的 CSS
 * 完全不知道"medium 是多少"、"brand 是什么颜色"。
 */
export function resolveToneVars(
  tone: Tone,
  intensity: Intensity,
): Record<string, string> {
  return {
    "--kits-component-tone": `var(${TONE_VAR[tone]})`,
    "--kits-component-intensity": String(INTENSITY_SCALE[intensity]),
  };
}


/* ==========================================================================
 * Style Pack Contract 不在这里。
 *
 * 它曾以「复制一份」的形式存在于本文件末尾（`_shared/contract.ts` 与
 * `_contract/contract.ts` 的重复）。那正是本次 Integration Hardening 修掉的
 * 一类问题：同一份契约有两个副本，两边会各自漂移，而消费方无从判断哪份是真的。
 *
 * 现在只有一份，在 @kits/contracts：
 *   import { motionToCssVars, type StylePackMotion } from "@kits/contracts";
 * ======================================================================== */
