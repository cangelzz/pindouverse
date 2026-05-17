# Blueprint Legend Redesign — Design

**Date:** 2026-05-17
**Status:** Approved (visual layout confirmed via `temp/legend-preview.html`)

## Summary

Redesign the bead-count legend in exported blueprint images so each color row becomes a two-sub-cell tile: left = MARD code on the color background, right = count on a white background. Both sub-cells are width-adaptive to their text content. Bump the legend's code/count font size to match the grid's cell-text font. Update both the TypeScript implementation (used by browser + VS Code extension) and the Rust mirror (used by Tauri desktop) so all platforms render identically.

## Motivation

The current legend (commit `2caa742`) packs `CODE xN` into a single colored cell sized at `cellSize × 2`, with code text at `cellSize × 0.35` font (~10.5px at default cellSize=30). Two problems:

1. The font is noticeably smaller than the in-grid cell text (which is `min(cellSize × 0.4, 14)` ~ 12px), making the legend harder to read at the same zoom level.
2. The combined `CODE xN` format is visually noisy when scanning — the eye has to separate the color identifier from the count.

A two-sub-cell tile separates the two pieces of information and makes the legend easier to skim. Adaptive widths keep each tile tight to its content.

## Visual layout (each legend item)

```
┌────────────┬──────┐
│   M001     │  42  │
│ (color BG, │(white │
│ centered)  │ BG,   │
│            │centered)
└────────────┴──────┘
       ← gap → ┌────────────┬────┐
              │   A14      │ 28 │
              │            │    │
              └────────────┴────┘
```

- Height: `cellSize` (unchanged from current)
- Border: 1px gray (`rgb(160,160,160)`) around the whole tile + 1px gray divider between left and right
- Items flow left-to-right and wrap to next row when the current row is full
- Inter-row vertical spacing: 2px (unchanged)

### Sub-cell widths

| Sub-cell | Width                                            | Background      | Text                                                  |
| -------- | ------------------------------------------------ | --------------- | ----------------------------------------------------- |
| Left     | `ceil(textWidth(code)  + LEGEND_PAD * 2)`        | `rgb(r,g,b)`    | code, centered, adaptive black/white per luminance    |
| Right    | `ceil(textWidth(count) + LEGEND_PAD * 2)`        | `rgb(255,255,255)` | count digits, centered, black                       |

Where `LEGEND_PAD = 6` (px) — horizontal padding on each side of the text inside its sub-cell.

### Inter-item spacing

- Horizontal gap between adjacent items: `LEGEND_GAP = 6` (px)
- Vertical row gap: 2 (unchanged)

### Font

- Legend code + count text: `max(7, min(cellSize × 0.4, 14))` — same formula as the grid cell-text font. At default `cellSize=30` this is 12px (was 10.5px).
- Section title text: `max(8, cellSize × 0.5)` — unchanged.

### Wrap behavior

Items are laid out into the available width (`gridWidth × cellSize - 2 × margin`). When the next item's full width would exceed that, wrap to the next row, reset `x` to the left margin, advance `y` by `cellSize + 2`.

This is a flow layout: row heights are uniform but row contents vary. The number of rows depends on the actual mix of code/count lengths.

## Components

### TS — `src/utils/blueprintLegend.ts`

The current `computeLegendLayout(cells, width, cellSize)` returns a flat layout that assumes uniform `swatchW`. It must be changed to compute per-item widths and use the resulting flow layout to derive `totalHeight`.

Two design options for the new API:

**Option A — pre-measure inside `computeLegendLayout`** (recommended):
- `computeLegendLayout` accepts an additional `ctx?: CanvasRenderingContext2D` argument. If not provided, it creates an offscreen canvas internally (`document.createElement('canvas')`) and uses its context for measurement.
- Returns the same shape as today plus an `items` field that already has each item's `leftW` and `rightW` baked in.
- `drawLegend` reads the per-item widths from the layout — no extra measurement.

**Option B — keep `computeLegendLayout` width-agnostic, add `computeLegendHeight(ctx, ...)` that measures**:
- More cumbersome; requires callers to thread two functions.

We go with Option A.

The new `LegendLayout` shape becomes:

