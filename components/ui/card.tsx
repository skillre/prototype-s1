import * as React from "react"
import { cn } from "cn"

/**
 * Surface card — the base of the whole visual language.
 *
 * Depth comes from three cheap layers rather than one heavy shadow:
 *   1. a tinted 1px ring (never pure black or pure white),
 *   2. the `shadow-card` elevation token (Light and Dark differ),
 *   3. an optional top sheen that reads as light falling on the surface.
 * Interactive cards opt into `interactive` so hover/press never appears on
 * decorative panels.
 */
function Card({
  className,
  size = "default",
  interactive = false,
  ...props
}: React.ComponentProps<"div"> & {
  size?: "default" | "sm"
  /** Adds hover lift + border tint. Only for cards that really are clickable. */
  interactive?: boolean
}) {
  return (
    <div
      data-slot="card"
      data-size={size}
      data-interactive={interactive || undefined}
      className={cn(
        "group/card relative flex flex-col gap-(--card-spacing) overflow-hidden rounded-card bg-surface py-(--card-spacing) text-sm text-surface-foreground shadow-card ring-1 ring-border/70 [--card-spacing:--spacing(4)]",
        "transition-[box-shadow,transform,border-color,--tw-ring-color] duration-hover ease-standard",
        "has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0",
        "*:[img:first-child]:rounded-t-card *:[img:last-child]:rounded-b-card",
        interactive &&
          "cursor-pointer hover:-translate-y-0.5 hover:shadow-elevated hover:ring-foreground/20 active:translate-y-0 active:duration-press",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-card px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-heading leading-snug group-data-[size=sm]/card:text-body group-data-[size=sm]/card:font-semibold",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-body-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-(--card-spacing)", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-card border-t bg-muted/40 p-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
