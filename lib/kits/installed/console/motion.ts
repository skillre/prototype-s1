/**
 * Style Pack · console · motion
 *
 * 动效语言：event-driven（事件驱动）。
 *
 * 与另外三套的关键差异不是「更快」，而是**触发条件**：
 *
 *   restrained（editorial）  动效几乎不可见 —— 它回答「动多少」
 *   atmospheric（cinematic） 动效本身是空间感的一部分 —— 它回答「有没有纵深」
 *   precise（instrument）    动效要瞬时、不要回弹 —— 它回答「快不快」
 *   event-driven（console）  动效**只由状态变化触发** —— 它回答「什么时候可以动」
 *
 * 在这套风格里，一次动画的开始永远对应一个可命名的事件：
 *
 *   流式打字   ← AI 正在产出（token 到达）
 *   呼吸点     ← 会话「运行中」（唯一允许的循环动效，见 roles 的 ambient）
 *   粒子汇流   ← 证据向结论汇聚（引用关系建立）
 *   碎裂盖章   ← 结论落定（状态从「进行中」变「已结论」）
 *   划掉重写   ← 人推翻了 AI 的结论（人类授权覆盖）
 *
 * **没有环境动效**：不存在「页面闲着的时候它自己在动」。上面五个动作里唯一
 * 带循环的是呼吸点，而它承载的信息是「系统此刻在跑」—— 那是状态，不是氛围。
 * 这就是 event-driven 与 atmospheric 的分界线。
 *
 * 交互动效整体 ≤240ms：因此 duration 的刻度整体压在 240ms 以内
 * （slow = 240ms 是这条规格的上限，settings 之外没有更慢的档位）。
 */

import type { StylePackMotion } from "../contracts/index";

