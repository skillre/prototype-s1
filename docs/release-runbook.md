# Release Runbook

一个 Prototype 从「本地全绿」到「Production 上线」的**顺序**，以及每次交接需要的**凭据**。

三份文件分工，不要混着读：

| 文件 | 回答的问题 |
|---|---|
| **本文件** | 什么时候做什么，下一步需要什么证据，什么时候必须停 |
| `docs/vercel-bootstrap.md` 第 0 节 | 这个动作**能不能做**（授权矩阵） |
| `scripts/lib/deploy-contract.mjs` | 上面两件事共用的机器判据 —— **只有这一份实现** |

本文件由 `scripts/lib/release-contract.mjs` 兜底（状态机 / tag 契约 / Production 多证据 / housekeeping），
但没有第二套真相：授权矩阵、身份校验、URL 可访问性判断全部从 Phase A 的 DEPLOY 契约 **re-export** 过来。

---

## 0 · 一句话

发布不是一次 `git push`，是**一个 commit 依次通过五道门**：

```
RC SHA
  → 本地门禁全绿
  → Preview（同一个 SHA，身份回读验证过）
  → 在线 QA（跑在部署环境上）
  → 人工视觉验收（HVA）
  → 源码发布（merge main）
  → Production（同一个 SHA，多证据）
  → annotated tag（指向同一个 SHA）
  → housekeeping
```

**每一步的凭据都是 SHA。** 不是分支名、不是 URL、不是「最新的那个部署」。

---

## 1 · 状态，不是布尔

`evaluateRelease()` 返回四态，不是 `ready: true/false`：

| 状态 | 含义 | 谁能让它前进 |
|---|---|---|
| `NOT READY` | RC / 本地门禁 / Preview 身份 / 在线 QA 中至少一项没有证据 | 跑门禁、补身份 |
| `READY FOR HUMAN VISUAL ACCEPTANCE` | 机器能证明的**到此为止**；HVA 仍 pending | **人**（看 Preview） |
| `READY TO RELEASE SOURCE` | HVA 已通过；可以 merge `main`、可以打 tag | 人（授权源码发布） |
| `READY TO DEPLOY PRODUCTION` | 另有一次性的明确授权 | 人（单独授权） |

两个刻意的设计：

- **没有 `READY FOR RELEASE` 这个状态。** HVA 未完成时状态只能是
  `READY FOR HUMAN VISUAL ACCEPTANCE` —— 「机器全绿」和「可以发布」中间隔着一个人。
- **源码发布 ≠ Production 部署。** 第三、第四态分开：merge `main` 与「创建 Production deployment」
  是两次不同的授权，一次授权不隐含另一次。

```
NOT READY → READY FOR HUMAN VISUAL ACCEPTANCE → READY TO RELEASE SOURCE → READY TO DEPLOY PRODUCTION
```

---

## 2 · 第 0 步：定 RC

**RC 是一个明确的 SHA，不是「feature branch 上最新的 commit」。**

理由不是洁癖：后面每一步都在说「**同一个** commit」——本地门禁跑在它上面、Preview 部署的是它、
在线 QA 量的是它、人验收的是它、Production 发布的必须是它、tag 指的也是它。分支名会移动，
URL 可以被重新指向，只有 SHA 不会。

- 格式：`^[0-9a-f]{8,40}$`（完整 SHA，或无歧义前缀）；
- 短 SHA 只接受**无歧义**前缀 —— 歧义前缀等于没有指定；
- RC 定下来之后**不要再往同一个 feature branch 上推新 commit**。要再推，就重新定 RC 并重跑全程。

```bash
git rev-parse feature/<product>     # → 记下这个 SHA，它就是 RC
```

---

## 3 · 第 1 步：本地门禁（同一个 SHA）

