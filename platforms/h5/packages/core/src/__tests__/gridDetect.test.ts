import { describe, it, expect } from 'vitest';
import { detectPixelGrid } from '../utils/gridDetect';

describe('detectPixelGrid', () => {
  it('returns correct structure', () => {
    // 2x2 checkerboard with cell size 4 → 8x8 image
    const width = 8;
    const height = 8;
    const pixels: number[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cellX = Math.floor(x / 4);
        const cellY = Math.floor(y / 4);
        const isWhite = (cellX + cellY) % 2 === 0;
        pixels.push(isWhite ? 255 : 0, isWhite ? 255 : 0, isWhite ? 255 : 0);
      }
    }
    const result = detectPixelGrid(pixels, width, height, { minCellSize: 2 });
    expect(result).toHaveProperty('cellSize');
    expect(result).toHaveProperty('cellSizeH');
    expect(result).toHaveProperty('cellSizeV');
    expect(result).toHaveProperty('recommendedMaxDimension');
    expect(result).toHaveProperty('gridCols');
    expect(result).toHaveProperty('gridRows');
    expect(result).toHaveProperty('confidence');
  });

  it('detects cell size for uniform grid', () => {
    // 3x3 grid of 10px cells = 30x30 image
    const cellSize = 10;
    const cols = 3;
    const rows = 3;
    const width = cols * cellSize;
    const height = rows * cellSize;
    const colors = [
      [255, 0, 0], [0, 255, 0], [0, 0, 255],
      [255, 255, 0], [0, 255, 255], [255, 0, 255],
      [128, 0, 0], [0, 128, 0], [0, 0, 128],
    ];
    const pixels: number[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cx = Math.floor(x / cellSize);
        const cy = Math.floor(y / cellSize);
        const c = colors[cy * cols + cx];
        pixels.push(c[0], c[1], c[2]);
      }
    }
    const result = detectPixelGrid(pixels, width, height, { minCellSize: 4, maxCellSize: 15 });
    expect(result.cellSize).toBeCloseTo(10, 0);
    expect(result.gridCols).toBe(3);
    expect(result.gridRows).toBe(3);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('handles single-color image gracefully', () => {
    const width = 20;
    const height = 20;
    const pixels = new Array(width * height * 3).fill(128);
    const result = detectPixelGrid(pixels, width, height);
    // No edges → confidence should be 0
    expect(result.confidence).toBe(0);
  });
});
