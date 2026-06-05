/**
 * Helpers for the 8-handle resize interaction on a rectangular selection.
 *
 * The selection store keeps cells as Set<"r,c"> plus an axis-aligned
 * bounding box (`selectionBounds`). Resize is only meaningful when the
 * selection is rectangular (its cells exactly cover its bounding box);
 * for irregular selections (e.g. wand-selected blobs) the handles must
 * not appear, since dragging would force a rect-ification the user did
 * not ask for.
 */

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** Max distance (px) from a handle center that still counts as a hit. */
export const RESIZE_HANDLE_HIT_PX = 8;

export interface Bounds {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export interface CanvasGeom {
  cellSize: number;
  offsetX: number;
  offsetY: number;
}

/** True iff the selection's cell set exactly covers its bounding rect. */
export function isRectangularSelection(
  selection: Set<string>,
  bounds: Bounds,
): boolean {
  const expected = (bounds.r2 - bounds.r1 + 1) * (bounds.c2 - bounds.c1 + 1);
  return selection.size === expected;
}

/**
 * Hit-test the 8 handles around `bounds`. `mouseX`/`mouseY` must be in
 * canvas-local pixel space (clientX/Y minus the container's bounding rect),
 * which matches the coordinate system used by renderResizeHandles.
 */
export function hitTestResizeHandle(
  mouseX: number,
  mouseY: number,
  bounds: Bounds,
  geom: CanvasGeom,
): ResizeHandle | null {
  const { cellSize, offsetX, offsetY } = geom;
  const x1 = bounds.c1 * cellSize + offsetX;
  const y1 = bounds.r1 * cellSize + offsetY;
  const x2 = (bounds.c2 + 1) * cellSize + offsetX;
  const y2 = (bounds.r2 + 1) * cellSize + offsetY;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;

  // Order matters: test corners before edges so a diagonal hover (e.g.
  // mouse halfway between E and SE) resolves to the corner. Corners are
  // the more useful target — they resize two edges at once.
  const candidates: Array<[number, number, ResizeHandle]> = [
    [x1, y1, "nw"], [x2, y1, "ne"], [x1, y2, "sw"], [x2, y2, "se"],
    [mx, y1, "n"],  [x1, my, "w"],  [x2, my, "e"],  [mx, y2, "s"],
  ];
  for (const [hx, hy, h] of candidates) {
    if (
      Math.abs(mouseX - hx) <= RESIZE_HANDLE_HIT_PX &&
      Math.abs(mouseY - hy) <= RESIZE_HANDLE_HIT_PX
    ) {
      return h;
    }
  }
  return null;
}

/** Which edges of the bounding box move when `handle` is dragged. */
export function edgesForHandle(handle: ResizeHandle): {
  top: boolean; right: boolean; bottom: boolean; left: boolean;
} {
  return {
    top: handle === "nw" || handle === "n" || handle === "ne",
    right: handle === "ne" || handle === "e" || handle === "se",
    bottom: handle === "sw" || handle === "s" || handle === "se",
    left: handle === "nw" || handle === "w" || handle === "sw",
  };
}

/** CSS cursor name for hovering / dragging a given handle. */
export function cursorForHandle(handle: ResizeHandle): string {
  return `${handle}-resize`;
}

/**
 * Given the bounds at drag-start (`anchor`), the handle being dragged, and
 * the current mouse cell, return the new bounds. Edges not driven by the
 * handle stay anchored. The mouse cell is clamped to the canvas. Flips are
 * allowed: dragging a corner past the opposite corner swaps the edges so
 * r1 ≤ r2 and c1 ≤ c2 always hold.
 */
export function computeResizedBounds(
  handle: ResizeHandle,
  anchor: Bounds,
  mouseRow: number,
  mouseCol: number,
  canvasSize: { width: number; height: number },
): Bounds {
  const edges = edgesForHandle(handle);
  const clampedRow = Math.max(0, Math.min(canvasSize.height - 1, mouseRow));
  const clampedCol = Math.max(0, Math.min(canvasSize.width - 1, mouseCol));

  let r1 = anchor.r1;
  let c1 = anchor.c1;
  let r2 = anchor.r2;
  let c2 = anchor.c2;
  if (edges.top) r1 = clampedRow;
  if (edges.bottom) r2 = clampedRow;
  if (edges.left) c1 = clampedCol;
  if (edges.right) c2 = clampedCol;

  if (r1 > r2) [r1, r2] = [r2, r1];
  if (c1 > c2) [c1, c2] = [c2, c1];

  return { r1, c1, r2, c2 };
}

/** Materialize a rectangle as a Set<"r,c"> for selection store consumption. */
export function cellsFromBounds(b: Bounds): Set<string> {
  const out = new Set<string>();
  for (let r = b.r1; r <= b.r2; r++) {
    for (let c = b.c1; c <= b.c2; c++) {
      out.add(`${r},${c}`);
    }
  }
  return out;
}
