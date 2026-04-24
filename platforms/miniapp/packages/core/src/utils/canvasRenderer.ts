import { getEffectiveColor, type ColorOverrideMap } from "./colorHelper";
import type { CanvasData, GridConfig } from "../types";

export interface RenderOptions {
  canvasData: CanvasData;
  cellSize: number;
  offsetX: number;
  offsetY: number;
  viewWidth: number;
  viewHeight: number;
  highlightColorIndex?: number | null;
  blueprintMode?: boolean;
  textOnly?: boolean;
  mirror?: boolean;
  colorOverrides?: ColorOverrideMap;
}

/** Compute contrasting text color */
function textLum(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Render pixel cells onto a canvas 2D context.
 * Only draws cells visible in the viewport for performance.
 */
export function renderPixels(
  ctx: CanvasRenderingContext2D,
  opts: RenderOptions
): void {
  const { canvasData, cellSize, offsetX, offsetY, viewWidth, viewHeight, highlightColorIndex, blueprintMode, textOnly, mirror, colorOverrides } = opts;
  const overrides = colorOverrides || new Map();
  const rows = canvasData.length;
  const cols = rows > 0 ? canvasData[0].length : 0;
  const hasHighlight = highlightColorIndex !== null && highlightColorIndex !== undefined;

  // Calculate visible cell range
  const startCol = Math.max(0, Math.floor(-offsetX / cellSize));
  const startRow = Math.max(0, Math.floor(-offsetY / cellSize));
  const endCol = Math.min(cols, Math.ceil((viewWidth - offsetX) / cellSize));
  const endRow = Math.min(rows, Math.ceil((viewHeight - offsetY) / cellSize));

  for (let row = startRow; row < endRow; row++) {
    for (let col = startCol; col < endCol; col++) {
      const srcCol = mirror ? (cols - 1 - col) : col;
      const x = col * cellSize + offsetX;
      const y = row * cellSize + offsetY;
      const cell = canvasData[row][srcCol];

      if (cell.colorIndex !== null) {
        const color = getEffectiveColor(cell.colorIndex, overrides);

        if (!textOnly) {
          ctx.fillStyle = color.hex || "#FF00FF";
          ctx.fillRect(x, y, cellSize, cellSize);

          // Blueprint mode: draw cell border
          if (blueprintMode) {
            ctx.strokeStyle = "rgba(0,0,0,0.15)";
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, cellSize, cellSize);
          }

          // Dim non-highlighted cells
          if (hasHighlight && cell.colorIndex !== highlightColorIndex) {
            ctx.fillStyle = "rgba(255,255,255,0.7)";
            ctx.fillRect(x, y, cellSize, cellSize);
          }
        }

        // Blueprint text (drawn in both normal blueprint and textOnly mode)
        if ((blueprintMode || textOnly) && cellSize >= 16) {
          const fontSize = Math.max(7, Math.min(cellSize * 0.32, 14));
          ctx.font = `${fontSize}px "Segoe UI", Arial, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = textLum(color.hex || "#FFF") > 140 ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.95)";
          ctx.fillText(color.code, x + cellSize / 2, y + cellSize / 2, cellSize - 2);
        }
      }
      // Empty cells are transparent (no fill)
    }
  }

  // Draw highlight outlines — only draw edges where adjacent cell is NOT the same highlighted color
  if (hasHighlight) {
    ctx.strokeStyle = "rgba(230,80,80,0.5)";
    ctx.lineWidth = 2;
    for (let row = startRow; row < endRow; row++) {
      for (let col = startCol; col < endCol; col++) {
        const srcCol = mirror ? (cols - 1 - col) : col;
        const cell = canvasData[row][srcCol];
        if (cell.colorIndex !== highlightColorIndex) continue;

        const x = col * cellSize + offsetX;
        const y = row * cellSize + offsetY;

        // Top edge: draw if row above is not same color
        const above = row > 0 ? canvasData[row - 1][srcCol]?.colorIndex : null;
        if (above !== highlightColorIndex) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + cellSize, y);
          ctx.stroke();
        }
        // Bottom edge
        const below = row < rows - 1 ? canvasData[row + 1][srcCol]?.colorIndex : null;
        if (below !== highlightColorIndex) {
          ctx.beginPath();
          ctx.moveTo(x, y + cellSize);
          ctx.lineTo(x + cellSize, y + cellSize);
          ctx.stroke();
        }
        // Left edge
        const left = srcCol > 0 && srcCol < cols ? canvasData[row][mirror ? srcCol - 1 : col - 1]?.colorIndex : null;
        if (left !== highlightColorIndex) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + cellSize);
          ctx.stroke();
        }
        // Right edge
        const right = srcCol >= 0 && srcCol < cols - 1 ? canvasData[row][mirror ? srcCol + 1 : col + 1]?.colorIndex : null;
        if (right !== highlightColorIndex) {
          ctx.beginPath();
          ctx.moveTo(x + cellSize, y);
          ctx.lineTo(x + cellSize, y + cellSize);
          ctx.stroke();
        }
      }
    }
  }
}

/**
 * Render grid lines on overlay canvas.
 * Normal grid lines (1px light gray) + thick group lines every groupSize cells.
 */
export function renderGrid(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  cellSize: number,
  offsetX: number,
  offsetY: number,
  viewWidth: number,
  viewHeight: number,
  gridConfig: GridConfig
): void {
  ctx.clearRect(0, 0, viewWidth, viewHeight);

  if (!gridConfig.visible) return;

  const { groupSize, edgePadding, lineColor, lineWidth, groupLineColor, groupLineWidth } = gridConfig;
  const totalCols = canvasWidth;
  const totalRows = canvasHeight;

  // Use configured edge padding
  const edgePaddingX = edgePadding;
  const edgePaddingY = edgePadding;

  // Draw thin cell borders
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();

  for (let col = 0; col <= totalCols; col++) {
    const x = Math.round(col * cellSize + offsetX) + 0.5;
    if (x >= 0 && x <= viewWidth) {
      ctx.moveTo(x, Math.max(0, offsetY));
      ctx.lineTo(x, Math.min(viewHeight, totalRows * cellSize + offsetY));
    }
  }
  for (let row = 0; row <= totalRows; row++) {
    const y = Math.round(row * cellSize + offsetY) + 0.5;
    if (y >= 0 && y <= viewHeight) {
      ctx.moveTo(Math.max(0, offsetX), y);
      ctx.lineTo(Math.min(viewWidth, totalCols * cellSize + offsetX), y);
    }
  }
  ctx.stroke();

  // Draw thick group divider lines (5x5 grouping)
  // The grid starts at computed edge padding from each side
  ctx.strokeStyle = groupLineColor;
  ctx.lineWidth = groupLineWidth;
  ctx.beginPath();

  for (let col = edgePaddingX; col <= totalCols - edgePaddingX; col += groupSize) {
    const x = Math.round(col * cellSize + offsetX);
    if (x >= 0 && x <= viewWidth) {
      ctx.moveTo(x, Math.max(0, edgePaddingY * cellSize + offsetY));
      ctx.lineTo(x, Math.min(viewHeight, (totalRows - edgePaddingY) * cellSize + offsetY));
    }
  }
  // Right boundary of last group
  {
    const x = Math.round((totalCols - edgePaddingX) * cellSize + offsetX);
    if (x >= 0 && x <= viewWidth) {
      ctx.moveTo(x, Math.max(0, edgePaddingY * cellSize + offsetY));
      ctx.lineTo(x, Math.min(viewHeight, (totalRows - edgePaddingY) * cellSize + offsetY));
    }
  }

  for (let row = edgePaddingY; row <= totalRows - edgePaddingY; row += groupSize) {
    const y = Math.round(row * cellSize + offsetY);
    if (y >= 0 && y <= viewHeight) {
      ctx.moveTo(Math.max(0, edgePaddingX * cellSize + offsetX), y);
      ctx.lineTo(Math.min(viewWidth, (totalCols - edgePaddingX) * cellSize + offsetX), y);
    }
  }
  // Bottom boundary of last group
  {
    const y = Math.round((totalRows - edgePaddingY) * cellSize + offsetY);
    if (y >= 0 && y <= viewHeight) {
      ctx.moveTo(Math.max(0, edgePaddingX * cellSize + offsetX), y);
      ctx.lineTo(Math.min(viewWidth, (totalCols - edgePaddingX) * cellSize + offsetX), y);
    }
  }

  ctx.stroke();
}
