/**
 * Probe integrity guard.
 *
 * WHY THIS IS A MODULE AND NOT THREE LINES INSIDE THE SWEEP
 * --------------------------------------------------------
 * Because it has to be testable, and because the failure it prevents is
 * invisible by construction.
 *
 * The bug: a probe appends a test element to `<body>`, reads a CSS custom
 * property that is declared on a *different* element, gets `0px`, computes
 * `0 / 0`, and then evaluates `Math.abs(NaN - expected) > tolerance`. That
 * comparison is `false` — so the assertion **passes**. QA reports green. The
 * feature was never verified.
 *
 * A probe that cannot measure must therefore be louder than a probe that
 * measures the wrong thing, not quieter. This guard is the single place that
 * decides "did we actually get a number", so no call site can forget it.
 */

export class ProbeError extends Error {
  constructor(message) {
    super(message)
    this.name = "ProbeError"
  }
}

/**
 * Run a measurement and refuse to return a non-answer.
 *
 * @param {string} where    Label for the failure message (route · viewport · theme).
 * @param {string} label    What is being measured.
 * @param {() => number | Promise<number>} fn  The measurement.
 * @param {{ allowZero?: boolean }} [options]  Set `allowZero` when 0 is genuinely
 *   a valid reading (e.g. "scrollX after scrolling to 0"). Default is to treat 0
 *   as "the selector missed / the variable did not resolve", which is the cause
 *   in practice far more often than a real zero.
 * @returns {Promise<number>}
 */
export async function measure(where, label, fn, { allowZero = false } = {}) {
  let value
  try {
    value = await fn()
  } catch (error) {
    throw new ProbeError(`${where} · ${label}: 无法测量（${error.message}）`)
  }
  if (typeof value !== "number") {
    throw new ProbeError(`${where} · ${label}: 期望数值，得到 ${typeof value}`)
  }
  if (!Number.isFinite(value)) {
    throw new ProbeError(`${where} · ${label}: 得到非有限值 ${value}（NaN/Infinity）`)
  }
  if (value === 0 && !allowZero) {
    throw new ProbeError(
      `${where} · ${label}: 得到 0——本不应为零，通常是选择器没命中或 CSS 变量未在该元素上解析`,
    )
  }
  return value
}

/**
 * Compare a measured ratio against an expectation, failing loudly.
 *
 * The `Math.abs(NaN - expected) > tolerance` trap lives here so that every
 * ratio assertion in the sweep inherits the guard rather than re-deriving it.
 */
export async function expectRatio(where, label, fn, expected, tolerance) {
  const actual = await measure(where, label, fn)
  const drift = Math.abs(actual - expected)
  if (!Number.isFinite(drift)) {
    throw new ProbeError(`${where} · ${label}: 偏差为非有限值（实际 ${actual}）`)
  }
  if (drift > tolerance) {
    throw new ProbeError(
      `${where} · ${label}: 实测 ${actual}，期望 ${expected}（偏差 ${drift.toFixed(4)} > 容差 ${tolerance}）`,
    )
  }
  return actual
}
