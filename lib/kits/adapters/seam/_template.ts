/**
 * Kits v0.2 · 中性角色文件模板（`adapters/seam/_template.ts`）
 *
 * 用法：把这个文件**复制**成你的角色名，例如 adapters/pointer.tsx，
 * 然后按下面两步填空。不要直接 import 本文件。
 *
 * 它属于**产品**：Kits 只在文件不存在时生成，永不覆盖。
 */

// 第 1 步 · 在 ../seam/seam.json 的 bindings 里声明角色 → 资产 id：
//
//   { "seamVersion": "0.2.0", "bindings": { "<角色名>": "<资产 id>" } }
//
// 资产 id 从哪来：看同目录下的资产适配文件（例如 ../data-cursor.tsx 对应
// 资产 id "data-cursor"），或跑 `kits doctor`，它会把本次安装里可绑定的资产列出来。

// 第 2 步 · 把下面这行换成真实导出（去掉注释），相对路径指向资产适配文件：
//
//   export {
//     <资产导出的组件名> as <角色名>,
//     type <资产导出的 Props> as <角色名 Props>,
//   } from "../<资产适配文件名>"
//
// 例（资产是 data-cursor、角色是 pointer）：
//
//   export { DataCursor as Pointer, type DataCursorProps as PointerProps } from "../data-cursor"

export {};
