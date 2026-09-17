# STH 工作台 · AI 原生安全运营工作台

面向**保险公司安全团队**的 SOC 控制台原型：AI 自主调查与闭环、人只在关键门授权、
每条结论都能点开证据。现场演示时，右屏就是它。

纯前端：Next.js 16（App Router）+ TypeScript + Tailwind v4 + shadcn/ui（Base UI）+
Motion + Zustand —— **没有后端、没有数据库、没有鉴权，也不调用任何外部接口**。

> **本仓现在的状态：初始化边界已完成，组件层第一批（骨架 + ①②③④）已落盘在 `/workbench`。**
> 这句话是这一版 README 最重要的一行。下面「产品形态」一节描述的是**目标规格**，
> 不是当前能力；「当前进度」一节写清楚了哪些东西真的存在。

---

## 快速开始

```bash
pnpm install

pnpm dev --port 3310     # http://127.0.0.1:3310
pnpm check               # 全部门禁，串行跑完（见下）
```

`pnpm dev` 默认端口请显式写 3310：这个工作区里同时跑着多个原型，端口是独占资源。

## 质量门

任何改动在「完成」之前必须全部通过，且 **`pnpm test` 与 `pnpm qa` 必须串行**
（Next 16 的 dev server 按项目加锁，`.next/dev/lock`）：

```bash
pnpm factory:init      # 初始化边界：stage=product、初始化面上无基线/样例残留
pnpm factory:agents    # 策略门禁：管理块 ↔ factory-policy.json、schema 关键值、lock、CI 契约
pnpm factory:manifest  # Visual Manifest：L1 结构 + L2 自洽 + L3 与 pack 比对
pnpm factory:contract  # 产品语义不变量：声明 ↔ 测试登记，双向核对
pnpm qa:doctor         # Kits doctor：托管文件 checksum / lock / 依赖 / 适配层边界（正式质量门）
pnpm lint              # ESLint
pnpm typecheck         # next typegen + tsc --noEmit
pnpm test              # Playwright E2E（端口守卫 + 自管 server，端口 3310）
pnpm build             # 生产构建（Turbopack）
pnpm qa                # Browser QA 全量扫描（自管 server，自起自停）
```

`pnpm check` 把上面十条串起来；任何一项失败都**禁止**声称完成。
**`doctor` 不通过 = Kits 安装状态不可信 = 禁止声称完成。**

### QA 的矩阵（有意只有一种视口）

`pnpm qa` 扫每条路由 × **desktop 1440×900** × **dark / light 双主题**，要到达的状态是：

```
0 console error · 0 page error · 0 request failure · 0 横向溢出 · 0 viewport expansion
```

**移动视口被有意排除**，理由写在 `.qa/qa.config.mjs` 里（原文由人签署）：

> 「STH 是 16:9 单屏不加滚动的控制台，产品形态不提供移动端；投屏环境为固定 16:9。
> 因此 QA 扫 desktop 双主题，不做移动视口扫描。这不是放弃适配，是产品形态的声明。」

因此粗指针（`coarse-pointer`）一类检查会走「跳过并说明」的分支 —— 那是允许的，
**不要为了让它们跑起来而加回移动视口**。

### 端口隔离（不可协商）

`reuseExistingServer` 是**字面 `false`**，永远。Playwright 的就绪探针只判断
「有东西以 2xx/3xx 应答」，不判断「是不是这个应用」；一旦复用命中别的 server，
整套断言会在**错误的页面**上变绿，而且不报错。

- 端口唯一来源是 `.qa/qa.config.mjs` 的 `QA_PORT = 3310`；`playwright.config.ts`
  与 `.qa/browser-qa.mjs` 都读它，`scripts/check-qa-port.mjs` 是 `pnpm test` 前置守卫。
- 端口被占用时用 `lsof -nP -iTCP:3310 -sTCP:LISTEN` 定位，
  **禁止** `pkill -f "next dev"` / `pkill -f "next-server"` —— 那会杀掉同机其它原型。

