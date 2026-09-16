/**
 * Registry 读取与「已批准」门禁。
 *
 * 这是 Installer Rules 的第 1 条：
 *   只允许安装 registry 中 status = "approved" 的资产。
 *
 * 门禁放在**读取层**而不是命令层，是为了让 `kits list` / `kits doctor` / 测试
 * 都走同一套判据 —— 任何一条路径都不可能绕过它。
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { CODES, KitsError, fail } from "./errors.mjs";

/** 安装器认可的资产类型（skill / reference 不参与源码安装）。 */
export const INSTALLABLE_TYPES = ["style", "component", "effect", "package"];

/** 允许进入产品的状态。incoming / experimental / deprecated 一律拒绝。 */
export const INSTALLABLE_STATUS = "approved";

/**
 * @param {string} kitsRoot Kits 仓库根
 * @returns {{ registry: any, assetsById: Map<string, any> }}
 */
export function loadRegistry(kitsRoot) {
  const file = path.join(kitsRoot, "registry", "assets.json");
  if (!existsSync(file)) {
    fail(
      CODES.REGISTRY_MISSING,
      `找不到 registry：${file}`,
      "确认 --kits 指向 Kits 仓库根目录（含 registry/assets.json）。",
    );
  }
  let registry;
  try {
    registry = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new KitsError(
      CODES.LOCK_INVALID,
      `registry/assets.json 不是合法 JSON：${error.message}`,
    );
  }
  if (!Array.isArray(registry.assets) || registry.assets.length === 0) {
    fail(CODES.REGISTRY_MISSING, "registry.assets 为空或不是数组");
  }
  const assetsById = new Map();
  for (const asset of registry.assets) {
    assetsById.set(asset.id, asset);
  }
  return { registry, assetsById };
}

/** 该类型是否参与源码安装（skill / reference 是给 agent 读的，不是文件资产）。 */
export const isInstallableType = (type) => INSTALLABLE_TYPES.includes(type);

/**
 * 门禁：返回可安装的资产，否则抛错。
 *
 * @param {Map<string, any>} assetsById
 * @param {string} id
 */
export function requireApproved(assetsById, id) {
  const asset = assetsById.get(id);
  if (!asset) {
    const known = [...assetsById.keys()].filter((k) => k.startsWith(id));
    fail(
      CODES.ASSET_UNKNOWN,
      `registry 里没有资产「${id}」`,
      known.length ? `你是不是想要：${known.join(", ")}？` : "用 `kits list` 看可用资产。",
    );
  }
  if (!isInstallableType(asset.type)) {
    fail(
      CODES.ASSET_NOT_APPROVED,
      `资产「${id}」类型是 ${asset.type}，不参与源码安装`,
      `可安装类型：${INSTALLABLE_TYPES.join(" / ")}。${asset.type} 是给 agent 读的文档资产。`,
    );
  }
  if (asset.status !== INSTALLABLE_STATUS) {
    fail(
      CODES.ASSET_NOT_APPROVED,
      `资产「${id}」状态是 ${asset.status}，安装器只接受 ${INSTALLABLE_STATUS}`,
      "状态流转见 registry/README.md 的 statusLifecycle；未批准资产不得进入业务 Prototype。",
    );
  }
  return asset;
}

/**
 * 解析依赖图（深度优先，带环检测），返回**拓扑序**的资产列表
 * （被依赖者在前），并保留可读的解析路径用于报告。
 *
 * @param {Map<string, any>} assetsById
 * @param {string[]} roots
 */
export function resolveDependencies(assetsById, roots) {
  const ordered = [];
  const seen = new Set();
  const visiting = new Set();
  /** @type {Array<{from:string,to:string,requirement:string}>} */
  const edges = [];

  const visit = (id) => {
    if (seen.has(id)) return;
    if (visiting.has(id)) {
      fail(
        CODES.DEPENDENCY_CYCLE,
        `依赖出现环：${[...visiting].join(" → ")} → ${id}`,
        "Kits 的资产依赖图必须是 DAG；请在 registry 里拆开这个环。",
      );
    }
    const asset = requireApproved(assetsById, id);
    visiting.add(id);
    for (const dep of asset.dependencies ?? []) {
      const depId = typeof dep === "string" ? dep : dep.id;
      const requirement = typeof dep === "string" ? "*" : (dep.version ?? "*");
      edges.push({ from: id, to: depId, requirement });
      visit(depId);
    }
    visiting.delete(id);
    seen.add(id);
    ordered.push(asset);
  };

  for (const root of roots) visit(root);
  return { ordered, edges };
}
