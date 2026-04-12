/**
 * Pixel Art Grid Detector
 *
 * Automatically detects the underlying grid cell size of a pixel art image
 * by analyzing the distances between color-change edges.
 *
 * For pixel art, colors are uniform within each "logical pixel" (cell),
 * so color changes happen at cell boundaries. The most common distance
 * between these boundaries reveals the cell size.
 *
 * Returns the optimal maxDimension for import.
 */

export interface GridDetectResult {
  /** Detected cell size in source pixels (average of H and V) */
  cellSize: number;
  /** Horizontal cell size */
  cellSizeH: number;
  /** Vertical cell size */
  cellSizeV: number;
  /** Recommended maxDimension for import_image */
  recommendedMaxDimension: number;
  /** Estimated grid columns */
  gridCols: number;
  /** Estimated grid rows */
  gridRows: number;
  /** Confidence 0-1 (higher = more periodic/pixel-art-like) */
  confidence: number;
}

/**
 * Detect pixel art grid from raw pixel data.
 *
 * @param pixels - Flat [r,g,b, r,g,b, ...] array (same as import_image output)
 * @param width  - Image width in pixels
 * @param height - Image height in pixels
 * @param options - Detection options
 */
export function detectPixelGrid(
  pixels: Uint8Array | number[],
  width: number,
  height: number,
  options?: {
    /** Color distance threshold for detecting edges (default: 30) */
    edgeThreshold?: number;
    /** Min cell size to consider (default: 4) */
    minCellSize?: number;
    /** Max cell size to consider (default: width/4) */
    maxCellSize?: number;
    /** Number of rows/cols to sample (default: 80) */
    sampleLines?: number;
  }
): GridDetectResult {
  const threshold = options?.edgeThreshold ?? 30;
  const minCell = options?.minCellSize ?? 4;
  const maxCell = options?.maxCellSize ?? Math.floor(Math.min(width, height) / 4);
  const sampleLines = options?.sampleLines ?? 80;

  function getPixel(x: number, y: number): [number, number, number] {
    const i = (y * width + x) * 3;
    return [pixels[i], pixels[i + 1], pixels[i + 2]];
  }

  function colorDist(a: [number, number, number], b: [number, number, number]): number {
    return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
  }

  /**
   * Analyze edge gaps along one axis.
   * Returns a map of gap → count for gaps in [minCell, maxCell].
   */
  function analyzeEdgeGaps(horizontal: boolean): Map<number, number> {
    const gapCounts = new Map<number, number>();
    const outerDim = horizontal ? height : width;
    const innerDim = horizontal ? width : height;
    const step = Math.max(1, Math.floor(outerDim / sampleLines));

    for (let outer = 0; outer < outerDim; outer += step) {
      let lastChange = 0;
      for (let inner = 1; inner < innerDim; inner++) {
        const x1 = horizontal ? inner - 1 : outer;
        const y1 = horizontal ? outer : inner - 1;
        const x2 = horizontal ? inner : outer;
        const y2 = horizontal ? outer : inner;

        if (colorDist(getPixel(x1, y1), getPixel(x2, y2)) > threshold) {
          const gap = inner - lastChange;
          if (gap >= minCell && gap <= maxCell) {
            gapCounts.set(gap, (gapCounts.get(gap) || 0) + 1);
          }
          lastChange = inner;
        }
      }
    }

    return gapCounts;
  }

  /**
   * Find the best cell size from gap histogram.
   * Uses weighted average of the top cluster of gaps.
   */
  function findBestCellSize(gapCounts: Map<number, number>): { cellSize: number; confidence: number } {
    if (gapCounts.size === 0) return { cellSize: 1, confidence: 0 };

    // Sort by frequency
    const sorted = [...gapCounts.entries()]
      .map(([gap, count]) => ({ gap, count }))
      .sort((a, b) => b.count - a.count);

    // Find the peak gap
    const peakGap = sorted[0].gap;

    // Cluster: include gaps within ±2 of the peak (accounts for sub-pixel variance)
    let weightedSum = 0;
    let weightTotal = 0;
    let clusterCount = 0;

    for (const { gap, count } of sorted) {
      if (Math.abs(gap - peakGap) <= 2) {
        weightedSum += gap * count;
        weightTotal += count;
        clusterCount += count;
      }
    }

    const cellSize = weightTotal > 0 ? weightedSum / weightTotal : peakGap;

    // Confidence: what fraction of all detected gaps fall in the peak cluster
    const totalGaps = sorted.reduce((sum, s) => sum + s.count, 0);
    const confidence = totalGaps > 0 ? clusterCount / totalGaps : 0;

    return { cellSize, confidence };
  }

  const hGaps = analyzeEdgeGaps(true);
  const vGaps = analyzeEdgeGaps(false);

  const hResult = findBestCellSize(hGaps);
  const vResult = findBestCellSize(vGaps);

  // Average H and V cell sizes (they should be equal for square pixels)
  const avgCellSize = (hResult.cellSize + vResult.cellSize) / 2;
  const avgConfidence = (hResult.confidence + vResult.confidence) / 2;

  const gridCols = Math.round(width / avgCellSize);
  const gridRows = Math.round(height / avgCellSize);
  const recommendedMaxDimension = Math.max(gridCols, gridRows);

  return {
    cellSize: Math.round(avgCellSize * 10) / 10,
    cellSizeH: Math.round(hResult.cellSize * 10) / 10,
    cellSizeV: Math.round(vResult.cellSize * 10) / 10,
    recommendedMaxDimension,
    gridCols,
    gridRows,
    confidence: Math.round(avgConfidence * 100) / 100,
  };
}
