/**
 * 源码静态扫描与颜色读取的两个共用工具 —— **只在测试里用**。
 *
 * 这两件事本来是各写各的，而且各错了一次。放在一处是为了让「怎么算一条字面量」
 * 和「怎么读一个颜色」各自只有一个答案。
 */

/**
 * 去掉源码里的注释，**保留字符串字面量**。
 *
 * ## 为什么必须先去掉注释（2026-09-17 实测的一次假红）
 *
 * 两条「本批不许出现 X」的断言各自被**它们自己的说明文字**判红了：
 *
 *   · `workbench.css` 第 20 行是一句 `本文件里没有 #hex、没有 rgb()……` 的注释 ——
 *     `expect(css).not.toMatch(/rgba?\(/)` 命中的正是那句注释；
 *   · `lib/i18n/zh-CN.ts` 里写着 `不写「可 4× 回放」—— 播放倍速没有实现` ——
 *     `expect(dictionary).not.toContain("可 4× 回放")` 命中的也是那句注释。
 *
 * 两次的形状完全一样：**注释里为了说明规则而写出的字面量，被当成了违反规则。**
 * 于是写下「这里不许出现 X」这句话本身就会让门变红 —— 门在惩罚记录。
 *
 * 这不是把尺子改短：判据要守的是**代码**里不许出现这些字面量，注释不是代码。
 * 本仓其它源码扫描早就这么做（`lib/s1/verify.ts` 的注释剥离），这里只是跟上。
 *
 * 顺序要紧：**先剥块注释、再剥行注释**。反过来的话，一句行注释里的 `/*`
 * 会把它后面真正的代码整段吃掉。
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
}

/**
 * 浏览器里跑的颜色读取 —— 以**字符串**形式导出，供 `page.evaluate` / `addInitScript` 使用。
 *
 * 这是 `.qa/probe-guard.mjs` 那条纪律的同一件事：**不要自己写颜色解析**。
 *
 * 关键区别（这里栽过一次）：`getComputedStyle(el).getPropertyValue("--x")` 返回的是
 * **声明值**，作者写 `#1d4ed8` 就返回 `#1d4ed8`；只有元素上的 `color` /
 * `backgroundColor` 才一定被规范化成 `rgb()`。原实现拿正则去匹配 `rgb(...)` 读槽位，
 * 于是每一个十六进制槽位都读成 `null`，探针报的是「读不到颜色」，不是产品有问题。
 *
 * 所以把声明值画到一张 1×1 画布上，让**浏览器自己的解析器**归一化，再从像素取 RGB。
 */
export const READ_COLOR_SOURCE = `(function () {
  const canvas = document.createElement("canvas")
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext("2d")
  if (ctx === null) throw new Error("拿不到 2d context —— 颜色归一化无法进行")
  /**
   * 读颜色。注意 canvas 对**无法识别**的颜色会保持上一次的 fillStyle，
   * 所以每次先设一个哨兵值，再确认它真的被改掉了；改不掉就是没解析成功。
   */
  return function readColor(value) {
    const input = String(value == null ? "" : value).trim()
    if (input.length === 0) return null
    ctx.fillStyle = "#000000"
    ctx.fillStyle = input
    if (ctx.fillStyle === "#000000" && !/^#0{3,8}$|^rgba?\\(0,\\s*0,\\s*0(,\\s*1)?\\)$|^black$/i.test(input)) {
      return null
    }
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillRect(0, 0, 1, 1)
    const data = ctx.getImageData(0, 0, 1, 1).data
    return [data[0], data[1], data[2]]
  }
})()`

/** 在浏览器里取一个模型：{ read(color), elementColor(el), slot(name) }。 */
export const COLOR_PROBE_SOURCE = `(function () {
  const read = ${READ_COLOR_SOURCE}
  const elementColor = (element, property) => read(getComputedStyle(element)[property])
  const slot = (name) => read(getComputedStyle(document.documentElement).getPropertyValue(name))
  return { read, elementColor, slot, same: (a, b) => a !== null && b !== null && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] }
})()`
