/**
 * Style Pack Contract —— Kits 视觉资产的第一公民。
 *
 * 任何 Style Pack（无论自研还是外部引入）都必须在这份契约内表达自己。
 * 契约的存在只有一个目的：**让风格可替换，而不让产品代码知道换过**。
 *
 * 三层结构：
 *   1. Contract  —— 变量名与维度枚举（本文件 + styles/_contract/tokens.css）
 *   2. Pack      —— 每个 style pack 给这些变量填上自己的值
 *   3. Product   —— 只写 `data-kits-pack="cinematic"`，不写任何具体数值
 *
 * 严禁在 Product / Component 代码里出现 `#0b0e14`、`12px`、`cubic-bezier(...)`
 * 这类字面量 —— 它们只允许存在于 pack 的 tokens.css。
 */

/** 资产生命周期。incoming/experimental 的资产禁止进入业务 Prototype。 */
export const ASSET_STATUS = [
  "incoming",
  "experimental",
  "approved",
  "deprecated",
] as const;
export type AssetStatus = (typeof ASSET_STATUS)[number];

/**
 * 资产类型 —— 与 registry/assets.json 的 `type` 字段一一对应。
 *
 * 前四类是人看的资产；`package` 是**基础设施包**：它们不是视觉资产，
 * 但没有它们 style / component 无法被独立安装（契约的类型与编译函数、
 * 组件共享的降级 hook、Installer 自身）。它们同样走 registry 与状态门禁，
 * 因此"哪些文件被装进产品"永远是可审计的。
 */
export const ASSET_TYPE = [
  "style",
  "component",
  "effect",
  "skill",
  "package",
] as const;
export type AssetType = (typeof ASSET_TYPE)[number];

/* -------------------------------------------------------------------------- */
/* 十个必须明显不同的维度                                                       */
/* -------------------------------------------------------------------------- */

/** 1. 排版性格 */
export const TYPE_VOICE = [
  "editorial", // 衬线标题 + 等宽小标签：把界面当印刷品
  "spatial", // 无衬线大字 + 光与深度：字是空间里的物体
  "instrumental", // 等宽 + 刻度：字是仪表读数
  /*
   * console —— 等宽即性格，但**不是** instrument 的「全站等宽」。
   *
   * 区别在等宽承担的角色：instrument 让等宽成为整页的排版基调（连标题也是
   * 等宽读数），console 让**读数性文本**（数字 / ID / 命令 / 日志 / 审计行 /
   * 证据引用 / 标签）一律等宽，而中文长句正文回落到无衬线 —— 因为中英混排时
   * 全站等宽会让中文段落塌成不可读的字块。
   *
   * 另一处区别是体型差异的来源：instrument 靠字号档位拉开读数与标签，
   * console 的标题与读数**同族同宽**，层级只由字重与明度承担（见 hierarchyMethod
   * 的 luminance-and-weight）—— 所以它需要这个独立的取值，而不是复用
   * instrumental。借用会让「等宽到底覆盖了文本的哪一部分」这件事无法表达。
   */
  "console",
] as const;
export type TypeVoice = (typeof TYPE_VOICE)[number];

/** 2. 间距节奏 */
export const SPACING_RHYTHM = [
  "generous", // 4px 脉搏 + 超大段距：留白是主要设计手段
  "layered", // 8px 脉搏：间距表达纵深层次
  "compact", // 4px 脉搏 + 小段距：把一屏塞满
  /*
   * columnar —— 间距服务于**列对齐**，不是服务于「松/紧」。
   *
   * compact 问的是「能塞多紧」，generous 问的是「能松多少」——两者都在调
   * 「留白的多少」。columnar 调的是留白的**位置**：间距的首要职责是让左边界
   * 对齐、让列宽可整除，分隔由列规则线承担而不是由空隙推开。
   *
   * 因此它可以比 compact 更密（密度由 density 维度单独表达为 very-high），
   * 却仍然不是「挤」：每条间距都对应一个网格列位。复用 compact 会丢掉
   * 「我的间距首先是一个对齐约束」这层信息。
   */
  "columnar",
] as const;
export type SpacingRhythm = (typeof SPACING_RHYTHM)[number];

/** 3. 信息密度 */
export const DENSITY = [
  "low", // 一屏讲一件事
  "medium", // 平衡
  "high", // 一屏 40+ 指标，但不靠面板内滚动
  /*
   * very-high —— 比 high 再密一档：**面板内滚动是设计的一部分**，不是缺陷。
   *
   * high（instrument）的前提是「一屏放得下 40+ 指标」，它的密度目标仍然是
   * 让全部内容落在单屏里；very-high 的前提相反：单屏只放**当前战情**，
   * 长尾留给面板内部的滚动区。
   *
   * 复用 high 会让「滚动到底允不允许发生」这个产品级决定失去表达 ——
   * 而它恰恰是本 pack 与 instrument 最容易被混淆的一条。
   */
  "very-high",
] as const;
export type Density = (typeof DENSITY)[number];

