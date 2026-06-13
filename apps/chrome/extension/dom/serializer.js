// Distilled port of browser_use/dom/serializer/serializer.py
// Source: https://github.com/browser-use/browser-use, main @ 8342696
//
// Pipeline (matches the upstream order):
//   1. _create_simplified_tree  — wrap EnhancedDOMTreeNode tree with
//      SimplifiedNode, evaluate `is_interactive` per node.
//   2. PaintOrderRemover         — mark `ignored_by_paint_order` on covered
//      nodes.
//   3. serialize_tree            — depth-first text emit, indented by depth.
//
// What we drop from the original for v1:
//   - compound components (date pickers, range sliders, selects)
//   - _optimize_tree parent collapsing
//   - _apply_bounding_box_filtering parent containment
//   - scroll annotations on scrollable containers
//   - `*` "is_new since last step" diff markers
//
// These can be added incrementally if the output gets noisy on real pages.

import { isInteractive, NodeType } from './clickable_elements.js';
import { PaintOrderRemover } from './paint_order.js';
import { walkTree } from './tree_builder.js';

const DEFAULT_INCLUDE_ATTRIBUTES = ['type', 'name', 'placeholder', 'role', 'aria-label', 'title', 'href', 'value'];

// Configuration — elements that propagate bounds to their children.
// Ported verbatim from serializer.py PROPAGATING_ELEMENTS.
const PROPAGATING_ELEMENTS = [
  { tag: 'a', role: null },
  { tag: 'button', role: null },
  { tag: 'div', role: 'button' },
  { tag: 'div', role: 'combobox' },
  { tag: 'span', role: 'button' },
  { tag: 'span', role: 'combobox' },
  { tag: 'input', role: 'combobox' },
];

const DEFAULT_CONTAINMENT_THRESHOLD = 0.99;

/**
 * Wrap an EnhancedDOMTreeNode tree with SimplifiedNode envelopes, evaluating
 * is_interactive on the way down. Skips obviously-irrelevant subtrees (script,
 * style, head).
 *
 * Returns the SimplifiedNode root.
 */
function createSimplifiedTree(root) {
  function wrap(node) {
    if (!node) return null;

    // Drop noise tags wholesale — we never want them in agent output.
    const tag = node.tag_name;
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'meta' || tag === 'link' || tag === 'head') {
      return null;
    }

    const simplified = {
      original_node: node,
      children: [],
      should_display: true,
      is_interactive: false,
      ignored_by_paint_order: false,
      excluded_by_parent: false,
      is_shadow_host: false,
      is_compound_component: false,
    };

    // Only ELEMENT_NODE can be interactive (per upstream contract).
    if (node.node_type === NodeType.ELEMENT_NODE) {
      simplified.is_interactive = isInteractive(node);
    }

    // Mark shadow hosts.
    if (node.shadow_roots && node.shadow_roots.length > 0) {
      simplified.is_shadow_host = true;
    }

    // Recurse into children + shadow roots + content document.
    const kids = node.children_and_shadow_roots || [];
    for (const child of kids) {
      const childSimplified = wrap(child);
      if (childSimplified) simplified.children.push(childSimplified);
    }
    if (node.content_document) {
      const cd = wrap(node.content_document);
      if (cd) simplified.children.push(cd);
    }

    return simplified;
  }

  return wrap(root);
}

/**
 * HTML-escape a value for inclusion in our attributes="…" strings.
 */
