# Vercel Bootstrap Checklist

新原型上线前对照这份清单。每一条都来自**真实踩过的坑**，不是通用最佳实践。

**第 0 节是授权边界，先读它。** 后面的项目设置可以试错，第 0 节里的动作不能。

---

## 0 · 部署授权边界

### 0.1 没有用户明确授权时，不得做的事

| 动作 | 为什么 | 机器判据 |
|---|---|---|
| **创建 Vercel Project** | 基础设施变更。项目"看起来不存在"时先报告，不要顺手新建 | `actions` → `create-project` |
| **link project**（写 `.vercel/`、绑定仓库） | 等于选定了部署目标 | `link-project` |
| **修改 Production Branch** | 改的是"哪个分支直接进生产" | `change-production-branch` |
| **修改 Deployment Protection / SSO** | 保护策略是安全设置，不是构建配置 | `change-deployment-protection` |
| **创建 Production deployment** | 单独的一次性授权，且只能发布已验收的 RC SHA | `create-production-deployment` |
| **把 Preview 提升为 Production** | 与创建 Production 同级：会改变对外提供的那一版 | `promote-preview` |
| **创建 / 使用 automation bypass secret** | 见 0.4：它常常是**副作用**，不是明确动作 | `create-bypass-token` |
| **push 到 Production Branch** | 见 0.2：可能自动创建 Production | `push-production-branch` |
| **merge 到 main** | Agent 默认禁止自动 merge，即使 Preview 全绿 | `merge-to-main` |

「没有明确授权」包括这些**不算授权**的情形：

- 「部署一下看看」不等于授权创建 Production；
- Preview 全绿不等于授权 merge；
- 任务里提到 release 不等于授权修改 Production Branch 或 Deployment Protection；
- 用户上次同意过，不等于这次同意。

只读动作（`read-deployment-state`：列出部署、读单个部署状态）不需要授权。
**凭证始终是 user-managed state**：Agent 可以读取部署结果，但不拥有认证状态。

> 机器可读的一份在 `scripts/lib/deploy-contract.mjs` 的 `DEPLOYMENT_ACTIONS`；
> `node scripts/verify-deployment.mjs actions` 会把整张表打印出来。

### 0.2 push Production Branch 之前要探测，不要 push 完再 cancel

**事实**：push 到项目配置的 Production Branch 可能**自动创建 Production deployment**。
这不是一次中立的 `git push`。

规则：

1. push 之前先确定项目当前的 **Production Branch**（问用户，或读只读的部署配置）。
2. 如果目标分支就是它 → **STOP，请求授权**。
3. **不允许「先 push 再取消」。** Production deployment 一旦建成，cancel 不是回滚；
   它已经在生产 URL 后面存在过。

```bash
# Production Branch 未知时也 STOP ——「不知道」不是「不会触发生产」
node scripts/verify-deployment.mjs preflight --branch feature/<product>
node scripts/verify-deployment.mjs preflight --branch main --production-branch main
# → ✗ STOP，并说明这是基础设施动作
node scripts/verify-deployment.mjs preflight --branch main --production-branch main --authorized
# → ✓ PROCEED，并提醒之后仍要验证身份与 SHA
```

### 0.3 部署身份：target + git ref + git SHA + readyState

**不能靠 URL 判断。** `https://x-git-feature-team.vercel.app` 这类分支 URL 只是别名，
可以被指向任何东西；`target`、`git ref`、`git SHA`、`readyState` 才是事实。

- 说"这是 Preview"之前，先读到 `target: "preview"`；
- 说"这一版是 abc123"之前，先读到 `gitSource.sha`；
- 说"已经上线"之前，先读到 `readyState: "READY"`。

REST `POST /v13/deployments` 走 `gitSource` 时，**target 语义不能靠猜**——
必须回读部署记录，而不是从分支名推断。

```bash
node scripts/verify-deployment.mjs verify --deployment deployment.json
# ✗ 部署身份不完整：缺少 target, git SHA …
```

### 0.4 automation bypass：它不是普通 curl

**事实**：`vercel curl` 在执行过程中**可能自动创建一个 automation-bypass secret**。
一个看起来像普通 curl 的命令，改了平台的保护配置。

规则：

- 执行前说明它会产生这个副作用，**或**执行后立即明确披露；
- 披露内容包括：是哪个命令造成的、secret 的 scope、以及**它是否仍然存在**；
- 不得把它当作"普通 curl"一笔带过。

清理也是平台状态变更：删除 bypass token 同样要说清楚做了什么。
真实案例：第三 Prototype 发布后清掉了 `scope = automation-bypass` 的 token，
并验证了 before=1 / after=0、Preview 仍受保护、Production 匿名 200。

### 0.5 受 SSO 保护的 URL 不得称为 public

**Preview 受保护，不等于 Production 受保护，也不等于它公开。** 实测存在这种组合：
`deploymentType: all_except_custom_domains` 下 Preview 返回 302，
而项目的 production domain 对匿名请求返回 200。

判断只能来自**匿名请求的真实状态码**：

| 匿名请求结果 | 可以怎么说 |
|---|---|
| 2xx | 可以称为 public |
| 401 / 403 | **protected，不得称为 public** |
| 3xx（含跳 SSO） | 不能称为 public；跟随重定向后重新判断 |
| 其他 / 没有状态码 | unknown，不得称为 public |

```bash
node scripts/verify-deployment.mjs access --status 302 --location https://vercel.com/sso/…
# ✗ protected
```

### 0.6 Production release：SHA 必须等于已验收的 RC

发布不是"再部署一次"，是**把验收过的那个 commit 放到生产**：

```
Production deployment 的 gitSource.sha  ==  已通过人工验收的 RC SHA
```

