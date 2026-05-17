// Icon candidates preview — open in browser to compare 6 header designs.
// Each option renders the same header strip + watermark with a different icon treatment.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const iconB64 = fs.readFileSync(path.join(root, "app-icon.png")).toString("base64");
const iconDataUrl = `data:image/png;base64,${iconB64}`;

const html = String.raw`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Icon Candidates</title>
<style>
  body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; background:#f5f5f5; margin:0; padding:24px; }
  h1 { font-size:18px; margin:0 0 16px; }
  .card { background:#fff; border:1px solid #ddd; border-radius:8px; padding:12px; margin-bottom:12px; max-width:760px; }
  .card h3 { margin:0 0 8px; font-size:13px; color:#333; }
  .card .desc { margin:0 0 6px; font-size:11px; color:#777; }
  canvas { display:block; border:1px solid #eee; max-width:100%; height:auto; }
</style>
</head>
<body>
<h1>Header icon candidates (rendered at cellSize=30, header=60px)</h1>

<div id="grid"></div>

<script>
const ICON_URL = ${JSON.stringify(iconDataUrl)};
const CS = 30;
const HEADER_H = 2 * CS;            // 60
const STRIP_W = 600;
const TEXT = "PindouVerse";
const PINDOU_BLUE = "#3B82F6";
const PINDOU_ORANGE = "#F97316";
const PINDOU_GRAY = "#94A3B8";

function drawHeaderBase(ctx, w, h) {
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, w, h);
}

function drawHeaderText(ctx, x, y, h, weight) {
  const fontSize = h * 0.4;
  ctx.fillStyle = "#1F2937";
  ctx.font = (weight || 600) + " " + fontSize + "px -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(TEXT, x, y);
}

function drawSeparator(ctx, w, h) {
  ctx.strokeStyle = "#E5E7EB";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h - 0.5);
  ctx.lineTo(w, h - 0.5);
  ctx.stroke();
}

// Helper to draw a single bead (filled circle + small white center highlight)
function drawBead(ctx, cx, cy, r, color) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  // small dark inner ring (the pindou "hole")
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fill();
}

// === Variants ===

function variantA_originalIcon(ctx, iconImg) {
  // Original: scaled icon at 0.65 of header height (currently in code)
  drawHeaderBase(ctx, STRIP_W, HEADER_H);
  const pad = CS / 4;
  const size = Math.round(HEADER_H * 0.65);
  const y = Math.round((HEADER_H - size) / 2);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(iconImg, pad, y, size, size);
  drawHeaderText(ctx, pad + size + pad, HEADER_H / 2, HEADER_H);
  drawSeparator(ctx, STRIP_W, HEADER_H);
}

function variantB_iconCircleClip(ctx, iconImg) {
  // Original icon clipped to a circle (removes the dark rounded-rect corners)
  drawHeaderBase(ctx, STRIP_W, HEADER_H);
  const pad = CS / 4;
  const size = Math.round(HEADER_H * 0.7);
  const y = Math.round((HEADER_H - size) / 2);
  ctx.save();
  ctx.beginPath();
  ctx.arc(pad + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(iconImg, pad, y, size, size);
  ctx.restore();
  drawHeaderText(ctx, pad + size + pad, HEADER_H / 2, HEADER_H);
  drawSeparator(ctx, STRIP_W, HEADER_H);
}

function variantC_fourBeads(ctx) {
  // Procedural: 2x2 beads (2 blue top, 2 orange bottom)
  drawHeaderBase(ctx, STRIP_W, HEADER_H);
  const pad = CS / 4;
  const size = Math.round(HEADER_H * 0.65);
  const y0 = Math.round((HEADER_H - size) / 2);
  const beadR = size / 4 - 1.5;
  const colors = [
    [PINDOU_BLUE, PINDOU_BLUE],
    [PINDOU_ORANGE, PINDOU_ORANGE],
  ];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      const cx = pad + size * (0.27 + 0.46 * c);
      const cy = y0 + size * (0.27 + 0.46 * r);
      drawBead(ctx, cx, cy, beadR, colors[r][c]);
    }
  }
  drawHeaderText(ctx, pad + size + pad, HEADER_H / 2, HEADER_H);
  drawSeparator(ctx, STRIP_W, HEADER_H);
}

function variantD_fourBeadsMix(ctx) {
  // Procedural: 2x2 with diagonal blue/orange pattern
  drawHeaderBase(ctx, STRIP_W, HEADER_H);
  const pad = CS / 4;
  const size = Math.round(HEADER_H * 0.65);
  const y0 = Math.round((HEADER_H - size) / 2);
  const beadR = size / 4 - 1.5;
  const colors = [
    [PINDOU_BLUE, PINDOU_GRAY],
    [PINDOU_GRAY, PINDOU_ORANGE],
  ];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      const cx = pad + size * (0.27 + 0.46 * c);
      const cy = y0 + size * (0.27 + 0.46 * r);
      drawBead(ctx, cx, cy, beadR, colors[r][c]);
    }
  }
  drawHeaderText(ctx, pad + size + pad, HEADER_H / 2, HEADER_H);
  drawSeparator(ctx, STRIP_W, HEADER_H);
}

function variantE_singleBead(ctx) {
  // Single large bead — clean and bold
  drawHeaderBase(ctx, STRIP_W, HEADER_H);
  const pad = CS / 4;
  const size = Math.round(HEADER_H * 0.7);
  const cx = pad + size / 2;
  const cy = HEADER_H / 2;
  const r = size / 2 - 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = PINDOU_ORANGE;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fill();
  drawHeaderText(ctx, pad + size + pad, HEADER_H / 2, HEADER_H);
  drawSeparator(ctx, STRIP_W, HEADER_H);
}

function variantF_textOnly(ctx) {
  // No icon, just text
  drawHeaderBase(ctx, STRIP_W, HEADER_H);
  const pad = CS / 4;
  drawHeaderText(ctx, pad, HEADER_H / 2, HEADER_H, 700);
  drawSeparator(ctx, STRIP_W, HEADER_H);
}

function variantG_3x3Beads(ctx) {
  // 3x3 grid of beads — denser, more "pindou-like"
  drawHeaderBase(ctx, STRIP_W, HEADER_H);
  const pad = CS / 4;
  const size = Math.round(HEADER_H * 0.7);
  const y0 = Math.round((HEADER_H - size) / 2);
  const cell = size / 3;
  const beadR = cell * 0.42;
  const palette = [
    PINDOU_BLUE, PINDOU_GRAY, PINDOU_ORANGE,
    PINDOU_GRAY, PINDOU_ORANGE, PINDOU_BLUE,
    PINDOU_ORANGE, PINDOU_BLUE, PINDOU_GRAY,
  ];
  for (let i = 0; i < 9; i++) {
    const r = Math.floor(i / 3);
    const c = i % 3;
    const cx = pad + (c + 0.5) * cell;
    const cy = y0 + (r + 0.5) * cell;
    drawBead(ctx, cx, cy, beadR, palette[i]);
  }
  drawHeaderText(ctx, pad + size + pad, HEADER_H / 2, HEADER_H);
  drawSeparator(ctx, STRIP_W, HEADER_H);
}

// === Render all variants ===

const variants = [
  { id: "A", title: "A. 原始 icon（当前方案）", desc: "缩到 65%，居中。问题：黑底缝隙看起来像栅格。", draw: variantA_originalIcon, needsIcon: true },
  { id: "B", title: "B. 原始 icon + 圆形蒙版", desc: "用圆形 clip 切掉黑色圆角，只显示中间的拼豆图案。", draw: variantB_iconCircleClip, needsIcon: true },
  { id: "C", title: "C. 4 颗拼豆（2x2，纯蓝+橙）", desc: "代码绘制，两颗蓝在上，两颗橙在下。", draw: variantC_fourBeads, needsIcon: false },
  { id: "D", title: "D. 4 颗拼豆（对角蓝橙+灰）", desc: "代码绘制，蓝橙对角，灰色填充另两个。", draw: variantD_fourBeadsMix, needsIcon: false },
  { id: "E", title: "E. 单颗大拼豆", desc: "代码绘制一颗大橙色拼豆，最简洁。", draw: variantE_singleBead, needsIcon: false },
  { id: "F", title: "F. 纯文字（无 icon）", desc: "去掉 icon，只显示 PindouVerse。最保守。", draw: variantF_textOnly, needsIcon: false },
  { id: "G", title: "G. 3x3 拼豆色块", desc: "9 颗拼豆三色循环排列，最'拼豆'。", draw: variantG_3x3Beads, needsIcon: false },
];

const grid = document.getElementById("grid");
const iconImg = new Image();
iconImg.onload = () => {
  for (const v of variants) {
    const card = document.createElement("div");
    card.className = "card";
    const h = document.createElement("h3");
    h.textContent = v.title;
    const desc = document.createElement("p");
    desc.className = "desc";
    desc.textContent = v.desc;
    const cv = document.createElement("canvas");
    cv.width = STRIP_W;
    cv.height = HEADER_H + 2;
    const ctx = cv.getContext("2d");
    v.draw(ctx, iconImg);
    card.appendChild(h);
    card.appendChild(desc);
    card.appendChild(cv);
    grid.appendChild(card);
  }
};
iconImg.src = ICON_URL;
</script>
</body>
</html>`;

const outPath = path.join(root, "temp", "icon-candidates.html");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);
console.log("Wrote", outPath);
