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
    /// Optional: if the auto-bbox picked the wrong region, the UI can hand us
    /// the user-drawn pixel rectangle. When supplied, bbox detection is
    /// skipped and recover_grid_geometry runs inside this rectangle.
    pub bbox_left: Option<u32>,
    pub bbox_top: Option<u32>,
    pub bbox_right: Option<u32>,
    pub bbox_bottom: Option<u32>,
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

#[derive(serde::Deserialize)]
struct BlueprintMetadataRead {
    v: u32,
    #[serde(rename = "gridWidth")]
    grid_width: u32,
    #[serde(rename = "gridHeight")]
    grid_height: u32,
    #[serde(rename = "cellSize")]
    cell_size: u32,
    #[serde(rename = "originX")]
    origin_x: u32,
    #[serde(rename = "originY")]
    origin_y: u32,
}

/// Read the `pindouverse-blueprint` tEXt chunk from a PNG if present. Returns
/// None for non-PNG inputs, missing chunks, parse errors, or unsupported
/// schema versions — the caller falls back to detection in all those cases.
fn read_blueprint_metadata(path: &str) -> Option<BlueprintMetadataRead> {
    let file = std::fs::File::open(path).ok()?;
    let decoder = png::Decoder::new(std::io::BufReader::new(file));
    let reader = decoder.read_info().ok()?;
    let info = reader.info();
    let chunk_text = info
        .uncompressed_latin1_text
        .iter()
        .find(|c| c.keyword == "pindouverse-blueprint")
        .map(|c| c.text.clone())
        .or_else(|| {
            info.utf8_text
                .iter()
                .find(|c| c.keyword == "pindouverse-blueprint")
                .and_then(|c: &png::text_metadata::ITXtChunk| c.get_text().ok())
        })?;
    let parsed: BlueprintMetadataRead = serde_json::from_str(&chunk_text).ok()?;
    if parsed.v != 1 {
        return None;
    }
    Some(parsed)
}

/// Sampling configuration that adapts to image format
struct SamplingConfig {
    inset_ratio: f64,
    extra_samples: u32,
    grid_lum_threshold: f64,
    /// Step 2 (integer-divisor walk) acceptance ratio. PNG signals are crisp
    /// so we can use a tight 0.95 (a sub-period feature in PNG rarely clears
    /// 95% of the true-period corr). JPEG compression softens grid lines and
    /// reduces the fundamental's peak by 10-20%, so genuine harmonic demotes
    /// often have ratios in the 0.80-0.90 range — using 0.95 there would
    /// prevent correct 2P→P demotion.
    autocorr_step2_accept: f64,
    /// Step 3 (non-divisor near-candidates) acceptance. Same logic as Step 2.
    autocorr_step3_accept: f64,
}

impl SamplingConfig {
    fn for_format(format: ImageFormat) -> Self {
        match format {
            ImageFormat::Png => SamplingConfig {
                inset_ratio: 0.2,
                extra_samples: 0,
                grid_lum_threshold: 230.0,
                autocorr_step2_accept: 0.95,
                autocorr_step3_accept: 0.95,
            },
            ImageFormat::Jpeg => SamplingConfig {
                inset_ratio: 0.25,
                extra_samples: 8,
                grid_lum_threshold: 210.0,
                autocorr_step2_accept: 0.85,
                autocorr_step3_accept: 0.85,
            },
            ImageFormat::Other => SamplingConfig {
                inset_ratio: 0.2,
                extra_samples: 4,
                grid_lum_threshold: 220.0,
                autocorr_step2_accept: 0.90,
                autocorr_step3_accept: 0.90,
            },
        }
    }
}

// ─── Detection algorithm tuning constants ───────────────────────
// All thresholds the grid-bbox / autocorrelation detector relies on. Tuned
// against the kagome real-image fixture + synthetic round-trips. Bumping any
// of these could regress accuracy — adjust with a regression test in hand.

/// Minimum fraction of cross-axis pixels that must be "dark" for a row/col
/// to count as inside the grid block (vs header/legend padding).
const BBOX_DENSITY_FLOOR: f64 = 0.05;

/// Minimum fraction of each axis the detected bbox must span. Smaller →
/// we probably found a logo or watermark band, not the grid.
const BBOX_MIN_AXIS_COVERAGE: f64 = 0.30;

/// Autocorrelation: smallest lag (in px) considered as a candidate period.
const AUTOCORR_MIN_LAG: u32 = 5;

