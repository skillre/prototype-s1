"use client"

import { useState } from "react"
import { LogOutIcon } from "lucide-react"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useMessages } from "@/components/i18n/locale-provider"

type SignOutDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 确认后执行的真实动作（本原型里是重置本地会话状态）。 */
  onConfirm: () => void
  accountEmail?: string
  testId?: string
}

/**
 * 退出登录确认。原型没有真实鉴权，因此这里明确说明会发生什么，
 * 而不是假装完成一次登录态切换之后又把数据留在原地。
 */
export function SignOutDialog({
  open,
  onOpenChange,
  onConfirm,
  accountEmail,
  testId,
}: SignOutDialogProps) {
  const t = useMessages()
  const [pending, setPending] = useState(false)

  const confirm = () => {
    setPending(true)
    onConfirm()
    setPending(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid={testId}
        className="rounded-panel border-border/70 shadow-floating sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>{t.dialogs.signOut.title}</DialogTitle>
          <DialogDescription className="text-pretty">
            {t.dialogs.signOut.description(accountEmail)}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter showCloseButton={false}>
          <DialogClose render={<Button type="button" variant="outline" />}>
            {t.common.cancel}
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            onClick={confirm}
            disabled={pending}
            data-testid={testId ? `${testId}-confirm` : undefined}
          >
            <LogOutIcon />
            {t.dialogs.signOut.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
