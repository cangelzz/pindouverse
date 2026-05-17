use ab_glyph::{point, Font, FontRef, PxScale, ScaleFont};
use image::{imageops, Rgba, RgbaImage};
use imageproc::drawing::draw_text_mut;
use std::sync::OnceLock;

const APP_NAME: &str = "PindouVerse";

/// Returns the height (in pixels) of the header band.
pub fn header_height(cell_size: u32, show_header: bool) -> u32 {
    if show_header { 2 * cell_size } else { 0 }
}

fn measure_text(scale: PxScale, font: &impl Font, text: &str) -> (i32, i32, i32) {
    let scaled = font.as_scaled(scale);
    let mut w = 0f32;
    let mut min_y = f32::INFINITY;
    let mut max_y = f32::NEG_INFINITY;
    for c in text.chars() {
        let id = scaled.glyph_id(c);
        let glyph = id.with_scale_and_position(scale, point(w, scaled.ascent()));
        w += scaled.h_advance(id);
        if let Some(g) = scaled.outline_glyph(glyph) {
            let bb = g.px_bounds();
            min_y = min_y.min(bb.min.y);
            max_y = max_y.max(bb.max.y);
        }
    }
    if !min_y.is_finite() {
        min_y = 0.0;
        max_y = 0.0;
    }
    (w.round() as i32, min_y.round() as i32, max_y.round() as i32)
}

/// Returns the decoded app icon. Decoded once and cached for the process lifetime.
fn load_icon() -> Option<&'static RgbaImage> {
    static ICON_CACHE: OnceLock<Option<RgbaImage>> = OnceLock::new();
    ICON_CACHE
        .get_or_init(|| {
            let bytes: &[u8] = include_bytes!("../../icons/64x64.png");
            image::load_from_memory(bytes).ok().map(|d| d.to_rgba8())
        })
        .as_ref()
}

pub struct DrawHeaderOpts<'a> {
    pub cell_size: u32,
    pub width: u32,
    pub header_height: u32,
    pub description: &'a str,
    pub bold_font: &'a FontRef<'a>,
}

pub fn draw_header(img: &mut RgbaImage, opts: DrawHeaderOpts<'_>) {
    if opts.header_height == 0 { return; }

    // White background covers header strip
    for y in 0..opts.header_height {
        for x in 0..opts.width.min(img.width()) {
            img.put_pixel(x, y, Rgba([255, 255, 255, 255]));
        }
    }

    let pad = opts.cell_size / 4;
    let icon_size = (opts.header_height as f32 * 0.95) as u32;
    let icon_y = (opts.header_height.saturating_sub(icon_size)) / 2;

    if let Some(icon) = load_icon() {
        if icon_size > 0 {
            let resized = imageops::resize(icon, icon_size, icon_size, imageops::FilterType::Triangle);
            for (rx, ry, px) in resized.enumerate_pixels() {
                let tx = pad + rx;
                let ty = icon_y + ry;
                if tx < img.width() && ty < img.height() {
                    let dst = img.get_pixel(tx, ty);
                    let a = px.0[3] as f32 / 255.0;
                    let r = (px.0[0] as f32 * a + dst.0[0] as f32 * (1.0 - a)) as u8;
                    let g = (px.0[1] as f32 * a + dst.0[1] as f32 * (1.0 - a)) as u8;
                    let b = (px.0[2] as f32 * a + dst.0[2] as f32 * (1.0 - a)) as u8;
                    img.put_pixel(tx, ty, Rgba([r, g, b, 255]));
                }
            }
        }
    }

    // Text: PindouVerse[ - <description>]
    let text_x = (pad + icon_size + pad) as i32;
    let font_size = opts.header_height as f32 * 0.4;
    let scale = PxScale::from(font_size);
    let full = if opts.description.is_empty() {
        APP_NAME.to_string()
    } else {
        format!("{} - {}", APP_NAME, opts.description)
    };
    let (_, ink_min_y, ink_max_y) = measure_text(scale, opts.bold_font, &full);
    let text_y = opts.header_height as i32 / 2 - (ink_min_y + ink_max_y) / 2;
    draw_text_mut(
        img,
        Rgba([31, 41, 55, 255]),
        text_x,
        text_y,
        scale,
        opts.bold_font,
        &full,
    );

    // Bottom separator line
    let sep_y = opts.header_height.saturating_sub(1);
    if sep_y < img.height() {
        for x in 0..opts.width.min(img.width()) {
            img.put_pixel(x, sep_y, Rgba([229, 231, 235, 255]));
        }
    }
}

pub struct DrawWatermarkOpts<'a> {
    pub cell_size: u32,
    pub grid_x: u32,
    pub grid_y: u32,
    pub grid_w: u32,
    pub grid_h: u32,
    pub lines: &'a [String],
    pub bold_font: &'a FontRef<'a>,
}

