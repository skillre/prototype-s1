# Product Initialization

> **从一个 baseline 到「这是一个产品」，中间隔着的不是一次 rename，而是一串决定。**
> 这份清单是给 **人 / Agent** 执行的，不是 generator —— Factory v1.2 不生成产品。

它要回答的是下一个从 Starter 开始的人必然会问的那个问题：

> 「这个文件到底该改，该留，还是该删？」

---

## 一、先分清三层

`prototype-starter` 里同时住着三种东西。它们的处置方式完全不同：

| 层 | 是什么 | 路径 | 派生新原型时 |
|---|---|---|---|
| **A · Factory Core** | 结构、契约、门 | `components/**` · `lib/**`（含 tokens / i18n / manifest 契约）· `scripts/**` · `.qa/**` · `hooks/**` · `stores/**` · `skills/**` · Core 契约测试 | **复制**，尽量不动 |
| **B · Reference Sample** | 可运行的示范：一个 CRM、一个演示仪表盘、它们的性格层与骨架 | `app/crm/**` · `app/demo/**` · `app/_sample/**` · `app/sample-command-center.css` · `tests/{crm,crm-navigation,command-center,demo,demo-advanced}.spec.ts` | **可以参考，默认删除**。保留就必须被明确标注为示例 |
| **C · Initialization Surface** | 决定了「这是哪个产品」的那几个文件 | `package.json` · `README.md` · `app/layout.tsx` · `app/page.tsx` · `app/not-found.tsx` · `lib/i18n/zh-CN.ts` | **必须重写** |

这三层不是文档里的说法，是**机器可读的**：

```
init-contract.json          ← 三层边界的唯一事实来源
pnpm factory:init           ← 检查它（stage / 残留身份 / 0-scan）
```

`stage` 有两种取值，而且会被反向核对：

- `"baseline"`（默认）：这是 Factory 自己。Reference Sample 允许存在，baseline 身份必须**完好**。
  改了包名却留着 `stage: "baseline"` → **FAIL**（不许半初始化）。
- `"product"`：这是产品。初始化面上不得残留 baseline 或 Sample 的任何身份。

---

## 二、清单

按顺序执行。每一步的「完成标志」都是可检查的。

### 1 · Product identity

- 改 `package.json` 的 `name` / `version`（`name` 是初始化的第一步，也是 `stage` 检查的锚点）；
- 改 `app/layout.tsx` 的 `metadata.title.default` 与 `template`；
- 改 `README.md` 的第一段与标题：它现在描述的是 **Factory**，产品要描述自己；
- 把 `lib/i18n/zh-CN.ts` 里的 `brand.*`（`智悟云 / AI 销售工作台 / metaTitle`）换成产品自己的。

**完成标志**：`pnpm factory:init` 在 `stage: "product"` 下无 violation。

### 2 · Reference Sample boundary

决定 Reference Sample 的去留：

- **删掉**（最常见）：删除 B 层路径，并删掉 `app/page.tsx` 里带 `data-reference-sample` 的那一段；
- **保留**：保留可以，但首页上的入口必须留在 `data-reference-sample` 标注的区块里——
  Reference Sample 不能被当成产品的主入口。

**Shell 是可选能力。** `Sidebar` / `TopNav` / `MobileNav` 是 Core 提供的组件，不是产品必须采用的
信息架构：这个产品如果不用侧栏导航，就别装它。`app/layout.tsx`（Core）不引入任何一种产品 IA —— 有 contract test 守着。

顺手清理它的依赖：`tests/support/localization.ts` 的 `LOCALIZED_ROUTES` 里那几条 `/crm/**` 路由、
`lib/i18n` 里的 `demo.*` / `page.*` / `nav.*` 词条、`tests/support` 里为示例写的夹具。

> **不要**把 `app/sample-command-center.css` 连同入口一起删掉却留着示例页面：
> 示例会变成一份没有样式表的 HTML（Phase A 的 N3 正是为这类失败装的探测器）。
> 反过来，删示例时**必须**同时删掉它的样式 import。

### 3 · Product Model

回答：**这是什么产品、用户来干什么、一屏里最重要的是什么。**
产出是对第一视觉焦点的初步判断，不是代码。见 `docs/prototype-creation-workflow.md` 第 3 步。

### 4 · Product Semantic Contract

