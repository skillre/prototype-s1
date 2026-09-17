"use client"

import { useEffect, useRef, useState, type RefObject } from "react"

import { useMessages } from "@/components/i18n/locale-provider"
import { WorkbenchPanel, type PanelStatus } from "@/components/prototype/workbench/panel"
import {
  evidenceDetailOf,
  type AttackChain,
  type AttackEdge,
  type AttackNode,
} from "@/components/prototype/workbench/view-model"

/**
 * ⑤ 攻击链 · 实体视图 —— 左列的对象模型画布（人-资产-文件-进程-数据）。
 *
 * ## 为什么这张图**故意稀疏**
 *
 * 边只画「两端都被同一条已揭示证据引用到」的那几条（判据是证据的 `entityRefs`，
 * 不是实体自己的 `detail` 旁白）。所以线一定比设计稿少，而且少是对的：多画一条看起来对的线，
 * 就是把一句旁白升格成一条有据可查的攻击路径。`edgesNote` 把这件事写在图下面。
 *
 * ## 为什么每个节点必须能被键盘走到
 *
 * 画布的空间信息（谁挨着谁、哪两个节点被一根线连着）只有看得见的人才拿得到。所以节点是
 * **真的 DOM 元素**、带 `tabindex="0"`（按 DOM 顺序依次可聚焦），名字就是里面那行可见文字
 * （标签 + 状态词）；SVG 那层只是装饰，而**每条边另有文字形态**（证据引用 + 两端标签 + 两端角色）。
 * 「画里有、DOM 里没有」在这里是不允许的：屏幕阅读器读到的事实必须与图上一样多。
 *
 * ## 允许的动效只有一种
 *
 * 只有**本回合状态真的被改写过**的节点做一次入场（pack 的 enter 位移 + 淡入，一次、不回弹、
 * 不循环）——它表达的是「这个节点刚刚变过」，其余一律静止；整条规则关在
 * `prefers-reduced-motion: no-preference` 里，降级下内容**立刻可见**，不会停在 `opacity: 0`。
 *
 * 数据全部来自 `AttackChain`（本组件不算数、不补内容、不发明边）；界面文案全部走词典。
 */
