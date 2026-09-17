"use client"

import { useCallback, useEffect, useRef } from "react"

/**
 * 面板内滚动 —— **按行对齐**，并且只在操作者本来就在底部时才跟随到底。
 *
 * ## 这一层修的是什么（2026-09-17 实测缺陷）
 *
 * 中列面板跟着最新内容滚到底（实测 `scrollTop = 15` 与 `5`），于是顶部那一行被切在
 * **任意像素**上 —— 一个汉字被横着切掉一半、并且压在面板头的规则线上。它不是"看起来有点挤"：
 * 被切的那一行正是观众正在读的那一行（研判流的最新结论、控制台的最新回显）。
 *
 * ## 为什么是「对齐」而不是「改成整页滚动」
 *
 * 这一屏承诺 **16:9 单屏不溢出**，整页滚动会把这条承诺作废；而单纯加一层遮罩只是
 * 把切痕藏起来 —— 文字仍然断在半个字高上，只是断在渐隐里。所以真正的修法是让
 * `scrollTop` 落在**某一行下沿**上：行与行之间本来就有空隙，切痕落进空隙就等于没有切痕。
 *
 * ## 三条一起用
 *
 *   1. `alignScrollTop(node)` —— 把 `scrollTop` 吸附到最近的行下沿。所有程序化滚动
 *      （内容变长、「滚到底」）之后、以及用户拖完之后，都由它收尾。
 *   2. **跟随到底**（`followKey`）—— 内容变长时，只有当操作者**本来就在底部附近**才
 *      继续跟着走。人往上翻去看前面那几行时，新内容不该把他拽回去。
 *   3. `data-scroll-mask` —— 溢出时给顶边一层渐隐。它不替代 (1)，只是兜底：
 *      行高不整除、或手动拖到半行位置时，边界不会是硬切痕。
 *
 * ## 为什么行元素是量出来的
 *
 * 面板里的行高各不相同（计划行的 `--kits-row-height`、结论卡的 1.4 行高、回显的
 * `--kits-body-line`）。写死一个"行高"会在第二种内容上立刻失效，所以这里量**孩子元素**
 * 的盒子：`(bottom - scrollTop)` 最小的那个孩子就是当前顶行，把它整行滚进来即可。
 * 这不是启发式 —— 它就是"顶边该落在哪"的定义。
 */

/** 行下沿与滚动口上沿之间的余量（px）：吸附后顶行完整可见，且留出行的分隔感。 */
const ROW_GAP_ALLOWANCE_PX = 2

/** 距底部不超过这个距离就算「在底部」—— 小于一行高，所以不会把"差一行"误判成到底。 */
const FOLLOW_THRESHOLD_PX = 24

/**
 * 真正会被顶边切到的那些盒子 —— 也就是**行**。
 *
 * ## 为什么不是「容器的直接孩子」
 *
 * 这是 2026-09-17 实测出来的：直接孩子常常只是一个 `div.w-full` 外壳（`finding-stream`
 * 的直接孩子是两篇 `article`、`plan-panel` 是一个 `.s1-plan`），而会被切在半个字高上的是
 * **里面的文本行**。拿外壳去对齐，算出来的落点整行偏高，切痕一点没少。
 *
 * 判据：**自己直接含非空文本**的盒子。它们就是行。嵌套（行里还有盒子）时只取最外层，
 * 因为切痕是横向的 —— 最外层那一行被切开，里面的每一层自然都在切痕里。
 */
function textRows(node: HTMLElement): HTMLElement[] {
  const rows: HTMLElement[] = []
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
  const seen = new Set<HTMLElement>()
  for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
    if ((text.textContent ?? "").trim().length === 0) continue
    const element = text.parentElement
    if (element === null || element === node || seen.has(element)) continue
    seen.add(element)
    rows.push(element)
  }
  return rows
}

/** 盒子是不是「看得见」的 —— 零尺寸的不算行（隐藏节点、空 span）。 */
function visible(box: DOMRect): boolean {
  return box.height > 0 && box.width > 0
}

/**
 * 把滚动容器的 `scrollTop` 吸附到一个**不切断任何一行**的位置。
 *
 * ## 2026-09-17 的第二版：为什么第一版不够
 *
 * 第一版拿**容器的直接孩子**对齐，并且把落点算到容器的**边框盒**上沿。实测两个都错：
 *
 *   · 边框盒 ≠ 内容盒：`.s1-panel__body` 有 `padding-top`（`--kits-label-gap`），
 *     于是算出来的落点整行偏低一个 padding，顶行就停在切痕里；
 *   · 直接孩子常常只是外壳，真正被切的是里面的**文本行**，粒度不对。
 *
 * 现在的判据是唯一的那个定义：**顶边之下第一行，它的下沿对齐到内容盒上沿**。
 * 于是内容盒顶边之上、padding 区内不再压着半行文字，行与行之间的空隙正好落在切痕处。
 *
 * ## 够不着的时候怎么办
 *
 * 落点可能超出可滚动范围（`scrollHeight - clientHeight`）。这时**不再无条件滚到底** ——
 * 那是第一版的另一个错误：滚到底是「能滚多远滚多远」，不等于「切痕落在行缝里」。
 * 更近的那一侧才是答案：宁可让这一行整行留在视野里（切痕落在它上面的空隙），
 * 也不要让它的下沿停在 padding 区里、上半截被切掉。
 *
 * 返回吸附后的 `scrollTop`（测试可以直接断言它是行边界）。
 * 容器没有可量的行时原样返回，不做任何事。
 */