/** 4. 圆角哲学 */
export const RADIUS_PHILOSOPHY = [
  "flush", // 0 半径：印刷直角，无圆角
  "square", // 1–3px：机械公差，有圆角但极小
  "soft",
  "continuous",
  "pill",
] as const;
export type RadiusPhilosophy = (typeof RADIUS_PHILOSOPHY)[number];

/** 5. 边界处理 */
export const BORDER_TREATMENT = [
  "hairline-rule", // 细线只用于分区，几乎不用卡片
  "none-with-depth", // 没有边框，靠亮度差与光分层
  "hard-technical", // 处处实线分格：每个区块都有边界
  /*
   * syntax-rule —— 1px 规则线**编码结构**（面板边界、列分隔），不是装饰性边框。
   *
   * 与 hard-technical 的区别不是线的粗细，而是**线出现的条件**：
   * hard-technical（instrument）的立场是「每个区块都有边界」——线是默认的，
   * 面板、区块、控件处处实线分格，因为机柜里的模块本身就带边界。
   * syntax-rule 的立场是「线只出现在语法位置」——面板边界与列分隔出现，
   * 行与行之间不出现（那里由行高与明度承担）。
   *
   * 复用 hard-technical 会把「这条线为什么在这里」抹掉：读者无法区分
   * 「这套风格相信处处分格」与「这套风格只在结构转折处画线」。
   */
  "syntax-rule",
] as const;
export type BorderTreatment = (typeof BORDER_TREATMENT)[number];

/** 6. 表面处理 */
export const SURFACE_TREATMENT = [
  "paper", // 纸纹：表面是材质
  "ambient-glow", // 环境光：表面是光
  "panel", // 平面板：表面是平面（无纹理、无光）
  /*
   * cell-grid —— 表面覆一层极轻的点阵网格，暗示**离散字符单元 / 读数格位**。
   *
   * 与三者的区别都在「表面的物理隐喻」上：
   *   paper       表面是纤维（噪点、暖色、multiply 混合）
   *   ambient-glow 表面是光源（径向渐变，会发光）
   *   panel       表面是**什么都没有**的平面（instrument 刻意无纹理）
   *   cell-grid   表面是**格位**（点阵），它不发光也不是材质，而是一张
   *               格子纸的坐标提示：每个读数占一个格位。
   *
   * 所以它不是「panel 加个纹理」——instrument 的 panel 明确不要纹理，
   * console 则必须有纹理，且必须是**离散的**点而不是连续的噪声。
   */
  "cell-grid",
] as const;
export type SurfaceTreatment = (typeof SURFACE_TREATMENT)[number];

/** 7. 导航手感 */
export const NAVIGATION_FEEL = [
  "running-head", // 书眉行：一条线 + 一行小字
  "overlay-space", // 浮层空间：导航是一个可以进入的空间
  "rail-console", // 侧轨控制台：导航是常驻的轨道
  /*
   * command-line —— 导航不是一棵菜单树：**键盘驱动的命令/查询条即导航**。
   *
   * rail-console（instrument）仍然承认「导航是一个常驻控件区」——
   * 它把菜单做成了侧轨，但菜单还在。command-line 取消了菜单这个对象：
   * 去某个面板不是「点开某个节点」，而是**打一条查询**。
   *
   * 这不是交互偏好，是产品事实：S1 的 16:9 单屏里没有常驻菜单的空间，
   * 而目标用户（安全运营）本来就用键盘工作。
   */
  "command-line",
] as const;
export type NavigationFeel = (typeof NAVIGATION_FEEL)[number];

/** 8. 数据可视化语言 */
export const DATA_LANGUAGE = [
  "ink-rules", // 细线 + 衬线读数，没有填充块
  "glow-series", // 曲线发光、端点有光点
  "instrument-grid", // 网格 + 刻度 + 读数
  /*
   * log-stream —— 数据以**事件日志流**呈现为主：读数是文本主导，不是图形主导。
   *
   * 前三者都是「一个读数画成什么形状」的答案（线 / 光 / 网格），它们默认
   * 数据的第一形态是**图**。log-stream 认为数据的第一形态是**行**：
   * 一条带时间戳、可滚动、可引用的事件行；图表是行的聚合视图，不是反过来。
   *
   * 因此它必须独立于 instrument-grid：把日志塞进网格读数里，会丢掉
   * 「时序 + 可追溯」这两个 log-stream 真正要表达的东西。
   */
  "log-stream",
] as const;
export type DataLanguage = (typeof DATA_LANGUAGE)[number];

