import { describe, it, expect } from "vitest";
import { rgbToLab, deltaE76, euclideanRGB } from "../../src/utils/colorConversion";

describe("rgbToLab", () => {
  it("converts white correctly", () => {
    const [L, a, b] = rgbToLab(255, 255, 255);
    expect(L).toBeCloseTo(100, 0);
    expect(a).toBeCloseTo(0, 0);
    expect(b).toBeCloseTo(0, 0);
  });

  it("converts black correctly", () => {
    const [L, a, b] = rgbToLab(0, 0, 0);
    expect(L).toBeCloseTo(0, 0);
    expect(a).toBeCloseTo(0, 0);
    expect(b).toBeCloseTo(0, 0);
  });

  it("converts red to positive a*", () => {
    const [L, a, b] = rgbToLab(255, 0, 0);
    expect(L).toBeGreaterThan(40);
    expect(a).toBeGreaterThan(50); // red has high positive a*
  });

  it("converts green to negative a*", () => {
    const [, a] = rgbToLab(0, 128, 0);
    expect(a).toBeLessThan(0); // green has negative a*
  });

  it("converts blue to negative b*", () => {
    const [, , b] = rgbToLab(0, 0, 255);
    expect(b).toBeLessThan(-50); // blue has high negative b*
  });
});

describe("deltaE76", () => {
  it("returns 0 for identical colors", () => {
    expect(deltaE76([50, 10, -20], [50, 10, -20])).toBe(0);
  });

  it("returns correct euclidean distance in Lab space", () => {
    const d = deltaE76([50, 0, 0], [50, 3, 4]);
    expect(d).toBeCloseTo(5, 5);
  });
});

describe("euclideanRGB", () => {
  it("returns 0 for identical colors", () => {
    expect(euclideanRGB([128, 64, 32], [128, 64, 32])).toBe(0);
  });

  it("computes correct distance", () => {
    const d = euclideanRGB([0, 0, 0], [255, 255, 255]);
    expect(d).toBeCloseTo(Math.sqrt(3 * 255 * 255), 5);
  });

  it("computes simple case", () => {
    const d = euclideanRGB([0, 0, 0], [3, 4, 0]);
    expect(d).toBeCloseTo(5, 5);
  });
});
