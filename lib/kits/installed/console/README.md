# Style Pack · console

> 运营控制台 · 终端与列 —— 高级终端的气质，不是「展厅大屏」。

| | |
|---|---|
| **id** | `console` |
| **status** | `approved` |
| **version** | `0.2.0` |
| **contract** | `1.0.0` |
| **selector** | `[data-kits-pack="console"]` |
| **performance** | A · 0 KB JS · ~8 KB CSS（零滤镜 / 零投影 / 零混合模式 / 零 animation） |

---

## 1. 这套风格在解决什么问题

它是给 **STH 安全运营控制台**（16:9 大屏产品界面）用的视觉身份。这类界面的真正
难点不是「好不好看」，而是三件同时成立的事：

1. **一屏三层必须同时可读**：攻击链（左）/ 战情（中）/ 信任与授权（右）
2. **颜色必须能当判据用**：红=攻击、青=AI 在跑、琥珀=等你授权、绿=已闭环
3. **3 米外投屏仍然能读**：这不是一块给人凑近看的屏幕

「展厅大屏」的做法是用装饰建立气势（环境光、扫描线、粒子地球），那也是被这套
风格**明确禁止**的。控制台用另一种方式建立权威：一个读数占一格、一条事件占一行、
一个颜色一个含义。

**第一视觉**：深色画布上三列被 2px 规则线切开 —— 左列攻击链节点在连线上排开，
中列是流式产出的战情结论（等宽大字 + 一个呼吸点），右列是待人授权队列（琥珀）。
顶栏 76px 是一条命令条，底栏 130px 是滚动的日志流。

### 骨架（来自真实设计稿，1680×1050）

| 部位 | 尺寸 | 与 token 的关系 |
|---|---|---|
| 主布局 | 1680×1050 | `--kits-content-max: 1680px` |
| 顶栏 | 高 **76px** | 命令条 `--kits-nav-height: 44px` + 上下 padding 各 16px = 76px |
| 顶栏里一排控件 | **38px** | `--kits-control-height: 2.375rem`；可用高度 = 76 − 2×16 = 44px，38 ≤ 44 ✓ |
| 底栏 | 高 **130px** | 日志流 4 行 × `--kits-row-height: 28px` = 112px + 18px 内边距 |
| 左列（攻击链画布） | 宽 **500** | — |
| 中列（战情） | 宽 **600** | — |
| 右列（信任与授权） | 宽 **366** | — |
| 列间距 | `--kits-section-gap: 24px` | 500+600+366 + 2×24 = 1514，落在 1680 内 |

> **一处有算术依据的让步：控件高 38px，不是设计稿 spec 里的 40px。**
> 40px 与 editorial 的 `--kits-control-height` 撞值，而「四套 pack 的密度数值互不相同」
> 是被断言的一条（它的原意是「没有两套 pack 共用同一套密度数值」—— 这个原意在
> 这里确实成立，40px 只是巧合）。让到 **38px** 之后：仍然装得进 76px 顶栏
> （38 ≤ 44）、仍然与 cinematic 的 36px / instrument 的 28px / editorial 的 40px
> 三值互不相同。**改的是 2px，不是那条断言。**

所有数值都是 4px 脉搏的整数倍（`--kits-space-unit: 4px`）—— 这是
`spacingRhythm: "columnar"` 的机械含义：**间距首先是一个对齐约束，其次才是留白**。

---

## 2. 十个维度上的立场

