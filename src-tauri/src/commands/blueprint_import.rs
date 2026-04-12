use serde::{Deserialize, Serialize};
use image::{Rgba, RgbaImage};
use image::ImageReader;
use imageproc::drawing::draw_text_mut;
use ab_glyph::{FontRef, PxScale};
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
    /// Color-matched codes (from pixel sampling)
    pub color_cells: Vec<Vec<String>>,
    /// Text-matched codes (from template OCR)
    pub text_cells: Vec<Vec<String>>,
    /// Final merged cells (color_cells by default)
    pub cells: Vec<Vec<String>>,
    /// Number of cells where color and text disagree
    pub mismatch_count: u32,
    /// List of mismatch positions: [row, col, color_code, text_code]
    pub mismatches: Vec<(u32, u32, String, String)>,
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
        let _start = dark_cols[i];
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

// ─── Template-based OCR ──────────────────────────────────────────

/// Render a text string into a small grayscale bitmap for template matching.
fn render_template(code: &str, cell_size: u32) -> Vec<u8> {
    let font_data = include_bytes!("../../fonts/NotoSansMono-Regular.ttf");
    let font = FontRef::try_from_slice(font_data).unwrap();
    let scale = PxScale::from(cell_size as f32 * 0.3);

    let mut img = RgbaImage::new(cell_size, cell_size);
    // White background
    for p in img.pixels_mut() { *p = Rgba([255, 255, 255, 255]); }
    // Draw black text
    let tx = (cell_size as i32) / 6;
    let ty = (cell_size as i32) / 3;
    draw_text_mut(&mut img, Rgba([0, 0, 0, 255]), tx, ty, scale, &font, code);

    // Convert to grayscale bitmap (0-255)
    img.pixels().map(|p| {
        (0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64) as u8
    }).collect()
}

/// Build template cache for all known color codes at a given cell size.
fn build_templates(codes: &[String], cell_size: u32) -> Vec<(String, Vec<u8>)> {
    codes.iter().map(|code| {
        (code.clone(), render_template(code, cell_size))
    }).collect()
}

/// Compare a cell region from the image against a template using normalized cross-correlation.
/// Returns similarity score 0.0-1.0.
fn template_similarity(cell_gray: &[u8], template: &[u8], size: usize) -> f64 {
    if cell_gray.len() != template.len() || cell_gray.is_empty() {
        return 0.0;
    }

    // Only compare the text region (middle portion of the cell)
    let w = (size as f64).sqrt() as usize;
    if w == 0 { return 0.0; }

    let mut sum_diff = 0.0;
    let mut count = 0.0;

    for (i, (&c, &t)) in cell_gray.iter().zip(template.iter()).enumerate() {
        let row = i / w;
        let col = i % w;
        // Focus on the center area where text lives (skip edges where color fill is)
        if row > w / 5 && row < w * 4 / 5 && col > w / 8 && col < w * 7 / 8 {
            let diff = (c as f64 - t as f64).abs();
            sum_diff += diff;
            count += 1.0;
        }
    }

    if count == 0.0 { return 0.0; }
    let avg_diff = sum_diff / count;
    // Convert to similarity (0 = same, 255 = opposite)
    1.0 - (avg_diff / 255.0).min(1.0)
}

/// Extract a cell region as grayscale, normalizing text to black-on-white.
fn extract_cell_gray(img: &RgbaImage, x0: u32, y0: u32, cell_size: u32) -> Vec<u8> {
    let (img_w, img_h) = img.dimensions();
    let mut pixels = Vec::with_capacity((cell_size * cell_size) as usize);

    // Sample background color from corners to determine text polarity
    let corners = [(x0 + 2, y0 + 2), (x0 + cell_size - 3, y0 + 2)];
    let mut bg_lum = 0.0;
    let mut bg_count = 0;
    for &(cx, cy) in &corners {
        if cx < img_w && cy < img_h {
            let p = img.get_pixel(cx, cy);
            bg_lum += 0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64;
            bg_count += 1;
        }
    }
    let is_dark_bg = bg_count > 0 && (bg_lum / bg_count as f64) < 128.0;

    for dy in 0..cell_size {
        for dx in 0..cell_size {
            let px = x0 + dx;
            let py = y0 + dy;
            if px < img_w && py < img_h {
                let p = img.get_pixel(px, py);
                let mut lum = 0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64;
                // Normalize: text should be dark on light
                if is_dark_bg { lum = 255.0 - lum; }
                pixels.push(lum as u8);
            } else {
                pixels.push(255); // white for out-of-bounds
            }
        }
    }
    pixels
}