- SHA 不匹配 → 不是发布，是又出了一版；
- `readyState` 不是 `READY` → 还没上线，不要说已经上线；
- 短 SHA 只接受完整 SHA 的**无歧义前缀**。

```bash
node scripts/verify-deployment.mjs verify --deployment production.json --rc <accepted-sha>
# ✓ Production 3858f3c… == 已验收 RC，readyState READY。
```

**`readyState: "READY"` 是必要条件，不是充分条件。** 一个 deployment 可以 READY，
而域名仍指向上一个版本；路由可以 200，而页面是没样式的。所以 Production 验收是**多证据**的
（target / ref / SHA == RC / alias 正在服务 / 核心路由 HTTP / Production 上的在线 QA），
而平台的 `live` 字段**不作为判据**。完整清单见 `docs/release-runbook.md` 第 8 节。

**完整顺序（RC → 门禁 → Preview → 在线 QA → HVA → 源码发布 → Production → tag → housekeeping）
见 `docs/release-runbook.md`。** 本节只回答"能不能做"。

---

## 1 · 项目设置

| 设置 | 正确值 | 说明 |
|---|---|---|
| **Framework Preset** | `Next.js` | 自动识别通常正确；如果 Root Directory 非仓库根，识别会失败，必须手选 |
| **Root Directory** | 仓库根 | 本模板是单应用仓库，不是 monorepo |
| **Output Directory** | 框架默认（留空） | 手动填 `.next` 之类会破坏 Next 的产物布局 |
| **Production Branch** | `main` | **修改它需要用户授权**（见 0.1） |
| `feature/*` | **Preview** | 每个原型一个 feature branch，天然对应一个 Preview |
| **Deployment Protection** | **不擅自修改** | 见下 |

### Root Directory 例外

如果新项目**必须**使用非根目录，必须显式记录原因。默认假设是错的常见来源：Root Directory 填错时构建会在找不到 `package.json` 或识别不出框架时失败，错误信息不会指向这个设置。

---

## 2 · Agent 不得做的事

| 禁止 | 原因 |
|---|---|
| 修改用户的 Vercel **CLI credentials** | 那是 **user-managed state**，不是项目文件 |
| **不得删除** auth files（`~/.vercel/`、`~/.config/vercel/` 等） | 同上；删了要用户重新登录 |
| 自动断开 Git integration | 会切断部署来源，且难以从仓库侧恢复 |
| 擅自修改 Deployment Protection | 保护策略是**安全设置**，不是构建配置 |
| 擅自创建新项目 / 新部署平台 | 属于基础设施变更，需要明确授权（见 0.1） |
| 在项目里加入 Vercel API / CLI automation | 见 `AGENTS.md` 的项目边界；授权矩阵见 0.1 |
| 让 CI 承担部署 | `.github/workflows/ci.yml` 只是**质量门**：不创建 Preview/Production、不 promote、不调用 Vercel CLI、不持有部署 token。部署仍由 **Vercel Git Integration** 负责 |

> **凭证是 user-managed state。** Agent 可以读取部署结果，但不拥有认证状态。遇到凭证问题时**报告并停止**，不要"修复"它。
>
> 注意上表最后一行与第 0 节的工具不冲突：`scripts/verify-deployment.mjs` **不做任何网络请求、不持有凭证**，
> 它只判断 Agent 已经拿到的部署记录 JSON。能部署的工具 ≠ 能判断部署的工具。

---

## 3 · 部署失败的诊断顺序

1. **项目是否存在？** 用 CLI/API 确认 project id 仍然有效。
   - 真实案例：`.vercel/project.json` 指向的项目已被删除或转移，CLI 报 "Your Project was either deleted, transferred to a new Team, or you don't have access to it anymore"，而 `GET /v9/projects` 里根本没有这个项目。这时**不要创建新项目**——先报告。
2. **Root Directory / Framework Preset** 是否正确。
3. **构建命令**是否与本地一致（`pnpm build`）。
4. **Node 版本**与 `packageManager` 字段是否匹配。
5. 本地先跑一遍 `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm qa`——CI 里失败的东西通常本地也会失败。

---

## 4 · Preview 之后

`feature/<name> → GitHub → Vercel Preview → 在线 QA → 人工确认 → merge main`。

- **在线 QA 跑在 Preview 上**（`pnpm qa:online`）：本地绿了不等于部署上是对的，
  见 `docs/browser-qa.md` 第 8 节；
- Preview URL 交给用户做**人工视觉验收**；
- Agent **默认不 merge `main`**，即使 Preview 全绿；
- 机器能证明的是"没有回归"；"这一版好不好看"不在机器的证据范围内；
- **把 Preview URL 交给用户时说明它的可访问性**：受 SSO 保护就说受保护，
  不要因为"浏览器里能打开"就写成 public（见 0.5）；
- 之后的每一步（HVA → 源码发布 → Production → annotated tag → housekeeping）
  见 `docs/release-runbook.md`。

> **`main` 就是 Production Branch 时，push `main` 前必须 STOP**（见 0.2）——
> 即便已经拿到"merge 到 main"的授权，那也是一次可能直接建起 Production 的基础设施动作。

---

## 5 · 相关

- `docs/release-runbook.md` — 发布顺序与每步的凭据（RC → tag → housekeeping）
- `AGENTS.md` — Git 工作流与安全规则（红线命令、branch 策略、部署授权）
- `skills/git-delivery/SKILL.md` — 交付工作流（push 前的 preflight 在这里嵌入）
- `scripts/lib/deploy-contract.mjs` — 授权矩阵与三项可机器判定的检查
- `scripts/lib/release-contract.mjs` — 发布状态机 / tag 契约 / Production 多证据
- `scripts/verify-deployment.mjs` — 可执行的 deployment gate
- `docs/prototype-creation-workflow.md` — 完整生产流程
