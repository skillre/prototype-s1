/**
 * @kits/style-console —— pack 的 TypeScript 入口。
 *
 * CSS 是主入口，`tokens.css` 通过包名直接引入：
 *
 *   import "@kits/style-console/tokens.css";
 *
 * 本文件导出 pack 的 motion 契约与维度立场，供 Playground 的并排对比、
 * Registry 审计和测试使用。产品代码通常只需要 CSS + `data-kits-pack`。
 *
 * 导出名约定：`<id>Motion` / `<id>Profile` / `<id>Meta` ——
 * 安装器按同一规则推导（packages/cli/lib/adapters.mjs 的 styleExportNames），
 * tests/adapter-seam.spec.ts 会核对两者一致。
 */

import type { StylePackMotion, StylePackProfile } from "../contracts/index";
import { consoleMotion } from "./motion";

export { consoleMotion };
export default consoleMotion;

export const consoleMotionTokens: StylePackMotion = consoleMotion;

/**
 * console 在十个维度上的立场。
 *
 * 与另外三套的差异**不是每一维都独占一个枚举值**：radiusPhilosophy 与
 * editorial 同为 "flush"（两者都是 0 半径，这是允许的 —— 差异由其余九个
 * 维度与全部数值承担）。真正需要保住的是「没有两套 pack 共用同一套表面哲学」
 * 与「动效语言互不相同」这两条。
 */
export const consoleProfile: StylePackProfile = {
  typeVoice: "console",
  spacingRhythm: "columnar",
  density: "very-high",
  radiusPhilosophy: "flush",
  borderTreatment: "syntax-rule",
  surfaceTreatment: "cell-grid",
  navigationFeel: "command-line",
  dataLanguage: "log-stream",
  motionLanguage: "event-driven",
  hierarchyMethod: "luminance-and-weight",
};

export const consoleMeta = {
  id: "console",
  name: "Console",
  selector: '[data-kits-pack="console"]',
  cssEntry: "@kits/style-console/tokens.css",
} as const;
