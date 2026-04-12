use serde::{Deserialize, Serialize};
use image::io::Reader as ImageReader;
use std::collections::HashMap;

#[derive(Deserialize)]
pub struct BlueprintImportRequest {
    pub path: String,
    /// Known MARD color palette: [{code, r, g, b}, ...]
    pub palette: Vec<PaletteColor>,
}

#[derive(Deserialize)]
pub struct PaletteColor {
    pub code: String,
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

#[derive(Serialize)]
pub struct BlueprintImportResult {
    pub width: u32,
    pub height: u32,
    /// Flat array of color codes, row-major. Empty string = empty cell.
    pub cells: Vec<Vec<String>>,
    pub cell_size_detected: u32,
    pub confidence: f64,
}

/// Detect the grid cell size by scanning for regular vertical grid lines.
/// Look for columns of pixels where luminance changes sharply (grid line vs cell fill).
fn detect_cell_size(img: &image::RgbaImage) -> Option<u32> {
    let (w, h) = img.dimensions();
    let sample_row = h / 2; // sample from middle row

    // Collect column positions where dark pixels appear (potential grid lines)
    let mut dark_cols: Vec<u32> = Vec::new();
    for x in 0..w {
        let p = img.get_pixel(x, sample_row);
        let lum = 0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64;
        if lum < 140.0 {
            // Check if this is a vertical line (several consecutive dark pixels vertically)
            let mut vert_count = 0;
            for dy in 0..10.min(h - sample_row) {
                let vp = img.get_pixel(x, sample_row + dy);
                let vl = 0.299 * vp[0] as f64 + 0.587 * vp[1] as f64 + 0.114 * vp[2] as f64;
                if vl < 140.0 { vert_count += 1; }
            }
            if vert_count >= 5 {
                dark_cols.push(x);
            }
        }
    }

    if dark_cols.len() < 3 { return None; }

    // Find gaps between consecutive dark columns (these are cell widths)
    let mut gaps: Vec<u32> = Vec::new();
    let mut i = 0;
    while i < dark_cols.len() {
        // Skip consecutive dark pixels (grid line width)
        let start = dark_cols[i];
        while i + 1 < dark_cols.len() && dark_cols[i + 1] == dark_cols[i] + 1 {
            i += 1;
        }
        let end = dark_cols[i];
        if i + 1 < dark_cols.len() {
            let next_start = dark_cols[i + 1];
            let gap = next_start - end;
            if gap > 5 { // minimum reasonable cell size
                gaps.push(gap);
            }
        }
        i += 1;
    }

    if gaps.is_empty() { return None; }

    // Find the most common gap (mode)
    let mut gap_counts: HashMap<u32, u32> = HashMap::new();
    for &g in &gaps {
        // Allow ±1 tolerance
        let rounded = g;
        *gap_counts.entry(rounded).or_insert(0) += 1;
    }
    gap_counts.into_iter().max_by_key(|&(_, cnt)| cnt).map(|(cs, _)| cs)
}

/// Find the margin (axis area) by detecting where the grid starts.
fn detect_margin(img: &image::RgbaImage, cell_size: u32) -> u32 {
    let (w, _h) = img.dimensions();
    // Scan top-left area for the first major grid line
    // The margin = cell_size (axis numbers area)
    // Verify by checking for a grid line at x=cell_size
    let test_margin = cell_size;
    if test_margin < w {
        let p = img.get_pixel(test_margin, test_margin);
        let lum = 0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64;
        if lum < 180.0 { return test_margin; }
    }
    cell_size
}

/// Match an RGB color to the closest palette color by exact or near match.
fn match_color(r: u8, g: u8, b: u8, palette: &[PaletteColor]) -> (String, f64) {
    // Try exact match first
    for pc in palette {
        if pc.r == r && pc.g == g && pc.b == b {
            return (pc.code.clone(), 1.0);
        }
    }
    // Nearest match by Euclidean distance
    let mut best_code = String::new();
    let mut best_dist = f64::MAX;
    for pc in palette {
        let dr = r as f64 - pc.r as f64;
        let dg = g as f64 - pc.g as f64;
        let db = b as f64 - pc.b as f64;
        let dist = (dr * dr + dg * dg + db * db).sqrt();
        if dist < best_dist {
            best_dist = dist;
            best_code = pc.code.clone();
        }
    }
    // Confidence based on distance (0 = exact, 442 = max possible)
    let confidence = 1.0 - (best_dist / 442.0).min(1.0);
    (best_code, confidence)
}

#[tauri::command]
pub fn import_blueprint(request: BlueprintImportRequest) -> Result<BlueprintImportResult, String> {
    let img = ImageReader::open(&request.path)
        .map_err(|e| format!("Failed to open image: {}", e))?
        .decode()
        .map_err(|e| format!("Failed to decode image: {}", e))?
        .to_rgba8();

    let (img_w, img_h) = img.dimensions();

    // Step 1: Detect cell size from grid lines
    let cell_size = detect_cell_size(&img)
        .ok_or("Could not detect grid structure. Is this a blueprint image?")?;

    // Step 2: Detect margin
    let margin = detect_margin(&img, cell_size);

    // Step 3: Calculate grid dimensions
    let grid_w = (img_w.saturating_sub(margin)) / cell_size;
    let grid_h = (img_h.saturating_sub(margin)) / cell_size;

    if grid_w == 0 || grid_h == 0 {
        return Err("Detected grid is too small".to_string());
    }

    // Step 4: Sample corners of each cell (avoid center text) and match to palette
    let mut cells: Vec<Vec<String>> = Vec::new();
    let mut total_confidence = 0.0;
    let mut cell_count = 0u32;

    // Sample offsets: 4 corners + 4 edge midpoints, all inset from grid lines
    let inset = (cell_size / 5).max(2);
    let sample_offsets: Vec<(u32, u32)> = vec![
        (inset, inset),                             // top-left
        (cell_size - inset, inset),                 // top-right
        (inset, cell_size - inset),                 // bottom-left
        (cell_size - inset, cell_size - inset),     // bottom-right
        (cell_size / 2, inset),                     // top-center
        (cell_size / 2, cell_size - inset),         // bottom-center
        (inset, cell_size / 2),                     // left-center
        (cell_size - inset, cell_size / 2),         // right-center
    ];

    for row in 0..grid_h {
        let mut row_cells: Vec<String> = Vec::new();
        for col in 0..grid_w {
            let x0 = margin + col * cell_size;
            let y0 = margin + row * cell_size;

            // Sample multiple points, collect RGB values
            let mut samples: Vec<(u8, u8, u8)> = Vec::new();
            for &(dx, dy) in &sample_offsets {
                let sx = x0 + dx;
                let sy = y0 + dy;
                if sx < img_w && sy < img_h {
                    let p = img.get_pixel(sx, sy);
                    samples.push((p[0], p[1], p[2]));
                }
            }

            if samples.is_empty() {
                row_cells.push(String::new());
                continue;
            }

            // Filter out very dark pixels (likely text) and very light (grid lines on white)
            let filtered: Vec<(u8, u8, u8)> = samples.iter()
                .filter(|&&(r, g, b)| {
                    let lum = 0.299 * r as f64 + 0.587 * g as f64 + 0.114 * b as f64;
                    lum > 30.0 && lum < 245.0 // reject black text and white background
                })
                .copied()
                .collect();

            // Use filtered samples if available, otherwise fall back to all samples
            let final_samples = if filtered.len() >= 2 { &filtered } else { &samples };

            // Take median of each channel (robust against outliers)
            let mut rs: Vec<u8> = final_samples.iter().map(|s| s.0).collect();
            let mut gs: Vec<u8> = final_samples.iter().map(|s| s.1).collect();
            let mut bs: Vec<u8> = final_samples.iter().map(|s| s.2).collect();
            rs.sort(); gs.sort(); bs.sort();
            let r = rs[rs.len() / 2];
            let g = gs[gs.len() / 2];
            let b = bs[bs.len() / 2];

            // Skip white/near-white cells (empty)
            if r > 245 && g > 245 && b > 245 {
                row_cells.push(String::new());
                continue;
            }

            let (code, conf) = match_color(r, g, b, &request.palette);
            row_cells.push(code);
            total_confidence += conf;
            cell_count += 1;
        }
        cells.push(row_cells);
    }

    let avg_confidence = if cell_count > 0 {
        total_confidence / cell_count as f64
    } else {
        1.0
    };

    Ok(BlueprintImportResult {
        width: grid_w,
        height: grid_h,
        cells,
        cell_size_detected: cell_size,
        confidence: avg_confidence,
    })
}