export function AttackGraph({
  status,
  chain,
  errorMessage,
  onRetry,
}: {
  status: PanelStatus
  chain: AttackChain
  errorMessage?: string | null
  onRetry?: () => void
}) {
  const t = useMessages()
  const copy = t.workbench.attackGraph
  /** 已展开的证据引用（局部状态）：点一下给那条证据自己的字段，再点一下收起。 */
  const [openEvidence, setOpenEvidence] = useState<string[]>([])
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const edgeLines = useEdgeLines(canvasRef, chain)

  const toggleEvidence = (id: string) => {
    setOpenEvidence((open) => (open.includes(id) ? open.filter((item) => item !== id) : [...open, id]))
  }

  /** 边只存两端 id，标签要从节点上取 —— 查表一次，按 id 找回节点。 */
  const byId = new Map(chain.nodes.map((node) => [node.id, node]))

  return (
    <WorkbenchPanel
      id="attack-graph"
      title={copy.title}
      subtitle={copy.subtitle}
      aside={
        chain.nodes.length === 0 ? null : (
          <span className="sth-panel__subtitle" data-testid="graph-node-count">{chain.nodes.length}</span>
        )
      }
      status={status}
      errorMessage={errorMessage}
      onRetry={onRetry}
      emptyTitle={copy.empty}
      emptyNote={copy.emptyNote}
    >
      <div className="sth-graph" data-testid="attack-graph">
        <ul className="sth-graph__legend" data-testid="graph-legend">
          <li data-meaning="attack">
            <span className="sth-graph__legend-mark sth-graph__legend-mark--path" aria-hidden="true" />
            {copy.legend.attackPath}
          </li>
          <li data-meaning="ai">
            <span className="sth-graph__legend-mark sth-graph__legend-mark--controlled" aria-hidden="true" />
            {copy.legend.controlled}
          </li>
          <li data-meaning="closed">
            <span className="sth-graph__legend-mark sth-graph__legend-mark--closed" aria-hidden="true" />
            {copy.legend.closed}
          </li>
        </ul>

        {/* 节点的落点由**层次布局**给出（`attackChainLayout`）：排与列区间。
           画布是一个真正的网格 —— 同一排的节点拿到互不相交的列区间，不同排的节点在竖直
           方向上本来就不重叠，所以「两个节点压在一起」在布局层面就不可能发生，
           而不是靠"坐标取得够开"这种会随内容变化的假设（旧实现就是这么坏的，见
           `view-model.ts` 里 `attackChainLayout` 的长注释）。
           画布高度由内容撑开（`grid-auto-rows: auto`），面板正文照常内部滚动 ——
           见 `workbench.css` 里 `.sth-graph__canvas` 关于「16:9 单屏不溢出」的说明。 */}
        <div
          className="sth-graph__canvas"
          ref={canvasRef}
          data-testid="attack-graph-canvas"
          data-rank-count={chain.layout.rankCount}
          data-column-count={chain.layout.columnCount}
          /* 列数来自布局（数据），不是样式表里的一个字面量：几个实体一排，网格就有几列。
             写成内联的 `repeat(n, minmax(0, 1fr))` 而不是 CSS 变量 —— `repeat()` 的计数
             不接受 `var()`（浏览器在解析期就要一个整数）。 */
          style={{ gridTemplateColumns: `repeat(${chain.layout.columnCount}, minmax(0, 1fr))` }}
        >
          {/* 线层：坐标是**量出来的**（节点的布局框中心），不是算出来的百分比。
              它 `aria-hidden`，因为每条边在下面的列表里另有一份完整的文字形态。 */}
          <svg className="sth-graph__edges" aria-hidden="true" focusable="false">
            {edgeLines.map((line) => (
              <line key={line.key} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
            ))}
          </svg>

          {chain.nodes.map((node) => (
            <GraphNode
              key={node.id}
              node={node}
              uncited={copy.noCitation}
              open={openEvidence}
              onToggle={toggleEvidence}
            />
          ))}
        </div>

        {chain.edgesNoneCitable ? (
          <p className="sth-graph__note" data-testid="graph-edges-note">{copy.edgesNote}</p>
        ) : null}

        {/* 边的**文字形态** —— 一根 SVG 线对屏幕阅读器不存在，所以每条边在这里说全：
            证据引用 + 两端标签 + 两端各自的角色。图形层因此可以是纯装饰。 */}
        <ul className="sth-graph__edge-list" data-testid="graph-edge-list">
          {chain.edges.map((edge) => {
            const from = byId.get(edge.from)
            const to = byId.get(edge.to)
            const open = openEvidence.includes(edge.evidenceRef)
            return (
              <li
                key={edgeKey(edge)}
                className="sth-graph__edge"
                data-testid="graph-edge"
                data-edge-from={edge.from}
                data-edge-to={edge.to}
                data-evidence-ref={edge.evidenceRef}
              >
                <EvidenceCite id={edge.evidenceRef} open={open} onToggle={() => toggleEvidence(edge.evidenceRef)} />
                <span className="sth-graph__edge-labels">
                  <span className="sth-graph__edge-end">
                    <code>{from?.label ?? edge.from}</code>
                    {edge.fromRole === null ? null : <span className="sth-graph__role">{edge.fromRole}</span>}
                  </span>
                  <span className="sth-graph__arrow" aria-hidden="true">→</span>
                  <span className="sth-graph__edge-end">
                    <code>{to?.label ?? edge.to}</code>
                    {edge.toRole === null ? null : <span className="sth-graph__role">{edge.toRole}</span>}
                  </span>
                </span>
                {open ? <EvidenceDetailBlock id={edge.evidenceRef} /> : null}
              </li>
            )
          })}
        </ul>

        {chain.attacker === null ? null : (
          <div className="sth-graph__profile" data-testid="graph-attacker">
            <span className="sth-graph__profile-title">{copy.attackerProfile}</span>
            <code data-testid="graph-attacker-label">{chain.attacker.label}</code>
            <span className="sth-graph__field">
              <span className="sth-field__name">{`${copy.fingerprint}：`}</span>
              <code data-testid="graph-fingerprint">{chain.attacker.fingerprint}</code>
            </span>
            <span className="sth-graph__field" data-testid="graph-fingerprint-matches">
              {copy.fingerprintMatches(chain.attacker.matches)}
            </span>
          </div>
        )}
      </div>
    </WorkbenchPanel>
  )
}

