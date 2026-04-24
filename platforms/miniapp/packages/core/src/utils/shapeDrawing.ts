/**
 * Shape drawing utilities for line, rectangle, and circle tools.
 * All functions return an array of [row, col] cell coordinates.
 */

/** Bresenham line algorithm: returns all cells along a line from (r1,c1) to (r2,c2). */
export function lineCells(r1: number, c1: number, r2: number, c2: number): [number, number][] {
  const cells: [number, number][] = [];
  let dr = Math.abs(r2 - r1);
  let dc = Math.abs(c2 - c1);
  let sr = r1 < r2 ? 1 : -1;
  let sc = c1 < c2 ? 1 : -1;
  let err = dr - dc;
  let r = r1, c = c1;

  while (true) {
    cells.push([r, c]);
    if (r === r2 && c === c2) break;
    const e2 = 2 * err;
    if (e2 > -dc) { err -= dc; r += sr; }
    if (e2 < dr) { err += dr; c += sc; }
  }
  return cells;
}

/** Rectangle outline cells. */
export function rectCells(r1: number, c1: number, r2: number, c2: number, filled: boolean): [number, number][] {
  const minR = Math.min(r1, r2);
  const maxR = Math.max(r1, r2);
  const minC = Math.min(c1, c2);
  const maxC = Math.max(c1, c2);
  const cells: [number, number][] = [];

  if (filled) {
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        cells.push([r, c]);
      }
    }
  } else {
    for (let c = minC; c <= maxC; c++) { cells.push([minR, c]); cells.push([maxR, c]); }
    for (let r = minR + 1; r < maxR; r++) { cells.push([r, minC]); cells.push([r, maxC]); }
  }
  return cells;
}

/** Circle (midpoint algorithm). */
export function circleCells(cr: number, cc: number, radius: number, filled: boolean): [number, number][] {
  const cells: Set<string> = new Set();
  const add = (r: number, c: number) => { cells.add(`${r},${c}`); };

  if (radius <= 0) {
    add(cr, cc);
    return [[cr, cc]];
  }

  if (filled) {
    for (let r = cr - radius; r <= cr + radius; r++) {
      for (let c = cc - radius; c <= cc + radius; c++) {
        const dr = r - cr;
        const dc = c - cc;
        if (dr * dr + dc * dc <= radius * radius) {
          add(r, c);
        }
      }
    }
  } else {
    // Midpoint circle algorithm
    let x = radius, y = 0, err = 1 - radius;
    while (x >= y) {
      add(cr + y, cc + x); add(cr + x, cc + y);
      add(cr + x, cc - y); add(cr + y, cc - x);
      add(cr - y, cc - x); add(cr - x, cc - y);
      add(cr - x, cc + y); add(cr - y, cc + x);
      y++;
      if (err < 0) {
        err += 2 * y + 1;
      } else {
        x--;
        err += 2 * (y - x) + 1;
      }
    }
  }

  return Array.from(cells).map((s) => {
    const [r, c] = s.split(",").map(Number);
    return [r, c] as [number, number];
  });
}

/** Constrain line to horizontal, vertical, or 45° diagonal when Shift is held. */
export function constrainLine(r1: number, c1: number, r2: number, c2: number): [number, number] {
  const dr = Math.abs(r2 - r1);
  const dc = Math.abs(c2 - c1);
  if (dc > dr * 2) {
    // Horizontal
    return [r1, c2];
  } else if (dr > dc * 2) {
    // Vertical
    return [r2, c1];
  } else {
    // 45° diagonal
    const d = Math.min(dr, dc);
    return [r1 + d * Math.sign(r2 - r1), c1 + d * Math.sign(c2 - c1)];
  }
}

/** Constrain rectangle to square when Shift is held. */
export function constrainRect(r1: number, c1: number, r2: number, c2: number): [number, number] {
  const dr = Math.abs(r2 - r1);
  const dc = Math.abs(c2 - c1);
  const d = Math.max(dr, dc);
  return [r1 + d * Math.sign(r2 - r1), c1 + d * Math.sign(c2 - c1)];
}
