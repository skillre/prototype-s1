import type { Transition, Variants } from "motion/react"

/**
 * Motion presets — the JS mirror of the "Design tokens: motion" block in
 * app/globals.css. Keep the two in sync.
 *
 * Two axes, deliberately separated:
 *   1. `durations` / `easings` mirror the raw CSS tokens.
 *   2. `motion` groups them by *intent* (enter / exit / hover / press / modal /
 *      drawer / list / page). Components should reach for the intent, not the
 *      raw number — that is what keeps the whole prototype feeling like one
 *      product as it grows.
 */

/* -------------------------------------------------------------------------- */
/* Raw tokens — 1:1 with app/globals.css                                      */
/* -------------------------------------------------------------------------- */

export const durations = {
  instant: 0.1,
  fast: 0.18,
  normal: 0.28,
  slow: 0.5,
  glacial: 0.9,
  /* Semantic durations */
  press: 0.09,
  hover: 0.15,
  enter: 0.28,
  exit: 0.16,
  modal: 0.2,
  drawer: 0.34,
  list: 0.26,
  page: 0.32,
} as const

export const easings = {
  standard: [0.4, 0, 0.2, 1] as [number, number, number, number],
  outExpo: [0.16, 1, 0.3, 1] as [number, number, number, number],
  outBack: [0.34, 1.56, 0.64, 1] as [number, number, number, number],
  spring: [0.34, 1.36, 0.64, 1] as [number, number, number, number],
  emphasized: [0.2, 0.9, 0.25, 1] as [number, number, number, number],
} as const

/**
 * Same easings as CSS strings — for consumers that take a raw string
 * (dnd-kit's `dropAnimation`, inline `style`, etc.) instead of a Motion array.
 */
export const cssEasings = {
  standard: "cubic-bezier(0.4, 0, 0.2, 1)",
  outExpo: "cubic-bezier(0.16, 1, 0.3, 1)",
  outBack: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  spring: "cubic-bezier(0.34, 1.36, 0.64, 1)",
  emphasized: "cubic-bezier(0.2, 0.9, 0.25, 1)",
} as const

/** Milliseconds form of a duration token — for APIs that take a number. */
export const ms = (seconds: number): number => Math.round(seconds * 1000)

/** Soft, natural spring — layout shift, hover lift, drawer settle. */
export const softSpring: Transition = {
  type: "spring",
  stiffness: 260,
  damping: 26,
  mass: 0.6,
}

/** Quicker, slightly bouncier spring — press feedback and small pops. */
export const snappySpring: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 30,
  mass: 0.5,
}

/* -------------------------------------------------------------------------- */
/* Semantic presets — pick by intent                                          */
/* -------------------------------------------------------------------------- */

export const motion = {
  /** Element appears (fade + minimal rise). */
  enter: {
    duration: durations.enter,
    ease: easings.outExpo,
  } satisfies Transition,
  /** Element leaves — faster than it arrived, so the UI never feels sticky. */
  exit: {
    duration: durations.exit,
    ease: easings.standard,
  } satisfies Transition,
  /** Pointer rests on something. */
  hover: {
    duration: durations.hover,
    ease: easings.standard,
  } satisfies Transition,
  /** Pointer presses something — must feel immediate. */
  press: {
    duration: durations.press,
    ease: easings.standard,
  } satisfies Transition,
  /** Dialog + overlay. */
  modal: {
    duration: durations.modal,
    ease: easings.emphasized,
  } satisfies Transition,
  /** Side panel slide — spring settles it rather than stopping it dead. */
  drawer: softSpring,
  /** Items appearing in a list, in sequence. */
  list: {
    duration: durations.list,
    ease: easings.outExpo,
  } satisfies Transition,
  /** Route / view change. */
  page: {
    duration: durations.page,
    ease: easings.outExpo,
  } satisfies Transition,
} as const

/* -------------------------------------------------------------------------- */
/* Micro-interaction states                                                   */
/* -------------------------------------------------------------------------- */

/** Hover lift for interactive cards (KPI, board card, list row). */
export const hoverLift = { y: -3 } as const
/** Press feedback for anything clickable. */
export const pressScale = { scale: 0.975 } as const

/** Props bundle for `<motion.div whileHover={hoverLift} whileTap={pressScale} …>`. */
export const interactiveMotion = {
  whileHover: hoverLift,
  whileTap: pressScale,
  transition: softSpring,
} as const

/* -------------------------------------------------------------------------- */
/* Shared variants                                                            */
/* -------------------------------------------------------------------------- */

/** Shared stagger orchestration: place on the container, item variants on children. */
export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.06, delayChildren: 0.04 },
  },
}

/** Default stagger item — combine with <motion.div variants={staggerItem}>. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.992 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: durations.list, ease: easings.outExpo },
  },
}

/** Enter/exit pair for panels swapped in place (AnimatePresence mode="wait"). */
export const swapVariants: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: durations.enter, ease: easings.outExpo } },
  exit: { opacity: 0, y: -4, transition: { duration: durations.exit, ease: easings.standard } },
}

/** Entrance used by FadeIn / SlideIn / ScaleIn when custom props are not given. */
export const enter = (delay = 0, duration = durations.enter): Transition => ({
  delay,
  duration,
  ease: easings.outExpo,
})
