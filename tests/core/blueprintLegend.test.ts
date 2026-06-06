import { describe, it, expect, vi, beforeAll } from "vitest";
import { buildLegendItems, computeLegendLayout, type LegendCell } from "../../src/utils/blueprintLegend";

const mk = (code: string, r: number, g: number, b: number): LegendCell => ({ color_code: code, r, g, b });

// Mock canvas.measureText: monospace at 12px → each char is exactly 7px wide.
const CHAR_W = 7;
beforeAll(() => {
  const FakeCtx = {
    font: "",
    measureText(s: string) {
      return { width: s.length * CHAR_W };
    },
  };
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
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return { getContext: () => FakeCtx } as any;
      }
      return origCreateElement(tag);
    });
  }
});

describe("buildLegendItems", () => {
  it("counts cells and returns both sort orders", () => {
    const cells: (LegendCell | null)[][] = [
      [mk("A", 1, 1, 1), mk("A", 1, 1, 1), mk("B", 2, 2, 2)],
      [mk("C", 3, 3, 3), null, mk("A", 1, 1, 1)],
    ];
    const { byCount, byAlpha } = buildLegendItems(cells);

    expect(byCount.map((x) => `${x.code}:${x.count}`)).toEqual(["A:3", "B:1", "C:1"]);
    expect(byAlpha.map((x) => x.code)).toEqual(["A", "B", "C"]);
  });

  it("descending count ties broken by ascending code", () => {
    const cells: (LegendCell | null)[][] = [
      [mk("Z", 0, 0, 0), mk("A", 0, 0, 0)],
    ];
    const { byCount } = buildLegendItems(cells);
    expect(byCount.map((x) => x.code)).toEqual(["A", "Z"]);
  });

  it("returns empty arrays for an empty grid", () => {
    const { byCount, byAlpha } = buildLegendItems([[null, null]]);
    expect(byCount).toEqual([]);
    expect(byAlpha).toEqual([]);
  });
});

describe("computeLegendLayout", () => {
  it("computes positive total height for grids with content", () => {
    const cells: (LegendCell | null)[][] = [[mk("A", 1, 1, 1), mk("B", 2, 2, 2)]];
    const layout = computeLegendLayout(cells, 2, 30);
    expect(layout.totalHeight).toBeGreaterThan(0);
    // Default: only the byCount section is included.
    expect(layout.sections).toHaveLength(1);
    expect(layout.sections[0].items.length).toBe(2);
  });

  it("includeByName: true adds the byAlpha section", () => {
    const cells: (LegendCell | null)[][] = [[mk("A", 1, 1, 1), mk("B", 2, 2, 2)]];
    const layout = computeLegendLayout(cells, 2, 30, { includeByName: true });
    expect(layout.sections).toHaveLength(2);
  });

  it("section items sorted by count in first section, alpha in second (when byName included)", () => {
    const cells: (LegendCell | null)[][] = [[
      mk("B", 2, 2, 2), mk("A", 1, 1, 1), mk("A", 1, 1, 1),
    ]];
    const layout = computeLegendLayout(cells, 10, 30, { includeByName: true });
    expect(layout.sections[0].items[0].code).toBe("A"); // highest count
    expect(layout.sections[1].items[0].code).toBe("A"); // alpha first
  });

  it("computes swatchH = cellSize × LEGEND_SCALE (5/3)", () => {
    const cells: (LegendCell | null)[][] = [[mk("A", 1, 1, 1)]];
    expect(computeLegendLayout(cells, 4, 30).swatchH).toBe(50);
    expect(computeLegendLayout(cells, 1, 18).swatchH).toBe(30);
  });
});
