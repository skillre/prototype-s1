/**
 * Installer 的错误类型。
 *
 * 为什么单独一个类型而不是到处 throw new Error：
 * `kits add` 必须做到**失败时不留下半安装状态**，因此区分
 * 「计划阶段的错误」（可以干净地退出，什么都没动）
 * 与「写入阶段的错误」（需要回滚）。
 *
 * 本文件是 **JavaScript（.mjs）**，不是 TypeScript —— Installer 必须在
 * 一个「除了 node_modules 什么都没有」的产品里裸跑，所以它不能被要求
 * 先经过任何转译。类型信息只存在于 JSDoc 里。
 */

export class KitsError extends Error {
  /**
   * @param {string} code 机器可读错误码（测试与 doctor 用它断言）
   * @param {string} message 面向使用者的一句话
   * @param {string} [hint] 下一步建议
   */
  constructor(code, message, hint = "") {
    super(message);
    this.name = "KitsError";
    /** @type {string} 机器可读的错误码 */
    this.code = code;
    /** @type {string} 面向使用者的下一步建议 */
    this.hint = hint;
  }
}

export const CODES = {
  REGISTRY_MISSING: "REGISTRY_MISSING",
  ASSET_UNKNOWN: "ASSET_UNKNOWN",
  ASSET_NOT_APPROVED: "ASSET_NOT_APPROVED",
  ASSET_PATH_MISSING: "ASSET_PATH_MISSING",
  DEPENDENCY_UNRESOLVED: "DEPENDENCY_UNRESOLVED",
  DEPENDENCY_CYCLE: "DEPENDENCY_CYCLE",
  TARGET_NOT_A_PACKAGE: "TARGET_NOT_A_PACKAGE",
  REACT_INCOMPATIBLE: "REACT_INCOMPATIBLE",
  TARGET_EXISTS_DIRTY: "TARGET_EXISTS_DIRTY",
  CHECKSUM_MISMATCH: "CHECKSUM_MISMATCH",
  LOCK_MISSING: "LOCK_MISSING",
  LOCK_INVALID: "LOCK_INVALID",
  NOT_INSTALLED: "NOT_INSTALLED",
  MODIFIED_MANAGED_FILE: "MODIFIED_MANAGED_FILE",
  BAD_USAGE: "BAD_USAGE",
};

/**
 * @param {string} code
 * @param {string} message
 * @param {string} [hint]
 * @returns {never}
 */
export const fail = (code, message, hint) => {
  throw new KitsError(code, message, hint);
};
