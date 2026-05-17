# Blueprint Legend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-cell `CODE xN` legend tile with a two-sub-cell tile (code on color BG | count on white BG), per-item adaptive widths, gap between items, font matched to grid cell text. Update both TS (`blueprintLegend.ts`) and Rust (`image_export.rs`) so all platforms render identically.

**Architecture:** Pure layout helpers compute per-item `leftW`/`rightW` from `measureText` then a draw pass walks the prepared layout. Items flow horizontally and wrap when the row is full. Both TS and Rust use the same constants (`LEGEND_PAD=6`, `LEGEND_GAP=6`) and the same flow algorithm.

**Tech Stack:** TypeScript (Vite/React app), Vitest unit tests, Rust + `ab_glyph` + `imageproc` (Tauri desktop). Playwright integration tests for VS Code extension.

**Reference spec:** [docs/superpowers/specs/2026-05-17-blueprint-legend-redesign-design.md](../specs/2026-05-17-blueprint-legend-redesign-design.md)

**Branch:** `feature/legend-redesign` (already created)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/utils/blueprintLegend.ts` | Rewrite | Constants + new types + new layout/draw functions for the two-sub-cell flow layout |
| `src/utils/blueprintLegend.test.ts` | Create | Vitest unit tests for `computeLegendLayout` with mocked `measureText` |
| `src/adapters/browser.ts` | Verify (likely unchanged) | Caller of `computeLegendLayout`; signature stays compatible |
| `src-tauri/src/commands/image_export.rs` | Modify | Rewrite the legend section (currently ~lines 81-100, 236-298) to mirror the TS flow algorithm |
| `temp/legend-preview.html` | Keep as-is | Reference for the visual look; no code change |

The TS file has been intentionally kept small and self-contained. We rewrite it in place rather than splitting into separate "layout" + "draw" files because the two functions share constants and types; splitting them would add more import noise than it removes.

---

## Task 1: TS — write failing tests for `computeLegendLayout`

**Files:**
- Create: `src/utils/blueprintLegend.test.ts`

- [ ] **Step 1: Write the failing unit tests**

Create `src/utils/blueprintLegend.test.ts` with this exact content:

```ts
import { describe, it, expect, vi, beforeAll } from "vitest";
import {
  buildLegendItems,
  computeLegendLayout,
  LEGEND_PAD,
  LEGEND_GAP,
  type LegendCell,
  type LegendLayout,
} from "./blueprintLegend";

// Mock measureText: monospace at 12px → each char is exactly 7px wide.
// This lets us assert exact widths without depending on real font metrics.
const CHAR_W = 7;

beforeAll(() => {
  const FakeCtx = {
    font: "",
    measureText(s: string) {
      return { width: s.length * CHAR_W };
    },
  };
  // jsdom doesn't provide canvas — stub document.createElement for "canvas"
  const origCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") {
      return { getContext: () => FakeCtx } as any;
    }
    return origCreateElement(tag);
  });
});

function singleColorGrid(code: string, count: number): (LegendCell | null)[][] {
  // Return a grid that contains exactly `count` cells of the given code
  const row: (LegendCell | null)[] = Array.from({ length: count }, () => ({
    color_code: code,
    r: 100,
    g: 150,
    b: 200,
  }));
  return [row];
}

describe("constants", () => {
  it("exports LEGEND_PAD = 6", () => {
    expect(LEGEND_PAD).toBe(6);
  });
  it("exports LEGEND_GAP = 6", () => {
    expect(LEGEND_GAP).toBe(6);
  });
});

describe("buildLegendItems", () => {
  it("collects unique codes with counts", () => {
    const cells: (LegendCell | null)[][] = [
      [{ color_code: "A1", r: 1, g: 2, b: 3 }, { color_code: "B2", r: 4, g: 5, b: 6 }, null],
      [{ color_code: "A1", r: 1, g: 2, b: 3 }, { color_code: "A1", r: 1, g: 2, b: 3 }, null],
    ];
    const { byCount, byAlpha } = buildLegendItems(cells);
    expect(byCount).toEqual([
      { code: "A1", r: 1, g: 2, b: 3, count: 3 },
      { code: "B2", r: 4, g: 5, b: 6, count: 1 },
    ]);
    expect(byAlpha).toEqual([
      { code: "A1", r: 1, g: 2, b: 3, count: 3 },
      { code: "B2", r: 4, g: 5, b: 6, count: 1 },
    ]);
  });
});

