"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { animate, motion } from "motion/react"
import { durations, easings } from "@/lib/motion-presets"

type AnimatedNumberProps = {
  /** Target value. Changes animate from the previous value. */
  value: number
  className?: string
  prefix?: string
  suffix?: string
  /** Animation duration in seconds. */
  duration?: number
  delay?: number
  /** Intl.NumberFormat options (maximumFractionDigits etc.). */
  formatOptions?: Intl.NumberFormatOptions
  /** Custom formatter — takes priority over formatOptions (e.g. seconds → "4m 38s"). */
  formatValue?: (value: number) => string
}

/**
 * Smoothly counts between numeric values using Motion's animation loop.
 * Money, percentages, counts — anything that benefits from a tween.
 */
export function AnimatedNumber({
  value,
  className,
  prefix = "",
  suffix = "",
  duration = durations.slow,
  delay = 0,
  formatOptions,
  formatValue,
}: AnimatedNumberProps) {
  const fromRef = useRef(0)
  const [display, setDisplay] = useState(() => (formatValue ?? formatNumber)(0, formatOptions))

  const formatter = useMemo(
    () => (next: number) =>
      formatValue ? formatValue(next) : formatNumber(next, formatOptions),
    [formatValue, formatOptions]
  )

  useEffect(() => {
    const from = fromRef.current
    fromRef.current = value
    const controls = animate(from, value, {
      duration,
      delay,
      ease: easings.outExpo,
      onUpdate: (latest) => setDisplay(formatter(latest)),
    })
    return () => controls.stop()
  }, [value, duration, delay, formatter])

  return (
    <motion.span className={className} aria-label={formatter(value)}>
      {prefix}
      {display}
      {suffix}
    </motion.span>
  )
}

/**
 * 数字/时长的本地化措辞。
 *
 * Factory v1.1 之前这里把 `"zh-CN"` 和 `秒 / 分钟 / 分…秒` 直接写死在共享组件里——
 * 全仓共享组件中唯一一处硬编码的用户可见文案（违反仓库自己的 i18n 规则：
 * `components/**` 不允许出现硬编码文案）。现在调用方可以覆盖；不传时保持
 * 与 v1.0.0 完全一致的行为，所以这不是破坏性改动。
 */
export interface NumberLocale {
  /** BCP-47 locale，用于 `Intl.NumberFormat`。 */
  locale?: string
  /** 时长单位词——纯秒 / 纯分 / 分+秒 三种形态。 */
  durationLabels?: {
    seconds: (seconds: number) => string
    minutes: (minutes: number) => string
    minutesSeconds: (minutes: number, seconds: number) => string
  }
}

const DEFAULT_LOCALE = "zh-CN"

const DEFAULT_DURATION_LABELS = {
  seconds: (seconds: number) => `${seconds}秒`,
  minutes: (minutes: number) => `${minutes}分钟`,
  minutesSeconds: (minutes: number, seconds: number) => `${minutes}分${seconds}秒`,
}

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
  locale: string = DEFAULT_LOCALE
) {
  // 默认跟随产品语言（zh-CN）：金额、千分位与小数点都与其余文案一致。
  return new Intl.NumberFormat(locale, options).format(value)
}

/** 秒数转时长文案：278 → "4分38秒"。措辞可经 NumberLocale 覆盖。 */
export function formatSeconds(value: number, labels?: NumberLocale["durationLabels"]): string {
  const resolved = labels ?? DEFAULT_DURATION_LABELS
  const minutes = Math.floor(value / 60)
  const seconds = Math.round(value % 60)
  if (minutes === 0) return resolved.seconds(seconds)
  if (seconds === 0) return resolved.minutes(minutes)
  return resolved.minutesSeconds(minutes, seconds)
}