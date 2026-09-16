---
name: interactive-prototype
description: 在本项目（Prototype Starter，Next.js 16 + shadcn/base-nova + Motion + Zustand）中开发高保真 Interactive Prototype 的标准工作流：Understand → Inspect → Plan（含 Visual Manifest 与 Art Direction checkpoint）→ Kits 安装 → Build → Run → Browser Validate → Fix → Polish → Test，完成后交给 git-delivery Skill 交付。**任何业务原型在写 UI 之前必须先产出 Visual Manifest。** 适用于所有交互式原型/演示页开发任务。
---

# Interactive Prototype 开发 Skill

## 目标

把需求变成**真实可交互的高保真原型**——不是静态 mockup，不是假按钮；每个可见控件都作用于真实 local state，并且经过**真实浏览器验证**后才算完成。

## 前置约束（必须先读）

1. 先读 `AGENTS.md`（含 Next.js 16 的版本注意点、Quality Gates 与 Git 规则）。
2. 只做 Frontend + local state + realistic mock data；**禁止** Database / Supabase / Auth / Docker / Kubernetes / Monorepo / Backend / CI 自动化。
3. 组件库：`components/ui`（shadcn base-nova，**Base UI**：`render` prop 代替 `asChild`）、`components/prototype`、`components/motion`、`components/layout`。
4. 数据：`lib/mock-data.ts` 的 realistic mock data；禁用 lorem ipsum。
5. 视觉：只使用 `app/globals.css` 的 design token 与 `lib/motion-presets.ts` 的时长/缓动。

## 工作流（逐阶段执行，不跳步）

### 1. Understand

- 澄清需求：用户目标、涉及页面、核心用户流程、交互目标（表单、筛选、拖拽、抽屉等）、visual direction。
- 确认边界：哪些交互是"演示必须真实"的，哪些状态（loading / empty / error）必须可触发。

### 2. Inspect

在动手前只读检查：

- repository 结构：routes（`app/`）、repositories 构成（`components/`、`stores/`、`lib/`、`hooks/`）；
- existing components：`components/prototype`、`components/motion`、`components/layout`、`components/ui` 有哪些可复用件；
- design tokens（`app/globals.css`）与 motion presets（`lib/motion-presets.ts`）；
- state：现有 zustand store 的结构与 action，新增状态优先并入现有 store；
- tests：`tests/*.spec.ts` 现有覆盖与选择器习惯（role / label / data-testid）。

不要假设代码结构，一切以实际读到的代码为准。

### 3. Plan

在大量修改前先确定：

- screens：页面清单与路由；
- states：loading / empty / error 以及可触发方式；
- interactions：每个可见控件的真实行为与状态归属；
- reusable components：复用/扩展现有组件清单，新组件清单与理由；
- animations：哪些交互需要 Motion，取哪个 preset；
- responsive behavior：桌面与移动端布局策略；
- testing strategy：哪些关键流程要写入 Playwright。

避免没有理解项目结构就开始大量生成代码。输出简短计划（页面/组件文件清单、store action 清单、复用清单、无重复组件声明）。

### 3.5 Visual Direction → Visual Manifest → Art Direction checkpoint

**这一步不可跳过。** 没有 Visual Manifest 就开始写 JSX = 违规。

Agent 的默认审美会强烈回拉：卡片 + 阴影 + 渐变 + 紫色，最后得到"哪都还行、哪都不成立"的页面。
视觉方向必须先被**声明**，然后才被**实现**。

1. **加载 Kits 的 `skills/visual-direction/SKILL.md`**（创作语义在那里：怎么选 pack、参考板怎么读、
   签名组件怎么挑、`avoid` 写什么）。Factory 不重述这些。
2. **产出 `visual-manifest.json`**（八项必填，见 `docs/visual-manifest.md`）：
   ```
   productType · firstVisual · stylePack · signatureComponents · effects · motionDirection · density · avoid
   ```
   - `firstVisual` 必须写出**第一眼看到什么**，不是印象词（「现代简洁」会被校验器直接拒绝）。
   - `avoid` 不能为空——它是 Manifest 里唯一约束默认审美的字段。
3. **校验**：`pnpm factory:manifest`。有 Kits 仓库时加 `--kits` 做上游比对。
4. **Art Direction checkpoint —— 人工 / 显式确认。**
   选哪个 pack、第一视觉是什么、不要什么，这些是**设计决策，不是可以默认的东西**。
   Agent 必须把这个决定交给用户确认，并把结果写进 Manifest；不能替人决定，也不能不记录就跳过。

> Manifest 是**约束**，不是文档。写了 `avoid: ["card-everywhere"]` 却在产物里到处是卡片 = 违规，
> 会在 Browser QA 与人工视觉验收时被复核。

### 3.6 Kits Source Installation（Manifest 里有 Kits 资产时）

```bash
pnpm factory:kits              # 先 dry-run 看计划
pnpm factory:kits --write      # 真实安装 → 校验 lock → 跑 doctor
pnpm qa:doctor                 # doctor 是正式质量门
```

