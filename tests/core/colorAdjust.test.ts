import { describe, it, expect } from "vitest";
import { applyAdjustments, isIdentity, IDENTITY_ADJUSTMENTS, applyAdjustmentsToPixels, buildSelectionRemap } from "../../src/utils/colorAdjust";

describe("applyAdjustments", () => {
  it("identity returns the same channels", () => {
    expect(applyAdjustments([100, 150, 200], IDENTITY_ADJUSTMENTS)).toEqual([100, 150, 200]);
    expect(applyAdjustments([0, 0, 0], IDENTITY_ADJUSTMENTS)).toEqual([0, 0, 0]);
    expect(applyAdjustments([255, 255, 255], IDENTITY_ADJUSTMENTS)).toEqual([255, 255, 255]);
  });

  it("exposure up never decreases any channel", () => {
    const [r, g, b] = applyAdjustments([100, 100, 100], { ...IDENTITY_ADJUSTMENTS, exposure: 50 });
    expect(r).toBeGreaterThanOrEqual(100);
    expect(g).toBeGreaterThanOrEqual(100);
    expect(b).toBeGreaterThanOrEqual(100);
  });

  it("contrast up pushes darks down and lights up", () => {
    const dark = applyAdjustments([60, 60, 60], { ...IDENTITY_ADJUSTMENTS, contrast: 50 });
    const light = applyAdjustments([200, 200, 200], { ...IDENTITY_ADJUSTMENTS, contrast: 50 });
    expect(dark[0]).toBeLessThan(60);
    expect(light[0]).toBeGreaterThan(200);
  });

  it("saturation -100 yields grayscale (equal channels)", () => {
    const [r, g, b] = applyAdjustments([200, 100, 50], { ...IDENTITY_ADJUSTMENTS, saturation: -100 });
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it("temperature up raises red and lowers blue", () => {
    const [r, , b] = applyAdjustments([100, 100, 100], { ...IDENTITY_ADJUSTMENTS, temperature: 100 });
    expect(r).toBeGreaterThan(100);
    expect(b).toBeLessThan(100);
  });

  it("clamps extreme params to 0..255", () => {
    const out = applyAdjustments([10, 250, 130], { exposure: 100, contrast: 100, saturation: 100, vibrance: 100, temperature: 100, tint: 100 });
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("isIdentity true only when all zero", () => {
    expect(isIdentity(IDENTITY_ADJUSTMENTS)).toBe(true);
    expect(isIdentity({ ...IDENTITY_ADJUSTMENTS, tint: 1 })).toBe(false);
  });
});

describe("applyAdjustmentsToPixels", () => {
  it("identity leaves pixels unchanged", () => {
    const px = new Uint8Array([10, 20, 30, 200, 100, 50]);
    const out = applyAdjustmentsToPixels(px, IDENTITY_ADJUSTMENTS);
    expect(Array.from(out)).toEqual([10, 20, 30, 200, 100, 50]);
  });

  it("processes every pixel (length preserved, triple-aligned)", () => {
    const px = new Uint8Array([100, 100, 100, 100, 100, 100]);
    const out = applyAdjustmentsToPixels(px, { ...IDENTITY_ADJUSTMENTS, temperature: 100 });
    expect(out.length).toBe(6);
    expect(out[0]).toBeGreaterThan(100);
    expect(out[2]).toBeLessThan(100);
    expect(out[3]).toBe(out[0]);
  });
});

describe("buildSelectionRemap", () => {
  const overrides = new Map();

  it("identity maps every index to itself", () => {
    const map = buildSelectionRemap([0, 5, 42], IDENTITY_ADJUSTMENTS, undefined, "ciede2000", overrides);
    expect(map.get(0)).toBe(0);
    expect(map.get(5)).toBe(5);
    expect(map.get(42)).toBe(42);
  });

  it("empty selection yields empty map", () => {
    const map = buildSelectionRemap([], { ...IDENTITY_ADJUSTMENTS, exposure: 30 }, undefined, "ciede2000", overrides);
    expect(map.size).toBe(0);
  });

  it("restricted pool only ever maps into that pool", () => {
    const pool = [0, 1, 2];
    const map = buildSelectionRemap([40, 41, 42], { ...IDENTITY_ADJUSTMENTS, exposure: 80 }, pool, "ciede2000", overrides);
    for (const dst of map.values()) {
      expect(pool).toContain(dst);
    }
  });

  it("empty (but defined) pool keeps colors unchanged instead of snapping to 0", () => {
    const map = buildSelectionRemap([40, 41], { ...IDENTITY_ADJUSTMENTS, exposure: 80 }, [], "ciede2000", overrides);
    expect(map.get(40)).toBe(40);
    expect(map.get(41)).toBe(41);
  });
});