/// Match a cell image against all templates, return best code and confidence.
fn ocr_cell(cell_gray: &[u8], templates: &[(String, Vec<u8>)], size: usize) -> (String, f64) {
    let mut best_code = String::new();
    let mut best_score = 0.0;

    for (code, tmpl) in templates {
        let score = template_similarity(cell_gray, tmpl, size);
        if score > best_score {
            best_score = score;
            best_code = code.clone();
        }
    }

    (best_code, best_score)
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
    let mut color_cells: Vec<Vec<String>> = Vec::new();
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
        color_cells.push(row_cells);
    }

    let avg_confidence = if cell_count > 0 {
        total_confidence / cell_count as f64
    } else {
        1.0
    };

    // Step 5: Template OCR — only for cells with low color confidence
    let tmpl_size = (cell_size * cell_size) as usize;

    // Build a set of valid codes for validation
    let valid_codes: std::collections::HashSet<String> = request.palette.iter().map(|p| p.code.clone()).collect();

    // Track per-cell color confidence for selective OCR
    let mut color_confidences: Vec<Vec<f64>> = Vec::new();
    // Recompute confidence per cell (we lost it in the loop above)
    for row in 0..grid_h {
        let mut row_conf: Vec<f64> = Vec::new();
        for col in 0..grid_w {
            let cc = &color_cells[row as usize][col as usize];
            if cc.is_empty() {
                row_conf.push(1.0);
            } else {
                // Find the palette entry and compute distance
                let pc = request.palette.iter().find(|p| p.code == *cc);
                if let Some(pc) = pc {
                    let x0 = margin + col * cell_size;
                    let y0 = margin + row * cell_size;
                    let inset = (cell_size / 5).max(2);
                    let sx = x0 + inset;
                    let sy = y0 + inset;
                    if sx < img_w && sy < img_h {
                        let p = img.get_pixel(sx, sy);
                        let dr = p[0] as f64 - pc.r as f64;
                        let dg = p[1] as f64 - pc.g as f64;
                        let db = p[2] as f64 - pc.b as f64;
                        let dist = (dr*dr + dg*dg + db*db).sqrt();
                        row_conf.push(1.0 - (dist / 442.0).min(1.0));
                    } else {
                        row_conf.push(1.0);
                    }
                } else {
                    row_conf.push(0.5);
                }
            }
        }
        color_confidences.push(row_conf);
    }

    let mut text_cells: Vec<Vec<String>> = Vec::new();
    let mut ocr_count = 0u32;
    for row in 0..grid_h {
        let mut row_text: Vec<String> = Vec::new();
        for col in 0..grid_w {
            // Skip empty cells
            if color_cells[row as usize][col as usize].is_empty() {
                row_text.push(String::new());
                continue;
            }

            // Only OCR if color confidence is below threshold
            if color_confidences[row as usize][col as usize] > 0.95 {
                // Trust color match, copy it
                row_text.push(color_cells[row as usize][col as usize].clone());
                continue;
            }

            ocr_count += 1;
            let x0 = margin + col * cell_size;
            let y0 = margin + row * cell_size;
            let cell_gray = extract_cell_gray(&img, x0, y0, cell_size);

            // Character-level OCR: recognize 2-4 chars then validate
            // For now, match against full code templates (built from chars)
            // Try all valid codes that start with the best first-char match
            let mut best_code = String::new();
            let mut best_score = 0.0;

            // Quick: match against full code templates for low-confidence cells only
            for code in &valid_codes {
                let tmpl = render_template(code, cell_size);
                let score = template_similarity(&cell_gray, &tmpl, tmpl_size);
                if score > best_score {
                    best_score = score;
                    best_code = code.clone();
                }
            }

            if best_score > 0.7 {
                row_text.push(best_code);
            } else {
                row_text.push(String::new());
            }
        }
        text_cells.push(row_text);
    }

    // Step 6: Compare color vs text results, detect mismatches
    let mut mismatches: Vec<(u32, u32, String, String)> = Vec::new();
    let mut merged_cells: Vec<Vec<String>> = Vec::new();

    for row in 0..grid_h as usize {
        let mut merged_row: Vec<String> = Vec::new();
        for col in 0..grid_w as usize {
            let cc = &color_cells[row][col];
            let tc = &text_cells[row][col];

            if cc.is_empty() && tc.is_empty() {
                merged_row.push(String::new());
            } else if !cc.is_empty() && !tc.is_empty() && cc != tc {
                // Mismatch! Default to color match
                mismatches.push((row as u32, col as u32, cc.clone(), tc.clone()));
                merged_row.push(cc.clone());
            } else if !tc.is_empty() {
                merged_row.push(tc.clone());
            } else {
                merged_row.push(cc.clone());
            }
        }
        merged_cells.push(merged_row);
    }

    let mismatch_count = mismatches.len() as u32;

    Ok(BlueprintImportResult {
        width: grid_w,
        height: grid_h,
        color_cells,
        text_cells,
        cells: merged_cells,
        mismatch_count,
        mismatches,
        cell_size_detected: cell_size,
        confidence: avg_confidence,
    })
}
