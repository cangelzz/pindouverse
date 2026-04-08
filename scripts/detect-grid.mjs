/**
 * Pixel art grid detector — auto-detect optimal maxDimension
 *
 * For pixel art images, detects the underlying grid cell size
 * by analyzing the autocorrelation of pixel differences.
 *
 * Usage: node detect-grid.mjs <image_path>
 */

import { execSync } from "child_process";

const BATCH_BIN = "/root/tmp/pindou-batch/target/release/pindou-batch";

const imagePath = process.argv[2];
if (!imagePath) {
  console.error("Usage: node detect-grid.mjs <image_path>");
  process.exit(1);
}

// Load image at full resolution (use a large maxDimension to get near-original)
const stdout = execSync(`${BATCH_BIN} "${imagePath}" 2000 true`, {
  maxBuffer: 100 * 1024 * 1024,
}).toString();
const { width, height, pixels } = JSON.parse(stdout);

console.log(`Image size: ${width}x${height}`);

// Get pixel at (x, y)
function getPixel(x, y) {
  const i = (y * width + x) * 3;
  return [pixels[i], pixels[i + 1], pixels[i + 2]];
}

// Color distance
function colorDist(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

/**
 * Autocorrelation method:
 * For each shift N (1..maxShift), compute how many pixels are identical
 * to the pixel N positions away. In pixel art, shift = cellSize gives
 * maximum similarity (pixels repeat every cellSize).
 */
function detectCellSize(horizontal = true) {
  const maxShift = Math.min(40, Math.floor((horizontal ? width : height) / 4));
  const scores = [];

  for (let shift = 1; shift <= maxShift; shift++) {
    let matches = 0;
    let total = 0;

    // Sample rows/columns
    const outerLimit = horizontal ? height : width;
    const innerLimit = (horizontal ? width : height) - shift;
    const step = Math.max(1, Math.floor(outerLimit / 100)); // sample up to 100 lines

    for (let outer = 0; outer < outerLimit; outer += step) {
      for (let inner = 0; inner < innerLimit; inner++) {
        const x1 = horizontal ? inner : outer;
        const y1 = horizontal ? outer : inner;
        const x2 = horizontal ? inner + shift : outer;
        const y2 = horizontal ? outer : inner + shift;

        const p1 = getPixel(x1, y1);
        const p2 = getPixel(x2, y2);

        if (colorDist(p1, p2) < 10) {
          matches++;
        }
        total++;
      }
    }

    const score = matches / total;
    scores.push({ shift, score });
  }

  // Find peaks: shifts where score is a local maximum
  // The first significant peak after shift=1 is likely the cell size
  const peaks = [];
  for (let i = 1; i < scores.length - 1; i++) {
    const s = scores[i];
    if (s.score > scores[i - 1].score && s.score > scores[i + 1].score && s.score > 0.5) {
      peaks.push(s);
    }
  }

  // Also check: the cell size should divide evenly into dimensions
  // Look for the strongest peak
  peaks.sort((a, b) => b.score - a.score);

  return { scores, peaks };
}

/**
 * Differential method:
 * Count color changes per row/column position.
 * In pixel art, changes happen at cell boundaries → periodic pattern.
 */
function detectByDifferential(horizontal = true) {
  const dim = horizontal ? width : height;
  const otherDim = horizontal ? height : width;
  const step = Math.max(1, Math.floor(otherDim / 100));

  // For each position, count how many lines have a color change
  const changeCount = new Array(dim).fill(0);
  let linesSampled = 0;

  for (let outer = 0; outer < otherDim; outer += step) {
    linesSampled++;
    for (let inner = 1; inner < dim; inner++) {
      const x1 = horizontal ? inner - 1 : outer;
      const y1 = horizontal ? outer : inner - 1;
      const x2 = horizontal ? inner : outer;
      const y2 = horizontal ? outer : inner;

      if (colorDist(getPixel(x1, y1), getPixel(x2, y2)) > 10) {
        changeCount[inner]++;
      }
    }
  }

  // Normalize
  const normalized = changeCount.map((c) => c / linesSampled);

  // Find periodicity: compute autocorrelation of the change signal
  const maxLag = Math.min(40, Math.floor(dim / 4));
  const lagScores = [];

  for (let lag = 2; lag <= maxLag; lag++) {
    let score = 0;
    let count = 0;
    for (let i = 0; i < dim - lag; i++) {
      score += normalized[i] * normalized[i + lag];
      count++;
    }
    lagScores.push({ lag, score: score / count });
  }

  // Find the lag with strongest periodicity
  lagScores.sort((a, b) => b.score - a.score);

  return { changeCount: normalized, lagScores };
}

// Run both methods
console.log("\n=== Autocorrelation Method ===");
const hAuto = detectCellSize(true);
const vAuto = detectCellSize(false);
console.log("Horizontal peaks:", hAuto.peaks.slice(0, 5).map(p => `shift=${p.shift} score=${p.score.toFixed(3)}`));
console.log("Vertical peaks:", vAuto.peaks.slice(0, 5).map(p => `shift=${p.shift} score=${p.score.toFixed(3)}`));

console.log("\n=== Differential Method ===");
const hDiff = detectByDifferential(true);
const vDiff = detectByDifferential(false);
console.log("Horizontal top lags:", hDiff.lagScores.slice(0, 5).map(l => `lag=${l.lag} score=${l.score.toFixed(4)}`));
console.log("Vertical top lags:", vDiff.lagScores.slice(0, 5).map(l => `lag=${l.lag} score=${l.score.toFixed(4)}`));

// Best estimate: first autocorrelation peak (most reliable for pixel art)
const bestH = hAuto.peaks[0]?.shift || hDiff.lagScores[0]?.lag || 1;
const bestV = vAuto.peaks[0]?.shift || vDiff.lagScores[0]?.lag || 1;
const cellSize = Math.round((bestH + bestV) / 2);

const optimalW = Math.round(width / cellSize);
const optimalH = Math.round(height / cellSize);
const optimalMaxDim = Math.max(optimalW, optimalH);

console.log(`\n=== Result ===`);
console.log(`Detected cell size: ${cellSize}px (H=${bestH}, V=${bestV})`);
console.log(`Optimal grid: ${optimalW} x ${optimalH}`);
console.log(`Recommended maxDimension: ${optimalMaxDim}`);
