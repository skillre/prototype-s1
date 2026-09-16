# Prototype Creation Workflow

Factory v1.2 的正式生产流程。**顺序不可交换**——每一步都在为下一步消除一整类返工。

```
Factory baseline
      ↓
new independent repo
      ↓
main baseline
      ↓
feature/<product>
      ↓
Product Model
      ↓
Product Semantic Invariants ← 先定义「绝不能搞错什么」，登记进 product-contract.json
      ↓
Art Direction Divergence ← 先回答：这个产品为什么不该长得像 Reference Sample / 上一个原型
      ↓
Visual Manifest          ← 把决定写下来（含 intentional deviations）
      ↓
Human Art Direction Gate ← 人工停一次，不可跳过：九问，答完才能继续
      ↓
Kits Source Installation
      ↓
Product-owned adapters
      ↓
Build
      ↓
Invariant tests          ← 数据型原型：先定义不变量，再大规模做 UI
      ↓
Browser QA
      ↓
Preview
      ↓
Human Visual Acceptance  ← 机器只能证明"没有回归"
      ↓
Release
      ↓
Production
      ↓
Hub registration
```

---

## 阶段说明

### 1 · Factory baseline → new independent repo

从 Factory baseline 复制出**一个独立的仓库**。不是 monorepo，不是 workspace——产品之间不共享运行时。

### 2 · main baseline → `feature/<product>`

```bash
git status                       # 确认没有未提交的用户修改
git checkout main
git pull --ff-only origin main
git checkout -b feature/<product>
git branch --show-current        # 必须是 feature/<product>
```

一个原型一个 branch。不重复使用旧 branch 做不同的原型。

### 3 · Product Model

先回答：**这是什么产品、用户来干什么、一屏里最重要的是什么。**

这一阶段的产出不是代码，是对"第一视觉焦点是什么"的初步判断——它是下一步的输入。产品模型没想清楚就开始选色，最后得到的是"哪都还行、哪都不成立"。

### 4 · Product Semantic Invariants

**先于 Art Direction，先于 UI。** 回答：**这个产品绝对不能在语义上搞错什么？**

第三 Prototype 的 18 条不变量就是这一类东西——`resolved ≠ accepted-as-limitation`、
AI 建议不得进入 Finding、派生事实与人的处置不是同一份状态。它们不是视觉约束，
所以**不放进 `visual-manifest.json`**；它们进 `product-contract.json`：

```json
{
  "schemaVersion": 1,
  "invariants": [
    {
      "id": "tension.resolved-requires-fact-change",
      "statement": "把紧张标记为「已解决」必须伴随一次真实的事实变更，而不是只改状态字段。",
      "enforcement": "test"
    }
  ]
}
```

并用 `tests/support/product-contract.ts` 的 `invariant()` 把测试登记到同一个 id 上：

```ts
invariant("tension.resolved-requires-fact-change", "已解决必须有事实变更", () => {
  test("负例：只改状态码 → 必须被拒绝", async () => { … })
})
```

```bash
pnpm factory:contract     # 双向核对：声明 ↔ 登记
```

- **id 是机器可读的、与语言无关的**（点分小写 kebab），不依赖中文文案，也不依赖测试标题；
- **声明与 enforcement 缺一不可**：声明了没人守 → FAIL；测试登记了没声明 → FAIL；
- **0 条是合法的**，但它必须是一个决定，不是没人问过；
- **Factory 不生成、不推断、不改写任何一条**：判断是人做的，这里只提供登记面与一致性门。

**不变量先于 UI 写完**，因为它是 UI 的**规格**，不是 UI 的**备注**：

| 类型 | 判断标准 |
|---|---|
| 总量守恒 | 分项之和 == 总计 |
| 派生一致性 | 派生指标 == 从原始数据重算的结果 |
| 数据 == 可视化 | 图上渲染的数值 == 源数据里的数值 |
| 引用真实记录 | 洞察里的实体确实存在于数据集中，且可跳转 |

> Factory **不**包含任何具体账本规则。AI Finance 的金额/停滞天数语义属于 AI Finance。