## 产品形态（已落盘）

16:9 单屏不加滚动；滚动只发生在面板内部。三列战情室：

```
① 态势指挥条（顶栏）
⑤ 攻击链·实体视图 │ ② 任务计划 ③ 研判流 ④ 工具控制台 ⑩ E+N 数据汇流 │ ⑥ 处置与授权 ⑧ 审计时间线 ⑪ 战果与沉淀
⑨ 问 STH（640px） + ⑭ 报告流式生成（底栏）
```

十二个组件服务六个特征：**自主规划 · 工具调用 · 证据推理 · 分级授权 · 记忆进化 · 主动汇报**。
取值范围（令牌、布局尺寸、组件清单与实测文案）见工作区根目录的
`STH-设计稿实测与实现规格.md` —— 那是从设计稿（391 节点 / 1680×1050）实测抽取的事实记录，
不是转述；本仓的界面取值以它为准。

两条已经签署、不要重新讨论的边界：

1. **传统规则引擎对照栏不进本仓**：它服务的是演示叙事，不是 STH 的能力，
   由演示编排层承担；⑬ 编号在 STH 内永久空缺。
2. **本阶段是确定性回放**：真编排器 + 真事件契约 + 真状态机跑脚本化事件，界面 100% 真实，
   但命令**不落到真实主机**。

## 人眼验收（HVA）

**状态：`READY FOR HUMAN VISUAL ACCEPTANCE`**（2026-09-17，组件批次 3 交付时）。

### 线上地址（2026-09-17 建，人授权"直接上线"）

**https://prototype-sth.vercel.app** —— 人眼验收在**这里**做，不需要在本地跑。

已经核过的事实（不是从 URL 猜的）：

| 项 | 值 | 怎么核的 |
|---|---|---|
| 项目 | `skillres-projects/prototype-sth`（id `prj_5V18fdptrADhVSWkNLjzASpvZbo0`） | `vercel project inspect` |
| 部署 target | `production` | `vercel inspect <url>` |
| 部署状态 | `● Ready` | 同上 |
| 匿名可访问 | `/` 与 `/workbench` 均 **HTTP 200**（普通 `curl`，**没有**用 `vercel curl`） | 匿名请求，故可称 public |
| 页面确实是改名后的 | `/workbench` 里 `STH` × 6、**`S1` × 0**；`<title>STH · AI 原生安全运营工作台</title>` | 抓线上 HTML 数了一遍 |
| **Production Branch = `feature/sth-console`** | 部署别名里有 `prototype-sth-git-feature-sth-console-skillres-projects.vercel.app` | Vercel 为分支部署生成的分支别名 |
| **推 push 会触发生产构建** | push `50efe79` 后 **24 秒**出现一条新的 `Environment: Production` / `Ready` 部署 | `vercel ls` 的部署列表与时间戳 |

**一个必须说清楚的限制：我读不到这次部署的 git SHA。**
Vercel CLI 的 `inspect --json` 只给 `id / name / target / readyState / url / createdAt`，
**完全不返回 git 元数据**（没有 `gitSource`，也没有 meta 里的 commit 字段）。
所以我能证明的是「它是 Git 集成在 push 之后触发的、分支是 `feature/sth-console`」，
**不能**证明「线上这一版 == `50efe79`」。按本仓的规矩，读不到就写读不到，
不拿"时间上像是它"当成 SHA 相等。
（另：**首次**部署是 CLI 上传创建的，那条**完全没有 gitSource**，这一点在第一版 README 里已如实写过。）

要看那一版到底对应哪个 commit，去 Vercel 控制台的部署详情页——那里显示 commit 与作者。
**上了线不等于验收过了。** Agent 侧到此为止：lint / typecheck / test / build / qa 与工厂门禁全绿、
十二个组件全部落盘；**人眼验收仍然没有做**，所以没有发布授权，
也**没有 `READY FOR RELEASE` 这个状态** —— HVA 未完成时只能是上面那一个。

