import { describe, it, expect } from 'vitest';
import { computeFloodReplaceEntries, computeFloodSelectCells } from './floodFill';
import type { CanvasData } from '@pindou/core';

function makeCanvas(rows: (number | null)[][]): CanvasData {
  return rows.map((row) => row.map((idx) => ({ colorIndex: idx })));
}

describe('computeFloodReplaceEntries', () => {
  it('returns empty when target color already equals replaceWith', () => {
    const data = makeCanvas([[1, 1], [1, 1]]);
    expect(computeFloodReplaceEntries(data, 0, 0, 1, 2, 2)).toEqual([]);
  });

  it('replaces a connected region of the target color', () => {
    const data = makeCanvas([
      [1, 1, 2],
      [1, 1, 2],
      [3, 3, 2],
    ]);
    const entries = computeFloodReplaceEntries(data, 0, 0, 9, 3, 3);
    expect(entries).toHaveLength(4);
    expect(entries.every((e) => e.colorIndex === 9)).toBe(true);
    const keys = new Set(entries.map((e) => `${e.row},${e.col}`));
    expect(keys).toEqual(new Set(['0,0', '0,1', '1,0', '1,1']));
  });

  it('handles writing null (erase) over a colored region', () => {
    const data = makeCanvas([
      [5, 5],
      [5, 0],
    ]);
    const entries = computeFloodReplaceEntries(data, 0, 0, null, 2, 2);
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.colorIndex === null)).toBe(true);
  });

  it('returns empty when start coords are out of bounds', () => {
    const data = makeCanvas([[1]]);
    expect(computeFloodReplaceEntries(data, 5, 5, 2, 1, 1)).toEqual([]);
    expect(computeFloodReplaceEntries(data, -1, 0, 2, 1, 1)).toEqual([]);
  });

  it('does not cross diagonally (4-connected only)', () => {
    const data = makeCanvas([
      [1, 2],
      [2, 1],
    ]);
    const entries = computeFloodReplaceEntries(data, 0, 0, 9, 2, 2);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ row: 0, col: 0, colorIndex: 9 });
  });
});

describe('computeFloodSelectCells', () => {
  it('returns a set of "r,c" keys for the connected same-color region', () => {
    const data = makeCanvas([
      [1, 1, 2],
      [1, 1, 2],
      [3, 3, 2],
    ]);
    const cells = computeFloodSelectCells(data, 0, 0, 3, 3);
    expect(cells).toEqual(new Set(['0,0', '0,1', '1,0', '1,1']));
  });

  it('returns null cells region', () => {
    const data = makeCanvas([
      [null, null, 1],
      [null, 1, 1],
    ]);
    const cells = computeFloodSelectCells(data, 0, 0, 3, 2);
    expect(cells).toEqual(new Set(['0,0', '0,1', '1,0']));
  });

  it('returns empty set when start is out of bounds', () => {
    const data = makeCanvas([[1]]);
    expect(computeFloodSelectCells(data, 5, 5, 1, 1)).toEqual(new Set());
  });

  it('single cell when surrounded by different colors', () => {
    const data = makeCanvas([
      [2, 1, 2],
      [1, 5, 1],
      [2, 1, 2],
    ]);
    const cells = computeFloodSelectCells(data, 1, 1, 3, 3);
    expect(cells).toEqual(new Set(['1,1']));
  });
});
