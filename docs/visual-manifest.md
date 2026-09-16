# Visual Manifest Contract

> **写 UI 之前，先写 Manifest。**
> 没有 Visual Manifest 就开始写 JSX = 违规。

这份文档定义 **Factory 拥有的那一半**：字段集合、形状、以及让 Manifest 无法被敷衍跳过的强制规则。

**创作语义不在 Factory 手里。** 哪个 Style Pack 适合什么产品、一页最多几个签名组件、`avoid` 该写什么——那些属于 Prototype Kits 的 `skills/visual-direction/SKILL.md`。这里不重述它们，因为规则的第二个副本就是第二个事实来源。

---

## 为什么需要它

Agent 的默认审美会强烈回拉：紫色渐变、到处卡片、圆角 16px、处处 glow。结果是"哪都还行、哪都不成立"的页面——**到处都说得过去，但哪里都不成立**。

修法是流程性的，不是装饰性的：视觉方向必须**在写任何 JSX 之前被声明**，而且声明必须**机器可检查**，否则它会被静默跳过。

---

## 字段

八项必填，两项可选（`signatureComponentBudget` / `deviations`）。权威的字段语义与可选值见 Kits 的 `visual-direction` skill。

| 字段 | 类型 | Factory 检查什么 |
|---|---|---|
| `productType` | string | 非空，kebab-case 产品类型 |
| `firstVisual` | string | **必须写出"第一眼看到什么"**——印象词会被拒 |
| `stylePack` | string | 能在 Kits registry 里解析到一个 `approved` 的 `style` 资产 |
| `signatureComponents` | string[] | 每项都是 `approved` 的 `component` 资产；**0 个合法** |
| `signatureComponentBudget` | integer ≥ 0 | *可选*。**产品自己声明的上限**；超出即错误 |
| `effects` | string[] | 每项都是 `approved` 的 `effect` 资产；**空数组合法** |
| `motionDirection` | string | 标识符（`precise` / `precise-structural`）；应与所选 pack 的 `motion.language` 一致，不一致就记 `deviations` |
| `density` | string | 标识符；应与所选 pack 的 `profile.density` 一致，不一致就记 `deviations` |
| `avoid` | string[] | **不能为空** |
| `deviations` | object[] | *可选*。有意偏离的记录：`{ axis, from, to, reason }` |

字段集合是**封闭的**：出现未知字段是错误，不是被忽略。写错字段名通常意味着某个决策没有被记录。

### 两个强约束

**`firstVisual`** 存在的意义是回答"第一眼看到什么"。如果答案只由印象词构成，它什么也没回答——那正是默认审美在说话。所以：

- 长度不足、或
- 把空话词全部剔除之后剩余内容太少

都会被判错。词表覆盖中英文（`现代/简洁/高级/大气/…`、`modern/clean/minimal/premium/…`），按子串匹配，所以「现代简洁」这种没有分词器也能抓到，而「深色空间里从左上打下来的环境光，标题浮在光里，下方一条发光曲线」能通过。

**`avoid`** 是 Manifest 里最有价值的一栏，因为它是**唯一一条约束默认审美的决策**。空列表意味着这个决策从未做出，所以它是错误，不是风格偏好。

> 「我不想让它长成什么样」比「我想要什么」更能约束产出。默认审美会主动回拉，写下 `avoid` 就是在动手前先把那些门关掉。

### 有意偏离：`deviations`

**偏离不是被禁止的，被禁止的是没记录的偏离。**

Kits 的 `visual-direction` skill 早就写了同一条规则（`density`「与 pack 的 `density` 一致，**或说明为何偏离**」）——
但它没有载体：v1.1 的 Manifest 字段集是封闭的，`densityNote` 会被判成 `manifest/unknown-field`。
于是第三个 Prototype 的 density 偏离只活在 `research-shell.css` 的一段注释里，
而在机器看来它和一次笔误长得一模一样。

```json
"deviations": [
  {
    "axis": "density",
    "from": "high",
    "to": "medium",
    "reason": "论证链需要每屏可读的纵向节奏；instrument 的 high 会把引用原文挤成灰块"
  }
]
```

