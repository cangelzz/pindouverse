/**
 * TypeScript port of src-tauri/src/commands/blueprint_import.rs.
 * Used by VS Code webview + browser adapters where there's no Rust backend.
 *
 * Algorithm is identical to the Rust version (verified by per-step constants).
 * Differences:
 *   - Async with progress reporting + AbortSignal cancellation
 *   - Loops yield to the UI thread every N iterations via setTimeout(0)
 *   - Uses Uint8ClampedArray RGBA buffers from canvas.getImageData
 */

import type {
  BlueprintImportResult,
  CellResult,
  CellSource,
  ImportMode,
  PaletteColor,
} from "../adapters";
import { readBlueprintMetadata } from "./pngMetadata";
import { loadImageData, type LoadedImage } from "./imageLoader";

// ─── Public API ─────────────────────────────────────────────────────

export interface ImportTsOpts {
  onProgress?: (stage: string, fraction: number) => void;
  signal?: AbortSignal;
}

export interface ImportTsArgs {
  path: string;
  palette: PaletteColor[];
  gridWidth?: number;
  gridHeight?: number;
  bbox?: BBox;
  mode?: ImportMode;
}

export interface BBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface DetectTsResult {
  width: number;
  height: number;
  cellSize: number;
  bbox: BBox;
  hasMetadata: boolean;
}

interface ReadFileAdapter {
  readFileBase64(path: string): Promise<string>;
}

// ─── Constants (mirror Rust SamplingConfig + module consts) ─────────

// detect_grid_bbox
const BBOX_DENSITY_FLOOR = 0.05;
const BBOX_MIN_AXIS_COVERAGE = 0.30;

// autocorr_peak
const AUTOCORR_MIN_LAG = 5;
const AUTOCORR_MAX_LAG = 120;
const AUTOCORR_LOCAL_PEAK_RATIO = 1.05;
const AUTOCORR_LOCAL_PEAK_WINDOW = 3;
const AUTOCORR_ALTERNATING_NEG_RATIO = -0.5;
const CROSS_AXIS_DISAGREE_FACTOR = 2.0;

// snap_to_grid_lines
const SNAP_LINE_THRESH_FRAC = 0.5;
const SNAP_LINE_THRESH_PERCENTILE = 0.9;
const SNAP_LINE_WINDOW = 2;

// Per-format thresholds (mirror Rust SamplingConfig::for_format)
interface SamplingConfig {
  insetRatio: number;
  extraSamples: number;
  gridLumThreshold: number;
  autocorrStep2Accept: number;
  autocorrStep3Accept: number;
}

function configForMediaType(mediaType: LoadedImage["mediaType"]): SamplingConfig {
  if (mediaType === "image/png") {
    return { insetRatio: 0.2, extraSamples: 0, gridLumThreshold: 230, autocorrStep2Accept: 0.95, autocorrStep3Accept: 0.95 };
  }
  if (mediaType === "image/jpeg") {
    return { insetRatio: 0.25, extraSamples: 8, gridLumThreshold: 210, autocorrStep2Accept: 0.85, autocorrStep3Accept: 0.85 };
  }
  return { insetRatio: 0.2, extraSamples: 4, gridLumThreshold: 220, autocorrStep2Accept: 0.90, autocorrStep3Accept: 0.90 };
}

// ─── Cooperative async: yield + cancel ──────────────────────────────

function checkSignal(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
}

