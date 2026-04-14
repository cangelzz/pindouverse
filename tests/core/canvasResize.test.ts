import { describe, it, expect } from "vitest";
import type { CanvasData } from "../../src/types";

// Pure functions extracted for testability — same logic used in editorStore
function createEmptyCanvas(width: number, height: number): CanvasData {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ colorIndex: null }))
  );
}

function resizeLayerData(
  data: CanvasData,
  oldW: number, oldH: number,
  newW: number, newH: number,
  anchorRow: number, anchorCol: number,
): CanvasData {
  const offsetCol = Math.floor(anchorCol * (newW - oldW) / 2);
  const offsetRow = Math.floor(anchorRow * (newH - oldH) / 2);
  const result = createEmptyCanvas(newW, newH);
  for (let r = 0; r < oldH; r++) {
    for (let c = 0; c < oldW; c++) {
      const nr = r + offsetRow;
      const nc = c + offsetCol;
      if (nr >= 0 && nr < newH && nc >= 0 && nc < newW) {
        result[nr][nc] = data[r][c];
      }
    }
  }
  return result;
}

function countLostPixels(
  layers: { data: CanvasData; visible: boolean }[],
  oldW: number, oldH: number,
  newW: number, newH: number,
  anchorRow: number, anchorCol: number,
): number {
  const offsetCol = Math.floor(anchorCol * (newW - oldW) / 2);
  const offsetRow = Math.floor(anchorRow * (newH - oldH) / 2);
  let lost = 0;
  for (const layer of layers) {
    if (!layer.visible) continue;
    for (let r = 0; r < oldH; r++) {
      for (let c = 0; c < oldW; c++) {
        if (layer.data[r][c].colorIndex === null) continue;
        const nr = r + offsetRow;
        const nc = c + offsetCol;
        if (nr < 0 || nr >= newH || nc < 0 || nc >= newW) {
          lost++;
        }
      }
    }
  }
  return lost;
}

describe("resizeLayerData", () => {
  it("expands canvas with top-left anchor", () => {
    const data: CanvasData = [
      [{ colorIndex: 1 }, { colorIndex: 2 }],
      [{ colorIndex: 3 }, { colorIndex: 4 }],
    ];
    const result = resizeLayerData(data, 2, 2, 4, 3, 0, 0);
    expect(result[0][0].colorIndex).toBe(1);
    expect(result[0][1].colorIndex).toBe(2);
    expect(result[1][0].colorIndex).toBe(3);
    expect(result[1][1].colorIndex).toBe(4);
    expect(result[0][2].colorIndex).toBeNull();
    expect(result[0][3].colorIndex).toBeNull();
    expect(result[2][0].colorIndex).toBeNull();
  });

  it("expands canvas with center anchor", () => {
    const data: CanvasData = [
      [{ colorIndex: 1 }, { colorIndex: 2 }],
      [{ colorIndex: 3 }, { colorIndex: 4 }],
    ];
    const result = resizeLayerData(data, 2, 2, 4, 4, 1, 1);
    expect(result[1][1].colorIndex).toBe(1);
    expect(result[1][2].colorIndex).toBe(2);
    expect(result[2][1].colorIndex).toBe(3);
    expect(result[2][2].colorIndex).toBe(4);
    expect(result[0][0].colorIndex).toBeNull();
    expect(result[3][3].colorIndex).toBeNull();
  });

  it("expands canvas with bottom-right anchor", () => {
    const data: CanvasData = [
      [{ colorIndex: 5 }],
    ];
    const result = resizeLayerData(data, 1, 1, 3, 3, 2, 2);
    expect(result[2][2].colorIndex).toBe(5);
    expect(result[0][0].colorIndex).toBeNull();
  });

  it("shrinks canvas and clips pixels", () => {
    const data: CanvasData = [
      [{ colorIndex: 1 }, { colorIndex: 2 }, { colorIndex: 3 }],
      [{ colorIndex: 4 }, { colorIndex: 5 }, { colorIndex: 6 }],
      [{ colorIndex: 7 }, { colorIndex: 8 }, { colorIndex: 9 }],
    ];
    const result = resizeLayerData(data, 3, 3, 2, 2, 0, 0);
    expect(result[0][0].colorIndex).toBe(1);
    expect(result[0][1].colorIndex).toBe(2);
    expect(result[1][0].colorIndex).toBe(4);
    expect(result[1][1].colorIndex).toBe(5);
    expect(result.length).toBe(2);
    expect(result[0].length).toBe(2);
  });

  it("handles same size as no-op", () => {
    const data: CanvasData = [
      [{ colorIndex: 1 }, { colorIndex: 2 }],
    ];
    const result = resizeLayerData(data, 2, 1, 2, 1, 0, 0);
    expect(result[0][0].colorIndex).toBe(1);
    expect(result[0][1].colorIndex).toBe(2);
  });
});

describe("countLostPixels", () => {
  it("returns 0 when expanding", () => {
    const layers = [{
      visible: true,
      data: [[{ colorIndex: 1 }, { colorIndex: 2 }]] as CanvasData,
    }];
    expect(countLostPixels(layers, 2, 1, 4, 2, 0, 0)).toBe(0);
  });

  it("counts pixels lost when shrinking", () => {
    const layers = [{
      visible: true,
      data: [
        [{ colorIndex: 1 }, { colorIndex: 2 }, { colorIndex: 3 }],
        [{ colorIndex: 4 }, { colorIndex: null }, { colorIndex: 6 }],
        [{ colorIndex: 7 }, { colorIndex: 8 }, { colorIndex: 9 }],
      ] as CanvasData,
    }];
    expect(countLostPixels(layers, 3, 3, 2, 2, 0, 0)).toBe(5);
  });

  it("ignores hidden layers", () => {
    const layers = [{
      visible: false,
      data: [[{ colorIndex: 1 }, { colorIndex: 2 }, { colorIndex: 3 }]] as CanvasData,
    }];
    expect(countLostPixels(layers, 3, 1, 1, 1, 0, 0)).toBe(0);
  });

  it("counts across multiple visible layers", () => {
    const layers = [
      { visible: true, data: [[{ colorIndex: 1 }, { colorIndex: 2 }]] as CanvasData },
      { visible: true, data: [[{ colorIndex: 3 }, { colorIndex: 4 }]] as CanvasData },
    ];
    expect(countLostPixels(layers, 2, 1, 1, 1, 0, 0)).toBe(2);
  });
});