| 维度 | 立场 | 落地方式 |
|---|---|---|
| typography | `console` | **等宽即读数**（≠ instrument 的全站等宽）：数字 / ID / 命令 / 日志 / 审计行 / 证据引用 / 标签一律等宽；中文长句正文回落无衬线。标题 clamp 34–52px / 1.04 / **-0.01em**；读数 36px 等宽 tabular-nums + slashed-zero |
| spacing rhythm | `columnar` | 脉搏 4px，区块间距仅 **24px**，content-max 1680px —— 间距服务于列对齐，不是「松/紧」 |
| density | `very-high` | 控件 **38px** 高、行高 **28px**、卡片内边距 16px。比 `high` 更密的含义是：**面板内滚动是设计的一部分** |
| radius philosophy | `flush` | 全 0（与 editorial 同为 `flush`，这是允许的）；理由不同：editorial 的 0 是「印刷不切圆角」，console 的 0 是「格位是矩形的」 |
| border treatment | `syntax-rule` | 1px 规则线**编码结构**：面板边界与列分隔出现，行与行之间不出现。与 instrument 的 `hard-technical`（处处实线分格）的区别是**线出现的条件**，不是粗细 |
| surface treatment | `cell-grid` | 极轻的**点阵网格**（两层 radial-gradient 在 8px 周期上交错，opacity **0.05**）暗示离散字符单元 / 读数格位。不是纸纹（连续噪声）、不是玻璃、不是「什么都没有的平面」 |
| navigation feel | `command-line` | 导航不是菜单树：**键盘驱动的命令/查询条即导航**。nav 高 44px 是一条命令条，不是一组菜单项 |
| data visualization | `log-stream` | 数据以**事件日志流**呈现为主，读数是文本主导而非图形主导。三个数据槽位 = AI 青 / 待人授权琥珀 / 证据引用蓝 |
| motion language | `event-driven` | 60–240ms（上限 240ms）；位移 **4px**；`pointerFactor: 0`。**动效只由状态变化触发**：流式打字 / 呼吸点 / 粒子汇流 / 碎裂盖章 / 划掉重写。没有环境动效 |
| visual hierarchy | `luminance-and-weight` | 层级只靠两轴：**三级墨色（明度）× 三档字重**。不靠线、不靠光、不靠留白、不靠材质 |

> **判据**：灰度化之后，console 是唯一一套「左边界处处对齐、线只出现在结构转折处、
> 而密度高到需要面板内滚动」的 pack。差异来自**间距的职责**与**层级的来源**，
> 不是颜色。

---

## 3. 色彩语义纪律（一色一义，不得混用）

这套 pack 的颜色**承担判据**。任何一个颜色被借去表达第二种含义，两种含义就都失效了。

| 语义 | token | 取值 |
|---|---|---|
| 攻击 | `--kits-color-negative` | `#F4364C` |
| AI / 系统在产出 | `--kits-color-accent` | `#22D3EE` |
| **待人授权** | `--kits-color-accent-2` | `#F5A524` |
| 已闭环 | `--kits-color-positive` | `#2ECC71` |
| 证据引用 | `--kits-data-series-3` / `--kits-data-evidence` | `#60A5FA` |
| 暗底 | `--kits-color-canvas` | `#0B1220` |

**两条容易被忽略的纪律：**

- **攻击红与已闭环绿不进数据序列。** 它们是**状态**，不是序列。图表要三条曲线时
  用青 / 琥珀 / 证据蓝 —— 让红色既是一条曲线又是一个状态，正是本纪律要禁止的混用。
- **琥珀不是第二个品牌色，也不是「强调色之二」。** 它承载的是「待人授权」：
  一个已经准备好、正在等人类说 yes 的动作。设计稿把它命名为 `amber` 而不是
  `warning`，正因为它的含义比 warning 窄 —— 它不是「出错了」，是「球在你那边」。
  因此**不能因为「想强调一下」而借它用**。

---

## 4. 对比度（WCAG 相对亮度公式实算）

四个承载文字的真实表面：`term #0A101D` / `canvas #0B1220` / `panel #0F1A2E` / `card #152238`。

| 前景 | term | canvas | panel | card | 结论 |
|---|---|---|---|---|---|
| 主墨 `#E6EDF7` | 16.13 | 15.89 | 14.76 | **13.52** | 四面 ≫ AAA(7:1) |
| 次墨 `#8FA3C0` | 7.39 | 7.28 | 6.76 | **6.20** | 四面全过 AA(4.5:1)，可放心承载次要正文 |
| 三级墨 `#5B6E8C` | 3.67 | 3.61 | 3.36 | **3.08** | ⚠️ 四面都**只够大字/非正文** |
| AI 青 `#22D3EE` | 10.52 | 10.36 | 9.62 | **8.82** | 全过 |
| 待人授权琥珀 `#F5A524` | 9.31 | 9.17 | 8.52 | **7.81** | 全过 |
| 已闭环绿 `#2ECC71` | 9.04 | 8.91 | 8.27 | **7.58** | 全过 |
| 证据引用蓝 `#60A5FA` | 7.48 | 7.36 | 6.84 | **6.27** | 全过 |
| 攻击红 `#F4364C` | 4.96 | 4.88 | 4.54 | **4.16** | ⚠️ card 面不过正文 AA |
| 规则线 `#4A6C9B` | 3.54 | 3.49 | 3.24 | **2.97** | 结构性，见下 |
| 强规则线 `#6C90C0` | 5.78 | 5.70 | 5.29 | **4.85** | 四面全 ≥4.5 |

