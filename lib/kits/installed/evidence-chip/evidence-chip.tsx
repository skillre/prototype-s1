"use client";

/**
 * EvidenceChip —— 内部稳定 API v1
 *
 * ---------------------------------------------------------------------------
 * 这个组件是做什么的
 * ---------------------------------------------------------------------------
 * **一条可点开的证据引用**：`[类别] [#引用号] [它说的是什么] [×条数]`。
 *
 * 它解决的不是"好看"的问题，而是**归属**问题：一条结论旁边挂着的引用，
 * 必须能一眼看出「这是引用、引用的是哪一条、点开会有东西」。
 * 没有 chip 的时候，证据只能写成正文里的一句话 —— 那句话既不可点，
 * 也无法被自动化清点。
 *
 * ---------------------------------------------------------------------------
 * 稳定 API（产品只允许用这些）
 * ---------------------------------------------------------------------------
 *   category?    类别词（例如「证据」）。省略 = 不渲染类别词
 *   evidenceId?  引用号（例如 "e-41"）。省略 = 无编号的补充引用
 *   label        这条引用说的是什么（必填，产品文案）
 *   count?       同类引用合并的条数；> 1 时渲染 `×n`
 *   tone?        语调：映射到 pack 的颜色槽位。**省略** = 引用号用 pack 的
 *                引用色槽位（`--kits-data-series-3`）
 *   intensity?   强调档位：只改引用号下划线的厚度（`none` = 不加下划线）
 *   expanded?    抽屉是否已打开（产品告知，chip 不自己保存这个状态）
 *   drawerId?    抽屉的 DOM id（产品给定 → `aria-controls`）
 *   onActivate?  激活回调。**省略时渲染 span 而不是 button** —— 不可点开的
 *                引用不该出现在 Tab 顺序里
 *
 * ---------------------------------------------------------------------------
 * 明确**不属于** API 的东西
 * ---------------------------------------------------------------------------
 *   color / borderColor / radius / padding / fontSize / duration / easing /
 *   underlineThickness / icon … 全部由 Style Pack 决定（见 evidence-chip.css）。
 *
 * ---------------------------------------------------------------------------
 * 这个组件**不负责**什么（写在这里，因为"不做什么"同样是契约）
 * ---------------------------------------------------------------------------
 *   1. 不找证据 —— 数据从哪来是产品的事；
 *   2. 不渲染抽屉内容 —— 抽屉由产品实现，chip 只给 `drawerId` 与 `expanded`；
 *   3. 不路由 —— 点击后去哪由 `onActivate` 决定；
 *   4. 不发明文案 —— 类别词、引用号、描述、条数全部由产品传入。
 *
 * ---------------------------------------------------------------------------
 * 三层降级（全部内建）
 * ---------------------------------------------------------------------------
 *   1. 无精确指针（触屏）→ hover 强调态改为**常驻**，并抬到 pack 的控件高度
 *      （触控目标），引用内容一字不少（CSS 层，见 evidence-chip.css）
 *   2. prefers-reduced-motion → 颜色过渡归零，状态切换立即生效（信息不丢）
 *   3. JS 完全失败 / 未水合 → 它是一条静态标记：引用号、描述、条数照常可见，
 *      因为它们全部是**可见文本**，不依赖任何运行时
 */

import {
  cx,
  INTENSITY_SCALE,
  TONE_VAR,
  type Intensity,
  type MotionFallbackProps,
  type Tone,
} from "../react-utils/index";
import "./evidence-chip.css";

export interface EvidenceChipProps extends MotionFallbackProps {
  /** 这条引用说的是什么。必填 —— 只有引用号的 chip 对人无用。 */
  label: string;
  /** 引用号（例如 `e-41`）。组件负责 `#` 这个引用记号的渲染。 */
  evidenceId?: string;
  /** 同类引用合并的条数。只有 > 1 时才渲染 `×n`（`×1` 是噪音）。 */
  count?: number;
  /** 类别词（例如「证据」「线索」）。省略 = 不渲染。 */
  category?: string;
  /**
   * 语调。**省略时不写 `--kits-component-tone`**，引用号回落到 pack 的
   * 引用色槽位（`--kits-data-series-3`，在 console 里就是「证据引用蓝」）；
   * 给了 tone 才用该语义槽位覆盖。
   */
  tone?: Tone;
  /** 强调档位。只影响引用号下划线的厚度；chip 的边界与尺寸由 pack 决定。 */
  intensity?: Intensity;
  /** 抽屉是否已打开。给了就渲染 `aria-expanded`（chip 不自己保存状态）。 */
  expanded?: boolean;
  /** 抽屉的 DOM id，用于 `aria-controls`。 */
  drawerId?: string;
  /** 激活（点击 / Enter / Space）。省略时不渲染 button。 */
  onActivate?: (evidenceId: string | undefined) => void;
  className?: string;
  id?: string;
}