export const consoleMotion: StylePackMotion = {
  language: "event-driven",

  /*
   * 时长刻度：全部 ≤240ms。
   *
   * instant 60ms —— 状态点翻转、日志行插入。快到像本来就该在那里。
   * quick  120ms —— hover / focus 的颜色变化。这是**手感**的上限：
   *                  再慢，密集排布的列会在鼠标划过时出现拖影。
   * base   180ms —— 一次完整的进出场（例如面板内的一条结论浮现）。
   * slow   240ms —— 「碎裂盖章」这类**结论级**动效：它是这条规格允许的
   *                  最慢一档，也是本 pack 里唯一明显能被感知的时长。
   * ambient 4000ms —— 呼吸点的一个完整周期。4s 是「活着但不打扰」的下限：
   *                  低于 2s 会读成焦虑的闪烁，高于 6s 会读成静止的故障。
   */
  duration: {
    instant: 60,
    quick: 120,
    base: 180,
    slow: 240,
    ambient: 4000,
  },

  /*
   * 缓动：只有 out / inOut / linear 三个是「移动」用的，spring 刻意退化为
   * 一个**无过冲**的强 ease-out。
   *
   * 契约给的 spring 默认值 `cubic-bezier(0.34, 1.56, 0.64, 1)` 里第二个
   * 控制点的 y 是 1.56 —— 它的含义是**过冲**（目标值之上再冲 56% 然后弹回）。
   * 那是果冻感，与控制台互斥：一个读数的位置如果在落定时越过了自己的格位
   * 再弹回来，它在落定过程中就是**错的**。控制台的数字必须「到达即正确」，
   * 不能有一段「短暂地不正确」的时间。
   *
   * 所以这里把 spring 改写成 (0.22, 1, 0.36, 1)：尾部控制点的 y 恰好是 1，
   * 数学上不可能过冲，但前段仍比标准 out 更陡 —— 保留了「弹簧释放」的
   * 力度感，去掉了弹跳。
   *
   * 这不是「少用了一个参数」：把 spring 保留成有回弹、再在产品里承诺
   * 「不要用它」，会让契约里存在一个**合法但禁用**的值 —— 而契约的意义
   * 正是让合法的东西就是该用的东西。
   */
  ease: {
    out: "cubic-bezier(0.2, 0, 0, 1)",
    inOut: "cubic-bezier(0.4, 0, 0.2, 1)",
    linear: "linear",
    spring: "cubic-bezier(0.22, 1, 0.36, 1)",
  },

  /*
   * staggerStep 24ms：逐条列出时的步进。
   *
   * 24 这个数不是随手取的：它是本 pack 的 4px 间距脉搏 × 6，也是
   * --kits-section-gap 的值。逐条揭示的节奏与列间距同源，读起来是
   * 「在同一个网格上依次落位」，而不是「一段独立的动画序列」。
   *
   * 为什么这么小：控制台一次可能揭示 8–12 条事件行。60ms（契约默认）
   * 会让第 12 条等到 720ms 之后，整体超过 240ms 的交互预算一个数量级。
   */
  staggerStep: 24,
  ambientCycle: 4000,
  /* 4px 进入位移：只够提示「它是新来的」，不够让读者追着一个移动的物体看。 */
  enterDistance: "4px",
  /* 0 = 完全禁用指针视差。控制台不是让人用鼠标玩光斑的地方，
   * 而且视差会让密排的列在移动时产生视错觉。 */
  pointerFactor: 0,

  /*
   * roles：四类全部授予，但每一类都有**指定的唯一用途**。
   *
   *   enter    → 面板内新条目落位（4px，180ms）
   *   interact → hover / focus / 展开折叠的反馈（颜色，120ms）
   *   data     → 读数变化、图表重绘、证据汇聚
   *   ambient  → **只给「运行中」呼吸点**，别处不许用
   *
   * 关于 ambient：instrument 明确不授予它（「仪表不呼吸」），console 授予它，
   * 两者不矛盾 —— 区别在于「呼吸这件事在这个界面里说不说话」。
   * 在监控面板上，一个持续呼吸的指示灯会与真实的状态变化争夺注意力，
   * 所以 instrument 把它整个拿掉。在运营控制台上，呼吸点是有语义的：
   * 它标记**哪一个会话/任务此刻真的在跑**；一屏可能有 6 个任务，
   * 其中 1 个在跑 —— 这个信息必须有地方表达，而它就是那个呼吸点。
   *
   * 因此授予 ambient 的条件是**排他的**：只有承载「运行中」的那一个元素
   * 可以用 --kits-dur-ambient / --kits-ambient-cycle，
   * 而不是「包里允许有环境光」。本 pack 的 materialDirection.ambient 是 "none"
   * —— CSS 里没有 `.kits-ambient`，这与「呼吸点是元素级状态指示」不冲突。
   */
  roles: ["enter", "interact", "data", "ambient"],

  reducedMotion: {
    collapseTo: 0,
    /*
     * keepOpacity: true —— 保留淡入。
     *
     * 深色界面上直接切断透明度会出现一次**闪白/闪暗**（元素从无到有的那一帧
     * 按背景色绘制），对光敏感用户比一次 60ms 的淡入更糟。这一点与
     * instrument 的 false（告警必须瞬时可见）是**不同的取舍**，两者都对：
     * instrument 的场景里「晚 60ms 看到故障」是事故，console 的场景里
     * 「结论晚 60ms 出现」不是。
     */
    keepOpacity: true,
    /* keepColor: true —— 颜色变化是**状态信号**（青=AI 在跑、琥珀=等你授权、
     * 红=攻击、绿=已闭环）。把颜色也冻结掉，等于在 reduced-motion 下删掉
     * 一整套语义 —— 那是无障碍倒退，不是无障碍。 */
    keepColor: true,
    /* reduced-motion 下把循环动效整个关掉：呼吸点是唯一一个会**无限持续**的
     * 动画，也正是前庭敏感用户最容易被它干扰的一类。它的信息（这个会话在跑）
     * 有静态替代：状态点的实心填充 + 文字状态词。 */
    disableRoles: ["ambient"],
  },

  mobile: {
    breakpoint: 768,
    pointer: false,
    /* 0.5：移动端的进入位移再减半（4px → 2px）。小屏上任何位移都更容易被
     * 读成「页面在晃」，而不是「一个条目落位」。 */
    distanceScale: 0.5,
    /* ambient: false —— 移动端关闭呼吸点动画。省电是次要理由，主要理由是
     * 移动端根本不会是 S1 的使用场景（avoidFor 里有 mobile / touch）：
     * 这块屏是 16:9 大屏，手机上一屏放不下三列，呼吸点在那里没有意义。 */
    ambient: false,
  },
};

export default consoleMotion;