参数全部来自 Manifest。安装后：

- `lib/kits/installed/` 是 **Kits-managed**，重新安装会整体覆盖，**禁止手工修改**。
- `lib/kits/adapters/` 是 **Product-owned**，Kits 永不覆盖；手写集成放这里。
- 产品代码**不得直接 import `installed/*`**，必须走 `Product → adapters → installed`。

详见 `docs/kits-ownership.md`。不需要任何 Kits 资产的原型可以跳过这一步。

### 4. Build

- 页面在 `app/<route>/`，可复用业务组件进 `components/prototype/`（或 motion/layout）。
- 优先：reuse existing components → reuse design tokens → reuse motion components → reuse prototype components；缺什么再补什么，禁止新造同质组件。
- 所有交互连到真实状态；必须考虑 loading / empty / error 三态；必须 responsive。
- 禁止 magic number、禁止硬编码 duration/ease、禁止 lorem ipsum。

### 5. Run

- `pnpm dev` 启动真实应用（http://localhost:3000，demo 在 /demo），确认无编译错误。

### 6. Browser Validate

**必须实际进行浏览器验证**，不能只靠源码阅读判断。至少检查：

- navigation / buttons / forms / tabs / dialogs / drawers / filters / drag and drop / command palette / responsive；
- 关键用户流程逐一点击，检查页面结果；
- 检查 **console error**；
- 必要时**截图**存档；
- loading / empty / error 状态可触发且表现正确。

Factory v1.1 起，优先用可重复的扫描替代手工走查：

```bash
pnpm qa            # 所有路由 × 桌面/移动 × 明暗 + 能力探针
```

它会检查 console / page / request 错误、横向溢出与 **viewport expansion**、
**No Invisible Semantics**（DOM 语义数 == 无障碍树 role 数）、probe 完整性、
reduced-motion / coarse-pointer / IntersectionObserver 失效。标准见 `docs/browser-qa.md`。

**注意**：移动端横向溢出不能只看 `scrollWidth - innerWidth`——Chromium 会自动扩张布局视口，
让这个判据假绿。三条判据缺一不可。

补充 `tests/demo.spec.ts` / 新建 spec 覆盖产品行为。

### 7. Fix

发现问题以后：

- 找到**根因**，做**最小范围修复**，不进行无必要的大规模重构；
- 修复后**重新运行第 6 步验证**，确认问题消失且无回归。

### 8. Polish

重点检查：

- spacing / typography / 视觉 hierarchy / 一致性（与现有页面统一）；
- animation timing（只取 motion presets）；
- loading / empty / error 三态的视觉质量；
- responsive：桌面（Sidebar + TopNav）与移动（MobileNav + Drawer + 单列）都可用。

### 9. Test

依次执行**并全部通过**：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

任何一项失败都**禁止声称完成**；修复后重新执行，直至全绿。

## Browser QA Loop（贯穿 Build 之后的持续循环）

```
Implement → Run → Browser → Interact → Inspect → Detect → Fix → Browser again → Test
```

目标：不只会"写代码"，还要通过真实浏览器反馈持续改进，直到整个循环稳定收敛。

## 完成标准（Definition of Done）

- [ ] 所有可见交互真实可用（无 fake button，无静态 mockup）
- [ ] loading / empty / error 三种状态齐全且可触发
- [ ] 桌面与移动端均可用
- [ ] 无重复组件、无 magic number、无 lorem ipsum
- [ ] realistic mock data
- [ ] lint / typecheck / test / build 全部通过
- [ ] 核心流程经真实浏览器验证（含 console error 检查）
- [ ] **`visual-manifest.json` 已产出且通过 `pnpm factory:manifest`**，`avoid` 里的每一条在产物里确实没有出现
- [ ] `pnpm qa` 通过（0 console / 0 page error / 0 request failure / 0 横向溢出 / 0 viewport expansion）
- [ ] 数据型原型：invariant 测试先于 UI 大规模实现写好并保持通过
- [ ] Manifest 里的 constrains 已由人工视觉验收复核

## 交付

原型完工后，交给 **`skills/git-delivery/SKILL.md`** 的 Git 交付工作流（Branch Check → Diff Review → Quality Gates → Commit → Push → Preview）。开发阶段不要提交 Git，交付前不 push、不 merge main。

## 参考文件

- `AGENTS.md` — 项目规则（必读）
- `app/globals.css` — design tokens
- `lib/motion-presets.ts` — motion durations/easings
- `components/prototype/*` — 可复用产品组件
- `stores/dashboard-store.ts` — zustand 模式参考
- `playwright.config.ts` + `tests/*.spec.ts` — e2e 模式参考
- `docs/visual-manifest.md` — Visual Manifest 契约与 Art Direction Gate
- `docs/browser-qa.md` — Browser QA 标准
- `docs/kits-ownership.md` — Kits 所有权契约
- `docs/prototype-creation-workflow.md` — 完整生产流程
- `skills/git-delivery/SKILL.md` — Git 交付工作流