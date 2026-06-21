/**
 * Post-process a .pindou file to reduce similar colors.
 * Input: already matched .pindou file from the app.
 *
 * Usage: node scripts/simplify-colors.mjs <input.pindou>
 */
import { readFileSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";

// ── Load MARD palette ──
const paletteSource = readFileSync("src/data/mard221.ts", "utf-8");
const COLORS = [];
for (const m of paletteSource.matchAll(/hex:\s*"([^"]+)".*?rgb:\s*\[(\d+),\s*(\d+),\s*(\d+)\]/g)) {
  COLORS.push({ hex: m[1], r: +m[2], g: +m[3], b: +m[4] });
}

function dist(a, b) {
  if (a === null || b === null) return 999;
  return Math.sqrt((COLORS[a].r - COLORS[b].r) ** 2 + (COLORS[a].g - COLORS[b].g) ** 2 + (COLORS[a].b - COLORS[b].b) ** 2);
}

// ── Load .pindou ──
const srcPath = process.argv[2];
if (!srcPath) { console.error("Usage: node scripts/simplify-colors.mjs <file.pindou>"); process.exit(1); }
const project = JSON.parse(readFileSync(srcPath, "utf-8"));
const W = project.canvasSize.width, H = project.canvasSize.height;

// Flatten to 1D array
const flat = new Array(W * H);
for (let r = 0; r < H; r++)
  for (let c = 0; c < W; c++)
    flat[r * W + c] = project.canvasData[r][c].colorIndex;

console.log(`Loaded ${W}x${H}, ${new Set(flat).size} unique colors`);

// ═══════════════════════════════════════════════════════
// Edge detection: pixel is "edge" if it has neighbors
// with high color contrast (it sits on a boundary)
// ═══════════════════════════════════════════════════════
function buildEdgeMap(arr, contrastThresh) {
  const edges = new Uint8Array(W * H);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const me = arr[r * W + c];
      if (me === null) continue;
      let maxD = 0;
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
        const nb = arr[nr * W + nc];
        if (nb === null) continue;
        const d = dist(me, nb);
        if (d > maxD) maxD = d;
      }
      if (maxD > contrastThresh) edges[r * W + c] = 1;
    }
  }
  return edges;
}

// ═══════════════════════════════════════════════════════
// Pass 1: Region unification — ONLY on non-edge pixels
// ═══════════════════════════════════════════════════════
function regionUnify(arr, edges, radius, dominance, maxDist) {
  const result = [...arr];
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const i = r * W + c;
      if (edges[i]) continue; // protect edge pixels
      const me = arr[i];
      if (me === null) continue;
      const counts = new Map();
      let total = 0;
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
          const ci = arr[nr * W + nc];
          if (ci === null) continue;
          counts.set(ci, (counts.get(ci) || 0) + 1);
          total++;
        }
      }
      let domCI = me, domCnt = 0;
      for (const [ci, cnt] of counts) {
        if (cnt > domCnt) { domCnt = cnt; domCI = ci; }
      }
      if (domCnt / total >= dominance && me !== domCI && dist(me, domCI) < maxDist) {
        result[r * W + c] = domCI;
      }
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════
// Pass 2: Line/edge color unification
// Scan H and V lines of similar dark/edge pixels, unify to
// the most common color in the run.
// ═══════════════════════════════════════════════════════
function unifyLines(arr, minLen, mergeDist) {
  const result = [...arr];

  function processRun(positions) {
    if (positions.length < minLen) return;
    const counts = new Map();
    for (const p of positions) counts.set(result[p], (counts.get(result[p]) || 0) + 1);
    let domCI = result[positions[0]], domCnt = 0;
    for (const [ci, cnt] of counts) { if (cnt > domCnt) { domCnt = cnt; domCI = ci; } }
    for (const p of positions) {
      if (result[p] !== domCI && dist(result[p], domCI) < mergeDist) {
        result[p] = domCI;
      }
    }
  }

  // Horizontal runs of similar colors
  for (let r = 0; r < H; r++) {
    let run = [r * W];
    for (let c = 1; c < W; c++) {
      const i = r * W + c;
      const prev = result[run[run.length - 1]];
      if (prev !== null && result[i] !== null && dist(prev, result[i]) < mergeDist) {
        run.push(i);
      } else {
        processRun(run);
        run = [i];
      }
    }
    processRun(run);
  }

  // Vertical runs
  for (let c = 0; c < W; c++) {
    let run = [c];
    for (let r = 1; r < H; r++) {
      const i = r * W + c;
      const prev = result[run[run.length - 1]];
      if (prev !== null && result[i] !== null && dist(prev, result[i]) < mergeDist) {
        run.push(i);
      } else {
        processRun(run);
        run = [i];
      }
    }
    processRun(run);
  }

  return result;
}

