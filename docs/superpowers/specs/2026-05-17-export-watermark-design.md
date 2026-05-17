# Export Watermark — Design

**Date**: 2026-05-17
**Status**: Draft, awaiting user review
**Scope**: Add an app-title header band and optional diagonal watermarks (PindouVerse name, author) to all image exports — blueprint, blueprint mirror, preview, preview mirror.

---

## Goal

Make every exported image identifiable as a PindouVerse artifact and optionally signed by the project author, without obscuring the content.

## Decisions (already agreed with user)

1. **Author source**: reuse `projectInfo.author`; the export dialog allows a transient override that is **not** written back to the `.pindou` file.
2. **Scope**: all image exports (blueprint, preview, and their mirrors). A single watermark configuration applies to every artifact produced in one export run — if the header is on, it is on for blueprint, preview, and both mirrors; if the resolved author is empty, the author watermark is skipped on all four uniformly. There is no per-artifact override.
3. **Header layout**: independent top band above the grid, does not share space with the existing axis-label margin.
4. **Watermark visuals**: bold sans-serif, 45° rotation, fill color ~`rgba(160,160,160,0.18)` — visible but does not overpower color codes.
5. **Empty author + author-watermark enabled**: show inline hint in dialog; export proceeds and silently skips the author watermark.
6. **Header icon**: bundle and render `app-icon.png`.
7. **Settings persistence**: persist watermark toggles and the app-description string across sessions in `localStorage`; the author override is per-session only.

## Data Model

```ts
// src/types/index.ts
export interface ExportWatermarkSettings {
  showHeader: boolean;         // default: true
  appDescription: string;      // default: ""
  appWatermark: boolean;       // default: false
  authorWatermark: boolean;    // default: true
  authorOverride: string;      // default: "" — runtime only, not persisted
}
```

Persistence: `localStorage` key `pindouverse.exportWatermark` stores the first four fields (omits `authorOverride`). `ExportDialog` hydrates on mount and writes on export.

## UI — ExportDialog

Dialog width: 380px → **440px**.

New section below the existing "导出内容" group:

```
水印与署名
  ☑ 顶部应用标题
    描述（可选）: [_____________________]
  ☐ 在图中添加 PindouVerse 水印（45° 平铺）
  ☑ 在图中添加作者水印
    作者: [__________________]    (default = projectInfo.author)
```

- Author input below the author-watermark checkbox; placeholder `(未设置)` when `projectInfo.author` is empty.
- When `authorWatermark` is true but the resolved author (override ?? projectInfo.author) is empty: show muted hint `"未设置作者名，将不绘制作者水印"`.
- Section becomes disabled (grayed out) when neither blueprint nor preview is selected.

## Layout Algorithm

### Header band

- `HEADER_H = 2 * cellSize` when `showHeader`, else `0`
- `pad = cellSize / 4`
- Icon: square `HEADER_H - 2*pad`, drawn at `(pad, pad)`
- Text: starts at `pad + icon_size + pad`, font `bold ${HEADER_H * 0.4}px sans-serif`, color `#1F2937`, vertically centered
- Text content: `appDescription` empty → `"PindouVerse"`; non-empty → `"PindouVerse - <description>"`
- Bottom edge: a 1px `#E5E7EB` separator line

### Total output dimensions

Blueprint:
```
img_width  = width * cellSize + margin
img_height = headerH + (height * cellSize + margin) + legend_height
```

Preview:
```
img_width  = width * pixelSize
img_height = headerH + height * pixelSize
```

All grid/legend draw coordinates are offset by `headerH`.

### Watermark (45° tiled, inside grid area only)

- Determine lines from settings:
  - `appWatermark && authorWatermark` → `["PindouVerse", resolvedAuthor]` (skip author entry if empty)
  - `appWatermark` only → `["PindouVerse"]`
  - `authorWatermark` only → `[resolvedAuthor]` (skip entirely if empty)
- Font: `bold ${3 * cellSize}px sans-serif` (weight 900), fill `rgba(120,120,120,0.32)`
- Rotate the drawing context 45°, draw text along rotated axis
- Line spacing: `6 * cellSize` — equivalent to leaving one blank line between text rows
- Horizontal repeat spacing within a line: `1.6 * textWidth`
- **Staggered (brick) layout**: alternate lines are shifted by half the horizontal repeat period so columns do not align vertically
- Lines repeat across the diagonal length of the grid area — minimum 2 lines, computed from `diag = sqrt(gridW^2 + gridH^2)`, line count = `ceil(diag / (6*cellSize))`
- Lines alternate when two are configured: line 0 = first text, line 1 = second text, line 2 = first text, ...
- Clip to the grid rectangle (cells area only) — watermark does **not** appear over header, legend, or axis labels

