"use client"

import { XIcon } from "lucide-react"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Button } from "@/components/ui/button"
import { useMessages } from "@/components/i18n/locale-provider"
import { cn } from "@/lib/utils"

type DetailDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
  /** Lands on the drawer panel — used by e2e tests. */
  testId?: string
  /** 关闭按钮的无障碍标签，默认取 `t.common.close`。 */
  closeLabel?: string
}

/**
 * Right-side detail panel. On mobile it spans 90% of the viewport and can
 * be swiped away; on desktop it settles at a fixed width.
 *
 * The panel reads as a floating surface rather than a wall: a large radius, a
 * real shadow and a hairline border on the edge facing the page. The header is
 * sticky so the identity of the record stays visible while the body scrolls.
 */
export function DetailDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  testId,
  closeLabel,
}: DetailDrawerProps) {
  const t = useMessages()

  return (
    <Drawer open={open} onOpenChange={onOpenChange} modal swipeDirection="right">
      <DrawerContent
        data-testid={testId}
        className={cn(
          "data-[swipe-axis=x]:[--drawer-content-width:92%] sm:data-[swipe-axis=x]:[--drawer-content-width:26rem] xl:data-[swipe-axis=x]:[--drawer-content-width:30rem]",
          "border-border/70 bg-elevated shadow-floating",
          className
        )}
      >
        <DrawerHeader className="sticky top-0 z-10 flex-row items-start justify-between gap-3 border-b border-border/60 bg-elevated/85 text-left backdrop-blur-xl max-md:py-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title ? <DrawerTitle className="truncate">{title}</DrawerTitle> : null}
            {description ? <DrawerDescription className="truncate">{description}</DrawerDescription> : null}
          </div>
          <DrawerClose
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={closeLabel ?? t.common.close}
                className="mt-0.5 text-muted-foreground hover:text-foreground"
              />
            }
          >
            <XIcon />
          </DrawerClose>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-6">
          {children}
        </div>
        {footer ? (
          <DrawerFooter className="border-t border-border/60 bg-elevated/85 pt-4 backdrop-blur-xl">
            {footer}
          </DrawerFooter>
        ) : null}
      </DrawerContent>
    </Drawer>
  )
}
