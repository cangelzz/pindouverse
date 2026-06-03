/**
 * Bead-count legend rendering for blueprint exports.
 *
 * Each legend item is rendered as a two-sub-cell tile:
 *   ┌─────────┬────┐
 *   │ M001    │ 42 │   left = code on color BG (adaptive text)
 *   │         │    │   right = count on white BG (black text)
 *   └─────────┴────┘
 * Both sub-cells are width-adaptive (sized to text + LEGEND_PAD * 2).
 * Items flow left-to-right and wrap when the row is full.
 *
 * Mirrors the Rust implementation in src-tauri/src/commands/image_export.rs
 * so browser/VS Code/Tauri exports look the same.
 */

export const LEGEND_PAD = 6;       // px, horizontal padding inside each sub-cell
export const LEGEND_GAP = 6;       // px, horizontal gap between items
export const LEGEND_ROW_GAP = 2;   // px, vertical gap between rows (unchanged)

export interface LegendCell {
  color_code: string;
  r: number;
  g: number;
  b: number;
}

export interface LegendItem {
  code: string;
  r: number;
  g: number;
  b: number;
  count: number;
}

export interface LegendItemLayout extends LegendItem {
  leftW: number;
  rightW: number;
}

export interface LegendSectionLayout {
  title: string;
  items: LegendItemLayout[];
  rowsCount: number;
}

export interface LegendLayout {
  cellSize: number;
  swatchH: number;
  totalHeight: number;
  sections: LegendSectionLayout[];
}

/** Count distinct colors and return both sort orders. */
export function buildLegendItems(cells: (LegendCell | null)[][]): { byCount: LegendItem[]; byAlpha: LegendItem[] } {
  const map = new Map<string, LegendItem>();
  for (const row of cells) {
    for (const cell of row) {
      if (!cell) continue;
      const ex = map.get(cell.color_code);
      if (ex) {
        ex.count += 1;
      } else {
        map.set(cell.color_code, { code: cell.color_code, r: cell.r, g: cell.g, b: cell.b, count: 1 });
      }
    }
  }
  const byCount = Array.from(map.values()).sort((a, b) =>
    b.count - a.count || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
  );
  const byAlpha = [...byCount].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return { byCount, byAlpha };
}

// Legend cells/text are rendered at 2× the grid's cell size — the grid
// itself can be tiny while the legend still needs to be readable. Both
// computeLegendLayout and drawLegend MUST stay in sync on this scale.
const LEGEND_SCALE = 2;

function codeFontPx(cellSize: number): number {
  return Math.max(14, Math.min(cellSize * LEGEND_SCALE * 0.4, 28));
}

function titleFontPx(cellSize: number): number {
  return Math.max(16, cellSize * LEGEND_SCALE * 0.5);
}

/** Count how many rows `items` need given the inner width and pre-computed item widths. */
function countRows(items: LegendItemLayout[], innerW: number): number {
  if (items.length === 0) return 0;
  let rows = 1;
  let x = 0;
  for (let i = 0; i < items.length; i++) {
    const w = items[i].leftW + items[i].rightW;
    if (i > 0 && x + w > innerW) {
      rows += 1;
      x = 0;
    }
    x += w + LEGEND_GAP;
  }
  return rows;
}

