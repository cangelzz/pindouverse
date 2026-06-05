import { describe, it, expect, vi, beforeAll } from "vitest";
import {
  buildLegendItems,
  computeLegendLayout,
  LEGEND_PAD,
  LEGEND_GAP,
  type LegendCell,
} from "./blueprintLegend";

// Mock measureText: monospace at 12px → each char is exactly 7px wide.
// This lets us assert exact widths without depending on real font metrics.
const CHAR_W = 7;

beforeAll(() => {
  const FakeCtx = {
    font: "",
    measureText(s: string) {
      return { width: s.length * CHAR_W };
    },
  };
  // Create a minimal mock for document if it doesn't exist (vitest defaults to node env)
  if (typeof document === "undefined") {
    (globalThis as any).document = {
      createElement(tag: string) {
        if (tag === "canvas") {
          return { getContext: () => FakeCtx } as any;
        }
        return {};
      },
    };
  } else {
    // jsdom: spy on createElement so getContext returns our mock
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return { getContext: () => FakeCtx } as any;
      }
      return origCreateElement(tag);
    });
  }
});

function singleColorGrid(code: string, count: number): (LegendCell | null)[][] {
  // Return a grid that contains exactly `count` cells of the given code
  const row: (LegendCell | null)[] = Array.from({ length: count }, () => ({
    color_code: code,
    r: 100,
    g: 150,
    b: 200,
  }));
  return [row];
}

describe("constants", () => {
  // LEGEND_SCALE = 5/3, so PAD/GAP/ROW_GAP are 6/10/9 multiplied + rounded.
  it("exports LEGEND_PAD = 10", () => {
    expect(LEGEND_PAD).toBe(10);
  });
  it("exports LEGEND_GAP = 17", () => {
    expect(LEGEND_GAP).toBe(17);
  });
});

describe("buildLegendItems", () => {
  it("collects unique codes with counts", () => {
    const cells: (LegendCell | null)[][] = [
      [{ color_code: "A1", r: 1, g: 2, b: 3 }, { color_code: "B2", r: 4, g: 5, b: 6 }, null],
      [{ color_code: "A1", r: 1, g: 2, b: 3 }, { color_code: "A1", r: 1, g: 2, b: 3 }, null],
    ];
    const { byCount, byAlpha } = buildLegendItems(cells);
    expect(byCount).toEqual([
      { code: "A1", r: 1, g: 2, b: 3, count: 3 },
      { code: "B2", r: 4, g: 5, b: 6, count: 1 },
    ]);
    expect(byAlpha).toEqual([
      { code: "A1", r: 1, g: 2, b: 3, count: 3 },
      { code: "B2", r: 4, g: 5, b: 6, count: 1 },
    ]);
  });
});

describe("computeLegendLayout", () => {
  it("computes per-item leftW/rightW with padding", () => {
    const cells = singleColorGrid("M001", 42);
    const layout = computeLegendLayout(cells, 10, 30); // gridWidth=10 cells, cellSize=30 → 300px
    expect(layout.sections).toHaveLength(2);
    const item = layout.sections[0].items[0];
    // "M001" is 4 chars * 7 = 28, +12 padding = 40
    expect(item.leftW).toBe(4 * CHAR_W + LEGEND_PAD * 2);
    // "42" is 2 chars * 7 = 14, +12 padding = 26
    expect(item.rightW).toBe(2 * CHAR_W + LEGEND_PAD * 2);
  });

  it("returns swatchH = cellSize × LEGEND_SCALE (5/3)", () => {
    const cells = singleColorGrid("X", 1);
    const layout = computeLegendLayout(cells, 5, 30);
    expect(layout.swatchH).toBe(50);   // 30 * 5/3
    expect(layout.cellSize).toBe(30);  // raw grid cellSize is still preserved
  });

  it("wraps items when the row is full", () => {
    // Create 6 distinct codes; with narrow gridWidth they should wrap
    const cells: (LegendCell | null)[][] = [[
      { color_code: "AAA", r: 0, g: 0, b: 0 }, { color_code: "BBB", r: 0, g: 0, b: 0 },
      { color_code: "CCC", r: 0, g: 0, b: 0 }, { color_code: "DDD", r: 0, g: 0, b: 0 },
      { color_code: "EEE", r: 0, g: 0, b: 0 }, { color_code: "FFF", r: 0, g: 0, b: 0 },
    ]];
    // gridWidth=4 cells * cellSize=30 = 120px → inner=120-margin*2=120-60=60px
    // each item: leftW=3*7+12=33, rightW=1*7+12=19, total=52, +gap=58 next item would not fit
    // So 1 item per row → 6 rows
    const layout = computeLegendLayout(cells, 4, 30);
    expect(layout.sections[0].rowsCount).toBe(6);
  });

  it("packs multiple items per row when there is space", () => {
    const cells: (LegendCell | null)[][] = [[
      { color_code: "A", r: 0, g: 0, b: 0 }, { color_code: "B", r: 0, g: 0, b: 0 },
      { color_code: "C", r: 0, g: 0, b: 0 }, { color_code: "D", r: 0, g: 0, b: 0 },
    ]];
    // gridWidth=20 cells * cellSize=30 = 600px → inner=540
    // each item: leftW=1*7+12=19, rightW=1*7+12=19, total=38, +gap=44; many fit per row
    const layout = computeLegendLayout(cells, 20, 30);
    expect(layout.sections[0].rowsCount).toBe(1);
  });

  it("computes totalHeight = 3*gap + 2*sectionH where sectionH = titleH + rows*(swatchH+rowGap)", () => {
    const cells = singleColorGrid("X1", 5);
    const layout = computeLegendLayout(cells, 10, 30);
    // With LEGEND_SCALE = 5/3 and cellSize = 30:
    //   swatchH      = 30 * 5/3 = 50
    //   gap          = floor(30 * 5/3 * 0.75) = floor(37.5) = 37
    //   sectionTitle = floor(30 * 5/3 * 1.3)  = floor(65)   = 65
    //   rowGap       = round(9 * 5/3)         = 15
    //   sectionH (1 row) = 65 + 1*(50 + 15) = 130
    //   totalHeight  = 37 + 130 + 37 + 130 + 37 = 371
    expect(layout.totalHeight).toBe(371);
  });

  it("section totalHeight reflects multi-row wrap", () => {
    // 12 distinct codes, narrow grid → multiple rows
    const cells: (LegendCell | null)[][] = [Array.from({ length: 12 }, (_, i) => ({
      color_code: `C${i}`, r: 0, g: 0, b: 0,
    }))];
    const layout = computeLegendLayout(cells, 4, 30); // inner ~ 60px, ~2 items/row
    expect(layout.sections[0].rowsCount).toBeGreaterThanOrEqual(2);
  });
});