### App-description does **not** appear in the watermark

The watermark text for the app is fixed `"PindouVerse"`, independent of `appDescription`. The description only appears in the header band. Reason: a long description would degrade the tiled pattern.

## Implementation Plan

### New files

- `src/utils/blueprintDecorations.ts`
  - `computeHeaderHeight(cellSize, showHeader): number`
  - `computeWatermarkLines(settings, projectAuthor): string[]`
  - `resolveWatermarkAuthor(override, projectAuthor): string`
  - `drawHeader(ctx, opts)` — Canvas 2D
  - `drawWatermark(ctx, opts)` — Canvas 2D
  - `loadWatermarkSettings(): ExportWatermarkSettings`
  - `saveWatermarkSettings(settings: ExportWatermarkSettings): void`
- `tests/core/blueprintDecorations.test.ts` — unit tests for the pure functions
- `src-tauri/src/commands/image_decorations.rs` — Rust mirror: `draw_header`, `draw_watermark`, header-height helper
- `src-tauri/fonts/NotoSans-Bold.ttf` — bold sans-serif for Rust watermark/header

### Modified files

- `src/types/index.ts` — add `ExportWatermarkSettings` and a `WatermarkPayload` shared shape
- `src/adapters/index.ts` — extend `ExportImageRequest` and `ExportPreviewRequest` with `watermark?: WatermarkPayload`
- `src/adapters/browser.ts` — use header/watermark helpers in `exportImage` and `exportPreview`; apply header offset to all coords
- `src/adapters/tauri.ts` — forward `watermark` field
- `src/components/Export/ExportDialog.tsx` — new UI section, hydrate/save settings, build watermark payload, pass through
- `src-tauri/src/commands/image_export.rs` — accept new fields; add header offset; call decoration helpers; apply to `export_image` and `export_preview`
- `platforms/vscode/tests/export.spec.ts` — extend coverage for new UI and request fields

### Resources

- `app-icon.png` (already exists at project root)
  - TS: import via Vite asset URL
  - Rust: `include_bytes!("../../../app-icon.png")`, decode with the existing `image` crate

## Testing

### TS unit (`tests/core/blueprintDecorations.test.ts`)

- `computeHeaderHeight`: returns `0` when `showHeader=false`, `2*cs` when true
- `computeWatermarkLines`: covers all four toggle combinations × author empty/non-empty
- `resolveWatermarkAuthor`: override wins, falls back to project author, returns empty string when both missing
- `loadWatermarkSettings` / `saveWatermarkSettings`: round-trip via mocked localStorage; `authorOverride` is **not** persisted

### Playwright (`platforms/vscode/tests/export.spec.ts`)

- New ExportDialog controls render
- Toggling each option and triggering export sends the expected `watermark` payload to the host (verified via `stageReply` capture on `exportImage`)
- Empty author + author watermark checked → hint visible
- Persistence: close and reopen dialog → settings restored

### Rust (`src-tauri/src/commands/image_export.rs` test module)

- `export_image` to a temp file with various toggle combinations → check output PNG dimensions match the documented formulas
- No visual-pixel comparison; just shape + non-empty

## Risks / Trade-offs

- **Bold font bundle size**: ~400KB added to the Rust binary for `NotoSans-Bold.ttf`. Acceptable given the existing Noto Mono is already bundled. If the user later objects, fall back to scaling the existing mono font.
- **Two render implementations**: TS and Rust each redraw header + watermark. This is the same trade-off already accepted for the legend code. Document parity expectations inline.
- **Header pushes everything down** in existing files imported into the editor — re-exporting an old project will produce a taller image. Documented as expected behavior.
- **45° watermark on small grids**: when the grid is very small (e.g. 16×16 with `cellSize=30`), the watermark may dominate. Acceptable because the watermark is visually subtle (18% alpha) and the user can disable it.

## Out of Scope

- Watermark customization beyond `appDescription` (e.g. arbitrary text strings, fonts, colors, opacities).
- A separate "no watermark" preset or quick toggle outside the dialog.
- Watermark on the in-app canvas preview (only on exported files).
- Writing the author override back into the `.pindou` file.