看什么、怎么判红：工作区根目录的 **`STH-人眼验收清单.md`**（那份文件属于控制面，不在本仓）。
它开头那段「状态」写于批次 2，有两条已经过期，以本节的更正为准：

1. ~~「在十二格全部落地之前，请不要用这一页下最终结论」~~ → **十二格已全部落地**（含 ⑨ ⑩ ⑫ ⑭），
   这一页现在可以当作整屏的看片单用。
2. ~~「⑤ 攻击链画布有一处已知缺陷：6 个节点视觉上互相压」~~ → **已修**（2026-09-17）：
   落点改成由图算出的分层布局（排 + 互不相交的列区间），画布成为真正的网格、高度随内容撑开。
   判据是浏览器里逐对量 `getBoundingClientRect()`（`tests/sth-batch3.spec.ts` 的 B 节，
   含一条会红的负对照）。**请按修好后的样子验收**；若仍然觉得挤，说「哪个节点、挤多少」。

双主题截图（1680×1050，深 / 浅各三帧）在 `.qa/out/b3-*.png`，可复现：

```bash
pnpm dev --hostname 127.0.0.1 --port 3310     # 另开一个终端
node scripts/capture-workbench.mjs             # 落 .qa/out/，不自己拉 server（端口是独占资源）
```

**演示请用构建产物**：`pnpm build && pnpm exec next start -p 3310`。

## 当前进度

**已经做完（可验证的，不是我说的）：**

