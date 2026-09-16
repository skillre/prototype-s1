# adapters/seam/ —— 中性适配接缝

这个目录属于**产品**，不属于 Kits。`kits add` 只在文件不存在时生成，**永不覆盖**。

## 为什么需要它

`lib/kits/adapters/<资产名>.tsx` 这类文件**里面**可以出现资产 id（这一层的工作
就是把它翻译成产品稳定名），但**产品代码**不应该出现：

```
产品代码  →  角色文件（你写，稳定的名字）  →  资产适配文件（Kits 生成）  →  installed/
```

直接写 `import { DataCursor } from "@/lib/kits/adapters/data-cursor"` 的问题是：
换一个指针实现时，你要改的是**每一个调用点**，而不是一行。

## 怎么绑定（三步）

1. 在 `seam.json` 的 `bindings` 里声明角色 → 资产 id：

   ```json
   { "seamVersion": "0.2.0", "bindings": { "pointer": "data-cursor" } }
   ```

2. 复制 `_template.ts`，改名为角色名（例如 `pointer.tsx`），把里面那一行
   换成真实导出：

   ```tsx
   export { DataCursor as Pointer, type DataCursorProps as PointerProps } from "../data-cursor"
   ```

3. 产品代码只 import 角色文件：

   ```tsx
   import { Pointer } from "@/lib/kits/adapters/pointer"
   ```

换资产 = 改这两处，**产品代码不动**。

## Kits 为什么替你选不了角色

哪个组件在你的产品里承担「指针」「结构」「数据」这些语义，是**产品决策**。
Kits 的 metadata 里没有角色字段（`manifest.adapter` 是一段政策说明，不是角色名），
所以 Kits 不从文件名猜 —— `data-cursor` 是不是「pointer」由你说了算。

Kits 能保证的是**机制可检查**：`kits doctor` 会把

- 声明了绑定、却没有对应角色文件
- 有角色文件、却没有声明绑定
- 绑定指向的资产不在本次安装里

三种情况分别报出来。声明与实现在两个方向上都不允许静默缺席。
