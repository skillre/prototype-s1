"use client"

import Link from "next/link"
import { motion } from "motion/react"
import {
  BlocksIcon,
  ChevronRightIcon,
  RefreshCwIcon,
  type LucideIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useMessages } from "@/components/i18n/locale-provider"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { durations, easings } from "@/lib/motion-presets"

/**
 * 导航项 id：由调用方自行定义（demo 用 overview/customers/activity/settings，
 * CRM 用 dashboard/customers/tasks/activities）。保持 string 以便复用同一套
 * Sidebar / MobileNav。
 */
export type NavId = string

export interface NavItemDef {
  id: NavId
  label: string
  icon: LucideIcon
  /** 可选徽标数字（例如未读数）；为 0 或未传时不渲染。 */
  badge?: number
  /**
   * 可选真实路由。提供时导航项渲染为 <Link>（可新开标签、可分享 URL），
   * 否则退回为 button + onNavigate（Starter 的 /demo 仍走这条路径）。
   */
  href?: string
  /**
   * "action" 表示这是一个动作（例如打开对话框）而不是页面跳转，
   * 会与页面导航之间加分隔线并使用强调样式，避免语义混淆。
   */
  tone?: "nav" | "action"
}

/**
 * 导航分组。侧栏从"一串页面"升级为"两个语义区"：
 *   工作台   —— 页面之间的切换
 *   智能中心 —— 直达某个结论（洞察 / 风险 / 助手）
 * 分组是产品结构，不是视觉装饰，所以它由调用方显式给出。
 */
export interface NavGroupDef {
  id: string
  /** 省略标题即"动作块"：与页面导航之间加一条 hairline 分隔。 */
  label?: string
  items: NavItemDef[]
}

export interface NavBrandDef {
  name: string
  subtitle: string
  icon?: LucideIcon
  /** 自定义品牌图形（单个汉字或字母），优先于 icon。 */
  mark?: React.ReactNode
  /**
   * 给品牌方块加一条内高光（"材质"）。
   *
   * **默认关闭（Factory v1.2 · N1）。** 它属于视觉性格，不属于结构：
   * 侧栏是共享组件，一个默认打开的高光就是 Factory 替所有产品做的审美决定。
   * 想要就显式传 `sheen: true`（Reference Sample 就是这么做的）。
   */
  sheen?: boolean
}

export interface NavUserDef {
  name: string
  email: string
  initials: string
}

export interface NavUsageDef {
  label: string
  value: string
  progress: number
  hint: string
}

/**
 * 工作区上下文块：侧栏底部用真实派生数据说明"这个工作区现在处于什么状态"。
 * 它是侧栏留白的主体填充物，也是产品身份的一部分——不是装饰卡片。
 */
export interface NavContextDef extends NavUsageDef {
  /** 目标的另一半，例如 "¥2,400万"。渲染为 value / target。 */
  target?: string
}

/**
 * 系统状态块：实时指示 + 刷新。刷新是真实动作（调用方传入 handler）。
 */
export interface NavStatusDef {
  label: string
  hint: string
  busy?: boolean
  onRefresh?: () => void
  refreshLabel?: string
  /**
   * 给状态点加一圈扩散光晕（配合 `@keyframes live-halo`）。
   *
   * **默认关闭（Factory v1.2 · N1）。** 光晕是装饰性的：它不传递任何状态信息，
   * `label` 已经说了数据是不是实时的。所以由调用方显式打开。
   */
  pulse?: boolean
}

/*
 * NOTE (Factory v1.1) — there is deliberately NO default navigation here.
 *
 * v1.0.0 shipped `defaultNavItems(t)` returning `t.demo.nav.*`, plus fallbacks
 * for brand / user / usage that read `t.demo.*` and a literal `progress: 64`.
 * That is why every new prototype silently inherited one product's identity: a
 * fresh page would render 「云图分析 / 吴桐」 without anyone having chosen it.
 *
 * Injection is now REQUIRED. The Factory's own neutral demo passes its own
 * values at the call site (see app/demo/_components/demo-app.tsx) — exactly what
 * an AI CRM or an AI Finance must do. Removing the default is the point: a
 * default would be a Factory opinion about what the product is called, and the
 * Factory does not own that decision.
 */

