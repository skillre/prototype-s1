# adapters/ —— 产品托管区

这个目录属于**产品**，不属于 Kits。

```
lib/kits/
├── installed/         Kits 托管区（只读，重新安装会覆盖）
├── adapters/          ← 你在这里（Kits 永不覆盖）
└── kits.lock.json     安装清单（Kits 托管）
```

## 为什么要有这一层

Kits 的契约规定：**产品代码不得直接依赖组件 API**，因为组件实现随时
可能被替换。链路是：

```
installed/（Kits 托管） → adapters/（你的稳定 API） → 产品代码
```

产品只 import `@/lib/kits/adapters/<asset>`。升级 Kits 时托管区被覆盖，
而你的适配层与调用方一行不改。

## 三类资产、三条缝

| 资产类型 | CSS 缝 | TS 缝 |
|---|---|---|
| Style Pack | `style-<id>.css` | `style-<id>.ts` + `style-pack.ts`（主 pack 的稳定别名） |
| Signature Component | （组件自己 import） | `<id>.tsx` |
| Effect | `effect-<id>.css` | `effect-<id>.ts` |

产品代码**不要** import `lib/kits/installed/*`。`kits doctor` 会扫描产品
源码并对越界引用直接报 fail（安装器 / CLI 自身除外）。

## 你可以在这里做什么

- 覆盖品牌色（只允许颜色，见 `style-*.css` 里的注释）
- 覆盖效果的公开变量（见 `effect-*.ts` 的 `effectVars`）
- 把组件包成自己的产品语义（例如 `<RunwayStage tone="brand" />`）
- 强制关闭动效、替换实现、加测试友好的 testid

## 不要做什么

- 不要直接 import `../installed/`（那是托管区，会被覆盖）
- 不要把 Kits 的源码复制进这个目录（用 `kits add` 安装到 installed/）

## 重新生成

`kits add` 只在文件**不存在**时生成适配层。删掉某个文件再跑一次即可重新生成，
但你已经改过的文件永远不会被覆盖。

由此带来一个后果：**模板升级不会自动流到已存在的适配层**。
`kits doctor` 会把这件事报成 warn（`adapters-template`），并告诉你
"删掉该文件再跑 kits add 可以拿到新模板" —— 它不会替你覆盖。