| 项 | 凭据 |
|---|---|
| 身份是 STH 自己的 | `package.json` 的 `name`、`app/layout.tsx` 的 metadata、首页、404、词典；`pnpm factory:init` 逐字扫描 |
| Reference Sample 已删除 | CRM 路由、内置演示、样例样式层与只服务它们的测试全部移除；边界记在 `init-contract.json` |
| `console` 风格包已安装并接入双主题 | `lib/kits/kits.lock.json`（registry 0.3.0）· `pnpm qa:doctor` 全过 · `pnpm test` 里的「the declared Style Pack reaches real pixels」（深色 + 浅色各一条） |
| 初始化边界已冻结 | `init-contract.json` 的 `stage: "product"`，`sampleOwned` 列出的是**真的已经不存在**的路径 |
| 工厂门禁全绿 | 本 README 的「质量门」一节，逐条真跑过 |
| **数据层与确定性回放引擎**（2026-09-17） | `lib/sth/**` + `stores/incident-store.ts` + `tests/sth-invariants.spec.ts`（45 条断言）。事件契约八类消息、18 节拍结构化数据、当日事件簿底座（130 起闭环）、计数聚合、回放、审计重放、沉淀导出/导入都在这一层；`pnpm test` 里五条已签署不变量各有正例与**负对照** |
| **界面第一批：骨架 + ① 顶栏 + ②③④ 中列**（2026-09-17） | `/workbench` 路由（`components/prototype/workbench/**` + `app/workbench/page.tsx`）：1680×1050 画布 + scale-to-fit、态势指挥条与回放控制（真实交互）、任务计划（含重规划划掉重写）、研判流（逐字结论 + 可点开的证据 chip）、工具控制台（命令逐字打出、回显逐行返回）。其余八个面板是页面上看得见的「本面板尚未实现」占位。判据：`tests/sth-console.spec.ts`（90 秒定调的浏览器墙钟实测、动作码图例、计数派生可溯源），骨架尺寸逐值比对种子 `layoutFacts` |
| **界面第二批：⑤ ⑥ ⑧ ⑪ 四个面板**（2026-09-17） | 左列 **⑤ 攻击链 · 实体视图**（SVG + DOM 自绘：节点可键盘到达、边有文本等价物、**只画有证据支撑的边**）、右列 **⑥ 处置与授权卡片区**（免授权通道 + 五件套待批卡 + 由游标派生的 SLA 倒计时 + 三个真的会写回事件的键）、**⑧ 审计时间线**（逐拍不跳不补，点一行把回放停到那一帧）、**⑪ 战果与沉淀**（导出写剪贴板 / 下载 JSON / 贴回来逐条核对）。判据：`tests/sth-panels.spec.ts`（四条已签署不变量各带正例与负对照 + 一色一义的双主题逐元素核对），换渲染器的取证见 `docs/sth-attack-graph-renderer-decision.md` |
| **界面第三批：⑨ ⑩ ⑫ ⑭ 四个面板 + 整屏收口**（2026-09-17） | **⑨ 问 STH**（底栏左：提问命中数据层真有答案的三条才回答，回答带可点开的证据 chip 与消息出处；**答不出时明说答不出**，给出边界与机制，绝不编结论）、**⑩ E+N 汇流管道**（中列 ④ 之下：两路进料 → 上下文包 → 研判消费，图上每个数字都是数出来的）、**⑫ 数字员工花名册**（顶栏右侧席位的展开面：「N 个在岗」是**算出来**的，收尾那一帧逐字等于种子静帧；白名单判决与 `scanAuthority` 同源）、**⑭ 报告流式生成**（底栏右：正文第一行就是演示标识，导出物自带 `demo.isDemo`，导出→贴回→**逐行**等价）。判据：`tests/sth-batch3.spec.ts`（31 条，含 ⑤ 画布的矩形级判据与骨架值的 DOM 断言） |
| **⑤ 画布换成分层布局 + 内容自适应**（2026-09-17，实测缺陷） | 手写格子 `ATTACK_CHAIN_POSITION` 换成了**由图算出来的**分层布局（`attackChainLayout`：按对象模型定向 → 最长路径分层 → 层内重心排序），落点从"一个坐标 + 居中位移"变成"排 + 互不相交的列区间"，画布成为真正的 CSS Grid、高度随内容撑开，线由**量出来的**节点框中心画（`ResizeObserver`）。原因是旧实现的**坐标不同但矩形相交**：画布 444×444、节点宽 202 / 高 98–216，格子间距比节点自己还小。判据是浏览器里逐对量 `getBoundingClientRect()`，配了一条会红的负对照 |
| **骨架值钉到 DOM**（2026-09-17，本批新增） | `geometry.ts` 此前只被断言「常量 == 种子 `layoutFacts`」，**没有任何断言检查浏览器真的按这些值排版**。现在 1680×1050 下用 `getBoundingClientRect()` 断言顶栏 76 / 底栏 130 / 三列 500·600·366 / 根 padding 20 / 列间距 14 / 右侧 146 余量，以及 1440×900 下等比缩小到占满视口而布局仍是 1680×1050。**这条断言当场发现了一个真缺陷**：画布内容溢出时 flexbox 把固定条一起压扁了，顶栏实测只有 52.7px（见下） |
| **一条实测缺陷已修：固定条被内容压扁**（2026-09-17，由骨架断言发现） | 顶栏 / 回放条 / 底栏 / 演示标识都是固定高度的 flex 子项，而默认 `flex-shrink: 1` 会在内容超过 1010px 可用高时把它们按比例压扁 —— 实测顶栏 52.7px、底栏同理，而 76 / 130 是设计稿实测值。现在这四条 `flex: none`，收缩由三列承担（面板内滚动），于是 76 / 130 从"差不多成立"变成一条能判红的几何事实 |
| **两条演示缺陷已修**（2026-09-17，实测定位） | ① `?beat=18` 曾**静默回到开场**（剧本有 18 拍，但没有任何消息带 `beatStep: 18`，排程里没有那一帧，旧实现遇到 `null` 就留在 0）：现在按 `frameForBeatRequest` **往前夹到最近的更晚帧**，夹取在界面上说出来，并有「18 拍都跳得到、计数不倒退」的测试钉住。② 面板正文跟着最新内容滚到底（实测 `scrollTop = 15` / `5`），顶部那一行被切在半个字高上并压到面板头的规则线：现在 `scrollTop` **吸附到最近的行下沿**（`hooks/use-panel-scroll.ts`），溢出时顶边多一层兜底渐隐 —— **没有改成整页滚动**，16:9 单屏不溢出这条承诺不变 |

