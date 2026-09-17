"use client"

import { useState } from "react"

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
          <span className="s1-panel__subtitle" data-testid="graph-node-count">{chain.nodes.length}</span>
        )
      }
      status={status}
      errorMessage={errorMessage}
      onRetry={onRetry}
      emptyTitle={copy.empty}
      emptyNote={copy.emptyNote}
    >
      <div className="s1-graph" data-testid="attack-graph">
        <ul className="s1-graph__legend" data-testid="graph-legend">
          <li data-meaning="attack">
            <span className="s1-graph__legend-mark s1-graph__legend-mark--path" aria-hidden="true" />
            {copy.legend.attackPath}
          </li>
          <li data-meaning="ai">
            <span className="s1-graph__legend-mark s1-graph__legend-mark--controlled" aria-hidden="true" />
            {copy.legend.controlled}
          </li>
          <li data-meaning="closed">
            <span className="s1-graph__legend-mark s1-graph__legend-mark--closed" aria-hidden="true" />
            {copy.legend.closed}
          </li>
        </ul>

        {/* 节点的相对坐标（0–1）需要一个确定的盒子才落得下；这个盒子同时就是 SVG 的坐标系
            （viewBox 0 0 100 100 + preserveAspectRatio="none"），线端与节点中心是同一组数字。 */}
        <div className="s1-graph__canvas">
          <svg
            className="s1-graph__edges"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            {chain.edges.map((edge) => {
              const from = byId.get(edge.from)
              const to = byId.get(edge.to)
              if (from === undefined || to === undefined) return null
              return (
                <line
                  key={edgeKey(edge)}
                  x1={from.x * 100}
                  y1={from.y * 100}
                  x2={to.x * 100}
                  y2={to.y * 100}
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}
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
          <p className="s1-graph__note" data-testid="graph-edges-note">{copy.edgesNote}</p>
        ) : null}

        {/* 边的**文字形态** —— 一根 SVG 线对屏幕阅读器不存在，所以每条边在这里说全：
            证据引用 + 两端标签 + 两端各自的角色。图形层因此可以是纯装饰。 */}
        <ul className="s1-graph__edge-list" data-testid="graph-edge-list">
          {chain.edges.map((edge) => {
            const from = byId.get(edge.from)
            const to = byId.get(edge.to)
            const open = openEvidence.includes(edge.evidenceRef)
            return (
              <li
                key={edgeKey(edge)}
                className="s1-graph__edge"
                data-testid="graph-edge"
                data-edge-from={edge.from}
                data-edge-to={edge.to}
                data-evidence-ref={edge.evidenceRef}
              >
                <EvidenceCite id={edge.evidenceRef} open={open} onToggle={() => toggleEvidence(edge.evidenceRef)} />
                <span className="s1-graph__edge-labels">
                  <span className="s1-graph__edge-end">
                    <code>{from?.label ?? edge.from}</code>
                    {edge.fromRole === null ? null : <span className="s1-graph__role">{edge.fromRole}</span>}
                  </span>
                  <span className="s1-graph__arrow" aria-hidden="true">→</span>
                  <span className="s1-graph__edge-end">
                    <code>{to?.label ?? edge.to}</code>
                    {edge.toRole === null ? null : <span className="s1-graph__role">{edge.toRole}</span>}
                  </span>
                </span>
                {open ? <EvidenceDetailBlock id={edge.evidenceRef} /> : null}
              </li>
            )
          })}
        </ul>

        {chain.attacker === null ? null : (
          <div className="s1-graph__profile" data-testid="graph-attacker">
            <span className="s1-graph__profile-title">{copy.attackerProfile}</span>
            <code data-testid="graph-attacker-label">{chain.attacker.label}</code>
            <span className="s1-graph__field">
              <span className="s1-field__name">{`${copy.fingerprint}：`}</span>
              <code data-testid="graph-fingerprint">{chain.attacker.fingerprint}</code>
            </span>
            <span className="s1-graph__field" data-testid="graph-fingerprint-matches">
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

/**
 * 一个实体节点。
 *
 * 它**不是按钮**：点它没有动作可做，所以它只是一个可聚焦的组（`tabindex="0"`，键盘按 DOM
 * 顺序走过每一个节点 —— 「把画布读一遍」不依赖眼睛），名字就是里面那行可见文字。
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
      className="s1-graph__node"
      style={{ left: `${node.x * 100}%`, top: `${node.y * 100}%` }}
      tabIndex={0}
      data-testid="graph-node"
      data-node-id={node.id}
      data-node-kind={node.kind}
      data-node-state={node.state}
      data-cited={cited ? "true" : "false"}
      data-state-changed={node.stateChanged ? "true" : "false"}
      data-meaning={meaning}
    >
      {/*
       * 节点名是**记录内容**，不是界面文案：`webshell2.jsp` 是那个文件的真名，
       * 翻译它等于改名。按本仓已定的判据（`tests/support/localization.ts`：
       * 「代码里的命令 / ID / hash 放进 `<code>` / `<pre>`」）用 `<code>` 承载 ——
       * 于是它不会被当成漏翻的界面文案，同时屏幕上仍然可读。
       */}
      <code className="s1-graph__node-label">{node.label}</code>
      {/*
       * 状态词在染色时**必须同时声明它的含义** —— 状态词在 `data-meaning="ai"` / `"closed"`
       * 的节点里继承到那个语义色（`--brand` / `--success`），颜色在，"这是什么意思"也必须在。
       * 中性状态不借色，所以 `data-meaning` 与节点一致地缺席 —— 一色一义守的是
       * 「凡出现语义色处必有声明」，不是「每个元素都要挂一个」。
       */}
      <span className="s1-graph__node-state" data-meaning={meaning}>
        {node.state}
      </span>
      {node.detail === null ? null : <code className="s1-graph__node-detail">{node.detail}</code>}

      {/* 没有引用不是缺陷，是一句必须说出口的事实：不变量禁的是**假**引用，不是空引用。 */}
      {cited ? (
        <span className="s1-graph__cites">
          {node.evidenceRefs.map((ref) => (
            <EvidenceCite key={ref} id={ref} open={opened === ref} onToggle={() => onToggle(ref)} />
          ))}
        </span>
      ) : (
        <span className="s1-graph__uncited" data-testid="graph-no-citation">{uncited}</span>
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
      className="s1-graph__cite"
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
    <span className="s1-graph__detail" data-testid="graph-evidence-detail">
      <code>{detail.id}</code>
      <code>{detail.kind}</code>
      <span>{detail.sourceLabel}</span>
      <span>{detail.entityLabels.join(" · ")}</span>
    </span>
  )
}