/// Autocorrelation: largest lag considered. Cell sizes above ~120 px are
/// effectively unheard of for bead grids in our exporter.
const AUTOCORR_MAX_LAG: u32 = 120;

/// A divisor candidate's corr must be at least this fraction of the
/// global-max-lag corr to be accepted as the true period.
///
/// Per-format actual values live in `SamplingConfig::for_format`. PNG is 0.95
/// (crisp signal, sub-period spurious peaks are well below the true period);
/// JPEG is 0.85 (compression softens the fundamental's corr by 10-20%, so a
/// genuine 2P→P demote can have ratio in the 80s).

/// A divisor candidate must also score at least this multiplier of the
/// mean of its 6 neighboring lags to count as a "strong local peak"
/// (defends against ambient noise on the autocorr decay curve).
const AUTOCORR_LOCAL_PEAK_RATIO: f64 = 1.05;

/// Half-width (in lags) of the strict-local-max window for the local-peak
/// check above. Combined with LOCAL_PEAK_RATIO.
const AUTOCORR_LOCAL_PEAK_WINDOW: u32 = 3;

/// Step 3 (non-divisor candidate scan) acceptance: a candidate near
/// best_lag/k may displace the current best_lag only if its corr is at
/// least this fraction of the global-max corr.
///
/// Per-format actual values live in `SamplingConfig::for_format`.

/// Intra-cell-feature override: when the global-max lag in one axis is from
/// an intra-cell feature (text strokes, anti-aliased grid lines) the TRUE
/// cell period is at a larger lag. Detect by cross-axis disagreement: if
/// lag_x and lag_y differ by more than this factor, the smaller one is
/// likely a feature artifact — take the LARGER lag for both axes. Cells in
/// our exports (and most third-party blueprints) are square or nearly so,
/// so this is a strong sanity check.
const CROSS_AXIS_DISAGREE_FACTOR: f64 = 2.0;

/// Alternating-signal handling: halve the period when corr(L/2) is at most
/// this multiple of corr(L) (i.e., L/2 is strongly anti-correlated).
const AUTOCORR_ALTERNATING_NEG_RATIO: f64 = -0.5;

/// Phase snapping: a candidate line position is "plausible" when its row
/// signal is at least this fraction of the p90 of the in-bbox signal.
const SNAP_LINE_THRESH_FRAC: f64 = 0.5;

/// Phase snapping: percentile of the in-bbox signal used to define
/// SNAP_LINE_THRESH_FRAC's reference value.
const SNAP_LINE_THRESH_PERCENTILE: f64 = 0.9;

/// Phase snapping: half-window (in px) for the strict-max plausibility check.
const SNAP_LINE_WINDOW: u32 = 2;

// ─── Grid detection ─────────────────────────────────────────────

/// Rectangular pixel region of the actual grid in the image (excluding
/// header bands, side margins, and the legend below the grid).
struct GridBBox {
    left: u32,
    top: u32,
    right: u32,  // exclusive
    bottom: u32, // exclusive
}

/// Count pixels with luminance < threshold in one row.
fn row_dark_count(img: &RgbaImage, y: u32, lum_threshold: f64) -> u32 {
    let (w, _) = img.dimensions();
    let mut count = 0u32;
    for x in 0..w {
        let p = img.get_pixel(x, y);
        let lum = 0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64;
        if lum < lum_threshold { count += 1; }
    }
    count
}

fn col_dark_count(img: &RgbaImage, x: u32, lum_threshold: f64) -> u32 {
    let (_, h) = img.dimensions();
    let mut count = 0u32;
    for y in 0..h {
        let p = img.get_pixel(x, y);
        let lum = 0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64;
        if lum < lum_threshold { count += 1; }
    }
    count
}