五道，缺一不可（`REQUIRED_LOCAL_GATES`）：

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm qa
# 等价于 pnpm check（qa:doctor 单独跑：pnpm qa:doctor）
```

**「本地全绿」的证据必须来自当前 tree。** 门禁跑完之后又改了代码，就要重跑——
否则你记录的是一次不存在的验证。

`pnpm qa` 是 LOCAL_MANAGED：它自己起 dev server（端口取自 `.qa/qa.config.mjs` 的 `QA_PORT`，本仓为 3310）、自己收尾、不连任何已有 server。
详见 `docs/browser-qa.md`。

### CI 在这条链上的位置：质量门，不是部署方

`.github/workflows/ci.yml` 跑的是**同一组门禁**，另加 `pnpm factory:agents`（Agent 策略）与几道 Factory
契约门（`factory:init` / `factory:contract` / `qa:doctor`）。但它不在这条链的**发布**侧：

- **CI 不部署。** 不创建 Preview/Production、不 promote、不调用 Vercel CLI、不读取任何部署 token 或
  bypass secret。部署仍由 **Vercel Git Integration** 负责：push/tag 触发平台自己的构建，
  Vercel 是部署的一方，CI 不是。
- **CI 里的 `pnpm test` 与 `pnpm qa` 是串行 job**（`browser-qa` 用 `needs:` 依赖前一个）。
  Next 16 的 dev server 按项目加锁，并行只会在错误的 server 上出结果；`pnpm factory:agents`
  会检查这条关系还在，拆成两个并行 job 即 FAIL。
- **CI 绿了不等于可以发布。** 状态机、HVA、Production 授权一步都不省（第 1 节、第 6 节）。

> `pnpm check` = `pnpm factory:agents` + 上面那五道。多出来的那道是策略门禁，它不改变
> `REQUIRED_LOCAL_GATES`（五道）的含义：缺任何一道仍然不是候选。

---

## 4 · 第 2 步：Preview —— 验证身份，不看 URL

先读 `docs/vercel-bootstrap.md` 第 0 节。创建/连接 Project、改 Production Branch、
改 Deployment Protection 都需要**用户明确授权**。

Preview 出来之后，**不要用 URL 判断它是什么**：

```bash
node scripts/verify-deployment.mjs verify --deployment preview.json --rc <rc-sha>
# ✓ target=preview · ref=feature/<product> · SHA == RC · readyState=READY
```

| 必须回读到 | 不然不能说 |
|---|---|
| `target: "preview"` | 「这是 Preview」 |
| `gitSource.sha` | 「这一版是 abc123」 |
| `gitSource.ref` | 「部署的是这个分支」 |
| `readyState: "READY"` | 「已经部署好了」 |

**`SHA ≠ RC` ⇒ 停。** 部署上的和本地验过的不是同一版，后面所有验收都作废。

---

## 5 · 第 3 步：在线 QA（REMOTE）

```bash
pnpm qa:online \
  --base-url=https://<preview-host> \
  --identity=preview.json \
  --expect-sha=<rc-sha> --expect-ref=feature/<product> --expect-target=preview
