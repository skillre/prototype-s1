"use client"

import { AnimatePresence, motion } from "motion/react"
import { durations, easings } from "@/lib/motion-presets"

type PageTransitionProps = {
  children: React.ReactNode
  className?: string
  /** Change this key (route path, tab id, …) to trigger the transition. */
  transitionKey?: string
}

/**
 * Wraps page/tab content: cross-fades and slides whenever `transitionKey`
 * changes. Used by the demo tabs and by routes that want an entrance.
 */
export function PageTransition({
  children,
  className,
  transitionKey = "page",
}: PageTransitionProps) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={transitionKey}
        className={className}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{
          duration: durations.fast,
          ease: easings.standard,
        }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}