// Distilled port of the EnhancedDOMTreeNode construction logic from
// browser_use/dom/service.py (`_construct_enhanced_node`).
//
// Source: https://github.com/browser-use/browser-use, main @ 8342696
//
// What we keep:
//  - DOM.getDocument → walk nodes → assemble EnhancedDOMTreeNode-shaped tree
//  - per-node AX lookup + snapshot lookup merge
//  - parent_node / children_nodes linkage (so children_and_shadow_roots works)
//  - shadow_roots if present
//
// What we don't yet handle (single-frame agent use case):
//  - cross-frame iframe content_document stitching
//  - per-frame target sessions
//  - js_click_listener detection (omitted; downstream is_interactive still
//    catches most cases via tag/role/ARIA)

import { NodeType } from './clickable_elements.js';

/**
 * Build EnhancedAXNode-shaped objects keyed by backendDOMNodeId.
 */
export function buildAxLookup(axTree) {
  const lookup = new Map();
  for (const node of axTree.nodes || []) {
    if (node.backendDOMNodeId == null) continue;
    lookup.set(node.backendDOMNodeId, {
      ax_node_id: node.nodeId,
      ignored: !!node.ignored,
      role: node.role?.value || null,
      name: node.name?.value || null,
      description: node.description?.value || null,
      properties: (node.properties || []).map((p) => ({
        name: p.name,
        value: p.value?.value,
      })),
      child_ids: node.childIds || null,
    });
  }
  return lookup;
}

/**
 * Distilled port of service.is_element_visible_according_to_all_parents
 * for the single-frame case (no iframe stitching).
 *
 * Returns true iff:
 *   - CSS visibility allows it (display !== none, visibility !== hidden,
 *     opacity > 0)
 *   - bounds exist and intersect (viewport ± threshold)
 */
export function isElementVisible(node, viewport, threshold = 1000) {
  const sn = node.snapshot_node;
  if (!sn) return false;
  const styles = sn.computed_styles || {};

  const display = (styles.display || '').toLowerCase();
  const visibility = (styles.visibility || '').toLowerCase();
  const opacity = parseFloat(styles.opacity ?? '1');

  if (display === 'none' || visibility === 'hidden') return false;
  if (opacity <= 0) return false;

  const bounds = sn.bounds;
  if (!bounds) return false;

  if (threshold == null) return true; // CSS-visible is enough

  // viewport is { width, height, scrollX, scrollY }
  const adjustedX = bounds.x - viewport.scrollX;
  const adjustedY = bounds.y - viewport.scrollY;
  const intersects =
    adjustedX < viewport.width + threshold &&
    adjustedX + bounds.width > -threshold &&
    adjustedY < viewport.height + threshold &&
    adjustedY + bounds.height > -threshold;

  return intersects;
}

/**
 * Walk a DOM.getDocument result and build a tree of EnhancedDOMTreeNode-shaped
 * objects. Merges in snapshot data + AX data per node.
 *
 * @param domRoot      The `root` from DOM.getDocument (pierce=true recommended).
 * @param snapshotLookup  Map<backendNodeId, EnhancedSnapshotNode>
 * @param axLookup     Map<backendNodeId, EnhancedAXNode>
 * @param viewport     { width, height, scrollX, scrollY } in CSS pixels.
 *                     If provided, is_visible is computed per-node.
 * @param viewportThreshold  Pixels beyond viewport to consider visible (default 1000).
 */
export function buildEnhancedTree(domRoot, snapshotLookup, axLookup, viewport = null, viewportThreshold = 1000) {
  function construct(node, parent) {
    // attributes is a flat alternating array [name, value, name, value, ...]
    const attrs = {};
    if (Array.isArray(node.attributes)) {
      for (let i = 0; i + 1 < node.attributes.length; i += 2) {
        attrs[String(node.attributes[i])] = String(node.attributes[i + 1]);
      }
    }

    const backendNodeId = node.backendNodeId;
    const snapshot = snapshotLookup.get(backendNodeId) || null;
    const ax = axLookup.get(backendNodeId) || null;
    const nodeName = node.nodeName || '';

    const enhanced = {
      node_id: node.nodeId,
      backend_node_id: backendNodeId,
      node_type: node.nodeType,
      node_name: nodeName,
      tag_name: nodeName.toLowerCase(),
      node_value: node.nodeValue || '',
      attributes: attrs,
      is_scrollable: node.isScrollable ?? null,
      is_visible: false, // filled in below if viewport is provided
      frame_id: node.frameId || null,
      content_document: null,
      shadow_root_type: node.shadowRootType || null,
      shadow_roots: null,
      parent_node: parent,
      children_nodes: null,
      ax_node: ax,
      snapshot_node: snapshot,
      has_js_click_listener: false,
      // Helper getter property for is_interactive
      get children_and_shadow_roots() {
        const out = [];
        if (this.children_nodes) out.push(...this.children_nodes);
        if (this.shadow_roots) out.push(...this.shadow_roots);
        return out;
      },
    };

    if (viewport) {
      enhanced.is_visible = isElementVisible(enhanced, viewport, viewportThreshold);
    }

    if (Array.isArray(node.children) && node.children.length > 0) {
      enhanced.children_nodes = node.children.map((c) => construct(c, enhanced));
    }

    if (Array.isArray(node.shadowRoots) && node.shadowRoots.length > 0) {
      enhanced.shadow_roots = node.shadowRoots.map((s) => construct(s, enhanced));
    }

    if (node.contentDocument) {
      enhanced.content_document = construct(node.contentDocument, enhanced);
    }

    return enhanced;
  }

  return construct(domRoot, null);
}

/**
 * Iterate every node in the enhanced tree (depth-first, including shadow
 * roots and iframe content documents).
 */
export function* walkTree(root) {
  yield root;
  for (const child of root.children_and_shadow_roots) {
    yield* walkTree(child);
  }
  if (root.content_document) {
    yield* walkTree(root.content_document);
  }
}

export { NodeType };
