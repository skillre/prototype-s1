/**
 * Shared formatting — one place that decides how the product renders money,
 * numbers, dates and person initials.
 *
 * Money rules (kept deliberately consistent):
 *   • Detail views, tables and records  → full precision, ¥ + thousands:  ¥1,480,000
 *   • KPI hero numbers and chart axes   → 万元 compact:                   ¥2,650万
 */

export type Currency = "CNY" | "USD"

const LOCALE = "zh-CN"

/** Full-precision currency: 1480000 → "¥1,480,000". */
export const formatCurrency = (value: number, currency: Currency = "CNY"): string =>
  new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value)

/**
 * Compact currency for dense surfaces.
 *   2650000 → "¥265万"    48000 → "¥4.8万"    980 → "¥980"
 * Large amounts roll up to 亿 so an axis label never wraps.
 */
export const formatCurrencyCompact = (value: number, currency: Currency = "CNY"): string => {
  const symbol = currency === "CNY" ? "¥" : "$"
  const abs = Math.abs(value)

  if (abs >= 100_000_000) return `${symbol}${trim(value / 100_000_000)}亿`
  if (abs >= 10_000) return `${symbol}${trim(value / 10_000)}万`
  return `${symbol}${Math.round(value).toLocaleString(LOCALE)}`
}

/** Thousands-separated plain number: 20060 → "20,060". */
export const formatNumber = (value: number): string =>
  new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(value)

export const formatPercent = (value: number): string => `${value.toFixed(2)}%`

/** "2026-08-19" → "2026年8月19日" (falls back to the raw input if unparseable). */
export const formatDate = (iso: string): string => {
  const date = parseISODate(iso)
  if (!date) return iso
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日`
}

/** "2026-09-11" → "9月11日" — for board cards and dense timelines. */
export const formatDateShort = (iso: string): string => {
  const date = parseISODate(iso)
  if (!date) return iso
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`
}

/** Hours since last touch → "3 小时前" / "昨天" / "12 天前". */
export const formatRelativeHours = (hours: number): string => {
  if (hours < 1) return "刚刚"
  if (hours < 24) return `${Math.round(hours)} 小时前`
  const days = Math.round(hours / 24)
  if (days === 1) return "昨天"
  if (days < 30) return `${days} 天前`
  const months = Math.round(days / 30)
  if (months < 12) return `${months} 个月前`
  return `${Math.round(months / 12)} 年前`
}

/* -------------------------------------------------------------------------- */

/**
 * 头像文字。中文名取姓名末两字（名），西文名取首字母缩写——
 * 全站头像都走这一个函数，避免每个视图各写一份。
 *
 * `max` 用于密集场景：24px 及以下的小头像放不下两个汉字，
 * 传 1 只取一个姓氏字符，避免文字被裁切成不可读的碎片。
 */
export const personInitials = (name: string, max: 1 | 2 = 2): string => {
  const trimmed = name.trim()
  if (!trimmed) return "?"
  const parts = trimmed.split(/\s+/)
  if (parts.length > 1) {
    return parts
      .slice(0, max)
      .map((part) => part[0])
      .join("")
      .toUpperCase()
  }
  return trimmed.length > max ? trimmed.slice(-max) : trimmed
}

/** One decimal only when it adds information: 4.85 → "4.9", 26.5 → "26.5", 30 → "30". */
function trim(value: number): string {
  const rounded = Math.round(value * 10) / 10
  if (Number.isInteger(rounded)) return rounded.toLocaleString(LOCALE)
  return rounded.toLocaleString(LOCALE, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
}

function parseISODate(iso: string): Date | null {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : date
}