/// Find the rectangular grid region by per-axis dark-pixel density. Returns
/// None if no plausible grid block is found (caller surfaces an error).
///
/// Strategy: in each axis, find the longest contiguous run of rows/cols whose
/// dark-pixel count is at least 5% of the cross-axis size. We do NOT cap on
/// the high end — a row that's entirely a grid line (close to 100% dark) is
/// still "in-grid" and must not break the run. Header bands, padding, and
/// the gap between grid and legend are all near 0% and so naturally split
/// the image into distinct runs; the grid is the longest of them.
fn detect_grid_bbox(img: &RgbaImage, lum_threshold: f64) -> Option<GridBBox> {
    let (w, h) = img.dimensions();
    let row_dark: Vec<u32> = (0..h).map(|y| row_dark_count(img, y, lum_threshold)).collect();
    let col_dark: Vec<u32> = (0..w).map(|x| col_dark_count(img, x, lum_threshold)).collect();

    let row_lo = (w as f64 * BBOX_DENSITY_FLOOR) as u32;
    let col_lo = (h as f64 * BBOX_DENSITY_FLOOR) as u32;

    let (top, bottom) = longest_run_above(&row_dark, row_lo)?;
    let (left, right) = longest_run_above(&col_dark, col_lo)?;

    // Sanity check: the bbox must cover at least BBOX_MIN_AXIS_COVERAGE of
    // each axis. If not, we likely detected something else (a logo, …).
    if (bottom - top) as f64 / (h as f64) < BBOX_MIN_AXIS_COVERAGE { return None; }
    if (right - left) as f64 / (w as f64) < BBOX_MIN_AXIS_COVERAGE { return None; }

    Some(GridBBox { left, top, right: right + 1, bottom: bottom + 1 })
}

/// Longest contiguous run of indices `i` where `values[i] >= lo`. Returns the
/// inclusive (first, last) of that run, or None if no run.
fn longest_run_above(values: &[u32], lo: u32) -> Option<(u32, u32)> {
    let mut best: Option<(u32, u32)> = None;
    let mut cur_start: Option<u32> = None;
    for (i, &v) in values.iter().enumerate() {
        let i = i as u32;
        if v >= lo {
            if cur_start.is_none() { cur_start = Some(i); }
            let s = cur_start.unwrap();
            match best {
                None => best = Some((s, i)),
                Some((bs, be)) if (i - s + 1) > (be - bs + 1) => best = Some((s, i)),
                _ => {}
            }
        } else {
            cur_start = None;
        }
    }
    best
}

