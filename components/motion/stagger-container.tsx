"use client"

import { useId } from "react"
import { motion } from "motion/react"
import { staggerItem } from "@/lib/motion-presets"

type StaggerContainerProps = {
  children: React.ReactNode
  className?: string
  /** Delay between consecutive children, in seconds. */
  stagger?: number
  /** Delay before the first child, in seconds. */
  delayChildren?: number
  /** When true, replay the stagger when the container scrolls into view. */
  inView?: boolean
  once?: boolean
}

/**
 * Wraps each direct child in a motion item so the container staggers them.
 * Works with plain (non-motion) children such as Cards or custom sections.
 */
export function StaggerContainer({
  children,
  className,
  stagger = 0.07,
  delayChildren = 0.05,
  inView = false,
  once = true,
}: StaggerContainerProps) {
  const id = useId()
  const container = {
    hidden: {},
    show: {
      transition: { staggerChildren: stagger, delayChildren },
    },
  }
  const item = {
    hidden: staggerItem.hidden,
    show: { ...staggerItem.show },
  }

  const items = ReactChildrenToArray(children)

  return (
    <motion.div
      className={className}
      variants={container}
      initial="hidden"
      animate={inView ? undefined : "show"}
      whileInView={inView ? "show" : undefined}
      viewport={inView ? { once, amount: 0.15 } : undefined}
    >
      {items.map((child, index) => (
        <motion.div key={index === items.length - 1 ? `${id}-${index}` : `${id}-${index}`} variants={item}>
          {child}
        </motion.div>
      ))}
    </motion.div>
  )
}

function ReactChildrenToArray(children: React.ReactNode): React.ReactNode[] {
  return Array.isArray(children) ? children : [children]
}