在写 UI **之前**回答：**这个产品绝对不能在语义上搞错什么？**

- 写进 `product-contract.json`（`id` / `statement` / `enforcement`）；
- 用 `tests/support/product-contract.ts` 的 `invariant()` 把测试登记到同一个 id 上；
- `pnpm factory:contract` 双向核对：声明 ↔ 登记，缺任何一边都 FAIL。

**0 条是合法的**——但空数组要是一个决定，而不是没人问过。数据型产品几乎不可能真的是 0 条。

### 5 · Art Direction divergence

回答：**这个产品为什么不应该长得像 Reference Sample / 上一个 Prototype？**
产出一句 `divergence statement`。见 workflow 第 5 步。

### 6 · Visual Manifest

把 3–5 步的决定写成 `visual-manifest.json`：`firstVisual` / `avoid` / `density` / `motionDirection` /
`signatureComponentBudget` / `stylePack` / `effects`；与 pack 默认不一致的地方写进 `deviations`（带理由）。
校验：`pnpm factory:manifest`。

### 7 · Human Art Direction Gate

人工确认九问（workflow 第 7 步）。Agent 可以起草，不能代替人确认。

### 8 · Kits installation

`pnpm factory:kits`（dry-run）→ `pnpm factory:kits --write` → `pnpm qa:doctor`。
doctor 不通过 = 安装状态不可信 = 禁止声称完成。

### 9 · Adapter seam

产品只 import `lib/kits/adapters/**` 里的**中性入口**；不得直接 import `installed/*`，
也不得 import 以资产名生成的 adapter。`pnpm test` 里的 Kits seam gate 会检查（含 `scanned > 0`）。

### 10 · Route / QA registration

- 新路由要能被 QA 发现（`app/**/page.tsx` 自动发现；动态段写进 `.qa/qa.config.mjs` 的 `extraRoutes`）；
- 如果新页面依赖自己的样式表，**入口组件必须自己 import 它**（App Router 按模块图打包 CSS）；
- 跑一次 `pnpm qa`，确认每条路由都通过 style-presence（"不是浏览器默认白页"）。

### 11 · Localization residue

`lib/i18n` 里还留着示例的词条（`demo.*`、`page.*` 的 CRM 页面元信息、`nav.*`）。
产品的界面文案一律经 `useMessages()` 取；`tests/localization.spec.ts` 会检查零英文泄漏，
`tests/support/localization.ts` 的路由表也要跟着改。

### 12 · Deployment ownership

部署前读 `docs/vercel-bootstrap.md` 第 0 节。要点：

- 创建 / 连接 Project、改 Production Branch、改 Deployment Protection、创建 Production deployment、
  创建 bypass token 都需要用户**明确授权**；
- push 到 Production Branch **之前**先 `pnpm factory:deploy preflight`；
- 部署身份验证靠 `target` / `git ref` / `git SHA` / `readyState`，不靠 URL。

### 13 · Git branch baseline

```bash
git checkout main && git pull --ff-only origin main
git checkout -b feature/<product>
```

一个原型一个 branch。`main` 只留稳定版本。

**收尾**（每一步都必须过）：

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm qa
pnpm factory:manifest && pnpm factory:contract && pnpm factory:init && pnpm qa:doctor
```

---

## 三、半初始化：唯一真正危险的状态

Factory 完全没改过 —— **合法**（它本来就是 baseline）。
产品完全初始化过 —— **合法**。
**改了一半** —— 这才是要抓住的：

| 症状 | 后果 |
|---|---|
| 包名改了，`<title>` 还是 Starter | 部署出去的产品在浏览器标签上写着别人的名字 |
| 首页还把 CRM 当主入口 | 用户以为产品就是那个 CRM 示例 |
| 删了示例页面，忘了删它的样式 import | 示例路由变成一份没写 CSS 的 HTML |
| 契约里声明了 invariant，但测试没登记 | 一个「有人以为在守」的承诺 |

`pnpm factory:init` 就是为了在第一次部署之前抓到这四种。

---

## 四、这份清单不做什么

- **不生成**产品身份、不猜语义、不挑 Style Pack、不写 invariant 语句；
- **不替代** workflow：它只是把 workflow 里与「初始化」有关的那些步集中到一处；
- **不强制**删除 Reference Sample：保留是合法的，只要它被明确标注为示例。
