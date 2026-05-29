# Blueprint Import Accuracy Enhancement (Rust Desktop)

**Date**: 2026-05-29
**Status**: Approved approach, drafting plan
**Scope**: Tauri desktop only. VS Code extension is a follow-up after this lands and is verified.

## Problem

The blueprint import feature (`导入图纸`) is currently unreliable. Concrete failing case: `temp/kagome_pindou_export.png` (1920×2663, exported from `samples/kagome.pindou` at 63×78) cannot be imported correctly — neither auto-detection nor manual `63×78` produces the right grid. Inspection of the export reveals two compounding bugs in the current Rust importer at [src-tauri/src/commands/blueprint_import.rs](../../../src-tauri/src/commands/blueprint_import.rs):

1. **Header band ignored.** The exporter draws a header area (logo / app name / cell coordinates) at the top of the image before the grid begins. For kagome the grid starts at y≈92, but [`detect_margin`](../../../src-tauri/src/commands/blueprint_import.rs#L199) hard-codes the top margin to `cell_size` (≈30). Sampling starts in the header → garbage colors for every row.
2. **Integer cell-size assumption.** [`detect_cell_size`](../../../src-tauri/src/commands/blueprint_import.rs#L164) only considers integer sizes 15..80. Real exports often have non-integer cell sizes (kagome: 1860px grid ÷ 63 cells ≈ 29.52 px/cell). Even when the user manually provides `grid_width=63 grid_height=78`, the code falls back to `img_w / (grid_width + 1) = 30` — a wrong integer that drifts a full cell over 63 columns.

Additionally, the existing detection has no notion of the legend area below the grid, so [`detect_grid_height`](../../../src-tauri/src/commands/blueprint_import.rs#L210) can walk past the real grid boundary into the legend text.

## Goals

- **New exports** (PNG made by the updated exporter) reimport with ≥99% cell accuracy via the metadata fast path. This covers the user's primary go-forward workflow.
- **Existing exports without metadata** (including the user's reported `temp/kagome_pindou_export.png`) reimport with ≥95% cell accuracy via the improved detection algorithm. This covers the user's reported failing case and third-party / screenshotted blueprints.
- All existing synthetic round-trip tests in [`blueprint_test.rs`](../../../src-tauri/src/commands/blueprint_test.rs) keep passing.
- A new real-image regression test pins the kagome case so future changes cannot silently regress it.

## Non-Goals

- VS Code extension blueprint import — currently throws "not supported" and stays that way for this milestone. Follow-up after Rust lands.
- Browser TS importer changes — same; follow-up.
- JPEG metadata (no equivalent of PNG `tEXt`). JPEGs continue to go through detection only.
- OCR / text recognition mode. Already disabled, keep disabled.
- Watermark removal from cell colors. Existing median-after-outlier-filter is good enough; not changing.

## Design

Two complementary mechanisms, both in [src-tauri/src/commands/](../../../src-tauri/src/commands/):

### Part A — PNG metadata round-trip

**Export side** ([image_export.rs](../../../src-tauri/src/commands/image_export.rs)): when output format is PNG, write a single PNG `tEXt` chunk with:

- keyword: `pindouverse-blueprint`
- value (UTF-8 JSON):
  ```json
  {
    "v": 1,
    "gridWidth": 63,
    "gridHeight": 78,
    "cellSize": 29.524,
    "marginX": 30,
    "marginY": 30,
    "headerHeight": 60,
    "startX": 1,
    "startY": 1,
    "edgePadding": 0
  }
  ```
  Where `marginY` is the extra margin BELOW the header, and `headerHeight` is the height of the header band (0 when no watermark.showHeader). Total Y offset to first grid cell = `headerHeight + marginY`.

**Implementation note**: the `image` crate's PNG encoder supports custom chunks via `png::Encoder::set_text_chunk`, but the higher-level `image::save_buffer_with_format` does not expose chunk APIs. We will switch the PNG export path to use the lower-level `png` crate's encoder directly. JPEG continues using `image::save_buffer_with_format`.

**Import side** ([blueprint_import.rs](../../../src-tauri/src/commands/blueprint_import.rs)): replace the current `ImageReader::open(...).decode()` call with the `png` crate's decoder for PNGs, which gives access to `Info.uncompressed_latin1_text` / `Info.utf8_text`. Look for keyword `pindouverse-blueprint`, parse JSON, and if `v==1`:
- Skip all detection.
- Compute cell pixel coords as floats: `x = marginX + col × cellSize`, `y = headerHeight + marginY + row × cellSize`.
- Round to integers per cell when calling `sample_cell_color`.
- Set `cell_size_detected = round(cellSize)` and `confidence = 1.0` in the result.

JPEGs and PNGs without the chunk fall through to Part B.

### Part B — Improved detection (no metadata)

Replace the three `detect_*` functions with a single `detect_grid_bbox` that finds the rectangular grid region first, then derives cell size:

**Step 1: Per-row / per-column dark-pixel density**
```rust
let row_dark: Vec<u32> = (0..h).map(|y| count_dark_pixels_in_row(img, y, lum_threshold)).collect();
let col_dark: Vec<u32> = (0..w).map(|x| count_dark_pixels_in_col(img, x, lum_threshold)).collect();
```

**Step 2: Identify "grid block" rows**
A grid row is one whose `row_dark` is between `0.05 × w` and `0.95 × w` (sparse rows = header padding; ≥0.95 = horizontal grid line at a cell boundary, still inside grid; <0.05 = outside grid). Find the longest contiguous run of rows where `row_dark > 0.05 × w` AND no row in the run has `row_dark > 1.5 × median`. This excludes the legend (which has a different density pattern dominated by text rows).

Same for columns.

The bounding box `(left, top, right, bottom)` is the start/end of this longest run on each axis.

**Step 3: Horizontal grid lines = row_dark spikes ≥ 0.7 × w within the bbox**
- Each spike index is a horizontal cell-boundary y-coordinate.
- Number of spikes − 1 = number of grid rows.
- Compute `cell_size_y = (last_spike - first_spike) / (spikes - 1)` as float.
- Same for vertical.
- If detected row count and column count disagree on cell_size by > 10%, fall back to using the user-provided `grid_width` / `grid_height` to compute cell_size as `(right - left) / grid_width`.

**Step 4: When user provides grid_width / grid_height**
- Still run Steps 1-2 to find bbox.
- Skip Step 3 spike counting; compute `cell_size = (right - left) / grid_width` directly.
- This is the case for the kagome example (user knows it's 63×78 but can't get a clean import) — bbox detection is the missing piece.

**Step 5: Cell sampling**
- Use float `cell_size_x`, `cell_size_y`. For cell (row, col):
  ```rust
  let x0 = (left as f64 + col as f64 * cell_size_x).round() as u32;
  let y0 = (top as f64 + row as f64 * cell_size_y).round() as u32;
  let cs_x = (left as f64 + (col + 1) as f64 * cell_size_x).round() as u32 - x0;
  let cs_y = (top as f64 + (row + 1) as f64 * cell_size_y).round() as u32 - y0;
  ```
- Pass `cs_x` and `cs_y` to `sample_cell_color` (current API only takes one `cell_size`; extend to accept two).
- Existing `sample_cell_color` median + text/white filtering stays as-is.

### Test plan

Located in [`src-tauri/src/commands/blueprint_test.rs`](../../../src-tauri/src/commands/blueprint_test.rs) and a new `tests/` folder for the regression fixture.

**Keep**: all 6 existing synthetic round-trip tests (`test_roundtrip_10x10`, `test_roundtrip_52x52`, `test_roundtrip_100x100`, `test_roundtrip_100x100_jpeg`, `test_roundtrip_52x52_padding1`, `test_roundtrip_100x100_padding2_jpeg`). These exercise the detection path — must keep passing after Part B rewrite. JPEG tests prove no-metadata fallback still works.

**New tests**:
1. **`test_metadata_chunk_roundtrip`** — export a 20×20 PNG, inspect bytes with `png` crate to verify the `pindouverse-blueprint` tEXt chunk is present and parseable. Then import and assert `confidence == 1.0` (signals metadata path was used).
2. **`test_metadata_path_exact_reconstruction`** — round-trip a 73×98 grid (matches kagome dimensions) with non-integer cell_size like 29.524 and header. Import via metadata path. Assert 100% cell accuracy.
3. **`test_real_kagome_export`** — copy `temp/kagome_pindou_export.png` to `src-tauri/tests/fixtures/kagome_pindou_export.png` and a JSON dump of `samples/kagome.pindou`'s `canvasData` to `src-tauri/tests/fixtures/kagome_truth.json`. This PNG was made by the OLD exporter so contains no metadata chunk → forces detection path. Import with no grid hints, assert ≥95% cell accuracy. This is the user's actual failing case and acts as the perma-regression for Part B.
4. **`test_detection_with_user_provided_grid`** — same fixture, but call import with `grid_width=63, grid_height=78`. Detection should use the user hint to compute float `cell_size = (right-left)/63`. Assert ≥97% cell accuracy (slightly higher than #3 because we skip the noisy spike-counting step).

### Migration / Backwards compatibility

- Old PNG exports (no `pindouverse-blueprint` chunk) → fall through to Part B detection, which is also better than the current code → strict improvement, no regression risk.
- New PNG exports → contain the chunk → fast path. If user opens such a PNG in any image viewer the chunk is invisible (tEXt is metadata, not rendered).
- The chunk adds <300 bytes to the PNG; negligible.
- Older importer versions that don't know the chunk → ignore it, fall through to detection (no breakage).

## Out of scope (next milestones)

- VS Code extension: enable blueprint import once Rust is stable. Will likely require porting the algorithm to TypeScript or routing through a host-side child process.
- Browser version ([browser.ts](../../../src/adapters/browser.ts)) has its own TS importer; bring it to parity later.
- JPEG: continues to go through detection only. If user demands metadata for JPEG too, can use EXIF UserComment but that's separate work.

## Open risks

- **Detection robustness on non-blueprint inputs.** Step 2's "longest contiguous run with sparse outliers" heuristic might trip on photos or non-pixel-art images. Mitigation: if `detect_grid_bbox` confidence is low (e.g., bbox is < 50% of image area, or cell_size variance > 20%), return the existing "Could not detect grid structure" error instead of producing garbage.
- **PNG encoder migration**. Switching from `image::save_buffer_with_format` to the `png` crate directly is a small surface but must preserve the exact current output (colors, alpha, dimensions). Cover with a byte-identity check on existing synthetic round-trip tests.
