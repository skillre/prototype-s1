"use client"

import { useMessages } from "@/components/i18n/locale-provider"
import { ENVIRONMENT } from "@/lib/s1/seed"
import { cn } from "@/lib/utils"

/**
 * 演示环境标识 —— 已签署不变量 `boundary.demo-is-labelled-as-demo`。
 *
 * ## 它为什么长这样
 *
 * 不变量原文（`lib/s1/storyboard.ts` 的 `FRAME_INVARIANTS`，逐字）：
 *
 * > shell 常驻一处可见的演示环境标识（不是只在首屏出现、也不是可关闭的 toast）。
 * > 标识分两层：(a) 全场级：这是演示环境、数据与客户真实系统隔离；
 * > (b) 组件级：尚未真跑的组件另带自己的角标。
 * > **不得**用 aria-hidden 或隐藏元素冒充可见。
 *
 * 所以：
 *   • (a) 层 = `DemoEnvironmentLabel`，渲染在画布最底部一行（底栏之下）——每一帧都在，
 *     不随游标出现或消失；
 *   • (b) 层 = `ScriptedReplayBadge`，挂在具体组件上（④ 工具控制台挂在它的面板头上）。
 *
 * (a) 层的文案**逐字取种子** `environment.isolation` —— 那是事实底本对这套环境的记录
 * （记录内容不翻译，与 IP / hash / 时间戳同类）。(b) 层的文案是界面文案，走词典。
 */
export function DemoEnvironmentLabel({ className }: { className?: string }) {
  return (
    <p className={cn("s1-demo-label", className)} data-testid="demo-environment-label">
      {/*
       * 只有那个**圆点**是装饰，所以只有它 `aria-hidden` —— 文案本身必须可被读出。
       *
       * `aria-hidden` 这里写成字符串 `"true"` 而不是裸的布尔 `aria-hidden`：裸写会让
       * 服务端渲染出 `aria-hidden=""`、客户端算成 `aria-hidden="true"`，React 18+
       * 因此报**水合不匹配**（实测：`next start` 的控制台里有这条警告）。
       * 水合不匹配不是样式问题 —— 它意味着这一小段 DOM 被整体重新挂载，
       * 而这个组件正好是「不得用 aria-hidden 冒充可见」那条不变量的载体。
       */}
      <span aria-hidden="true" className="s1-demo-label__dot" />
      <span>{ENVIRONMENT.isolation}</span>
    </p>
  )
}

/**
 * 组件级角标（(b) 层）：这个组件在本阶段是脚本化回放，命令不落到真实主机。
 *
 * 出处：已签署决定 2（脚本化回放）与种子 `openItems` 第二条
 * 「④ 工具控制台的命令在本阶段**不落到真实主机**」。
 */
export function ScriptedReplayBadge({ className }: { className?: string }) {
  const t = useMessages()
  return (
    <span className={cn("s1-badge", className)} data-testid="scripted-replay-badge">
      {t.workbench.demo.scripted}
    </span>
  )
}
