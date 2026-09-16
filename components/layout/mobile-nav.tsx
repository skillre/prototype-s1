"use client"

import { useState } from "react"
import { useTheme } from "@/components/theme-provider"
import { MenuIcon, MoonIcon, SearchIcon, SunIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent } from "@/components/ui/drawer"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useMessages } from "@/components/i18n/locale-provider"
import {
  SidebarNav,
  type NavBrandDef,
  type NavContextDef,
  type NavGroupDef,
  type NavId,
  type NavItemDef,
  type NavStatusDef,
  type NavUsageDef,
  type NavUserDef,
} from "@/components/layout/sidebar"

type MobileNavProps = {
  title: string
  active: NavId
  onNavigate: (id: NavId) => void
  onOpenCommand: () => void
  /** 产品身份三件套——必填，与 Sidebar 一致；Factory 不提供默认值。 */
  brand: NavBrandDef
  items: NavItemDef[]
  user: NavUserDef
  usage?: NavUsageDef | null
  context?: NavContextDef | null
  status?: NavStatusDef | null
  onOpenAccount?: () => void
  accountHint?: string
  sectionLabel?: string
  groups?: NavGroupDef[]
}

/** Sticky mobile header with a slide-in navigation drawer. `lg` and up uses TopNav instead. */
export function MobileNav({
  title,
  active,
  onNavigate,
  onOpenCommand,
  brand,
  items,
  user,
  usage,
  context,
  status,
  onOpenAccount,
  accountHint,
  sectionLabel,
  groups,
}: MobileNavProps) {
  const [open, setOpen] = useState(false)
  const { resolvedTheme, setTheme } = useTheme()
  const t = useMessages()

  const navigate = (id: NavId) => {
    setOpen(false)
    onNavigate(id)
  }

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-border/70 bg-background/75 px-3 backdrop-blur-xl lg:hidden">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t.a11y.openNav}
                onClick={() => setOpen(true)}
                data-testid="mobile-nav"
                className="text-muted-foreground hover:text-foreground"
              />
            }
          >
            <MenuIcon />
          </TooltipTrigger>
          <TooltipContent side="bottom">{t.a11y.openNav}</TooltipContent>
        </Tooltip>

        <span className="min-w-0 flex-1 truncate text-body-sm font-semibold">{title}</span>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t.a11y.openCommand}
                onClick={onOpenCommand}
                className="text-muted-foreground hover:text-foreground"
              />
            }
          >
            <SearchIcon />
          </TooltipTrigger>
          <TooltipContent side="bottom">{t.a11y.commandHint}</TooltipContent>
        </Tooltip>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t.a11y.toggleTheme}
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className="text-muted-foreground hover:text-foreground"
        >
          {resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}
        </Button>
      </header>

      <Drawer open={open} onOpenChange={setOpen} modal swipeDirection="left">
        <DrawerContent className="w-[78%] max-w-72 rounded-r-panel bg-sidebar text-sidebar-foreground shadow-floating">
          <SidebarNav
            active={active}
            onNavigate={navigate}
            brand={brand}
            items={items}
            user={user}
            usage={usage}
            context={context}
            status={status}
            onOpenAccount={
              onOpenAccount
                ? () => {
                    setOpen(false)
                    onOpenAccount()
                  }
                : undefined
            }
            accountHint={accountHint}
            sectionLabel={sectionLabel}
            groups={groups}
            /* Link 自己会完成导航，这里只需要把抽屉收起来。 */
            onLinkClick={() => setOpen(false)}
          />
        </DrawerContent>
      </Drawer>
    </>
  )
}
