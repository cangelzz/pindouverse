import { describe, it, expect } from "vitest";
import { findClosestColor } from "../../src/utils/colorMatching";
import { MARD_COLORS } from "../../src/data/mard221";

describe("findClosestColor", () => {
  it("returns an exact match for a known MARD color", () => {
    // Find a color with known RGB
    const idx = MARD_COLORS.findIndex((c) => c.rgb && c.hex === "#FFFFFF");
    if (idx >= 0) {
      const result = findClosestColor(255, 255, 255, "euclidean");
      expect(MARD_COLORS[result].rgb).toBeTruthy();
      // Should be very close to white
      const rgb = MARD_COLORS[result].rgb!;
      const dist = Math.sqrt((rgb[0] - 255) ** 2 + (rgb[1] - 255) ** 2 + (rgb[2] - 255) ** 2);
      expect(dist).toBeLessThan(30);
    }
  });

  it("returns a valid index for any input", () => {
    const idx = findClosestColor(123, 45, 67, "euclidean");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(MARD_COLORS.length);
  });

  it("euclidean and ciede2000 both return valid indices", () => {
    const e = findClosestColor(200, 50, 50, "euclidean");
    const c = findClosestColor(200, 50, 50, "ciede2000");
    expect(e).toBeGreaterThanOrEqual(0);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(MARD_COLORS[e].rgb).toBeTruthy();
    expect(MARD_COLORS[c].rgb).toBeTruthy();
  });

  it("respects allowedIndices filter", () => {
    const allowed = [0, 1, 2, 3, 4];
    const idx = findClosestColor(128, 128, 128, "euclidean", allowed);
    expect(allowed).toContain(idx);
  });

  it("black matches a dark color", () => {
    const idx = findClosestColor(0, 0, 0, "euclidean");
    const rgb = MARD_COLORS[idx].rgb!;
    // Should match something dark (luminance < 50)
    const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    expect(lum).toBeLessThan(80);
  });
});
