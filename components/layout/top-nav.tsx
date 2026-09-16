"use client"

import Link from "next/link"
import { useTheme } from "@/components/theme-provider"
import { toast } from "sonner"
import {
  BellIcon,
  ChevronDownIcon,
  FlaskConicalIcon,
  LogOutIcon,
  MoonIcon,
  RotateCwIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useMessages } from "@/components/i18n/locale-provider"
import type { NavId } from "@/components/layout/sidebar"
import { cn } from "@/lib/utils"

/**
 * 通知条目的**结构**契约——由 Factory 定义，不由任何产品定义。
 *
 * v1.0.0 这里 import 了 `AppNotification`（来自 `@/lib/mock-data`），也就是
 * 共享顶栏的类型系统依赖了某一个原型的数据模块；结果 `lib/crm-data.ts` 不得不
 * 反向镜像同一个 union。现在只用结构类型：任何产品的通知，只要形状对得上就能用。
 */
export interface TopNavNotification {
  id: string
  title: string
  description: string
  /** 已格式化好的时间文案——相对时间的措辞是本地化行为，由调用方决定。 */
  time: string
  unread: boolean
  /**
   * 可选的分类标签，只用于挑图标；`notificationIcon` 未传时才回退到默认图标。
   * 用 string 而不是 union：分类是产品的词汇表，不是 Factory 的。
   */
  kind?: string
  /** 关联实体 id，供调用方生成详情页链接。 */
  customerId?: string
}

/**
 * 顶栏数据源——**必填**。
 *
 * v1.0.0 时它是可选的，不传就回落到 `useDashboardStore`：共享的 Core 布局组件
 * 因此硬依赖了某一个原型的 store，连「陈美雅 / meiya.chen@zhiwu.cn」这种账户
 * 身份都是从词典里默认带出来的。任何新原型不写一行代码就会继承这份身份。
 *
 * 现在没有默认。调用方必须显式给出通知、状态、动作与账户——AI CRM 已经这么做了，
 * Factory 自己的中立 demo 也走同一条路（见 app/demo/_components/demo-app.tsx）。
 */
export interface TopNavDataSource {
  notifications: TopNavNotification[]
  status: "loading" | "ready" | "error"
  onRefresh: () => void
  onSimulateFailure?: () => void
  onReset?: () => void
  onMarkAllRead: () => void
  /** 传入后，「退出登录」调用它（CRM 用它打开真实确认对话框）。 */
  onSignOut?: () => void
  /** 传入后，通知条目会导航到对应实体的详情页（而不是只弹 toast）。 */
  notificationHref?: (notification: TopNavNotification) => string
  /** 通知没有链接时的真实动作；不传则只弹 toast，不做任何导航。 */
  onNotificationSelect?: (notification: TopNavNotification) => void
  /** kind → 图标。不传时统一用 BellIcon。 */
  notificationIcon?: (notification: TopNavNotification) => LucideIcon
  /** 账户菜单里第一项的目标 id 与文案——必填，Factory 不替你选。 */
  primaryNavId: NavId
  primaryNavLabel: string
  account: { name: string; email: string; initials: string }
  /** 文案可覆盖；未传时取当前语言词典。 */
  labels?: {
    simulateSlowLoad?: string
    simulateFailure?: string
    resetData?: string
    resetToastTitle?: string
    resetToastDescription?: string
    markAllRead?: string
    signOut?: string
    signOutToastTitle?: string
    signOutToastDescription?: string
    notificationsEmpty?: string
    notifications?: string
    prototypeState?: string
    prototypeStateDescription?: string
    accountMenu?: string
  }
}

type TopNavProps = {
  title: string
  subtitle: string
  onOpenCommand: () => void
  onNavigate: (id: NavId) => void
  /** 必填：通知、状态、动作、账户全部由调用方注入。 */
  dataSource: TopNavDataSource
}

