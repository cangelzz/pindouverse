use serde::Deserialize;
use image::{Rgba, RgbaImage};
use imageproc::drawing::draw_text_mut;
use ab_glyph::{FontRef, PxScale};
use std::collections::HashMap;

#[derive(Deserialize, Clone)]
pub struct CellData {
    pub color_code: String,
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

#[derive(Deserialize)]
pub struct ExportRequest {
    pub width: u32,
    pub height: u32,
    pub cell_size: u32,
    pub cells: Vec<Vec<Option<CellData>>>,
    pub output_path: String,
    pub format: String, // "png" or "jpeg"
    pub start_x: Option<i32>,
    pub start_y: Option<i32>,
    pub edge_padding: Option<u32>,
}

fn luminance(r: u8, g: u8, b: u8) -> f64 {
    0.299 * r as f64 + 0.587 * g as f64 + 0.114 * b as f64
}

#[tauri::command]
pub fn export_image(request: ExportRequest) -> Result<String, String> {
    let cs = request.cell_size;
    let margin = cs;

    // Count colors used
    let mut color_counts: HashMap<String, (u8, u8, u8, u32)> = HashMap::new();
    for row in &request.cells {
        for cell in row {
            if let Some(cd) = cell {
                let entry = color_counts.entry(cd.color_code.clone()).or_insert((cd.r, cd.g, cd.b, 0));
                entry.3 += 1;
            }
        }
    }

    // Build two sorted lists
    let mut by_count: Vec<(String, u8, u8, u8, u32)> = color_counts.iter()
        .map(|(code, (r, g, b, cnt))| (code.clone(), *r, *g, *b, *cnt))
        .collect();
    by_count.sort_by(|a, b| b.4.cmp(&a.4).then(a.0.cmp(&b.0)));

    let mut by_alpha = by_count.clone();
    by_alpha.sort_by(|a, b| a.0.cmp(&b.0));

    // Legend layout
    let swatch_w = cs * 2;      // each swatch block width
    let swatch_h = cs;           // each swatch block height
    let legend_cols = ((request.width * cs) / swatch_w).max(1);
    let legend_gap = cs / 2;

    let legend_rows_count = |items: &[(String, u8, u8, u8, u32)]| -> u32 {
        if items.is_empty() { 0 } else { ((items.len() as u32 - 1) / legend_cols) + 1 }
    };

    let section_title_h = cs;
    let legend_section_h = |items: &[(String, u8, u8, u8, u32)]| -> u32 {
        section_title_h + legend_rows_count(items) * (swatch_h + 2)
    };

    let total_legend_h = legend_gap
        + legend_section_h(&by_count)
        + legend_gap
        + legend_section_h(&by_alpha)
        + legend_gap;

    let grid_area_h = request.height * cs + margin;
    let img_width = request.width * cs + margin;
    let img_height = grid_area_h + total_legend_h;
    let mut img = RgbaImage::new(img_width, img_height);

    for pixel in img.pixels_mut() {
        *pixel = Rgba([255, 255, 255, 255]);
    }

    let font_data = include_bytes!("../../fonts/NotoSansMono-Regular.ttf");
    let font = FontRef::try_from_slice(font_data)
        .map_err(|e| format!("Failed to load font: {}", e))?;

    let code_scale = PxScale::from(cs as f32 * 0.3);
    let axis_scale = PxScale::from(cs as f32 * 0.45);
    let legend_code_scale = PxScale::from(cs as f32 * 0.35);
    let legend_title_scale = PxScale::from(cs as f32 * 0.5);
    let axis_color = Rgba([80, 80, 80, 255]);

    let sx = request.start_x.unwrap_or(1);
    let sy = request.start_y.unwrap_or(1);
    let ep = request.edge_padding.unwrap_or(0);

    // Draw axis numbers (only for grid area, skip edge padding cells)
    for col in ep..request.width - ep {
        let x = margin + col * cs;
        let label = format!("{}", col as i32 - ep as i32 + sx);
        let tx = x as i32 + cs as i32 / 6;
        let ty = cs as i32 / 4;
        draw_text_mut(&mut img, axis_color, tx, ty, axis_scale, &font, &label);
    }
    for row in ep..request.height - ep {
        let y = margin + row * cs;
        let label = format!("{}", row as i32 - ep as i32 + sy);
        let tx = cs as i32 / 8;
        let ty = y as i32 + cs as i32 / 4;
        draw_text_mut(&mut img, axis_color, tx, ty, axis_scale, &font, &label);
    }

    // Draw cells
    for (row_idx, row) in request.cells.iter().enumerate() {
        for (col_idx, cell) in row.iter().enumerate() {
            let x0 = margin + col_idx as u32 * cs;
            let y0 = margin + row_idx as u32 * cs;

            if let Some(cell_data) = cell {
                for dy in 0..cs {
                    for dx in 0..cs {
                        let px = x0 + dx;
                        let py = y0 + dy;
                        if px < img_width && py < img_height {
                            img.put_pixel(px, py, Rgba([cell_data.r, cell_data.g, cell_data.b, 255]));
                        }
                    }
                }
                let text_color = if luminance(cell_data.r, cell_data.g, cell_data.b) > 128.0 {
                    Rgba([0, 0, 0, 255])
                } else {
                    Rgba([255, 255, 255, 255])
                };
                // Center text in cell
                // Approximate text width: each char ~0.6 * font_size for monospace
                let font_size = cs as f32 * 0.3;
                let char_count = cell_data.color_code.len() as f32;
                let text_w = (char_count * font_size * 0.6) as i32;
                let text_h = font_size as i32;
                let text_x = x0 as i32 + (cs as i32 - text_w) / 2;
                let text_y = y0 as i32 + (cs as i32 - text_h) / 2;
                draw_text_mut(&mut img, text_color, text_x, text_y, code_scale, &font, &cell_data.color_code);
            }
        }
    }

    // Grid lines
    let thin_color = Rgba([180, 180, 180, 255]);
    let mid_color = Rgba([80, 80, 80, 255]);
    let thick_color = Rgba([0, 0, 0, 255]);

    let draw_hline = |img: &mut RgbaImage, y: u32, x_start: u32, x_end: u32, color: Rgba<u8>, thickness: u32| {
        for t in 0..thickness {
            let py = y + t;
            if py >= img_height { break; }
            for px in x_start..x_end.min(img_width) {
                img.put_pixel(px, py, color);
            }
        }
    };
    let draw_vline = |img: &mut RgbaImage, x: u32, y_start: u32, y_end: u32, color: Rgba<u8>, thickness: u32| {
        for t in 0..thickness {
            let px = x + t;
            if px >= img_width { break; }
            for py in y_start..y_end.min(grid_area_h) {
                img.put_pixel(px, py, color);
            }
        }
    };

    let grid_x_start = margin;
    let grid_y_start = margin;
    let grid_x_end = margin + request.width * cs;
    let grid_y_end = margin + request.height * cs;

    for col in 0..=request.width {
        let x = grid_x_start + col * cs;
        draw_vline(&mut img, x, grid_y_start, grid_y_end, thin_color, 1);
    }
    for row in 0..=request.height {
        let y = grid_y_start + row * cs;
        draw_hline(&mut img, y, grid_x_start, grid_x_end, thin_color, 1);
    }

    let edge_px = ep;
    let edge_py = ep;

    for col_g in (edge_px..=request.width - edge_px).step_by(5) {
        let x = grid_x_start + col_g * cs;
        draw_vline(&mut img, x.saturating_sub(1), grid_y_start, grid_y_end, mid_color, 2);
    }
    for row_g in (edge_py..=request.height - edge_py).step_by(5) {
        let y = grid_y_start + row_g * cs;
        draw_hline(&mut img, y.saturating_sub(1), grid_x_start, grid_x_end, mid_color, 2);
    }

    for col_g in (edge_px..=request.width - edge_px).step_by(10) {
        let x = grid_x_start + col_g * cs;
        draw_vline(&mut img, x.saturating_sub(1), grid_y_start, grid_y_end, thick_color, 3);
    }
    for row_g in (edge_py..=request.height - edge_py).step_by(10) {
        let y = grid_y_start + row_g * cs;
        draw_hline(&mut img, y.saturating_sub(1), grid_x_start, grid_x_end, thick_color, 3);
    }

    // Outer border
    draw_hline(&mut img, grid_y_start, grid_x_start, grid_x_end, thick_color, 3);
    draw_hline(&mut img, grid_y_end.saturating_sub(2), grid_x_start, grid_x_end + 3, thick_color, 3);
    draw_vline(&mut img, grid_x_start, grid_y_start, grid_y_end, thick_color, 3);
    draw_vline(&mut img, grid_x_end.saturating_sub(2), grid_y_start, grid_y_end, thick_color, 3);

    // === Draw legend below grid ===
    let draw_legend_section = |img: &mut RgbaImage, items: &[(String, u8, u8, u8, u32)], y_start: u32, title: &str| {
        // Title
        draw_text_mut(img, Rgba([0, 0, 0, 255]), margin as i32, y_start as i32 + 2, legend_title_scale, &font, title);

        let row_start_y = y_start + section_title_h;
        for (i, (code, r, g, b, cnt)) in items.iter().enumerate() {
            let col = i as u32 % legend_cols;
            let row = i as u32 / legend_cols;
            let sx = margin + col * swatch_w;
            let sy = row_start_y + row * (swatch_h + 2);

            // Draw swatch background
            for dy in 0..swatch_h {
                for dx in 0..swatch_w.saturating_sub(2) {
                    let px = sx + dx;
                    let py = sy + dy;
                    if px < img_width && py < img_height {
                        img.put_pixel(px, py, Rgba([*r, *g, *b, 255]));
                    }
                }
            }

            // Border
            for dx in 0..swatch_w.saturating_sub(2) {
                let px = sx + dx;
                if px < img_width {
                    if sy < img_height { img.put_pixel(px, sy, Rgba([160, 160, 160, 255])); }
                    let by = sy + swatch_h - 1;
                    if by < img_height { img.put_pixel(px, by, Rgba([160, 160, 160, 255])); }
                }
            }
            for dy in 0..swatch_h {
                let py = sy + dy;
                if py < img_height {
                    if sx < img_width { img.put_pixel(sx, py, Rgba([160, 160, 160, 255])); }
                    let bx = sx + swatch_w - 3;
                    if bx < img_width { img.put_pixel(bx, py, Rgba([160, 160, 160, 255])); }
                }
            }

            // Text: "CODE ×N"
            let label = format!("{} x{}", code, cnt);
            let text_color = if luminance(*r, *g, *b) > 128.0 {
                Rgba([0, 0, 0, 255])
            } else {
                Rgba([255, 255, 255, 255])
            };
            let tx = sx as i32 + 3;
            let ty = sy as i32 + (swatch_h as i32 / 4);
            draw_text_mut(img, text_color, tx, ty, legend_code_scale, &font, &label);
        }
    };

    let mut legend_y = grid_area_h + legend_gap;
    let total_beads: u32 = by_count.iter().map(|x| x.4).sum();
    let title1 = format!("By Count ({} colors, {} beads)", by_count.len(), total_beads);
    draw_legend_section(&mut img, &by_count, legend_y, &title1);
    legend_y += legend_section_h(&by_count) + legend_gap;

    let title2 = format!("By Code ({} colors)", by_alpha.len());
    draw_legend_section(&mut img, &by_alpha, legend_y, &title2);

    match request.format.as_str() {
        "jpeg" | "jpg" => {
            // JPEG doesn't support alpha — convert RGBA to RGB
            let rgb_img: image::RgbImage = image::DynamicImage::ImageRgba8(img).to_rgb8();
            rgb_img.save_with_format(&request.output_path, image::ImageFormat::Jpeg)
                .map_err(|e| format!("Failed to save JPEG: {}", e))?;
        }
        _ => {
            img.save_with_format(&request.output_path, image::ImageFormat::Png)
                .map_err(|e| format!("Failed to save PNG: {}", e))?;
        }
    }

    Ok(request.output_path)
}

#[derive(Deserialize)]
pub struct PreviewRequest {
    pub width: u32,
    pub height: u32,
    pub pixel_size: u32,
    pub cells: Vec<Vec<Option<CellData>>>,
    pub output_path: String,
}

/// Export a flat preview image — just colored pixels, no grid/text/legend
#[tauri::command]
pub fn export_preview(request: PreviewRequest) -> Result<String, String> {
    let ps = request.pixel_size;
    let img_width = request.width * ps;
    let img_height = request.height * ps;
    let mut img = RgbaImage::new(img_width, img_height);

    // Fill with white
    for pixel in img.pixels_mut() {
        *pixel = Rgba([255, 255, 255, 255]);
    }

    for (row_idx, row) in request.cells.iter().enumerate() {
        for (col_idx, cell) in row.iter().enumerate() {
            if let Some(cd) = cell {
                let x0 = col_idx as u32 * ps;
                let y0 = row_idx as u32 * ps;
                for dy in 0..ps {
                    for dx in 0..ps {
                        let px = x0 + dx;
                        let py = y0 + dy;
                        if px < img_width && py < img_height {
                            img.put_pixel(px, py, Rgba([cd.r, cd.g, cd.b, 255]));
                        }
                    }
                }
            }
        }
    }

    // Always save as JPEG (convert RGBA -> RGB)
    let rgb_img: image::RgbImage = image::DynamicImage::ImageRgba8(img).to_rgb8();
    rgb_img.save_with_format(&request.output_path, image::ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to save preview: {}", e))?;

    Ok(request.output_path)
}
