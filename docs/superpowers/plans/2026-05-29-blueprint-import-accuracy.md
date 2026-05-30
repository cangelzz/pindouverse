# Blueprint Import Accuracy — Implementation Plan (Rust Desktop)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reimporting our own PNG exports reaches ≥99% cell accuracy via a fast metadata path; reimporting metadata-less third-party blueprints (including the user's failing `kagome_pindou_export.png`) reaches ≥95% via improved grid-bbox detection.

**Architecture:** PNG export switches from `image::save_with_format` to the lower-level `png` crate so we can write a `tEXt` chunk holding precise `gridWidth/gridHeight/cellSize/originX/originY`. PNG import reads that chunk first (100% accurate fast path) and falls back to a rewritten `detect_grid_bbox` that finds the grid region by per-row/col dark-pixel density (skipping header band + legend) then uses float cell size when the chunk is absent. Cell sampling logic (median + outlier filter) is preserved.

**Tech Stack:** Rust (Tauri backend), `image` crate 0.25, `png` crate 0.17, serde_json.

**Spec:** [docs/superpowers/specs/2026-05-29-blueprint-import-accuracy-design.md](../specs/2026-05-29-blueprint-import-accuracy-design.md)

---

## File Structure

**New files:**
- `src-tauri/tests/blueprint_real_image.rs` — integration test for real-image regression (fixtures live next to it).
- `src-tauri/tests/fixtures/kagome_pindou_export.png` — copied from `temp/kagome_pindou_export.png` (1.4 MB).
- `src-tauri/tests/fixtures/kagome_truth.json` — dump of `samples/kagome.pindou`'s `canvasData` + the MARD palette mapping, so the test doesn't need the TS code.

**Modified files:**
- `src-tauri/Cargo.toml` — add `png = "0.17"`.
- `src-tauri/src/commands/image_export.rs` — switch PNG branch to use `png` crate, emit `pindouverse-blueprint` tEXt chunk. JPEG branch unchanged.
- `src-tauri/src/commands/blueprint_import.rs` — read tEXt chunk (fast path); rewrite `detect_cell_size` / `detect_margin` / `detect_grid_height` into a single `detect_grid_bbox`; cell sampling uses float cell-size in X and Y.
- `src-tauri/src/commands/blueprint_test.rs` — add metadata-roundtrip test + metadata-path-exact-reconstruction test.

**Untouched in this milestone:**
- `src/adapters/browser.ts` — browser TS importer (follow-up).
- `platforms/vscode/src/vscodeAdapter.ts` — VS Code import still disabled (follow-up).

---

## Task 1: Branch + add `png` crate dependency

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Create the feature branch from main**

```bash
cd q:/repo/pindou
git checkout main
git checkout -b feature/blueprint-import-accuracy
```

- [ ] **Step 2: Add `png` crate to `src-tauri/Cargo.toml`**

Find the `[dependencies]` section (around lines 20-30). Add this line right after `image = "0.25"`:

```toml
png = "0.17"
```

- [ ] **Step 3: Verify the build still compiles**

```bash
cd src-tauri && cargo build --release 2>&1 | tail -5
```

Expected: `Finished release [optimized] target(s) in …s`. No new errors.

- [ ] **Step 4: Run the existing Rust tests as a baseline**

```bash
cd src-tauri && cargo test --release blueprint 2>&1 | tail -20
```

Expected: all currently-passing tests still pass. Note any failures here as preexisting (none expected; this task only adds a dep).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "deps(tauri): add png crate for PNG tEXt chunk read/write

