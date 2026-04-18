/**
 * Upscale a .pindou project to 2x using pixel art algorithms.
 *
 * Strategies:
 *   naive   — Simple 2x2 block duplication (default)
 *   scale2x — EPX/Scale2x pixel art algorithm (smoother diagonals)
 *
 * Usage:
 *   node scripts/upscale.mjs <input.pindou> [naive|scale2x]
 *
 * Output: <input>_<W>x<H>_<strategy>.pindou in the same directory.
 */
import { readFileSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";

const srcPath = process.argv[2];
const strategy = process.argv[3] || "naive";

if (!srcPath) {
  console.error("Usage: node scripts/upscale.mjs <file.pindou> [naive|scale2x]");
  process.exit(1);
}
if (!["naive", "scale2x"].includes(strategy)) {
  console.error(`Unknown strategy "${strategy}". Use "naive" or "scale2x".`);
  process.exit(1);
}

const project = JSON.parse(readFileSync(srcPath, "utf-8"));
const { width: W, height: H } = project.canvasSize;
const src = project.canvasData;

function ci(r, c) {
  if (r < 0 || r >= H || c < 0 || c >= W) return null;
  return src[r][c].colorIndex;
}

function emptyGrid(w, h) {
  return Array.from({ length: h }, () =>
    Array.from({ length: w }, () => ({ colorIndex: null }))
  );
}

function naive() {
  const out = emptyGrid(W * 2, H * 2);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const v = ci(r, c);
      out[r * 2][c * 2].colorIndex = v;
      out[r * 2][c * 2 + 1].colorIndex = v;
      out[r * 2 + 1][c * 2].colorIndex = v;
      out[r * 2 + 1][c * 2 + 1].colorIndex = v;
    }
  }
  return out;
}

function scale2x() {
  const out = emptyGrid(W * 2, H * 2);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const P = ci(r, c);
      const A = ci(r - 1, c);
      const B = ci(r, c + 1);
      const C = ci(r, c - 1);
      const D = ci(r + 1, c);

      let p1 = P, p2 = P, p3 = P, p4 = P;
      if (C === A && C !== D && A !== B) p1 = A;
      if (A === B && A !== C && B !== D) p2 = B;
      if (D === C && D !== B && C !== A) p3 = C;
      if (B === D && B !== A && D !== C) p4 = D;

      out[r * 2][c * 2].colorIndex = p1;
      out[r * 2][c * 2 + 1].colorIndex = p2;
      out[r * 2 + 1][c * 2].colorIndex = p3;
      out[r * 2 + 1][c * 2 + 1].colorIndex = p4;
    }
  }
  return out;
}

const data = strategy === "scale2x" ? scale2x() : naive();
const outW = W * 2;
const outH = H * 2;

const outPath = join(dirname(srcPath), `${basename(srcPath, ".pindou")}_${outW}x${outH}_${strategy}.pindou`);
const outProject = {
  version: 1,
  canvasSize: { width: outW, height: outH },
  canvasData: data,
  gridConfig: project.gridConfig ? { ...project.gridConfig, groupSize: (project.gridConfig.groupSize || 5) * 2 } : undefined,
  projectInfo: project.projectInfo,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
writeFileSync(outPath, JSON.stringify(outProject, null, 2));
console.log(`✓ ${outPath} (${outW}x${outH}, ${strategy})`);
