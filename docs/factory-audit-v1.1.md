# Factory v1.1 — 审计记录

> 这份文件记录**改动之前**实际读到的东西。它是一次快照，不是持续维护的文档。
> 目的是让「为什么这么改」有据可查，而不是若干轮之后只剩结论。

审计方式：三路并行只读扫描（共享组件 / app+lib+stores / tests+Playwright），
加上对 `app/globals.css`、`AGENTS.md`、两个 Skill 与 Kits CLI surface 的逐行阅读。
仓库在审计期间未被修改。

---

## 分类口径

| 类别 | 含义 | 处置 |
|---|---|---|
| **A** | Core infrastructure —— Factory 自己的机制 | 保留 |
| **B** | Factory defaults —— 中性默认值与 demo 内容 | 保留，中性化 |
| **C** | Reference Product visual assumptions —— 某个参考产品的美术方向 | 从 Core 解耦 |
| **D** | CRM-specific leftovers —— 具体产品的数据/路由/文案 | 移出 Core 的规则层 |
| **E** | 应该由 Kits 接管的视觉内容 | 记录，交还 Kits |

---

## 1 · 共享组件的耦合：**只有 5 行 import，4 个文件**

这是审计最重要的发现——耦合远比预期小，而且**不在结构里，在默认值里**。

| 文件:行 | import |
|---|---|
| `components/layout/top-nav.tsx:42` | `import { useDashboardStore } from "@/stores/dashboard-store"` |
| `components/layout/top-nav.tsx:44` | `import type { AppNotification } from "@/lib/mock-data"` |
| `components/prototype/stats-card.tsx:10` | `formatCurrency, formatCurrencyCompact, formatNumber` ← `@/lib/format` |
| `components/prototype/metric-strip.tsx:6` | 同上 |
| `components/prototype/ai-summary-panel.tsx:9` | `import type { AiSummary } from "@/lib/ai-summary"` → 而它又 import `CrmCustomer` |

**零命中**：`@/lib/crm-data`、`@/lib/insights`、`@/stores/crm-store`、`@/app/*`。
**没有任何一个共享文件本身是 CRM 产物**——耦合是通过 import、类型和格式化器渗进来的。

### 更隐蔽的一层：词典中介的默认值

`Sidebar` 不传 `items` 就回落到 `defaultNavItems(t)` → `t.demo.nav.*`；
`brand` / `user` / `usage` 回落到 `t.demo.*`，其中 `progress` 是字面量 **64**。
`TopNav` 不传 `dataSource` 就回落到 `useDashboardStore` + `t.account.*`（**陈美雅 / meiya.chen@zhiwu.cn**）。

后果很具体：**`/demo` 页面顶栏显示的是 CRM 的账户身份**，而且任何新原型不写一行代码就会继承「云图分析 / 吴桐」。

> 这就是「共享组件对产品身份零意见」这条规则的由来——默认值本身就是一种 Factory 意见。

### 词典是隐藏的编译期耦合

```
lib/i18n/zh-CN.ts:1
  import type { ActivityKind, CustomerPlan, CustomerStatus, TaskColumnId } from "@/lib/crm-data"
```

于是**每一个 `useMessages()` 消费者**——包括中性的 `/demo` 和共享 Core 组件——都有一条指向
`lib/crm-data.ts` 的编译期边。这条边在源码搜索里几乎看不见。

---

## 2 · `app/globals.css`（643 行）分类

### A —— 中性设计系统层（保留）

- `@theme inline` Tailwind bridge、shadcn primitive bridge
- surfaces / status / border / hairline 全组 token
- radius 与 elevation 全部 token
- 完整排版比例（含 CJK 行高与「负字距只给数字」规则）
- semantic spacing、motion durations/easings、container widths
- `numeric` / `eyebrow` / `kbd-chip` / `surface-sheen` 工具类
- `@layer base` 的 CJK 处理与 `prefers-reduced-motion` 全局降级

### C —— 某个产品的美术方向被写成了全局 token