/** 桌面端顶栏：页面标题、全局搜索、刷新、主题、通知、演示控制、账户菜单。 */
export function TopNav({
  title,
  subtitle,
  onOpenCommand,
  onNavigate,
  dataSource,
}: TopNavProps) {
  const t = useMessages()

  const notifications = dataSource.notifications
  const markAllNotificationsRead = dataSource.onMarkAllRead
  const refresh = dataSource.onRefresh
  const simulateApiFailure = dataSource.onSimulateFailure
  const resetDemo = dataSource.onReset
  const status = dataSource.status
  const account = dataSource.account
  const primaryNavId = dataSource.primaryNavId
  const primaryNavLabel = dataSource.primaryNavLabel
  const notificationHref = dataSource.notificationHref
  const onNotificationSelect = dataSource.onNotificationSelect
  const notificationIcon = dataSource.notificationIcon
  const onSignOut = dataSource.onSignOut

  // Defaults come from the dictionary; a prototype only overrides what differs.
  const labels = {
    simulateSlowLoad: t.prototype.simulateSlowLoad,
    simulateFailure: t.prototype.simulateFailure,
    resetData: t.prototype.resetData,
    resetToastTitle: t.prototype.resetToastTitle,
    resetToastDescription: t.prototype.resetToastDescription,
    markAllRead: t.notifications.markAllRead,
    signOut: t.dialogs.signOut.confirm,
    signOutToastTitle: t.toast.signedOut,
    signOutToastDescription: t.toast.signedOutDescription,
    notificationsEmpty: t.notifications.empty,
    notifications: t.notifications.title,
    prototypeState: t.prototype.title,
    prototypeStateDescription: t.prototype.description,
    accountMenu: t.a11y.accountMenu,
    ...dataSource?.labels,
  }

  const { resolvedTheme, setTheme } = useTheme()

  const unreadCount = notifications.filter((n) => n.unread).length

  const toggleTheme = () => setTheme(resolvedTheme === "dark" ? "light" : "dark")

  const handleReset = () => {
    resetDemo?.()
    toast.success(labels.resetToastTitle, {
      description: labels.resetToastDescription,
    })
  }

  const openNotification = (notification: TopNavNotification) => {
    // 通知条目在有 href 时会自行导航；这里只负责「无链接」时的兜底反馈。
    if (notificationHref) return
    // 目标由调用方决定——v1.0.0 这里硬编码 onNavigate("activity")，是某一个
    // 原型的导航 id 漏进了共享组件。
    onNotificationSelect?.(notification)
    toast.info(notification.title)
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-hairline bg-background/80 px-4 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60 sm:px-6">
      {/*
        单行上下文，不做成第二份页面标题。页面标题属于页面头部/Hero；
        这里只回答"我在哪一层"以及"我能做什么"。
      */}
      <div className="flex min-w-0 items-baseline gap-2.5">
        <span className="truncate text-body-sm font-medium">{title}</span>
        <span aria-hidden className="hidden h-3 w-px shrink-0 bg-border xl:block" />
        <span className="hidden truncate text-label text-muted-foreground xl:inline">
          {subtitle}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-1">
        {/* 命令入口做成一个真实的输入框样式：它说明了"这里能搜"，也说明了快捷键。 */}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={t.a11y.openCommand}
                onClick={onOpenCommand}
                data-testid="open-command"
                className="h-8 gap-2 border-border/60 bg-surface/60 pl-2.5 font-normal text-muted-foreground shadow-none hover:border-border hover:bg-interactive hover:text-foreground md:w-60 md:justify-start"
              />
            }
          >
            <SearchIcon className="size-3.5" />
            <span className="hidden text-body-sm md:inline">{t.shell.commandHint}</span>
            <kbd className="kbd-chip ml-auto hidden md:inline-flex">⌘K</kbd>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t.a11y.commandHint}</TooltipContent>
        </Tooltip>

        <span aria-hidden className="mx-1 h-5 w-px bg-border" />

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t.a11y.refreshData}
                onClick={refresh}
                data-testid="refresh-data"
                className="text-muted-foreground hover:text-foreground"
              />
            }
          >
            <RotateCwIcon className={cn(status === "loading" && "animate-spin")} />
          </TooltipTrigger>
          <TooltipContent side="bottom">{t.a11y.refreshData}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t.a11y.toggleTheme}
                onClick={toggleTheme}
                data-testid="toggle-theme"
                className="text-muted-foreground hover:text-foreground"
              />
            }
          >
            {resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}
          </TooltipTrigger>
          <TooltipContent side="bottom">{t.a11y.toggleTheme}</TooltipContent>
        </Tooltip>

        {/* 通知 */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t.a11y.notifications}
                      data-testid="notifications"
                      className="relative text-muted-foreground hover:text-foreground"
                    />
                  }
                />
              }
            >
              <BellIcon />
              {unreadCount > 0 ? (
                <span className="absolute top-0.5 right-0.5 flex size-3.5 items-center justify-center rounded-full bg-danger text-[9px] font-semibold text-white shadow-subtle">
                  {unreadCount}
                </span>
              ) : null}
            </TooltipTrigger>
            <TooltipContent side="bottom">{t.a11y.notifications}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            align="end"
            className="w-80 rounded-panel border-border/70 p-1.5 shadow-floating"
          >
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>{labels.notifications}</span>
              {unreadCount > 0 ? (
                <span className="numeric text-label font-normal text-brand">
                  {t.notifications.unreadCount(unreadCount)}
                </span>
              ) : null}
            </DropdownMenuLabel>
            {notifications.length === 0 ? (
              <p className="px-2 py-4 text-center text-label text-muted-foreground">
                {labels.notificationsEmpty}
              </p>
            ) : (
              notifications.map((notification) => {
                // 图标由调用方决定；未注入时统一 BellIcon，而不是内置某产品
                // 的通知分类表（v1.0.0 的 KIND_ICON 会把 payment/trial/usage/report
                // 这套产品词汇固化进 Core，并逼着 lib/crm-data.ts 反向镜像它）。
                const Icon = notificationIcon?.(notification) ?? BellIcon
                const rowContent = (
                  <>
                    <span
                      className={cn(
                        "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-field transition-colors duration-hover",
                        notification.unread
                          ? "bg-brand-soft text-brand"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      <Icon className="size-3.5" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-1.5 text-label font-medium">
                        {notification.title}
                        {notification.unread ? (
                          <span className="size-1.5 rounded-full bg-brand" />
                        ) : null}
                      </span>
                      <span className="truncate text-label text-muted-foreground">
                        {notification.description}
                      </span>
                      <span className="numeric text-[10px] text-muted-foreground">
                        {notification.time}
                      </span>
                    </span>
                  </>
                )

                // 有对应客户时渲染为真实链接——通知条目本身可导航，不嵌套额外按钮。
                const href = notificationHref?.(notification)
                if (href) {
                  return (
                    <DropdownMenuItem
                      key={notification.id}
                      render={<Link href={href} />}
                      onSelect={() => openNotification(notification)}
                      className="items-start gap-2.5 rounded-field py-2"
                    >
                      {rowContent}
                    </DropdownMenuItem>
                  )
                }

                return (
                  <DropdownMenuItem
                    key={notification.id}
                    onSelect={() => openNotification(notification)}
                    className="items-start gap-2.5 rounded-field py-2"
                  >
                    {rowContent}
                  </DropdownMenuItem>
                )
              })
            )}
            {unreadCount > 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={markAllNotificationsRead}
                  className="justify-center text-label text-brand"
                >
                  {labels.markAllRead}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 演示控制——演示中唯一的"元"操作区，所有按钮都是真实动作。 */}
        <Popover>
          <Tooltip>
            <TooltipTrigger
              render={
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t.a11y.prototypeControls}
                      data-testid="demo-controls"
                      className="text-muted-foreground hover:text-foreground"
                    />
                  }
                />
              }
            >
              <FlaskConicalIcon />
            </TooltipTrigger>
            <TooltipContent side="bottom">{t.a11y.prototypeControls}</TooltipContent>
          </Tooltip>
          <PopoverContent align="end" className="w-72 rounded-panel shadow-floating">
            <PopoverHeader>
              <PopoverTitle>{labels.prototypeState}</PopoverTitle>
              <PopoverDescription className="text-label">
                {labels.prototypeStateDescription}
              </PopoverDescription>
            </PopoverHeader>
            <div className="flex flex-col gap-1">
              <Button variant="ghost" type="button" className="justify-start" onClick={refresh}>
                <RotateCwIcon /> {labels.simulateSlowLoad}
              </Button>
              <Button
                variant="ghost"
                type="button"
                className="justify-start text-danger hover:bg-danger-soft hover:text-danger"
                onClick={() => {
                  simulateApiFailure?.()
                  toast.error(t.toast.refreshFailed, {
                    description: t.toast.refreshFailedDescription,
                  })
                }}
              >
                <TriangleAlertIcon /> {labels.simulateFailure}
              </Button>
              <Separator className="my-1" />
              <Button variant="ghost" type="button" className="justify-start" onClick={handleReset}>
                <RotateCwIcon /> {labels.resetData}
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <Separator orientation="vertical" className="mx-1 h-6" />

        {/* 账户 */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={labels.accountMenu}
                data-testid="account-menu"
                className="gap-2 pl-1"
              />
            }
          >
            <Avatar size="sm">
              <AvatarFallback className="bg-brand-soft text-brand">
                {account.initials}
              </AvatarFallback>
            </Avatar>
            <span className="hidden text-label font-medium lg:inline">{account.name}</span>
            <ChevronDownIcon className="hidden size-3 text-muted-foreground lg:inline" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-60 rounded-panel border-border/70 p-1.5 shadow-floating"
          >
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-foreground">{account.name}</span>
              <span className="truncate text-[10px] font-normal text-muted-foreground">
                {account.email}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onNavigate(primaryNavId)} className="rounded-field">
              <SettingsIcon /> {primaryNavLabel}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              className="rounded-field"
              onSelect={() => {
                if (onSignOut) {
                  onSignOut()
                  return
                }
                handleReset()
                toast.success(labels.signOutToastTitle, {
                  description: labels.signOutToastDescription,
                })
              }}
            >
              <LogOutIcon /> {labels.signOut}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