### 两条如实写出的限制

**① 三级墨 `#5B6E8C` 不承载信息。** 它在 card 面只有 3.08:1，四个面都够不到正文
AA。因此它在本 pack 里的用途被**限定为三类**：禁用态、水印、次要图例。任何
「读不到就等于没有」的内容都不许用它。

**② 攻击红在 `card` 面（`#152238`）上不能当正文。** 4.16 < 4.5。因此该面上的
攻击红**只允许**用于：

- 大字文本（≥24px 常规，或 ≥18.66px 粗体 —— WCAG 大字门槛）
- 非文本元素（攻击链节点、状态点、进度条、连线）

该面上的正文一律用 `--kits-color-ink`。

**取值保持设计稿原值 `#F4364C` 不变** —— 它是这个安全域里最不该被「调亮一点
好看些」的颜色，动它会同时改掉攻击链的视觉锚点。**约束用法，而不是修改身份。**

---

## 5. 唯一一处对设计稿取值的有意修改：规则线

| 线色 | vs canvas | vs panel | vs card | vs term |
|---|---|---|---|---|
| 设计稿原值 `#22344F` | 1.49 | 1.38 | 1.27 | 1.51 |
| **本 pack 取值 `#4A6C9B`** | **3.49** | **3.24** | 2.97 | **3.54** |

**为什么必须改：** 这套界面的结构层级几乎全部由那一根规则线承担。实测四个表面
彼此之间的对比度只有 `panel/canvas` **1.08**、`card/canvas` **1.17**、
`raise/card` **1.13** —— 也就是说「三层表面」在对比度上几乎是同一个颜色，
用户看到的边界**就是线本身**。

产品规格的验收线是**「3 米外投屏可读」「一屏三层」**。在 1.27–1.49 的线对比度下，
投屏上三列会糊成一块、规则线直接消失 —— 那不是「风格低调」，是**验收不通过**。

提到 3:1 以上后，线在 canvas / panel / term 三个面上都过线。`card` 面 2.97 是
四舍五入差一点，可接受：**card 面上的列分隔由 `--kits-color-rule-strong`
（`#6C90C0`，实测 card 4.85）承担**。

这是一次「设计稿令牌 → 产品验收条件」的取舍，记录在此与
`manifest.json` 的 `darkDirection.notes` 里，不是静默改动。

---

## 6. 排版栈：等宽即读数，不是全站等宽

```css
--kits-font-display: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, "Noto Sans SC", monospace;
--kits-font-body:    Inter, "Noto Sans SC", ui-sans-serif, system-ui, sans-serif;
--kits-font-mono:    "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, "Noto Sans SC", monospace;
```

**为什么 `--kits-font-display` 选等宽而不是 Inter：**

控制台的标题应该是**「被量出来的，不是被排出来的」**。大标题在这里不是一件排版
作品，而是一行**状态结论**（「已闭环」「检测到横向移动」）—— 让它与下面的读数
同族同宽，读者接收到的信息是「这两件事在同一个测量系统里」。用 Inter 会把标题
变成一种与数据无关的装饰层，而这块屏上的装饰预算已经被前面两条约束吃光了。

**为什么正文不用等宽：** STH 是**中英混排**界面。全站等宽会让中文段落塌成不可读的
字块 —— 等宽的汉字与等宽的拉丁字母在同一行里产生参差的字距，而中文没有西文的
词间空隙来补这个节奏。等宽必须**只覆盖读数性文本**：数字 / ID / 命令 / 日志 /
审计行 / 证据引用 / 标签。