function escAttr(value) {
  return String(value).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Build an attributes="…" string for the line, limited to a small whitelist.
 */
function buildAttributesString(node, include = DEFAULT_INCLUDE_ATTRIBUTES) {
  const out = [];
  for (const k of include) {
    const v = node.attributes?.[k];
    if (v == null || v === '') continue;
    const trimmed = String(v).slice(0, 100);
    out.push(`${k}="${escAttr(trimmed)}"`);
  }
  return out.join(' ');
}

/**
 * Extract the visible text of a node (concatenation of direct text children).
 */
function directText(node) {
  let buf = '';
  for (const c of node.children_nodes || []) {
    if (c.node_type === NodeType.TEXT_NODE && c.node_value) {
      buf += ' ' + c.node_value.trim();
    }
  }
  // Also use AX name if no text content was found.
  const txt = buf.trim();
  if (txt) return txt.replace(/\s+/g, ' ').slice(0, 160);
  return (node.ax_node?.name || '').trim().slice(0, 160);
}

/**
 * Serialize a SimplifiedNode tree to indented text.
 *
 * Returns { text, selectorMap } where selectorMap maps interactive index →
 * the underlying EnhancedDOMTreeNode for click/type resolution.
 */
function serializeTree(root, options = {}) {
  const include = options.include_attributes || DEFAULT_INCLUDE_ATTRIBUTES;
  const lines = [];

  function emit(node, depth) {
    if (!node) return;
    if (node.excluded_by_parent || node.ignored_by_paint_order) {
      // Skip the line itself but still process children.
      for (const child of node.children) emit(child, depth);
      return;
    }

    const orig = node.original_node;

    if (orig.node_type === NodeType.ELEMENT_NODE) {
      if (!node.should_display) {
        for (const child of node.children) emit(child, depth);
        return;
      }

      // Decide if we want to render a line for this node.
      const tag = orig.tag_name;
      const isIframe = tag === 'iframe' || tag === 'frame';
      const wantsLine = node.is_interactive || isIframe;

      if (wantsLine) {
        const depthStr = '\t'.repeat(depth);
        const shadowPrefix = node.is_shadow_host ? '|SHADOW(open)|' : '';

        let line;
        if (node.is_interactive) {
          line = `${depthStr}${shadowPrefix}[${orig.backend_node_id}]<${tag}`;
        } else if (isIframe) {
          line = `${depthStr}${shadowPrefix}|IFRAME|<${tag}`;
        }

        const attrs = buildAttributesString(orig, include);
        if (attrs) line += ` ${attrs}`;
        line += ' />';

        const text = directText(orig);
        if (text) line += ` ${text}`;
        lines.push(line);

        // Children indented one more.
        for (const child of node.children) emit(child, depth + 1);
        return;
      }

      // Non-interactive element — recurse without emitting a line.
      for (const child of node.children) emit(child, depth);
      return;
    }

    if (orig.node_type === NodeType.DOCUMENT_FRAGMENT_NODE) {
      const isClosed = orig.shadow_root_type?.toLowerCase() === 'closed';
      lines.push(`${'\t'.repeat(depth)}${isClosed ? 'Closed Shadow' : 'Open Shadow'}`);
      for (const child of node.children) emit(child, depth + 1);
      return;
    }

    // Text and other nodes are inlined via directText on their parents; skip.
  }

  emit(root, 0);
  return lines.join('\n');
}

/**
 * Build a selector map: backendNodeId → enhanced node, for every is_interactive
 * node that survived filtering.
 */
function buildSelectorMap(root) {
  const map = new Map();
  function visit(node) {
    if (!node) return;
    if (
      !node.excluded_by_parent &&
      !node.ignored_by_paint_order &&
      node.is_interactive &&
      node.should_display
    ) {
      map.set(node.original_node.backend_node_id, node.original_node);
    }
    for (const child of node.children) visit(child);
  }
  visit(root);
  return map;
}

/**
 * Step 2: Optimize tree structure.
 * Port of DOMTreeSerializer._optimize_tree.
 *
 * Walks bottom-up. Drops nodes that aren't visible, not scrollable, not text,
 * have no children left, and aren't file inputs. The kept nodes become the
 * meaningful skeleton of the page.
 */
function optimizeTree(node) {
  if (!node) return null;

  const optimizedChildren = [];
  for (const child of node.children) {
    const opt = optimizeTree(child);
    if (opt) optimizedChildren.push(opt);
  }
  node.children = optimizedChildren;

  const orig = node.original_node;
  const isVisible = orig.snapshot_node && orig.is_visible;
  const isFileInput =
    orig.tag_name === 'input' &&
    orig.attributes &&
    orig.attributes.type === 'file';
  const isScrollable = !!orig.is_scrollable;

  if (
    isVisible ||
    isScrollable ||
    orig.node_type === NodeType.TEXT_NODE ||
    node.children.length > 0 ||
    isFileInput
  ) {
    return node;
  }
  return null;
}

/**
 * Step 3: Apply bounding-box filtering.
 *
 * Propagates the bounds of "propagating elements" (a, button, combobox...) to
 * all descendants. Children whose bounds are ≥99% contained inside an
 * ancestor's propagating bounds are marked excluded_by_parent — except form
 * elements, things with onclick, things with aria-label, or things with an
 * interactive role.
 *
 * Distilled port of DOMTreeSerializer._apply_bounding_box_filtering.
 */
function isPropagatingElement(attributes) {
  for (const pattern of PROPAGATING_ELEMENTS) {
    const tagOk = pattern.tag == null || pattern.tag === attributes.tag;
    const roleOk = pattern.role == null || pattern.role === attributes.role;
    if (tagOk && roleOk) return true;
  }
  return false;
}

function isContained(child, parent, threshold) {
  const xOverlap = Math.max(0, Math.min(child.x + child.width, parent.x + parent.width) - Math.max(child.x, parent.x));
  const yOverlap = Math.max(0, Math.min(child.y + child.height, parent.y + parent.height) - Math.max(child.y, parent.y));
  const intersection = xOverlap * yOverlap;
  const childArea = child.width * child.height;
  if (childArea === 0) return false;
  return intersection / childArea >= threshold;
}

function shouldExcludeChild(node, activeBounds, containmentThreshold) {
  // Never exclude text nodes — text content is always wanted.
  if (node.original_node.node_type === NodeType.TEXT_NODE) return false;

  const sn = node.original_node.snapshot_node;
  if (!sn || !sn.bounds) return false; // no bounds → can't tell

  if (!isContained(sn.bounds, activeBounds.bounds, containmentThreshold)) return false;

  // EXCEPTION RULES — keep these even if contained:

  const tag = node.original_node.tag_name;
  const attrs = node.original_node.attributes || {};

  // 1. Form elements — they need individual interaction
  if (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'label') return false;

  // 2. Child is itself a propagating element (e.g. button-in-button with stopPropagation)
  if (isPropagatingElement({ tag, role: attrs.role || null })) return false;

  // 3. Has explicit onclick handler
  if (attrs.onclick) return false;

  // 4. Has meaningful aria-label
  if (attrs['aria-label'] && attrs['aria-label'].trim()) return false;

  // 5. Has an interactive role
  const role = attrs.role;
  if (role && ['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'option'].includes(role)) return false;

  return true;
}

function applyBoundingBoxFiltering(node, containmentThreshold = DEFAULT_CONTAINMENT_THRESHOLD) {
  if (!node) return null;
  filterTreeRecursive(node, null, 0, containmentThreshold);
  return node;
}

function filterTreeRecursive(node, activeBounds, depth, containmentThreshold) {
  if (activeBounds && shouldExcludeChild(node, activeBounds, containmentThreshold)) {
    node.excluded_by_parent = true;
  }

  // Does this node start NEW propagation? (computed even if excluded — the
  // node still propagates its own bounds to children.)
  let newBounds = null;
  const tag = node.original_node.tag_name;
  const role = node.original_node.attributes?.role || null;
  if (isPropagatingElement({ tag, role })) {
    const sn = node.original_node.snapshot_node;
    if (sn && sn.bounds) {
      newBounds = { tag, bounds: sn.bounds, node_id: node.original_node.node_id, depth };
    }
  }

  const propagateBounds = newBounds || activeBounds;
  for (const child of node.children) {
    filterTreeRecursive(child, propagateBounds, depth + 1, containmentThreshold);
  }
}

/**
 * Top-level: take an EnhancedDOMTreeNode root, return { text, selectorMap }.
 */
export function serializeAccessibleElements(rootEnhanced, options = {}) {
  const simplified = createSimplifiedTree(rootEnhanced);
  if (!simplified) return { text: '', selectorMap: new Map() };

  // Step 1.5: paint-order overlay filter (marks ignored_by_paint_order).
  if (options.paint_order_filtering !== false) {
    new PaintOrderRemover(simplified).calculatePaintOrder();
  }

  // Step 2: drop noise nodes (not visible, not scrollable, no children).
  let optimized = simplified;
  if (options.optimize !== false) {
    optimized = optimizeTree(simplified);
    if (!optimized) return { text: '', selectorMap: new Map() };
  }

  // Step 3: bbox containment filter (marks excluded_by_parent on children
  // fully covered by a propagating parent like <a> or <button>).
  if (options.bbox_filtering !== false) {
    applyBoundingBoxFiltering(optimized, options.containment_threshold ?? DEFAULT_CONTAINMENT_THRESHOLD);
  }

  const text = serializeTree(optimized, options);
  const selectorMap = buildSelectorMap(optimized);
  return { text, selectorMap };
}