/** 一条边的稳定 key（两端 + 证据引用唯一确定一条边）。 */
function edgeKey(edge: AttackEdge): string {
  return `${edge.from}→${edge.to}·${edge.evidenceRef}`
}

/** 一条边在画布上的两个端点（布局框坐标，单位 px）。 */
type EdgeLine = { key: string; x1: number; y1: number; x2: number; y2: number }

/**
 * 量出每条边的两个端点 —— **坐标来自 DOM，不是来自算出来的百分比**。
 *
 * ## 为什么必须量
 *
 * 节点的宽高由它自己的内容决定（标签多长、状态词几个字、挂了几条证据 chip），
 * 而内容随游标变化。任何"先把坐标算好再让节点去对"的做法都要先知道宽高 ——
 * 那正是旧实现压在一起的原因（手写格子的间距与内容尺寸无关）。
 *
 * 所以顺序反过来：**浏览器先按网格把节点摆好**（网格保证同一排的列区间不相交），
 * 这里再读回每个节点的布局框，取中心画线。读的是 `offsetLeft/offsetTop`
 * 而不是 `getBoundingClientRect()`：画布整体被 scale-to-fit 缩过，
 * 后者给的是屏幕坐标，与 SVG 的用户单位（= CSS px）不在一个尺度上。
 *
 * ## 为什么不会抖动
 *
 * 每一次 `setEdgeLines` 之前先比字符串：布局没变就一个字节都不写回 state，
 * 于是 `ResizeObserver` 的回调不会自己把自己再触发一次。
 * 观测对象是画布**加**每一个节点 —— 画布高度会随行数变化，节点宽度会随列区间变化，
 * 两者都要覆盖到，否则线会停在上一次布局的位置上。
 */
