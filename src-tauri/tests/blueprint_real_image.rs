//! Real-image regression tests for blueprint import. Each test loads a
//! fixture from `tests/fixtures/`, runs the importer against it, and
//! asserts a cell-accuracy floor against a known-good truth JSON.

use pindouverse_lib::commands::blueprint_import::{
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
    let truth = load_truth("kagome_truth.json");
    let palette = to_palette(&truth);
    let png = fixtures_dir().join("kagome_pindou_export.png");
    assert!(png.exists(), "kagome fixture missing — run `cp temp/kagome_pindou_export.png src-tauri/tests/fixtures/`");

    let req = BlueprintImportRequest {
        path: png.to_string_lossy().into_owned(),
        palette,
        grid_width: None,
        grid_height: None,
        bbox_left: None,
        bbox_top: None,
        bbox_right: None,
        bbox_bottom: None,
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

#[test]
fn test_detection_with_user_provided_grid() {
    // Same kagome PNG, but caller passes grid_width=63, grid_height=78.
    // This is what the user reports trying: "无论是自动还是输入63x78都无法识别".
    // Detection still has to find the bbox (header band offset), but skips
    // the noisier autocorrelation step. Target: ≥97% accuracy.
    let truth = load_truth("kagome_truth.json");
    let palette = to_palette(&truth);
    let png = fixtures_dir().join("kagome_pindou_export.png");

    let req = BlueprintImportRequest {
        path: png.to_string_lossy().into_owned(),
        palette,
        grid_width: Some(truth.width),
        grid_height: Some(truth.height),
        bbox_left: None,
        bbox_top: None,
        bbox_right: None,
        bbox_bottom: None,
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
    // Same floor as the auto-detect sibling: the fix made both paths run
    // through recover_grid_geometry, so they share the same accuracy ceiling.
    assert!(accuracy >= 0.95, "User-hint accuracy {:.2}% below 95% floor", accuracy * 100.0);
}
