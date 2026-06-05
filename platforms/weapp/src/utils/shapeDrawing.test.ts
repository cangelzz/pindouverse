import { describe, it, expect } from 'vitest';
import {
  lineCells,
  rectCells,
  circleCells,
  constrainLine,
  constrainRect,
} from './shapeDrawing';

describe('lineCells', () => {
  it('returns a single cell when start equals end', () => {
    expect(lineCells(3, 3, 3, 3)).toEqual([[3, 3]]);
  });

  it('draws a straight horizontal line', () => {
    expect(lineCells(2, 0, 2, 3)).toEqual([
      [2, 0], [2, 1], [2, 2], [2, 3],
    ]);
  });

  it('draws a straight vertical line', () => {
    expect(lineCells(0, 5, 3, 5)).toEqual([
      [0, 5], [1, 5], [2, 5], [3, 5],
    ]);
  });

  it('draws a 45-degree diagonal', () => {
    expect(lineCells(0, 0, 3, 3)).toEqual([
      [0, 0], [1, 1], [2, 2], [3, 3],
    ]);
  });

  it('handles reverse direction', () => {
    expect(lineCells(3, 3, 0, 0)).toEqual([
      [3, 3], [2, 2], [1, 1], [0, 0],
    ]);
  });
});

describe('rectCells', () => {
  it('returns a single cell when start equals end', () => {
    const cells = rectCells(2, 2, 2, 2, false);
    expect(new Set(cells.map((c) => c.join(',')))).toEqual(new Set(['2,2']));
  });

  it('draws an outline (counter-clockwise from top edge)', () => {
    const cells = rectCells(0, 0, 1, 1, false);
    expect(new Set(cells.map((c) => c.join(',')))).toEqual(
      new Set(['0,0', '0,1', '1,0', '1,1']),
    );
  });

  it('draws a filled rectangle', () => {
    const cells = rectCells(0, 0, 1, 2, true);
    expect(new Set(cells.map((c) => c.join(',')))).toEqual(
      new Set(['0,0', '0,1', '0,2', '1,0', '1,1', '1,2']),
    );
    expect(cells).toHaveLength(6);
  });

  it('is invariant to point order', () => {
    const a = new Set(rectCells(2, 4, 0, 0, true).map((c) => c.join(',')));
    const b = new Set(rectCells(0, 0, 2, 4, true).map((c) => c.join(',')));
    expect(a).toEqual(b);
  });
});

describe('circleCells', () => {
  it('returns a single cell when radius is 0', () => {
    expect(circleCells(5, 5, 0, false)).toEqual([[5, 5]]);
  });

  it('outlines a small circle', () => {
    const cells = circleCells(5, 5, 2, false);
    expect(cells.find((c) => c[0] === 5 && c[1] === 5)).toBeUndefined();
    const keys = new Set(cells.map((c) => c.join(',')));
    expect(keys.has('5,7')).toBe(true);
    expect(keys.has('5,3')).toBe(true);
    expect(keys.has('7,5')).toBe(true);
    expect(keys.has('3,5')).toBe(true);
  });

  it('fills a small circle', () => {
    const cells = circleCells(5, 5, 2, true);
    const keys = new Set(cells.map((c) => c.join(',')));
    expect(keys.has('5,5')).toBe(true);
    expect(keys.has('5,7')).toBe(true);
    expect(keys.has('4,4')).toBe(true);
    expect(keys.has('3,3')).toBe(false);
  });
});

describe('constrainLine', () => {
  it('snaps to horizontal when dc dominates', () => {
    expect(constrainLine(2, 0, 3, 10)).toEqual([2, 10]);
  });

  it('snaps to vertical when dr dominates', () => {
    expect(constrainLine(0, 2, 10, 3)).toEqual([10, 2]);
  });

  it('snaps to 45 diagonal in between', () => {
    expect(constrainLine(0, 0, 5, 4)).toEqual([4, 4]);
  });
});

describe('constrainRect', () => {
  it('produces a square sized to the larger dimension', () => {
    expect(constrainRect(0, 0, 3, 7)).toEqual([7, 7]);
    expect(constrainRect(0, 0, 7, 3)).toEqual([7, 7]);
  });
});