**字体全部走系统栈**：Kits 不把外部字体当依赖（见 [`docs/faq.md`](../../docs/faq.md)）。
这里只有 `font-family` 名字，没有 `@font-face`、没有字体文件。上面三个字体名
**只出现在栈里**。

---

## 7. 使用方式

```tsx
import "@kits/style-console/tokens.css";

<section data-kits-pack="console">
  <header className="kits-nav">
    <span className="kits-label">STH / 战情</span>
    <input className="kits-control" placeholder="查询：asset:10.0.3.7  severity:high" />
    <button className="kits-control kits-control--authorize">待授权 · 3</button>
  </header>

  <div className="kits-surface">
    <span className="kits-label">结论</span>
    <p className="kits-display">横向移动已闭环</p>
    <p className="kits-lead">14:02 起 3 台主机出现异常横向连接，证据链已归档。</p>
  </div>

  <div className="kits-surface">
    <span className="kits-label">处置覆盖率</span>
    <span className="kits-data">92.4%</span>
  </div>
</section>
```

### 可用的工具类（由 pack 提供）

| class | 作用 |
|---|---|
| `.kits-display` | 结论级标题（等宽 700 / 1.04 / 34–52px） |
| `.kits-body` | 正文（**无衬线** 17px / 1.55） |
| `.kits-label` | 列标题 / 字段名（等宽 13px uppercase +0.08em） |
| `.kits-data` | 读数（等宽 36px，tabular-nums lining-nums slashed-zero） |
| `.kits-lead` | 导语 / 3 米层说明文本（**≥20px**，无衬线） |
| `.kits-surface` | 面板（点阵格位伪元素，0 圆角 0 阴影） |
| `.kits-rule` / `.kits-rule--short` | 结构线 / 强调短横线 |
| `.kits-control` | 矩形格位控件（38px 高，可排进 76px 顶栏） |
| `.kits-control--primary` | 主操作 = AI 青（「系统在做的事」） |
| `.kits-control--authorize` | 待授权 = 琥珀（**只用于待人授权**） |
| `.kits-control--danger` | 危险操作 = 攻击红 |

### 3 米可读字号（产品规格的硬约束）

| 层级 | 字号 | 位置 |
|---|---|---|
| 结论级 | 34–52px (`.kits-display`) | 中列战情结论 |
| 读数 | 36px (`.kits-data`) | 指标、计数 |
| 面板标题 | 24px (`--kits-title-size`) | 面板抬头 |
| 3 米层说明 | 20–24px (`.kits-lead`) | 需要远读的说明 |
| 面板内部 | 13px (`.kits-label`) / 17px (`.kits-body`) | **不在** 3 米层 |

判据不是形容词：凡是进入远读层的规则（`.kits-display` / `.kits-data` /
`.kits-lead`）字号全部 **≥20px**。13px 标签属于面板内部，它承担的是「凑近才需要
读的字段名」，远读信息必须由上面四层承载。

---

## 8. 动效：事件驱动

| 事件 | 动效 |
|---|---|
| AI 产出 token | 流式打字 |
| 会话「运行中」 | 呼吸点（**唯一**允许的循环动效） |
| 引用关系建立 | 粒子汇流 |
| 结论落定 | 碎裂盖章 |
| 人推翻 AI 结论 | 划掉重写 |

**交互动效整体 ≤240ms**：时长刻度 `instant 60 / quick 120 / base 180 / slow 240`。
`slow` 就是这条规格的上限，没有更慢的交互档位。

**弹簧缓动被刻意改成无过冲**（`cubic-bezier(0.22, 1, 0.36, 1)`，而不是契约默认的
`(0.34, 1.56, 0.64, 1)`）：契约默认值的第二个控制点 y = 1.56 意味着**过冲** 56%
再弹回。一个读数的位置如果在落定时越过了自己的格位再弹回来，它在落定过程中
就是**错的** —— 控制台的数字必须「到达即正确」。