function useEdgeLines(ref: RefObject<HTMLDivElement | null>, chain: AttackChain): EdgeLine[] {
  const [lines, setLines] = useState<EdgeLine[]>([])
  const lastSerialized = useRef("")

  useEffect(() => {
    const canvas = ref.current
    if (canvas === null) return

    const measure = () => {
      const nodes = Array.from(
        canvas.querySelectorAll<HTMLElement>('[data-testid="graph-node"]'),
      )
      const byId = new Map(nodes.map((node) => [node.getAttribute("data-node-id") ?? "", node]))
      const next: EdgeLine[] = []
      for (const edge of chain.edges) {
        const from = byId.get(edge.from)
        const to = byId.get(edge.to)
        if (from === undefined || to === undefined) continue
        next.push({
          key: edgeKey(edge),
          x1: from.offsetLeft + from.offsetWidth / 2,
          y1: from.offsetTop + from.offsetHeight / 2,
          x2: to.offsetLeft + to.offsetWidth / 2,
          y2: to.offsetTop + to.offsetHeight / 2,
        })
      }
      const serialized = JSON.stringify(next)
      if (serialized === lastSerialized.current) return
      lastSerialized.current = serialized
      setLines(next)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(canvas)
    for (const node of canvas.querySelectorAll('[data-testid="graph-node"]')) observer.observe(node)
    return () => observer.disconnect()
  }, [ref, chain])

  return lines
}

/**
 * 一个实体节点。
 *
 * 它**不是按钮**：点它没有动作可做，所以它只是一个可聚焦的组（`tabindex="0"`，键盘按 DOM
 * 顺序走过每一个节点 —— 「把画布读一遍」不依赖眼睛），名字就是里面那行可见文字。
 *
 * 落点写在 `grid-row` / `grid-column` 上（由 `attackChainLayout` 给出），
 * 而不是 `left/top` 百分比 + `translate(-50%, -50%)` —— 后者的居中位移会让
 * "落点不同"与"盒子不重叠"变成两件事。
 *
 * `data-meaning` 只落两个槽：`--brand` 只说「AI 正在控制它」，`--success` 只说「已经处理掉了」；
 * 其余状态词（已识别 / 未触及 / 0 异常 / 封禁中 / 定位完成）不借任何色槽 —— 给中性状态染色
 * 等于让同一个颜色说两件事。
 */
function GraphNode({
  node,
  uncited,
  open,
  onToggle,
}: {
  node: AttackNode
  /** `noCitation` 一句话（词典给），只有没引用的节点用得上。 */
  uncited: string
  open: string[]
  onToggle: (id: string) => void
}) {
  const cited = node.evidenceRefs.length > 0
  const meaning = node.state === "控制中" ? "ai" : node.state === "已清除" ? "closed" : undefined
  const opened = node.evidenceRefs.find((ref) => open.includes(ref))

  return (
    <div
      className="sth-graph__node"
      style={{
        gridRow: node.slot.rank + 1,
        gridColumn: `${node.slot.columnStart} / span ${node.slot.columnSpan}`,
      }}
      tabIndex={0}
      data-testid="graph-node"
      data-node-id={node.id}
      data-node-kind={node.kind}
      data-node-state={node.state}
      data-cited={cited ? "true" : "false"}
      data-state-changed={node.stateChanged ? "true" : "false"}
      data-meaning={meaning}
      data-rank={node.slot.rank}
      data-order={node.slot.order}
      data-column-start={node.slot.columnStart}
      data-column-span={node.slot.columnSpan}
    >
      {/*
       * 节点名是**记录内容**，不是界面文案：`webshell2.jsp` 是那个文件的真名，
       * 翻译它等于改名。按本仓已定的判据（`tests/support/localization.ts`：
       * 「代码里的命令 / ID / hash 放进 `<code>` / `<pre>`」）用 `<code>` 承载 ——
       * 于是它不会被当成漏翻的界面文案，同时屏幕上仍然可读。
       */}
      <code className="sth-graph__node-label">{node.label}</code>
      {/*
       * 状态词在染色时**必须同时声明它的含义** —— 状态词在 `data-meaning="ai"` / `"closed"`
       * 的节点里继承到那个语义色（`--brand` / `--success`），颜色在，"这是什么意思"也必须在。
       * 中性状态不借色，所以 `data-meaning` 与节点一致地缺席 —— 一色一义守的是
       * 「凡出现语义色处必有声明」，不是「每个元素都要挂一个」。
       */}
      <span className="sth-graph__node-state" data-meaning={meaning}>
        {node.state}
      </span>
      {node.detail === null ? null : <code className="sth-graph__node-detail">{node.detail}</code>}

      {/* 没有引用不是缺陷，是一句必须说出口的事实：不变量禁的是**假**引用，不是空引用。 */}
      {cited ? (
        <span className="sth-graph__cites">
          {node.evidenceRefs.map((ref) => (
            <EvidenceCite key={ref} id={ref} open={opened === ref} onToggle={() => onToggle(ref)} />
          ))}
        </span>
      ) : (
        <span className="sth-graph__uncited" data-testid="graph-no-citation">{uncited}</span>
      )}

      {opened === undefined ? null : <EvidenceDetailBlock id={opened} />}
    </div>
  )
}

/**
 * 证据引用 chip —— 真按钮，点开/收起那条证据自己的字段。措辞与 ③ 研判流的 chip 一致
 * （`证据#e-41 原始报文`）：同一个东西在整屏里只有一种写法。
 */
function EvidenceCite({
  id,
  open,
  onToggle,
}: {
  id: string
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className="sth-graph__cite"
      onClick={onToggle}
      aria-expanded={open}
      data-evidence-ref={id}
      data-testid="graph-evidence-cite"
      /* 证据蓝只表示一件事：这是一条可以点开的依据。颜色在，声明也在。 */
      data-meaning="evidence"
    >
      {`证据${id} ${evidenceDetailOf(id).label}`}
    </button>
  )
}

/**
 * 展开的证据字段。四行**没有行名** —— 它们是数据自己的四个字段（编号 / 种类 / 来源 / 指向），
 * 全部来自证据登记簿，一个字都不编；加行名就要为它们造四个词典键，而这四条不是界面文案。
 */
function EvidenceDetailBlock({ id }: { id: string }) {
  const detail = evidenceDetailOf(id)
  return (
    <span className="sth-graph__detail" data-testid="graph-evidence-detail">
      <code>{detail.id}</code>
      <code>{detail.kind}</code>
      <span>{detail.sourceLabel}</span>
      <span>{detail.entityLabels.join(" · ")}</span>
    </span>
  )
}
