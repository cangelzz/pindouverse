import { describe, it, expect } from 'vitest';
import {
  rectSelectionCells,
  cloneSelectionRegion,
  applyClipboardToData,
  type ClipboardPayload,
  type SelectionBounds,
} from './selectionUtils';
import type { CanvasData } from '@pindou/core';

function emptyCanvas(w: number, h: number): CanvasData {
  return Array.from({ length: h }, () =>
    Array.from({ length: w }, () => ({ colorIndex: null as number | null })),
  );
}

function filledCanvas(w: number, h: number, idx: number | null): CanvasData {
  return Array.from({ length: h }, () =>
    Array.from({ length: w }, () => ({ colorIndex: idx })),
  );
}

describe('rectSelectionCells', () => {
  it('handles point order independence', () => {
    const a = rectSelectionCells({ r1: 0, c1: 0, r2: 1, c2: 1 });
    const b = rectSelectionCells({ r1: 1, c1: 1, r2: 0, c2: 0 });
    expect(a).toEqual(b);
  });

  it('includes both endpoints', () => {
    const cells = rectSelectionCells({ r1: 1, c1: 2, r2: 3, c2: 4 });
    expect(cells.has('1,2')).toBe(true);
    expect(cells.has('3,4')).toBe(true);
    expect(cells.size).toBe(3 * 3);
  });
});

describe('cloneSelectionRegion', () => {
  it('extracts a width-clamped rectangular region', () => {
    const data = filledCanvas(4, 4, 7);
    const payload = cloneSelectionRegion(data, { r1: 1, c1: 1, r2: 2, c2: 2 });
    expect(payload.w).toBe(2);
    expect(payload.h).toBe(2);
    expect(payload.cells).toEqual([
      [7, 7],
      [7, 7],
    ]);
  });

  it('records null cells', () => {
    const data = emptyCanvas(3, 3);
    data[1][1] = { colorIndex: 5 };
    const payload = cloneSelectionRegion(data, { r1: 0, c1: 0, r2: 2, c2: 2 });
    expect(payload.cells[1][1]).toBe(5);
    expect(payload.cells[0][0]).toBe(null);
  });
});

describe('applyClipboardToData', () => {
  it('writes payload cells starting at offset, clamps to canvas bounds, returns patches', () => {
    const data = emptyCanvas(4, 4);
    const payload: ClipboardPayload = {
      w: 2,
      h: 2,
      cells: [
        [9, 9],
        [9, null],
      ],
    };
    const patches = applyClipboardToData(data, payload, 1, 1);
    expect(patches).toHaveLength(3);
    expect(patches.find((p) => p.row === 1 && p.col === 1 && p.next === 9)).toBeTruthy();
    expect(patches.find((p) => p.row === 2 && p.col === 2 && p.next === null)).toBeUndefined();
    expect(data[1][1].colorIndex).toBe(9);
    expect(data[2][2].colorIndex).toBe(null);
  });

  it('does not write patches when prev equals next', () => {
    const data = filledCanvas(3, 3, 4);
    const payload: ClipboardPayload = { w: 2, h: 2, cells: [[4, 4], [4, 4]] };
    const patches = applyClipboardToData(data, payload, 0, 0);
    expect(patches).toHaveLength(0);
  });

  it('clamps offsets that put part of the payload off-canvas', () => {
    const data = emptyCanvas(3, 3);
    const payload: ClipboardPayload = {
      w: 3,
      h: 3,
      cells: [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ],
    };
    const patches = applyClipboardToData(data, payload, 1, 1);
    expect(patches.find((p) => p.row === 3 || p.col === 3)).toBeUndefined();
    expect(patches.find((p) => p.row === 2 && p.col === 2 && p.next === 5)).toBeTruthy();
  });
});

describe('type exports', () => {
  it('SelectionBounds shape compiles', () => {
    const b: SelectionBounds = { r1: 0, c1: 0, r2: 0, c2: 0 };
    expect(b).toBeTruthy();
  });
});
