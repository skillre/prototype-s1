/**
 * 稳定 JSON —— 确定性比较与导出用的序列化。
 *
 * `JSON.stringify` 的对象键顺序取决于**构造顺序**，而构造顺序是实现细节：
 * 两个语义相同的对象可以序列化成两个不同的字符串。这里的 `stableStringify`
 * 递归按键名排序，于是：
 *
 *   · `audit.replay-is-faithful` 的深比较有一个与实现无关的形态；
 *   · `sediment.survives-export` 的导出物可以逐字符比对（导出两次得到同一个字符串）。
 *
 * 只支持 JSON 能表达的值；遇到 `undefined` / 函数 / `NaN` 会响亮地失败，
 * 而不是悄悄序列化成 `null`。
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true
  const type = typeof value
  if (type === "string" || type === "boolean") return true
  if (type === "number") return Number.isFinite(value as number)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (type === "object") {
    return Object.values(value as Record<string, unknown>).every(isJsonValue)
  }
  return false
}

export function stableStringify(value: unknown): string {
  if (!isJsonValue(value)) {
    const path = firstNonJsonPath(value)
    throw new Error(
      `不是可序列化的 JSON 值（${typeof value}）于 ${path}：稳定序列化拒绝把不可比较的东西写成字符串`,
    )
  }
  return JSON.stringify(sortValue(value))
}

/** 找出第一个不可序列化的位置（`a.items[3].detail` 这种路径），让失败信息能直接定位。 */
export function firstNonJsonPath(value: unknown, path = "$"): string {
  if (value === null) return ""
  const type = typeof value
  if (type === "string" || type === "boolean") return ""
  if (type === "number") return Number.isFinite(value as number) ? "" : path
  if (type === "undefined" || type === "function" || type === "symbol" || type === "bigint") return path
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = firstNonJsonPath(value[index], `${path}[${index}]`)
      if (found !== "") return found
    }
    return ""
  }
  if (type === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const found = firstNonJsonPath((value as Record<string, unknown>)[key], `${path}.${key}`)
      if (found !== "") return found
    }
    return ""
  }
  return path
}

function sortValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, JsonValue> = {}
    for (const key of Object.keys(value).sort()) sorted[key] = sortValue(value[key])
    return sorted
  }
  return value
}