/// Compute autocorrelation peak of a signal in the lag range [min_lag, max_lag].
/// Returns (best_lag_as_f64, normalized_corr). The lag is refined to sub-pixel
/// precision by parabolic interpolation around the integer peak.
///
/// Harmonic ambiguity:
/// (a) A periodic signal of period P peaks at P, 2P, 3P, …. We prefer the
///     smallest integer divisor of the global-max lag whose corr ≥ 80% of max
///     AND is a *strong* local peak (max in ±3-px window, 5% higher than its
///     6-neighbor mean) — picks the fundamental, not a multiple of it.
/// (b) An *alternating* periodic signal (e.g. a 6-color cycle of cells) peaks
///     at 2*cell with a strong NEGATIVE trough at 1*cell. We halve the lag
///     only if corr(L/2) ≤ -0.5 * corr(L) — proves an alternation pattern.
fn autocorr_peak(
    signal: &[f64],
    min_lag: usize,
    max_lag: usize,
    step2_accept: f64,
    step3_accept: f64,
) -> Option<(f64, f64)> {
    let n = signal.len();
    if n < max_lag + 2 { return None; }
    let mean: f64 = signal.iter().sum::<f64>() / n as f64;
    let centered: Vec<f64> = signal.iter().map(|v| v - mean).collect();
    let var: f64 = centered.iter().map(|v| v * v).sum::<f64>() / n as f64;
    if var <= 0.0 { return None; }

    let corr_at = |lag: usize| -> f64 {
        if lag == 0 || lag >= n { return f64::NEG_INFINITY; }
        let mut sum = 0.0;
        for i in 0..(n - lag) { sum += centered[i] * centered[i + lag]; }
        sum / ((n - lag) as f64 * var)
    };

    let hi = max_lag.min(n - 2);
    // A "strong local peak" stands out from a 6-wide neighborhood: it's the
    // strict max in [lag-WINDOW, lag+WINDOW] AND at least LOCAL_PEAK_RATIO
    // higher than the mean of those 6 neighbors. Small bumps on the
    // autocorr decay don't qualify.
    let is_strong_local_peak = |lag: usize| -> bool {
        let win = AUTOCORR_LOCAL_PEAK_WINDOW as i64;
        if lag < (win + 1) as usize || lag >= n - win as usize { return false; }
        let c = corr_at(lag);
        let mut neigh_sum = 0.0;
        for off in 1..=win {
            let lo = corr_at((lag as i64 - off) as usize);
            let c_hi = corr_at((lag as i64 + off) as usize);
            if lo >= c || c_hi >= c { return false; }
            neigh_sum += lo + c_hi;
        }
        let neigh_mean = neigh_sum / (2 * win) as f64;
        c >= neigh_mean * AUTOCORR_LOCAL_PEAK_RATIO
    };

    // Find global-max lag in [min_lag, hi].
    let mut max_lag_found = min_lag;
    let mut max_corr = f64::NEG_INFINITY;
    for lag in min_lag..=hi {
        let c = corr_at(lag);
        if c > max_corr { max_corr = c; max_lag_found = lag; }
    }
    if max_corr <= 0.0 { return None; }

    // Step 1: handle alternating-cell aliasing — when the signal alternates
    // (e.g. a 6-color cycle of cells), the autocorr peaks at 2*cell_size
    // with a strong NEGATIVE trough at 1*cell_size. We only halve if the
    // half-lag corr is significantly NEGATIVE (so we know it's a trough,
    // not just a high point on the autocorr decay curve).
    let mut best_lag = max_lag_found;
    let half = best_lag / 2;
    if half >= min_lag {
        let c_half = corr_at(half);
        if c_half <= AUTOCORR_ALTERNATING_NEG_RATIO * max_corr {
            best_lag = half;
        }
    }

    // Step 2: smallest integer divisor of best_lag that is also a LOCAL
    // MAXIMUM and has corr ≥ AUTOCORR_DIVISOR_ACCEPT of global max. Catches
    // signals with strong harmonics at integer multiples. The local-peak
    // requirement prevents picking a tiny lag on the autocorr decay curve.
    //
    // We try divisors of best_lag in ascending order so the SMALLEST accepted
    // period wins (avoiding 2P/3P harmonics). When best_lag happens to be a
    // prime multiple kP (k prime, k > 1), only d=1 and d=k divide it — d=k
    // returns candidate=P, which is correct. The Step-3 small-k offset scan
    // further down handles even more exotic cases. The loop is O(best_lag);
    // safe for our AUTOCORR_MAX_LAG of 120.
    let acceptance = max_corr * step2_accept;
    for d in 2..=best_lag {
        if best_lag % d != 0 { continue; }
        let candidate = best_lag / d;
        if candidate < min_lag { break; }
        if corr_at(candidate) >= acceptance && is_strong_local_peak(candidate) {
            best_lag = candidate;
        }
    }
    // Step 3: non-integer-divisor candidates near best_lag / k for k=2..5.
    // Uses a tighter acceptance threshold than Step 2 — a spurious in-cell
    // sub-period peak (text overlay, anti-aliased grid lines) can easily clear
    // 80% of the global max and would incorrectly displace the true period.
    let step3_acceptance = max_corr * step3_accept;
    for k in 2..=5usize {
        let cand = best_lag / k;
        if cand < min_lag { break; }
        for c_off in [-2i64, -1, 0, 1, 2] {
            let c = (cand as i64 + c_off).max(min_lag as i64) as usize;
            if c >= hi { continue; }
            if corr_at(c) >= step3_acceptance && is_strong_local_peak(c) && c < best_lag {
                best_lag = c;
            }
        }
    }

    let c0 = corr_at(best_lag);
    if best_lag <= min_lag || best_lag >= hi { return Some((best_lag as f64, c0)); }
    let cm1 = corr_at(best_lag - 1);
    let cp1 = corr_at(best_lag + 1);
    let denom = cm1 - 2.0 * c0 + cp1;
    let lag_f = if denom.abs() < 1e-9 { best_lag as f64 }
                else { best_lag as f64 + 0.5 * (cm1 - cp1) / denom };
    Some((lag_f, c0))
}

