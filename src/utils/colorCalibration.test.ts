import { describe, it, expect } from "vitest";
import {
  IDENTITY_COEFFICIENTS,
  computeCoefficients,
  applyCalibration,
  sampleRegionMean,
  type CalibrationCoefficients,
} from "./colorCalibration";

const RGB = (r: number, g: number, b: number) => [r, g, b] as [number, number, number];

describe("IDENTITY_COEFFICIENTS", () => {
  it("is a=1 b=0 per channel", () => {
    expect(IDENTITY_COEFFICIENTS.a).toEqual([1, 1, 1]);
    expect(IDENTITY_COEFFICIENTS.b).toEqual([0, 0, 0]);
  });
});

describe("computeCoefficients — empty input", () => {
  it("returns identity when pairs is empty", () => {
    const c = computeCoefficients([]);
    expect(c.a).toEqual([1, 1, 1]);
    expect(c.b).toEqual([0, 0, 0]);
  });
});

describe("computeCoefficients — N=1", () => {
  it("computes a = target / sample, b = 0", () => {
    const c = computeCoefficients([
      { sample: RGB(200, 200, 200), target: RGB(220, 200, 180) },
    ]);
    expect(c.a[0]).toBeCloseTo(220 / 200);
    expect(c.a[1]).toBeCloseTo(200 / 200);
    expect(c.a[2]).toBeCloseTo(180 / 200);
    expect(c.b).toEqual([0, 0, 0]);
  });

  it("guards against sample=0 (per channel)", () => {
    const c = computeCoefficients([
      { sample: RGB(0, 100, 0), target: RGB(50, 100, 50) },
    ]);
    expect(c.a[0]).toBe(1);
    expect(c.b[0]).toBe(0);
    expect(c.a[1]).toBeCloseTo(1);
    expect(c.a[2]).toBe(1);
    expect(c.b[2]).toBe(0);
  });
});

describe("computeCoefficients — N=2+ least squares", () => {
  it("computes a = Σ(s·t) / Σ(s²)", () => {
    // sample = [100, 150], target = [110, 165]
    // Σ(s·t) = 100*110 + 150*165 = 35750
    // Σ(s²)  = 10000 + 22500 = 32500
    // a = 35750 / 32500 ≈ 1.1
    const c = computeCoefficients([
      { sample: RGB(100, 100, 100), target: RGB(110, 110, 110) },
      { sample: RGB(150, 150, 150), target: RGB(165, 165, 165) },
    ]);
    expect(c.a[0]).toBeCloseTo(1.1);
    expect(c.a[1]).toBeCloseTo(1.1);
    expect(c.a[2]).toBeCloseTo(1.1);
    expect(c.b).toEqual([0, 0, 0]);
  });

  it("falls back to identity when Σ(s²)=0", () => {
    const c = computeCoefficients([
      { sample: RGB(0, 100, 0), target: RGB(10, 110, 10) },
      { sample: RGB(0, 200, 0), target: RGB(20, 220, 20) },
    ]);
    expect(c.a[0]).toBe(1);
    expect(c.a[2]).toBe(1);
    expect(c.a[1]).toBeGreaterThan(1);
  });
});

describe("applyCalibration", () => {
  it("identity returns equivalent pixel values", () => {
    const pixels = [100, 150, 200, 50, 75, 100];
    const out = applyCalibration(pixels, IDENTITY_COEFFICIENTS);
    expect(out).toEqual(pixels);
  });

  it("applies per-channel a*in + b and clamps", () => {
    const pixels = [100, 150, 200];
    const coef: CalibrationCoefficients = { a: [1.5, 1, 0.5], b: [0, 50, 100] };
    const out = applyCalibration(pixels, coef);
    expect(out).toEqual([150, 200, 200]);
  });

  it("clamps to [0, 255]", () => {
    const pixels = [10, 200, 100];
    const coef: CalibrationCoefficients = { a: [10, 2, -1], b: [0, 0, 0] };
    const out = applyCalibration(pixels, coef);
    expect(out).toEqual([100, 255, 0]);
  });

  it("returns a new array, doesn't mutate input", () => {
    const pixels = [100, 100, 100];
    const out = applyCalibration(pixels, IDENTITY_COEFFICIENTS);
    expect(out).not.toBe(pixels);
    out[0] = 0;
    expect(pixels[0]).toBe(100);
  });
});

describe("sampleRegionMean", () => {
  const img3x2 = [
    10, 20, 30, 40, 50, 60, 70, 80, 90,
    100, 110, 120, 130, 140, 150, 160, 170, 180,
  ];

  it("single-pixel region", () => {
    const m = sampleRegionMean(img3x2, 3, { x: 1, y: 0, w: 1, h: 1 });
    expect(m).toEqual([40, 50, 60]);
  });

  it("multi-pixel region mean", () => {
    const m = sampleRegionMean(img3x2, 3, { x: 0, y: 0, w: 2, h: 1 });
    expect(m[0]).toBeCloseTo(25);
    expect(m[1]).toBeCloseTo(35);
    expect(m[2]).toBeCloseTo(45);
  });

  it("clamps region to image bounds", () => {
    const m = sampleRegionMean(img3x2, 3, { x: 1, y: 1, w: 5, h: 5 });
    expect(m[0]).toBeCloseTo(145);
    expect(m[1]).toBeCloseTo(155);
    expect(m[2]).toBeCloseTo(165);
  });

  it("returns zeros for empty region (0 area)", () => {
    const m = sampleRegionMean(img3x2, 3, { x: 0, y: 0, w: 0, h: 0 });
    expect(m).toEqual([0, 0, 0]);
  });
});
