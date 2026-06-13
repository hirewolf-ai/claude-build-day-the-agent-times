// Port of browser_use/dom/serializer/paint_order.py
// Source: https://github.com/browser-use/browser-use, main @ 8342696
//
// Helper for maintaining a union of rectangles, used to detect when an
// element is fully covered by other elements painted on top.

/**
 * Closed axis-aligned rectangle with (x1,y1) bottom-left, (x2,y2) top-right.
 */
export class Rect {
  constructor(x1, y1, x2, y2) {
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
  }

  area() {
    return (this.x2 - this.x1) * (this.y2 - this.y1);
  }

  intersects(other) {
    return !(this.x2 <= other.x1 || other.x2 <= this.x1 || this.y2 <= other.y1 || other.y2 <= this.y1);
  }

  contains(other) {
    return this.x1 <= other.x1 && this.y1 <= other.y1 && this.x2 >= other.x2 && this.y2 >= other.y2;
  }
}

/**
 * Maintains a disjoint set of rectangles.
 * No external dependencies — fine for a few thousand rectangles.
 *
 * A safety cap (_MAX_RECTS) prevents exponential explosion on pages with
 * many overlapping translucent layers. Once the cap is hit, contains()
 * conservatively returns false (i.e. nothing is hidden), preserving
 * correctness at the cost of less aggressive paint-order filtering.
 */
export class RectUnionPure {
  constructor() {
    this._rects = [];
  }

  static _MAX_RECTS = 5000;

  /**
   * Return list of up to 4 rectangles = a \ b. Assumes a intersects b.
   */
  _splitDiff(a, b) {
    const parts = [];

    // Bottom slice
    if (a.y1 < b.y1) {
      parts.push(new Rect(a.x1, a.y1, a.x2, b.y1));
    }
    // Top slice
    if (b.y2 < a.y2) {
      parts.push(new Rect(a.x1, b.y2, a.x2, a.y2));
    }

    // Middle (vertical) strip: y overlap is [max(a.y1,b.y1), min(a.y2,b.y2)]
    const yLo = Math.max(a.y1, b.y1);
    const yHi = Math.min(a.y2, b.y2);

    // Left slice
    if (a.x1 < b.x1) {
      parts.push(new Rect(a.x1, yLo, b.x1, yHi));
    }
    // Right slice
    if (b.x2 < a.x2) {
      parts.push(new Rect(b.x2, yLo, a.x2, yHi));
    }

    return parts;
  }

  /**
   * True iff r is fully covered by the current union.
   */
  contains(r) {
    if (this._rects.length === 0) return false;

    let stack = [r];
    for (const s of this._rects) {
      const newStack = [];
      for (const piece of stack) {
        if (s.contains(piece)) {
          // piece completely gone
          continue;
        }
        if (piece.intersects(s)) {
          newStack.push(...this._splitDiff(piece, s));
        } else {
          newStack.push(piece);
        }
      }
      if (newStack.length === 0) return true; // everything eaten – covered
      stack = newStack;
    }
    return false; // something survived
  }

  /**
   * Insert r unless it is already covered.
   * Returns true if the union grew.
   */
  add(r) {
    if (this._rects.length >= RectUnionPure._MAX_RECTS) return false;
    if (this.contains(r)) return false;

    let pending = [r];
    let i = 0;
    while (i < this._rects.length) {
      const s = this._rects[i];
      const newPending = [];
      let changed = false;
      for (const piece of pending) {
        if (piece.intersects(s)) {
          newPending.push(...this._splitDiff(piece, s));
          changed = true;
        } else {
          newPending.push(piece);
        }
      }
      pending = newPending;
      i++;
      // note: s is unchanged; we always advance to the next existing rectangle
      void changed;
    }

    // Any left-over pieces are new, non-overlapping areas
    this._rects.push(...pending);
    return true;
  }
}

/**
 * Calculates which elements should be removed based on the paint order parameter.
 *
 * Walks paint order high→low. For each group of equal paint order, marks any
 * node fully covered by the running union as `ignored_by_paint_order = true`,
 * then adds the *opaque* ones (opacity ≥ 0.8 AND non-transparent background)
 * to the union for the next iteration.
 */
export class PaintOrderRemover {
  constructor(root) {
    this.root = root;
  }

  calculatePaintOrder() {
    const allSimplifiedNodesWithPaintOrder = [];

    const collectPaintOrder = (node) => {
      const sn = node.original_node?.snapshot_node;
      if (sn && sn.paint_order != null && sn.bounds != null) {
        allSimplifiedNodesWithPaintOrder.push(node);
      }
      for (const child of node.children) collectPaintOrder(child);
    };

    collectPaintOrder(this.root);

    // Group by paint order
    const groupedByPaintOrder = new Map();
    for (const node of allSimplifiedNodesWithPaintOrder) {
      const sn = node.original_node.snapshot_node;
      if (sn && sn.paint_order != null) {
        const list = groupedByPaintOrder.get(sn.paint_order) || [];
        list.push(node);
        groupedByPaintOrder.set(sn.paint_order, list);
      }
    }

    const rectUnion = new RectUnionPure();

    // Sort descending: high paint order first (front of stack)
    const sortedPaintOrders = [...groupedByPaintOrder.keys()].sort((a, b) => b - a);

    for (const paintOrder of sortedPaintOrders) {
      const nodes = groupedByPaintOrder.get(paintOrder);
      const rectsToAdd = [];

      for (const node of nodes) {
        const sn = node.original_node?.snapshot_node;
        if (!sn || !sn.bounds) continue; // shouldn't happen by how we filter above

        const rect = new Rect(
          sn.bounds.x,
          sn.bounds.y,
          sn.bounds.x + sn.bounds.width,
          sn.bounds.y + sn.bounds.height,
        );

        if (rectUnion.contains(rect)) {
          node.ignored_by_paint_order = true;
        }

        // Don't contribute to the union if visually translucent — those can't
        // hide things behind them.
        const styles = sn.computed_styles || {};
        const bg = styles['background-color'] || 'rgba(0, 0, 0, 0)';
        const opacity = parseFloat(styles['opacity'] ?? '1');
        if (bg === 'rgba(0, 0, 0, 0)' || opacity < 0.8) continue;

        rectsToAdd.push(rect);
      }

      for (const rect of rectsToAdd) rectUnion.add(rect);
    }
  }
}