/// Recover the grid geometry inside a detected bbox by autocorrelation of the
/// per-axis dark-pixel density signal. Returns
/// (grid_w, grid_h, cs_x, cs_y, origin_x, origin_y) where origin is the
/// top-left of the (possibly extended) full grid region.
///
/// Autocorrelation gives the period (cell size) very accurately even when the
/// bbox is conservative (cropped inward of the true grid). After we know the
/// period, we re-find the grid extent by scanning the full image for the
/// first/last column (resp. row) whose density is consistent with the rest
/// of the grid, snapped to multiples of the period.
fn recover_grid_geometry(
    img: &RgbaImage,
    bbox: &GridBBox,
    config: &SamplingConfig,
) -> Option<(u32, u32, f64, f64, u32, u32)> {
    let (img_w, img_h) = img.dimensions();
    let bbox_w = (bbox.right - bbox.left) as usize;
    let bbox_h = (bbox.bottom - bbox.top) as usize;
    if bbox_w < 20 || bbox_h < 20 { return None; }

    // Signals over the FULL image axes (not just bbox) so we can extend
    // outward once we know the cell size. Each entry is the dark-pixel count
    // for that column / row, computed over the bbox cross-axis range (so the
    // signal sees only the grid band, not headers/legends below).
    let col_sig: Vec<f64> = (0..img_w).map(|x| {
        let mut dark = 0u32;
        for y in bbox.top..bbox.bottom {
            let p = img.get_pixel(x, y);
            let lum = 0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64;
            if lum < config.grid_lum_threshold { dark += 1; }
        }
        dark as f64
    }).collect();

    let row_sig: Vec<f64> = (0..img_h).map(|y| {
        let mut dark = 0u32;
        for x in bbox.left..bbox.right {
            let p = img.get_pixel(x, y);
            let lum = 0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64;
            if lum < config.grid_lum_threshold { dark += 1; }
        }
        dark as f64
    }).collect();

    // Plausible cell sizes: AUTOCORR_MIN_LAG..AUTOCORR_MAX_LAG px. Autocorrelate
    // within the bbox slice of each signal — outside-bbox padding would dilute
    // the periodicity.
    let col_slice = &col_sig[bbox.left as usize..bbox.right as usize];
    let row_slice = &row_sig[bbox.top as usize..bbox.bottom as usize];
    let max_lag_x = (bbox_w / 4).min(AUTOCORR_MAX_LAG as usize).max(6);
    let max_lag_y = (bbox_h / 4).min(AUTOCORR_MAX_LAG as usize).max(6);
    let (lag_x, _) = autocorr_peak(
        col_slice, AUTOCORR_MIN_LAG as usize, max_lag_x,
        config.autocorr_step2_accept, config.autocorr_step3_accept,
    )?;
    let (lag_y, _) = autocorr_peak(
        row_slice, AUTOCORR_MIN_LAG as usize, max_lag_y,
        config.autocorr_step2_accept, config.autocorr_step3_accept,
    )?;

    // Cross-axis sanity check: cells in our exports (and most blueprint
    // exporters) are square. If one axis's autocorr was fooled by an
    // intra-cell feature (text strokes producing a strong sub-cell peak
    // that beat the true cell period in raw corr value), the two axes will
    // disagree by a large factor. Take the LARGER lag for both — feature
    // artifacts have smaller spacing than the cell itself.
    let ratio = (lag_x / lag_y).max(lag_y / lag_x);
    let (lag_x, lag_y) = if ratio > CROSS_AXIS_DISAGREE_FACTOR {
        let l = lag_x.max(lag_y);
        (l, l)
    } else {
        (lag_x, lag_y)
    };

    // Extend bbox outward to recover any cells that were lost when the
    // initial dark-density bbox detection cropped past axis labels / margins.
    // We snap to grid-line phase: find first/last x where a periodic line
    // position has enough darkness to plausibly BE a grid line.
    let (new_left, new_right) = snap_to_grid_lines(&col_sig, bbox.left, bbox.right, lag_x);
    let (new_top, new_bottom) = snap_to_grid_lines(&row_sig, bbox.top, bbox.bottom, lag_y);

    let span_x = (new_right - new_left) as f64;
    let span_y = (new_bottom - new_top) as f64;
    let cells_w = (span_x / lag_x).round() as u32;
    let cells_h = (span_y / lag_y).round() as u32;
    if cells_w == 0 || cells_h == 0 { return None; }

    let cs_x = span_x / cells_w as f64;
    let cs_y = span_y / cells_h as f64;
    Some((cells_w, cells_h, cs_x, cs_y, new_left, new_top))
}

