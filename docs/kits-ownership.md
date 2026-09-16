# Kits Ownership Contract

Factory v1.1 的核心机制：**谁拥有哪个文件**。

这套边界不是抽象规范，而是被 AI Finance 两轮真实消费验证过的：重装时 9 个产品适配层文件 **0 覆盖**，installer 只补缺失的标准缝。它成立的原因是每条规则都写在文件系统上，而不是写在文档里靠自觉。

---

## 四个区域

| 路径 | 归属 | 谁可以写 | 重装时 |
|---|---|---|---|
| `lib/kits/installed/` | **Kits-managed** | 只有 Kits installer | **整体覆盖** |
| `lib/kits/.kits/` | **Kits-managed** tooling | 只有 Kits installer | 覆盖 |
| `lib/kits/kits.lock.json` | **Kits-managed** state | 只有 Kits installer | 覆盖 |
| `lib/kits/adapters/` | **Product-owned** | 只有产品自己（人或 Agent） | **永不覆盖** |

`.kits/` 里是 installer 自身的一份副本。它的存在意味着产品在脱离 Kits 仓库之后仍然可以 `doctor`、可以自查托管文件完整性——这是 Source Installation 能"独立交付"的前提。

---

## 规则

### 1. 禁止手工修改 `installed/`

`installed/` 里的每一个文件都带 checksum，记在 `kits.lock.json` 里。手工编辑会有两种结局，都很糟：

- 下次重装**静默丢失**——你改的东西不见了，而且没有任何提示；
- 在重装之前，`doctor` 会报托管文件完整性失败——安装状态不再可信。

**需要升级 = 重新跑 `kits add`。** 不是手工 patch 单个 asset。

> 这一条在真实消费里被验证过：v0.1.0 → v0.1.1 升级时，`installed/` 里 24 个文件被替换，而产品的适配层一个都没动。这正是设计意图。

### 2. 产品代码不得直接 import `installed/`

必须走适配层：

```
Product  →  adapters/  →  installed/
```

直接引用 `installed/` 的问题是**它把产品的引用面绑死在托管区上**。托管区会在每次重装时被替换；一旦它的内部结构变化（asset 换目录、模块拆文件、导出改名），所有直接引用它的产品代码会同时断掉——而重装本身是完全合法的操作。

适配层是那条稳定的缝。它由 installer 生成一次（模板化），之后归产品所有，可以自由修改。

**唯一的合法例外**是适配层自己。适配层存在的意义就是引用 `installed/`；Kits 的 `boundary` 检查也因此豁免它。所以「产品代码零直接引用」和「`boundary` 必须通过」这两句话并不矛盾，而是同一条规则的两半。

### 2b. 三层，而不是两层（v1.2 · N2）

「产品代码不得 import `installed/*`」是这条规则的**一半**。真正的判据是：

> **产品逻辑不得知道任何一个具体的 Kits 资产身份。**

按文件所在的位置分成三层，`pnpm test` 里的 Kits seam gate 就是这么扫的：

| 层 | 路径 | 资产 id |
|---|---|---|
| **Tier 1 · Kits-managed** | `lib/kits/installed/**` · `lib/kits/.kits/**` · `lib/kits/kits.lock.json` | 合法——它们的职责就是知道 |
| **Tier 2 · adapter seam** | `lib/kits/adapters/**` | 合法——这一层的全部工作就是把资产 id 翻译成产品稳定名（`style.ts` 再导出 `style-instrument.css`） |
| **Tier 3 · product code** | `app/**` · `components/**` · `hooks/**` · `stores/**` · `scripts/**` · `lib/**`（`lib/kits/**` 除外） | **不得出现**，包括通过生成出来的、以资产名命名的 adapter |

于是合法依赖方向只有一条：

```
Product → 中性 adapter → 生成的 adapter → installed
```

`@/lib/kits/installed/insight-reveal` 与 `@/lib/kits/adapters/insight-reveal` 在 Tier 3 里**都是违规**：
「扫描范围太宽」的修法是**把范围改对**，不是把规则改弱。

扫描带 `scanned > 0` 守卫：一个产品源根都没找到时**判 FAIL**，不是判通过。注释在扫描前被剥离
（v1.2 起统一走 `stripComments`）——一个产品在自己的设计记录里写下资产名，不应该被自己的门拦下。
派生产品的执行清单见 `docs/product-initialization.md` 第 9 步。

### 3. 升级路径

如果 `installed/` 已经更新，但适配层还是旧模板：

```bash
# doctor 会明确告诉你该怎么做
node lib/kits/.kits/kits.mjs doctor --target .

# 想要新模板：删掉该适配层文件，再跑 kits add —— installer 只补不存在的
rm lib/kits/adapters/<name>.ts
pnpm factory:kits --write
```

**Installer 永不覆盖已存在的适配层文件。** 这是刻意的：适配层里可能有人写过的集成逻辑，机器不该替你决定要不要丢弃。所以"要不要用新模板"是一个**人工决定**，不是自动升级。

---

## Factory 侧的工具

Factory 只集成**调用机制**，不 vendor 任何 Kits 内容。

```bash
pnpm factory:manifest          # 校验 visual-manifest.json（结构 + 上游比对）
pnpm factory:kits              # 依 manifest 安装（默认 dry-run）
pnpm factory:kits --write      # 真实安装 → 校验 lock → 跑 doctor
pnpm qa:doctor                 # doctor 质量门
```

`scripts/install-kits.mjs` **调用** Kits 的 CLI（`<kits>/packages/cli/kits.mjs`），不重新实现安装逻辑。理由很直接：所有权规则的第二个实现就是第二个事实来源，而**较弱的那个总会赢**，因为它是报绿的那个。

### 顺序不可交换

```
manifest → 校验 → registry 交叉核对 → kits add --dry-run
        → kits add → doctor → lock 必须存在 → 所有权提醒
```

- **先 dry-run**：写盘之前先看计划。
- **lock 必须存在**：`kits add` 声称成功但没有 lock = 安装失败，不允许"看起来装上了"。
- **doctor 是质量门**，不是建议。它不通过就不能声称安装完成。

---

## doctor 的三种状态

Factory 不会替你猜，也不会把"没检查"说成"通过"：

| 状态 | 含义 | 退出码 |
|---|---|---|
| `not-installed` | 本项目没有 `lib/kits/`。不使用 Kits 资产是受支持的状态。 | 0 |
| `verified` | 有安装 + 能读到 Kits 仓库 → 真正跑了 doctor，含上游比对。 | 0 / 1 |
| `upstream-unavailable` | 有安装但 Kits 仓库不在（独立交付后的正常状态）。托管文件与 lock 的一致性**仍然校验**；**未做上游比对**，并且会明说。 | 0 / 1 |

> 最后一行是有意为之。一个夸大自己确定性的工具，比一个承认自己边界的工具危险得多。

---

## 一句话版本

> `installed/` 是 Kits 的地盘，`adapters/` 是你的地盘。
> 升级靠重装，不靠手改；引用靠适配层，不靠直连。