// ═══════════════════════════════════════════════════════
// Pass 3: Isolated pixel removal
// Replace pixels that have fewer than minSame identical
// neighbors with the neighborhood's most common color.
// ═══════════════════════════════════════════════════════
function removeIsolated(arr, radius, minSame) {
  const result = [...arr];
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const me = arr[r * W + c];
      if (me === null) continue;
      const counts = new Map();
      let same = 0;
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
          const ci = arr[nr * W + nc];
          if (ci === null) continue;
          counts.set(ci, (counts.get(ci) || 0) + 1);
          if (ci === me) same++;
        }
      }
      if (same < minSame) {
        let best = me, bestCnt = 0;
        for (const [ci, cnt] of counts) { if (cnt > bestCnt) { bestCnt = cnt; best = ci; } }
        result[r * W + c] = best;
      }
    }
  }
  return result;
}

// ── Output ──
function save(name, desc, arr) {
  const unique = new Set(arr).size;
  const canvasData = [];
  for (let r = 0; r < H; r++) {
    const row = [];
    for (let c = 0; c < W; c++) row.push({ colorIndex: arr[r * W + c] });
    canvasData.push(row);
  }
  const out = { ...project, canvasData, projectInfo: { ...project.projectInfo, title: desc } };
  const outPath = join(dirname(srcPath), `${basename(srcPath, ".pindou")}_${name}.pindou`);
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`✓ ${name} (${unique} colors) — ${desc}`);
}

// ── Variants ──

// Build edge map (contrast > 50 = outline/boundary pixel, protected)
const edges = buildEdgeMap(flat, 50);
const edgeCount = edges.reduce((a, b) => a + b, 0);
console.log(`Edge pixels: ${edgeCount} (${(edgeCount / (W * H) * 100).toFixed(1)}%)`);

// v0: no change
save("v0", "原始（无处理）", flat);

// v1: gentle — small region unify (edge-protected) + denoise
let v1 = regionUnify(flat, edges, 2, 0.55, 40);
v1 = removeIsolated(v1, 1, 2);
save("v1_gentle", "轻度：5x5区域统一（保护轮廓） + 去噪", v1);

// v2: medium — region + line unify + denoise
let v2 = regionUnify(flat, edges, 2, 0.5, 45);
v2 = unifyLines(v2, 3, 35);
v2 = removeIsolated(v2, 1, 2);
save("v2_medium", "中度：区域（保护轮廓） + 线条统一 + 去噪", v2);

// v3: strong — multi-pass region + line + denoise
const edges3 = buildEdgeMap(flat, 40); // slightly more sensitive edge detection
let v3 = regionUnify(flat, edges3, 3, 0.4, 45);
v3 = regionUnify(v3, edges3, 2, 0.5, 40);
v3 = unifyLines(v3, 2, 40);
v3 = removeIsolated(v3, 1, 2);
save("v3_strong", "强：多轮区域（灵敏轮廓保护） + 线条 + 去噪", v3);

// v4: aggressive — but still protect edges
let v4 = regionUnify(flat, edges, 3, 0.35, 50);
v4 = regionUnify(v4, edges, 2, 0.45, 45);
v4 = unifyLines(v4, 2, 45);
v4 = removeIsolated(v4, 2, 3);
v4 = removeIsolated(v4, 1, 2);
save("v4_aggressive", "激进：大范围多轮（保护轮廓） + 线条 + 双重去噪", v4);

console.log("\nDone! Open the .pindou files in PindouVerse to compare.");
