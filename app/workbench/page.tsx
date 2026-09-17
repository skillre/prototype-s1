import { WorkbenchView } from "@/components/prototype/workbench/workbench-view"

/**
 * `/workbench` —— STH 工作台本体（1680×1050 的固定画布 + scale-to-fit）。
 *
 * 路由 slug 保持英文，界面文案一律经 `useMessages()`（见 `docs`／AGENTS.md 的本地化规则）。
 *
 * 为什么它不在 `/`：首屏是**诚实的阶段页**（说清楚这是什么产品、当前到哪一步、下一步是什么），
 * 工作台是产品本体。两者职责不同，所以分成两条路由 —— 首屏在第一批组件落盘后更新阶段事实，
 * 而不是被一件还没长齐的东西顶掉（整屏装配是后面批次的事）。
 */
export default function WorkbenchPage() {
  return <WorkbenchView />
}