**`roles` 里有 `ambient`，这与 instrument 不矛盾**：区别在于「呼吸这件事在这块屏上
说不说话」。在监控面板上，持续呼吸的指示灯会与真实状态变化争夺注意力，所以
instrument 把它整个拿掉。在运营控制台上，呼吸点是有语义的 —— 它标记**哪一个
会话/任务此刻真的在跑**（一屏 6 个任务，其中 1 个在跑）。因此授予条件是**排他的**：
只有承载「运行中」的那一个元素可以用 `--kits-dur-ambient` / `--kits-ambient-cycle`。

这与 `materialDirection.ambient: "none"` 不冲突：**CSS 里没有 `.kits-ambient`**，
没有容器级环境光层；呼吸点是元素级状态指示。

---

## 9. 材质语言（v0.2 · K8）

| 项 | 值 |
|---|---|
| 材质语言 | `rule` / `ambient: none` / `glow: forbidden` |
| 可核对项 | CSS 里不得出现 `.kits-ambient`；`--kits-color-glow` 必须是 `transparent` |
| `effects[]` | **空** —— 本 pack 不登记任何 effect |
| `signatureComponents` | `["evidence-chip"]` —— K2 落地的组件；理由见 §14 |
| `optionalComponents` / `discouragedComponents` | **空** —— 其余组件与本 pack 无关，不勉强挂 |

**为什么 `effects[]` 是空的：** 本 pack 的材质声明是「没有环境光、禁止发光」，
因此它**不允许**登记任何 `material.kind = light` 的 effect（audit 会交叉核对，
`material/light-effect-forbidden`）。现有三个 effect 里 `ambient-glow` 是 light 类，
直接违反；`paper-grain` 是纸纹（与「离散格位」的表面哲学冲突）；`scanline-sweep`
是扫描线 —— 而扫描线装饰在本 pack 里是被明确禁止的。所以正确的答案是空数组，
而不是「随便挂一个」：**没有需要的东西时，不登记比凑一个更诚实。**

归属四层（Core / Style Pack / Effect Pack / Product）的对照见
[`docs/material-handoff.md`](../../docs/material-handoff.md)。

---

## 10. 什么时候**不要**用

- **移动端为主的产品**：三列 500/600/366 的骨架在 390px 下会退化成单列长页，
  而「16:9 单屏不滚动」这个前提一破，`very-high` 密度就失去了理由。
- **触控为主要输入的场景**：命令条导航与 13px 等宽标签在手指下无法精确命中。
- 品牌营销页、发布会页：这套风格刻意放弃了装饰性表达。
- 以长文阅读为主的产品：等宽读数与列规则线会打断阅读节奏。
- 需要情绪与沉浸感的内容页：终端气质会显得冷。

更多见 `manifest.json` 的 `recommendedFor` / `avoidFor`（枚举标签）与
`recommendedForNotes` / `avoidForNotes`（人读的完整理由）。

---

## 11. 明确禁止

| 禁止 | 为什么 |
|---|---|
| ambient 环境光 | 控制台的光只能来自真实状态；CSS 里没有 `.kits-ambient` |
| 发光 glow / bloom | `--kits-color-glow: transparent`，且与声明交叉核对 |
| 扫描线装饰 | 纹理必须是**点阵格位**（离散），不是周期条纹（扫描线） |
| 蓝紫渐变 | 颜色必须携带语义，不能携带情绪 |
| 粒子地球 | 「展厅大屏」的标志，与本 pack 气质互斥 |
| emoji | 字符集是语言与符号，不是表情 |
| 无意义入场动画 | 没有状态变化支撑的动画 = 耗电的噪音 |
| 回弹缓动 | 读数在落定过程中的过冲 = 中间态是错的 |
| 全站等宽 | 中文正文会塌成不可读的字块 |
| 处处画线 | 线一旦出现在非语法位置就退化成表格装饰 |
| 一色两义 | 用 AI 青去强调与 AI 无关的东西，等于两种含义都失效 |
| 仅靠颜色区分状态 | 色觉障碍 + 投屏丢色都会让纯色编码失效 |

---

## 12. 无障碍

- **对比度**：见 §4 的完整实算表。主墨 13.52–16.13、次墨 6.20–7.39、次级语义色
  全过 AA。两条**如实写出的限制**：三级墨只允许非正文；card 面上的攻击红只允许
  大字或非文本元素。
