import { describe, it, expect } from 'vitest';
import { rgbToLab, deltaE76, euclideanRGB } from '../utils/colorConversion';

describe('rgbToLab', () => {
  it('converts white correctly', () => {
    const [L, a, b] = rgbToLab(255, 255, 255);
    expect(L).toBeCloseTo(100, 0);
    expect(a).toBeCloseTo(0, 0);
    expect(b).toBeCloseTo(0, 0);
  });

  it('converts black correctly', () => {
    const [L, a, b] = rgbToLab(0, 0, 0);
    expect(L).toBeCloseTo(0, 0);
    expect(a).toBeCloseTo(0, 0);
    expect(b).toBeCloseTo(0, 0);
  });

  it('converts red correctly', () => {
    const [L, a, b] = rgbToLab(255, 0, 0);
    expect(L).toBeCloseTo(53.2, 0);
    expect(a).toBeCloseTo(80.1, 0);
    expect(b).toBeCloseTo(67.2, 0);
  });

  it('converts green correctly', () => {
    const [L] = rgbToLab(0, 255, 0);
    expect(L).toBeCloseTo(87.7, 0);
  });

  it('converts blue correctly', () => {
    const [L, a, b] = rgbToLab(0, 0, 255);
    expect(L).toBeCloseTo(32.3, 0);
    expect(a).toBeCloseTo(79.2, 0);
    expect(b).toBeCloseTo(-107.9, 0);
  });
});

describe('deltaE76', () => {
  it('returns 0 for identical colors', () => {
    const lab = rgbToLab(128, 64, 200);
    expect(deltaE76(lab, lab)).toBe(0);
  });

  it('returns > 50 for very different colors', () => {
    const white = rgbToLab(255, 255, 255);
    const black = rgbToLab(0, 0, 0);
    expect(deltaE76(white, black)).toBeGreaterThan(50);
  });

  it('returns small value for similar colors', () => {
    const a = rgbToLab(100, 100, 100);
    const b = rgbToLab(105, 100, 100);
    expect(deltaE76(a, b)).toBeLessThan(5);
  });
});

describe('euclideanRGB', () => {
  it('returns 0 for identical colors', () => {
    expect(euclideanRGB([100, 200, 50], [100, 200, 50])).toBe(0);
  });

  it('computes correctly for known values', () => {
    // sqrt((255-0)^2 + (0-0)^2 + (0-0)^2) = 255
    expect(euclideanRGB([255, 0, 0], [0, 0, 0])).toBe(255);
  });

  it('computes sqrt(3)*255 for black vs white', () => {
    const d = euclideanRGB([0, 0, 0], [255, 255, 255]);
    expect(d).toBeCloseTo(Math.sqrt(3) * 255, 5);
  });
});
