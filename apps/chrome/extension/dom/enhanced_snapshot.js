// Port of browser_use/dom/enhanced_snapshot.py
// Source: https://github.com/browser-use/browser-use, main @ 8342696
//
// Parses CDP DOMSnapshot.captureSnapshot output into a per-backendNodeId
// lookup map of EnhancedSnapshotNode-shaped objects.

// Only the ESSENTIAL computed styles for interactivity and visibility detection.
export const REQUIRED_COMPUTED_STYLES = [
  'display',
  'visibility',
  'opacity',
  'overflow',
  'overflow-x',
  'overflow-y',
  'cursor',
  'pointer-events',
  'position',
  'background-color',
];

function parseRareBooleanData(rareDataSet, index) {
  return rareDataSet.has(index);
}

function parseComputedStyles(strings, styleIndices) {
  const styles = {};
  for (let i = 0; i < styleIndices.length; i++) {
    const styleIndex = styleIndices[i];
    if (i < REQUIRED_COMPUTED_STYLES.length && 0 <= styleIndex && styleIndex < strings.length) {
      styles[REQUIRED_COMPUTED_STYLES[i]] = strings[styleIndex];
    }
  }
  return styles;
}

/**
 * Build a lookup table: backendNodeId → EnhancedSnapshotNode-shaped object.
 *
 * @param snapshot  Result of DOMSnapshot.captureSnapshot CDP call.
 * @param devicePixelRatio  Used to convert device pixels → CSS pixels.
 * @returns Map<number, EnhancedSnapshotNode>
 */
export function buildSnapshotLookup(snapshot, devicePixelRatio = 1.0) {
  const lookup = new Map();
  if (!snapshot.documents || snapshot.documents.length === 0) return lookup;

  const strings = snapshot.strings;

  for (const document of snapshot.documents) {
    const nodes = document.nodes;
    const layout = document.layout;

    // Build backend node id → snapshot index lookup
    const backendNodeToSnapshotIndex = new Map();
    if (nodes.backendNodeId) {
      for (let i = 0; i < nodes.backendNodeId.length; i++) {
        backendNodeToSnapshotIndex.set(nodes.backendNodeId[i], i);
      }
    }

    // Pre-build layout index map: nodeIndex → layoutIdx (first occurrence wins).
    const layoutIndexMap = new Map();
    if (layout && layout.nodeIndex) {
      for (let layoutIdx = 0; layoutIdx < layout.nodeIndex.length; layoutIdx++) {
        const nodeIndex = layout.nodeIndex[layoutIdx];
        if (!layoutIndexMap.has(nodeIndex)) {
          layoutIndexMap.set(nodeIndex, layoutIdx);
        }
      }
    }

    // Pre-convert rare boolean data list → set for O(1) lookups.
    const hasClickableData = nodes.isClickable != null;
    const isClickableSet = hasClickableData
      ? new Set(nodes.isClickable.index || [])
      : new Set();

    for (const [backendNodeId, snapshotIndex] of backendNodeToSnapshotIndex) {
      let isClickable = null;
      if (hasClickableData) {
        isClickable = parseRareBooleanData(isClickableSet, snapshotIndex);
      }

      let cursorStyle = null;
      let boundingBox = null;
      let computedStyles = {};
      let paintOrder = null;
      let clientRects = null;
      let scrollRects = null;
      let stackingContexts = null;

      if (layoutIndexMap.has(snapshotIndex)) {
        const layoutIdx = layoutIndexMap.get(snapshotIndex);

        if (layoutIdx < (layout.bounds || []).length) {
          // CDP coordinates are in device pixels. Convert to CSS pixels.
          const bounds = layout.bounds[layoutIdx];
          if (bounds.length >= 4) {
            boundingBox = {
              x: bounds[0] / devicePixelRatio,
              y: bounds[1] / devicePixelRatio,
              width: bounds[2] / devicePixelRatio,
              height: bounds[3] / devicePixelRatio,
            };
          }

          if (layoutIdx < (layout.styles || []).length) {
            const styleIndices = layout.styles[layoutIdx];
            computedStyles = parseComputedStyles(strings, styleIndices);
            cursorStyle = computedStyles.cursor || null;
          }

          if (layout.paintOrders && layoutIdx < layout.paintOrders.length) {
            paintOrder = layout.paintOrders[layoutIdx];
          }

          const clientRectsData = layout.clientRects || [];
          if (layoutIdx < clientRectsData.length) {
            const cr = clientRectsData[layoutIdx];
            if (cr && cr.length >= 4) {
              clientRects = { x: cr[0], y: cr[1], width: cr[2], height: cr[3] };
            }
          }

          const scrollRectsData = layout.scrollRects || [];
          if (layoutIdx < scrollRectsData.length) {
            const sr = scrollRectsData[layoutIdx];
            if (sr && sr.length >= 4) {
              scrollRects = { x: sr[0], y: sr[1], width: sr[2], height: sr[3] };
            }
          }

          if (layout.stackingContexts && layoutIdx < (layout.stackingContexts.index || []).length) {
            stackingContexts = layout.stackingContexts.index[layoutIdx];
          }
        }
      }

      lookup.set(backendNodeId, {
        is_clickable: isClickable,
        cursor_style: cursorStyle,
        bounds: boundingBox,
        clientRects,
        scrollRects,
        computed_styles: Object.keys(computedStyles).length > 0 ? computedStyles : null,
        paint_order: paintOrder,
        stacking_contexts: stackingContexts,
      });
    }
  }

  return lookup;
}
