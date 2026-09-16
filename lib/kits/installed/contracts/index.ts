/**
 * @kits/contracts —— 契约层入口。
 *
 * 这是 Kits 唯一一份契约定义。**纯 TypeScript，零 React 依赖**，
 * 因此 Style Pack（纯 CSS + TS）不需要为了引用类型而拖进 React。
 *
 * 消费方（产品 / 组件 / pack）一律从这里取：
 *
 *   import { motionToCssVars, assertStylePackMotion } from "@kits/contracts";
 *   import type { StylePackMotion, StylePackProfile } from "@kits/contracts";
 *
 * 为什么要有这个包（而不是让各 pack 各自 re-export）：
 * 契约的编译函数 `motionToCssVars()` 曾经对消费方不可达 —— 它躺在
 * `_contract/contract.ts` 里，而任何一个包的 `exports` 都没有暴露它。
 * 于是产品只能把 13 行变量表**手抄一遍**，那是一次静默的脱钩。
 * 现在它是公开 API，手抄的副本可以删掉。
 */

export * from "./contract";