export function EvidenceChip({
  label,
  evidenceId,
  count,
  category,
  tone,
  intensity = "medium",
  expanded,
  drawerId,
  onActivate,
  disableMotion = false,
  className,
  id,
}: EvidenceChipProps) {
  /*
   * 计数只在**真的多于一条**时才出现。`Number.isFinite` 是刻意的：
   * NaN / Infinity 会让 `count > 1` 静默为 false（或渲染出 `×NaN`），
   * 而"没报错"在这种情况下不等于"没问题"。
   */
  const showsCount = typeof count === "number" && Number.isFinite(count) && count > 1;

  /*
   * 为什么不用 `resolveToneVars(tone, intensity)`：
   * 那个函数**总是**写满两个变量，于是"未指定 tone"与"tone=neutral"无法区分 ——
   * 而这两件事在这里含义不同：前者要把引用号交给 pack 的引用色槽位，
   * 后者是产品明确要求主墨色。所以只有产品**显式**给了 tone 才写这个变量。
   * 档位乘数与槽位表仍然来自共享契约（INTENSITY_SCALE / TONE_VAR），
   * 组件自己不认识任何颜色。
   */
  const vars = {
    "--kits-component-intensity": String(INTENSITY_SCALE[intensity]),
    ...(tone ? { "--kits-component-tone": `var(${TONE_VAR[tone]})` } : {}),
  } as React.CSSProperties;

  const rootClassName = cx(
    "kits-evidence-chip",
    !onActivate && "kits-evidence-chip--static",
    disableMotion && "kits-evidence-chip--still",
    className,
  );

  const markers = {
    "data-kits-component": "evidence-chip",
    ...(evidenceId ? { "data-kits-evidence-id": evidenceId } : {}),
    ...(showsCount ? { "data-kits-evidence-count": String(count) } : {}),
    ...(expanded === undefined
      ? {}
      : { "data-kits-evidence-expanded": expanded ? "true" : "false" }),
  } as const;

  const content = (
    <>
      {category ? (
        <span className="kits-evidence-chip__category">{category}</span>
      ) : null}
      {evidenceId ? (
        <span className="kits-evidence-chip__ref">{`#${evidenceId}`}</span>
      ) : null}
      <span className="kits-evidence-chip__label">{label}</span>
      {/*
       * 计数**不**写 aria-label。两个理由：
       *   1. 可访问名就等于可见文本（本组件的契约之一）—— 给 `×2` 另写一个
       *      「2 条」会在同一条 chip 上造出两套真相，而两套真相一定会漂移；
       *   2. 量词是本地化文案，不是原子件该发明的东西。
       * 因此屏幕阅读器读到的是「手法指纹匹配 乘号 2」这样一句可懂的话：
       * 名词来自 label，计数是它前面的乘号。需要更明确的口径时，
       * 把名词写进 label（见 README「无障碍」一节的实测朗读顺序）。
       */}
      {showsCount ? (
        <span className="kits-evidence-chip__count">{`×${count}`}</span>
      ) : null}
    </>
  );

  /*
   * 没有 onActivate → 渲染 <span>。
   *
   * 「一个点开不动的 button」比「一个静态标记」更糟：它会进入 Tab 顺序、
   * 会被读成"可操作"，而按下去什么都不会发生。是否可点开是**产品语义**，
   * 所以这里由 onActivate 的有无决定元素类型，而不是给产品一个 as prop。
   */
  if (!onActivate) {
    return (
      <span id={id} className={rootClassName} style={vars} {...markers}>
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      id={id}
      className={rootClassName}
      style={vars}
      onClick={() => onActivate(evidenceId)}
      aria-expanded={expanded}
      aria-controls={drawerId}
      {...markers}
    >
      {content}
    </button>
  );
}

export default EvidenceChip;
