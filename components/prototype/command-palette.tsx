"use client"

import { useMemo, useState } from "react"
import { SparklesIcon } from "lucide-react"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { useMessages } from "@/components/i18n/locale-provider"
import { AmbientBackdrop } from "@/components/prototype/ambient-backdrop"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

export interface PaletteItem {
  id: string
  label: string
  icon?: LucideIcon
  /** 副标题——用来交代这条命令会落到哪里（金额、阶段、数量…）。 */
  description?: string
  /** e.g. "⌘K" — rendered right-aligned. */
  shortcut?: string
  /** Extra tokens for fuzzy matching beyond the label. */
  keywords?: string
  /** Lands on the item element — used by e2e tests. */
  testId?: string
  onSelect: () => void
}

export interface PaletteGroup {
  heading?: string
  items: PaletteItem[]
}

type CommandPaletteProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 静态分组；与 `renderGroups` 二选一。 */
  groups?: PaletteGroup[]
  /**
   * 动态分组。传了它就完全接管渲染——调用方可以按当前输入生成"记录检索"
   * 结果，而面板本身不需要知道数据从哪来。
   */
  renderGroups?: (query: string, mode: "search" | "ai") => PaletteGroup[]
  /** `ai` 把面板从"命令入口"切换成"提问入口"。 */
  mode?: "search" | "ai"
  placeholder?: string
  /** 底部提示条。 */
  hint?: string
  /** Lands on the dialog panel — used by e2e tests. */
  testId?: string
  /**
   * 打开命令面板背后的环境光。
   *
   * **默认关闭（Factory v1.2 · N1）。** 环境光是性格不是结构；要它就显式传
   * `ambient`（Reference Sample 就是这么做的）。
   */
  ambient?: boolean
}

/**
 * Command Center。
 *
 * 它曾经只是一个换了皮肤的导航菜单。现在它是产品的核心入口：
 *
 *   • **分组承担语义**——导航 / 客户 / 智能 / 操作，四组各回答一类问题。
 *   • **记录检索是真实的**——输入两个字符，客户以"公司 + 金额 + 阶段"的
 *     形态直接出现在结果里，选中即进入该客户档案。
 *   • **输入被高亮**——命中的字符在标签里加粗变品牌色，这是"我输入的词
 *     被听懂了"的唯一可见证据。
 *   • **AI 模式**——从侧栏「AI 助手」进入时，智能组提到最前、占位文案
 *     换成提问语气；它调用的仍然是确定性本地逻辑，不是外部接口。
 *
 * 视觉上它仍然是少数几个配得上完整 ambient 处理的表面：一个刻意的、
 * 临时的焦点层。浮层用 Card 是 V3 允许的——这次是它该出现的地方。
 */
export function CommandPalette({
  open,
  onOpenChange,
  groups = [],
  renderGroups,
  mode = "search",
  placeholder,
  hint,
  testId,
  ambient = false,
}: CommandPaletteProps) {
  const t = useMessages()
  const [query, setQuery] = useState("")

  /* 关闭即清空检索词：命令面板每次都从同一状态开始，
     否则上一次的输入会跟着用户进到下一次打开。 */
  const handleOpenChange = (next: boolean) => {
    if (!next) setQuery("")
    onOpenChange(next)
  }

  const resolvedGroups = useMemo(
    () => (renderGroups ? renderGroups(query, mode) : groups),
    [groups, query, mode, renderGroups]
  )

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t.palette.title}
      description={t.a11y.commandHint}
    >
      <div data-testid={testId} className="relative isolate overflow-hidden rounded-panel">
        {/* 面板环境光：显式 opt-in（Factory v1.2 · N1）。默认关闭——共享组件的
            默认值就是 Factory 的审美决定，而 Factory 不拥有这个决定。 */}
        {ambient ? <AmbientBackdrop variant="panel" grid /> : null}
        <Command loop className="relative bg-transparent">
          {mode === "ai" ? (
            <span
              data-testid="command-palette-ai"
              className="flex items-center gap-2 border-b border-hairline px-3 py-2 text-label font-medium text-brand"
            >
              <SparklesIcon className="size-3.5" />
              {t.palette.intelligence}
            </span>
          ) : null}

          {/* 输入受控：分组需要知道当前搜索词才能生成"客户"这一组。 */}
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={placeholder ?? t.palette.placeholder}
          />
          <CommandList className="max-h-[26rem]">
            <CommandEmpty>{t.palette.empty}</CommandEmpty>
            {resolvedGroups.map((group, index) => (
              <CommandGroup key={group.heading ?? index} heading={group.heading}>
                {group.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <CommandItem
                      key={item.id}
                      data-testid={item.testId}
                      /* 只在标签与关键词上匹配：描述是"结果长什么样"，不是搜索面——
                         否则输入公司名会先命中文案里提到它的命令。 */
                      value={`${item.label} ${item.keywords ?? ""}`}
                      onSelect={() => {
                        item.onSelect()
                        onOpenChange(false)
                      }}
                      className={cn(
                        "group/item gap-2.5 rounded-field py-2 transition-colors duration-hover",
                        "data-selected:bg-brand-soft data-selected:text-brand"
                      )}
                    >
                      {Icon ? (
                        <Icon className="text-muted-foreground transition-colors duration-hover group-data-selected/item:text-brand" />
                      ) : null}
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                        <span className="truncate">
                          <Highlight text={item.label} query={query} />
                        </span>
                        {item.description ? (
                          <span className="truncate text-label text-muted-foreground">
                            {item.description}
                          </span>
                        ) : null}
                      </span>
                      {item.shortcut ? (
                        <CommandShortcut className="kbd-chip ml-auto tracking-normal">
                          {item.shortcut}
                        </CommandShortcut>
                      ) : null}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))}
          </CommandList>

          {hint ? (
            <span className="flex items-center justify-between gap-3 border-t border-hairline px-3 py-2 text-label text-muted-foreground">
              {hint}
            </span>
          ) : null}
        </Command>
      </div>
    </CommandDialog>
  )
}

/** 把输入命中的那一段标出来——搜索必须让人看见自己被听懂了。 */
function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim()
  if (!needle) return <>{text}</>

  const index = text.toLowerCase().indexOf(needle.toLowerCase())
  if (index < 0) return <>{text}</>

  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-transparent font-semibold text-brand">
        {text.slice(index, index + needle.length)}
      </mark>
      {text.slice(index + needle.length)}
    </>
  )
}
