//! One-shot diagnostic: round-trip every samples/*.pindou through
//! export → import (fast path with metadata, and detection path without)
//! and report per-sample cell accuracy.
//!
//! Run with: cargo test --release --test blueprint_all_samples -- --nocapture
//!
//! This is NOT a CI test (the per-sample accuracy is best-effort; we don't
//! want CI to fail on a 0.1% drift). Marked #[ignore] by default.

use pindouverse_lib::commands::blueprint_import::{
    import_blueprint, BlueprintImportRequest, PaletteColor,
};
use pindouverse_lib::commands::image_export::{export_image, CellData, ExportRequest};
use serde::Deserialize;
use std::fs;
use std::path::PathBuf;

#[derive(Deserialize)]
struct MardEntry {
    code: String,
    r: u8,
    g: u8,
    b: u8,
}

#[derive(Deserialize)]
struct PindouCell {
    #[serde(rename = "colorIndex")]
    color_index: Option<usize>,
}

#[derive(Deserialize)]
struct PindouCanvasSize {
    width: u32,
    height: u32,
}

#[derive(Deserialize)]
struct PindouFile {
    #[serde(rename = "canvasData")]
    canvas_data: Vec<Vec<PindouCell>>,
    #[serde(rename = "canvasSize")]
    canvas_size: PindouCanvasSize,
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf()
}

fn load_mard_palette() -> Vec<MardEntry> {
    // Reuse the kagome_truth.json fixture's `palette` field — same 295 MARD
    // colors used everywhere. Saves re-parsing the .ts file.
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests").join("fixtures").join("kagome_truth.json");
    let txt = fs::read_to_string(&path).expect("read fixture");
    #[derive(Deserialize)]
    struct T { palette: Vec<MardEntry> }
    let t: T = serde_json::from_str(&txt).expect("parse fixture");
    t.palette
}

fn truth_codes(p: &PindouFile, mard: &[MardEntry]) -> Vec<Vec<String>> {
    p.canvas_data.iter()
        .map(|row| row.iter().map(|c| {
            match c.color_index {
                Some(i) if i < mard.len() => mard[i].code.clone(),
                _ => String::new(),
            }
        }).collect())
        .collect()
}

fn truth_to_export_cells(p: &PindouFile, mard: &[MardEntry]) -> Vec<Vec<Option<CellData>>> {
    p.canvas_data.iter()
        .map(|row| row.iter().map(|c| match c.color_index {
            Some(i) if i < mard.len() => Some(CellData {
                color_code: mard[i].code.clone(),
                r: mard[i].r, g: mard[i].g, b: mard[i].b,
            }),
            _ => None,
        }).collect())
        .collect()
}

fn to_palette(mard: &[MardEntry]) -> Vec<PaletteColor> {
    mard.iter().map(|e| PaletteColor {
        code: e.code.clone(), r: e.r, g: e.g, b: e.b,
    }).collect()
}

fn count_matches(result_codes: &[Vec<String>], truth_codes: &[Vec<String>]) -> (usize, usize) {
    let mut ok = 0usize;
    let mut total = 0usize;
    for (rr, rt) in result_codes.iter().zip(truth_codes.iter()) {
        for (cr, ct) in rr.iter().zip(rt.iter()) {
            total += 1;
            if cr == ct { ok += 1; }
        }
    }
    (ok, total)
}

/// Strip the pindouverse-blueprint tEXt chunk from a PNG, producing a new
/// PNG at `out_path` that forces the importer down the detection path.
fn strip_metadata_chunk(in_path: &PathBuf, out_path: &PathBuf) {
    use std::io::BufReader;
    let file = std::fs::File::open(in_path).expect("open png");
    let mut decoder = png::Decoder::new(BufReader::new(file));
    let mut reader = decoder.read_info().expect("decode info");
    let (w, h) = (reader.info().width, reader.info().height);
    let color = reader.info().color_type;
    let depth = reader.info().bit_depth;
    let mut buf = vec![0u8; reader.output_buffer_size().expect("png buffer size")];
    reader.next_frame(&mut buf).expect("read frame");

    let out_file = std::fs::File::create(out_path).expect("create out png");
    let mut encoder = png::Encoder::new(std::io::BufWriter::new(out_file), w, h);
    encoder.set_color(color);
    encoder.set_depth(depth);
    // Intentionally no text chunks.
    let mut writer = encoder.write_header().expect("write header");
    writer.write_image_data(&buf).expect("write data");
}

#[derive(Default)]
struct SampleResult {
    name: String,
    width: u32,
    height: u32,
    fast_path_accuracy: f64,
    fast_path_ok: bool,
    detect_path_accuracy: f64,
    detect_path_dims_ok: bool,
    detect_path_error: Option<String>,
}

