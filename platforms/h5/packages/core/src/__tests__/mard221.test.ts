import { describe, it, expect } from 'vitest';
import { MARD_COLORS, COLOR_GROUPS, getGroupIndices } from '../data/mard221';

describe('MARD_COLORS data integrity', () => {
  it('has 221+ colors', () => {
    expect(MARD_COLORS.length).toBeGreaterThanOrEqual(221);
  });

  it('each color has code, name, hex, rgb', () => {
    for (const c of MARD_COLORS) {
      expect(c.code).toBeTruthy();
      expect(c.name).toBeTruthy();
      expect(c.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(c.rgb).toHaveLength(3);
    }
  });

  it('has no duplicate codes', () => {
    const codes = MARD_COLORS.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('RGB values are in 0-255 range', () => {
    for (const c of MARD_COLORS) {
      for (const v of c.rgb) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe('COLOR_GROUPS', () => {
  it('exists and is non-empty', () => {
    expect(COLOR_GROUPS.length).toBeGreaterThan(0);
  });

  it('each group has id, name, series', () => {
    for (const g of COLOR_GROUPS) {
      expect(g.id).toBeTruthy();
      expect(g.name).toBeTruthy();
      expect(g.series.length).toBeGreaterThan(0);
    }
  });
});

describe('getGroupIndices', () => {
  it('returns valid indices for mard221', () => {
    const indices = getGroupIndices('mard221');
    expect(indices.length).toBeGreaterThan(0);
    for (const i of indices) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(MARD_COLORS.length);
    }
  });

  it('returns all non-transparent for unknown group', () => {
    const indices = getGroupIndices('nonexistent');
    expect(indices.length).toBeGreaterThan(200);
  });

  it('"all" group includes more than mard221', () => {
    const all = getGroupIndices('all');
    const m221 = getGroupIndices('mard221');
    expect(all.length).toBeGreaterThan(m221.length);
  });
});