**还没做（不要在演示里承诺）：**

- **十二格已经全部落盘，Agent 侧没有"待实现的面板"了。** 剩下的是**待人决定的两件事**：
  ① 人眼验收（HVA：双主题、1680×1050、3 米投影距离下的可读性，判据在
  `STH-人眼验收清单.md`，Agent 不能代填）；② 发布授权（是否发布、发哪个 SHA、要不要线上地址）。
  **没有 HVA 就没有发布**，状态只能停在 `READY FOR HUMAN VISUAL ACCEPTANCE` ——
  **没有 `READY FOR RELEASE` 这个状态。**
- **⑬ 传统引擎对照栏永久空缺**（人已签署：交给演示层）。STH 工作台的组件清单是十二个，
  `lib/sth/contract.ts` 的 `COMPONENT_IDS` 里没有它，测试双向钉住 —— 不要看到编号跳号又"补"一个。
- **播放倍速没有实现**：⑧ 的角标写的是「逐拍可回放」而不是设计稿的「可 4× 回放」，
  因为 4× 这个倍速在本仓不存在。写一句做不到的承诺，比不写更贵。
- **⑭ 的进度在回放终点上仍在生成中**（约七成）。这不是没做完，是设计稿静帧本身的样子：
  种子 `report.progressPercent = 68` 就是"还在流式生成"。派生进度由游标算出，
  种子的 68 作为 `data-design-progress` 留在 DOM 上（可断言），但不冒充活读数。
- **⑨ 只有三条问题答得出来**，因为数据层只写了三条答案（`timeline.ASK_STH_ANSWERS`），
  每条都从种子的事实底本里读出来。**能答的问题数就是有出处的问题数** ——
  其余问法一律走「答不出」，并列出答得出来的那几条。加第四条的正当理由只有一个：
  种子里出现了第四条带证据的事实。
- **⑤ 画布上的边比设计稿少**，而且是刻意的：设计稿画了「植入·回合1」「回合3 · 再传」
  两条线，但本回合事件流里**没有证据**能把它们接起来（`webshell1.jsp` 没有 `target`
  之类的引用字段，`保单数据库` 的「推演：横向移动目标」是一句自由描述、不是引用）。
  按不变量 `evidence.every-claim-cites-a-source`，**没有证据的连接不画**，
  而不是补一条看起来对的线。补齐它需要往种子数据里加真实的关系字段 —— 那是数据层的决定。
- **⑫ 的「在岗」= 本回合出动过**（不是编制人数）。所以开场那一帧它读 0，随回放长到 4，
  收尾那一帧逐字等于种子 `headerStats.rosterLabel`。用户直接访问 `/workbench` 不带参数时
  会从头播放，看到的第一个读数因此是「0 个 AI 数字员工在岗」—— 那是**算出来的真值**，
  不是缺陷。
- `console` 风格包**已经装进本仓并接在两套主题上**（`lib/kits/installed/console`，
  registry 0.3.0）：深色是 pack 的原生战情室配色，浅色是**产品层签署**的同一批色相 +
  重算明度（依据：工作区根目录 `STH-浅色主题取值与决策.md`）。接入链路是
  `app/globals.css` → `lib/kits/adapters/sth-tokens.css`（产品所有）
  → `lib/kits/installed/console/tokens.css`（Kits 托管）：**产品代码永远不直接 import 托管区**。
  签名组件预算仍是 0，所以界面上能看到的仍然只有这一页。