fn run_sample(path: &PathBuf, mard: &[MardEntry]) -> SampleResult {
    let mut r = SampleResult::default();
    r.name = path.file_name().unwrap().to_string_lossy().into_owned();

    let txt = fs::read_to_string(path).expect("read pindou");
    let parsed: PindouFile = serde_json::from_str(&txt).expect("parse pindou");
    r.width = parsed.canvas_size.width;
    r.height = parsed.canvas_size.height;

    let truth = truth_codes(&parsed, mard);
    let cells = truth_to_export_cells(&parsed, mard);
    let palette = to_palette(mard);

    // Export to a temp PNG with metadata.
    let test_dir = std::env::temp_dir().join("pindouverse_samples");
    fs::create_dir_all(&test_dir).unwrap();
    let png_with_meta = test_dir.join(format!("{}.png", r.name));
    let png_without_meta = test_dir.join(format!("{}_strip.png", r.name));

    let export_request = ExportRequest {
        width: r.width,
        height: r.height,
        cell_size: 20, // Match what synthetic tests use
        cells,
        output_path: png_with_meta.to_string_lossy().into_owned(),
        format: "png".to_string(),
        start_x: Some(1),
        start_y: Some(1),
        edge_padding: Some(0),
        watermark: None,
    };
    export_image(export_request).expect("export");

    // Fast path: import the metadata-bearing PNG.
    let req = BlueprintImportRequest {
        path: png_with_meta.to_string_lossy().into_owned(),
        palette: palette.clone(),
        grid_width: None,
        grid_height: None,
        bbox_left: None,
        bbox_top: None,
        bbox_right: None,
        bbox_bottom: None,
        mode: None,
    };
    match import_blueprint(req) {
        Ok(res) if res.width == r.width && res.height == r.height => {
            let result_codes: Vec<Vec<String>> = res.cells.iter()
                .map(|row| row.iter().map(|c| c.final_code.clone()).collect())
                .collect();
            let (ok, total) = count_matches(&result_codes, &truth);
            r.fast_path_accuracy = ok as f64 / total as f64;
            r.fast_path_ok = true;
        }
        Ok(res) => {
            r.fast_path_accuracy = 0.0;
            r.fast_path_ok = false;
            r.detect_path_error = Some(format!(
                "fast-path dims mismatch: got {}x{} expected {}x{}",
                res.width, res.height, r.width, r.height
            ));
        }
        Err(e) => {
            r.fast_path_accuracy = 0.0;
            r.fast_path_ok = false;
            r.detect_path_error = Some(format!("fast-path import error: {}", e));
        }
    }

    // Detection path: strip metadata, re-import.
    strip_metadata_chunk(&png_with_meta, &png_without_meta);
    let req = BlueprintImportRequest {
        path: png_without_meta.to_string_lossy().into_owned(),
        palette: palette.clone(),
        grid_width: None,
        grid_height: None,
        bbox_left: None,
        bbox_top: None,
        bbox_right: None,
        bbox_bottom: None,
        mode: None,
    };
    match import_blueprint(req) {
        Ok(res) => {
            r.detect_path_dims_ok = res.width == r.width && res.height == r.height;
            if r.detect_path_dims_ok {
                let result_codes: Vec<Vec<String>> = res.cells.iter()
                    .map(|row| row.iter().map(|c| c.final_code.clone()).collect())
                    .collect();
                let (ok, total) = count_matches(&result_codes, &truth);
                r.detect_path_accuracy = ok as f64 / total as f64;
            } else {
                r.detect_path_accuracy = 0.0;
                r.detect_path_error.get_or_insert_with(|| format!(
                    "detect dims: got {}x{} expected {}x{}",
                    res.width, res.height, r.width, r.height,
                ));
            }
        }
        Err(e) => {
            r.detect_path_accuracy = 0.0;
            r.detect_path_dims_ok = false;
            r.detect_path_error.get_or_insert(format!("detect error: {}", e));
        }
    }

    // Cleanup temp pngs.
    let _ = fs::remove_file(&png_with_meta);
    let _ = fs::remove_file(&png_without_meta);

    r
}

#[test]
#[ignore]
fn round_trip_all_samples() {
    let mard = load_mard_palette();
    let samples_dir = repo_root().join("samples");
    let mut entries: Vec<PathBuf> = fs::read_dir(&samples_dir).unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("pindou"))
        .collect();
    entries.sort();

    let mut results: Vec<SampleResult> = Vec::new();
    for path in &entries {
        let r = run_sample(path, &mard);
        eprintln!(
            "  {:36}  {:3}x{:<3}  fast={:5.1}% {}  detect={:5.1}% (dims={})",
            r.name,
            r.width, r.height,
            r.fast_path_accuracy * 100.0,
            if r.fast_path_ok { "OK " } else { "FAIL" },
            r.detect_path_accuracy * 100.0,
            if r.detect_path_dims_ok { "OK" } else { "FAIL" },
        );
        if let Some(err) = &r.detect_path_error {
            eprintln!("      └ note: {}", err);
        }
        results.push(r);
    }

    // Summary.
    let total = results.len();
    let fast_ok = results.iter().filter(|r| r.fast_path_ok && r.fast_path_accuracy >= 0.999).count();
    let detect_dims_ok = results.iter().filter(|r| r.detect_path_dims_ok).count();
    let detect_geq_95 = results.iter().filter(|r| r.detect_path_dims_ok && r.detect_path_accuracy >= 0.95).count();
    let detect_geq_99 = results.iter().filter(|r| r.detect_path_dims_ok && r.detect_path_accuracy >= 0.99).count();
    let avg_detect = if detect_dims_ok > 0 {
        let s: f64 = results.iter().filter(|r| r.detect_path_dims_ok).map(|r| r.detect_path_accuracy).sum();
        s / detect_dims_ok as f64
    } else { 0.0 };

    eprintln!();
    eprintln!("=== Summary ({} samples) ===", total);
    eprintln!("  Fast path (metadata):      {}/{} samples ≥99.9%", fast_ok, total);
    eprintln!("  Detection dims OK:         {}/{} samples", detect_dims_ok, total);
    eprintln!("  Detection ≥95% accuracy:   {}/{} samples", detect_geq_95, total);
    eprintln!("  Detection ≥99% accuracy:   {}/{} samples", detect_geq_99, total);
    eprintln!("  Detection mean accuracy:   {:.2}% (where dims OK)", avg_detect * 100.0);
}
