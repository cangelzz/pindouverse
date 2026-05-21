/**
 * Color calibration for image import.
 *
 * Solves a per-channel multiplicative scale `out = a*in` from N reference
 * (sample, target) RGB pairs, then applies it to a pixel array. The dialog
 * runs this on raw RGB pixels before MARD quantization to correct color cast.
 */

export interface CalibrationPoint {
  id: string;
  region: { x: number; y: number; w: number; h: number };
  sampledRgb: [number, number, number];
  targetColorIndex: number;
}

export interface CalibrationSettings {
  enabled: boolean;
  points: CalibrationPoint[];
}

export interface CalibrationCoefficients {
  a: [number, number, number];
  b: [number, number, number];
}

export const IDENTITY_COEFFICIENTS: CalibrationCoefficients = {
  a: [1, 1, 1],
  b: [0, 0, 0],
};

export const DEFAULT_CALIBRATION_SETTINGS: CalibrationSettings = {
  enabled: false,
  points: [],
};

interface SampleTargetPair {
  sample: [number, number, number];
  target: [number, number, number];
}

function sanitize(coef: CalibrationCoefficients): CalibrationCoefficients {
  const a: [number, number, number] = [1, 1, 1];
  const b: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const ac = coef.a[c];
    const bc = coef.b[c];
    if (Number.isFinite(ac) && Number.isFinite(bc)) {
      a[c] = ac;
      b[c] = bc;
    }
  }
  return { a, b };
}

export function computeCoefficients(
  pairs: SampleTargetPair[],
): CalibrationCoefficients {
  if (pairs.length === 0) return IDENTITY_COEFFICIENTS;

  if (pairs.length === 1) {
    const { sample, target } = pairs[0];
    const a: [number, number, number] = [1, 1, 1];
    for (let c = 0; c < 3; c++) {
      a[c] = sample[c] === 0 ? 1 : target[c] / sample[c];
    }
    return sanitize({ a, b: [0, 0, 0] });
  }

  // N >= 2: least-squares per channel for a (b stays 0).
  const a: [number, number, number] = [1, 1, 1];
  const b: [number, number, number] = [0, 0, 0];
  const n = pairs.length;

  for (let c = 0; c < 3; c++) {
    let st = 0;
    let ss = 0;
    for (let i = 0; i < n; i++) {
      st += pairs[i].sample[c] * pairs[i].target[c];
      ss += pairs[i].sample[c] * pairs[i].sample[c];
    }
    a[c] = ss === 0 ? 1 : st / ss;
  }

  return sanitize({ a, b });
}

export function applyCalibration(
  pixels: Uint8Array | number[],
  coef: CalibrationCoefficients,
): number[] {
  const out: number[] = new Array(pixels.length);
  for (let i = 0; i < pixels.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const v = coef.a[c] * pixels[i + c] + coef.b[c];
      out[i + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return out;
}

export function sampleRegionMean(
  pixels: Uint8Array | number[],
  imageWidth: number,
  region: { x: number; y: number; w: number; h: number },
): [number, number, number] {
  // Clamp region to image bounds. Image height inferred from pixels length.
  const imageHeight = pixels.length / 3 / imageWidth;
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(imageWidth, Math.floor(region.x + region.w));
  const y1 = Math.min(imageHeight, Math.floor(region.y + region.h));

  if (x1 <= x0 || y1 <= y0) return [0, 0, 0];

  let sumR = 0, sumG = 0, sumB = 0, count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * imageWidth + x) * 3;
      sumR += pixels[i];
      sumG += pixels[i + 1];
      sumB += pixels[i + 2];
      count++;
    }
  }
  return [sumR / count, sumG / count, sumB / count];
}
