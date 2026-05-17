/**
 * Header band + diagonal watermark for blueprint and preview exports.
 *
 * Pure layout + persistence functions live here; Canvas drawing helpers are
 * exported separately and called by src/adapters/browser.ts. A Rust mirror
 * lives at src-tauri/src/commands/image_decorations.rs.
 */

import type { ExportWatermarkSettings } from "../types";

export const APP_NAME = "PindouVerse";

export const DEFAULT_WATERMARK_SETTINGS: ExportWatermarkSettings = {
  showHeader: true,
  appDescription: "",
  appWatermark: false,
  authorWatermark: true,
  authorOverride: "",
};

const STORAGE_KEY = "pindouverse.exportWatermark";

export function computeHeaderHeight(cellSize: number, showHeader: boolean): number {
  return showHeader ? 2 * cellSize : 0;
}

export function resolveWatermarkAuthor(
  override: string | undefined,
  projectAuthor: string | undefined
): string {
  const o = (override ?? "").trim();
  if (o) return o;
  return (projectAuthor ?? "").trim();
}

export function computeWatermarkLines(
  settings: ExportWatermarkSettings,
  projectAuthor: string
): string[] {
  const author = resolveWatermarkAuthor(settings.authorOverride, projectAuthor);
  const lines: string[] = [];
  if (settings.appWatermark) lines.push(APP_NAME);
  if (settings.authorWatermark && author) lines.push(author);
  return lines;
}

export function loadWatermarkSettings(): ExportWatermarkSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_WATERMARK_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_WATERMARK_SETTINGS,
      ...parsed,
      authorOverride: DEFAULT_WATERMARK_SETTINGS.authorOverride,
    };
  } catch {
    return { ...DEFAULT_WATERMARK_SETTINGS };
  }
}

export function saveWatermarkSettings(settings: ExportWatermarkSettings): void {
  const { authorOverride: _authorOverride, ...persistable } = settings;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
  } catch {
    // localStorage unavailable / quota — silently ignore
  }
}

// ---------------------------------------------------------------------------
// Canvas drawing helpers
// ---------------------------------------------------------------------------

export interface DrawHeaderOpts {
  cellSize: number;
  width: number;
  headerHeight: number;
  iconImage: CanvasImageSource | null;
  description: string;
}

export function drawHeader(ctx: CanvasRenderingContext2D, opts: DrawHeaderOpts): void {
  const { cellSize, width, headerHeight, iconImage, description } = opts;
  if (headerHeight <= 0) return;

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, headerHeight);

  const pad = cellSize / 4;
  const iconSize = Math.round(headerHeight * 0.95);
  const iconY = Math.round((headerHeight - iconSize) / 2);
  if (iconImage) {
    const prevSmooth = ctx.imageSmoothingEnabled;
    const prevQuality = ctx.imageSmoothingQuality;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(iconImage, pad, iconY, iconSize, iconSize);
    ctx.imageSmoothingEnabled = prevSmooth;
    ctx.imageSmoothingQuality = prevQuality;
  }

  const textX = pad + iconSize + pad;
  const fontSize = headerHeight * 0.4;
  const fullText = description ? `${APP_NAME} - ${description}` : APP_NAME;
  ctx.fillStyle = "#1F2937";
  ctx.font = `600 ${fontSize}px -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(fullText, textX, headerHeight / 2);

  ctx.strokeStyle = "#E5E7EB";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, headerHeight - 0.5);
  ctx.lineTo(width, headerHeight - 0.5);
  ctx.stroke();
}

export interface DrawWatermarkOpts {
  cellSize: number;
  gridX: number;
  gridY: number;
  gridW: number;
  gridH: number;
  lines: string[];
}

/**
 * Returns the minimum number of watermark text rows needed to cover the
 * grid's diagonal at 9*cellSize spacing. The caller (drawWatermark) draws
 * `2*floor(N/2)+1` symmetric rows centered on the grid, so the actual
 * row count is always odd and may exceed this value by one.
 */
export function computeWatermarkLineCount(gridW: number, gridH: number, cellSize: number): number {
  const diag = Math.sqrt(gridW * gridW + gridH * gridH);
  const lineGap = 9 * cellSize;
  return Math.max(2, Math.ceil(diag / lineGap));
}

export function drawWatermark(ctx: CanvasRenderingContext2D, opts: DrawWatermarkOpts): void {
  const { cellSize, gridX, gridY, gridW, gridH, lines } = opts;
  if (lines.length === 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(gridX, gridY, gridW, gridH);
  ctx.clip();

  const fontSize = 3 * cellSize;
  ctx.font = `500 ${fontSize}px "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", -apple-system, "Segoe UI", sans-serif`;
  ctx.fillStyle = "rgba(150,150,150,0.22)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const cx = gridX + gridW / 2;
  const cy = gridY + gridH / 2;
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 4);

  const diag = Math.sqrt(gridW * gridW + gridH * gridH);
  const lineGap = 9 * cellSize;
  const lineCount = computeWatermarkLineCount(gridW, gridH, cellSize);
  const half = Math.floor(lineCount / 2);

  for (let i = -half; i <= half; i++) {
    const text = lines[((i % lines.length) + lines.length) % lines.length];
    if (!text) continue;
    const y = i * lineGap;
      // measureText is transform-invariant; the value here is the upright text
      // width in pixels, applied along the post-rotation x-axis.
      const textW = ctx.measureText(text).width;
    const repeatGap = textW * 2.5;
    if (repeatGap <= 0) continue;
    const reach = diag / 2 + textW;
    const stagger = i % 2 === 0 ? 0 : repeatGap / 2;
    for (let x = -reach + stagger; x <= reach; x += repeatGap) {
      ctx.fillText(text, x, y);
    }
  }
  ctx.restore();
}
