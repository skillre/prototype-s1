"use client";

/**
 * 中性角色文件：角色 `evidence-cite` ← 资产 `evidence-chip`。
 *
 * ## 为什么要有这一层（本仓两条规则在签名组件上会撞车）
 *
 *   1. 适配层是唯一合法入口 —— 产品不得直接 import `lib/kits/installed/**`；
 *   2. 产品源码里**不得出现 Kits 资产 id**（`tests/factory-contract.spec.ts` 的子串判据）。
 *
 * 如果照字面写 `import … from "@/lib/kits/adapters/evidence-chip"`，两条规则会在同一个
 * import 语句上互斥。**这不是需要自己发明解法的问题** —— Kits v0.2 · K4 的
 * 中性适配接缝就是为它设计的（见 `adapters/seam/README.md` 与 `seam.json` 的 notes，
 * 以及 `kits add` 生成的 `adapters/evidence-chip.tsx` 头部那段说明里的「写法 1」）：
 *
 *   产品代码只 import **角色文件**；资产 id 只出现在两处它本该出现的地方 ——
 *   `visual-manifest.json` 的 `signatureComponents` 与 `lib/kits/**`（后者被那条扫描
 *   按设计豁免）。
 *
 * ## 这个文件属于产品
 *
 * Kits 只在文件不存在时生成适配层，**永不覆盖**。换资产时只改下面这一行 re-export，
 * 产品代码零改动 —— 这正是角色文件相对于「直接用资产名」的全部价值。
 */

export {
  EvidenceChip as EvidenceCite,
  type EvidenceChipProps as EvidenceCiteProps,
} from "./evidence-chip"
