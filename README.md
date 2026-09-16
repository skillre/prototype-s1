# S1 工作台 · AI 原生安全运营工作台

面向**保险公司安全团队**的 SOC 控制台原型：AI 自主调查与闭环、人只在关键门授权、
每条结论都能点开证据。现场演示时，右屏就是它。

纯前端：Next.js 16（App Router）+ TypeScript + Tailwind v4 + shadcn/ui（Base UI）+
Motion + Zustand —— **没有后端、没有数据库、没有鉴权，也不调用任何外部接口**。

> **本仓现在的状态：初始化边界已完成，组件层尚未实现。**
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

> 「S1 是 16:9 单屏不加滚动的控制台，产品形态不提供移动端；投屏环境为固定 16:9。
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

## 产品形态（目标规格，尚未实现）

16:9 单屏不加滚动；滚动只发生在面板内部。三列战情室：

```
① 态势指挥条（顶栏）
⑤ 攻击链·实体视图 │ ② 任务计划 ③ 研判流 ④ 工具控制台 ⑩ E+N 数据汇流 │ ⑥ 处置与授权 ⑧ 审计时间线 ⑪ 战果与沉淀
⑨ 问 S1（640px） + ⑭ 报告流式生成（底栏）
```

十二个组件服务六个特征：**自主规划 · 工具调用 · 证据推理 · 分级授权 · 记忆进化 · 主动汇报**。
取值范围（令牌、布局尺寸、组件清单与实测文案）见工作区根目录的
`S1-设计稿实测与实现规格.md` —— 那是从设计稿（391 节点 / 1680×1050）实测抽取的事实记录，
不是转述；本仓的界面取值以它为准。

两条已经签署、不要重新讨论的边界：

1. **传统规则引擎对照栏不进本仓**：它服务的是演示叙事，不是 S1 的能力，
   由演示编排层承担；⑬ 编号在 S1 内永久空缺。
2. **本阶段是确定性回放**：真编排器 + 真事件契约 + 真状态机跑脚本化事件，界面 100% 真实，
   但命令**不落到真实主机**。

## 当前进度

**已经做完（可验证的，不是我说的）：**

| 项 | 凭据 |
|---|---|
| 身份是 S1 自己的 | `package.json` 的 `name`、`app/layout.tsx` 的 metadata、首页、404、词典；`pnpm factory:init` 逐字扫描 |
| Reference Sample 已删除 | CRM 路由、内置演示、样例样式层与只服务它们的测试全部移除；边界记在 `init-contract.json` |
| `console` 风格包已安装并接入 | `lib/kits/kits.lock.json`（registry 0.3.0）· `pnpm qa:doctor` 全过 · `pnpm qa` 与 `tests/art-direction.spec.ts` 的「the declared Style Pack reaches real pixels」 |
| 初始化边界已冻结 | `init-contract.json` 的 `stage: "product"`，`sampleOwned` 列出的是**真的已经不存在**的路径 |
| 工厂门禁全绿 | 本 README 的「质量门」一节，逐条真跑过 |

**还没做（不要在演示里承诺）：**

- 十二个组件一个都没有实现；事件契约（8 类消息）与确定性回放器属于后续 S1 工单。
- `console` 风格包**已经装进本仓并接在深色主题上**（`lib/kits/installed/console`，
  registry 0.3.0），但签名组件预算仍是 0，所以界面上能看到的仍然只有这一页。
  pack 的接入链路是 `app/globals.css` → `lib/kits/adapters/s1-tokens.css`（产品所有）
  → `lib/kits/installed/console/tokens.css`（Kits 托管）：**产品代码永远不直接 import 托管区**。
- `product-contract.json` 目前仍是基线的两条不变量。S1 自己的「绝不能搞错什么」
  尚未由人签署；**Factory 不允许 Agent 生成或改写不变量**，所以这里是空的，
  等签字后替换。

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
app/            路由与页面（/ 与 404；其余路由尚未建立）
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
