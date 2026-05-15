import { describe, it, expect } from "vitest";
import { computeFloodReplaceEntries } from "./floodFill";
import type { CanvasData } from "../types";

function makeGrid(rows: (number | null)[][]): CanvasData {
  return rows.map((r) => r.map((c) => ({ colorIndex: c })));
}

describe("computeFloodReplaceEntries", () => {
  it("returns empty when target color equals replacement", () => {
    const grid = makeGrid([
      [1, 1],
      [1, 1],
    ]);
    expect(computeFloodReplaceEntries(grid, 0, 0, 1, 2, 2)).toEqual([]);
  });

  it("fills a 2x2 connected region of color 1 with color 2", () => {
    const grid = makeGrid([
      [1, 1, 3],
      [1, 1, 3],
      [3, 3, 3],
    ]);
    const entries = computeFloodReplaceEntries(grid, 0, 0, 2, 3, 3);
    expect(entries).toHaveLength(4);
    for (const e of entries) {
      expect(grid[e.row][e.col].colorIndex).toBe(1);
      expect(e.colorIndex).toBe(2);
    }
  });

  it("erases (replaces with null) a connected region of color 5", () => {
    const grid = makeGrid([
      [5, 5, null],
      [5, null, null],
    ]);
    const entries = computeFloodReplaceEntries(grid, 0, 0, null, 3, 2);
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.colorIndex === null)).toBe(true);
  });

  it("returns empty when clicking an empty cell with null replacement", () => {
    const grid = makeGrid([[null, null]]);
    expect(computeFloodReplaceEntries(grid, 0, 0, null, 2, 1)).toEqual([]);
  });

  it("does not cross to a disconnected region of the same color", () => {
    const grid = makeGrid([
      [1, 3, 1],
      [1, 3, 1],
    ]);
    const entries = computeFloodReplaceEntries(grid, 0, 0, 2, 3, 2);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.col === 0)).toBe(true);
  });

  it("treats nulls as a color — empty regions flood as well", () => {
    const grid = makeGrid([
      [null, null, 1],
      [null, 1, 1],
    ]);
    const entries = computeFloodReplaceEntries(grid, 0, 0, 9, 3, 2);
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.colorIndex === 9)).toBe(true);
  });

  it("respects width/height bounds", () => {
    const grid = makeGrid([
      [1, 1],
      [1, 1],
    ]);
    const entries = computeFloodReplaceEntries(grid, 0, 0, 2, 1, 1);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ row: 0, col: 0, colorIndex: 2 });
  });
});
