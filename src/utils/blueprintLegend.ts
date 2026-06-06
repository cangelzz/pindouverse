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

// Legend cells/text are rendered at LEGEND_SCALE × the grid's cell size —
// the grid itself can be tiny while the legend still needs to be readable.
// At LEGEND_SCALE = 5/3, a 30 px grid cell yields a 50 px legend swatch.
// Both computeLegendLayout and drawLegend MUST stay in sync on this scale.
const LEGEND_SCALE = 5 / 3;

export const LEGEND_PAD = Math.round(6 * LEGEND_SCALE);       // px, horizontal padding inside each sub-cell
export const LEGEND_GAP = Math.round(10 * LEGEND_SCALE);      // px, horizontal gap between items
export const LEGEND_ROW_GAP = Math.round(9 * LEGEND_SCALE);   // px, vertical gap between rows
export const LEGEND_CORNER_RADIUS = 8;            // px, rounded-corner radius for item tile

// Sans-serif stack used by all legend text (titles + codes + counts) — keeps
// the look unified with the header band and avoids the cramped feel of
// monospace digits packed into the tiny right-hand count sub-cell.
const LEGEND_FONT_FAMILY = `"Segoe UI", -apple-system, "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif`;

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

function codeFontPx(cellSize: number): number {
  return Math.max(18, Math.min(cellSize * LEGEND_SCALE * 0.55, 36));
}

function titleFontPx(cellSize: number): number {
  return Math.max(20, Math.min(cellSize * LEGEND_SCALE * 0.6, 40));
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

/** Section toggles passed through from the export request. */
export interface LegendSectionOptions {
  includeByCount?: boolean; // default true
  includeByName?: boolean;  // default false (new in 1.0.5)
}

/** Compute layout dimensions; pre-measures text widths via an offscreen canvas. */
export function computeLegendLayout(
  cells: (LegendCell | null)[][],
  width: number,
  cellSize: number,
  options: LegendSectionOptions = {},
): LegendLayout {
  const includeByCount = options.includeByCount !== false; // default true
  const includeByName = options.includeByName === true;    // default false
  const { byCount, byAlpha } = buildLegendItems(cells);
  const swatchH = cellSize * LEGEND_SCALE;
  const gap = Math.floor(cellSize * LEGEND_SCALE * 0.75);
  const sectionTitleH = Math.floor(cellSize * LEGEND_SCALE * 1.3);

  // Measure with an offscreen canvas — works in browser and in VS Code webview
  const offscreen = document.createElement("canvas");
  const ctx = offscreen.getContext("2d")!;
  ctx.font = `${codeFontPx(cellSize)}px ${LEGEND_FONT_FAMILY}`;

  const layoutItems = (items: LegendItem[]): LegendItemLayout[] =>
    items.map((it) => ({
      ...it,
      leftW: Math.ceil(ctx.measureText(it.code).width + LEGEND_PAD * 2),
      rightW: Math.ceil(ctx.measureText(`${it.count}`).width + LEGEND_PAD * 2),
    }));

  const innerW = width * cellSize - cellSize * 2; // margin = cellSize on each side
  const sections: LegendSectionLayout[] = [];
  if (includeByCount) {
    const items = layoutItems(byCount);
    const totalBeads = byCount.reduce((s, x) => s + x.count, 0);
    sections.push({
      title: `按数量 (${byCount.length} 色, ${totalBeads} 颗)`,
      items,
      rowsCount: countRows(items, Math.max(0, innerW)),
    });
  }
  if (includeByName) {
    const items = layoutItems(byAlpha);
    sections.push({
      title: `按代号 (${byAlpha.length} 色)`,
      items,
      rowsCount: countRows(items, Math.max(0, innerW)),
    });
  }

  const sectionH = (s: LegendSectionLayout): number =>
    sectionTitleH + s.rowsCount * (swatchH + LEGEND_ROW_GAP);

  // One gap before the first section, between each pair, and after the last —
  // i.e. (N + 1) gaps total. Empty (no sections) → 0.
  const totalHeight = sections.length === 0
    ? 0
    : gap * (sections.length + 1) + sections.reduce((acc, s) => acc + sectionH(s), 0);

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
  const gap = Math.floor(cellSize * LEGEND_SCALE * 0.75);
  const sectionTitleH = Math.floor(cellSize * LEGEND_SCALE * 1.3);
  const codeFont = codeFontPx(cellSize);
  const titleFont = titleFontPx(cellSize);

  let y = gridAreaH + gap;
  for (const section of sections) {
    // Section title
    ctx.fillStyle = "rgba(0,0,0,0.85)";
    ctx.font = `600 ${titleFont}px ${LEGEND_FONT_FAMILY}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(section.title, margin, y + 2);

    const rowStartY = y + sectionTitleH;
    let x = margin;
    let rowIdx = 0;

    ctx.font = `${codeFont}px ${LEGEND_FONT_FAMILY}`;
    for (let i = 0; i < section.items.length; i++) {
      const it = section.items[i];
      const itemW = it.leftW + it.rightW;
      if (i > 0 && x + itemW > margin + innerW) {
        rowIdx += 1;
        x = margin;
      }
      const sy = rowStartY + rowIdx * (swatchH + LEGEND_ROW_GAP);
      const radius = Math.min(LEGEND_CORNER_RADIUS, swatchH / 2, itemW / 2);

      // Rounded outer shape — clip to it so the two-color fill respects the
      // rounded corners on the outside while the inner divider stays straight.
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, sy, itemW, swatchH, radius);
      ctx.clip();

      // Left sub-cell — color background
      ctx.fillStyle = `rgb(${it.r},${it.g},${it.b})`;
      ctx.fillRect(x, sy, it.leftW, swatchH);

      // Right sub-cell — white background
      ctx.fillStyle = "rgb(255,255,255)";
      ctx.fillRect(x + it.leftW, sy, it.rightW, swatchH);

      ctx.restore();

      // Outer rounded border around both sub-cells
      ctx.beginPath();
      ctx.roundRect(x + 0.5, sy + 0.5, itemW - 1, swatchH - 1, radius);
      ctx.strokeStyle = "rgb(160,160,160)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Divider line between left and right (straight, inside the rounded box)
      ctx.beginPath();
      ctx.moveTo(x + it.leftW + 0.5, sy + radius * 0.4);
      ctx.lineTo(x + it.leftW + 0.5, sy + swatchH - radius * 0.4);
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
