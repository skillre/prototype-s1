/**
 * Accessibility-tree role counting over CDP.
 *
 * `page.accessibility` was removed in Playwright 1.63, and a DOM-level guess is
 * not evidence — the entire point of the "No Invisible Semantics" check is that
 * the DOM and the accessibility tree *can disagree*. So we ask Chromium
 * directly.
 *
 * WHY OVERLAYS ARE FILTERED BY BACKEND NODE ID
 * --------------------------------------------
 * `next dev` injects its dev-tools UI into a `<nextjs-portal>` custom element,
 * inside a shadow root. Two things follow, and both were learned by getting them
 * wrong first:
 *
 *  1. `<nextjs-portal>` must be excluded, or every route reports a mismatch that
 *     has nothing to do with the application. The DOM-side probe excludes the
 *     same hosts, so both counts describe the same thing.
 *
 *  2. Excluding it by asking for its AX subtree does **not** work.
 *     `Accessibility.getPartialAXTree` on the host element returns the host node
 *     alone — one generic node, zero buttons — because the shadow content is a
 *     separate AX subtree. That failure mode is silent: the subtraction "runs",
 *     subtracts nothing, and the mismatch persists.
 *
 * So instead we walk the pierce-d DOM tree once, collect the backend node ids of
 * everything *inside* an overlay (host, descendants, shadow roots and their
 * descendants), and drop matching AX nodes from the full-tree count.
 */

/** Custom elements that belong to the framework's dev tooling, not the app. */
const OVERLAY_NODE_NAMES = new Set(["NEXTJS-PORTAL"])

/** Backend node ids belonging to framework dev overlays (incl. shadow subtrees). */
async function overlayBackendNodeIds(client) {
  const ids = new Set()
  const { root } = await client.send("DOM.getDocument", { depth: -1, pierce: true })

  const collect = (node, insideOverlay) => {
    const isOverlay = OVERLAY_NODE_NAMES.has((node.nodeName || "").toUpperCase())
    const nowInside = insideOverlay || isOverlay
    if (nowInside && node.backendNodeId !== undefined) ids.add(node.backendNodeId)
    for (const child of node.children ?? []) collect(child, nowInside)
    for (const shadow of node.shadowRoots ?? []) collect(shadow, nowInside)
    if (node.contentDocument) collect(node.contentDocument, nowInside)
  }

  collect(root, false)
  return ids
}

/**
 * @param {any} client CDP session (Playwright CDPSession). Typed loosely on
 *   purpose: this module is plain JS, and pinning a structural shape here would
 *   reject the real CDPSession.
 * @param {(message: string) => void} [onWarning] Called if overlay enumeration fails.
 * @returns {Promise<Map<string, number>>} role → count, overlays excluded.
 */
export async function accessibilityRoleCounts(client, onWarning) {
  const counts = new Map()
  const bump = (role, delta) => counts.set(role, (counts.get(role) ?? 0) + delta)

  const { nodes } = await client.send("Accessibility.getFullAXTree")

  let overlayIds = new Set()
  try {
    overlayIds = await overlayBackendNodeIds(client)
  } catch (error) {
    // Best-effort. If overlay enumeration fails we would report a false
    // mismatch, so say so instead of letting the numbers imply agreement.
    onWarning?.(`无障碍树框架浮层排除失败（计数可能偏高）：${error.message}`)
  }

  for (const node of nodes) {
    if (node.ignored || !node.role?.value) continue
    if (node.backendDOMNodeId !== undefined && overlayIds.has(node.backendDOMNodeId)) continue
    bump(node.role.value, 1)
  }

  return counts
}
