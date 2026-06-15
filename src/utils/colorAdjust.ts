import { findClosestColor } from "./colorMatching";
import { getEffectiveColor, type ColorOverrideMap } from "./colorHelper";
import type { ColorMatchAlgorithm } from "../types";

/** Photo-style color adjustments. Each slider is -100..+100, 0 = no change. */
export interface ColorAdjustments {
  exposure: number;    // -100..+100 → maps to about ±2 stops
  contrast: number;    // -100..+100
  saturation: number;  // -100..+100
  vibrance: number;    // -100..+100 (boosts low-saturation pixels more)
  temperature: number; // -100..+100 (blue ↔ yellow; warm raises R, lowers B)
  tint: number;        // -100..+100 (green ↔ magenta)
}

export const IDENTITY_ADJUSTMENTS: ColorAdjustments = {
  exposure: 0,
  contrast: 0,
  saturation: 0,
  vibrance: 0,
  temperature: 0,
  tint: 0,
};

export function isIdentity(adj: ColorAdjustments): boolean {
  return (
    adj.exposure === 0 &&
    adj.contrast === 0 &&
    adj.saturation === 0 &&
    adj.vibrance === 0 &&
    adj.temperature === 0 &&
    adj.tint === 0
  );
}

const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Scale chroma around luma: s=0 → grayscale, s=1 → unchanged, s>1 → more saturated. */
function scaleSaturation(
  r: number, g: number, b: number, s: number,
): [number, number, number] {
  const luma = LUMA_R * r + LUMA_G * g + LUMA_B * b;
  return [luma + (r - luma) * s, luma + (g - luma) * s, luma + (b - luma) * s];
}

/**
 * Apply adjustments to a single RGB triple (0..255 in, 0..255 rounded int out).
 * Pipeline order (in 0..1 float): exposure → white balance → contrast → saturation → vibrance.
 * Returns the input unchanged when adj is identity.
 */
export function applyAdjustments(
  rgb: [number, number, number],
  adj: ColorAdjustments,
): [number, number, number] {
  let r = rgb[0] / 255;
  let g = rgb[1] / 255;
  let b = rgb[2] / 255;

  // 1. Exposure: out = in * 2^stops, stops in [-2, +2]
  if (adj.exposure !== 0) {
    const f = Math.pow(2, (adj.exposure / 100) * 2);
    r *= f;
    g *= f;
    b *= f;
  }

  // 2. White balance. Temperature warm(+) raises R, lowers B. Tint magenta(+) lowers G, raises R/B.
  if (adj.temperature !== 0) {
    const t = adj.temperature / 100; // -1..1
    r += t * 0.1;
    b -= t * 0.1;
  }
  if (adj.tint !== 0) {
    const ti = adj.tint / 100; // -1..1
    g -= ti * 0.1;
    r += ti * 0.05;
    b += ti * 0.05;
  }

  // 3. Contrast around mid-grey 0.5
  if (adj.contrast !== 0) {
    const k = 1 + adj.contrast / 100;
    r = (r - 0.5) * k + 0.5;
    g = (g - 0.5) * k + 0.5;
    b = (b - 0.5) * k + 0.5;
  }

  // 4. Saturation: lerp between luma and color
  if (adj.saturation !== 0) {
    const s = 1 + adj.saturation / 100; // 0 → grayscale, 2 → double
    [r, g, b] = scaleSaturation(r, g, b, s);
  }

  // 5. Vibrance: like saturation but weighted toward low-saturation pixels
  if (adj.vibrance !== 0) {
    const vb = adj.vibrance / 100;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const sat = mx <= 0 ? 0 : (mx - mn) / mx;
    const vs = 1 + vb * (1 - sat);
    [r, g, b] = scaleSaturation(r, g, b, vs);
  }

  return [
    Math.round(clamp01(r) * 255),
    Math.round(clamp01(g) * 255),
    Math.round(clamp01(b) * 255),
  ];
}

/**
 * Apply adjustments to a flat [r,g,b, r,g,b, ...] pixel array.
 * Returns a new Uint8Array; input is left untouched. Identity is a fast copy.
 * @param pixels flat RGB array; length is assumed to be a multiple of 3
 *   (any trailing 1–2 bytes are not processed and remain 0).
 */
export function applyAdjustmentsToPixels(
  pixels: Uint8Array | number[],
  adj: ColorAdjustments,
): Uint8Array {
  const out = new Uint8Array(pixels.length);
  if (isIdentity(adj)) {
    out.set(pixels as ArrayLike<number>);
    return out;
  }
  const cache = new Map<number, [number, number, number]>();
  // Step by RGB triples; callers pass 3-byte-aligned data.
  for (let i = 0; i + 2 < pixels.length; i += 3) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const key = (r << 16) | (g << 8) | b;
    let mapped = cache.get(key);
    if (!mapped) {
      mapped = applyAdjustments([r, g, b], adj);
      cache.set(key, mapped);
    }
    out[i] = mapped[0];
    out[i + 1] = mapped[1];
    out[i + 2] = mapped[2];
  }
  return out;
}

/**
 * Build a srcIndex → dstIndex remap for a selection: take each source color's
 * effective RGB, apply adjustments, then re-snap to the nearest color in the pool.
 * At most `srcIndices.length` (≤295) matches — independent of cell count.
 *
 * @param candidatePool indices to snap into; undefined = full palette.
 */
export function buildSelectionRemap(
  srcIndices: number[],
  adj: ColorAdjustments,
  candidatePool: number[] | undefined,
  algorithm: ColorMatchAlgorithm,
  overrides: ColorOverrideMap,
): Map<number, number> {
  const map = new Map<number, number>();
  // A defined-but-empty pool has nothing to snap into; keep colors unchanged
  // rather than letting findClosestColor silently fall back to index 0.
  const emptyPool = candidatePool !== undefined && candidatePool.length === 0;
  for (const src of srcIndices) {
    const rgb = getEffectiveColor(src, overrides).rgb;
    if (!rgb || emptyPool) {
      map.set(src, src);
      continue;
    }
    const [r, g, b] = applyAdjustments(rgb, adj);
    map.set(src, findClosestColor(r, g, b, algorithm, candidatePool, overrides));
  }
  return map;
}