/// Snap the bbox span to grid-line phase: find the offset (phase) such that
/// sampling the signal at positions phase, phase+period, phase+2*period, …
/// maximizes total signal. Then return (first_line, last_line) — the first
/// and last positions in that phase that exceed a "is a real grid line"
/// threshold. The grid extent is bounded by these two positions and the
/// number of cells is the number of intervals between them.
fn snap_to_grid_lines(signal: &[f64], hint_start: u32, hint_end: u32, period: f64) -> (u32, u32) {
    if hint_end <= hint_start || period < 2.0 { return (hint_start, hint_end); }
    let len = signal.len();
    let period_int = period.round().max(2.0) as usize;
    let s = hint_start as usize;
    let e = (hint_end as usize).min(len);
    if e <= s { return (hint_start, hint_end); }

    // Get a robust max from the in-hint signal (SNAP_LINE_THRESH_PERCENTILE
    // percentile) → typical grid-line density. We accept lines whose signal
    // is ≥ SNAP_LINE_THRESH_FRAC of that.
    let mut sorted: Vec<f64> = signal[s..e].to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let p_idx = ((sorted.len() as f64 * SNAP_LINE_THRESH_PERCENTILE) as usize)
        .min(sorted.len() - 1);
    let p90 = sorted[p_idx];
    let line_thresh = p90 * SNAP_LINE_THRESH_FRAC;

    // Local-max within ±SNAP_LINE_WINDOW px (lines may be 1-3 px thick or anti-aliased).
    let win = SNAP_LINE_WINDOW as i64;
    let line_density = |pos: i64| -> f64 {
        let lo = (pos - win).max(0) as usize;
        let hi = ((pos + win + 1) as usize).min(len);
        if hi <= lo { return 0.0; }
        signal[lo..hi].iter().cloned().fold(0.0_f64, f64::max)
    };

    // Try every integer phase in [0, period). For each, count how many
    // candidate positions inside [hint_start, hint_end] qualify as lines.
    // The best phase wins.
    let mut best_phase = 0usize;
    let mut best_score = 0i32;
    for phase in 0..period_int {
        let mut score = 0i32;
        let mut k = 0usize;
        loop {
            let pos = phase as f64 + k as f64 * period;
            let pos_i = pos.round() as i64;
            if (pos_i as usize) >= len { break; }
            if pos_i >= s as i64 && pos_i < e as i64 {
                if line_density(pos_i) >= line_thresh { score += 1; }
            }
            k += 1;
        }
        if score > best_score { best_score = score; best_phase = phase; }
    }

    // With the best phase, find the contiguous run of qualifying lines that
    // straddles the bbox interior. We start from a known-good line position
    // inside the bbox, then walk left and right, stopping at the first
    // candidate that fails to qualify (a gap means we've left the grid).
    // First find any qualifying line position inside [s, e].
    let mut seed: Option<i64> = None;
    let mut k = 0usize;
    loop {
        let pos = best_phase as f64 + k as f64 * period;
        let pos_i = pos.round() as i64;
        if (pos_i as usize) >= len { break; }
        if pos_i >= s as i64 && pos_i < e as i64 && line_density(pos_i) >= line_thresh {
            seed = Some(pos_i);
            break;
        }
        k += 1;
    }
    let seed = match seed { Some(v) => v, None => return (hint_start, hint_end) };

    // Walk left from seed, stopping at first non-line. Mirror the right-edge
    // logic for grids drawn flush to the left canvas edge.
    let mut first_line = seed;
    let mut k: i64 = 1;
    loop {
        let candidate = ((seed as f64) - (k as f64) * period).round() as i64;
        if candidate < -(win) { break; }
        let lo = (candidate - win).max(0) as usize;
        let hi = ((candidate + win + 1) as usize).min(len);
        if hi <= lo { break; }
        let local_max = signal[lo..hi].iter().cloned().fold(0.0_f64, f64::max);
        if local_max < line_thresh { break; }
        first_line = candidate.max(0);
        k += 1;
    }

    // Walk right from seed, stopping at first non-line. We allow candidates
    // up to len (inclusive) — a grid drawn flush to the canvas right edge
    // has its closing line *at* the image edge (or even 1-2 px shy due to
    // antialiasing); line_density's ±SNAP_LINE_WINDOW px window catches that.
    let mut last_line = seed;
    let mut k: i64 = 1;
    loop {
        let candidate = ((seed as f64) + (k as f64) * period).round() as i64;
        // Allow candidate == len (image edge); only break if window has
        // no valid samples at all.
        if candidate > len as i64 + win { break; }
        let lo = (candidate - win).max(0) as usize;
        let hi = ((candidate + win + 1) as usize).min(len);
        if hi <= lo { break; }
        let local_max = signal[lo..hi].iter().cloned().fold(0.0_f64, f64::max);
        if local_max < line_thresh { break; }
        last_line = candidate.min((len - 1) as i64);
        k += 1;
    }

    if last_line > first_line { (first_line as u32, last_line as u32) }
    else { (hint_start, hint_end) }
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

// ─── Result assembly helper ─────────────────────────────────────

fn build_import_result(
    grid_w: u32,
    grid_h: u32,
    cell_size: u32,
    origin_x: u32,
    origin_y: u32,
    img: &RgbaImage,
    color_results: &[Vec<(String, f64)>],
    palette: &[PaletteColor],
    avg_confidence: f64,
    mode: ImportMode,
) -> BlueprintImportResult {
    // Detect which cells have text (to distinguish empty vs white/H2)
    let mut has_text_grid: Vec<Vec<bool>> = vec![vec![false; grid_w as usize]; grid_h as usize];
    let text_detect_tasks: Vec<(u32, u32, u32, u32)> = (0..grid_h)
        .flat_map(|row| (0..grid_w).map(move |col| (row, col, origin_x + col * cell_size, origin_y + row * cell_size)))
        .collect();

    let text_detect_results: Vec<(u32, u32, bool)> = text_detect_tasks.par_iter()
        .map(|&(row, col, x0, y0)| {
            let cell_bin = extract_cell_binary(img, x0, y0, cell_size);
            (row, col, cell_has_text(&cell_bin, cell_size))
        })
        .collect();

    for (row, col, has_text) in text_detect_results {
        has_text_grid[row as usize][col as usize] = has_text;
    }

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
            let is_white_color = if let Some(pc) = palette.iter().find(|p| p.code == *cc) {
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

    BlueprintImportResult {
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
    }
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

    // Fast path: if the PNG carries our metadata chunk, we know exactly where
    // the grid sits and what the cell size is — skip all detection.
    if let Some(meta) = read_blueprint_metadata(&request.path) {
        let mut color_results: Vec<Vec<(String, f64)>> = Vec::new();
        let mut total_confidence = 0.0;
        let mut cell_count = 0u32;
        for row in 0..meta.grid_height {
            let mut row_results: Vec<(String, f64)> = Vec::new();
            for col in 0..meta.grid_width {
                let x0 = meta.origin_x + col * meta.cell_size;
                let y0 = meta.origin_y + row * meta.cell_size;
                match sample_cell_color(&img, x0, y0, meta.cell_size, &config) {
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
        return Ok(build_import_result(
            meta.grid_width,
            meta.grid_height,
            meta.cell_size,
            meta.origin_x,
            meta.origin_y,
            &img,
            &color_results,
            &request.palette,
            avg_confidence,
            mode,
        ));
    }

    // Detect-path (no metadata chunk): find the grid bbox first, then either
    // use user-provided dims or count grid-line spikes to derive cell size.
    // If the user redrew the bbox in the import dialog, prefer it over auto.
    let (img_w_for_bbox, img_h_for_bbox) = img.dimensions();
    let bbox = match (
        request.bbox_left,
        request.bbox_top,
        request.bbox_right,
        request.bbox_bottom,
    ) {
        (Some(l), Some(t), Some(r), Some(b)) if r > l && b > t => GridBBox {
            left: l.min(img_w_for_bbox.saturating_sub(1)),
            top: t.min(img_h_for_bbox.saturating_sub(1)),
            right: r.min(img_w_for_bbox).max(l + 1),
            bottom: b.min(img_h_for_bbox).max(t + 1),
        },
        _ => detect_grid_bbox(&img, config.grid_lum_threshold)
            .ok_or("Could not locate a grid region. Is this a blueprint image?")?,
    };

    // Always run recover_grid_geometry to get precise cs_x/cs_y/origin from
    // the dark-density signal — the bbox alone can under-crop the grid by
    // 1-2 cells, which would make a bbox-only cell_size drift cumulatively.
    // When the user provides grid dims we trust them, but we still use the
    // autocorr-derived cell size & origin.
    let (recovered_w, recovered_h, cs_x, cs_y, origin_x, origin_y) =
        recover_grid_geometry(&img, &bbox, &config)
            .ok_or("Could not recover grid geometry from detected region")?;

    let grid_w = request.grid_width.unwrap_or(recovered_w);
    let grid_h = request.grid_height.unwrap_or(recovered_h);

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
            let x0_f = origin_x as f64 + col as f64 * cs_x;
            let y0_f = origin_y as f64 + row as f64 * cs_y;
            let x0 = x0_f.round() as u32;
            let y0 = y0_f.round() as u32;
            // Per-cell pixel width can vary by 1px when cs is non-integer;
            // use the smaller of (cs_x, cs_y) rounded for sampling so we
            // stay safely inside the cell.
            let sample_cs = cs_x.min(cs_y).round().max(2.0) as u32;
            match sample_cell_color(&img, x0, y0, sample_cs, &config) {
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

    let cell_size_int = cs_x.round() as u32;
    Ok(build_import_result(
        grid_w,
        grid_h,
        cell_size_int,
        origin_x,
        origin_y,
        &img,
        &color_results,
        &request.palette,
        avg_confidence,
        mode,
    ))
}

// ─── Dims-only quick detection ───────────────────────────────────
//
// Returns just the grid dimensions + cell size — skips full color sampling
// and the per-cell text/empty classification. Used by the import dialog to
// pre-fill the user-confirm step before kicking off the slow full import.

#[derive(Serialize)]
pub struct BlueprintDimsResult {
    pub width: u32,
    pub height: u32,
    pub cell_size: u32,
    /// Pixel-coordinate bbox of the grid in the source image. Echoed back to
    /// the UI so it can draw the detected outline on the thumbnail; also lets
    /// a follow-up call pass it back via `BlueprintDimsRequest::bbox`.
    pub bbox_left: u32,
    pub bbox_top: u32,
    pub bbox_right: u32,
    pub bbox_bottom: u32,
    /// True when the PNG carried a pindouverse-blueprint tEXt chunk. The UI
    /// can then tell the user "this will reimport at 100% accuracy".
    pub has_metadata: bool,
}

#[derive(Deserialize, Clone, Copy)]
pub struct UserBBox {
    pub left: u32,
    pub top: u32,
    pub right: u32,
    pub bottom: u32,
}

#[derive(Deserialize)]
pub struct BlueprintDimsRequest {
    pub path: String,
    /// If provided, skip auto-bbox detection and treat this as the grid's
    /// pixel extent. Lets the UI take over when auto-detect picks the wrong
    /// region (e.g., a third-party blueprint with watermarks).
    pub bbox: Option<UserBBox>,
}

#[tauri::command]
pub fn detect_blueprint_dims(
    request: BlueprintDimsRequest,
) -> Result<BlueprintDimsResult, String> {
    let path = &request.path;

    // Fast path: metadata chunk. Only applies when no user bbox is given —
    // if the user is overriding the bbox they want detection, not metadata.
    if request.bbox.is_none() {
        if let Some(meta) = read_blueprint_metadata(path) {
            // originX/originY are the grid's top-left in pixel coords; the
            // bbox spans (origin + dims*cell_size).
            let right = meta.origin_x + meta.grid_width * meta.cell_size;
            let bottom = meta.origin_y + meta.grid_height * meta.cell_size;
            return Ok(BlueprintDimsResult {
                width: meta.grid_width,
                height: meta.grid_height,
                cell_size: meta.cell_size,
                bbox_left: meta.origin_x,
                bbox_top: meta.origin_y,
                bbox_right: right,
                bbox_bottom: bottom,
                has_metadata: true,
            });
        }
    }

    // Detection path.
    let format = detect_format(path);
    let config = SamplingConfig::for_format(format);
    let img = ImageReader::open(path)
        .map_err(|e| format!("Failed to open image: {}", e))?
        .decode()
        .map_err(|e| format!("Failed to decode image: {}", e))?
        .to_rgba8();
    let (img_w, img_h) = img.dimensions();

    // Use the user-supplied bbox if present, otherwise auto-detect.
    let bbox = if let Some(ub) = request.bbox {
        GridBBox {
            left: ub.left.min(img_w.saturating_sub(1)),
            top: ub.top.min(img_h.saturating_sub(1)),
            right: ub.right.min(img_w).max(ub.left + 1),
            bottom: ub.bottom.min(img_h).max(ub.top + 1),
        }
    } else {
        detect_grid_bbox(&img, config.grid_lum_threshold)
            .ok_or("Could not locate a grid region. Is this a blueprint image?")?
    };

    let (grid_w, grid_h, cs_x, _cs_y, _origin_x, _origin_y) =
        recover_grid_geometry(&img, &bbox, &config)
            .ok_or("Could not recover grid geometry from detected region")?;
    Ok(BlueprintDimsResult {
        width: grid_w,
        height: grid_h,
        cell_size: cs_x.round() as u32,
        bbox_left: bbox.left,
        bbox_top: bbox.top,
        bbox_right: bbox.right,
        bbox_bottom: bbox.bottom,
        has_metadata: false,
    })
}