### 5 · Art Direction Divergence

**先于 Manifest。** 在继承任何已有视觉模式之前，回答一句话：

> **这个产品为什么不应该长得像 Reference Sample / 上一个 Prototype？**

为什么这一步必须单独存在：Starter 与 Style Pack 会主动施加一个**重力场**。baseline 里
有 sidebar、有 hero、有卡片网格、有环境光；什么都不说的时候，产出就会朝那个形状塌下去
——而那不是任何人为这个产品做的决定。

这一步的产出是一句 **divergence statement**（写进 Manifest 之前的草稿，不需要机器格式），
例如：

- 禁止 dashboard hero：这个产品没有"总览"这个动作；
- 不使用 sidebar 作为主结构：主结构是纵向论证链；
- 不采用 card grid：区域之间靠 hairline 与留白分开；
- mobile 必须重新编排，而不是把三列压成一列；
- 第一视觉由"缺口"而不是指标数字主导。

它不是"再写一份设计文档"，也不是 Manifest 的自动生成物——**它是人的 Art Direction 输入**。
写不出这句话，通常意味着 Product Model（第 3 步）还没想清楚。

> v1.1 的流程里没有这一步，于是"不要长得像默认模板"这件事只存在于 `avoid` 字段里，
> 而 `avoid` 是**结果**；这一步是产生它的**过程**。

### 6 · Visual Manifest

**在写任何 UI 之前**产出 `visual-manifest.json`，把第 3、4 步的决定写成**机器可检查的形状**。

见 `docs/visual-manifest.md`。要点：

- 八项必填；`firstVisual` 与 `avoid` 是强约束，会被校验器强制；
- 与 pack 默认不一致的地方写进 `deviations`（axis / from / to / reason）——
  偏离是**记录**，不是自动批准，也不能绕过 `avoid`；
- 签名组件数量上限写进 `signatureComponentBudget`（Factory 只守你写的数，不替你定数）；
- 具体可选值从 Kits registry 读取，Factory 不复制；
- 校验：`pnpm factory:manifest`（结构 → 自洽 → 与 pack 比对）。

**没有 Manifest 就不能进入实现。** `pnpm factory:kits` 会直接拒绝。

### 7 · Human Art Direction Gate

**在安装 Kits 与写 UI 之前，人工停一次。** 这不是审批流程，是要求人对下面九件事**给出答案**：

| # | 必须回答 | 落在哪 |
|---|---|---|
| 1 | 第一视觉是什么 | `firstVisual` |
| 2 | 页面**绝对不能**长成什么 | `avoid` |
| 3 | density | `density`（与 pack 不一致就写 `deviations`） |
| 4 | motion direction | `motionDirection` |
| 5 | signature budget：最多几个签名组件 | `signatureComponentBudget` |
| 6 | Style Pack | `stylePack` |
| 7 | effects budget：要不要 effect、最多几个 | `effects` |
| 8 | desktop / mobile 是否需要结构分化 | 决定 + 写进 divergence statement |
| 9 | 是否存在 intentional deviations，理由是什么 | `deviations[].reason` |

**九问，不是二十项问卷。** 每一问都对应一个会被机器检查的字段或一条会进 `avoid` 的约束；
答不上来的那一问就是这一步存在的理由。Agent 可以起草，**不能代替人确认**。

回答完之后 `pnpm factory:manifest` 必须通过；`deviations` 里每一条都要有理由。

### 8 · Kits Source Installation（`kits add`）

机制上这一步就是执行 `kits add`，由 Factory 包装成一条命令：

```bash
pnpm factory:kits              # 先 dry-run 看计划
pnpm factory:kits --write      # 真实安装 → 校验 lock → 跑 doctor
```

参数全部来自 Manifest（`stylePack` / `signatureComponents` / `effects`）。Factory 调用 Kits CLI，不重新实现它。

### 9 · Product-owned adapters

`lib/kits/adapters/` 归产品所有，Kits 永不覆盖。产品的手写集成放这里。

**产品代码不得直接 import `installed/*`**，必须走 `Product → adapters → installed`。

