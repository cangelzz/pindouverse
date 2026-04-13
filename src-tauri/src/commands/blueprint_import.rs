use serde::{Deserialize, Serialize};
use image::{RgbaImage};
use image::ImageReader;
use rayon::prelude::*;

// ─── Request / Response types ───────────────────────────────────

#[derive(Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ImportMode {
    ColorPriority,
    TextPriority,
}

impl Default for ImportMode {
    fn default() -> Self { ImportMode::ColorPriority }
}

#[derive(Deserialize)]
pub struct BlueprintImportRequest {
    pub path: String,
    pub palette: Vec<PaletteColor>,
    /// Optional: if user knows the grid dimensions, provide them for accurate import
    pub grid_width: Option<u32>,
    pub grid_height: Option<u32>,
    /// Import mode (reserved for future use)
    pub mode: Option<ImportMode>,
}

#[derive(Deserialize, Clone)]
pub struct PaletteColor {
    pub code: String,
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum CellSource {
    Color,
    Text,
    ColorFallback,
}

#[derive(Serialize, Clone)]
pub struct CellResult {
    pub color_code: String,
    pub color_confidence: f64,
    pub text_code: String,
    pub text_confidence: f64,
    pub final_code: String,
    pub source: CellSource,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum MismatchSeverity {
    Low,
    Medium,
    High,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum MismatchRecommendation {
    TrustColor,
    TrustText,
    ManualReview,
}

#[derive(Serialize, Clone)]
pub struct Mismatch {
    pub row: u32,
    pub col: u32,
    pub color_code: String,
    pub color_confidence: f64,
    pub text_code: String,
    pub text_confidence: f64,
    pub severity: MismatchSeverity,
    pub recommendation: MismatchRecommendation,
}

#[derive(Serialize, Clone)]
pub struct SeveritySummary {
    pub high: u32,
    pub medium: u32,
    pub low: u32,
}

#[derive(Serialize)]
pub struct BlueprintImportResult {
    pub width: u32,
    pub height: u32,
    pub cells: Vec<Vec<CellResult>>,
    pub color_cells: Vec<Vec<String>>,
    pub text_cells: Vec<Vec<String>>,
    pub mismatch_count: u32,
    pub mismatches: Vec<Mismatch>,
    pub severity_summary: SeveritySummary,
    pub cell_size_detected: u32,
    pub confidence: f64,
    pub mode: ImportMode,
}

impl Serialize for ImportMode {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where S: serde::Serializer {
        match self {
            ImportMode::ColorPriority => serializer.serialize_str("color_priority"),
            ImportMode::TextPriority => serializer.serialize_str("text_priority"),
        }
    }
}

// ─── Image format detection ─────────────────────────────────────

#[derive(Clone, Copy, PartialEq)]
enum ImageFormat {
    Png,
    Jpeg,
    Other,
}

fn detect_format(path: &str) -> ImageFormat {
    match path.rsplit('.').next().map(|s| s.to_lowercase()).as_deref() {
        Some("jpg") | Some("jpeg") => ImageFormat::Jpeg,
        Some("png") => ImageFormat::Png,
        _ => ImageFormat::Other,
    }
}

/// Sampling configuration that adapts to image format
struct SamplingConfig {
    inset_ratio: f64,
    extra_samples: u32,
    grid_lum_threshold: f64,
}

impl SamplingConfig {
    fn for_format(format: ImageFormat) -> Self {
        match format {
            ImageFormat::Png => SamplingConfig {
                inset_ratio: 0.2,
                extra_samples: 0,
                grid_lum_threshold: 230.0,
            },
            ImageFormat::Jpeg => SamplingConfig {
                inset_ratio: 0.25,
                extra_samples: 8,
                grid_lum_threshold: 210.0,
            },
            ImageFormat::Other => SamplingConfig {
                inset_ratio: 0.2,
                extra_samples: 4,
                grid_lum_threshold: 220.0,
            },
        }
    }
}

// ─── Grid detection ─────────────────────────────────────────────

fn detect_cell_size(img: &RgbaImage, lum_threshold: f64) -> Option<u32> {
    let (w, h) = img.dimensions();
    let mut best_cs = 0u32;
    let mut best_score = 0u32;

    for cs in 15..=80 {
        let margin = cs;
        if margin + cs * 3 >= w || margin + cs * 3 >= h { continue; }

        let mut score = 0u32;
        for row in 0..5 {
            let y = margin + row * cs;
            if y >= h { break; }
            let x = margin + cs / 2;
            if x >= w { continue; }
            let p = img.get_pixel(x, y);
            let lum = 0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64;
            if lum < lum_threshold { score += 1; }
        }
        for col in 0..5 {
            let x = margin + col * cs;
            if x >= w { break; }
            let y = margin + cs / 2;
            if y >= h { continue; }
            let p = img.get_pixel(x, y);
            let lum = 0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64;
            if lum < lum_threshold { score += 1; }
        }

        if score > best_score { best_score = score; best_cs = cs; }
    }

    if best_cs > 0 && best_score >= 6 { Some(best_cs) } else { None }
}

fn detect_margin(img: &RgbaImage, cell_size: u32) -> u32 {
    let (w, _h) = img.dimensions();
    let test_margin = cell_size;
    if test_margin < w {
        let p = img.get_pixel(test_margin, test_margin);
        let lum = 0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64;
        if lum < 180.0 { return test_margin; }
    }
    cell_size
}

fn detect_grid_height(img: &RgbaImage, margin: u32, cell_size: u32, grid_w: u32, lum_threshold: f64) -> u32 {
    let (img_w, img_h) = img.dimensions();
    let max_possible = (img_h.saturating_sub(margin)) / cell_size;
    let mut actual_h = 0u32;

    for row_idx in 1..=max_possible {
        let y = margin + row_idx * cell_size;
        if y >= img_h { break; }

        let mut dark_count = 0u32;
        let mut total_count = 0u32;
        for col_off in 0..grid_w.min(20) {
            let x = margin + col_off * cell_size + cell_size / 2;
            if x >= img_w { continue; }
            let p = img.get_pixel(x, y);
            let lum = 0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64;
            total_count += 1;
            if lum < lum_threshold { dark_count += 1; }
        }

        if total_count > 0 && dark_count * 2 >= total_count {
            actual_h = row_idx;
        } else {
            break;
        }
    }

    if actual_h == 0 { max_possible } else { actual_h }
}

// ─── CIELAB color distance ──────────────────────────────────────

pub fn rgb_to_lab(r: u8, g: u8, b: u8) -> (f64, f64, f64) {
    let linearize = |c: u8| -> f64 {
        let c = c as f64 / 255.0;
        if c > 0.04045 { ((c + 0.055) / 1.055).powf(2.4) } else { c / 12.92 }
    };
    let (rl, gl, bl) = (linearize(r), linearize(g), linearize(b));

    let x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
    let y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750;
    let z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041;

    let f = |t: f64| -> f64 { if t > 0.008856 { t.cbrt() } else { 7.787 * t + 16.0 / 116.0 } };
    let (fx, fy, fz) = (f(x / 0.95047), f(y / 1.00000), f(z / 1.08883));

    (116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz))
}

pub fn delta_e76(r1: u8, g1: u8, b1: u8, r2: u8, g2: u8, b2: u8) -> f64 {
    let (l1, a1, b1_lab) = rgb_to_lab(r1, g1, b1);
    let (l2, a2, b2_lab) = rgb_to_lab(r2, g2, b2);
    ((l1 - l2).powi(2) + (a1 - a2).powi(2) + (b1_lab - b2_lab).powi(2)).sqrt()
}

fn match_color(r: u8, g: u8, b: u8, palette: &[PaletteColor]) -> (String, f64) {
    for pc in palette {
        if pc.r == r && pc.g == g && pc.b == b {
            return (pc.code.clone(), 1.0);
        }
    }
    let mut best_code = String::new();
    let mut best_dist = f64::MAX;
    for pc in palette {
        let dist = delta_e76(r, g, b, pc.r, pc.g, pc.b);
        if dist < best_dist { best_dist = dist; best_code = pc.code.clone(); }
    }
    let confidence = (1.0 - best_dist / 100.0).max(0.0);
    (best_code, confidence)
}

// ─── Text presence detection (for white/empty cell distinction) ─

fn binarize(gray: &[u8]) -> Vec<u8> {
    if gray.is_empty() { return vec![]; }

    let mut hist = [0u32; 256];
    for &v in gray { hist[v as usize] += 1; }

    let total = gray.len() as f64;
    let mut sum_total = 0.0;
    for i in 0..256 { sum_total += i as f64 * hist[i] as f64; }

    let mut sum_bg = 0.0;
    let mut weight_bg = 0.0;
    let mut best_thresh = 128u8;
    let mut best_variance = 0.0;

    for t in 0..256 {
        weight_bg += hist[t] as f64;
        if weight_bg == 0.0 { continue; }
        let weight_fg = total - weight_bg;
        if weight_fg == 0.0 { break; }

        sum_bg += t as f64 * hist[t] as f64;
        let mean_bg = sum_bg / weight_bg;
        let mean_fg = (sum_total - sum_bg) / weight_fg;

        let variance = weight_bg * weight_fg * (mean_bg - mean_fg).powi(2);
        if variance > best_variance { best_variance = variance; best_thresh = t as u8; }
    }

    gray.iter().map(|&v| if v <= best_thresh { 0 } else { 255 }).collect()
}

fn extract_cell_binary(img: &RgbaImage, x0: u32, y0: u32, cell_size: u32) -> Vec<u8> {
    let (img_w, img_h) = img.dimensions();
    let mut gray = Vec::with_capacity((cell_size * cell_size) as usize);

    for dy in 0..cell_size {
        for dx in 0..cell_size {
            let px = x0 + dx;
            let py = y0 + dy;
            if px < img_w && py < img_h {
                let p = img.get_pixel(px, py);
                gray.push((0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64) as u8);
            } else {
                gray.push(255);
            }
        }
    }

    let mut binary = binarize(&gray);

    // Normalize polarity: edges should be background (255)
    let w = cell_size as usize;
    let edge_inset = w / 5;
    let mut edge_sum = 0u64;
    let mut edge_count = 0u64;

    for (i, &v) in binary.iter().enumerate() {
        let row = i / w;
        let col = i % w;
        if row < edge_inset || row >= w - edge_inset || col < edge_inset || col >= w - edge_inset {
            edge_sum += v as u64;
            edge_count += 1;
        }
    }

    if edge_count > 0 && (edge_sum as f64 / edge_count as f64) < 128.0 {
        for v in binary.iter_mut() { *v = 255 - *v; }
    }

    binary
}

fn cell_has_text(cell_bin: &[u8], cell_size: u32) -> bool {
    let w = cell_size as usize;
    if cell_bin.is_empty() { return false; }

    let mut text_pixels = 0u32;
    let mut region_pixels = 0u32;

    for (i, &v) in cell_bin.iter().enumerate() {
        let row = i / w;
        let col = i % w;
        if row > w / 4 && row < w * 3 / 4 && col > w / 6 && col < w * 5 / 6 {
            region_pixels += 1;
            if v == 0 { text_pixels += 1; }
        }
    }

    if region_pixels == 0 { return false; }
    let text_ratio = text_pixels as f64 / region_pixels as f64;
    text_ratio > 0.03 && text_ratio < 0.50
}

// ─── Cell sampling ──────────────────────────────────────────────

fn sample_cell_color(
    img: &RgbaImage, x0: u32, y0: u32, cell_size: u32, config: &SamplingConfig,
) -> Option<(u8, u8, u8)> {
    let (img_w, img_h) = img.dimensions();
    let inset = (cell_size as f64 * config.inset_ratio).max(2.0) as u32;

    let mut offsets: Vec<(u32, u32)> = vec![
        (inset, inset), (cell_size - inset, inset),
        (inset, cell_size - inset), (cell_size - inset, cell_size - inset),
        (cell_size / 2, inset), (cell_size / 2, cell_size - inset),
        (inset, cell_size / 2), (cell_size - inset, cell_size / 2),
    ];

    if config.extra_samples > 0 {
        let inner = cell_size - 2 * inset;
        if inner > 4 {
            let step = inner / ((config.extra_samples as f64).sqrt().ceil() as u32 + 1);
            if step > 0 {
                let mut dx = inset + step;
                while dx < cell_size - inset {
                    let mut dy = inset + step;
                    while dy < cell_size - inset { offsets.push((dx, dy)); dy += step; }
                    dx += step;
                }
            }
        }
    }

    let mut samples: Vec<(u8, u8, u8)> = Vec::new();
    for &(dx, dy) in &offsets {
        let sx = x0 + dx;
        let sy = y0 + dy;
        if sx < img_w && sy < img_h {
            let p = img.get_pixel(sx, sy);
            samples.push((p[0], p[1], p[2]));
        }
    }

    if samples.is_empty() { return None; }

    let filtered: Vec<(u8, u8, u8)> = samples.iter()
        .filter(|&&(r, g, b)| {
            let lum = 0.299 * r as f64 + 0.587 * g as f64 + 0.114 * b as f64;
            let is_text = lum < 15.0 && r < 20 && g < 20 && b < 20;
            let is_white = lum > 245.0;
            !is_text && !is_white
        })
        .copied()
        .collect();

    let final_samples = if filtered.len() >= 2 { &filtered } else { &samples };

    let mut rs: Vec<u8> = final_samples.iter().map(|s| s.0).collect();
    let mut gs: Vec<u8> = final_samples.iter().map(|s| s.1).collect();
    let mut bs: Vec<u8> = final_samples.iter().map(|s| s.2).collect();
    rs.sort(); gs.sort(); bs.sort();

    Some((rs[rs.len() / 2], gs[gs.len() / 2], bs[bs.len() / 2]))
}

// ─── Main import function ───────────────────────────────────────

#[tauri::command]
pub fn import_blueprint(request: BlueprintImportRequest) -> Result<BlueprintImportResult, String> {
    let mode = request.mode.unwrap_or_default();
    let format = detect_format(&request.path);
    let config = SamplingConfig::for_format(format);

    let img = ImageReader::open(&request.path)
        .map_err(|e| format!("Failed to open image: {}", e))?
        .decode()
        .map_err(|e| format!("Failed to decode image: {}", e))?
        .to_rgba8();

    let (img_w, _img_h) = img.dimensions();

    // Step 1-3: Detect grid structure
    let (cell_size, margin, grid_w, grid_h) = if let (Some(gw), Some(gh)) = (request.grid_width, request.grid_height) {
        let cs = detect_cell_size(&img, config.grid_lum_threshold)
            .unwrap_or_else(|| img_w / (gw + 1));
        (cs, cs, gw, gh)
    } else {
        let cs = detect_cell_size(&img, config.grid_lum_threshold)
            .ok_or("Could not detect grid structure. Is this a blueprint image?")?;
        let m = detect_margin(&img, cs);
        let w = (img_w.saturating_sub(m)) / cs;
        let h = detect_grid_height(&img, m, cs, w, config.grid_lum_threshold);
        (cs, m, w, h)
    };

    if grid_w == 0 || grid_h == 0 {
        return Err("Detected grid is too small".to_string());
    }

    // Step 4: Color sampling for all cells
    let mut color_results: Vec<Vec<(String, f64)>> = Vec::new();
    let mut total_confidence = 0.0;
    let mut cell_count = 0u32;

    for row in 0..grid_h {
        let mut row_results: Vec<(String, f64)> = Vec::new();
        for col in 0..grid_w {
            let x0 = margin + col * cell_size;
            let y0 = margin + row * cell_size;

            match sample_cell_color(&img, x0, y0, cell_size, &config) {
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

    // Step 5: Detect which cells have text (to distinguish empty vs white/H2)
    let mut has_text_grid: Vec<Vec<bool>> = vec![vec![false; grid_w as usize]; grid_h as usize];
    let text_detect_tasks: Vec<(u32, u32, u32, u32)> = (0..grid_h)
        .flat_map(|row| (0..grid_w).map(move |col| (row, col, margin + col * cell_size, margin + row * cell_size)))
        .collect();

    let text_detect_results: Vec<(u32, u32, bool)> = text_detect_tasks.par_iter()
        .map(|&(row, col, x0, y0)| {
            let cell_bin = extract_cell_binary(&img, x0, y0, cell_size);
            (row, col, cell_has_text(&cell_bin, cell_size))
        })
        .collect();

    for (row, col, has_text) in text_detect_results {
        has_text_grid[row as usize][col as usize] = has_text;
    }

    // Step 6: Build results
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

            let is_white_color = if let Some(pc) = request.palette.iter().find(|p| p.code == *cc) {
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

    Ok(BlueprintImportResult {
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
    })
}
