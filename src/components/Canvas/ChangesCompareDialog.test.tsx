import { describe, it, expect } from "vitest";
import { computeChangeStats } from "./changeStats";
import type { CanvasData } from "../../types";

function makeCells(rows: (number | null)[][]): CanvasData {
  return rows.map((row) => row.map((v) => ({ colorIndex: v })));
}

describe("computeChangeStats", () => {
  it("returns zeros when baseline is null", () => {
    expect(computeChangeStats(makeCells([[1]]), null, 1, 1)).toEqual({
      added: 0, removed: 0, modified: 0,
    });
  });

  it("returns zeros for identical grids", () => {
    const a = makeCells([[1, 2], [3, 4]]);
    const b = makeCells([[1, 2], [3, 4]]);
    expect(computeChangeStats(a, b, 2, 2)).toEqual({
      added: 0, removed: 0, modified: 0,
    });
  });

  it("counts added/removed/modified", () => {
    const baseline = makeCells([
      [null, 1, 2],
      [3,    4, null],
    ]);
    const current = makeCells([
      [5,    1, 2],
      [3,    9, 8],
    ]);
    expect(computeChangeStats(current, baseline, 3, 2)).toEqual({
      added: 2, removed: 0, modified: 1,
    });
  });

  it("counts removed cells", () => {
    const baseline = makeCells([[1, 2, 3]]);
    const current = makeCells([[1, null, 3]]);
    expect(computeChangeStats(current, baseline, 3, 1)).toEqual({
      added: 0, removed: 1, modified: 0,
    });
  });

  it("handles size mismatch — baseline smaller than current", () => {
    const baseline = makeCells([
      [1, 2],
      [3, 4],
    ]);
    const current = makeCells([
      [1, 2, 5],
      [3, 4, 6],
    ]);
    expect(computeChangeStats(current, baseline, 3, 2)).toEqual({
      added: 2, removed: 0, modified: 0,
    });
  });

  it("handles size mismatch — current smaller than baseline", () => {
    const baseline = makeCells([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    const current = makeCells([
      [1, 2],
      [4, 5],
    ]);
    expect(computeChangeStats(current, baseline, 3, 2)).toEqual({
      added: 0, removed: 2, modified: 0,
    });
  });
});