| token | 值 | 备注 |
|---|---|---|
| `--brand` / `--brand-soft` / `--ring` | `oklch(0.5 0.16 254)` 深钴蓝 | 注释自述 "deliberately not AI purple" |
| `--data-accent` | `oklch(0.6 0.125 218)` 电青 | 注释：*"Brand cobalt + this cyan are the only two hues the product owns"* |
| `--chart-1..5` | 1–2 是品牌双色，3–5 **按 CRM 状态语义占用**（合作中/逾期/流失风险） | |
| `--hero-base`、`--ambient-hero-brand/warm`、`--ambient-brand/warm`、`--ambient-grid`、`--ambient-ring`、`--chart-glow` | 固定透明度与色相 | |

### E —— 手写的美术方向，本应由 Kits 资产接管

| 位置 | 硬编码了什么 |
|---|---|
| `@utility ambient-grid` | **`background-size: 44px 44px`** |
| `@utility ambient-wash` | `radial-gradient(60% 55% at 50% 0% …)` + `38% 42% at 88% 8%` |
| `@utility hero-wash` | `radial-gradient(52% 68% at 12% 0% …)` + `44% 56% at 92% 12%` |
| `@utility chart-glow` | `drop-shadow(0 6px 16px …)`，注释自述 "the only glow in the product" |
| `@utility section-tick` | 品牌色短刻度（1.25rem × 2px，`var(--brand)`） |
| `@keyframes live-halo` | 4 处使用，**每处都硬编码 `3.2s`**（其中一个还在共享的 `sidebar.tsx:417`） |
| `@keyframes ambient-drift` | **零消费者（死代码）** |

**最强的 E 信号**：`app/demo/_components/overview-section.tsx` 的注释声称与 CRM「共用同一套 tooltip 皮肤」，
但 `strokeDasharray="2 6"`、`strokeWidth={1.5}`、`strokeDasharray="4 4"`、`tick={{fontSize:11}}`
与 `<linearGradient>` 脚手架在 `overview-section.tsx` 和 `app/crm/_components/revenue-hero.tsx`
里**逐字重复**——手抄的「共享」，不是真的共享。

### 死代码（顺带发现）

`--ambient-ring`（0 消费者）· `@keyframes ambient-drift`（0）· `snappySpring`（0）·
`hooks/use-debounced-value.ts`（0 importers）· `hooks/use-media-query.ts`（0 importers）·
`components/prototype/sign-out-dialog.tsx` 的 `pending` 分支从不渲染（潜在 bug）·
`lib/crm-data.ts:4` 注释称 mock-data 为 "Northwind 演示仪表盘"，而后者自述是「云图分析」（文档漂移）。

---

## 3 · 文档层的 C/D（比代码更严重）

`AGENTS.md` 的 **「视觉构图（Design System V4 — AI Sales Command Center）」** 整节把某个参考产品的
美术方向写成了 Factory 通用规则：`RevenueHero` / `AiInsightLayer` / `OpportunitySpotlight` /
`LiveDataLayer` / `CrmDataBoundary` 的 L1–L6 构图阶梯、`<CrmDataBoundary ambient={false}>` 这种
带产品名的调用示例，都出现在 Factory 的 Agent 指令里。

`README.md` 同样有一节 `Design System V4 — AI Sales Command Center`。

**这比代码耦合更难发现，因为 `grep` import 抓不到它**，而 Agent 恰恰是读文档行事的。

`app/page.tsx:54` 的主 CTA 指向 `/crm`（文案「打开 AI CRM 原型」）；
`app/not-found.tsx:24-28` 的全局 404 建议 `/crm/*` 目的地。

---

## 4 · QA 现状（改动前）

| 能力 | 存在？ | 证据 |
|---|---|---|
| console error 断言 | 部分 | 73 个测试里只有 2 个断言；`crm-navigation.spec.ts` 收集了 `runtimeErrors` 却**从未断言** |
| page error | 部分 | 1 个文件断言，1 个文件收集后不用 |
| response ≥400 | 部分 | 仅 `crm-navigation.spec.ts` |
| **`requestfailed`** | **无** | 仓库零命中——网络层失败完全没被观测 |
| 横向溢出 | **无** | 0 命中 |
| viewport expansion | **无** | 0 命中 |
| 无障碍树 / role 计数 | **无** | 0 命中（`page.accessibility` 在 Playwright 1.63 已移除） |
| axe / a11y helper | **无** | 未安装 |
| reduced motion | **无** | 0 命中 `emulateMedia` |
| touch / coarse pointer | **无** | `devices["Desktop Chrome"]` 是 `hasTouch:false, isMobile:false` |
| probe 完整性守卫 | **无** | 全仓唯一一处数值探针是 `crm.spec.ts:352` |
| 路由可配置 | **无** | 路由字面量散落在 6 个文件里 |