/** 9. 动效语言 */
export const MOTION_LANGUAGE = [
  "restrained", // 极克制：动效几乎不可见
  "atmospheric", // 氛围：动效本身是空间感的一部分
  "precise", // 精确：瞬时、无回弹，动效是读数的一部分
  /*
   * event-driven —— 动效**只由状态变化触发**，没有环境动效。
   *
   * 与 precise 的关键区别不是速度而是**触发条件**：precise（instrument）
   * 说「动效要快、不要回弹」，但它不回答「什么可以触发动效」。
   * event-driven 回答的正是这一条：只有事件（新告警、状态翻转、授权到位、
   * 结论盖章）才允许开始一次动画。
   *
   * 这条取值同时被 `assertStylePackMotion` 校验（见 MOTION_LANGUAGE 的
   * includes 判定），因此新增它之后所有 pack 的 motion.language 仍然必须在
   * 这个数组里 —— 加值不是放宽校验，是扩大合法词汇。
   *
   * 注意：event-driven 并不排斥 ambient 角色。console 的 roles 包含 ambient，
   * 但它只授予**一个**「运行中」呼吸点 —— 呼吸点本身也是状态（系统在跑），
   * 所以它仍然是事件驱动的，而不是装饰性的环境光。
   */
  "event-driven",
] as const;
export type MotionLanguage = (typeof MOTION_LANGUAGE)[number];

/** 10. 视觉层级建立方式 */
export const HIERARCHY_METHOD = [
  "scale-and-space", // 字号 + 留白
  "light-and-depth", // 光 + 纵深
  "rule-and-label", // 线 + 标签
  /*
   * luminance-and-weight —— 层级靠**明度差与字重**，其余手段全部放弃。
   *
   * 这一条是四个手段的排除法，所以它不能复用任何既有取值：
   *   不靠线（那是 rule-and-label）
   *   不靠光（那是 light-and-depth）
   *   不靠留白（那是 scale-and-space）
   *   不靠材质
   *
   * 为什么需要它：在 16:9 单屏里，留白是最贵的资源（每一像素都要放读数），
   * 线与光又会与「线只在语法位置出现 / 禁止发光」两条硬约束冲突。
   * 剩下的、在 3 米外仍然成立的手段只有两个：三级墨色（--kits-color-ink /
   * ink-muted / ink-faint）与三档字重。console 的层级系统就是这两轴的乘积。
   */
  "luminance-and-weight",
] as const;
export type HierarchyMethod = (typeof HIERARCHY_METHOD)[number];

/** 一个 Style Pack 在十个维度上的立场。Registry 与文档都从这里派生。 */
export interface StylePackProfile {
  typeVoice: TypeVoice;
  spacingRhythm: SpacingRhythm;
  density: Density;
  radiusPhilosophy: RadiusPhilosophy;
  borderTreatment: BorderTreatment;
  surfaceTreatment: SurfaceTreatment;
  navigationFeel: NavigationFeel;
  dataLanguage: DataLanguage;
  motionLanguage: MotionLanguage;
  hierarchyMethod: HierarchyMethod;
}

/* -------------------------------------------------------------------------- */
/* Motion Contract                                                             */
/* -------------------------------------------------------------------------- */

/**
 * 动效层级。Motion 服务于状态变化 / 层级 / 反馈 / 数据交互，
 * 任何不属于这四类的动画都不允许存在（见 skills/motion-direction/SKILL.md）。
 */
export const MOTION_ROLES = [
  "enter", // 元素入场：建立层级
  "interact", // 交互反馈：确认输入
  "ambient", // 环境动效：空间感，不携带信息
  "data", // 数据交互：图形与读数的响应
] as const;
export type MotionRole = (typeof MOTION_ROLES)[number];

export type MotionDurationName = "instant" | "quick" | "base" | "slow" | "ambient";
export type MotionEaseName = "out" | "inOut" | "linear" | "spring";

/** `motion.ts` 必须导出的形状。单位：毫秒 / CSS 时间函数。 */
export interface StylePackMotion {
  /** 该 pack 的动效性格 */
  language: MotionLanguage;
  /** 时长刻度（ms） */
  duration: Record<MotionDurationName, number>;
  /** 缓动刻度（CSS easing 字符串） */
  ease: Record<MotionEaseName, string>;
  /** 层级顺序 + 每级步进（ms），供 stagger 使用 */
  staggerStep: number;
  /** 环境动效周期（ms） */
  ambientCycle: number;
  /** 进入动效位移量（px 或 CSS 长度） */
  enterDistance: string;
  /** 指针驱动的位移强度倍率（0 = 完全禁用指针视差） */
  pointerFactor: number;
  /** 该 pack 允许使用的动效角色 */
  roles: readonly MotionRole[];
  /** 无障碍：reduced-motion 下保留哪些（弱化的、非位移的）反馈 */
  reducedMotion: {
    /** 全部动画时长坍缩到的值（ms），0 表示完全静态 */
    collapseTo: number;
    /** 是否保留透明度淡入 */
    keepOpacity: boolean;
    /** 是否保留颜色/描边等非位移动效 */
    keepColor: boolean;
    /** reduced-motion 下应当完全关闭的角色 */
    disableRoles: readonly MotionRole[];
  };
  /** 移动端约束 */
  mobile: {
    /** 小于该宽度（px）时启用移动降级 */
    breakpoint: number;
    /** 移动端是否允许指针视差（触屏通常应 false） */
    pointer: boolean;
    /** 移动端位移量缩放 */
    distanceScale: number;
    /** 移动端环境动效是否关闭（省电 / 省性能） */
    ambient: boolean;
  };
}

