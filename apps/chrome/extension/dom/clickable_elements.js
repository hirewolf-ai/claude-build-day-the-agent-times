// Port of browser_use/dom/serializer/clickable_elements.py
// Source: https://github.com/browser-use/browser-use, main @ 8342696
//
// Pure function: given an EnhancedDOMTreeNode-shaped object, decide whether
// it should appear in the LLM's "clickable" list.
//
// The input shape:
//   {
//     node_type: number,        // 1=ELEMENT, 3=TEXT, etc. (browser DOM spec)
//     node_name: string,        // tag name as Chrome reports it (e.g. "BUTTON")
//     tag_name: string,         // lowercase tag (e.g. "button")
//     attributes: { [k: string]: string },
//     children_and_shadow_roots: Node[],
//     has_js_click_listener: boolean,
//     ax_node?: {
//       role?: string,
//       properties?: Array<{ name: string, value: any }>,
//     },
//     snapshot_node?: {
//       bounds?: { x, y, width, height },
//       cursor_style?: string,
//     },
//   }

export const NodeType = {
  ELEMENT_NODE: 1,
  ATTRIBUTE_NODE: 2,
  TEXT_NODE: 3,
  CDATA_SECTION_NODE: 4,
  PROCESSING_INSTRUCTION_NODE: 7,
  COMMENT_NODE: 8,
  DOCUMENT_NODE: 9,
  DOCUMENT_TYPE_NODE: 10,
  DOCUMENT_FRAGMENT_NODE: 11,
};

const INTERACTIVE_TAGS = new Set([
  'button', 'input', 'select', 'textarea', 'a', 'details', 'summary', 'option', 'optgroup',
]);

const INTERACTIVE_ATTRIBUTES = new Set([
  'onclick', 'onmousedown', 'onmouseup', 'onkeydown', 'onkeyup', 'tabindex',
]);

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'menuitem', 'option', 'radio', 'checkbox', 'tab',
  'textbox', 'combobox', 'slider', 'spinbutton', 'search', 'searchbox',
  'row', 'cell', 'gridcell',
]);

const INTERACTIVE_AX_ROLES = new Set([
  'button', 'link', 'menuitem', 'option', 'radio', 'checkbox', 'tab',
  'textbox', 'combobox', 'slider', 'spinbutton', 'listbox', 'search',
  'searchbox', 'row', 'cell', 'gridcell',
]);

const SEARCH_INDICATORS = [
  'search', 'magnify', 'glass', 'lookup', 'find', 'query',
  'search-icon', 'search-btn', 'search-button', 'searchbox',
];

const ICON_ATTRIBUTES = new Set(['class', 'role', 'onclick', 'data-action', 'aria-label']);

/**
 * Detect nested form controls within limited depth (handles label/span wrappers).
 */
function hasFormControlDescendant(element, maxDepth = 2) {
  if (maxDepth <= 0) return false;
  for (const child of element.children_and_shadow_roots || []) {
    if (child.node_type !== NodeType.ELEMENT_NODE) continue;
    const tag = child.tag_name;
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return true;
    if (hasFormControlDescendant(child, maxDepth - 1)) return true;
  }
  return false;
}

/**
 * Check if this node is clickable/interactive using enhanced scoring.
 */
export function isInteractive(node) {
  // Skip non-element nodes
  if (node.node_type !== NodeType.ELEMENT_NODE) return false;

  // Remove html and body nodes
  if (node.tag_name === 'html' || node.tag_name === 'body') return false;

  // Check for JavaScript click event listeners detected via CDP.
  // Handles Vue @click, React onClick, Angular (click), etc.
  if (node.has_js_click_listener) return true;

  // IFRAME — interactive if large enough to potentially need scrolling.
  if (node.tag_name && (node.tag_name.toUpperCase() === 'IFRAME' || node.tag_name.toUpperCase() === 'FRAME')) {
    const bounds = node.snapshot_node?.bounds;
    if (bounds && bounds.width > 100 && bounds.height > 100) return true;
  }

  // Specialized handling for label wrappers.
  if (node.tag_name === 'label') {
    // Skip labels that proxy via "for" — clicking them would double-activate the input.
    if (node.attributes && node.attributes.for) return false;
    if (hasFormControlDescendant(node, 2)) return true;
    // Fall through to pointer/role/attribute heuristics
  }

  // Span wrappers for UI components.
  if (node.tag_name === 'span') {
    if (hasFormControlDescendant(node, 2)) return true;
    // Fall through
  }

  // SEARCH ELEMENT DETECTION: classes, ids, data-* hinting "search"
  if (node.attributes) {
    const classStr = (node.attributes.class || '').toLowerCase();
    if (SEARCH_INDICATORS.some((ind) => classStr.includes(ind))) return true;
    const idStr = (node.attributes.id || '').toLowerCase();
    if (SEARCH_INDICATORS.some((ind) => idStr.includes(ind))) return true;
    for (const [k, v] of Object.entries(node.attributes)) {
      if (k.startsWith('data-')) {
        const vLow = String(v || '').toLowerCase();
        if (SEARCH_INDICATORS.some((ind) => vLow.includes(ind))) return true;
      }
    }
  }

  // AX property checks — direct interactiveness indicators.
  if (node.ax_node && Array.isArray(node.ax_node.properties)) {
    for (const prop of node.ax_node.properties) {
      try {
        if (prop.name === 'disabled' && prop.value) return false;
        if (prop.name === 'hidden' && prop.value) return false;

        // Direct interactiveness
        if ((prop.name === 'focusable' || prop.name === 'editable' || prop.name === 'settable') && prop.value) return true;

        // Interactive state properties (presence ≈ interactive widget)
        if (prop.name === 'checked' || prop.name === 'expanded' || prop.name === 'pressed' || prop.name === 'selected') return true;

        if ((prop.name === 'required' || prop.name === 'autocomplete') && prop.value) return true;

        if (prop.name === 'keyshortcuts' && prop.value) return true;
      } catch {
        // skip
      }
    }
  }

  // Enhanced tag check.
  if (node.tag_name && INTERACTIVE_TAGS.has(node.tag_name.toLowerCase())) return true;

  // Tertiary: interactive attributes.
  if (node.attributes) {
    for (const attr of Object.keys(node.attributes)) {
      if (INTERACTIVE_ATTRIBUTES.has(attr)) return true;
    }
    if (node.attributes.role && INTERACTIVE_ROLES.has(node.attributes.role)) return true;
  }

  // Quaternary: AX role.
  if (node.ax_node && node.ax_node.role && INTERACTIVE_AX_ROLES.has(node.ax_node.role)) return true;

  // Icon-sized element check: 10-50px with interactive attributes/aria.
  const bounds = node.snapshot_node?.bounds;
  if (bounds && 10 <= bounds.width && bounds.width <= 50 && 10 <= bounds.height && bounds.height <= 50) {
    if (node.attributes) {
      for (const attr of Object.keys(node.attributes)) {
        if (ICON_ATTRIBUTES.has(attr)) return true;
      }
    }
  }

  // Final fallback: cursor: pointer indicates clickability.
  if (node.snapshot_node && node.snapshot_node.cursor_style === 'pointer') return true;

  return false;
}
