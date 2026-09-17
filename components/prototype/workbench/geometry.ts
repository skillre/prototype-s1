/**
 * 战情室骨架 —— **实测尺寸的唯一一份**。
 *
 * 出处：工作区根目录 `STH-设计稿实测与实现规格.md` §二（从 `sth-ai-native-console.pen`
 * 逐帧读出，2026-09-16）。这些不是审美取值，是**实测事实**；改一个数字就是改设计稿的骨架，
 * 所以它们只在这里出现一次，并由 `tests/sth-console.spec.ts` 逐值比对规格文档，
 * 任何漂移都会红（包括「顺手把 14 改成 16 更好看」这一类）。
 *
 * 两处必须说清楚的取舍：
 *
 * 1. **列间距 = 14px，不是 pack 的 `--kits-section-gap`（24px）。**
 *    console pack 的 `--kits-section-gap` 注释把 24px 说成「三列之间的列间距」，
 *    而设计稿实测的列间距是 **14px**（= 根的 `gap`）。两者矛盾，本层取
 *    **实测值**（`STH-设计稿实测与实现规格.md` 是骨架的权威），并把 pack 的
 *    `--kits-section-gap` 用在它真正说得通的地方：**同一列内面板之间**的间距。
 *    这是一处已记录的 pack 注释与设计稿的冲突，不是实现者的自由裁量。
 * 2. **`scale()` 会连 `line-height` 一起缩**，所以「面板内能放几行」随分辨率变化：
 *    这里只给尺寸，不给行数。面板内滚动是布局的结论，不是写死的行数。
 *
 * 视觉常量（颜色 / 字号 / 时长 / 缓动 / 圆角 / 行高）**不在这里**：那些一律来自
 * `var(--kits-*)` 或语义槽位。这里只有骨架的几何。
 */

export const CONSOLE_GEOMETRY = {
  /** 设计画布：1680 × 1050（`layoutFacts.canvas`）。 */
  canvasWidth: 1680,
  canvasHeight: 1050,
  /** ① 态势指挥条高度（`layoutFacts.headerHeight`）。 */
  headerHeight: 76,
  /** 底栏高度（`layoutFacts.footerHeight`）：⑨ 问 STH（640）+ ⑭ 报告。 */
  footerHeight: 130,
  /** 三列宽度（`layoutFacts.columns`）：左 500 / 中 600 / 右 366。 */
  columnWidths: { left: 500, middle: 600, right: 366 },
  /** 根 padding 20（`layoutFacts.rootPadding`）。 */
  rootPadding: 20,
  /** 根 gap 14 = 列间距（`layoutFacts.rootGap` / `columnGap`）。 */
  rootGap: 14,
  /** 列内 padding 12（`layoutFacts.columnPadding`）。 */
  columnPadding: 12,
  /** 顶栏内 padding 16 / gap 20（`layoutFacts.headerPadding` / `headerGap`）。 */
  headerPadding: 16,
  headerGap: 20,
  /** 底栏内 padding 12 / gap 12（`layoutFacts.footerPadding` / `footerGap`）。 */
  footerPadding: 12,
  footerGap: 12,
  /** ⑨ 问 STH 的宽度（`layoutFacts.askSthWidth`）。 */
  askSthWidth: 640,
} as const

/**
 * scale-to-fit —— **唯一版本**（人已签署 2026-09-16，实现规格 §二·补）。
 *
 * ```
 * SCALE = Math.min(1, innerWidth / 1680, innerHeight / 1050)
 * ```
 *
 * `Math.min(1, …)` 里的 1 是「最大化清晰度」这条决定的直接后果：宽屏 1:1 不放大
 * （设计值即真值），窄屏才缩。缩放后画布占满可用宽或高，任意视口下都不产生横向溢出。
 *
 * 不读时钟、不随机：给定视口就是一个确定的数，所以它可以被断言。
 */
export function scaleForViewport(innerWidth: number, innerHeight: number): number {
  if (!Number.isFinite(innerWidth) || !Number.isFinite(innerHeight)) return 1
  if (innerWidth <= 0 || innerHeight <= 0) return 1
  return Math.min(
    1,
    innerWidth / CONSOLE_GEOMETRY.canvasWidth,
    innerHeight / CONSOLE_GEOMETRY.canvasHeight,
  )
}
