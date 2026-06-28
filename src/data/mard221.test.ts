import { describe, it, expect } from "vitest";
import { MARD_COLORS, TRANSPARENT_BEAD_INDEX, isTransparentBead } from "./mard221";

describe("TRANSPARENT_BEAD_INDEX", () => {
  it("points at the H1 color", () => {
    expect(TRANSPARENT_BEAD_INDEX).toBeGreaterThanOrEqual(0);
    expect(MARD_COLORS[TRANSPARENT_BEAD_INDEX].code).toBe("H1");
  });
});

describe("isTransparentBead", () => {
  it("is true only for the H1 index", () => {
    expect(isTransparentBead(TRANSPARENT_BEAD_INDEX)).toBe(true);
  });
  it("is false for other colors (incl. H2 white)", () => {
    const h2 = MARD_COLORS.findIndex((c) => c.code === "H2");
    expect(isTransparentBead(h2)).toBe(false);
    expect(isTransparentBead(0)).toBe(false);
  });
  it("is false for null/undefined (empty cell)", () => {
    expect(isTransparentBead(null)).toBe(false);
    expect(isTransparentBead(undefined)).toBe(false);
  });
});