/* -------------------------------------------------------------------------- */
/* 校验                                                                        */
/* -------------------------------------------------------------------------- */

const REQUIRED_DURATIONS: MotionDurationName[] = [
  "instant",
  "quick",
  "base",
  "slow",
  "ambient",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 运行时校验一份 `motion.ts`。Playground 与测试都用它，
 * 因此 pack 作者写错字段会在 CI 里立刻暴露，而不是等到产品上线。
 */
export function assertStylePackMotion(
  value: unknown,
  label = "motion",
): asserts value is StylePackMotion {
  if (!isRecord(value)) throw new Error(`${label}: 必须是对象`);
  if (!MOTION_LANGUAGE.includes(value.language as MotionLanguage)) {
    throw new Error(`${label}.language 非法: ${String(value.language)}`);
  }
  const duration = value.duration;
  if (!isRecord(duration)) throw new Error(`${label}.duration 缺失`);
  for (const name of REQUIRED_DURATIONS) {
    const v = duration[name];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      throw new Error(`${label}.duration.${name} 非法: ${String(v)}`);
    }
    if (name !== "ambient" && v > 1000) {
      throw new Error(
        `${label}.duration.${name}=${v}ms 过长，交互动效上限 1000ms`,
      );
    }
  }
  const ease = value.ease;
  if (!isRecord(ease)) throw new Error(`${label}.ease 缺失`);
  for (const name of ["out", "inOut", "linear", "spring"] as const) {
    if (typeof ease[name] !== "string" || !ease[name]) {
      throw new Error(`${label}.ease.${name} 非法: ${String(ease[name])}`);
    }
  }
  if (typeof value.staggerStep !== "number" || value.staggerStep < 0) {
    throw new Error(`${label}.staggerStep 非法`);
  }
  if (typeof value.ambientCycle !== "number" || value.ambientCycle < 0) {
    throw new Error(`${label}.ambientCycle 非法`);
  }
  if (typeof value.enterDistance !== "string") {
    throw new Error(`${label}.enterDistance 必须是 CSS 长度字符串`);
  }
  if (typeof value.pointerFactor !== "number" || value.pointerFactor < 0) {
    throw new Error(`${label}.pointerFactor 非法`);
  }
  if (!Array.isArray(value.roles) || value.roles.length === 0) {
    throw new Error(`${label}.roles 必须是非空数组`);
  }
  for (const role of value.roles) {
    if (!MOTION_ROLES.includes(role as MotionRole)) {
      throw new Error(`${label}.roles 含非法角色: ${String(role)}`);
    }
  }
  if (!isRecord(value.reducedMotion)) {
    throw new Error(`${label}.reducedMotion 缺失`);
  }
  if (!isRecord(value.mobile)) throw new Error(`${label}.mobile 缺失`);
  return;
}

/**
 * 把一份 motion.ts 编译成 CSS 自定义属性。
 * 这是 motion 从 TS 进入 CSS 的**唯一**通道，组件只读 CSS 变量，
 * 因此换 pack 不需要动任何组件代码。
 */
export function motionToCssVars(
  motion: StylePackMotion,
): Record<string, string> {
  const vars: Record<string, string> = {
    "--kits-dur-instant": `${motion.duration.instant}ms`,
    "--kits-dur-quick": `${motion.duration.quick}ms`,
    "--kits-dur-base": `${motion.duration.base}ms`,
    "--kits-dur-slow": `${motion.duration.slow}ms`,
    "--kits-dur-ambient": `${motion.duration.ambient}ms`,
    "--kits-ease-out": motion.ease.out,
    "--kits-ease-inout": motion.ease.inOut,
    "--kits-ease-linear": motion.ease.linear,
    "--kits-ease-spring": motion.ease.spring,
    "--kits-stagger-step": `${motion.staggerStep}ms`,
    "--kits-ambient-cycle": `${motion.ambientCycle}ms`,
    "--kits-enter-distance": motion.enterDistance,
    "--kits-pointer-factor": String(motion.pointerFactor),
  };
  return vars;
}
