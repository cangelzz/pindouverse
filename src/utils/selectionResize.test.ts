import { describe, it, expect } from "vitest";
import {
  isRectangularSelection,
  hitTestResizeHandle,
  edgesForHandle,
  computeResizedBounds,
  cellsFromBounds,
} from "./selectionResize";

describe("isRectangularSelection", () => {
  it("true when set covers the full bounding box", () => {
    const cells = cellsFromBounds({ r1: 1, c1: 2, r2: 3, c2: 4 });
    expect(isRectangularSelection(cells, { r1: 1, c1: 2, r2: 3, c2: 4 })).toBe(true);
  });

  it("false when one cell removed (e.g. wand selection minus a hole)", () => {
    const cells = cellsFromBounds({ r1: 0, c1: 0, r2: 2, c2: 2 });
    cells.delete("1,1");
    expect(isRectangularSelection(cells, { r1: 0, c1: 0, r2: 2, c2: 2 })).toBe(false);
  });

  it("false when bounds are larger than the cell coverage", () => {
    const cells = new Set(["0,0", "0,1"]);
    expect(isRectangularSelection(cells, { r1: 0, c1: 0, r2: 1, c2: 1 })).toBe(false);
  });
});

describe("hitTestResizeHandle", () => {
  // bounds {r1:1,c1:2,r2:3,c2:4} with cellSize=10, no pan → handles at:
  //   nw=(20,10) n=(35,10) ne=(50,10)
  //   w =(20,25)             e =(50,25)
  //   sw=(20,40) s=(35,40) se=(50,40)
  const bounds = { r1: 1, c1: 2, r2: 3, c2: 4 };
  const geom = { cellSize: 10, offsetX: 0, offsetY: 0 };

  it("hits each of the 8 handles when mouse is on its center", () => {
    expect(hitTestResizeHandle(20, 10, bounds, geom)).toBe("nw");
    expect(hitTestResizeHandle(35, 10, bounds, geom)).toBe("n");
    expect(hitTestResizeHandle(50, 10, bounds, geom)).toBe("ne");
    expect(hitTestResizeHandle(20, 25, bounds, geom)).toBe("w");
    expect(hitTestResizeHandle(50, 25, bounds, geom)).toBe("e");
    expect(hitTestResizeHandle(20, 40, bounds, geom)).toBe("sw");
    expect(hitTestResizeHandle(35, 40, bounds, geom)).toBe("s");
    expect(hitTestResizeHandle(50, 40, bounds, geom)).toBe("se");
  });

  it("hits within the ±8 px tolerance", () => {
    expect(hitTestResizeHandle(20 + 7, 10 + 7, bounds, geom)).toBe("nw");
    expect(hitTestResizeHandle(50 - 7, 40 - 7, bounds, geom)).toBe("se");
  });

  it("misses just past the tolerance", () => {
    expect(hitTestResizeHandle(20 + 9, 10 + 9, bounds, geom)).toBeNull();
  });

  it("misses when mouse is in the middle of the selection", () => {
    expect(hitTestResizeHandle(35, 25, bounds, geom)).toBeNull();
  });

  it("respects pan offset", () => {
    const panned = { cellSize: 10, offsetX: 100, offsetY: 200 };
    // SE handle should now be at (150, 240)
    expect(hitTestResizeHandle(150, 240, bounds, panned)).toBe("se");
    expect(hitTestResizeHandle(50, 40, bounds, panned)).toBeNull();
  });
});

describe("edgesForHandle", () => {
  it("nw has top+left only", () => {
    expect(edgesForHandle("nw")).toEqual({ top: true, right: false, bottom: false, left: true });
  });
  it("e has right only", () => {
    expect(edgesForHandle("e")).toEqual({ top: false, right: true, bottom: false, left: false });
  });
  it("se has bottom+right", () => {
    expect(edgesForHandle("se")).toEqual({ top: false, right: true, bottom: true, left: false });
  });
});

describe("computeResizedBounds", () => {
  const anchor = { r1: 2, c1: 3, r2: 5, c2: 8 };
  const size = { width: 20, height: 20 };

  it("SE drag changes r2/c2, leaves r1/c1", () => {
    expect(computeResizedBounds("se", anchor, 9, 12, size)).toEqual({ r1: 2, c1: 3, r2: 9, c2: 12 });
  });

  it("NW drag changes r1/c1, leaves r2/c2", () => {
    expect(computeResizedBounds("nw", anchor, 4, 5, size)).toEqual({ r1: 4, c1: 5, r2: 5, c2: 8 });
  });

  it("N drag changes only r1 (columns frozen)", () => {
    expect(computeResizedBounds("n", anchor, 0, 999, size)).toEqual({ r1: 0, c1: 3, r2: 5, c2: 8 });
  });

  it("E drag changes only c2 (rows frozen)", () => {
    expect(computeResizedBounds("e", anchor, 999, 15, size)).toEqual({ r1: 2, c1: 3, r2: 5, c2: 15 });
  });

  it("clamps mouse past the right/bottom canvas edge", () => {
    expect(computeResizedBounds("se", anchor, 99, 99, size)).toEqual({ r1: 2, c1: 3, r2: 19, c2: 19 });
  });

  it("clamps mouse past the left/top canvas edge", () => {
    expect(computeResizedBounds("nw", anchor, -10, -10, size)).toEqual({ r1: 0, c1: 0, r2: 5, c2: 8 });
  });

  it("flips when NW drags past the SE corner", () => {
    // Anchor SE = (5, 8). Drag NW to (8, 12) → r1/c1 land past r2/c2 → swap.
    expect(computeResizedBounds("nw", anchor, 8, 12, size)).toEqual({ r1: 5, c1: 8, r2: 8, c2: 12 });
  });
});

describe("cellsFromBounds", () => {
  it("generates the full rectangle as a Set<r,c>", () => {
    const cells = cellsFromBounds({ r1: 0, c1: 1, r2: 1, c2: 3 });
    expect(cells.size).toBe(6);
    expect(cells.has("0,1")).toBe(true);
    expect(cells.has("0,2")).toBe(true);
    expect(cells.has("0,3")).toBe(true);
    expect(cells.has("1,1")).toBe(true);
    expect(cells.has("1,3")).toBe(true);
    expect(cells.has("0,0")).toBe(false);
    expect(cells.has("2,2")).toBe(false);
  });

  it("returns a single-cell set when the rect is 1x1", () => {
    const cells = cellsFromBounds({ r1: 5, c1: 5, r2: 5, c2: 5 });
    expect(cells.size).toBe(1);
    expect(cells.has("5,5")).toBe(true);
  });
});
