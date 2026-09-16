"use client"

import { Building2Icon, MailIcon, ShieldCheckIcon, UserIcon } from "lucide-react"
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { useMessages } from "@/components/i18n/locale-provider"

export interface ProfileDetails {
  name: string
  email: string
  initials: string
  role: string
  workspace: string
  plan: string
}

type ProfileDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: ProfileDetails
  testId?: string
}

/** 账户菜单「个人资料」的真实落地页：一个只读的资料面板。 */
export function ProfileDialog({ open, onOpenChange, profile, testId }: ProfileDialogProps) {
  const t = useMessages()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid={testId}
        className="rounded-panel border-border/70 shadow-floating sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>{t.dialogs.profile.title}</DialogTitle>
          <DialogDescription>{t.dialogs.profile.description(profile.workspace)}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 rounded-card border border-border/60 bg-muted/30 p-3">
          <Avatar size="lg">
            <AvatarFallback className="bg-brand-soft text-brand">{profile.initials}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-body font-medium">{profile.name}</span>
            <span className="truncate text-caption text-muted-foreground">{profile.role}</span>
          </div>
          <Badge variant="outline" className="ml-auto shrink-0">
            {profile.plan}
          </Badge>
        </div>

        <Separator />

        <dl className="flex flex-col gap-3">
          <ProfileRow icon={MailIcon} label={t.dialogs.profile.email} value={profile.email} />
          <ProfileRow
            icon={Building2Icon}
            label={t.dialogs.profile.workspace}
            value={profile.workspace}
          />
          <ProfileRow icon={UserIcon} label={t.dialogs.profile.role} value={profile.role} />
          <ProfileRow icon={ShieldCheckIcon} label={t.dialogs.profile.plan} value={profile.plan} />
        </dl>

        <DialogFooter showCloseButton={false}>
          <DialogClose render={<Button type="button" variant="outline" />}>
            {t.common.close}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProfileRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MailIcon
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="ml-auto truncate text-body-sm font-medium">{value}</dd>
    </div>
  )
}