> **「pack 有没有真的上屏」这条结论来自 `pnpm test`，不来自 `pnpm qa`。**
> `pnpm qa` 的 sweep 按设计不认识任何 pack id —— 它证明的是"这一页不是浏览器默认样式态"，
> 拿不到"这个颜色就是 pack 的取值"这个结论。那两条像素断言住在强制门禁 `pnpm test` 里
> （`tests/art-direction.spec.ts`：深色一条、浅色一条，逐值比对签署表 + 色相族 + 对比度）。
> 只跑 `pnpm qa` 会看到绿灯，但那不是"颜色对"的证据。
- `product-contract.json` 里是**人已签署的七条 STH 不变量**（加上门禁自己的
  `contract.declaration-matches-enforcement`，共 8 条）：证据引用、分级授权、审计可重放、
  沉淀可导出、计数由事件派生、一色一义、**演示环境标识常驻可见**
  （`boundary.demo-is-labelled-as-demo`，2026-09-16 签署）。`pnpm factory:contract` 双向核对通过。
  最后那一条的数据层那一包**故意没写进契约**（它的判红方式需要 DOM，声明了没测试会让门禁变红）；
  界面第一批建出了对象，于是它进了契约、并在 `tests/sth-console.spec.ts` 里登记
  （深色 + 浅色各一条正例 + 一条负对照）。

## 与 Factory 的关系

这个仓是 **Prototype Factory** 生产的产品，不是基线的副本。区分它们的东西是机器可读的：

| 契约 | 说什么 |
|---|---|
| `init-contract.json` | 三层边界：A Factory Core（`components/**` `lib/**` `scripts/**` `.qa/**` `hooks/**`）、B Reference Sample、C 初始化面。`stage: "product"` 表示初始化面上不得残留基线或样例身份。 |
| `visual-manifest.json` | 美术方向：第一视觉、风格包、签名组件与效果预算、有意偏离、明确不要什么。**没有 Manifest 就开始写 JSX 是违规的**。 |
| `product-contract.json` | 产品语义不变量：这个产品「绝不能搞错什么」。视觉与语义分开，判断由人做。 |
| `factory.lock.json` | 这棵树归哪一版工厂管：派生来源、初始化阶段、Kits 安装状态、部署身份。 |

**Factory Core 是复制来的，不是依赖。** `components/**` `lib/**` `scripts/**` `.qa/**`
提供中性结构：token 层、契约门禁、QA 扫描器、Kits 调用机制。它们**不含**产品身份，
也不含风格包的具体取值 —— 可选值一律在运行时从 Kits registry 读取。

浏览器的真实验证不是可选项：重要交互必须真的在浏览器里跑过，`pnpm qa` 是那条命令。
源码读得再仔细也不是验证 —— Factory 存在的第一个理由就是一次「静默通过」。

## 目录

```
app/            路由与页面（`/` 阶段页 · `/workbench` 工作台 · 404）
components/     ui/（shadcn primitives）· layout/ · prototype/ · motion/ · i18n/
lib/            令牌无关的工具、i18n 词典、契约 schema 的 TS 侧
scripts/        工厂门禁（init / agents / manifest / contract / kits / deploy）
.qa/            Browser QA：端口配置、探针、sweep、style-presence
tests/          Playwright：契约测试（门禁自身的测试）+ 本产品的 E2E
```

## 文案与本地化

默认语言 zh-CN。`app/**` 与 `components/**` 里**不允许**出现硬编码的用户可见文案，
一律经 `useMessages()`（服务端用 `messages`）从 `lib/i18n` 取；
`lib/i18n/zh-CN.ts` 属于初始化面，是产品身份的唯一来源。

## Git 工作流

`main` 是稳定基线，开发走 `feature/<kebab-case>`。`git commit` / `git push` /
`merge` 都需要人的明确授权；部署（Vercel）是**又一次**独立授权，
CI 只做质量门，不部署。
