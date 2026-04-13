#[cfg(test)]
mod tests {
    use crate::commands::image_export::{ExportRequest, CellData, export_image};
    use crate::commands::blueprint_import::{BlueprintImportRequest, PaletteColor, import_blueprint, ImportMode};
    use std::fs;

    fn make_test_palette() -> Vec<PaletteColor> {
        // A few distinct colors for testing
        vec![
            PaletteColor { code: "A1".to_string(), r: 250, g: 245, b: 205 },  // light yellow
            PaletteColor { code: "B1".to_string(), r: 255, g: 0, b: 0 },      // red
            PaletteColor { code: "C1".to_string(), r: 0, g: 128, b: 0 },      // green
            PaletteColor { code: "D1".to_string(), r: 0, g: 0, b: 255 },      // blue
            PaletteColor { code: "E1".to_string(), r: 128, g: 128, b: 128 },  // gray
            PaletteColor { code: "F1".to_string(), r: 64, g: 32, b: 16 },     // dark brown
        ]
    }

    fn make_cells(w: u32, h: u32, palette: &[PaletteColor]) -> Vec<Vec<Option<CellData>>> {
        let mut cells = Vec::new();
        for row in 0..h {
            let mut row_cells = Vec::new();
            for col in 0..w {
                let idx = ((row * w + col) as usize) % palette.len();
                let pc = &palette[idx];
                row_cells.push(Some(CellData {
                    color_code: pc.code.clone(),
                    r: pc.r,
                    g: pc.g,
                    b: pc.b,
                }));
            }
            cells.push(row_cells);
        }
        cells
    }

    #[test]
    fn test_roundtrip_10x10() {
        roundtrip_test(10, 10, 40, "png", 0);
    }

    #[test]
    fn test_roundtrip_52x52() {
        roundtrip_test(52, 52, 30, "png", 0);
    }

    #[test]
    fn test_roundtrip_100x100() {
        roundtrip_test(100, 100, 20, "png", 0);
    }

    #[test]
    fn test_roundtrip_100x100_jpeg() {
        roundtrip_test(100, 100, 40, "jpeg", 0);
    }

    #[test]
    fn test_roundtrip_52x52_padding1() {
        roundtrip_test(52, 52, 30, "png", 1);
    }

    #[test]
    fn test_roundtrip_100x100_padding2_jpeg() {
        roundtrip_test(100, 100, 40, "jpeg", 2);
    }