describe("computeLegendLayout", () => {
  it("computes per-item leftW/rightW with padding", () => {
    const cells = singleColorGrid("M001", 42);
    const layout = computeLegendLayout(cells, 10, 30); // gridWidth=10 cells, cellSize=30 → 300px
    expect(layout.sections).toHaveLength(2);
    const item = layout.sections[0].items[0];
    // "M001" is 4 chars * 7 = 28, +12 padding = 40
    expect(item.leftW).toBe(4 * CHAR_W + LEGEND_PAD * 2);
    // "42" is 2 chars * 7 = 14, +12 padding = 26
    expect(item.rightW).toBe(2 * CHAR_W + LEGEND_PAD * 2);
  });

  it("returns swatchH equal to cellSize", () => {
    const cells = singleColorGrid("X", 1);
    const layout = computeLegendLayout(cells, 5, 24);
    expect(layout.swatchH).toBe(24);
    expect(layout.cellSize).toBe(24);
  });

  it("wraps items when the row is full", () => {
    // Create 6 distinct codes; with narrow gridWidth they should wrap
    const cells: (LegendCell | null)[][] = [[
      { color_code: "AAA", r: 0, g: 0, b: 0 }, { color_code: "BBB", r: 0, g: 0, b: 0 },
      { color_code: "CCC", r: 0, g: 0, b: 0 }, { color_code: "DDD", r: 0, g: 0, b: 0 },
      { color_code: "EEE", r: 0, g: 0, b: 0 }, { color_code: "FFF", r: 0, g: 0, b: 0 },
    ]];
    // gridWidth=4 cells * cellSize=30 = 120px → inner=120-margin*2=120-60=60px
    // each item: leftW=3*7+12=33, rightW=1*7+12=19, total=52, +gap=58 next item would not fit
    // So 1 item per row → 6 rows
    const layout = computeLegendLayout(cells, 4, 30);
    expect(layout.sections[0].rowsCount).toBe(6);
  });

  it("packs multiple items per row when there is space", () => {
    const cells: (LegendCell | null)[][] = [[
      { color_code: "A", r: 0, g: 0, b: 0 }, { color_code: "B", r: 0, g: 0, b: 0 },
      { color_code: "C", r: 0, g: 0, b: 0 }, { color_code: "D", r: 0, g: 0, b: 0 },
    ]];
    // gridWidth=20 cells * cellSize=30 = 600px → inner=540
    // each item: leftW=1*7+12=19, rightW=1*7+12=19, total=38, +gap=44; many fit per row
    const layout = computeLegendLayout(cells, 20, 30);
    expect(layout.sections[0].rowsCount).toBe(1);
  });

  it("computes totalHeight = 3*gap + 2*sectionH where sectionH = titleH + rows*(swatchH+rowGap)", () => {
    const cells = singleColorGrid("X1", 5);
    const layout = computeLegendLayout(cells, 10, 30);
    // gap = floor(30/2) = 15, titleH = 30, swatchH = 30, rowGap = 2, rows = 1 each section
    // sectionH = 30 + 1*(30+2) = 62
    // totalHeight = 15 + 62 + 15 + 62 + 15 = 169
    expect(layout.totalHeight).toBe(15 + 62 + 15 + 62 + 15);
  });

  it("section totalHeight reflects multi-row wrap", () => {
    // 12 distinct codes, narrow grid → multiple rows
    const cells: (LegendCell | null)[][] = [Array.from({ length: 12 }, (_, i) => ({
      color_code: `C${i}`, r: 0, g: 0, b: 0,
    }))];
    const layout = computeLegendLayout(cells, 4, 30); // inner ~ 60px, ~2 items/row
    expect(layout.sections[0].rowsCount).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run tests, confirm they FAIL**

From `q:\repo\pindou` run: `npx vitest run src/utils/blueprintLegend.test.ts`
Expected: FAIL — `LEGEND_PAD`, `LEGEND_GAP`, new fields on `LegendLayout` etc. do not exist yet.

- [ ] **Step 3: Commit the failing tests**

```bash
git add src/utils/blueprintLegend.test.ts
git commit -m "test: add vitest cases for new blueprintLegend shape"
```

---

## Task 2: TS — rewrite `blueprintLegend.ts` with new shape

**Files:**
- Modify: `src/utils/blueprintLegend.ts` (full rewrite)

- [ ] **Step 1: Replace the file contents**

Open `q:\repo\pindou\src\utils\blueprintLegend.ts` and replace its entire contents with:

```ts
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

function codeFontPx(cellSize: number): number {
  return Math.max(7, Math.min(cellSize * 0.4, 14));
}

function titleFontPx(cellSize: number): number {
  return Math.max(8, cellSize * 0.5);
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
  const swatchH = cellSize;
  const gap = Math.floor(cellSize / 2);
  const sectionTitleH = cellSize;

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
        title: `By Count (${byCount.length} colors, ${totalBeads} beads)`,
        items,
        rowsCount: countRows(items, Math.max(0, innerW)),
      };
    })(),
    (() => {
      const items = layoutItems(byAlpha);
      return {
        title: `By Code (${byAlpha.length} colors)`,
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
  cellSize: number,
  margin: number,
  gridAreaH: number,
): void {
  const { swatchH, sections } = layout;
  const innerW = (ctx.canvas.width - margin * 2);
  const gap = Math.floor(cellSize / 2);
  const sectionTitleH = cellSize;
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
```

- [ ] **Step 2: Run vitest, confirm all tests pass**

From `q:\repo\pindou`: `npx vitest run src/utils/blueprintLegend.test.ts`
Expected: PASS — all tests from Task 1 now pass.

- [ ] **Step 3: TypeScript build**

From `q:\repo\pindou`: `npx tsc --noEmit 2>&1 | grep -i "blueprintLegend\|adapters/browser" | head -20`
Expected: no errors. (`browser.ts` still works because the public `LegendLayout.totalHeight` field still exists with the same name.)

- [ ] **Step 4: Run the full vitest suite to make sure nothing else broke**

From `q:\repo\pindou`: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/blueprintLegend.ts
git commit -m "feat: rewrite blueprint legend as two-sub-cell adaptive flow layout"
```

---

## Task 3: TS — verify Playwright export pipeline still works

**Files:**
- Verify only: `src/adapters/browser.ts`, `platforms/vscode/tests/export.spec.ts`

- [ ] **Step 1: Re-read browser.ts call site**

Open `q:\repo\pindou\src\adapters\browser.ts` around line 268. Confirm the existing line `const legend = computeLegendLayout(cells as any, width, cell_size);` still works — `legend.totalHeight` is still exposed by the new `LegendLayout`. No code change needed.

If `computeLegendLayout` is referenced anywhere else (search project-wide), update those call sites only if they read the now-removed fields (`swatchW`, `cols`, `gap`, `sectionTitleH`, `byCount`, `byAlpha`).

- [ ] **Step 2: Verify with grep**

From `q:\repo\pindou`: `grep -rn "computeLegendLayout\|LegendLayout" src/ platforms/ --include="*.ts" --include="*.tsx"`
Expected: only the call in `browser.ts:268` and the definitions/tests in `src/utils/blueprintLegend.ts`/`.test.ts`. No other consumers.

- [ ] **Step 3: Build the VS Code extension and run the export tests**

```bash
cd q:\repo\pindou\platforms\vscode
npm run build
npm run test:webview -- export.spec.ts
```

Expected: the "export blueprint PNG → writeFile called with PNG bytes" test still passes (PNG signature unchanged; only pixel content of the legend area differs from before). The flaky "export preview JPG" test may still fail intermittently — that's pre-existing and unrelated.

- [ ] **Step 4: Commit a tiny note if anything changed**

If browser.ts needed edits, commit them:
```bash
git add src/adapters/browser.ts
git commit -m "chore: align browser.ts with new LegendLayout shape"
```

If browser.ts needed NO changes, skip this commit and just proceed to Task 4.

---

## Task 4: Rust — mirror the algorithm in `image_export.rs`

**Files:**
- Modify: `src-tauri/src/commands/image_export.rs`

This is a single substantial edit replacing the legend layout pre-compute (~lines 81-100) and the legend drawing closure (~lines 236-298).

- [ ] **Step 1: Replace the legend pre-compute block**

In `q:\repo\pindou\src-tauri\src\commands\image_export.rs`, find the block starting with the comment `// Legend layout` (around line 81). Replace from that comment through the end of `let total_legend_h = ...` (around line 100) with:

```rust
    // === Legend layout (matches src/utils/blueprintLegend.ts) ===
    const LEGEND_PAD: u32 = 6;
    const LEGEND_GAP: u32 = 6;
    const LEGEND_ROW_GAP: u32 = 2;

    let swatch_h = cs;
    let legend_gap = cs / 2;
    let section_title_h = cs;

    // Pre-compute per-item widths from glyph metrics
    let legend_code_scale = PxScale::from(cs as f32 * 0.4);
    let legend_title_scale = PxScale::from(cs as f32 * 0.5);

    type LegendLayoutItem = (String, u8, u8, u8, u32, u32, u32); // (code, r, g, b, count, leftW, rightW)
    let prepare_items = |items: &[(String, u8, u8, u8, u32)]| -> Vec<LegendLayoutItem> {
        items.iter().map(|(code, r, g, b, cnt)| {
            let (code_w, _, _) = measure_text(legend_code_scale, &font, code);
            let count_str = format!("{}", cnt);
            let (count_w, _, _) = measure_text(legend_code_scale, &font, &count_str);
            let left_w  = code_w  as u32 + LEGEND_PAD * 2;
            let right_w = count_w as u32 + LEGEND_PAD * 2;
            (code.clone(), *r, *g, *b, *cnt, left_w, right_w)
        }).collect()
    };

    let count_rows = |items: &[LegendLayoutItem], inner_w: u32| -> u32 {
        if items.is_empty() { return 0; }
        let mut rows: u32 = 1;
        let mut x: u32 = 0;
        for (i, it) in items.iter().enumerate() {
            let w = it.5 + it.6;
            if i > 0 && x + w > inner_w {
                rows += 1;
                x = 0;
            }
            x += w + LEGEND_GAP;
        }
        rows
    };

    let by_count_layout = prepare_items(&by_count);
    let by_alpha_layout = prepare_items(&by_alpha);

    let inner_w = if request.width * cs > margin * 2 { request.width * cs - margin * 2 } else { 0 };
    let by_count_rows = count_rows(&by_count_layout, inner_w);
    let by_alpha_rows = count_rows(&by_alpha_layout, inner_w);

    let section_h = |rows: u32| -> u32 {
        section_title_h + rows * (swatch_h + LEGEND_ROW_GAP)
    };

    let total_legend_h = legend_gap
        + section_h(by_count_rows)
        + legend_gap
        + section_h(by_alpha_rows)
        + legend_gap;
```

(Some of the names like `swatch_w`, `legend_cols`, `legend_rows_count`, `legend_section_h` that existed before are now gone. Make sure those identifiers are not referenced later in the function — they will be replaced in Step 2.)

- [ ] **Step 2: Replace the legend drawing closure and its caller**

Find the closure `let draw_legend_section = |img: &mut RgbaImage, items: &[(String, u8, u8, u8, u32)], y_start: u32, title: &str| { ... };` (around line 237) and its two callers below it (`draw_legend_section(&mut img, &by_count, legend_y, &title1);` and `draw_legend_section(&mut img, &by_alpha, legend_y, &title2);`, around lines 293 and 297).

Replace from the `// === Draw legend below grid ===` comment through the second `draw_legend_section(...)` call with:

```rust
    // === Draw legend below grid ===
    let draw_legend_section = |img: &mut RgbaImage, items: &[LegendLayoutItem], rows: u32, y_start: u32, title: &str| {
        // Title
        draw_text_mut(img, Rgba([0, 0, 0, 255]), margin as i32, y_start as i32 + 2, legend_title_scale, &font, title);

        let row_start_y = y_start + section_title_h;
        let mut x: u32 = margin;
        let mut row_idx: u32 = 0;
        for (i, it) in items.iter().enumerate() {
            let (code, r, g, b, cnt, left_w, right_w) = it.clone();
            let item_w = left_w + right_w;
            if i > 0 && x + item_w > margin + inner_w {
                row_idx += 1;
                x = margin;
            }
            let sy = row_start_y + row_idx * (swatch_h + LEGEND_ROW_GAP);

            // Left sub-cell — color background
            for dy in 0..swatch_h {
                for dx in 0..left_w {
                    let px = x + dx;
                    let py = sy + dy;
                    if px < img_width && py < img_height {
                        img.put_pixel(px, py, Rgba([r, g, b, 255]));
                    }
                }
            }
            // Right sub-cell — white background
            for dy in 0..swatch_h {
                for dx in 0..right_w {
                    let px = x + left_w + dx;
                    let py = sy + dy;
                    if px < img_width && py < img_height {
                        img.put_pixel(px, py, Rgba([255, 255, 255, 255]));
                    }
                }
            }

            // Outer border (top, bottom, left, right)
            let border = Rgba([160, 160, 160, 255]);
            for dx in 0..item_w {
                let px = x + dx;
                if px < img_width {
                    if sy < img_height { img.put_pixel(px, sy, border); }
                    let by = sy + swatch_h - 1;
                    if by < img_height { img.put_pixel(px, by, border); }
                }
            }
            for dy in 0..swatch_h {
                let py = sy + dy;
                if py < img_height {
                    if x < img_width { img.put_pixel(x, py, border); }
                    let bx = x + item_w - 1;
                    if bx < img_width { img.put_pixel(bx, py, border); }
                }
            }
            // Divider line between left and right
            let div_x = x + left_w;
            for dy in 1..swatch_h - 1 {
                let py = sy + dy;
                if div_x < img_width && py < img_height {
                    img.put_pixel(div_x, py, border);
                }
            }

            // Left text — code, centered, adaptive color
            let text_color = if luminance(r, g, b) > 128.0 {
                Rgba([0, 0, 0, 255])
            } else {
                Rgba([255, 255, 255, 255])
            };
            let (code_w, code_min_y, code_max_y) = measure_text(legend_code_scale, &font, &code);
            let code_tx = x as i32 + (left_w as i32 - code_w) / 2;
            let code_ty = sy as i32 + swatch_h as i32 / 2 - (code_min_y + code_max_y) / 2;
            draw_text_mut(img, text_color, code_tx, code_ty, legend_code_scale, &font, &code);

            // Right text — count, centered black-on-white
            let count_str = format!("{}", cnt);
            let (cnt_w, cnt_min_y, cnt_max_y) = measure_text(legend_code_scale, &font, &count_str);
            let cnt_tx = (x + left_w) as i32 + (right_w as i32 - cnt_w) / 2;
            let cnt_ty = sy as i32 + swatch_h as i32 / 2 - (cnt_min_y + cnt_max_y) / 2;
            draw_text_mut(img, Rgba([0, 0, 0, 255]), cnt_tx, cnt_ty, legend_code_scale, &font, &count_str);

            x += item_w + LEGEND_GAP;
        }
        // Silence unused-variable warning if `rows` is debug-only here
        let _ = rows;
    };

    let mut legend_y = grid_area_h + legend_gap;
    let total_beads: u32 = by_count.iter().map(|x| x.4).sum();
    let title1 = format!("By Count ({} colors, {} beads)", by_count.len(), total_beads);
    draw_legend_section(&mut img, &by_count_layout, by_count_rows, legend_y, &title1);
    legend_y += section_h(by_count_rows) + legend_gap;

    let title2 = format!("By Code ({} colors)", by_alpha.len());
    draw_legend_section(&mut img, &by_alpha_layout, by_alpha_rows, legend_y, &title2);
```

- [ ] **Step 3: Remove the duplicate `let legend_code_scale = ...` and `let legend_title_scale = ...` if they still exist**

After Step 1, the same two scales were declared inside the new layout block. The OLD declarations are at the top of the function (around lines 117-118):

```rust
    let legend_code_scale = PxScale::from(cs as f32 * 0.35);
    let legend_title_scale = PxScale::from(cs as f32 * 0.5);
```

Delete these two lines. The new declarations inside the layout block now own those names. (Note the OLD scale was `0.35`; the NEW scale is `0.4`, matching the font size bump.)

- [ ] **Step 4: Build Rust**

From `q:\repo\pindou\src-tauri` run: `cargo build 2>&1 | tail -30`
Expected: compiles cleanly. Warnings about unused `let _ = rows;` are acceptable; warnings should not include any in `image_export.rs` unless previously present.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/image_export.rs
git commit -m "feat: rewrite Rust blueprint legend to match TS flow layout"
```

---

## Task 5: Final verification

- [ ] **Step 1: Run all vitest from the repo root**

```bash
cd q:\repo\pindou && npx vitest run
```
Expected: PASS, including the new legend tests and all pre-existing.

- [ ] **Step 2: Run the full webview suite from the VS Code extension**

```bash
cd q:\repo\pindou\platforms\vscode && npm run test:webview
```
Expected: all tests pass except possibly the known flaky "export preview JPG" pre-existing test.

- [ ] **Step 3: Manually export a sample to visually verify**

From `q:\repo\pindou` run `npm run dev` (or whichever script boots the web app). Open the app, load `samples/inuyasha-small.pindou`, open the export dialog, export as PNG. Open the PNG in an image viewer.

Verify:
- The legend below the grid uses the new two-sub-cell tile layout.
- Code text on left (centered, on the color BG) is visually larger than before — matches the in-grid cell text.
- Count text on right (centered, on white BG) — black text on white.
- Items in each section have visible gap between them (~6px).
- Wrap to next row when the row is full.
- Two sections "By Count (...)" and "By Code (...)" both render correctly.

If anything looks off, fix and re-test; do not commit broken output.

- [ ] **Step 4: Optional Rust build verification**

From `q:\repo\pindou\src-tauri` run: `cargo build --release 2>&1 | tail -10`
Expected: build succeeds. (Optional because we may not boot the Tauri desktop app; the compile is enough to catch most mistakes.)

- [ ] **Step 5: Push branch**

```bash
cd q:\repo\pindou
git push -u origin feature/legend-redesign
```

- [ ] **Step 6: Squash-merge to main per CLAUDE.md rules**

Wait for user approval before this step. When approved:

```bash
git checkout main
git merge --squash feature/legend-redesign
git commit -m "feat: redesign blueprint legend as two-sub-cell adaptive flow layout"
git branch -d feature/legend-redesign
```

---

## Self-review

**Spec coverage:**

| Spec requirement | Task |
|------------------|------|
| Two-sub-cell tile (code on color BG, count on white BG) | Task 2 (`drawLegend`), Task 4 (Rust) |
| Per-item adaptive widths via `measureText` / glyph metrics | Task 2 (`computeLegendLayout`), Task 4 |
| `LEGEND_PAD=6`, `LEGEND_GAP=6`, `LEGEND_ROW_GAP=2` constants | Task 2, Task 4 |
| Font bumped to `min(cellSize × 0.4, 14)` to match grid cell text | Task 2 (`codeFontPx`), Task 4 (scale 0.4) |
| Flow layout with row wrap | Task 2 (`countRows`, draw loop), Task 4 |
| Both TS and Rust updated | Tasks 2 + 4 |
| `LegendLayout` shape per spec | Task 2 |
| File header comment updated | Task 2 (rewrite includes new header) |
| Tests | Task 1 (vitest), Task 3 (Playwright pipeline check), Task 5 (manual smoke) |

**Placeholders:** none — every step includes the actual code.

**Type consistency:** `LegendItemLayout` extends `LegendItem` with `leftW`/`rightW` (both `number`); `LegendSectionLayout` has `title`, `items`, `rowsCount`; `LegendLayout` has `cellSize`, `swatchH`, `totalHeight`, `sections`. Same names used in tests (Task 1), implementation (Task 2), and the call site verification (Task 3). The Rust tuple `LegendLayoutItem = (code, r, g, b, count, leftW, rightW)` is referenced consistently in Tasks 4 Step 1 and Step 2.
