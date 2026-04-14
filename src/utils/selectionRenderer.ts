import type { CanvasCell } from "../types";
import { MARD_COLORS } from "../data/mard221";

/**
 * Render marching ants border around selected cells.
 * Draws dashed lines on edges between selected and non-selected cells.
 */
export function renderMarchingAnts(
  ctx: CanvasRenderingContext2D,
  selection: Set<string>,
  cellSize: number,
  offsetX: number,
  offsetY: number,
  dashOffset: number,
): void {
  ctx.save();
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.lineDashOffset = dashOffset;

  for (const key of selection) {
    const [r, c] = key.split(",").map(Number);
    const x = c * cellSize + offsetX;
    const y = r * cellSize + offsetY;

    if (!selection.has(`${r - 1},${c}`)) {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + cellSize, y); ctx.stroke();
    }
    if (!selection.has(`${r + 1},${c}`)) {
      ctx.beginPath(); ctx.moveTo(x, y + cellSize); ctx.lineTo(x + cellSize, y + cellSize); ctx.stroke();
    }
    if (!selection.has(`${r},${c - 1}`)) {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + cellSize); ctx.stroke();
    }
    if (!selection.has(`${r},${c + 1}`)) {
      ctx.beginPath(); ctx.moveTo(x + cellSize, y); ctx.lineTo(x + cellSize, y + cellSize); ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * Render resize handles at corners and edge midpoints of bounding box.
 */
export function renderResizeHandles(
  ctx: CanvasRenderingContext2D,
  bounds: { r1: number; c1: number; r2: number; c2: number },
  cellSize: number,
  offsetX: number,
  offsetY: number,
): void {
  const x1 = bounds.c1 * cellSize + offsetX;
  const y1 = bounds.r1 * cellSize + offsetY;
  const x2 = (bounds.c2 + 1) * cellSize + offsetX;
  const y2 = (bounds.r2 + 1) * cellSize + offsetY;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const s = 5;

  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;

  const handles = [
    [x1, y1], [mx, y1], [x2, y1],
    [x1, my],           [x2, my],
    [x1, y2], [mx, y2], [x2, y2],
  ];
  for (const [hx, hy] of handles) {
    ctx.fillRect(hx - s, hy - s, s * 2, s * 2);
    ctx.strokeRect(hx - s, hy - s, s * 2, s * 2);
  }
}

/**
 * Render floating selection cells as semi-transparent overlay.
 */
export function renderFloatingSelection(
  ctx: CanvasRenderingContext2D,
  cells: Map<string, CanvasCell>,
  offsetRow: number,
  offsetCol: number,
  cellSize: number,
  canvasOffsetX: number,
  canvasOffsetY: number,
): void {
  ctx.save();
  ctx.globalAlpha = 0.7;
  for (const [key, cell] of cells) {
    if (cell.colorIndex === null) continue;
    const [lr, lc] = key.split(",").map(Number);
    const r = lr + offsetRow;
    const c = lc + offsetCol;
    const x = c * cellSize + canvasOffsetX;
    const y = r * cellSize + canvasOffsetY;
    const color = MARD_COLORS[cell.colorIndex];
    ctx.fillStyle = color?.hex || "#FF00FF";
    ctx.fillRect(x, y, cellSize, cellSize);
  }
  ctx.restore();
}