async function yieldToUi(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// ─── Pixel helpers (operate on Uint8ClampedArray RGBA) ──────────────

function pixelLuminance(data: Uint8ClampedArray, x: number, y: number, width: number): number {
  const i = (y * width + x) * 4;
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

function getPixelRGB(data: Uint8ClampedArray, x: number, y: number, width: number): [number, number, number] {
  const i = (y * width + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
}

/**
 * Compute pixel origin for a grid cell using signed column/row offsets
 * (negative = cell is to the left/above the detected origin). Returns null
 * when the cell's top-left falls outside the image — caller treats that as
 * an empty/transparent cell. Mirrors Rust `cell_origin_signed`.
 */
function cellOriginSigned(
  originX: number,
  originY: number,
  csX: number,
  csY: number,
  colSigned: number,
  rowSigned: number,
  imgW: number,
  imgH: number,
): [number, number] | null {
  const x0F = originX + colSigned * csX;
  const y0F = originY + rowSigned * csY;
  if (x0F < 0 || y0F < 0) return null;
  const x0 = Math.round(x0F);
  const y0 = Math.round(y0F);
  if (x0 >= imgW || y0 >= imgH) return null;
  return [x0, y0];
}

// ─── 1. Bbox detection ──────────────────────────────────────────────

function rowDarkCount(data: Uint8ClampedArray, width: number, y: number, lumThreshold: number): number {
  let count = 0;
  for (let x = 0; x < width; x++) {
    if (pixelLuminance(data, x, y, width) < lumThreshold) count++;
  }
  return count;
}

function colDarkCount(data: Uint8ClampedArray, width: number, height: number, x: number, lumThreshold: number): number {
  let count = 0;
  for (let y = 0; y < height; y++) {
    if (pixelLuminance(data, x, y, width) < lumThreshold) count++;
  }
  return count;
}

function longestRunAbove(values: number[], lo: number): [number, number] | null {
  let best: [number, number] | null = null;
  let curStart: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (values[i] >= lo) {
      if (curStart === null) curStart = i;
      const len = i - curStart + 1;
      if (best === null || len > best[1] - best[0] + 1) {
        best = [curStart, i];
      }
    } else {
      curStart = null;
    }
  }
  return best;
}

async function detectGridBBox(
  img: LoadedImage,
  lumThreshold: number,
  opts?: ImportTsOpts,
): Promise<BBox | null> {
  const { data, width, height } = img;
  opts?.onProgress?.("分析水平密度", 0);

  const rowDark: number[] = new Array(height);
  for (let y = 0; y < height; y++) {
    if (y % 64 === 0) {
      checkSignal(opts?.signal);
      opts?.onProgress?.("分析水平密度", y / height);
      await yieldToUi();
    }
    rowDark[y] = rowDarkCount(data, width, y, lumThreshold);
  }

  opts?.onProgress?.("分析垂直密度", 0);
  const colDark: number[] = new Array(width);
  for (let x = 0; x < width; x++) {
    if (x % 64 === 0) {
      checkSignal(opts?.signal);
      opts?.onProgress?.("分析垂直密度", x / width);
      await yieldToUi();
    }
    colDark[x] = colDarkCount(data, width, height, x, lumThreshold);
  }

  const rowLo = Math.floor(width * BBOX_DENSITY_FLOOR);
  const colLo = Math.floor(height * BBOX_DENSITY_FLOOR);

  const yRange = longestRunAbove(rowDark, rowLo);
  const xRange = longestRunAbove(colDark, colLo);
  if (!yRange || !xRange) return null;

  const [top, bottomInclusive] = yRange;
  const [left, rightInclusive] = xRange;
  const bottom = bottomInclusive + 1;
  const right = rightInclusive + 1;

  if ((bottom - top) * 10 < height * 3) return null;
  if ((right - left) * 10 < width * 3) return null;

  return { left, top, right, bottom };
}

// ─── 2. Autocorrelation period detection ───────────────────────────

function autocorrPeak(
  signal: number[],
  minLag: number,
  maxLag: number,
  step2Accept: number,
  step3Accept: number,
): [number, number] | null {
  const n = signal.length;
  if (n < maxLag + 2) return null;

  let mean = 0;
  for (let i = 0; i < n; i++) mean += signal[i];
  mean /= n;

  const centered = new Float64Array(n);
  let varAcc = 0;
  for (let i = 0; i < n; i++) {
    const v = signal[i] - mean;
    centered[i] = v;
    varAcc += v * v;
  }
  const variance = varAcc / n;
  if (variance <= 0) return null;

  const hi = Math.min(maxLag, n - 2);

  function corrAt(lag: number): number {
    if (lag === 0 || lag >= n) return -Infinity;
    let sum = 0;
    for (let i = 0; i < n - lag; i++) sum += centered[i] * centered[i + lag];
    return sum / ((n - lag) * variance);
  }

  function isStrongLocalPeak(lag: number): boolean {
    const win = AUTOCORR_LOCAL_PEAK_WINDOW;
    if (lag < win + 1 || lag >= n - win) return false;
    const c = corrAt(lag);
    let neighSum = 0;
    for (let off = 1; off <= win; off++) {
      const lo = corrAt(lag - off);
      const cHi = corrAt(lag + off);
      if (lo >= c || cHi >= c) return false;
      neighSum += lo + cHi;
    }
    const neighMean = neighSum / (2 * win);
    return c >= neighMean * AUTOCORR_LOCAL_PEAK_RATIO;
  }

  // Global max
  let maxLagFound = minLag;
  let maxCorr = -Infinity;
  for (let lag = minLag; lag <= hi; lag++) {
    const c = corrAt(lag);
    if (c > maxCorr) { maxCorr = c; maxLagFound = lag; }
  }
  if (maxCorr <= 0) return null;

  // Step 1: alternating-cell halving
  let bestLag = maxLagFound;
  const half = Math.floor(bestLag / 2);
  if (half >= minLag) {
    const cHalf = corrAt(half);
    if (cHalf <= AUTOCORR_ALTERNATING_NEG_RATIO * maxCorr) bestLag = half;
  }

  // Step 2: integer divisors
  const step2Acc = maxCorr * step2Accept;
  for (let d = 2; d <= bestLag; d++) {
    if (bestLag % d !== 0) continue;
    const candidate = Math.floor(bestLag / d);
    if (candidate < minLag) break;
    if (corrAt(candidate) >= step2Acc && isStrongLocalPeak(candidate)) {
      bestLag = candidate;
    }
  }

  // Step 3: near-divisor candidates with tighter threshold
  const step3Acc = maxCorr * step3Accept;
  for (let k = 2; k <= 5; k++) {
    const cand = Math.floor(bestLag / k);
    if (cand < minLag) break;
    for (const cOff of [-2, -1, 0, 1, 2]) {
      const c = Math.max(minLag, cand + cOff);
      if (c >= hi) continue;
      if (corrAt(c) >= step3Acc && isStrongLocalPeak(c) && c < bestLag) {
        bestLag = c;
      }
    }
  }

  const c0 = corrAt(bestLag);
  if (bestLag <= minLag || bestLag >= hi) return [bestLag, c0];

  // Parabolic refinement to sub-pixel lag
  const cm1 = corrAt(bestLag - 1);
  const cp1 = corrAt(bestLag + 1);
  const denom = cm1 - 2 * c0 + cp1;
  const lagF = Math.abs(denom) < 1e-9
    ? bestLag
    : bestLag + 0.5 * (cm1 - cp1) / denom;
  return [lagF, c0];
}

// ─── 3. Snap detected period back to actual grid-line phase ────────

function snapToGridLines(signal: number[], hintStart: number, hintEnd: number, period: number): [number, number] {
  if (hintEnd <= hintStart || period < 2) return [hintStart, hintEnd];
  const len = signal.length;
  const periodInt = Math.max(2, Math.round(period));
  const s = hintStart;
  const e = Math.min(hintEnd, len);
  if (e <= s) return [hintStart, hintEnd];

  // p90 of in-hint signal → line_thresh
  const slice: number[] = [];
  for (let i = s; i < e; i++) slice.push(signal[i]);
  slice.sort((a, b) => a - b);
  const pIdx = Math.min(slice.length - 1, Math.floor(slice.length * SNAP_LINE_THRESH_PERCENTILE));
  const p90 = slice[pIdx];
  const lineThresh = p90 * SNAP_LINE_THRESH_FRAC;

  const win = SNAP_LINE_WINDOW;
  function lineDensity(pos: number): number {
    const lo = Math.max(0, pos - win);
    const hi = Math.min(len, pos + win + 1);
    if (hi <= lo) return 0;
    let m = -Infinity;
    for (let i = lo; i < hi; i++) if (signal[i] > m) m = signal[i];
    return m;
  }

  // Find best phase
  let bestPhase = 0;
  let bestScore = 0;
  for (let phase = 0; phase < periodInt; phase++) {
    let score = 0;
    for (let k = 0; ; k++) {
      const pos = Math.round(phase + k * period);
      if (pos >= len) break;
      if (pos >= s && pos < e && lineDensity(pos) >= lineThresh) score++;
    }
    if (score > bestScore) { bestScore = score; bestPhase = phase; }
  }

  // Find seed line within bbox
  let seed: number | null = null;
  for (let k = 0; ; k++) {
    const pos = Math.round(bestPhase + k * period);
    if (pos >= len) break;
    if (pos >= s && pos < e && lineDensity(pos) >= lineThresh) { seed = pos; break; }
  }
  if (seed === null) return [hintStart, hintEnd];

  // Walk left
  let firstLine = seed;
  for (let k = 1; ; k++) {
    const candidate = Math.round(seed - k * period);
    if (candidate < -win) break;
    const lo = Math.max(0, candidate - win);
    const hi = Math.min(len, candidate + win + 1);
    if (hi <= lo) break;
    let localMax = -Infinity;
    for (let i = lo; i < hi; i++) if (signal[i] > localMax) localMax = signal[i];
    if (localMax < lineThresh) break;
    firstLine = Math.max(0, candidate);
  }

  // Walk right (allow candidate up to len + win)
  let lastLine = seed;
  for (let k = 1; ; k++) {
    const candidate = Math.round(seed + k * period);
    if (candidate > len + win) break;
    const lo = Math.max(0, candidate - win);
    const hi = Math.min(len, candidate + win + 1);
    if (hi <= lo) break;
    let localMax = -Infinity;
    for (let i = lo; i < hi; i++) if (signal[i] > localMax) localMax = signal[i];
    if (localMax < lineThresh) break;
    lastLine = Math.min(len - 1, candidate);
  }

  if (lastLine > firstLine) return [firstLine, lastLine];
  return [hintStart, hintEnd];
}

// ─── 4. Geometry recovery (bbox → grid dims + cell size + origin) ──

async function recoverGridGeometry(
  img: LoadedImage,
  bbox: BBox,
  config: SamplingConfig,
  opts?: ImportTsOpts,
): Promise<{ width: number; height: number; csX: number; csY: number; originX: number; originY: number } | null> {
  const { data, width: imgW, height: imgH } = img;
  const bboxW = bbox.right - bbox.left;
  const bboxH = bbox.bottom - bbox.top;
  if (bboxW < 20 || bboxH < 20) return null;

  // Per-axis signals (full image, but pixel sum is over bbox cross-axis)
  opts?.onProgress?.("提取列信号", 0);
  const colSig = new Array<number>(imgW);
  for (let x = 0; x < imgW; x++) {
    if (x % 64 === 0) {
      checkSignal(opts?.signal);
      opts?.onProgress?.("提取列信号", x / imgW);
      await yieldToUi();
    }
    let dark = 0;
    for (let y = bbox.top; y < bbox.bottom; y++) {
      if (pixelLuminance(data, x, y, imgW) < config.gridLumThreshold) dark++;
    }
    colSig[x] = dark;
  }

  opts?.onProgress?.("提取行信号", 0);
  const rowSig = new Array<number>(imgH);
  for (let y = 0; y < imgH; y++) {
    if (y % 64 === 0) {
      checkSignal(opts?.signal);
      opts?.onProgress?.("提取行信号", y / imgH);
      await yieldToUi();
    }
    let dark = 0;
    for (let x = bbox.left; x < bbox.right; x++) {
      if (pixelLuminance(data, x, y, imgW) < config.gridLumThreshold) dark++;
    }
    rowSig[y] = dark;
  }

  const colSlice = colSig.slice(bbox.left, bbox.right);
  const rowSlice = rowSig.slice(bbox.top, bbox.bottom);
  const maxLagX = Math.max(6, Math.min(AUTOCORR_MAX_LAG, Math.floor(bboxW / 4)));
  const maxLagY = Math.max(6, Math.min(AUTOCORR_MAX_LAG, Math.floor(bboxH / 4)));

  opts?.onProgress?.("X 轴周期检测", 0);
  await yieldToUi();
  checkSignal(opts?.signal);
  const peakX = autocorrPeak(colSlice, AUTOCORR_MIN_LAG, maxLagX, config.autocorrStep2Accept, config.autocorrStep3Accept);

  opts?.onProgress?.("Y 轴周期检测", 0);
  await yieldToUi();
  checkSignal(opts?.signal);
  const peakY = autocorrPeak(rowSlice, AUTOCORR_MIN_LAG, maxLagY, config.autocorrStep2Accept, config.autocorrStep3Accept);
  if (!peakX || !peakY) return null;

  let [lagX] = peakX;
  let [lagY] = peakY;

  // Cross-axis sanity
  const ratio = Math.max(lagX / lagY, lagY / lagX);
  if (ratio > CROSS_AXIS_DISAGREE_FACTOR) {
    const l = Math.max(lagX, lagY);
    lagX = l; lagY = l;
  }

  const [newLeft, newRight] = snapToGridLines(colSig, bbox.left, bbox.right, lagX);
  const [newTop, newBottom] = snapToGridLines(rowSig, bbox.top, bbox.bottom, lagY);

  const spanX = newRight - newLeft;
  const spanY = newBottom - newTop;
  const cellsW = Math.round(spanX / lagX);
  const cellsH = Math.round(spanY / lagY);
  if (cellsW === 0 || cellsH === 0) return null;

  const csX = spanX / cellsW;
  const csY = spanY / cellsH;
  return { width: cellsW, height: cellsH, csX, csY, originX: newLeft, originY: newTop };
}

// ─── 5. Color matching (CIELAB ΔE76) ───────────────────────────────

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  function linearize(c: number): number {
    const cn = c / 255;
    return cn > 0.04045 ? Math.pow((cn + 0.055) / 1.055, 2.4) : cn / 12.92;
  }
  const rl = linearize(r), gl = linearize(g), bl = linearize(b);
  const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750;
  const z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041;
  function f(t: number): number {
    return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  }
  const fx = f(x / 0.95047), fy = f(y / 1.0), fz = f(z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE76(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const [l1, a1, bb1] = rgbToLab(r1, g1, b1);
  const [l2, a2, bb2] = rgbToLab(r2, g2, b2);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (bb1 - bb2) ** 2);
}

function matchColor(r: number, g: number, b: number, palette: PaletteColor[]): [string, number] {
  for (const pc of palette) {
    if (pc.r === r && pc.g === g && pc.b === b) return [pc.code, 1.0];
  }
  let bestCode = "";
  let bestDist = Infinity;
  for (const pc of palette) {
    const d = deltaE76(r, g, b, pc.r, pc.g, pc.b);
    if (d < bestDist) { bestDist = d; bestCode = pc.code; }
  }
  return [bestCode, Math.max(0, 1 - bestDist / 100)];
}

// ─── 6. Cell sampling ──────────────────────────────────────────────

function sampleCellColor(
  img: LoadedImage,
  x0: number,
  y0: number,
  cellSize: number,
  config: SamplingConfig,
): [number, number, number] | null {
  const { data, width: imgW, height: imgH } = img;
  const inset = Math.max(2, Math.floor(cellSize * config.insetRatio));

  const offsets: Array<[number, number]> = [
    [inset, inset], [cellSize - inset, inset],
    [inset, cellSize - inset], [cellSize - inset, cellSize - inset],
    [Math.floor(cellSize / 2), inset], [Math.floor(cellSize / 2), cellSize - inset],
    [inset, Math.floor(cellSize / 2)], [cellSize - inset, Math.floor(cellSize / 2)],
  ];

  if (config.extraSamples > 0) {
    const inner = cellSize - 2 * inset;
    if (inner > 4) {
      const step = Math.floor(inner / (Math.ceil(Math.sqrt(config.extraSamples)) + 1));
      if (step > 0) {
        for (let dx = inset + step; dx < cellSize - inset; dx += step) {
          for (let dy = inset + step; dy < cellSize - inset; dy += step) {
            offsets.push([dx, dy]);
          }
        }
      }
    }
  }

  const samples: Array<[number, number, number]> = [];
  for (const [dx, dy] of offsets) {
    const sx = x0 + dx, sy = y0 + dy;
    if (sx < imgW && sy < imgH) {
      samples.push(getPixelRGB(data, sx, sy, imgW));
    }
  }
  if (samples.length === 0) return null;

  const filtered = samples.filter(([r, g, b]) => {
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const isText = lum < 15 && r < 20 && g < 20 && b < 20;
    const isWhite = lum > 245;
    return !isText && !isWhite;
  });
  const finalSamples = filtered.length >= 2 ? filtered : samples;
  const rs = finalSamples.map((s) => s[0]).sort((a, b) => a - b);
  const gs = finalSamples.map((s) => s[1]).sort((a, b) => a - b);
  const bs = finalSamples.map((s) => s[2]).sort((a, b) => a - b);
  return [rs[Math.floor(rs.length / 2)], gs[Math.floor(gs.length / 2)], bs[Math.floor(bs.length / 2)]];
}

// ─── 7. Text detection (for white-vs-empty disambiguation) ─────────

function binarize(gray: Uint8Array): Uint8Array {
  if (gray.length === 0) return new Uint8Array(0);
  const hist = new Uint32Array(256);
  for (const v of gray) hist[v]++;
  const total = gray.length;
  let sumTotal = 0;
  for (let i = 0; i < 256; i++) sumTotal += i * hist[i];
  let sumBg = 0;
  let weightBg = 0;
  let bestThresh = 128;
  let bestVariance = 0;
  for (let t = 0; t < 256; t++) {
    weightBg += hist[t];
    if (weightBg === 0) continue;
    const weightFg = total - weightBg;
    if (weightFg === 0) break;
    sumBg += t * hist[t];
    const meanBg = sumBg / weightBg;
    const meanFg = (sumTotal - sumBg) / weightFg;
    const variance = weightBg * weightFg * (meanBg - meanFg) ** 2;
    if (variance > bestVariance) { bestVariance = variance; bestThresh = t; }
  }
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = gray[i] <= bestThresh ? 0 : 255;
  return out;
}

function extractCellBinary(img: LoadedImage, x0: number, y0: number, cellSize: number): Uint8Array {
  const { data, width: imgW, height: imgH } = img;
  const gray = new Uint8Array(cellSize * cellSize);
  let idx = 0;
  for (let dy = 0; dy < cellSize; dy++) {
    for (let dx = 0; dx < cellSize; dx++) {
      const px = x0 + dx, py = y0 + dy;
      if (px < imgW && py < imgH) {
        const i = (py * imgW + px) * 4;
        gray[idx] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      } else {
        gray[idx] = 255;
      }
      idx++;
    }
  }
  const binary = binarize(gray);

  const w = cellSize;
  const edgeInset = Math.floor(w / 5);
  let edgeSum = 0, edgeCount = 0;
  for (let i = 0; i < binary.length; i++) {
    const row = Math.floor(i / w);
    const col = i % w;
    if (row < edgeInset || row >= w - edgeInset || col < edgeInset || col >= w - edgeInset) {
      edgeSum += binary[i];
      edgeCount++;
    }
  }
  if (edgeCount > 0 && edgeSum / edgeCount < 128) {
    for (let i = 0; i < binary.length; i++) binary[i] = 255 - binary[i];
  }
  return binary;
}

function cellHasText(cellBin: Uint8Array, cellSize: number): boolean {
  const w = cellSize;
  if (cellBin.length === 0) return false;
  let textPixels = 0, regionPixels = 0;
  for (let i = 0; i < cellBin.length; i++) {
    const row = Math.floor(i / w);
    const col = i % w;
    if (row > w / 4 && row < (w * 3) / 4 && col > w / 6 && col < (w * 5) / 6) {
      regionPixels++;
      if (cellBin[i] === 0) textPixels++;
    }
  }
  if (regionPixels === 0) return false;
  const ratio = textPixels / regionPixels;
  return ratio > 0.03 && ratio < 0.50;
}

// ─── Public API ─────────────────────────────────────────────────────

export async function detectBlueprintDimsTS(
  path: string,
  adapter: ReadFileAdapter,
  bbox: BBox | undefined,
  opts?: ImportTsOpts,
): Promise<DetectTsResult> {
  opts?.onProgress?.("加载图像", 0);
  const img = await loadImageData(path, adapter);
  opts?.onProgress?.("加载图像", 1);
  checkSignal(opts?.signal);

  // Fast path: PNG metadata
  if (!bbox && img.mediaType === "image/png") {
    const meta = readBlueprintMetadata(img.rawBytes);
    if (meta) {
      return {
        width: meta.gridWidth,
        height: meta.gridHeight,
        cellSize: meta.cellSize,
        bbox: {
          left: meta.originX,
          top: meta.originY,
          right: meta.originX + meta.gridWidth * meta.cellSize,
          bottom: meta.originY + meta.gridHeight * meta.cellSize,
        },
        hasMetadata: true,
      };
    }
  }

  const config = configForMediaType(img.mediaType);
  const actualBbox = bbox ?? (await detectGridBBox(img, config.gridLumThreshold, opts));
  if (!actualBbox) {
    throw new Error("Could not locate a grid region. Is this a blueprint image?");
  }
  // Clamp user-supplied bbox to image bounds
  const clamped: BBox = {
    left: Math.max(0, Math.min(actualBbox.left, img.width - 1)),
    top: Math.max(0, Math.min(actualBbox.top, img.height - 1)),
    right: Math.max(actualBbox.left + 1, Math.min(actualBbox.right, img.width)),
    bottom: Math.max(actualBbox.top + 1, Math.min(actualBbox.bottom, img.height)),
  };

  const recovered = await recoverGridGeometry(img, clamped, config, opts);
  if (!recovered) {
    throw new Error("Could not recover grid geometry from detected region");
  }

  return {
    width: recovered.width,
    height: recovered.height,
    cellSize: Math.round(recovered.csX),
    bbox: clamped,
    hasMetadata: false,
  };
}

export async function importBlueprintTS(
  args: ImportTsArgs,
  adapter: ReadFileAdapter,
  opts?: ImportTsOpts,
): Promise<BlueprintImportResult> {
  opts?.onProgress?.("加载图像", 0);
  const img = await loadImageData(args.path, adapter);
  opts?.onProgress?.("加载图像", 1);
  checkSignal(opts?.signal);

  const userBbox = args.bbox;

  // Fast path: PNG metadata (only when neither bbox nor explicit dims provided)
  if (!userBbox && !args.gridWidth && !args.gridHeight && img.mediaType === "image/png") {
    const meta = readBlueprintMetadata(img.rawBytes);
    if (meta) {
      return await runSamplingPass(
        img,
        meta.gridWidth,
        meta.gridHeight,
        meta.cellSize,
        meta.cellSize,
        meta.originX,
        meta.originY,
        args.palette,
        configForMediaType("image/png"),
        1.0,
        args.mode ?? "color_priority",
        0,
        0,
        opts,
      );
    }
  }

  const config = configForMediaType(img.mediaType);
  const actualBbox = userBbox ?? (await detectGridBBox(img, config.gridLumThreshold, opts));
  if (!actualBbox) {
    throw new Error("Could not locate a grid region. Is this a blueprint image?");
  }
  const clamped: BBox = {
    left: Math.max(0, Math.min(actualBbox.left, img.width - 1)),
    top: Math.max(0, Math.min(actualBbox.top, img.height - 1)),
    right: Math.max(actualBbox.left + 1, Math.min(actualBbox.right, img.width)),
    bottom: Math.max(actualBbox.top + 1, Math.min(actualBbox.bottom, img.height)),
  };

  const recovered = await recoverGridGeometry(img, clamped, config, opts);
  if (!recovered) {
    throw new Error("Could not recover grid geometry from detected region");
  }

  const gridW = args.gridWidth ?? recovered.width;
  const gridH = args.gridHeight ?? recovered.height;
  if (gridW === 0 || gridH === 0) {
    throw new Error("Detected grid is too small");
  }

  // When user-supplied dims exceed what detection found, the missing cells
  // were likely truncated on one or both sides of the detected bbox (faint
  // outer grid lines, blue-tinted background bleed, etc.). Split the
  // surplus evenly around the detected origin via signed col/row offsets
  // in the sampling pass — cells that fall outside the image become
  // empty/transparent, matching the user's expectation for "I know this
  // is 39×53, detect only saw 34×51, fill the missing edges."
  const extraW = Math.max(0, gridW - recovered.width);
  const extraH = Math.max(0, gridH - recovered.height);
  const padLeft = Math.floor(extraW / 2);
  const padTop = Math.floor(extraH / 2);

  return await runSamplingPass(
    img,
    gridW,
    gridH,
    recovered.csX,
    recovered.csY,
    recovered.originX,
    recovered.originY,
    args.palette,
    config,
    /*fastPathConfidence*/ 0,
    args.mode ?? "color_priority",
    padLeft,
    padTop,
    opts,
  );
}

// ─── Sampling pass — shared between fast path + detect path ────────

async function runSamplingPass(
  img: LoadedImage,
  gridW: number,
  gridH: number,
  csX: number,
  csY: number,
  originX: number,
  originY: number,
  palette: PaletteColor[],
  config: SamplingConfig,
  fastPathConfidence: number, // 1.0 for metadata, ignored for detect
  mode: ImportMode,
  // Number of extra cells inserted before the detected origin on each axis
  // (when user-supplied dims exceed what detection found). Zero for fast
  // path and detected==user-dim cases — behaves identically to before.
  padLeft: number,
  padTop: number,
  opts?: ImportTsOpts,
): Promise<BlueprintImportResult> {
  const sampleCs = Math.max(2, Math.round(Math.min(csX, csY)));
  const { width: imgW, height: imgH } = img;

  // Color sampling
  opts?.onProgress?.("采样颜色", 0);
  const colorCodes: string[][] = [];
  const colorConfs: number[][] = [];
  let totalConf = 0;
  let confCount = 0;
  for (let row = 0; row < gridH; row++) {
    if (row % 8 === 0) {
      checkSignal(opts?.signal);
      opts?.onProgress?.(`采样颜色 ${row}/${gridH}`, row / gridH);
      await yieldToUi();
    }
    const codeRow: string[] = [];
    const confRow: number[] = [];
    for (let col = 0; col < gridW; col++) {
      const colSigned = col - padLeft;
      const rowSigned = row - padTop;
      const origin = cellOriginSigned(originX, originY, csX, csY, colSigned, rowSigned, imgW, imgH);
      const sample = origin
        ? sampleCellColor(img, origin[0], origin[1], sampleCs, config)
        : null;
      if (sample) {
        const [code, conf] = matchColor(sample[0], sample[1], sample[2], palette);
        codeRow.push(code);
        confRow.push(conf);
        totalConf += conf;
        confCount++;
      } else {
        codeRow.push("");
        confRow.push(1.0);
      }
    }
    colorCodes.push(codeRow);
    colorConfs.push(confRow);
  }
  const avgConfidence = confCount > 0 ? totalConf / confCount : 1.0;

  // Text detection per cell (for white-vs-empty disambiguation). Uses the
  // same signed-offset scheme so padded cells line up with the color pass
  // — and cells that fall off the image always report has_text=false.
  opts?.onProgress?.("识别空白格", 0);
  const hasTextGrid: boolean[][] = [];
  for (let row = 0; row < gridH; row++) {
    if (row % 8 === 0) {
      checkSignal(opts?.signal);
      opts?.onProgress?.(`识别空白格 ${row}/${gridH}`, row / gridH);
      await yieldToUi();
    }
    const r: boolean[] = [];
    for (let col = 0; col < gridW; col++) {
      const colSigned = col - padLeft;
      const rowSigned = row - padTop;
      const origin = cellOriginSigned(originX, originY, csX, csY, colSigned, rowSigned, imgW, imgH);
      if (origin) {
        const bin = extractCellBinary(img, origin[0], origin[1], sampleCs);
        r.push(cellHasText(bin, sampleCs));
      } else {
        r.push(false);
      }
    }
    hasTextGrid.push(r);
  }

  // Build result
  const cells: CellResult[][] = [];
  const colorCellsOut: string[][] = [];
  const textCellsOut: string[][] = [];
  for (let row = 0; row < gridH; row++) {
    const cellRow: CellResult[] = [];
    const colorRow: string[] = [];
    const textRow: string[] = [];
    for (let col = 0; col < gridW; col++) {
      const cc = colorCodes[row][col];
      const ccConf = colorConfs[row][col];
      const hasText = hasTextGrid[row][col];
      const matched = palette.find((p) => p.code === cc);
      const isWhiteColor = matched ? matched.r > 248 && matched.g > 248 && matched.b > 248 : cc === "";
      const isEmpty = cc === "" || (isWhiteColor && !hasText);
      if (isEmpty) {
        cellRow.push({
          color_code: "",
          color_confidence: 1.0,
          text_code: "",
          text_confidence: 0,
          final_code: "",
          source: "color",
        });
        colorRow.push("");
        textRow.push("");
      } else {
        cellRow.push({
          color_code: cc,
          color_confidence: ccConf,
          text_code: "",
          text_confidence: 0,
          final_code: cc,
          source: "color",
        });
        colorRow.push(cc);
        textRow.push("");
      }
    }
    cells.push(cellRow);
    colorCellsOut.push(colorRow);
    textCellsOut.push(textRow);
  }

  return {
    width: gridW,
    height: gridH,
    cells,
    color_cells: colorCellsOut,
    text_cells: textCellsOut,
    mismatch_count: 0,
    mismatches: [],
    severity_summary: { high: 0, medium: 0, low: 0 },
    cell_size_detected: Math.round(csX),
    confidence: fastPathConfidence > 0 ? fastPathConfidence : avgConfidence,
    mode,
  };
}

// Type-only re-exports to silence the "unused import" check on CellResult / CellSource.
export type { CellResult, CellSource };

// BBOX_MIN_AXIS_COVERAGE is defined for documentation but the sanity check uses
// inline arithmetic (× 10 < × 3) rather than the constant. Suppress unused warning.
void BBOX_MIN_AXIS_COVERAGE;