| 规则 | 为什么 |
|---|---|
| `axis` 是**封闭集合**：`density` · `motion` · `layout` · `component-budget` · `effect-budget` · `typography` · `color` | 写错轴名会让一次真实的偏离看起来"记录过了"，所以未知轴是**错误**，不是忽略 |
| `reason` 必填且 ≥ 8 字 | 偏离的价值全在理由上。`"ok"` / `"n/a"` 不是理由 |
| `from` ≠ `to` | 相等的两条不是偏离，是注释 |
| 同一条轴只能出现一次 | 两条记录互相矛盾 |
| `to` 不能撞上 `avoid` | **偏离可以偏离 pack，不能重新打开 `avoid` 已经关上的门** |
| 链接轴（`density` / `motion`）的 `to` 必须与对应字段一致 | 记录说一套、字段说另一套，比没有记录更糟 |

`axis` 只有 `density` / `motion` 与字段链接（`LINKED_DEVIATION_AXES`）。其余轴**记录但不比对**——
Factory 没有可比对的东西，而编一个假约束比没有约束更坏。

> **一张通用结构，不是一堆 `densityNote` / `motionNote` / `layoutNote`。** 每加一种"注"就是给
> Manifest 加一个字段、给校验器加一个分支；`deviations` 用一条轴把未来的偏离都装下了。

### 签名组件上限：`signatureComponentBudget`

**Factory 不规定所有产品能用几个签名组件，它守住产品自己写的那个数。**

第三个 Prototype 的「最多 2 个」当时只能靠产品手写测试守（`tests/research-workspace.spec.ts`）。
现在它有一个正式的家：

```json
"signatureComponents": ["insight-reveal", "data-cursor"],
"signatureComponentBudget": 2
```

- `ids` 仍然逐个接受 Kits registry 的交叉核对；
- 超出上限 → **错误**（`manifest/signature-budget-exceeded`）；
- `0` 合法，而且与"忘了写"是不同的决定；
- **没写上限 → warning**（`manifest/signature-budget-undeclared`）：不算失败，但也不会被当成通过。

> 为什么不是把 `signatureComponents` 改成 `{ ids, max }`：数组形式已经被三个产品的 Manifest 使用，
> 而 `install-kits.mjs` 也是按扁平 id 列表调用 `kits add` 的；把"选了哪些"和"最多几个"
> 合成一个字段，还会让两个其实不同的决定互相绑死。一个字段一个决定。

### 为什么只有 `avoid` 不能为空，`effects` 可以

「不要任何 effect」是一个**决定**，而且是一个和「忘了写」不同的决定。空数组合法地表达前者。

---

## 文件位置

```
visual-manifest.json          # 仓库根，约定名（VISUAL_MANIFEST_FILENAME）
lib/visual-manifest.ts        # 类型 + 校验器（Factory Core）
lib/visual-manifest.schema.json  # JSON Schema（形状）
docs/examples/visual-manifest.example.json
```

**Factory 不提供默认 manifest。** 这不是疏漏：没有默认，才能逼出一次真实的视觉方向决策。所以 `pnpm factory:kits` 在没有 manifest 时会明确拒绝，并给出该读哪两个文件。

---

## Schema 里为什么没有 enum

`lib/visual-manifest.schema.json` 只描述**形状**，不枚举 `stylePack` 的合法取值。

把 `["cinematic","editorial","instrument"]` 写进 Schema 会有两个后果：

1. **让 Factory Core 知道具体 Style Pack 存在**——而这正是 v1.1 要消除的东西；
2. **在 Kits 发布新 pack 的当天静默过期**——Schema 说"非法"，registry 里有，两边都是"权威"。

所以合法取值在**运行时**从 Kits registry 读取：

```
manifest 里的 id  →  registry/assets.json  →  status === "approved" ？
```

`tests/factory-contract.spec.ts` 会扫描 `lib/` `components/` `app/` `scripts/` `hooks/` `stores/`，断言其中**不出现任何具体 asset id**。`docs/` 与 `tests/` 不在扫描范围内：文档示例允许具体，测试夹具不是 Core 源码。