```

**为什么本地绿了还要在线跑。** `pnpm qa` 证明的是「这棵树在 dev server 下是对的」，
它证明不了「一次**部署**在 HTTPS 后面、经过平台保护层之后仍然是对的」。
第三 Prototype 就是部署出去之后整条路由退回浏览器默认样式的——
本地扫描看不见这一类失败，线上扫描看得见。

### 它和本地 QA 不是两套真相

同一个 `.qa/sweep.mjs`：`resolveRoutes` / `runSweep` / `reportSweep` 全都复用，
探针、判据、视口矩阵、style-presence 通道、DOM==AX 那条配套扫描一份。

| | LOCAL_MANAGED (`pnpm qa`) | REMOTE (`pnpm qa:online`) |
|---|---|---|
| origin | 本 run 自己起的 3310（取自 `QA_PORT`） | `--base-url` 给的地址 |
| server 生命周期 | 本 run 负责起、负责收（杀进程组） | **不碰**：没有本地 server |
| 额外请求头 | 无 | 仅在提供了 bypass secret 时加 |
| 判据 | **完全相同** | **完全相同** |

**Provider-agnostic：** 输入是「一个 base URL + 一份部署身份元数据」，
不需要 Vercel CLI、不需要项目 link、不需要任何平台凭证。换成别的平台，runner 不用改。

### 三种可访问性，三种说法

| 匿名请求 | 分类 | 说法 | `qa:online` 行为 |
|---|---|---|---|
| 2xx | public | 可以说 public | 直接跑 |
| 3xx（含跳 SSO）/ 401 / 403 | protected | **只能说 protected** | 没有 secret 时 **exit 1 并说明「这不是部署失败」** |
| 连不上 / 没有状态码 | unreachable | 只能说 unknown | exit 1，先查地址与网络 |

**受保护不是失败，也不是 public。** 这两句话都要能说出口，才不会把平台的正常工作
报成部署故障，也不会把受保护的地址当成公开链接发给别人。

### bypass secret 的规则（不多不少四条）

1. **`qa:online` 永不自己创建 token。** 需要而没人给 → 停下来并说明；
2. 只接受**已经授权**的 secret，从环境变量进：`QA_ONLINE_BYPASS_SECRET=…`，
   作为 `x-vercel-protection-bypass` 请求头发出去；
3. **不打印、不持久化、不提交。** 报告里只写 `present (redacted)`；
4. 谁创建了它、它是否还在，**由 DEPLOY 契约管**（`vercel curl` 会顺带创建，
   见 `docs/vercel-bootstrap.md` 第 0.4 节）—— 这个 runner 只消费，不拥有。

### 身份先于 QA

给了期望值（`--expect-sha/--expect-ref/--expect-target`）却**没给** `--identity` 部署记录 →
**不跑**（exit 1，`identity-unverifiable`）。「无法确认」不允许被写成「确认过没问题」。
期望值与记录不一致 → STOP，在跑 QA **之前**失败：对「看起来是对的 URL」跑完 QA 再说通过，
正是这一步要防的事。

退出码：`0` 通过 · `1` 未通过 / 未运行 / 不可达 / 受保护 · `2` 用法错误。

---

## 6 · 第 4 步：人工视觉验收（HVA）

**机器能证明的是「没有回归」；「这一版好不好看」不在机器的证据范围内。**

- 把 Preview URL 交给用户，**同时说明它的可访问性**（受保护就写受保护）；
- 复核 Manifest 的约束是否被遵守 —— 特别是 `avoid` 里的每一条在产物里是否真的没有出现；
- HVA 完成之前，状态就是 `READY FOR HUMAN VISUAL ACCEPTANCE`。

**HVA pending 时不许说 `READY FOR RELEASE`（这句话在契约里根本不存在）。**

---

## 7 · 第 5 步：源码发布（merge `main`）

Agent 默认**不 merge**；只有用户明确要求时才做。

### 先 STOP：如果 `main` 就是 Production Branch

```bash
node scripts/verify-deployment.mjs preflight --branch main --production-branch main
# ✗ STOP —— push 到 Production Branch 可能自动创建 Production deployment
```

**push 到 Production Branch 不是一次中立的 git 动作。** 它可能直接建起 Production。
Production Branch 未知时同样 **STOP**：「不知道」不是「不会触发生产」。

**不允许「先 push 再 cancel」**：Production 一旦建起来，cancel 不是回滚 —— 它已经在生产 URL 后面存在过。

### PR 走 ff-only，不要制造 merge commit

- ff-only 合并下 `main` 的 tip **就是** RC SHA —— 这正是「tag 指向 RC」能成立的前提；
- **不要假设 `mergeCommit.sha` 存在**：ff-only 合并根本不产生 merge commit。
  需要 PR 元数据时，记录 `state` / `mergedAt` / `headRefOid` / `baseRefOid` 就够了；
- **不要为了「有个 SHA 可以引用」而制造 merge commit**。造出来的 merge commit 不是 RC，
  发布它就违反「Production SHA == 已验收 RC」；
- 如果确实产生了 merge commit（非 ff 路径），`main` 的 tip ≠ RC。这时**不要偷偷把 tag 指过去**：
  这是一个人工决定，需要明确记录「发布的到底是哪个 commit」。

---

## 8 · 第 6 步：Production（多证据，一次授权）

创建 Production deployment、promote Preview 都是**单独的一次性授权**（`docs/vercel-bootstrap.md` 第 0 节）。

`readyState: "READY"` 是**必要**的，而且远远**不充分**。每一条证据都有已知失效模式：

| 证据 | 单独看会漏掉什么 |
|---|---|
| `target` / `ref` / `sha` | 说的是「构建了什么」；URL 别名什么都没说 |
| `readyState` | 可以 READY，而域名仍指向**上一个** deployment |
| alias / 自定义域**正在服务这一个** | 别名才是用户真正打到的东西 |
| 核心路由 HTTP | 200 也可能是没样式、不可访问、溢出 |
| Production 上的在线 QA | HTTP 200 ≠ 有样式 / 可访问 / 不溢出 |
| ~~平台的 `live` 字段~~ | **不作为判据**：它不跟踪 production-serving |

```bash
node scripts/verify-deployment.mjs verify --deployment production.json --rc <已验收 RC SHA>
```

- `target` 必须是 `production`；`ref` 必须是项目配置的 production branch；
- **SHA 必须等于已验收的 RC SHA**。不等 → 这不是发布，是又出了一版；
- `aliasServing !== true` → **没有证据**表明域名正在服务这个 deployment；
- 缺少核心路由 HTTP 证据 / 缺少 Production 在线 QA → 不算验证过。

`verifyProduction()` 返回 `evidence` 与 `missing` 两份列表：
**没说出来的那部分就是没有证据的那部分**，不允许静默补绿。

---

## 9 · 第 7 步：annotated tag

**顺序：先验证发布条件（Production 已就绪、SHA == RC），再 push release tag。**
tag 是这一步的结论，不是它的前提。

```bash
git tag -a v1.2.0 -m "已验收 RC <sha>" <rc-sha>
git push origin v1.2.0
```

`assertTagTarget()` 检查三件事：

| 检查 | 为什么 |
|---|---|
| 必须是 **annotated**（`type === "tag"`） | 轻量 tag 是一个裸 ref：没有 tagger、没有日期、没有说明。它承载不了「这一版被验收过」这句话 |
| 名字是 `v<major>.<minor>.<patch>` | 名字是读者唯一能依赖的索引 |
| **tag 指向的 commit == 已验收的 RC SHA** | 见下 |

**为什么 tag 的 target 必须等于 RC SHA。** tag 是未来读者眼中「发布了哪一版」的**唯一凭据**。
如果它指向一个更晚的 commit（比如 `main` 上一个事后 polish commit），那么
**别人下载到的那一版，不是你验证过的那一版** —— 而且没有任何一次测试运行会发现这件事。

另外：**不要 `git push --tags`**。它会把本地所有陈旧、实验性的 tag 一起推上去，
而你的意图只是推这一个。

---

## 10 · 第 8 步：housekeeping

发布不是「Production 返回 200」就结束了。`HOUSEKEEPING_ITEMS` 九项，五机检四人检：

| # | 项 | 类型 |
|---|---|---|
| 1 | automation bypass secret 是否仍然存在（应已清理） | machine |
| 2 | 临时 credential / 一次性环境变量是否已清理 | human |
| 3 | Deployment Protection 未被意外改变 | machine |
| 4 | working tree clean | machine |
| 5 | local / origin / tag 三者 SHA 对齐 | machine |
| 6 | 截图 / 报告 / 临时脚本不在 repo 内 | machine |
| 7 | 被取消的 deployment 只作为历史，没有被当成一次发布 | human |
| 8 | feature branch 保留还是删除，已明确决定 | human |
| 9 | 文案 / polish backlog 已记录（**不偷偷塞进发布**） | human |

`evaluateHousekeeping()` 的规则：**没有证据的一律 `pending`，绝不是 `done`。**
「忘了看」和「没问题」不允许产出同一个结果 —— 这条规则和探针守卫、seam 扫描、init 扫描一致。

> housekeeping 也**不得偷偷修改产品**：复盘里发现的文案/polish 问题进 backlog，
> 不进这个已经验收过的 SHA。

---

## 11 · 这个 runner 不做什么

`pnpm qa:online` 是一个**观察者**，永远不是编排器：

- 不部署、不创建/连接 Project、不 promote；
- 不 merge、不 tag；
- 不创建 bypass token，不改 Deployment Protection；
- 不启动本地 server（REMOTE 模式没有 server 要管）；
- 不持久化任何凭证。

部署变更属于 `scripts/verify-deployment.mjs`，那是另一个工具、另一份授权契约。

---

## 12 · 常见误判

| 症状 | 实际含义 |
|---|---|
| Preview 返回 302 → `vercel.com/sso` | **平台保护在工作**。不是部署失败，也不能说 public |
| `live` 字段为真 | **不作为判据**：它不跟踪 production-serving |
| `readyState: READY` | 构建成功；域名可能还在服务上一个版本 |
| 在线 QA 「路由数量不对」 | 先看是不是动态段被跳过（`[id]` 无法静态发现） |
| Next dev server 报 route manifest 相关错误 | 见 `docs/browser-qa.md` 第 9 节（T1）。**「慢」不等于 T1** |

---

## 13 · 相关

- `docs/vercel-bootstrap.md` — 授权矩阵（第 0 节）、项目设置、失败诊断顺序
- `docs/browser-qa.md` — 判据**为什么**是这些；LOCAL_MANAGED 与 REMOTE 的探针细节
- `docs/prototype-creation-workflow.md` — 完整生产流程（第 12–14 步）
- `scripts/lib/deploy-contract.mjs` — Phase A DEPLOY 契约（授权 / 身份 / URL 可访问性）
- `scripts/lib/release-contract.mjs` — 状态机 / tag 契约 / Production 多证据 / housekeeping
- `.qa/online-qa.mjs` · `.qa/sweep.mjs` · `.qa/browser-qa.mjs` — 两个入口，一套判据
- `tests/release-contract.spec.ts` · `tests/online-qa.spec.ts` — 上面每条规则的可执行版本
- `skills/git-delivery/SKILL.md` — 交付工作流（push 前的 preflight 在这里嵌入）