Needed to attach a 'pindouverse-blueprint' metadata chunk during
export and read it on import. The image crate's high-level
save_with_format does not expose chunk APIs."
```

---

## Task 2: Switch PNG export branch to the `png` crate (no metadata yet, byte-equivalent)

**Files:**
- Modify: `src-tauri/src/commands/image_export.rs` (PNG branch around lines 416-419)

- [ ] **Step 1: Add the helper function for PNG encoding**

Add this helper near the top of `image_export.rs`, right after the imports:

```rust
/// Encode an RGBA image to a PNG file. Optional text_chunks are written as
/// PNG tEXt chunks before IDAT. Keep keyword + value Latin-1 (PNG spec); we
/// only use ASCII keys + JSON values which are ASCII-safe.
fn write_png(path: &str, img: &image::RgbaImage, text_chunks: &[(&str, &str)]) -> Result<(), String> {
    let file = std::fs::File::create(path)
        .map_err(|e| format!("Failed to create PNG file: {}", e))?;
    let w = std::io::BufWriter::new(file);
    let (width, height) = img.dimensions();
    let mut encoder = png::Encoder::new(w, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    for (k, v) in text_chunks {
        encoder
            .add_text_chunk(k.to_string(), v.to_string())
            .map_err(|e| format!("Failed to add PNG text chunk: {}", e))?;
    }
    let mut writer = encoder
        .write_header()
        .map_err(|e| format!("Failed to write PNG header: {}", e))?;
    writer
        .write_image_data(img.as_raw())
        .map_err(|e| format!("Failed to write PNG data: {}", e))?;
    Ok(())
}
```

- [ ] **Step 2: Replace the PNG branch in `export_image`**

Find the existing PNG branch in `export_image` (around line 416):

```rust
        _ => {
            img.save_with_format(&request.output_path, image::ImageFormat::Png)
                .map_err(|e| format!("Failed to save PNG: {}", e))?;
        }
```

Replace with:

```rust
        _ => {
            // Use png crate directly so we can attach a metadata chunk in
            // Task 3. No chunks yet — behavior should be byte-equivalent to
            // the old image::save_with_format call for the synthetic tests.
            write_png(&request.output_path, &img, &[])?;
        }
```

- [ ] **Step 3: Run existing synthetic round-trip tests**

```bash
cd src-tauri && cargo test --release blueprint 2>&1 | tail -25
```

Expected: all 6 existing round-trip tests pass (`test_roundtrip_10x10`, `test_roundtrip_52x52`, `test_roundtrip_100x100`, `test_roundtrip_100x100_jpeg`, `test_roundtrip_52x52_padding1`, `test_roundtrip_100x100_padding2_jpeg`) plus `test_cielab_distance`.

If any fail, the encoder swap broke pixel output — debug before continuing (likely cause: wrong color type or alpha handling).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/image_export.rs
git commit -m "refactor(export): use png crate directly for PNG output

Behavior-preserving migration to enable a metadata tEXt chunk in the
next commit. Existing synthetic round-trip tests verify the byte
output is unchanged."
```

---

## Task 3: Embed `pindouverse-blueprint` metadata chunk on PNG export

**Files:**
- Modify: `src-tauri/src/commands/image_export.rs` (export_image function)

- [ ] **Step 1: Add the metadata struct + JSON-encoder helper near the top of `image_export.rs`**

Add right after the `write_png` helper from Task 2:

```rust
/// Metadata chunk schema embedded in PNG exports as a `pindouverse-blueprint`
/// tEXt chunk. The importer's fast path reads this and skips all detection.
#[derive(serde::Serialize)]
struct BlueprintMetadata {
    v: u32,
    #[serde(rename = "gridWidth")]
    grid_width: u32,
    #[serde(rename = "gridHeight")]
    grid_height: u32,
    #[serde(rename = "cellSize")]
    cell_size: u32,
    /// X pixel coord of the top-left of the first grid cell (excluding any
    /// outer border/padding that's not part of the grid sampling area).
    #[serde(rename = "originX")]
    origin_x: u32,
    /// Y pixel coord of the top-left of the first grid cell. This is
    /// `header_height + margin` in the exporter's layout.
    #[serde(rename = "originY")]
    origin_y: u32,
}
```

- [ ] **Step 2: Compute origin_y at the exporter and pass metadata to `write_png`**

In `export_image`, locate where the PNG branch is reached (after legend rendering, after the existing `match request.format.as_str() { …` block starts). Just BEFORE the match, compute the metadata:

```rust
    // Build the metadata payload. The grid's origin in pixel coords is:
    //   originX = margin (cells start at x = margin)
    //   originY = header_h + margin (cells start below header band, then margin)
    // The variables `header_h`, `margin`, `cs` are already in scope.
    let metadata = BlueprintMetadata {
        v: 1,
        grid_width: request.width,
        grid_height: request.height,
        cell_size: cs,
        origin_x: margin,
        origin_y: header_h + margin,
    };
    let metadata_json = serde_json::to_string(&metadata)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;
```

- [ ] **Step 3: Pass the metadata into `write_png` in the PNG branch**

Update the PNG branch to:

```rust
        _ => {
            write_png(
                &request.output_path,
                &img,
                &[("pindouverse-blueprint", &metadata_json)],
            )?;
        }
```

The JPEG branch is unchanged (no equivalent metadata).

- [ ] **Step 4: Add a unit test that verifies the chunk is written**

In `src-tauri/src/commands/blueprint_test.rs`, append inside the existing `mod tests { … }`:

```rust
    #[test]
    fn test_metadata_chunk_roundtrip() {
        use crate::commands::image_export::{ExportRequest, export_image};
        let palette = make_test_palette();
        let cells = make_cells(20, 20, &palette);

        let test_dir = std::env::temp_dir().join("pindouverse_test");
        std::fs::create_dir_all(&test_dir).unwrap();
        let export_path = test_dir.join("test_metadata_20x20.png");
        let path_str = export_path.to_string_lossy().to_string();

        let request = ExportRequest {
            width: 20,
            height: 20,
            cell_size: 25,
            cells: cells.clone(),
            output_path: path_str.clone(),
            format: "png".to_string(),
            start_x: Some(1),
            start_y: Some(1),
            edge_padding: Some(0),
            watermark: None,
        };
        export_image(request).expect("Export failed");

        // Read the file with the png crate and look for our tEXt chunk.
        let decoder = png::Decoder::new(std::fs::File::open(&export_path).unwrap());
        let reader = decoder.read_info().expect("decode info");
        let info = reader.info();
        let chunk = info
            .uncompressed_latin1_text
            .iter()
            .find(|c| c.keyword == "pindouverse-blueprint")
            .or_else(|| {
                info.utf8_text.iter().find(|c| c.keyword == "pindouverse-blueprint").map(|c| {
                    // The utf8_text variant has a different value type; we
                    // need a Latin-1 fallback for the parse. Convert below.
                    panic!("unexpected utf8 chunk; we wrote ASCII via add_text_chunk");
                })
            })
            .expect("pindouverse-blueprint chunk not found");

        // Parse JSON and verify fields.
        let v: serde_json::Value = serde_json::from_str(&chunk.text).expect("JSON parse");
        assert_eq!(v["v"], 1);
        assert_eq!(v["gridWidth"], 20);
        assert_eq!(v["gridHeight"], 20);
        assert_eq!(v["cellSize"], 25);
        assert_eq!(v["originX"], 25); // margin = cs = 25
        assert_eq!(v["originY"], 25); // no watermark → header_h = 0; total = 0 + 25

        // Cleanup
        let _ = std::fs::remove_file(&export_path);
    }
```

- [ ] **Step 5: Run only the new test first**

```bash
cd src-tauri && cargo test --release test_metadata_chunk_roundtrip 2>&1 | tail -15
```

Expected: PASS.

If FAILED: most likely the chunk lands in `utf8_text` instead of `uncompressed_latin1_text`. Adjust the lookup or use `info.uncompressed_latin1_text.iter().chain(...)` to handle both. The test should not panic on the unexpected branch.

- [ ] **Step 6: Run the full blueprint test suite to confirm no regressions**

```bash
cd src-tauri && cargo test --release blueprint 2>&1 | tail -15
```

Expected: 7 tests pass (6 existing + 1 new).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/image_export.rs src-tauri/src/commands/blueprint_test.rs
git commit -m "feat(export): embed pindouverse-blueprint metadata in PNG tEXt chunk

Stores gridWidth/gridHeight/cellSize/originX/originY so the importer
can skip detection entirely on round-trips. JSON value <300 bytes;
invisible to image viewers; ignored by older importers."
```

---

## Task 4: Add fast-path metadata reader in blueprint_import

**Files:**
- Modify: `src-tauri/src/commands/blueprint_import.rs` (top imports + new function + import_blueprint dispatch)
- Modify: `src-tauri/src/commands/blueprint_test.rs` (new test)

- [ ] **Step 1: Add a metadata reader function near the top of `blueprint_import.rs`**

Insert this after the existing `detect_format` function (around line 131):

```rust
#[derive(serde::Deserialize)]
struct BlueprintMetadataRead {
    v: u32,
    #[serde(rename = "gridWidth")]
    grid_width: u32,
    #[serde(rename = "gridHeight")]
    grid_height: u32,
    #[serde(rename = "cellSize")]
    cell_size: u32,
    #[serde(rename = "originX")]
    origin_x: u32,
    #[serde(rename = "originY")]
    origin_y: u32,
}

/// Read the `pindouverse-blueprint` tEXt chunk from a PNG if present. Returns
/// None for non-PNG inputs, missing chunks, parse errors, or unsupported
/// schema versions — the caller falls back to detection in all those cases.
fn read_blueprint_metadata(path: &str) -> Option<BlueprintMetadataRead> {
    let file = std::fs::File::open(path).ok()?;
    let decoder = png::Decoder::new(file);
    let reader = decoder.read_info().ok()?;
    let info = reader.info();
    let chunk_text = info
        .uncompressed_latin1_text
        .iter()
        .find(|c| c.keyword == "pindouverse-blueprint")
        .map(|c| c.text.clone())
        .or_else(|| {
            info.utf8_text
                .iter()
                .find(|c| c.keyword == "pindouverse-blueprint")
                .and_then(|c| c.get_text().ok())
        })?;
    let parsed: BlueprintMetadataRead = serde_json::from_str(&chunk_text).ok()?;
    if parsed.v != 1 {
        return None;
    }
    Some(parsed)
}
```

- [ ] **Step 2: Add the fast path at the top of `import_blueprint`**

In `import_blueprint`, just AFTER the image is decoded (after `let img = ImageReader::open(...)…to_rgba8();` around line 451), add:

```rust
    // Fast path: if the PNG carries our metadata chunk, we know exactly where
    // the grid sits and what the cell size is — skip all detection.
    if let Some(meta) = read_blueprint_metadata(&request.path) {
        let mut color_results: Vec<Vec<(String, f64)>> = Vec::new();
        let mut total_confidence = 0.0;
        let mut cell_count = 0u32;
        for row in 0..meta.grid_height {
            let mut row_results: Vec<(String, f64)> = Vec::new();
            for col in 0..meta.grid_width {
                let x0 = meta.origin_x + col * meta.cell_size;
                let y0 = meta.origin_y + row * meta.cell_size;
                match sample_cell_color(&img, x0, y0, meta.cell_size, &config) {
                    Some((r, g, b)) => {
                        let (code, conf) = match_color(r, g, b, &request.palette);
                        row_results.push((code, conf));
                        total_confidence += conf;
                        cell_count += 1;
                    }
                    None => {
                        row_results.push((String::new(), 1.0));
                    }
                }
            }
            color_results.push(row_results);
        }
        let avg_confidence = if cell_count > 0 { total_confidence / cell_count as f64 } else { 1.0 };

        // Use the existing build-result logic. Extract into a helper so we
        // don't duplicate it between fast-path and detect-path.
        return Ok(build_import_result(
            meta.grid_width,
            meta.grid_height,
            meta.cell_size,
            meta.origin_x,
            meta.origin_y,
            &img,
            &color_results,
            &request.palette,
            avg_confidence,
            mode,
        ));
    }
```

The `build_import_result` helper doesn't exist yet — we extract it from the existing tail of `import_blueprint` in the next step.

- [ ] **Step 3: Extract `build_import_result` from the existing tail of `import_blueprint`**

The tail of `import_blueprint` (from line ~501 onward) builds the result by computing has_text_grid and assembling `cells / color_cells / text_cells_flat`. Move this into a new helper:

```rust
fn build_import_result(
    grid_w: u32,
    grid_h: u32,
    cell_size: u32,
    origin_x: u32,
    origin_y: u32,
    img: &RgbaImage,
    color_results: &[Vec<(String, f64)>],
    palette: &[PaletteColor],
    avg_confidence: f64,
    mode: ImportMode,
) -> BlueprintImportResult {
    // Detect which cells have text (to distinguish empty vs white/H2)
    let mut has_text_grid: Vec<Vec<bool>> = vec![vec![false; grid_w as usize]; grid_h as usize];
    let text_detect_tasks: Vec<(u32, u32, u32, u32)> = (0..grid_h)
        .flat_map(|row| (0..grid_w).map(move |col| (row, col, origin_x + col * cell_size, origin_y + row * cell_size)))
        .collect();

    let text_detect_results: Vec<(u32, u32, bool)> = text_detect_tasks.par_iter()
        .map(|&(row, col, x0, y0)| {
            let cell_bin = extract_cell_binary(img, x0, y0, cell_size);
            (row, col, cell_has_text(&cell_bin, cell_size))
        })
        .collect();

    for (row, col, has_text) in text_detect_results {
        has_text_grid[row as usize][col as usize] = has_text;
    }

    let mut cells: Vec<Vec<CellResult>> = Vec::new();
    let mut color_cells: Vec<Vec<String>> = Vec::new();
    let mut text_cells_flat: Vec<Vec<String>> = Vec::new();

    for row in 0..grid_h as usize {
        let mut cell_row: Vec<CellResult> = Vec::new();
        let mut color_row: Vec<String> = Vec::new();
        let mut text_row: Vec<String> = Vec::new();
        for col in 0..grid_w as usize {
            let (ref cc, cc_conf) = color_results[row][col];
            let has_text = has_text_grid[row][col];
            let is_white_color = if let Some(pc) = palette.iter().find(|p| p.code == *cc) {
                pc.r > 248 && pc.g > 248 && pc.b > 248
            } else {
                cc.is_empty()
            };
            let is_empty = cc.is_empty() || (is_white_color && !has_text);
            if is_empty {
                cell_row.push(CellResult {
                    color_code: String::new(), color_confidence: 1.0,
                    text_code: String::new(), text_confidence: 0.0,
                    final_code: String::new(), source: CellSource::Color,
                });
                color_row.push(String::new());
                text_row.push(String::new());
            } else {
                cell_row.push(CellResult {
                    color_code: cc.clone(), color_confidence: cc_conf,
                    text_code: String::new(), text_confidence: 0.0,
                    final_code: cc.clone(), source: CellSource::Color,
                });
                color_row.push(cc.clone());
                text_row.push(String::new());
            }
        }
        cells.push(cell_row);
        color_cells.push(color_row);
        text_cells_flat.push(text_row);
    }

    BlueprintImportResult {
        width: grid_w,
        height: grid_h,
        cells,
        color_cells,
        text_cells: text_cells_flat,
        mismatch_count: 0,
        mismatches: Vec::new(),
        severity_summary: SeveritySummary { high: 0, medium: 0, low: 0 },
        cell_size_detected: cell_size,
        confidence: avg_confidence,
        mode,
    }
}
```

Then in the existing detect-path of `import_blueprint`, replace its tail (everything from `// Step 5: Detect which cells have text` through the final `Ok(BlueprintImportResult { … })`) with:

```rust
    Ok(build_import_result(
        grid_w,
        grid_h,
        cell_size,
        margin,         // origin_x in detect path
        margin,         // origin_y in detect path (preserves current behavior)
        &img,
        &color_results,
        &request.palette,
        avg_confidence,
        mode,
    ))
```

Note: this preserves the current (buggy) detect-path behavior — it still assumes `origin_y = margin` (no header). Task 6 fixes that. We refactor first so the fast path lands without disturbing existing tests.

- [ ] **Step 4: Add the metadata-path-exact-reconstruction test**

In `src-tauri/src/commands/blueprint_test.rs`, append inside the `mod tests { … }`:

```rust
    #[test]
    fn test_metadata_path_exact_reconstruction() {
        // Round-trip a non-square grid and verify the metadata path gives
        // 100% cell accuracy (no detection involved).
        let palette = make_test_palette();
        let w: u32 = 73;
        let h: u32 = 98;
        let cells = make_cells(w, h, &palette);

        let test_dir = std::env::temp_dir().join("pindouverse_test");
        std::fs::create_dir_all(&test_dir).unwrap();
        let export_path = test_dir.join(format!("test_meta_{}x{}.png", w, h));
        let path_str = export_path.to_string_lossy().to_string();

        let request = crate::commands::image_export::ExportRequest {
            width: w,
            height: h,
            cell_size: 20,
            cells: cells.clone(),
            output_path: path_str.clone(),
            format: "png".to_string(),
            start_x: Some(1),
            start_y: Some(1),
            edge_padding: Some(0),
            watermark: None,
        };
        crate::commands::image_export::export_image(request).expect("Export failed");

        let import_request = BlueprintImportRequest {
            path: path_str.clone(),
            palette: palette.clone(),
            grid_width: None,
            grid_height: None,
            mode: None,
        };
        let result = import_blueprint(import_request).expect("Import failed");

        assert_eq!(result.width, w);
        assert_eq!(result.height, h);
        assert_eq!(result.cell_size_detected, 20);
        assert_eq!(result.confidence, 1.0, "Metadata path should report perfect confidence");

        let mut mismatches = 0;
        for row in 0..h as usize {
            for col in 0..w as usize {
                let expected = &cells[row][col].as_ref().unwrap().color_code;
                let got = &result.cells[row][col].final_code;
                if expected != got { mismatches += 1; }
            }
        }
        assert_eq!(mismatches, 0, "Metadata path should give 100% accuracy, got {} mismatches", mismatches);

        let _ = std::fs::remove_file(&export_path);
    }
```

- [ ] **Step 5: Run new test + verify no existing tests broke**

```bash
cd src-tauri && cargo test --release blueprint 2>&1 | tail -20
```

Expected: 8 tests pass (6 existing + Task 3's metadata chunk test + this metadata exact-reconstruction test).

If any of the 6 existing tests break, the refactor of `build_import_result` lost behavior — diff carefully against the original tail.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/blueprint_import.rs src-tauri/src/commands/blueprint_test.rs
git commit -m "feat(import): fast path via pindouverse-blueprint metadata chunk

PNG imports first try to read the tEXt chunk and, if present, sample
cells at exact recorded coords with confidence=1.0. Falls back to
the existing detection path when the chunk is missing (third-party
PNGs, JPEGs, older exports). Extracts the result-assembly tail into
a build_import_result helper so both paths share it."
```

---

## Task 5: Drop the failing real-image regression test (proves the bug)

**Files:**
- Create: `src-tauri/tests/fixtures/kagome_pindou_export.png` (copy from `temp/`)
- Create: `src-tauri/tests/fixtures/kagome_truth.json` (canvasData + palette from sample)
- Create: `src-tauri/tests/blueprint_real_image.rs`
- Create: `src-tauri/tests/fixtures/.gitkeep` if directory needs initial commit

- [ ] **Step 1: Create the fixtures directory and copy the kagome export**

```bash
cd q:/repo/pindou
mkdir -p src-tauri/tests/fixtures
cp temp/kagome_pindou_export.png src-tauri/tests/fixtures/kagome_pindou_export.png
ls -la src-tauri/tests/fixtures/
```

Expected: the 1.4 MB PNG sits in `src-tauri/tests/fixtures/`.

- [ ] **Step 2: Generate the truth JSON**

Run this from repo root (uses Python — preinstalled with PIL/json):

```bash
python -c "
import json
from pathlib import Path
sample = json.load(open('samples/kagome.pindou', encoding='utf-8'))
mard = []
# Parse src/data/mard221.ts to extract code + rgb. Crude regex parser.
import re
text = open('src/data/mard221.ts', encoding='utf-8').read()
for m in re.finditer(r'\{\s*code:\s*\"([^\"]+)\",[^}]*rgb:\s*\[(\d+),\s*(\d+),\s*(\d+)\]', text):
    mard.append({'code': m.group(1), 'r': int(m.group(2)), 'g': int(m.group(3)), 'b': int(m.group(4))})
print(f'Parsed {len(mard)} MARD colors')

# canvasData has shape [height][width] of {colorIndex: int|null}
canvas_data = sample['canvasData']
# Convert to [[code|''], …] flat for the test
truth_codes = []
for row in canvas_data:
    truth_codes.append([mard[c['colorIndex']]['code'] if c['colorIndex'] is not None else '' for c in row])

out = {
    'width': sample['canvasSize']['width'],
    'height': sample['canvasSize']['height'],
    'palette': mard,
    'truth_codes': truth_codes,
}
Path('src-tauri/tests/fixtures/kagome_truth.json').write_text(json.dumps(out), encoding='utf-8')
print('width:', out['width'], 'height:', out['height'], 'first non-empty:', next((c for row in truth_codes for c in row if c), None))
"
```

Expected: prints `Parsed 295 MARD colors` (or close), `width: 63 height: 78`, and a code like `H2` or similar. The file `src-tauri/tests/fixtures/kagome_truth.json` exists (~500 KB).

- [ ] **Step 3: Write the integration test file**

Create `src-tauri/tests/blueprint_real_image.rs` with this content:

```rust
//! Real-image regression tests for blueprint import. Each test loads a
//! fixture from `tests/fixtures/`, runs the importer against it, and
//! asserts a cell-accuracy floor against a known-good truth JSON.

use pindouverse::commands::blueprint_import::{
    import_blueprint, BlueprintImportRequest, PaletteColor,
};
use serde::Deserialize;
use std::fs;
use std::path::PathBuf;

#[derive(Deserialize)]
struct Truth {
    width: u32,
    height: u32,
    palette: Vec<PaletteEntry>,
    truth_codes: Vec<Vec<String>>,
}

#[derive(Deserialize)]
struct PaletteEntry {
    code: String,
    r: u8,
    g: u8,
    b: u8,
}

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures")
}

fn load_truth(name: &str) -> Truth {
    let path = fixtures_dir().join(name);
    let txt = fs::read_to_string(&path).expect("truth json");
    serde_json::from_str(&txt).expect("parse truth json")
}

fn to_palette(truth: &Truth) -> Vec<PaletteColor> {
    truth.palette.iter().map(|p| PaletteColor {
        code: p.code.clone(),
        r: p.r,
        g: p.g,
        b: p.b,
    }).collect()
}

fn count_matches(result_codes: &[Vec<String>], truth_codes: &[Vec<String>]) -> (usize, usize) {
    let mut ok = 0usize;
    let mut total = 0usize;
    for (row_r, row_t) in result_codes.iter().zip(truth_codes.iter()) {
        for (cr, ct) in row_r.iter().zip(row_t.iter()) {
            total += 1;
            if cr == ct { ok += 1; }
        }
    }
    (ok, total)
}

#[test]
fn test_real_kagome_export() {
    // The kagome PNG fixture was made by the OLD exporter (no metadata
    // chunk) — this forces the detection path. Target: ≥95% cell accuracy.
    let truth = load_truth("kagome_truth.json");
    let palette = to_palette(&truth);
    let png = fixtures_dir().join("kagome_pindou_export.png");
    assert!(png.exists(), "kagome fixture missing — run `cp temp/kagome_pindou_export.png src-tauri/tests/fixtures/`");

    let req = BlueprintImportRequest {
        path: png.to_string_lossy().into_owned(),
        palette,
        grid_width: None,
        grid_height: None,
        mode: None,
    };
    let result = import_blueprint(req).expect("import");
    assert_eq!(result.width, truth.width, "detected width wrong");
    assert_eq!(result.height, truth.height, "detected height wrong");

    let result_codes: Vec<Vec<String>> = result.cells.iter()
        .map(|row| row.iter().map(|c| c.final_code.clone()).collect())
        .collect();
    let (ok, total) = count_matches(&result_codes, &truth.truth_codes);
    let accuracy = ok as f64 / total as f64;
    eprintln!("kagome (no metadata, auto-detect): {}/{} = {:.2}%", ok, total, accuracy * 100.0);
    assert!(accuracy >= 0.95, "Accuracy {:.2}% below 95% floor — detection still drifts", accuracy * 100.0);
}
```

- [ ] **Step 4: Make the crate's library exports public for integration tests**

Integration tests reach the crate as `pindouverse::...`. Check that `src-tauri/src/lib.rs` declares the crate properly:

```bash
head -5 src-tauri/src/lib.rs
```

If `commands::blueprint_import` is not already `pub`, edit `src-tauri/src/lib.rs` and ensure:

```rust
pub mod commands;
```

If the line already says `mod commands;` change it to `pub mod commands;`. And in `src-tauri/src/commands/mod.rs`, ensure `pub mod blueprint_import;` (not just `mod ...`).

- [ ] **Step 5: Run the new integration test and watch it FAIL**

```bash
cd src-tauri && cargo test --release --test blueprint_real_image 2>&1 | tail -15
```

Expected: the test FAILS with one of:
- `Accuracy XX% below 95% floor` (most likely — detection drifts as predicted)
- or `detected width wrong` / `detected height wrong` (also likely — header band confuses detection)

This is the perma-regression for the bug. Note the exact accuracy reported so Task 6 can confirm improvement.

- [ ] **Step 6: Commit the failing test + fixtures (red baseline)**

```bash
git add src-tauri/tests/blueprint_real_image.rs \
        src-tauri/tests/fixtures/kagome_pindou_export.png \
        src-tauri/tests/fixtures/kagome_truth.json \
        src-tauri/src/lib.rs \
        src-tauri/src/commands/mod.rs
git commit -m "test(import): failing regression for kagome real-image import

Pins the user-reported failure case: temp/kagome_pindou_export.png
imports with garbage colors because the importer assumes top margin
== cell_size (ignoring the header band). Test currently fails by
design — Task 6 fixes detection to make it pass with ≥95% accuracy."
```

---

## Task 6: Rewrite detection — `detect_grid_bbox` + float cell-size

**Files:**
- Modify: `src-tauri/src/commands/blueprint_import.rs` (replace `detect_cell_size` / `detect_margin` / `detect_grid_height` with new `detect_grid_bbox`; update the detect-path of `import_blueprint`)

- [ ] **Step 1: Delete the three obsolete detect functions**

In `src-tauri/src/commands/blueprint_import.rs`, remove:
- `fn detect_cell_size` (around line 164)
- `fn detect_margin` (around line 199)
- `fn detect_grid_height` (around line 210)

These are about to be replaced.

- [ ] **Step 2: Add new bbox + spike-based detector**

Insert this new block where the deleted functions were:

```rust
/// Rectangular pixel region of the actual grid in the image (excluding
/// header bands, side margins, and the legend below the grid).
struct GridBBox {
    left: u32,
    top: u32,
    right: u32,  // exclusive
    bottom: u32, // exclusive
}

/// Count pixels with luminance < threshold in one row.
fn row_dark_count(img: &RgbaImage, y: u32, lum_threshold: f64) -> u32 {
    let (w, _) = img.dimensions();
    let mut count = 0u32;
    for x in 0..w {
        let p = img.get_pixel(x, y);
        let lum = 0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64;
        if lum < lum_threshold { count += 1; }
    }
    count
}

fn col_dark_count(img: &RgbaImage, x: u32, lum_threshold: f64) -> u32 {
    let (_, h) = img.dimensions();
    let mut count = 0u32;
    for y in 0..h {
        let p = img.get_pixel(x, y);
        let lum = 0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64;
        if lum < lum_threshold { count += 1; }
    }
    count
}

/// Find the rectangular grid region by per-axis dark-pixel density. Returns
/// None if no plausible grid block is found (caller surfaces an error).
fn detect_grid_bbox(img: &RgbaImage, lum_threshold: f64) -> Option<GridBBox> {
    let (w, h) = img.dimensions();
    let row_dark: Vec<u32> = (0..h).map(|y| row_dark_count(img, y, lum_threshold)).collect();
    let col_dark: Vec<u32> = (0..w).map(|x| col_dark_count(img, x, lum_threshold)).collect();

    // Per axis, find the longest contiguous run of "in-grid" rows/cols. A row
    // is in-grid if its density is between 5% and 99% of the cross-axis size.
    // Below 5% = padding/header gap. Above 99% = solid black bar (rare).
    let row_lo = (w as f64 * 0.05) as u32;
    let row_hi = (w as f64 * 0.99) as u32;
    let col_lo = (h as f64 * 0.05) as u32;
    let col_hi = (h as f64 * 0.99) as u32;

    let (top, bottom) = longest_run(&row_dark, row_lo, row_hi)?;
    let (left, right) = longest_run(&col_dark, col_lo, col_hi)?;

    // Sanity check: the bbox must cover at least 30% of each axis. If not,
    // we likely detected something else (a logo, a watermark band, …).
    if (bottom - top) * 10 < h * 3 { return None; }
    if (right - left) * 10 < w * 3 { return None; }

    Some(GridBBox { left, top, right: right + 1, bottom: bottom + 1 })
}

/// Longest contiguous run of indices `i` where `lo <= values[i] <= hi`.
/// Returns the inclusive (first, last) of that run, or None if no run.
fn longest_run(values: &[u32], lo: u32, hi: u32) -> Option<(u32, u32)> {
    let mut best: Option<(u32, u32)> = None;
    let mut cur_start: Option<u32> = None;
    for (i, &v) in values.iter().enumerate() {
        let i = i as u32;
        let in_range = v >= lo && v <= hi;
        if in_range {
            if cur_start.is_none() { cur_start = Some(i); }
            let s = cur_start.unwrap();
            let len = i - s + 1;
            match best {
                None => best = Some((s, i)),
                Some((bs, be)) if (i - s + 1) > (be - bs + 1) => best = Some((s, i)),
                _ => {}
            }
            let _ = len;
        } else {
            cur_start = None;
        }
    }
    best
}

/// Given a detected grid bbox + user-known grid dimensions, return the
/// per-cell pixel size (X, Y) as floats.
fn cell_size_from_bbox(bbox: &GridBBox, grid_w: u32, grid_h: u32) -> (f64, f64) {
    let csx = (bbox.right - bbox.left) as f64 / grid_w as f64;
    let csy = (bbox.bottom - bbox.top) as f64 / grid_h as f64;
    (csx, csy)
}

/// Given a detected grid bbox (without known dims), count interior horizontal
/// grid-line spikes to derive grid rows + cell size in Y. Same for X. Returns
/// (grid_w, grid_h, cell_size_x, cell_size_y).
fn count_lines_from_bbox(
    img: &RgbaImage,
    bbox: &GridBBox,
    lum_threshold: f64,
) -> Option<(u32, u32, f64, f64)> {
    let (w, h) = img.dimensions();
    // A spike row is one where the dark-pixel count within the bbox span
    // exceeds 70% of bbox width — that's a horizontal grid line.
    let bbox_w = bbox.right - bbox.left;
    let bbox_h = bbox.bottom - bbox.top;
    let spike_x = (bbox_w as f64 * 0.7) as u32;
    let spike_y = (bbox_h as f64 * 0.7) as u32;

    let mut h_lines: Vec<u32> = Vec::new();
    let mut prev_was_spike = false;
    for y in bbox.top..bbox.bottom {
        let mut dark = 0u32;
        for x in bbox.left..bbox.right.min(w) {
            let p = img.get_pixel(x, y);
            let lum = 0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64;
            if lum < lum_threshold { dark += 1; }
        }
        let is_spike = dark >= spike_x;
        // Merge adjacent spike rows (anti-aliased borders are 2-3 px thick).
        if is_spike && !prev_was_spike { h_lines.push(y); }
        prev_was_spike = is_spike;
    }

    let mut v_lines: Vec<u32> = Vec::new();
    let mut prev_was_spike = false;
    for x in bbox.left..bbox.right {
        let mut dark = 0u32;
        for y in bbox.top..bbox.bottom.min(h) {
            let p = img.get_pixel(x, y);
            let lum = 0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64;
            if lum < lum_threshold { dark += 1; }
        }
        let is_spike = dark >= spike_y;
        if is_spike && !prev_was_spike { v_lines.push(x); }
        prev_was_spike = is_spike;
    }

    if h_lines.len() < 2 || v_lines.len() < 2 { return None; }
    let grid_h = (h_lines.len() - 1) as u32;
    let grid_w = (v_lines.len() - 1) as u32;
    let csy = (h_lines[h_lines.len() - 1] - h_lines[0]) as f64 / grid_h as f64;
    let csx = (v_lines[v_lines.len() - 1] - v_lines[0]) as f64 / grid_w as f64;
    Some((grid_w, grid_h, csx, csy))
}
```

- [ ] **Step 3: Update the detect-path in `import_blueprint`**

Replace the block in `import_blueprint` that begins with `// Step 1-3: Detect grid structure` (around line 455) through `if grid_w == 0 || grid_h == 0 …` with:

```rust
    // Detect-path (no metadata chunk): find the grid bbox first, then either
    // use user-provided dims or count grid-line spikes to derive cell size.
    let bbox = detect_grid_bbox(&img, config.grid_lum_threshold)
        .ok_or("Could not locate a grid region. Is this a blueprint image?")?;

    let (grid_w, grid_h, cs_x, cs_y) = match (request.grid_width, request.grid_height) {
        (Some(gw), Some(gh)) => {
            let (csx, csy) = cell_size_from_bbox(&bbox, gw, gh);
            (gw, gh, csx, csy)
        }
        _ => {
            count_lines_from_bbox(&img, &bbox, config.grid_lum_threshold)
                .ok_or("Could not count grid lines inside the detected region")?
        }
    };

    if grid_w == 0 || grid_h == 0 {
        return Err("Detected grid is too small".to_string());
    }

    let origin_x = bbox.left;
    let origin_y = bbox.top;
```

- [ ] **Step 4: Update the cell-sampling loop to use float cell sizes**

Replace the cell-sampling loop (the existing `for row in 0..grid_h { … sample_cell_color(&img, x0, y0, cell_size, &config) … }`) with:

```rust
    let mut color_results: Vec<Vec<(String, f64)>> = Vec::new();
    let mut total_confidence = 0.0;
    let mut cell_count = 0u32;
    for row in 0..grid_h {
        let mut row_results: Vec<(String, f64)> = Vec::new();
        for col in 0..grid_w {
            let x0_f = origin_x as f64 + col as f64 * cs_x;
            let y0_f = origin_y as f64 + row as f64 * cs_y;
            let x0 = x0_f.round() as u32;
            let y0 = y0_f.round() as u32;
            // Per-cell pixel width can vary by 1px when cs is non-integer;
            // use the smaller of (cs_x, cs_y) rounded for sampling so we
            // stay safely inside the cell.
            let sample_cs = cs_x.min(cs_y).round().max(2.0) as u32;
            match sample_cell_color(&img, x0, y0, sample_cs, &config) {
                Some((r, g, b)) => {
                    let (code, conf) = match_color(r, g, b, &request.palette);
                    row_results.push((code, conf));
                    total_confidence += conf;
                    cell_count += 1;
                }
                None => {
                    row_results.push((String::new(), 1.0));
                }
            }
        }
        color_results.push(row_results);
    }
    let avg_confidence = if cell_count > 0 { total_confidence / cell_count as f64 } else { 1.0 };
```

- [ ] **Step 5: Update the final `build_import_result` call to pass float-derived integer cell size and the new origin**

Replace the final `Ok(build_import_result(…))` call from Task 4 Step 3 with:

```rust
    let cell_size_int = cs_x.round() as u32;
    Ok(build_import_result(
        grid_w,
        grid_h,
        cell_size_int,
        origin_x,
        origin_y,
        &img,
        &color_results,
        &request.palette,
        avg_confidence,
        mode,
    ))
```

- [ ] **Step 6: Run all blueprint tests**

```bash
cd src-tauri && cargo test --release blueprint 2>&1 | tail -25
```

Expected: 8 tests pass (the 6 existing round-trips, the metadata-chunk test, the metadata-exact-reconstruction test). The round-trip tests use OUR exporter → they now carry metadata → fast path → unchanged behavior. Synthetic detection coverage will arrive when the kagome real-image test passes in the next step.

If any round-trip fails, the metadata fast path might be sampling wrong; debug. (Hint: ensure `origin_x = margin` and `origin_y = header_h + margin = 0 + margin = margin` for those tests so the existing roundtrip-test fixtures still pass.)

- [ ] **Step 7: Run the kagome real-image test**

```bash
cd src-tauri && cargo test --release --test blueprint_real_image 2>&1 | tail -15
```

Expected: PASS with accuracy ≥95%. Note the printed accuracy.

If FAIL:
- If `width` / `height` wrong → `detect_grid_bbox` is still off; check `longest_run` outputs by printing `row_dark[0..200]` for the kagome image to see where the grid actually starts.
- If accuracy is e.g. 60-90% → cell sampling drifts mid-grid; check the float-cell math.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/commands/blueprint_import.rs
git commit -m "fix(import): detect grid bbox before cell-size; use float spacing

Replaces detect_cell_size/detect_margin/detect_grid_height (which
assumed top margin == cell_size and integer cell size) with a single
detect_grid_bbox that finds the rectangular grid region via per-axis
dark-pixel density. The bbox excludes header bands and the legend.
Once located, either the user-provided grid dims give cell_size as a
float, or interior grid-line spikes count rows + cols directly.

Cell sampling now positions cells with float arithmetic, rounded
per-cell — no more accumulated drift over hundreds of cells.

Makes the kagome real-image regression test pass at ≥95% accuracy.
The existing synthetic round-trip tests continue to pass through the
metadata fast path (their exports carry the chunk added in earlier
commits)."
```

---

## Task 7: Add `test_detection_with_user_provided_grid` + final verification

**Files:**
- Modify: `src-tauri/tests/blueprint_real_image.rs` (append second test)

- [ ] **Step 1: Append the second test**

In `src-tauri/tests/blueprint_real_image.rs`, add this test below `test_real_kagome_export`:

```rust
#[test]
fn test_detection_with_user_provided_grid() {
    // Same kagome PNG, but caller passes grid_width=63, grid_height=78.
    // This is what the user reports trying: "无论是自动还是输入63x78都无法识别".
    // Detection still has to find the bbox (header band offset), but skips
    // the noisier spike-counting step. Target: ≥97% accuracy.
    let truth = load_truth("kagome_truth.json");
    let palette = to_palette(&truth);
    let png = fixtures_dir().join("kagome_pindou_export.png");

    let req = BlueprintImportRequest {
        path: png.to_string_lossy().into_owned(),
        palette,
        grid_width: Some(truth.width),
        grid_height: Some(truth.height),
        mode: None,
    };
    let result = import_blueprint(req).expect("import");
    assert_eq!(result.width, truth.width);
    assert_eq!(result.height, truth.height);

    let result_codes: Vec<Vec<String>> = result.cells.iter()
        .map(|row| row.iter().map(|c| c.final_code.clone()).collect())
        .collect();
    let (ok, total) = count_matches(&result_codes, &truth.truth_codes);
    let accuracy = ok as f64 / total as f64;
    eprintln!("kagome (no metadata, user-provided 63x78): {}/{} = {:.2}%", ok, total, accuracy * 100.0);
    assert!(accuracy >= 0.97, "User-hint accuracy {:.2}% below 97% floor", accuracy * 100.0);
}
```

- [ ] **Step 2: Run both real-image tests**

```bash
cd src-tauri && cargo test --release --test blueprint_real_image 2>&1 | tail -15
```

Expected: 2 passed. Both kagome cases ≥ their accuracy floors.

- [ ] **Step 3: Run the full Rust test suite once for final confidence**

```bash
cd src-tauri && cargo test --release 2>&1 | tail -10
```

Expected: all tests pass. 8 blueprint unit tests + 2 real-image integration tests + whatever other Rust tests exist.

- [ ] **Step 4: Run the full Playwright suite to confirm nothing in the webview broke**

(This change is Rust-only, but the webview shares the `src/` types and a sanity sweep is cheap.)

```bash
cd platforms/vscode && npx playwright test 2>&1 | tail -5
```

Expected: 73 passed (same as before).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/tests/blueprint_real_image.rs
git commit -m "test(import): kagome with user-provided 63x78 hint, ≥97% target

Pins the 'manual dims still fail' half of the original bug report.
Same fixture, this time the caller provides grid_width/height so
detection only needs to find the bbox (not count lines)."
```

---

## Task 8: STOP — wait for user verification before merging

**Files:** none.

Per the standing rule for this repo: don't merge to main and don't trigger a release before the user has tested the change end-to-end on their own machine.

- [ ] **Step 1: Report the test outcomes to the user**

Print a summary message:

```
Branch: feature/blueprint-import-accuracy
Commits ahead of main: 5
  - deps(tauri): add png crate for PNG tEXt chunk read/write
  - refactor(export): use png crate directly for PNG output
  - feat(export): embed pindouverse-blueprint metadata in PNG tEXt chunk
  - feat(import): fast path via pindouverse-blueprint metadata chunk
  - test(import): failing regression for kagome real-image import
  - fix(import): detect grid bbox before cell-size; use float spacing
  - test(import): kagome with user-provided 63x78 hint, ≥97% target

Rust tests: <PASS_COUNT>/<TOTAL> passing
  - kagome auto-detect accuracy: <X>%
  - kagome with 63x78 hint accuracy: <Y>%

Webview tests: 73/73 passing (unchanged)

To verify locally:
  cd src-tauri && cargo test --release
To try in the desktop app:
  npm run tauri dev
  Open temp/kagome_pindou_export.png via 导入图纸 (with or without specifying 63×78)

DO NOT merge to main or trigger a desktop release until the user confirms.
```

- [ ] **Step 2: Wait for user OK before:**
  - `git checkout main && git merge --squash feature/blueprint-import-accuracy`
  - Triggering the GitHub Actions Release workflow

---

## Self-Review

**Spec coverage:**
- Spec §A (PNG metadata round-trip) → Tasks 1-4 (deps, encoder swap, metadata embed, reader+fast-path).
- Spec §B (improved detection) → Task 6 (`detect_grid_bbox`, `longest_run`, `count_lines_from_bbox`, float cell math).
- Spec Tests #1 (metadata chunk roundtrip) → Task 3 Step 4.
- Spec Tests #2 (metadata exact reconstruction) → Task 4 Step 4.
- Spec Tests #3 (real kagome export, no hints, ≥95%) → Task 5 Step 5 (RED) + Task 6 Step 7 (GREEN).
- Spec Tests #4 (real kagome export, with hints, ≥97%) → Task 7 Step 1-2.
- Spec "all existing synthetic round-trip tests keep passing" → asserted in Tasks 2, 3, 4, 6.

**Placeholder scan:** no TBD/TODO. Every code block is final. Every command shows expected output.

**Type consistency:**
- `BlueprintMetadata` (writer side in `image_export.rs`) and `BlueprintMetadataRead` (reader side in `blueprint_import.rs`) — different structs (writer uses `Serialize`, reader uses `Deserialize`) with same field names/types via serde rename. Field names: `v`, `gridWidth`, `gridHeight`, `cellSize`, `originX`, `originY` (camelCase via serde rename). Consistent across both.
- `GridBBox { left, top, right, bottom }` — defined Task 6, used consistently in the new functions.
- `build_import_result(grid_w, grid_h, cell_size, origin_x, origin_y, …)` — Task 4 introduces it with this signature; Tasks 4 + 6 call it with the same shape.
- Fast path uses `meta.cell_size` (u32). Detect path uses `cs_x.round() as u32` for the final cell_size_int passed to `build_import_result`. The build_result helper only uses `cell_size` for the `cell_size_detected` field and for `extract_cell_binary` in has_text detection — works for both paths.

**Risk areas:**
- Task 5 fixture commits a 1.4 MB PNG. Worth flagging in PR if anyone complains about repo size; can be reduced by re-exporting kagome at a smaller cell_size later.
- Task 3 Step 5 anticipates `utf8_text` vs `uncompressed_latin1_text` ambiguity — most likely the chunk lands in `uncompressed_latin1_text` since `add_text_chunk` writes a Latin-1 tEXt (not iTXt), but worth defensive code. The reader in Task 4 already handles both.
- The integration test pattern `pindouverse::commands::...` assumes `src-tauri/Cargo.toml` package name is `pindouverse`. Verified earlier (`name = "pindouverse"` in the cargo file).
