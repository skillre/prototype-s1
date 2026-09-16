/**
 * QA probe definitions.
 *
 * These live in their own module for one reason: so they can be **tested**.
 * A probe is a claim about how the browser behaves, and the only honest way to
 * test that claim is to run it in a real page against a DOM that exhibits the
 * defect. `tests/qa-probes.spec.ts` does exactly that.
 *
 * Every probe returns a plain JSON-serialisable value. None of them decide
 * pass/fail — the sweep does that, so the thresholds stay visible in one place.
 *
 * The style-presence probe lives next door in `./style-presence.mjs` rather than
 * here, because it is the one probe that cannot be interpreted alone: it is a
 * *differential* against a browser-default baseline rendered by the sweep, so it
 * ships with its comparator and its channel definitions.
 */

/**
 * Count elements that actually contribute semantics.
 *
 * Two subtleties, both learned the hard way:
 *
 * 1. **Shadow DOM.** `document.querySelectorAll` does not cross shadow
 *    boundaries, but the accessibility tree does. A shallow probe therefore
 *    reports a smaller count than the AX tree on any page containing a web
 *    component — which is exactly what happened here: `next dev` injects its
 *    dev-tools overlay inside `<nextjs-portal>`'s shadow root, and every route
 *    came back with "DOM n ≠ AX n+1". So the traversal descends recursively.
 *
 * 2. **What removes semantics, and how.** Four mechanisms, and they are not
 *    interchangeable:
 *      - `aria-hidden="true"`, `hidden`, `inert`, `display:none`,
 *        `visibility:hidden` prune the **whole subtree**.
 *      - `role="presentation"` / `role="none"` removes **only that node's own**
 *        semantics — and only when the browser honours it. Per ARIA, a role is
 *        ignored on elements whose native role cannot be overridden. Verified
 *        against Chromium:
 *          `<button role="presentation">` → still `button`
 *          `<a href role="presentation">` → still `link`
 *          `<h2 role="presentation">`     → no heading
 *        So presentation counts as removing semantics for headings but not for
 *        buttons and links. Treating it uniformly makes the probe disagree with
 *        the browser in one direction or the other — which is exactly the class
 *        of false mismatch this check exists to avoid.
 *
 * Framework dev overlays are skipped: they are not the application under test,
 * and the AX side excludes the same hosts so the two counts stay comparable.
 */
export const DOM_SEMANTIC_COUNT = (selector) => `(() => {
  const PRUNING_ROLES = ["presentation", "none"];
  const OVERLAY_TAGS = new Set(["nextjs-portal"]);

  const collectDeep = (root, out) => {
    for (const el of root.querySelectorAll("*")) {
      out.push(el);
      if (el.shadowRoot) collectDeep(el.shadowRoot, out);
    }
    return out;
  };

  const ancestors = (el) => {
    const chain = [];
    let node = el;
    while (node) {
      chain.push(node);
      if (node.parentElement) {
        node = node.parentElement;
      } else if (node.getRootNode && node.getRootNode().host) {
        node = node.getRootNode().host;
      } else {
        node = null;
      }
    }
    return chain;
  };

  const isOverlay = (el) =>
    ancestors(el).some((n) => n.tagName && OVERLAY_TAGS.has(n.tagName.toLowerCase()));

  /**
   * Elements whose native role cannot be overridden by role="presentation".
   * Mirrors the browser instead of the spec on paper.
   */
  const hasStrongNativeRole = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === "button" || tag === "input" || tag === "select" || tag === "textarea") return true;
    if (tag === "a" && el.hasAttribute("href")) return true;
    return false;
  };

  const pruned = (el) => {
    const ownRole = el.getAttribute && el.getAttribute("role");
    if (ownRole && PRUNING_ROLES.includes(ownRole) && !hasStrongNativeRole(el)) return true;
    for (const node of ancestors(el)) {
      if (node.nodeType !== 1) continue;
      if (node.getAttribute && node.getAttribute("aria-hidden") === "true") return true;
      if (node.hasAttribute && (node.hasAttribute("hidden") || node.hasAttribute("inert"))) return true;
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return true;
    }
    return false;
  };

  const candidates = collectDeep(document, []).filter((el) => el.matches(${JSON.stringify(selector)}));
  return candidates.filter((el) => !pruned(el) && !isOverlay(el)).length;
})()`

/**
 * Find `aria-hidden` / `inert` hosts that still contain real interactive content.
 *
 * This is the direct detector for the "No Invisible Semantics" failure class:
 * the page looks correct, every control is visible and clickable with a mouse,
 * and the whole region is missing from the accessibility tree.
 */
export const INVISIBLE_SEMANTICS_VIOLATIONS = `(() => {
  const violations = [];
  for (const host of document.querySelectorAll('[aria-hidden="true"], [inert]')) {
    const interactive = host.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"]'
    );
    if (interactive.length > 0) {
      violations.push({
        tag: host.tagName.toLowerCase(),
        testid: host.getAttribute("data-testid") || null,
        interactive: interactive.length,
      });
    }
  }
  return violations;
})()`

/** Layout metrics for the three mobile criteria. */
export const LAYOUT_PROBE = `(() => {
  const doc = document.documentElement;
  return {
    innerWidth: window.innerWidth,
    clientWidth: doc.clientWidth,
    scrollWidth: doc.scrollWidth,
    bodyScrollWidth: document.body ? document.body.scrollWidth : 0,
  };
})()`

/** Is real content actually visible, without depending on reveal animations? */
export const CONTENT_VISIBLE_PROBE = `(() => {
  const main = document.querySelector('main') || document.body;
  if (!main) return { height: 0, textLength: 0, fadedRoots: 0 };
  const rect = main.getBoundingClientRect();
  let fadedRoots = 0;
  for (const child of main.children) {
    const style = window.getComputedStyle(child);
    if (parseFloat(style.opacity) === 0 && child.textContent && child.textContent.trim().length > 0) {
      fadedRoots += 1;
    }
  }
  return {
    height: Math.round(rect.height),
    textLength: (main.innerText || "").trim().length,
    fadedRoots,
  };
})()`

/** Input-capability state, read from the same media queries the CSS uses. */
export const POINTER_PROBE = `(() => {
  const root = getComputedStyle(document.documentElement);
  return {
    coarse: window.matchMedia('(pointer: coarse)').matches,
    hoverNone: window.matchMedia('(hover: none)').matches,
    scale: parseFloat(root.getPropertyValue('--kits-grid-cell-scale')) || 0,
  };
})()`
