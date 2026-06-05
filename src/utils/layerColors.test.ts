import { describe, it, expect } from "vitest";
import { layerAccentColor, LAYER_PALETTE, DEFAULT_LAYER_COLOR } from "./layerColors";

describe("layerAccentColor", () => {
  it("returns the default color for index 0 (the first/default layer)", () => {
    expect(layerAccentColor(0)).toBe(DEFAULT_LAYER_COLOR);
  });

  it("returns the default color for negative indices (defensive)", () => {
    expect(layerAccentColor(-1)).toBe(DEFAULT_LAYER_COLOR);
  });

  it("returns palette[0] for index 1, palette[1] for index 2, ...", () => {
    expect(layerAccentColor(1)).toBe(LAYER_PALETTE[0]);
    expect(layerAccentColor(2)).toBe(LAYER_PALETTE[1]);
    expect(layerAccentColor(LAYER_PALETTE.length)).toBe(LAYER_PALETTE[LAYER_PALETTE.length - 1]);
  });

  it("cycles through the palette when index exceeds its length", () => {
    // index (paletteLen + 1) → palette[0]
    expect(layerAccentColor(LAYER_PALETTE.length + 1)).toBe(LAYER_PALETTE[0]);
    // index (2*paletteLen) → palette[paletteLen - 1]
    expect(layerAccentColor(2 * LAYER_PALETTE.length)).toBe(LAYER_PALETTE[LAYER_PALETTE.length - 1]);
  });

  it("palette colors are all distinct (no accidental duplicates)", () => {
    expect(new Set(LAYER_PALETTE).size).toBe(LAYER_PALETTE.length);
  });

  it("palette is non-empty so the modulo math can't divide by zero", () => {
    expect(LAYER_PALETTE.length).toBeGreaterThan(0);
  });
});