---

## 校验的三层

```bash
pnpm factory:manifest                          # L1 + L2（总是可用）
pnpm factory:manifest --kits ../prototype-kits # 再加 L3
```

| 层 | 谁做 | 检查什么 | 需要 Kits？ |
|---|---|---|---|
| **L1 · 字段合法性** | `lib/visual-manifest.ts` | 形状、必填、标识符格式、`firstVisual` 非空话、`avoid` 非空 | 否 |
| **L2 · Manifest 自洽** | `lib/visual-manifest.ts` | deviation 的轴/理由/重复/`from≠to`/不撞 `avoid`/链接轴一致；budget 是整数且未被超出 | 否 |
| **L3 · 与所选 pack 的 profile 比对** | `scripts/lib/kits-runtime.mjs` | `stylePack`/`signatureComponents`/`effects` 是 approved 资产；`motionDirection` vs pack `motion.language`；`density` vs pack `profile.density` | **是** |

L3 是 F2 的答案：`motionDirection` 之所以过去"有文档语义但没有机器契约"，是因为没人去读 pack 自己
声明的 `motion.language`。现在要么一致，要么有一条写明理由的 `deviations`，要么失败。

| 状态 | 含义 |
|---|---|
| `verified` | L1 + L2 通过，且 L3 的每个可比字段都一致（或有记录的偏离） |
| `partial` / `upstream-unavailable` | L1 + L2 通过，但**至少一项没有被比对**——并会明说哪一项没比对 |
| `invalid` | 结构错误、自洽错误，或与 pack 冲突且没有记录 |

**"无法证明"永远不会被写成 PASS。** pack 没暴露某个字段时输出
`pack-profile [unverifiable]`，Kits 不在场时输出 `upstream-unavailable` 并列出未比对的项。
已经安装完成的产品脱离 Kits 仓库后必须继续工作——但工具在那种情况下的正确行为是承认边界。

---

## Art Direction Gate

Manifest 不是文档，是**门**。

```
Understand → Inspect → Product Model
→ Product Semantic Invariants
→ Art Direction Divergence   ← 先回答「为什么不该长得像 Reference Sample / 上一个 Prototype」
→ Visual Manifest
→ 【Human Art Direction Gate：九问】
→ kits add → Build → Browser QA → Test → Preview → Visual Acceptance → Release
```

- **没有 Manifest 就不能进入实现。** `pnpm factory:kits` 会拒绝；`skills/interactive-prototype/SKILL.md` 把它写成不可跳过的阶段。
- **Art Direction checkpoint 是人工决定。** 选哪个 pack、第一视觉是什么、不要什么、最多几个签名组件——这些是设计决策，不是可以默认的。Agent 不能在没有 Manifest 的情况下生成 generic AI SaaS visual；也不能代替人确认那九问（见 `docs/prototype-creation-workflow.md` 第 7 步）。
- **Divergence 先于 Manifest。** 先回答「这个产品为什么不该长得像 Reference Sample / 上一个 Prototype」，再把答案写成字段。
- **`firstVisual` 与 `avoid` 是强约束**，会被校验器强制。
- **Manifest 是约束，不是装饰。** 写了 `avoid: ["card-everywhere"]` 却在产物里到处是卡片 = 违规；Browser QA 与人工验收是复核它的地方。

---

## 与 Kits 的分工

| | 归属 | 内容 |
|---|---|---|
| **Factory** | 机制 | 字段集合、形状与自洽校验、非空话规则、registry / pack profile 交叉核对、偏离登记、门与顺序 |
| **Kits** | 创作 | 可选值、参考板、pack 选择、pack 自己的 profile（`motion.language` / `density`）、`avoid` 词表、每个 pack 的硬约束 |
| **产品** | 决定 | 上限（`signatureComponentBudget`）、有意偏离及其理由、`firstVisual`、`avoid` |

Factory 调用 Kits，不重新实现 Kits。新加一个 Style Pack 时，Factory 侧**一行都不用改**——它本来就不认识任何 pack。
