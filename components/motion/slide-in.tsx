"use client"

import { motion } from "motion/react"
import { durations, easings } from "@/lib/motion-presets"

type SlideInProps = {
  children: React.ReactNode
  className?: string
  /** Direction the element travels FROM. */
  direction?: "up" | "down" | "left" | "right"
  /** Travel distance in px. */
  distance?: number
  delay?: number
  duration?: number
  /** When true, animate on scroll into view instead of on mount. */
  inView?: boolean
  once?: boolean
  style?: React.CSSProperties
}

const offsets = {
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
} as const

/** Directional slide entrance, used for panels, drawers-adjacent surfaces and section reveals. */
export function SlideIn({
  children,
  className,
  direction = "up",
  distance = 24,
  delay = 0,
  duration = durations.normal,
  inView = false,
  once = true,
  style,
}: SlideInProps) {
  const { x, y } = offsets[direction]
  const initial = { opacity: 0, x: x * distance, y: y * distance }
  const target = {
    opacity: 1,
    x: 0,
    y: 0,
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