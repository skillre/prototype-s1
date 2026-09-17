/**
 * @kits/react-utils —— 组件共享运行时入口。
 *
 * 组件（components/*）通过它拿到能力探测与指针 hook，
 * 而不是靠 `../_shared/*` 这种向上跨包的相对路径 —— 后者正是
 * 「package 无法被独立安装」的根因（`file:` 安装只复制包目录本身）。
 */

export * from "./contract";
export * from "./env";
export { useElementPointer } from "./use-element-pointer";
export { useParallaxLayers } from "./use-parallax-layers";
export { useReveal } from "./use-reveal";
