import { describe, it, expect } from 'vitest';
import { findClosestColor, matchImageToMard, invalidateLabCache } from '../utils/colorMatching';
import { MARD_COLORS } from '../data/mard221';

describe('findClosestColor', () => {
  it('matches white to H2 (pure white) with ciede2000', () => {
    invalidateLabCache();
    const idx = findClosestColor(255, 255, 255, 'ciede2000');
    const color = MARD_COLORS[idx];
    // H2 is #FFFFFF
    expect(color.code).toBe('H2');
  });

  it('matches white with euclidean', () => {
    const idx = findClosestColor(255, 255, 255, 'euclidean');
    const color = MARD_COLORS[idx];
    expect(color.code).toBe('H2');
  });

  it('matches black to H7 (near-black) with ciede2000', () => {
    invalidateLabCache();
    const idx = findClosestColor(0, 0, 0, 'ciede2000');
    const color = MARD_COLORS[idx];
    // H7 is [1,1,1]
    expect(color.code).toBe('H7');
  });

  it('matches black with euclidean', () => {
    const idx = findClosestColor(0, 0, 0, 'euclidean');
    const color = MARD_COLORS[idx];
    expect(color.code).toBe('H7');
  });

  it('matches pure red to a reasonable color', () => {
    const idx = findClosestColor(255, 0, 0, 'ciede2000');
    const color = MARD_COLORS[idx];
    // Should be some red-ish color
    expect(color.rgb[0]).toBeGreaterThan(150);
  });

  it('respects allowedIndices', () => {
    const idx = findClosestColor(0, 0, 0, 'euclidean', [0, 1, 2]);
    expect([0, 1, 2]).toContain(idx);
  });
});

describe('matchImageToMard', () => {
  it('returns correct length for 2x2 pixel array', () => {
    // 4 pixels = 12 values in flat RGB
    const pixels = [255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0];
    const result = matchImageToMard(pixels, 'ciede2000', 'mard221');
    expect(result).toHaveLength(4);
  });

  it('returns valid indices', () => {
    const pixels = [128, 128, 128, 64, 64, 64];
    const result = matchImageToMard(pixels, 'euclidean', 'mard221');
    expect(result).toHaveLength(2);
    for (const idx of result) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(MARD_COLORS.length);
    }
  });
});

describe('invalidateLabCache', () => {
  it('does not throw', () => {
    expect(() => invalidateLabCache()).not.toThrow();
  });
});
