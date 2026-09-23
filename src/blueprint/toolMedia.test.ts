import { expect, it } from "vitest";
import { mapToolImportPixels } from "./toolMedia";

it("rejects malformed image buffers before conversion", () => {
  expect(() => mapToolImportPixels({ width: 2, height: 1, pixels: [0, 0, 0] }, "euclidean", new Map())).toThrow(RangeError);
});

it("maps two RGB pixels to two bounded cell coordinates", () => {
  const mapped = mapToolImportPixels({ width: 2, height: 1, pixels: [0, 0, 0, 255, 255, 255] }, "euclidean", new Map());
  expect(mapped).toHaveLength(2);
  expect(mapped[0]).toMatchObject({ row: 0, col: 0 });
  expect(mapped[1]).toMatchObject({ row: 0, col: 1 });
  expect(mapped.every(cell => Number.isInteger(cell.colorIndex))).toBe(true);
});