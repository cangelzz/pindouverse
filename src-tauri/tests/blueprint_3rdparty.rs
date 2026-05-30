//! Third-party JPEG blueprint detection sanity check. JPEGs have no metadata
//! chunk, so this forces the detection path. Filename embeds expected
//! width×height (e.g. 39x53.jpg). Verifies detected dims match.
//!
//! Run: cargo test --release --test blueprint_3rdparty -- --ignored --nocapture

use pindouverse_lib::commands::blueprint_import::{
    import_blueprint, BlueprintImportRequest, PaletteColor,
};
use serde::Deserialize;
use std::fs;
use std::path::PathBuf;

#[derive(Deserialize)]
struct MardEntry { code: String, r: u8, g: u8, b: u8 }

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf()
}

fn load_mard() -> Vec<MardEntry> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests").join("fixtures").join("kagome_truth.json");
    let txt = fs::read_to_string(&path).expect("read fixture");
    #[derive(Deserialize)] struct T { palette: Vec<MardEntry> }
    let t: T = serde_json::from_str(&txt).expect("parse");
    t.palette
}

fn to_palette(mard: &[MardEntry]) -> Vec<PaletteColor> {
    mard.iter().map(|e| PaletteColor {
        code: e.code.clone(), r: e.r, g: e.g, b: e.b,
    }).collect()
}

/// Parse "..._58x58.jpg" → Some((58, 58))
fn parse_dims_from_filename(name: &str) -> Option<(u32, u32)> {
    let stem = name.rsplit_once('.').map(|(s, _)| s).unwrap_or(name);
    let token = stem.rsplit('_').next()?;
    let (w, h) = token.split_once('x')?;
    Some((w.parse().ok()?, h.parse().ok()?))
}

#[test]
#[ignore]
fn detect_3rdparty_jpegs() {
    let mard = load_mard();
    let palette = to_palette(&mard);
    let temp_dir = repo_root().join("temp");

    let mut entries: Vec<PathBuf> = fs::read_dir(&temp_dir).unwrap()
        .filter_map(|e| e.ok()).map(|e| e.path())
        .filter(|p| {
            let n = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            n.starts_with("3rdtest_") && (n.ends_with(".jpg") || n.ends_with(".jpeg") || n.ends_with(".png"))
        })
        .collect();
    entries.sort();

    eprintln!();
    eprintln!("=== Third-party JPEG detection ({} files) ===", entries.len());

    let mut pass_auto = 0usize;
    let mut pass_hint = 0usize;

    for path in &entries {
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        let (exp_w, exp_h) = match parse_dims_from_filename(&name) {
            Some(d) => d,
            None => { eprintln!("  {}: SKIP (can't parse dims)", name); continue; }
        };

        // Auto-detect (no hints)
        let req = BlueprintImportRequest {
            path: path.to_string_lossy().into_owned(),
            palette: palette.clone(),
            grid_width: None, grid_height: None,
            bbox_left: None, bbox_top: None, bbox_right: None, bbox_bottom: None,
            mode: None,
        };
        let auto = match import_blueprint(req) {
            Ok(r) => format!("{}x{}", r.width, r.height),
            Err(e) => format!("ERR: {}", e.chars().take(40).collect::<String>()),
        };
        let auto_ok = auto == format!("{}x{}", exp_w, exp_h);
        if auto_ok { pass_auto += 1; }

        // With user hint
        let req = BlueprintImportRequest {
            path: path.to_string_lossy().into_owned(),
            palette: palette.clone(),
            grid_width: Some(exp_w), grid_height: Some(exp_h),
            bbox_left: None, bbox_top: None, bbox_right: None, bbox_bottom: None,
            mode: None,
        };
        let hint = match import_blueprint(req) {
            Ok(r) => format!("{}x{}", r.width, r.height),
            Err(e) => format!("ERR: {}", e.chars().take(40).collect::<String>()),
        };
        let hint_ok = hint == format!("{}x{}", exp_w, exp_h);
        if hint_ok { pass_hint += 1; }

        eprintln!("  {:40} expected={}x{}  auto={} {}  hint={} {}",
            name, exp_w, exp_h,
            auto, if auto_ok { "OK" } else { "FAIL" },
            hint, if hint_ok { "OK" } else { "FAIL" });
    }

    eprintln!();
    eprintln!("=== Summary ===");
    eprintln!("  Auto-detect dims:  {}/{}", pass_auto, entries.len());
    eprintln!("  With user hints:   {}/{}", pass_hint, entries.len());
}