- **字号**：远读层 ≥20px。13px 等宽标签不得承载唯一关键信息（应能在正文找到对应）。
- **状态不可仅靠颜色**：青/琥珀/红/绿/蓝必须同时有文字或符号标注。
  `+2.4%` / `-1.1%` 的符号是必需的，不是可选的。
- **等宽 + `tabular-nums` + `slashed-zero`** 是密集读数的可读性措施：
  `0` 与 `O`、`1` 与 `l` 在 ID / IP / 哈希里必须能被区分。
- **reduced-motion**：`collapseTo 0ms`，**保留透明度淡入**（深色面上直接切断
  会出现闪白），**保留颜色**（颜色是状态语义，冻结它等于删掉一整套状态信号），
  `ambient` 角色**整个关闭** —— 呼吸点是唯一会无限持续的动画，也是前庭敏感用户
  最容易被它干扰的一类；它的信息有静态替代（实心状态点 + 文字状态词）。
  这与 instrument 的「不保留淡入」是**不同的取舍**，两者都对：instrument 的场景里
  「晚 60ms 看到故障」是事故，console 的场景里「结论晚 60ms 出现」不是。
- **移动端**：断点 768px；位移缩放 0.5（4px → 2px）；呼吸点动画关闭。
  `mobileCompatible: true` 只表示「不会因为 API/布局假设而天然失效」，
  **不表示推荐在移动端使用** —— 推荐与否见 `recommendedFor` / `avoidFor`
  （本 pack 的 `avoidFor` 含 `mobile`）。

---

## 13. 性能

| 项 | 值 |
|---|---|
| 分类 | **A**（与 instrument 同档：合成成本最低） |
| JS | 0 KB |
| CSS | ~8 KB（未压缩） |
| 滤镜 / backdrop-filter / 投影 / 混合模式 / animation | **0 / 0 / 0 / 0 / 0** |

**为什么是 A 而不是 B：** 唯一可能影响合成的属性是表面点阵纹理
（`background-image` + `opacity`），它被封在**单一伪元素**内，且刻意**不用
`mix-blend-mode`** —— 混合模式会额外请求一个合成层。三个让 cinematic 落到 B 档的
属性（`backdrop-filter` / 多层径向渐变 / `text-shadow` 光晕）本 pack 一个都不用。

**真实的成本不在这里：** 本 pack 换来的密度会在**组件层**产生成本 —— 40+ 面板的
DOM 节点数比样式更可能成为瓶颈。如果需要上百个格子，用**父容器一次绘制的网格
背景**，而不是每个格子一个 `.kits-surface` 伪元素。

---

## 14. 相关资产

- 组件：[`evidence-chip`](../../components/evidence-chip/README.md)（K2 落地）。
  它是本 pack 唯一的 `signature`，理由不是"顺手挂一个"：
  §4 的「一色一义」把 `--kits-data-series-3` 指定为**证据引用蓝**，
  而这个组件正是读那个槽位来画引用号的 —— 两边是同一条语义，不是巧合。
  其余组件与本 pack 的关系仍然是不登记 / `discouraged`：
  高密度列不需要指针光斑、环境网格与滚动揭示
- 效果：**无**（`effects: []`）—— 理由见 §9
- 参考板：**尚未建立**（`references/console/` 不存在）。本 pack 的设计参考是
  STH 设计稿本身与「终端 / 运营控制台」的既有共识，不是某个第三方页面；
  需要参考板时再按 [`references/README.md`](../../references/README.md) 的规则补
- 技能：[`skills/visual-direction/SKILL.md`](../../skills/visual-direction/SKILL.md)

---

## 15. 换 pack 时你唯一要改的东西

```diff
- <section data-kits-pack="console">
+ <section data-kits-pack="instrument">
```

`.kits-control--authorize` / `.kits-control--danger` / `.kits-lead` 是 console 专属
语义的产物，换 pack 后它们会失去样式 —— **这是预期行为**。一个「待人授权琥珀按钮」
不该出现在编辑式页面上。如果你发现「必须保留它们」，说明选错 pack 了。