```ts
export interface LegendItemLayout {
  code: string;
  r: number; g: number; b: number;
  count: number;
  leftW: number;   // = ceil(textWidth(code)  + LEGEND_PAD * 2)
  rightW: number;  // = ceil(textWidth(count) + LEGEND_PAD * 2)
}

export interface LegendSectionLayout {
  title: string;
  items: LegendItemLayout[];
  rowsCount: number;   // pre-computed for height; draw pass independently
                       // re-walks items and produces the same wrap result
                       // by using the same innerW value.
}

export interface LegendLayout {
  cellSize: number;
  swatchH: number;            // = cellSize
  totalHeight: number;
  sections: LegendSectionLayout[];   // [byCount, byAlpha]
}
```

`drawLegend` walks each section's `items`, tracks running `x`, wraps when `x + leftW + rightW > innerW`. The same `innerW` value is used at layout-compute time and at draw time, so `rowsCount` is guaranteed to match.

### Rust — `src-tauri/src/commands/image_export.rs`

Use `ab_glyph` (already a dep — seen at the top of the file) to measure glyph advance widths:

```rust
use ab_glyph::{Font, ScaleFont};

fn measure_text(font: &impl Font, scale: PxScale, text: &str) -> f32 {
    let scaled = font.as_scaled(scale);
    text.chars().map(|c| scaled.h_advance(font.glyph_id(c))).sum()
}
```

Then mirror the TS flow-layout algorithm: for each item, compute `left_w` and `right_w` from measured text + `LEGEND_PAD * 2`. Lay items out by tracking running `x`; wrap when `x + item_w > inner_w`. Sum row heights to get `total_legend_h` before computing the output `img_height`.

The two files (TS + Rust) should produce visually identical output at the same `cellSize`. The file header comment in `blueprintLegend.ts` already promises this and should be updated to point at the new algorithm.

### Constants

Define in both files (TS as exported constants, Rust as `const`):

| Name             | Value | Meaning                                |
| ---------------- | ----- | -------------------------------------- |
| `LEGEND_PAD`     | 6     | px, horizontal padding inside sub-cell |
| `LEGEND_GAP`     | 6     | px, gap between adjacent items         |
| `LEGEND_ROW_GAP` | 2     | px, vertical gap between rows (unchanged) |

## Scope

### In scope
- `src/utils/blueprintLegend.ts`: rewrite `computeLegendLayout` + `drawLegend` for the new layout, update `LegendLayout` shape.
- `src-tauri/src/commands/image_export.rs`: rewrite the legend section to match.
- Update unit/integration tests if they exist for the legend (likely none — check during planning).
- File header comment in `blueprintLegend.ts` updated to reflect the new algorithm.

### Out of scope
- Adding Chinese color names to the legend.
- Changing section titles, section order, or section-title font.
- Modifying the grid drawing or in-cell text.
- Adding new export formats / settings.
- Refactoring how `exportImage` is composed in `browser.ts` / Tauri adapter — only the legend portion changes.
- Custom user color overrides logic (already handled upstream — the `LegendCell` input already has resolved `r,g,b`).

## Risks

- **Per-platform font rendering differences** between Canvas2D and `ab_glyph` may cause tiny pixel-level width differences. The visual effect is acceptable as long as the layout is qualitatively the same; we will not pixel-match.
- **Existing exports look different.** Users with saved blueprint PNG/JPG files will not be affected, but new exports will not match the old style.
- **Webview snapshot tests** — if any tests assert on exact PNG bytes from the legend area, they will need new fixtures.

## Testing

- Add a small webview integration test in `platforms/vscode/tests/` that exports a small project (e.g., a 5×5 area with 3 colors) and asserts the resulting canvas has dimensions matching `gridArea + legendTotalHeight`, and that `legendTotalHeight` is non-zero. This guards against regressions in the layout math.
- Manually verify by exporting `samples/inuyasha-small.pindou` from the VS Code extension after rebuilding, and comparing the saved blueprint PNG to the preview rendered by `temp/legend-preview.html`.
- For the Rust path: build the Tauri app (`cargo build` from `src-tauri`) and verify it compiles. A manual export test from the desktop app to confirm layout visually.
