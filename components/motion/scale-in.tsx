"use client"

import { motion } from "motion/react"
import { durations, easings } from "@/lib/motion-presets"

type ScaleInProps = {
  children: React.ReactNode
  className?: string
  /** Start scale; 1 disables scaling. */
  from?: number
  delay?: number
  duration?: number
  inView?: boolean
  once?: boolean
  style?: React.CSSProperties
}

/** Pop/zoom entrance for cards, modals content and emphasis moments. */
export function ScaleIn({
  children,
  className,
  from = 0.94,
  delay = 0,
  duration = durations.normal,
  inView = false,
  once = true,
  style,
}: ScaleInProps) {
  const initial = { opacity: 0, scale: from }
  const target = {
    opacity: 1,
    scale: 1,
    transition: { delay, duration, ease: easings.outExpo },
  }

  return (
    <motion.div
      className={className}
      style={style}
      initial={initial}
      animate={inView ? undefined : target}
      whileInView={inView ? target : undefined}
      viewport={inView ? { once, amount: 0.2 } : undefined}
    >
      {children}
    </motion.div>
  )
}