export function alignScrollTop(node: HTMLElement): number {
  const rows = textRows(node).filter((row) => visible(row.getBoundingClientRect()))
  if (rows.length === 0) return node.scrollTop

  const rect = node.getBoundingClientRect()
  const style = getComputedStyle(node)
  // 内容盒上沿 = 边框盒上沿 + 上内边距（+ 有边框时的上边框）。
  // `padding` / `border` 用解析值而不是 `clientTop`：`clientTop` 是**布局**值，
  // 缩放（scale-to-fit）之后与 `getBoundingClientRect` 不在同一个坐标系里。
  const contentTop =
    rect.top + (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.borderTopWidth) || 0)
  const maxScroll = Math.max(0, node.scrollHeight - node.clientHeight)

  // 顶边之下第一行 —— 它要么整体在内容盒之上（已滚过去），要么正被切。
  const host = rows.find((row) => row.getBoundingClientRect().bottom - contentTop > ROW_GAP_ALLOWANCE_PX)
  if (host === undefined) return node.scrollTop

  const hostRect = host.getBoundingClientRect()
  // 它的下沿对齐到内容盒上沿 = 切痕落在这一行**上面的空隙**里。
  //
  // 够不着就算了（`wanted` 超出可滚动范围时**不写** `scrollTop`）。
  //
  // 这里曾经写成「退回到上一个行缝（`hostRect.top`）」，那是错的：退回值在滚动到底的
  // 面板上永远比当前值小一点点，而 `scroll` 事件会再触发一次对齐 —— 于是每次滚动都
  // 微调一次，元素**永远不稳定**。实测代价：Playwright 点不到任何一行留痕
  // （`element is not stable`，30s 超时），因为那一行在不停地抖。
  // 对齐是「把切痕移进行缝」，不是「必须动一下」；动不了就不动。
  const wanted = node.scrollTop + (hostRect.bottom - contentTop)
  const next = Math.max(0, Math.min(wanted, maxScroll))
  if (Math.abs(next - node.scrollTop) > 0.5) node.scrollTop = next
  return node.scrollTop
}

/**
 * 给面板正文装上「按行对齐 + 跟随到底 + 溢出遮罩」。
 *
 * `followKey` 是「内容变了」的机器可读形式（条数、最后一条的 key……调用方给一个变化的
 * 原始值即可）。它变化时：在底部就滚到新的底部，不在底部就留在原地 —— 两种情况之后
 * 都会走一次按行对齐。
 */
export function usePanelScroll<T extends HTMLElement>(followKey: string | number = 0) {
  const ref = useRef<T | null>(null)
  const followRef = useRef(false)

  /**
   * 交给 React 的 ref。
   *
   * 它是一个**回调 ref**（返回值的函数），不是一个 `{ current }` 对象 ——
   *   · 回调 ref 由 React 在挂载/卸载时调用，不违反「渲染期不得读 ref」这条规则
   *     （`react-hooks/refs`）；
   *   · 同时它避免了「调用方去写别人的 `ref.current`」那种写法（`react-hooks/immutability`）。
   * 两个规则拦的都是同一件事：状态的所有权要清楚。这里的所有权是这一层的。
   */
  const setNode = useCallback((node: T | null) => {
    ref.current = node
  }, [])

  const syncMask = useCallback((node: T) => {
    const overflowing = node.scrollHeight - node.clientHeight > 1
    if (overflowing) node.setAttribute("data-scroll-mask", "true")
    else node.removeAttribute("data-scroll-mask")
  }, [])

  const align = useCallback(() => {
    const node = ref.current
    if (node === null) return
    alignScrollTop(node)
  }, [])

  /* ------------------------------------------------ 跟随到底（只在底部时） */
  useEffect(() => {
    const node = ref.current
    if (node === null) return
    if (followRef.current) node.scrollTop = node.scrollHeight
    syncMask(node)
    alignScrollTop(node)
  }, [followKey, syncMask])

  useEffect(() => {
    const node = ref.current
    if (node === null) return

    // 初始判定：面板刚出现就算在底部（新面板的"当前位置"就是它的底部）。
    const atBottom = () => node.scrollHeight - node.clientHeight - node.scrollTop <= FOLLOW_THRESHOLD_PX
    followRef.current = atBottom()

    const sync = () => {
      syncMask(node)
      alignScrollTop(node)
    }
    sync()

    const resize = new ResizeObserver(sync)
    resize.observe(node)
    // 内容是用 append 长出来的（panel 自己 re-render），所以要看孩子而不是看自己。
    for (const child of Array.from(node.children)) resize.observe(child)

    const mutation = new MutationObserver(sync)
    mutation.observe(node, { childList: true, subtree: false, characterData: false })

    // 滚动之后吸附。rAF 合并，所以一次拖动只对齐一次。
    let frame = 0
    const onScroll = () => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        alignScrollTop(node)
        // 吸附之后重新判定"操作者想待在哪" —— 这是唯一读它的地方，
        // 所以一次手动上翻就会把跟随关掉，一次手动拖到底就会把它打开。
        followRef.current = atBottom()
      })
    }
    node.addEventListener("scroll", onScroll, { passive: true })

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      node.removeEventListener("scroll", onScroll)
      resize.disconnect()
      mutation.disconnect()
    }
  }, [syncMask])

  return { ref, setNode, align }
}
