/**
 * pindou batch preview — color matching + HTML gallery generator
 *
 * Uses the EXACT same colorMatching + mard221 data from the pindou project.
 * Rust binary handles image resize (same as Tauri import_image).
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { join, basename } from "path";

// ── Import pindou's own color data & matching logic ──

// We need to transpile the TS files, so let's inline the essentials
// directly from the source to guarantee identical results.

// Load MARD colors from the project source
const mardSource = readFileSync(
  join(import.meta.dirname, "../src/data/mard221.ts"),
  "utf8"
);
// Extract the array literal
const arrayMatch = mardSource.match(
  /export const MARD_COLORS[^=]*=\s*(\[[\s\S]*\]);/
);
if (!arrayMatch) throw new Error("Cannot parse MARD_COLORS");
// Evaluate it (safe: it's our own source)
const MARD_COLORS = new Function(`return ${arrayMatch[1]}`)();

// ── Color conversion (from src/utils/colorConversion.ts) ──

function linearize(c) {
  const v = c / 255;
  return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
}
function labF(t) {
  const delta = 6 / 29;
  return t > delta ** 3 ? Math.cbrt(t) : t / (3 * delta * delta) + 4 / 29;
}
const XN = 0.95047, YN = 1.0, ZN = 1.08883;

function rgbToLab(r, g, b) {
  const rLin = linearize(r), gLin = linearize(g), bLin = linearize(b);
  const x = 0.4124564 * rLin + 0.3575761 * gLin + 0.1804375 * bLin;
  const y = 0.2126729 * rLin + 0.7151522 * gLin + 0.0721750 * bLin;
  const z = 0.0193339 * rLin + 0.1191920 * gLin + 0.9503041 * bLin;
  return [116 * labF(y / YN) - 16, 500 * (labF(x / XN) - labF(y / YN)), 200 * (labF(y / YN) - labF(z / ZN))];
}
function deltaE76(lab1, lab2) {
  return Math.sqrt((lab1[0]-lab2[0])**2 + (lab1[1]-lab2[1])**2 + (lab1[2]-lab2[2])**2);
}
function euclideanRGB(a, b) {
  return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
}

// ── Pre-compute Lab cache (same as colorMatching.ts) ──
const labCache = MARD_COLORS.map(c => c.rgb ? rgbToLab(c.rgb[0], c.rgb[1], c.rgb[2]) : [0,0,0]);

function findClosestColor(r, g, b, algorithm) {
  let minDist = Infinity, minIndex = 0;
  if (algorithm === "euclidean") {
    for (let i = 0; i < MARD_COLORS.length; i++) {
      if (!MARD_COLORS[i].rgb) continue;
      const d = euclideanRGB([r,g,b], MARD_COLORS[i].rgb);
      if (d < minDist) { minDist = d; minIndex = i; }
    }
  } else {
    const inputLab = rgbToLab(r, g, b);
    for (let i = 0; i < labCache.length; i++) {
      if (!MARD_COLORS[i].rgb) continue;
      const d = deltaE76(inputLab, labCache[i]);
      if (d < minDist) { minDist = d; minIndex = i; }
    }
  }
  return minIndex;
}

// ── Main ──

const BATCH_BIN = "/root/tmp/pindou-batch/target/release/pindou-batch";
const OUTPUT_DIR = "/root/tmp/xhs_server/pindou-preview";
const ALGORITHMS = ["ciede2000", "euclidean"];

// ── Grid detection (same logic as src/utils/gridDetect.ts) ──

function detectGrid(pixels, width, height) {
  const threshold = 30, minCell = 4, maxCell = Math.floor(Math.min(width, height) / 4);

  function getPixel(x, y) { const i = (y * width + x) * 3; return [pixels[i], pixels[i+1], pixels[i+2]]; }
  function colorDist(a, b) { return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2); }

  function analyzeEdgeGaps(horizontal) {
    const gapCounts = new Map();
    const outerDim = horizontal ? height : width;
    const innerDim = horizontal ? width : height;
    const step = Math.max(1, Math.floor(outerDim / 80));
    for (let outer = 0; outer < outerDim; outer += step) {
      let lastChange = 0;
      for (let inner = 1; inner < innerDim; inner++) {
        const x1 = horizontal ? inner - 1 : outer, y1 = horizontal ? outer : inner - 1;
        const x2 = horizontal ? inner : outer, y2 = horizontal ? outer : inner;
        if (colorDist(getPixel(x1, y1), getPixel(x2, y2)) > threshold) {
          const gap = inner - lastChange;
          if (gap >= minCell && gap <= maxCell) gapCounts.set(gap, (gapCounts.get(gap) || 0) + 1);
          lastChange = inner;
        }
      }
    }
    return gapCounts;
  }

  function findBestCellSize(gapCounts) {
    if (gapCounts.size === 0) return { cellSize: 1, confidence: 0 };
    const sorted = [...gapCounts.entries()].map(([gap, count]) => ({gap, count})).sort((a, b) => b.count - a.count);
    const peakGap = sorted[0].gap;
    let weightedSum = 0, weightTotal = 0, clusterCount = 0;
    for (const { gap, count } of sorted) {
      if (Math.abs(gap - peakGap) <= 2) { weightedSum += gap * count; weightTotal += count; clusterCount += count; }
    }
    const cellSize = weightTotal > 0 ? weightedSum / weightTotal : peakGap;
    const totalGaps = sorted.reduce((sum, s) => sum + s.count, 0);
    return { cellSize, confidence: totalGaps > 0 ? clusterCount / totalGaps : 0 };
  }

  const hResult = findBestCellSize(analyzeEdgeGaps(true));
  const vResult = findBestCellSize(analyzeEdgeGaps(false));
  const avgCell = (hResult.cellSize + vResult.cellSize) / 2;
  const gridCols = Math.round(width / avgCell), gridRows = Math.round(height / avgCell);
  return {
    cellSize: Math.round(avgCell * 10) / 10,
    recommendedMaxDimension: Math.max(gridCols, gridRows),
    gridCols, gridRows,
    confidence: (hResult.confidence + vResult.confidence) / 2,
  };
}

// Parse args
const images = process.argv.slice(2);
if (images.length === 0) {
  console.error("Usage: node batch-preview.mjs <image1> [image2] ...");
  console.error("  Options via env: MAX_DIMS=26,52,78  SHARP=true,false  ALGOS=ciede2000,euclidean");
  console.error("  Set MAX_DIMS=auto to auto-detect pixel art grid size");
  process.exit(1);
}

const autoDetect = (process.env.MAX_DIMS || "") === "auto";
let maxDims = autoDetect ? [] : (process.env.MAX_DIMS || "26,52,78").split(",").map(Number);
const sharpModes = (process.env.SHARP || "true,false").split(",").map(s => s === "true");
const algos = (process.env.ALGOS || "ciede2000,euclidean").split(",");

mkdirSync(OUTPUT_DIR, { recursive: true });

const previews = [];

for (const imagePath of images) {
  const imgName = basename(imagePath).replace(/\.[^.]+$/, "");

  // Auto-detect grid if requested
  if (autoDetect) {
    const fullStdout = execSync(`${BATCH_BIN} "${imagePath}" 2000 true`, { maxBuffer: 100 * 1024 * 1024 }).toString();
    const full = JSON.parse(fullStdout);
    const detected = detectGrid(full.pixels, full.width, full.height);
    const rec = detected.recommendedMaxDimension;
    console.error(`\n🔍 ${imgName}: detected cell≈${detected.cellSize}px → recommended maxDim=${rec} (confidence ${Math.round(detected.confidence * 100)}%)`);
    // Generate range around detected value: rec-3 to rec+3
    maxDims = [];
    for (let d = Math.max(8, rec - 3); d <= rec + 3; d++) maxDims.push(d);
    console.error(`   Generating: ${maxDims.join(", ")}`);
  }

  for (const maxDim of maxDims) {
    for (const sharp of sharpModes) {
      // Call Rust binary for resize
      const cmd = `${BATCH_BIN} "${imagePath}" ${maxDim} ${sharp}`;
      let result;
      try {
        const stdout = execSync(cmd, { maxBuffer: 50 * 1024 * 1024 }).toString();
        result = JSON.parse(stdout);
      } catch (e) {
        console.error(`FAIL: ${cmd}`, e.message);
        continue;
      }

      const { width, height, pixels } = result;

      for (const algo of algos) {
        // Color matching (same as pindou app)
        const matched = [];
        const cache = new Map();
        for (let i = 0; i < pixels.length; i += 3) {
          const key = `${pixels[i]},${pixels[i+1]},${pixels[i+2]}`;
          let idx = cache.get(key);
          if (idx === undefined) {
            idx = findClosestColor(pixels[i], pixels[i+1], pixels[i+2], algo);
            cache.set(key, idx);
          }
          matched.push(idx);
        }

        // Generate pixel preview as inline SVG-like HTML table
        const cellPx = Math.max(2, Math.min(12, Math.floor(400 / Math.max(width, height))));
        let cells = "";
        for (let row = 0; row < height; row++) {
          cells += "<tr>";
          for (let col = 0; col < width; col++) {
            const ci = matched[row * width + col];
            const hex = MARD_COLORS[ci]?.hex || "#FFF";
            cells += `<td style="width:${cellPx}px;height:${cellPx}px;background:${hex}"></td>`;
          }
          cells += "</tr>";
        }

        const id = `${imgName}_d${maxDim}_${sharp?"sharp":"smooth"}_${algo}`;
        const label = `${maxDim}px | ${sharp?"锐利":"平滑"} | ${algo === "ciede2000" ? "CIELAB ΔE" : "Euclidean"}`;

        previews.push({ id, label, width, height, cells, imgName, maxDim, sharp, algo });
        console.error(`✓ ${id} (${width}x${height})`);
      }
    }
  }
}

// ── Generate HTML gallery ──

const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>拼豆批量预览 🦊</title>
<style>
  body { font-family: "Noto Sans CJK SC", Arial, sans-serif; background: #1a1a1a; color: #eee; padding: 20px; }
  h1 { text-align: center; color: #ff6b6b; }
  .grid { display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; }
  .card { background: #2a2a2a; border-radius: 12px; padding: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
  .card h3 { font-size: 12px; color: #aaa; margin: 0 0 8px; }
  .card .size { font-size: 10px; color: #666; }
  table { border-collapse: collapse; image-rendering: pixelated; }
  td { padding: 0; margin: 0; }
  .filters { text-align: center; margin: 20px 0; }
  .filters button { background: #333; color: #ccc; border: 1px solid #555; padding: 6px 12px; margin: 4px; border-radius: 6px; cursor: pointer; font-size: 12px; }
  .filters button.active { background: #ff6b6b; color: #fff; border-color: #ff6b6b; }
</style>
</head>
<body>
<h1>🧩 拼豆批量预览</h1>
<p style="text-align:center;color:#666;font-size:12px;">${previews.length} 种组合 | ${images.map(i => basename(i)).join(", ")}</p>
<div class="grid">
${previews.map(p => `
<div class="card" data-dim="${p.maxDim}" data-sharp="${p.sharp}" data-algo="${p.algo}">
  <h3>${p.label}</h3>
  <table>${p.cells}</table>
  <p class="size">${p.width}×${p.height}</p>
</div>
`).join("")}
</div>
</body>
</html>`;

writeFileSync(join(OUTPUT_DIR, "index.html"), html);
console.error(`\n🦊 Gallery: http://localhost:8899/pindou-preview/`);
