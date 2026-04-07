use serde::{Deserialize, Serialize};
use image::GenericImageView;

#[derive(Serialize, Deserialize)]
pub struct PixelData {
    pub width: u32,
    pub height: u32,
    /// Flat array of [r, g, b, r, g, b, ...] for each pixel row by row
    pub pixels: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
pub struct ImagePreview {
    pub original_width: u32,
    pub original_height: u32,
    pub preview_width: u32,
    pub preview_height: u32,
    /// RGB pixels of preview image
    pub pixels: Vec<u8>,
}

#[derive(Deserialize)]
pub struct CropRegion {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// Return a display-sized preview of the image plus original dimensions
#[tauri::command]
pub fn preview_image(path: String) -> Result<ImagePreview, String> {
    let img = image::open(&path).map_err(|e| format!("Failed to open image: {}", e))?;
    let (ow, oh) = img.dimensions();

    // Preview fits within 400×400 for display
    let preview = img.resize(400, 400, image::imageops::FilterType::Triangle);
    let (pw, ph) = preview.dimensions();

    let mut pixels = Vec::with_capacity((pw * ph * 3) as usize);
    for y in 0..ph {
        for x in 0..pw {
            let pixel = preview.get_pixel(x, y);
            pixels.push(pixel[0]);
            pixels.push(pixel[1]);
            pixels.push(pixel[2]);
        }
    }

    Ok(ImagePreview {
        original_width: ow,
        original_height: oh,
        preview_width: pw,
        preview_height: ph,
        pixels,
    })
}

#[tauri::command]
pub fn import_image(path: String, max_dimension: u32, crop: Option<CropRegion>, sharp: Option<bool>) -> Result<PixelData, String> {
    let img = image::open(&path).map_err(|e| format!("Failed to open image: {}", e))?;

    let cropped = if let Some(c) = crop {
        img.crop_imm(c.x, c.y, c.width, c.height)
    } else {
        img
    };

    let filter = if sharp.unwrap_or(false) {
        image::imageops::FilterType::Nearest
    } else {
        image::imageops::FilterType::Lanczos3
    };
    let resized = cropped.resize(max_dimension, max_dimension, filter);
    let (w, h) = resized.dimensions();

    let mut pixels = Vec::with_capacity((w * h * 3) as usize);
    for y in 0..h {
        for x in 0..w {
            let pixel = resized.get_pixel(x, y);
            pixels.push(pixel[0]);
            pixels.push(pixel[1]);
            pixels.push(pixel[2]);
        }
    }

    Ok(PixelData {
        width: w,
        height: h,
        pixels,
    })
}
