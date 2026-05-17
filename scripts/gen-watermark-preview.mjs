// Generates temp/watermark-preview.html — open in a browser to see 6 variants.
// Uses Canvas 2D primitives identical to the planned blueprintDecorations.ts.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const iconB64 = fs.readFileSync(path.join(root, "app-icon.png")).toString("base64");
const iconDataUrl = `data:image/png;base64,${iconB64}`;

const html = String.raw`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Export Watermark Preview</title>
<style>
  body { font-family: -apple-system, "Segoe UI", sans-serif; background:#f5f5f5; margin:0; padding:24px; }
  h1 { font-size:18px; margin:0 0 16px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .card { background:#fff; border:1px solid #ddd; border-radius:8px; padding:12px; }
  .card h3 { margin:0 0 8px; font-size:13px; color:#333; }
  .card canvas { width:100%; max-width:560px; height:auto; display:block; border:1px solid #eee; }
  .meta { font-size:11px; color:#666; margin-top:6px; }
</style>
</head>
<body>
<h1>Export Watermark — 6 variants (synthetic 36×24 grid, cell=24px)</h1>
<div class="grid" id="grid"></div>

<script>
const ICON_URL = ${JSON.stringify(iconDataUrl)};

// Synthetic palette — looks plausibly pindou-like
const PALETTE = [
  [248,200,200],[244,160,160],[230,120,130],[200,80,100],
  [255,220,150],[250,180,90],[230,140,60],
  [180,220,180],[120,180,140],[70,140,100],
  [180,210,240],[120,170,220],[70,120,180],
  [240,230,210],[200,180,150],[120,100,80],
  [245,245,245],[200,200,200],[80,80,80],[30,30,30],
];

function makeCells(w, h) {
  const cells = [];
  for (let r = 0; r < h; r++) {
    const row = [];
    for (let c = 0; c < w; c++) {
      // create a soft circular pattern + noise
      const dx = c - w/2, dy = r - h/2;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const ring = Math.floor(dist / 3) % PALETTE.length;
      const noise = ((c*31 + r*17) % 7 === 0) ? (ring + 5) % PALETTE.length : ring;
      const [R,G,B] = PALETTE[noise];
      row.push({ r:R, g:G, b:B, code: "M" + String(noise+1).padStart(3,"0") });
    }
    cells.push(row);
  }
  return cells;
}

const W = 36, H = 24, CS = 24;
const cells = makeCells(W, H);

function luminance(r,g,b) { return 0.299*r + 0.587*g + 0.114*b; }

// === The functions below mirror the spec's drawHeader / drawWatermark ===

function computeHeaderHeight(cs, showHeader) {
  return showHeader ? 2*cs : 0;
}

function drawHeader(ctx, opts) {
  const { cs, width, headerH, iconImg, description } = opts;
  // white bg already painted; just bottom separator
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, headerH);

  const pad = cs/4;
  const iconSize = headerH - 2*pad;
  if (iconImg) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(iconImg, pad, pad, iconSize, iconSize);
  }

  const textX = pad + iconSize + pad;
  const fontSize = headerH * 0.4;
  ctx.fillStyle = "#1F2937";
  ctx.font = "bold " + fontSize + "px -apple-system, 'Segoe UI', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const text = description ? "PindouVerse - " + description : "PindouVerse";
  ctx.fillText(text, textX, headerH/2);

  // separator
  ctx.strokeStyle = "#E5E7EB";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, headerH - 0.5);
  ctx.lineTo(width, headerH - 0.5);
  ctx.stroke();
}

function drawWatermark(ctx, opts) {
  const { cs, gridX, gridY, gridW, gridH, lines } = opts;
  if (!lines.length) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(gridX, gridY, gridW, gridH);
  ctx.clip();

  const fontSize = 3 * cs;
  ctx.font = "900 " + fontSize + "px -apple-system, 'Segoe UI', sans-serif";
  ctx.fillStyle = "rgba(120,120,120,0.32)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Rotate around the center of the grid
  const cx = gridX + gridW/2;
  const cy = gridY + gridH/2;
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI/4);

  const diag = Math.sqrt(gridW*gridW + gridH*gridH);
  const lineGap = 6 * cs;  // double the baseline → effectively one blank line between text rows
  const lineCount = Math.max(2, Math.ceil(diag / lineGap));
  // distribute lines centered, staggered horizontally
  for (let i = -Math.floor(lineCount/2); i <= Math.floor(lineCount/2); i++) {
    const text = lines[(((i % lines.length) + lines.length) % lines.length)];
    if (!text) continue;
    const y = i * lineGap;
    const textW = ctx.measureText(text).width;
    const repeatGap = textW * 1.6;
    const reach = diag/2 + textW;
    const stagger = (i % 2 === 0) ? 0 : repeatGap / 2;  // brick pattern
    for (let x = -reach + stagger; x <= reach; x += repeatGap) {
      ctx.fillText(text, x, y);
    }
  }
  ctx.restore();
}

// === Renderer ===

function render(canvas, variant, iconImg) {
  const cs = CS;
  const margin = cs;
  const headerH = computeHeaderHeight(cs, variant.showHeader);
  const gridAreaH = H * cs + margin;
  const cw = W * cs + margin;
  const ch = headerH + gridAreaH;

  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");

  // bg
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0,0,cw,ch);

  // header
  if (variant.showHeader) {
    drawHeader(ctx, { cs, width: cw, headerH, iconImg, description: variant.description });
  }

  // cells
  const gridY0 = headerH + margin;
  const gridX0 = margin;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const cell = cells[r][c];
      ctx.fillStyle = "rgb(" + cell.r + "," + cell.g + "," + cell.b + ")";
      ctx.fillRect(gridX0 + c*cs, gridY0 + r*cs, cs, cs);
    }
  }

  // color codes
  ctx.font = (cs*0.28) + "px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const cell = cells[r][c];
      const lum = luminance(cell.r, cell.g, cell.b);
      ctx.fillStyle = lum > 140 ? "rgba(0,0,0,0.8)" : "rgba(255,255,255,0.9)";
      ctx.fillText(cell.code, gridX0 + c*cs + cs/2, gridY0 + r*cs + cs/2);
    }
  }

  // thin grid
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 1;
  for (let c = 0; c <= W; c++) {
    ctx.beginPath();
    ctx.moveTo(gridX0 + c*cs + 0.5, gridY0);
    ctx.lineTo(gridX0 + c*cs + 0.5, gridY0 + H*cs);
    ctx.stroke();
  }
  for (let r = 0; r <= H; r++) {
    ctx.beginPath();
    ctx.moveTo(gridX0, gridY0 + r*cs + 0.5);
    ctx.lineTo(gridX0 + W*cs, gridY0 + r*cs + 0.5);
    ctx.stroke();
  }

  // 5x5 group lines
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 1.5;
  for (let c = 0; c <= W; c += 5) {
    ctx.beginPath();
    ctx.moveTo(gridX0 + c*cs + 0.5, gridY0);
    ctx.lineTo(gridX0 + c*cs + 0.5, gridY0 + H*cs);
    ctx.stroke();
  }
  for (let r = 0; r <= H; r += 5) {
    ctx.beginPath();
    ctx.moveTo(gridX0, gridY0 + r*cs + 0.5);
    ctx.lineTo(gridX0 + W*cs, gridY0 + r*cs + 0.5);
    ctx.stroke();
  }

  // axis numbers (top)
  ctx.fillStyle = "rgba(60,60,60,0.9)";
  ctx.font = "bold " + (cs*0.35) + "px monospace";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  for (let c = 0; c < W; c++) {
    ctx.fillText(String(c+1), gridX0 + c*cs + cs/2, headerH + margin/2);
  }
  for (let r = 0; r < H; r++) {
    ctx.fillText(String(r+1), margin/2, gridY0 + r*cs + cs/2);
  }

  // watermark
  drawWatermark(ctx, {
    cs,
    gridX: gridX0,
    gridY: gridY0,
    gridW: W*cs,
    gridH: H*cs,
    lines: variant.lines,
  });
}

const variants = [
  { title: "1. 默认（仅作者水印，无应用水印）",
    showHeader: true, description: "",
    lines: ["小飞鸡"] },
  { title: "2. 头部带描述",
    showHeader: true, description: "犬夜叉桔梗 - 64x72",
    lines: ["小飞鸡"] },
  { title: "3. 同时开启应用 + 作者水印（交替）",
    showHeader: true, description: "",
    lines: ["PindouVerse", "小飞鸡"] },
  { title: "4. 仅应用水印",
    showHeader: true, description: "",
    lines: ["PindouVerse"] },
  { title: "5. 全部关闭",
    showHeader: false, description: "",
    lines: [] },
  { title: "6. 只有头部，无任何水印",
    showHeader: true, description: "",
    lines: [] },
];

const grid = document.getElementById("grid");
const iconImg = new Image();
iconImg.onload = () => {
  for (const v of variants) {
    const card = document.createElement("div");
    card.className = "card";
    const h = document.createElement("h3");
    h.textContent = v.title;
    const cv = document.createElement("canvas");
    card.appendChild(h);
    card.appendChild(cv);
    grid.appendChild(card);
    render(cv, v, iconImg);
  }
};
iconImg.src = ICON_URL;
</script>
</body>
</html>`;

const outPath = path.join(root, "temp", "watermark-preview.html");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);
console.log("Wrote", outPath);