/**
 * 品牌标识。
 *
 * 这是侧栏里唯一的"产品身份"时刻：一个实心品牌色方块 + 一条内高光，
 * 右侧是产品名 + 工作区语境。刻意不用渐变、不用发光——识别度来自
 * 方块本身的分量（36px、接近满饱和）而不是特效。
 */
function Brand({ brand }: { brand: NavBrandDef }) {
  const Icon = brand.icon ?? BlocksIcon
  return (
    <div className="flex items-center gap-2.5 px-3 pt-4 pb-3.5">
      <span className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[11px] bg-brand text-brand-foreground shadow-subtle ring-1 ring-brand/25 ring-inset">
        {/* 内高光：让实心块有"材质"，不需要阴影堆叠。显式 opt-in，见 NavBrandDef.sheen。 */}
        {brand.sheen ? <span aria-hidden className="surface-sheen absolute inset-0" /> : null}
        {brand.mark ?? <Icon className="relative size-4" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-none">
        <span className="truncate text-body-sm font-semibold tracking-[0.01em]">
          {brand.name}
        </span>
        <span className="truncate text-[0.6875rem] text-muted-foreground">
          {brand.subtitle}
        </span>
      </div>
    </div>
  )
}

/** 导航列——桌面 Sidebar 与移动 Drawer 共用。 */
export function SidebarNav({
  active,
  onNavigate,
  brand,
  items,
  user,
  /** 传 null 隐藏底部用量卡片。 */
  usage,
  /** 工作区上下文块（优先于 usage，二者形状相同）。 */
  context,
  /** 状态块——传了才渲染。 */
  status,
  /** 点击用户卡片时的真实动作（例如打开个人资料对话框）。 */
  onOpenAccount,
  accountHint,
  /** 页面导航上方的分组标题（未传 groups 时使用）。 */
  sectionLabel,
  /** 显式分组——传了就完全接管 items 的渲染。 */
  groups,
  /** 带 href 的导航项被点击时的副作用（导航本身仍由 Link 负责）。 */
  onLinkClick,
  navLabel,
  /** 顶部动作按钮组（例如命令面板 / 主题）。 */
  utilities,
}: {
  active: NavId
  onNavigate: (id: NavId) => void
  /** 产品身份三件套——必填，Factory 不提供默认值。 */
  brand: NavBrandDef
  items: NavItemDef[]
  user: NavUserDef
  /** 传 null 隐藏底部用量卡片；不传同样隐藏（不再有内置默认卡片）。 */
  usage?: NavUsageDef | null
  context?: NavContextDef | null
  status?: NavStatusDef | null
  onOpenAccount?: () => void
  accountHint?: string
  sectionLabel?: string
  groups?: NavGroupDef[]
  onLinkClick?: (id: NavId) => void
  navLabel?: string
  utilities?: React.ReactNode
}) {
  const t = useMessages()
  const resolvedContext: NavContextDef | null = context ?? null
  // 工作区上下文块优先于 usage；两者都没传时不渲染底部卡片。
  const resolvedUsage: NavUsageDef | null = resolvedContext ?? usage ?? null

  const pageItems = items.filter((item) => item.tone !== "action")
  const actionItems = items.filter((item) => item.tone === "action")
  /**
   * 只有当调用方**没有**给出 `groups` 时才单独渲染动作块。
   *
   * 显式 `groups` 已经决定了动作块放在哪里——某个分组本身可能就是动作块。
   * 两种渲染同时生效会让同一个动作出现两次：CRM 传入 `groups`（其中含
   * 「添加客户」动作）之后，`items` 里同一项又会走一遍动作块分支，
   * `nav-add-customer` 于是解析到两个元素。v1.0.0 没暴露这个问题，
   * 只因为那时 `items` 回落到演示默认值（不含 action），动作块恒为空。
   */
  const hasExplicitGroups = Boolean(groups && groups.length > 0)
  const standaloneActionItems = hasExplicitGroups ? [] : actionItems
  const resolvedGroups: NavGroupDef[] =
    hasExplicitGroups && groups
      ? groups
      : [{ id: "primary", label: sectionLabel ?? t.a11y.sectionLabel, items: pageItems }]

  return (
    <div className="flex h-full flex-col">
      <Brand brand={brand} />
      <span aria-hidden className="mx-3 h-px bg-sidebar-border" />

      {/*
        中段滚动：导航 + 目标。条目变多之后，底部状态与身份必须永远可达，
        因此只有中段滚动，页脚固定——而不是整栏一起溢出。
      */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <nav
        className="flex flex-col gap-0.5 px-2 pt-3"
        aria-label={navLabel ?? t.a11y.primaryNav}
      >
        {resolvedGroups.map((group, groupIndex) => (
          <div key={group.id} className="flex flex-col gap-0.5">
            {/* 无标题的分组是"动作块"：用一条 hairline 与页面导航分开。 */}
            {groupIndex > 0 && !group.label ? (
              <span aria-hidden className="mx-2.5 my-2 h-px bg-sidebar-border" />
            ) : null}

            {group.label ? (
              <span
                className={cn(
                  "eyebrow px-2.5 pb-2 text-muted-foreground/55",
                  groupIndex > 0 && "pt-3.5"
                )}
              >
                {group.label}
              </span>
            ) : null}

            {group.items.map((item) => {
              const isActive = item.id === active
              const isAction = item.tone === "action"
              const Icon = item.icon
              const itemClass = cn(
                "group/nav-item relative flex h-9 items-center gap-2.5 rounded-field px-2.5 text-body-sm outline-none transition-[color,background-color] duration-hover ease-standard",
                "focus-visible:ring-2 focus-visible:ring-ring/50",
                isAction
                  ? "font-medium text-muted-foreground hover:bg-brand-soft hover:text-brand"
                  : isActive
                    ? "bg-brand-soft font-semibold text-brand ring-1 ring-brand/12 ring-inset"
                    : "font-medium text-muted-foreground hover:bg-interactive hover:text-foreground"
              )
              const content = (
                <>
                  {/* 激活指示：一条从条目中心长出来的左侧轨道。 */}
                  {isActive && !isAction ? (
                    <motion.span
                      aria-hidden
                      initial={{ scaleY: 0, opacity: 0 }}
                      animate={{ scaleY: 1, opacity: 1 }}
                      transition={{ duration: durations.hover, ease: easings.outExpo }}
                      className="absolute top-1/2 left-0 h-4.5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand"
                    />
                  ) : null}
                  <Icon
                    className={cn(
                      "size-4 shrink-0 transition-transform duration-hover ease-standard",
                      isAction
                        ? "group-hover/nav-item:rotate-90"
                        : isActive
                          ? "text-brand"
                          : "group-hover/nav-item:translate-x-0.5"
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                  {item.badge && item.badge > 0 ? (
                    <Badge
                      className={cn(
                        "h-4.5 min-w-4.5 px-1 text-[10px] font-medium tabular-nums",
                        isActive
                          ? "bg-brand/15 text-brand"
                          : "bg-muted text-muted-foreground group-hover/nav-item:bg-background"
                      )}
                    >
                      {item.badge}
                    </Badge>
                  ) : null}
                </>
              )

              // 有真实路由时用 <Link>：可分享 URL、可新开标签、可被爬虫/测试直接访问。
              if (item.href) {
                return (
                  /*
                   * 用原生 <a href> 而不是 next/link：
                   * 这里需要**恰好一条**导航路径。next/link 会在自己的
                   * click 处理里再 push 一次，两条路径在同一帧里竞争时，
                   * 浏览器可能抢到默认行为 —— 那就是一次整页刷新，而整页
                   * 刷新会丢掉内存里的 store（拖拽结果、筛选、AI 摘要）。
                   * 保留 href 是为了可访问性、右键菜单与新标签页；
                   * 带修饰键的点击仍然交给浏览器，不做拦截。
                   */
                  <Link
                    key={item.id}
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    /* 显式 aria-label：徽标数字是补充信息，不能让可访问名变成
                       "客户 22"——导航项的名字始终只有它的页面名。 */
                    aria-label={item.label}
                    data-testid={`nav-${item.id}`}
                    /* 兜底监听器靠这个属性识别"这是一次页面级导航"。 */
                    data-nav-href={item.href}
                    /* 导航由 Link 独占：这里只跑副作用（关闭移动端抽屉）。
                       再叠一次 router.push 会让同一帧出现两条导航路径，
                       连续快速跳转时路由会退化成整页导航，内存里的 store
                       会被清空（拖拽结果、筛选、AI 摘要）。 */
                    onClick={onLinkClick ? () => onLinkClick(item.id) : undefined}
                    className={itemClass}
                  >
                    {content}
                  </Link>
                )
              }

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={item.label}
                  data-testid={`nav-${item.id}`}
                  className={itemClass}
                >
                  {content}
                </button>
              )
            })}
          </div>
        ))}

        {standaloneActionItems.length > 0 ? (
          <>
            <span aria-hidden className="mx-2.5 my-2.5 h-px bg-sidebar-border" />
            {standaloneActionItems.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  data-testid={`nav-${item.id}`}
                  className={cn(
                    "group/nav-action flex h-9 items-center gap-2.5 rounded-field px-2.5 text-body-sm font-medium outline-none transition-[color,background-color] duration-hover ease-standard",
                    "text-muted-foreground hover:bg-brand-soft hover:text-brand focus-visible:ring-2 focus-visible:ring-ring/50"
                  )}
                >
                  <Icon className="size-4 shrink-0 transition-transform duration-hover ease-standard group-hover/nav-action:rotate-90" />
                  <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                </button>
              )
            })}
          </>
        ) : null}
      </nav>

      {/*
        工作区上下文紧跟导航，而不是被推到底部：它回答的是"我在哪、这个
        工作区现在怎么样"，属于导航的一部分。底部只留状态与身份。
        剩下那段留白因此读作"内容结束后的呼吸"，而不是"这里缺一块"。
      */}
      {resolvedUsage ? (
        <div className="px-3 pt-4">
          <div className="rounded-panel border border-sidebar-border bg-surface/55 p-3">
            <span className="eyebrow text-muted-foreground/70">{resolvedUsage.label}</span>

            {/* 进度是这里的第一个数字——侧栏回答的是"离目标还有多远"。 */}
            <div className="mt-2 flex items-baseline gap-1">
              <span className="numeric text-subtitle font-semibold">
                {resolvedUsage.progress}
              </span>
              <span className="text-body font-medium text-muted-foreground">%</span>
            </div>

            <div className="mt-1 flex flex-wrap items-baseline gap-x-1">
              <span className="numeric text-label font-medium">{resolvedUsage.value}</span>
              {resolvedContext?.target ? (
                <span className="numeric text-label text-muted-foreground">
                  / {resolvedContext.target}
                </span>
              ) : null}
            </div>

            <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full rounded-full bg-brand"
                initial={{ width: 0 }}
                animate={{ width: `${resolvedUsage.progress}%` }}
                transition={{ duration: durations.slow, ease: easings.outExpo }}
              />
            </div>
            <p className="mt-2 text-[0.6875rem] leading-snug text-muted-foreground">
              {resolvedUsage.hint}
            </p>
          </div>
        </div>
      ) : null}
      </div>

      <div className="mt-auto flex flex-col gap-2.5 p-3">
        {status ? (
          <div className="flex items-center gap-2 rounded-field px-2.5 py-1.5">
            <span className="relative flex size-2 shrink-0 items-center justify-center">
              {status.pulse ? (
                <span
                  aria-hidden
                  className="absolute size-2 rounded-full bg-success/35 [animation:live-halo_3.2s_ease-out_infinite]"
                />
              ) : null}
              <span className="relative size-1.5 rounded-full bg-success" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-label font-medium">{status.label}</span>
              <span className="truncate text-[0.6875rem] text-muted-foreground">{status.hint}</span>
            </span>
            {status.onRefresh ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={status.refreshLabel}
                      onClick={status.onRefresh}
                      data-testid="sidebar-refresh"
                      className="text-muted-foreground hover:text-foreground"
                    />
                  }
                >
                  <RefreshCwIcon className={cn(status.busy && "animate-spin")} />
                </TooltipTrigger>
                <TooltipContent side="top">{status.refreshLabel}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        ) : null}

        {utilities ? <div className="flex items-center gap-1 px-0.5">{utilities}</div> : null}

        {/* 用户身份：有真实目的地时是按钮（进入个人资料），否则是纯展示。 */}
        {onOpenAccount ? (
          <button
            type="button"
            onClick={onOpenAccount}
            aria-label={accountHint}
            data-testid="sidebar-account"
            className="group/account flex w-full items-center gap-2.5 rounded-panel border border-sidebar-border bg-surface/55 p-2 text-left outline-none transition-colors duration-hover hover:border-brand/25 hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <Avatar size="sm">
              <AvatarFallback className="bg-brand-soft text-brand">
                {user.initials}
              </AvatarFallback>
            </Avatar>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-label font-semibold">{user.name}</span>
              <span className="truncate text-[0.6875rem] text-muted-foreground">
                {user.email}
              </span>
            </span>
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/50 transition-transform duration-hover group-hover/account:translate-x-0.5 group-hover/account:text-brand" />
          </button>
        ) : (
          <div className="flex items-center gap-2.5 rounded-panel border border-sidebar-border bg-surface/55 p-2 transition-colors duration-hover hover:bg-surface">
            <Avatar size="sm">
              <AvatarFallback className="bg-brand-soft text-brand">
                {user.initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-label font-semibold">{user.name}</span>
              <span className="truncate text-[0.6875rem] text-muted-foreground">
                {user.email}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** 固定桌面侧栏——`lg` 以下隐藏。 */
export function Sidebar({
  active,
  onNavigate,
  brand,
  items,
  user,
  usage,
  context,
  status,
  onOpenAccount,
  accountHint,
  utilities,
  sectionLabel,
  groups,
  onLinkClick,
  navLabel,
}: {
  active: NavId
  onNavigate: (id: NavId) => void
  /** 产品身份三件套——必填，Factory 不提供默认值。 */
  brand: NavBrandDef
  items: NavItemDef[]
  user: NavUserDef
  usage?: NavUsageDef | null
  context?: NavContextDef | null
  status?: NavStatusDef | null
  onOpenAccount?: () => void
  accountHint?: string
  utilities?: React.ReactNode
  sectionLabel?: string
  groups?: NavGroupDef[]
  onLinkClick?: (id: NavId) => void
  navLabel?: string
}) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
      <SidebarNav
        active={active}
        onNavigate={onNavigate}
        brand={brand}
        items={items}
        user={user}
        usage={usage}
        context={context}
        status={status}
        onOpenAccount={onOpenAccount}
        accountHint={accountHint}
        utilities={utilities}
        sectionLabel={sectionLabel}
        groups={groups}
        onLinkClick={onLinkClick}
        navLabel={navLabel}
      />
    </aside>
  )
}