/** Compute layout dimensions; pre-measures text widths via an offscreen canvas. */
export function computeLegendLayout(
  cells: (LegendCell | null)[][],
  width: number,
  cellSize: number,
): LegendLayout {
  const { byCount, byAlpha } = buildLegendItems(cells);
  const swatchH = cellSize * LEGEND_SCALE;
  const gap = Math.floor(cellSize * LEGEND_SCALE / 2);
  const sectionTitleH = cellSize * LEGEND_SCALE;

  // Measure with an offscreen canvas — works in browser and in VS Code webview
  const offscreen = document.createElement("canvas");
  const ctx = offscreen.getContext("2d")!;
  ctx.font = `${codeFontPx(cellSize)}px monospace`;

  const layoutItems = (items: LegendItem[]): LegendItemLayout[] =>
    items.map((it) => ({
      ...it,
      leftW: Math.ceil(ctx.measureText(it.code).width + LEGEND_PAD * 2),
      rightW: Math.ceil(ctx.measureText(`${it.count}`).width + LEGEND_PAD * 2),
    }));

  const innerW = width * cellSize - cellSize * 2; // margin = cellSize on each side
  const sections: LegendSectionLayout[] = [
    (() => {
      const items = layoutItems(byCount);
      const totalBeads = byCount.reduce((s, x) => s + x.count, 0);
      return {
        title: `按数量 (${byCount.length} 色, ${totalBeads} 颗)`,
        items,
        rowsCount: countRows(items, Math.max(0, innerW)),
      };
    })(),
    (() => {
      const items = layoutItems(byAlpha);
      return {
        title: `按代号 (${byAlpha.length} 色)`,
        items,
        rowsCount: countRows(items, Math.max(0, innerW)),
      };
    })(),
  ];

  const sectionH = (s: LegendSectionLayout): number =>
    sectionTitleH + s.rowsCount * (swatchH + LEGEND_ROW_GAP);

  const totalHeight = gap + sectionH(sections[0]) + gap + sectionH(sections[1]) + gap;

  return { cellSize, swatchH, totalHeight, sections };
}

/** Draw the bead-count legend into a canvas. Call after the grid is drawn. */
export function drawLegend(
  ctx: CanvasRenderingContext2D,
  layout: LegendLayout,
  margin: number,
  gridAreaH: number,
): void {
  const { swatchH, sections, cellSize } = layout;
  const innerW = (ctx.canvas.width - margin * 2);
  const gap = Math.floor(cellSize * LEGEND_SCALE / 2);
  const sectionTitleH = cellSize * LEGEND_SCALE;
  const codeFont = codeFontPx(cellSize);
  const titleFont = titleFontPx(cellSize);

  let y = gridAreaH + gap;
  for (const section of sections) {
    // Section title
    ctx.fillStyle = "rgba(0,0,0,0.85)";
    ctx.font = `${titleFont}px monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(section.title, margin, y + 2);

    const rowStartY = y + sectionTitleH;
    let x = margin;
    let rowIdx = 0;

    ctx.font = `${codeFont}px monospace`;
    for (let i = 0; i < section.items.length; i++) {
      const it = section.items[i];
      const itemW = it.leftW + it.rightW;
      if (i > 0 && x + itemW > margin + innerW) {
        rowIdx += 1;
        x = margin;
      }
      const sy = rowStartY + rowIdx * (swatchH + LEGEND_ROW_GAP);

      // Left sub-cell — color background
      ctx.fillStyle = `rgb(${it.r},${it.g},${it.b})`;
      ctx.fillRect(x, sy, it.leftW, swatchH);

      // Right sub-cell — white background
      ctx.fillStyle = "rgb(255,255,255)";
      ctx.fillRect(x + it.leftW, sy, it.rightW, swatchH);

      // Outer border around both sub-cells
      ctx.strokeStyle = "rgb(160,160,160)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, sy + 0.5, itemW - 1, swatchH - 1);

      // Divider line between left and right
      ctx.beginPath();
      ctx.moveTo(x + it.leftW + 0.5, sy + 1);
      ctx.lineTo(x + it.leftW + 0.5, sy + swatchH - 1);
      ctx.stroke();

      // Left text — code, centered, adaptive color
      const lum = 0.299 * it.r + 0.587 * it.g + 0.114 * it.b;
      ctx.fillStyle = lum > 128 ? "rgba(0,0,0,0.95)" : "rgba(255,255,255,0.95)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(it.code, x + it.leftW / 2, sy + swatchH / 2);

      // Right text — count, centered black-on-white
      ctx.fillStyle = "rgba(0,0,0,0.95)";
      ctx.fillText(`${it.count}`, x + it.leftW + it.rightW / 2, sy + swatchH / 2);

      x += itemW + LEGEND_GAP;
    }

    y += sectionTitleH + section.rowsCount * (swatchH + LEGEND_ROW_GAP) + gap;
  }
}
