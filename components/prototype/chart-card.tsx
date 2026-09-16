"use client"

import { motion } from "motion/react"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { durations, easings } from "@/lib/motion-presets"
import { cn } from "@/lib/utils"

type ChartCardProps = {
  title: string
  description?: string
  /** Extra action in the header (select, buttons, …). */
  action?: React.ReactNode
  height?: number
  loading?: boolean
  className?: string
  children: React.ReactNode
}

/**
 * Card shell for recharts visualizations. Give the chart a fixed height
 * through `height` (ResponsiveContainer needs a sized parent).
 *
 * The plot area sits on a faint recessed surface so the data reads as the
 * subject of the card rather than as floating ink.
 */
export function ChartCard({
  title,
  description,
  action,
  height = 288,
  loading = false,
  className,
  children,
}: ChartCardProps) {
  return (
    <Card className={cn("h-full", className)}>
      <CardHeader className="border-b border-border/60 pb-3">
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton style={{ height }} className="w-full rounded-card" />
        ) : (
          <motion.div
            style={{ height }}
            className="w-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: durations.enter, ease: easings.outExpo }}
          >
            {children}
          </motion.div>
        )}
      </CardContent>
    </Card>
  )
}