**测试数量**：60 个静态声明 / **73 个运行时展开**（README 声称 59，已过期）。
`test-results/.last-run.json` 写着 `{"status":"passed"}`——与端口复用风险并存，
这正是假绿的标准形状。

### 端口复用的精确机制

```
playwright.config.ts:10   baseURL: "http://localhost:3000"
playwright.config.ts:20   command: "pnpm dev"          ← 未固定端口
playwright.config.ts:22   reuseExistingServer: !process.env.CI
```

只设 `url` 不设 `port` 时，Playwright 的 `checkPortOnly` 为 false，就绪探测是一次真实的
HTTP GET，接受条件是 `200 <= status < 404`；命中且 `reuseExistingServer` 为真时**立即 return，
从不校验应答者是不是本应用**。任何在 3000 端口以 2xx/3xx 应答 `/demo` 的 server 都会被当成被测应用。

兄弟项目已经各自规避（hub 固定 3100，finance 固定 3210），而 **finance 的配置注释点名了本仓库的 3000**：

> 避免与同机的其它原型（如 prototype-starter 的 3000）互相复用——reuseExistingServer 一旦命中另一个应用，整套断言就会在错误的页面上通过

### `.playwright-browsers/` 是被 git 跟踪的机器路径

单个文件 `.links/9e2c603aa11c362ff2b750e1aff8773a5840c4d6`（117 字节），内容是一个**绝对路径**
`/Users/skillre/ai-prototypes/prototype-starter/node_modules/.pnpm/playwright-core@1.63.0/...`。
它由 `playwright-core` 的 `registry.install()` 写入，从初始提交 `8cfb42f` 就在仓库里。
`PLAYWRIGHT_BROWSERS_PATH` 在任何地方都未设置；浏览器实际来自默认缓存
`~/Library/Caches/ms-playwright`（chromium-1243 = playwright-core 1.63.0 期望的版本）。
也就是说：一个机器相关的缓存标记被提交进了一个会被复制到每个新原型的模板仓库。

---

## 5 · 审计发现但**本轮未处理**的项

诚实记录，避免下一个人重新发现：

| 项 | 现状 | 为什么没做 |
|---|---|---|
| `lib/format.ts` 硬编码 `zh-CN` + `刚刚/小时前/昨天/天前` | 被 `stats-card` / `metric-strip` 消费，中文文案渗进共享组件 | 属 B（Factory default），改它会波及 `/crm` 与 `/demo` 的调用面；已为 `animated-number` 加上可覆盖接口 |
| `lib/i18n/zh-CN.ts:1` 的 CRM 类型 import | 词典与 CRM 类型编译期耦合 | 需要把 CRM 词典组拆出去，是产品拆分工作，不是机制回灌 |
| `app/crm/**` 整套参考产品 | 5 条路由 + 13 个组件 + 2 个 store | **保留**。§20 禁止创建第三个 Reference Prototype，但没授权删除已有的；把它从 Core 规则里降级为「用旧流程做出来的样本」是可控且可回滚的 |
| 死代码（`ambient-drift`、`snappySpring`、2 个 hook 等） | 无消费者 | 与 v1.1 目标无关；删除会产生无收益的 diff |
| `lib/format.ts` 之外的 `progress: 64` 等字面量 | 已随默认值移除 | — |

---

## 6 · 一句话结论

**Factory v1.0.0 的问题不是耦合太深，而是「默认值里藏着产品身份」。**
结构本身已经很接近对的（Sidebar/TopNav 都接受注入，AI CRM 也确实注入了全部）；
需要改的是**把注入变成必填**，并且**把某个参考产品的美术方向从 Factory 的文档与 token 叙事里拿出去**。
