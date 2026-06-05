import { describe, it, expect } from 'vitest';
import { hexToRgb, getEffectiveColor, getEffectiveHex } from '../utils/colorHelper';
import type { ColorOverrideMap } from '../utils/colorHelper';
import { MARD_COLORS } from '../data/mard221';

describe('hexToRgb', () => {
  it('converts #FF0000 to [255, 0, 0]', () => {
    expect(hexToRgb('#FF0000')).toEqual([255, 0, 0]);
  });

  it('converts #000000 to [0, 0, 0]', () => {
    expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
  });

  it('converts #FFFFFF to [255, 255, 255]', () => {
    expect(hexToRgb('#FFFFFF')).toEqual([255, 255, 255]);
  });

  it('converts without # prefix', () => {
    expect(hexToRgb('00FF00')).toEqual([0, 255, 0]);
  });
});

describe('getEffectiveColor', () => {
  it('returns original MARD color with no overrides', () => {
    const overrides: ColorOverrideMap = new Map();
    const color = getEffectiveColor(0, overrides);
    expect(color).toEqual(MARD_COLORS[0]);
  });

  it('returns overridden color when override exists', () => {
    const overrides: ColorOverrideMap = new Map([
      [0, { hex: '#112233', rgb: [17, 34, 51] }],
    ]);
    const color = getEffectiveColor(0, overrides);
    expect(color.hex).toBe('#112233');
    expect(color.rgb).toEqual([17, 34, 51]);
    expect(color.code).toBe(MARD_COLORS[0].code); // code preserved
  });

  it('returns fallback for invalid index', () => {
    const overrides: ColorOverrideMap = new Map();
    const color = getEffectiveColor(9999, overrides);
    expect(color.code).toBe('?');
  });
});

describe('getEffectiveHex', () => {
  it('returns original hex with no override', () => {
    const overrides: ColorOverrideMap = new Map();
    expect(getEffectiveHex(0, overrides)).toBe(MARD_COLORS[0].hex);
  });

  it('returns overridden hex', () => {
    const overrides: ColorOverrideMap = new Map([
      [0, { hex: '#ABCDEF', rgb: [171, 205, 239] }],
    ]);
    expect(getEffectiveHex(0, overrides)).toBe('#ABCDEF');
  });
});
