"use client"

import { motion } from "motion/react"
import { durations, easings } from "@/lib/motion-presets"

type FadeInProps = {
  children: React.ReactNode
  className?: string
  /** Seconds before the animation starts. */
  delay?: number
  /** Animation duration in seconds. */
  duration?: number
  /** When true, animate on scroll into view instead of on mount. */
  inView?: boolean
  /** With inView: fire only once. */
  once?: boolean
  style?: React.CSSProperties
}

/** Fade + slight rise. The default entrance for text blocks and small primitives. */
export function FadeIn({
  children,
  className,
  delay = 0,
  duration = durations.normal,
  inView = false,
  once = true,
  style,
}: FadeInProps) {
  const initial = { opacity: 0, y: 12 }
  const target = {
    opacity: 1,
    y: 0,
    transition: { delay, duration, ease: easings.outExpo },
  }

  return (
    <motion.div
      className={className}
      style={style}
      initial={inView ? initial : initial}
      animate={inView ? undefined : target}
      whileInView={inView ? target : undefined}
      viewport={inView ? { once, amount: 0.2 } : undefined}
    >
      {children}
    </motion.div>
  )
}