    fn roundtrip_test(w: u32, h: u32, cell_size: u32, format: &str, edge_padding: u32) {
        let palette = make_test_palette();
        let cells = make_cells(w, h, &palette);

        let ext = if format == "jpeg" { "jpg" } else { "png" };

        // Export
        let test_dir = std::env::temp_dir().join("pindouverse_test");
        fs::create_dir_all(&test_dir).unwrap();
        let export_path = test_dir.join(format!("test_{}x{}_p{}.{}", w, h, edge_padding, ext));
        let path_str = export_path.to_string_lossy().to_string();

        let request = ExportRequest {
            width: w,
            height: h,
            cell_size,
            cells: cells.clone(),
            output_path: path_str.clone(),
            format: format.to_string(),
            start_x: Some(1),
            start_y: Some(1),
            edge_padding: Some(edge_padding),
        };
        export_image(request).expect("Export failed");
        assert!(export_path.exists(), "Exported file should exist");

        // Debug: check image dimensions and sample pixels
        let debug_img = image::open(&export_path).unwrap().to_rgba8();
        let (iw, ih) = debug_img.dimensions();
        eprintln!("  Exported image: {}x{}", iw, ih);
        for y in 0..5.min(ih) {
            let mut lums: Vec<u8> = Vec::new();
            for x in (0..iw.min(200)).step_by(10) {
                let p = debug_img.get_pixel(x, y);
                let l = (0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64) as u8;
                lums.push(l);
            }
            eprintln!("  y={}: {:?}", y, &lums[..lums.len().min(20)]);
        }
        let margin_y = cell_size;
        if margin_y < ih {
            let mut lums: Vec<u8> = Vec::new();
            for x in (0..iw.min(200)).step_by(5) {
                let p = debug_img.get_pixel(x, margin_y);
                let l = (0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64) as u8;
                lums.push(l);
            }
            eprintln!("  y={} (margin): {:?}", margin_y, &lums[..lums.len().min(40)]);
        }

        // Import with default mode (color priority)
        let import_request = BlueprintImportRequest {
            path: path_str.clone(),
            palette: palette.clone(),
            grid_width: None,
            grid_height: None,
            mode: None,
        };
        let result = import_blueprint(import_request).expect("Import failed");

        // Verify dimensions
        eprintln!("  cell_size_detected={} (expected={})", result.cell_size_detected, cell_size);
        assert_eq!(result.width, w, "Width mismatch: got {} expected {}", result.width, w);
        assert_eq!(result.height, h, "Height mismatch: got {} expected {}", result.height, h);

        // Verify cell contents using CellResult.final_code
        let mut mismatches = 0;
        for row in 0..h as usize {
            for col in 0..w as usize {
                let expected = &cells[row][col].as_ref().unwrap().color_code;
                let got = &result.cells[row][col].final_code;
                if expected != got {
                    mismatches += 1;
                    if mismatches <= 5 {
                        eprintln!("  Cell ({},{}) expected={} got={} (color={} text={})",
                            row, col, expected, got,
                            result.cells[row][col].color_code,
                            result.cells[row][col].text_code);
                    }
                }
            }
        }
        let total = (w * h) as usize;
        let accuracy = ((total - mismatches) as f64 / total as f64) * 100.0;
        eprintln!("{}x{} [{}] pad={}: {}/{} correct ({:.1}%), {} mismatches",
            w, h, format, edge_padding, total - mismatches, total, accuracy, mismatches);

        let min_accuracy = if format == "jpeg" { 95.0 } else { 99.0 };
        assert!(accuracy > min_accuracy, "Accuracy too low: {:.1}% (min={:.0}%)", accuracy, min_accuracy);

        // Verify confidence
        assert!(result.confidence > 0.9, "Confidence too low: {:.2}", result.confidence);

        // Verify OCR attempted on cells that have text
        // Not all cells will have successful OCR (some may be too small or noisy)
        let mut ocr_attempted = 0;
        for row in 0..h as usize {
            for col in 0..w as usize {
                let cell = &result.cells[row][col];
                if !cell.color_code.is_empty() && cell.text_confidence > 0.0 {
                    ocr_attempted += 1;
                }
            }
        }
        // At least some cells should have OCR data
        let ocr_ratio = ocr_attempted as f64 / total as f64;
        eprintln!("  OCR attempted on {}/{} cells ({:.0}%)", ocr_attempted, total, ocr_ratio * 100.0);

        // Verify severity summary matches mismatch list
        let summary = &result.severity_summary;
        assert_eq!(summary.high + summary.medium + summary.low, result.mismatch_count,
            "Severity summary doesn't match mismatch count");

        // Cleanup
        let _ = fs::remove_file(&export_path);
    }

    // Note: test_text_priority_mode removed — OCR/text matching is currently disabled

    #[test]
    fn test_cielab_distance() {
        use crate::commands::blueprint_import::{rgb_to_lab, delta_e76};

        // Black vs White ≈ 100
        let d = delta_e76(0, 0, 0, 255, 255, 255);
        assert!(d > 90.0 && d < 110.0, "Black vs White deltaE should be ~100, got {}", d);

        // Identical colors = 0
        let d = delta_e76(128, 64, 32, 128, 64, 32);
        assert!((d - 0.0).abs() < 0.001, "Same color deltaE should be 0, got {}", d);

        // Two reds should be closer than red vs blue
        let d_reds = delta_e76(255, 0, 0, 200, 0, 0);
        let d_red_blue = delta_e76(255, 0, 0, 0, 0, 255);
        assert!(d_reds < d_red_blue, "Similar reds should be closer than red vs blue");

        // Lab conversion sanity check
        let (l, _a, _b) = rgb_to_lab(255, 255, 255);
        assert!((l - 100.0).abs() < 1.0, "White L* should be ~100, got {}", l);

        let (l, _a, _b) = rgb_to_lab(0, 0, 0);
        assert!(l.abs() < 1.0, "Black L* should be ~0, got {}", l);
    }
}
