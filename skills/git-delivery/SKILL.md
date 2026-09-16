---
name: git-delivery
description: 在 Prototype Starter 中完成 Prototype 开发后执行 Git 交付的标准工作流：Inspect → Branch Check → Diff Review → Quality Gates → Commit → Push → Preview。适用于 task 明确要求 delivery / publish，或用户明确要求 push 的交付任务。默认不 push、不 push main、不自动 merge。
---

# Git Delivery Skill

## 目标

把**已经通过 Browser QA 与测试**的 Prototype，安全、可回滚地交付到 GitHub，并通过 GitHub → Vercel 自动连接获得 Preview URL。绝不擅自 push main、绝不自动 merge、绝不覆盖用户修改。

## 前置约束（必须先读）

1. 先读 `AGENTS.md` 的「Git 工作流与安全」章节（危险命令红线、Branch Strategy、Commit / Push / Merge 规则）。
2. 本 Skill 只负责交付；开发与验证属于 `skills/interactive-prototype/SKILL.md` 的职责。
3. 本 Skill 默认**不改变 main**；只有在用户明确要求时才考虑 merge（见下）。

## 工作流（逐阶段执行，不跳步）

```
Inspect → Branch Check → Diff Review → Quality Gates → Commit → Push → Preview
```

### 1. Inspect

```bash
git status
git branch --show-current
git remote -v
```

确认仓库状态、当前位置与远程配置。发现未提交的**用户修改**时：先停止并报告，不擅自提交或覆盖。

### 2. Branch Check

- 确认当前 branch。
- 新 Prototype 如果仍在 `main`：**先在 main 上创建 `feature/<name>`**（先 `git pull --ff-only origin main` 更新基线），不要把开发直接留在 main。
  ```bash
  git checkout -b feature/<name>   # e.g. feature/ai-crm
  git branch --show-current        # 必须是 feature/<name>
  ```
- 已经在其他 feature branch：不要把新 Prototype 混进去，先停止并报告；不自动删除旧 branch。

### 3. Diff Review

```bash
git diff --stat
git diff
```

重点检查：

- unrelated changes（不属于当前 Prototype 的改动）
- secrets / API keys
- `.env`
- `node_modules` / `.next` / `test-results` / `coverage` 等产物
- temporary files

一切与当前 Prototype 无关的内容**不进入 commit**。

### 4. Quality Gates

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

任何一项失败：**禁止 commit / push**。修复后重新执行，直至全部通过。

### 5. Commit

commit 前再次 `git status`。创建清晰的 commit，例如：

```
feat: add ai crm prototype
fix: improve mobile layout
test: add dashboard interaction coverage
```

- 用 `git add <explicit-files>`，不要盲目 `git add -A`。
- 禁止无意义信息（update / changes / work / misc / final）。
- commit 后再次 `git status` 确认状态。

### 6. Push

**默认不 push。** 只有任务明确要求 delivery / publish，或用户明确要求 push 时才执行。

push 前再次确认：

```bash
git branch --show-current   # 绝对不能是 main
```

**先做生产分支预检**（v1.2 新增，不可跳过）：

```bash
node scripts/verify-deployment.mjs preflight --branch feature/<name> --production-branch <项目当前值>
```

- **目标分支就是 Production Branch → STOP，请求用户授权。** 该 push 可能**自动创建 Production deployment**。
- **Production Branch 未知 → 也 STOP。** "不知道"不是"不会触发生产"。
- **绝不允许"先 push 再 cancel"**：Production 建起来之后 cancel 不是回滚。

预检通过（不是生产分支，或已获得一次性明确授权）后：

```bash
git push -u origin feature/<name>
```

**绝对不能默认 push main。** 禁止 `--force` / `--force-with-lease`，除非用户明确要求并确认风险。

### 7. Preview

GitHub 已与 Vercel 自动连接，因此：

```
feature branch → GitHub → Vercel → Preview Deployment
```

不需要在项目里加入 Vercel API、Vercel CLI automation 或 GitHub Actions，**除非以后明确需要**。

推送后把 Preview URL 报告给用户，等待**人工确认**。汇报时：

- **不要靠 URL 判断**这是不是 Preview，先验证身份（`target` / `git ref` / `git SHA` / `readyState`）：
  ```bash
  node scripts/verify-deployment.mjs verify --deployment <deployment.json>
  ```
- **受 SSO 保护就写受保护，不得称为 public**——只有匿名请求返回 2xx 才支持 "public" 这个说法：
  ```bash
  node scripts/verify-deployment.mjs access --status <匿名请求状态码> [--location <跳转目标>]
  ```
- 如果为了访问 Preview 用了 `vercel curl`，**必须说明它顺带创建了 automation bypass secret**，
  以及它是否仍然存在。

**在部署上跑在线 QA**（本地绿了不等于部署上是对的）：

```bash
pnpm qa:online --base-url=<preview-url> --identity=<deployment.json> --expect-sha=<rc-sha>
```

受保护 → 不算部署失败，也不要写成 public；没有授权 secret 就不跑，**不自己创建 token**。
见 `docs/browser-qa.md` 第 8 节。

### 8. 发布到 Production（需要单独的一次性授权）

只有当用户**明确要求发布**、并且**明确授权创建 Production deployment** 时才做，且必须：

```bash
# Production 部署的 SHA == 已验收 RC 的 SHA
node scripts/verify-deployment.mjs verify --deployment production.json --rc <已验收的 SHA>
```

- `readyState: READY` **不是**充分条件：还要看 target / ref / SHA / **alias 是否真的在服务** /
  核心路由 HTTP / Production 在线 QA；平台的 `live` 字段不作为判据；
- annotated tag 指向的 commit **必须等于已验收的 RC SHA**，不要 `git push --tags`；
- 之后还有 housekeeping（bypass secret、保护设置、working tree、SHA 对齐、产物位置……）。

**完整顺序见 `docs/release-runbook.md`**；完整授权矩阵见 `docs/vercel-bootstrap.md` 第 0 节。
Agent 默认**不做这一步**。

## 关于 merge

Agent 默认**禁止自动 merge、push main、删除 feature branch**。

只有当用户明确要求时才执行 `feature/<name> → main` 的合并。发生 merge conflict：**停止并报告**，不做高风险冲突解决。

**`main` 是 Production Branch 时，push 前必须 STOP**（`preflight` 会拦），
且**不允许「先 push 再 cancel」**：Production 一旦建起来，cancel 不是回滚。

## 完成标准（Definition of Done）

- [ ] 当前 branch 是 `feature/<name>`（不是 main）
- [ ] diff 已审查，无 secrets / 产物 / 无关改动
- [ ] lint / typecheck / test / build / qa 全部通过
- [ ] commit 信息清晰、范围明确
- [ ] （任务要求 delivery 时）已 push 并获得 Vercel Preview URL
- [ ] （有 Preview 时）身份已验证 · 在线 QA 已跑 · 可访问性如实报告
- [ ] 未擅自改动 main、未强推、未覆盖用户修改

## 参考文件

- `AGENTS.md` — Git 工作流与安全规则（必读）
- `docs/release-runbook.md` — 发布顺序（RC → HVA → Production → tag → housekeeping）
- `docs/vercel-bootstrap.md` — 部署授权边界与项目设置
- `skills/interactive-prototype/SKILL.md` — 开发与验证工作流