/// Renders the 45° tiled watermark text onto a transparent RGBA buffer the
/// size of the grid, then rotates and alpha-composites it onto `img`.
pub fn draw_watermark(img: &mut RgbaImage, opts: DrawWatermarkOpts<'_>) {
    if opts.lines.is_empty() || opts.grid_w == 0 || opts.grid_h == 0 { return; }

    let diag = ((opts.grid_w as f64).powi(2) + (opts.grid_h as f64).powi(2))
        .sqrt()
        .ceil() as u32;
    let layer_w = diag.max(opts.grid_w) + 4 * opts.cell_size;
    let layer_h = diag.max(opts.grid_h) + 4 * opts.cell_size;
    let mut layer = RgbaImage::new(layer_w, layer_h);

    let font_size = (opts.cell_size as f32) * 3.0;
    let scale = PxScale::from(font_size);
    let line_gap = 9 * opts.cell_size;
    let line_count = ((diag as f32) / (line_gap as f32)).ceil().max(2.0) as i32;
    let half = line_count / 2;

    let layer_cx = layer_w as i32 / 2;
    let layer_cy = layer_h as i32 / 2;

    for i in -half..=half {
        let len = opts.lines.len() as i32;
        let idx = ((i % len) + len) % len;
        let text = &opts.lines[idx as usize];
        if text.is_empty() { continue; }
        let (text_w, ink_min_y, ink_max_y) = measure_text(scale, opts.bold_font, text);
        let repeat_gap = ((text_w as f32) * 2.5) as i32;
        if repeat_gap <= 0 { continue; }
        let reach = (diag as i32) / 2 + text_w;
        let stagger = if i.rem_euclid(2) == 0 { 0 } else { repeat_gap / 2 };
        let y = layer_cy + i * (line_gap as i32) - (ink_min_y + ink_max_y) / 2;
        let mut x = layer_cx - reach + stagger - text_w / 2;
        while x <= layer_cx + reach {
            draw_text_mut(
                &mut layer,
                Rgba([150, 150, 150, 56]), // alpha 56/255 ≈ 0.22
                x,
                y,
                scale,
                opts.bold_font,
                text,
            );
            x += repeat_gap;
        }
    }

    // Rotate the layer by -45° (text leans up to the right). image crate
    // doesn't ship arbitrary-angle rotation; use imageproc.
    use imageproc::geometric_transformations::{rotate_about_center, Interpolation};
    let angle = -std::f32::consts::FRAC_PI_4;
    let rotated = rotate_about_center(&layer, angle, Interpolation::Bilinear, Rgba([0, 0, 0, 0]));

    // Composite the center crop of `rotated` onto img at (grid_x, grid_y), sized to (grid_w, grid_h)
    let src_cx = (rotated.width() as i32) / 2;
    let src_cy = (rotated.height() as i32) / 2;
    let dst_w = opts.grid_w.min(img.width().saturating_sub(opts.grid_x));
    let dst_h = opts.grid_h.min(img.height().saturating_sub(opts.grid_y));

    for dy in 0..dst_h {
        for dx in 0..dst_w {
            let sx = src_cx - (opts.grid_w as i32) / 2 + dx as i32;
            let sy = src_cy - (opts.grid_h as i32) / 2 + dy as i32;
            if sx < 0 || sy < 0 || sx >= rotated.width() as i32 || sy >= rotated.height() as i32 {
                continue;
            }
            let src = rotated.get_pixel(sx as u32, sy as u32);
            let a = src.0[3] as f32 / 255.0;
            if a <= 0.0 { continue; }
            let tx = opts.grid_x + dx;
            let ty = opts.grid_y + dy;
            let dst = img.get_pixel(tx, ty);
            let r = (src.0[0] as f32 * a + dst.0[0] as f32 * (1.0 - a)) as u8;
            let g = (src.0[1] as f32 * a + dst.0[1] as f32 * (1.0 - a)) as u8;
            let b = (src.0[2] as f32 * a + dst.0[2] as f32 * (1.0 - a)) as u8;
            img.put_pixel(tx, ty, Rgba([r, g, b, 255]));
        }
    }
}

/// Bold sans-serif font shared by header and watermark. Parsed once and cached.
pub fn bold_font() -> Result<&'static FontRef<'static>, String> {
    static FONT_CACHE: OnceLock<Result<FontRef<'static>, String>> = OnceLock::new();
    let cached = FONT_CACHE.get_or_init(|| {
        let bytes: &[u8] = include_bytes!("../../fonts/NotoSansSC-Medium.ttf");
        FontRef::try_from_slice(bytes).map_err(|e| format!("Failed to load CJK font: {}", e))
    });
    cached.as_ref().map_err(|e| e.clone())
}