见 `docs/kits-ownership.md`。

### 10 · Build

真实组件 + 局部状态驱动。每个可见控件连到 state 或 store；不允许假按钮，不允许静态 mockup。

### 11 · Browser QA

```bash
pnpm qa
```

见 `docs/browser-qa.md`。要到达的状态：

```
0 console error · 0 page error · 0 request failure · 0 横向溢出 · 0 viewport expansion
```

### 12 · Preview

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm qa
git add <explicit-files>
git commit -m "feat(<product>): …"
git push -u origin feature/<product>
```

→ GitHub → Vercel Preview。见 `docs/vercel-bootstrap.md`。

**这个 commit 的 SHA 就是 RC。** 记下它——后面每一步都在说「同一个 SHA」。
Preview 出来之后先验证身份（`target` / `git ref` / `git SHA` / `readyState`），**不要靠 URL 判断**：

```bash
node scripts/verify-deployment.mjs verify --deployment preview.json --rc <rc-sha>
```

然后在**部署环境上**跑在线 QA —— 本地绿了不等于部署上是对的：

```bash
pnpm qa:online --base-url=<preview-url> --identity=preview.json --expect-sha=<rc-sha>
```

见 `docs/browser-qa.md` 第 8 节。受 SSO 保护时它**不算部署失败**，也不要写成 public。

### 13 · Human Visual Acceptance

**机器能证明的是"没有回归"；"这一版好不好看"不在机器的证据范围内。**

Preview URL 交给用户做人工视觉验收。同时复核 Manifest 的约束是否被遵守——特别是 `avoid` 里的每一条在产物里是否真的没有出现。

**HVA 未完成，状态只能是 `READY FOR HUMAN VISUAL ACCEPTANCE`** —— 契约里没有 `READY FOR RELEASE` 这个状态。

### 14 · Release → Production → Hub registration

**完整顺序见 `docs/release-runbook.md`**（RC → 门禁 → Preview → 在线 QA → HVA → 源码发布 →
Production → annotated tag → housekeeping）。只有用户明确要求时才 merge `main`；
Agent 默认不 merge、不 tag、不删 feature branch。

**部署不是一次中立的 push。** 发布到 Production 之前读 `docs/vercel-bootstrap.md` 第 0 节，
并跑一次预检：

```bash
node scripts/verify-deployment.mjs preflight --branch <b> [--production-branch <p>] [--authorized]
node scripts/verify-deployment.mjs verify --deployment <json> --rc <已验收 SHA>
```

创建 / 连接 Project、改 Production Branch、改 Deployment Protection、创建 Production deployment、
创建 bypass token 都需要用户**明确授权**；受 SSO 保护的 URL 不得称为 public。

**`main` 就是 Production Branch 时，push 前 STOP；不允许「先 push 再 cancel」。**
tag 必须是 annotated，且指向**已验收的 RC SHA**；不要 `git push --tags`。

---

## Agent 不能跳过的六步

| 步骤 | 跳过会怎样 |
|---|---|
| **Product Semantic Invariants** | 最承重的产品决策只活在某个 spec 文件里：没有登记、没人复查、换人即失传 |
| **Art Direction Divergence** | 直接继承 baseline 的重力场：sidebar + hero + card grid，产出"哪个产品都能用，但哪个都不是" |
| **Visual Manifest** | 回到默认审美：卡片 + 阴影 + 渐变 + 紫色，产出"哪都还行、哪都不成立" |
| **Human Art Direction Gate** | Agent 替人做了设计决策，而且没有记录——有意偏离会以"笔误"的样子留在 Manifest 里 |
| **Invariant tests** | 数据型原型的正确性靠肉眼，每次视觉调整都在赌 |
| **Human Visual Acceptance** | 把"没有回归"当成"可以发布" |

---

## 现在还没做的自动化

Factory v1.2 **不做** one-click generator。上面的流程定义了接口，但每个阶段的判断仍然是人的（或 Agent 的）工作。

下一阶段可以考虑 `create-prototype` v0.1，但它的设计前提是这条流程已经被真实跑过——那正是 v1.1 提供的。
