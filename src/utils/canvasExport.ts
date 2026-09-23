import type { ExportImageRequest, ExportPreviewRequest } from "../adapters";
import { TRANSPARENT_BEAD_CODE } from "../data/mard221";
import { computeHeaderHeight, drawHeader, drawWatermark } from "./blueprintDecorations";
import { computeLegendLayout, drawLegend } from "./blueprintLegend";
import { drawTransparentBeadMarker } from "./canvasRenderer";

export type BlueprintRenderRequest = Omit<ExportImageRequest, "output_path">;
export type PreviewRenderRequest = Omit<ExportPreviewRequest, "output_path">;

export interface CanvasExportAssets {
  appIcon?: CanvasImageSource | null;
}

export interface CanvasExportDependencies {
  createCanvas?: () => HTMLCanvasElement;
  maxPixels?: number;
}

const MAX_CANVAS_SIDE = 32_767;
const MAX_CANVAS_PIXELS = 268_435_456;
const FONT_FAMILY = '"Segoe UI", Arial, sans-serif';

function createCanvas(dependencies?: CanvasExportDependencies): HTMLCanvasElement {
  return dependencies?.createCanvas?.() ?? document.createElement("canvas");
}

function validateDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid canvas dimensions: ${width}x${height}`);
  }
  if (width > MAX_CANVAS_SIDE || height > MAX_CANVAS_SIDE || width * height > MAX_CANVAS_PIXELS) {
    throw new Error(`Canvas is too large: ${width}x${height}`);
  }
}

function prepareCanvas(width: number, height: number, dependencies?: CanvasExportDependencies) {
  validateDimensions(width, height);
  if (dependencies?.maxPixels !== undefined && width * height > dependencies.maxPixels) throw new Error("Export exceeds the configured pixel budget");
  const canvas = createCanvas(dependencies);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context is unavailable");
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

function encodeCanvas(canvas: HTMLCanvasElement, mimeType: "image/png" | "image/jpeg", quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error(`Failed to encode canvas as ${mimeType}`));
        } else if (blob.type && blob.type !== mimeType) {
          reject(new Error(`Canvas encoded ${blob.type} instead of ${mimeType}`));
        } else {
          resolve(blob);
        }
      }, mimeType, quality);
    } catch (error) {
      reject(error instanceof Error ? error : new Error("Failed to encode canvas"));
    }
  });
}

export async function renderBlueprintBlob(
  request: BlueprintRenderRequest,
  assets: CanvasExportAssets = {},
  dependencies?: CanvasExportDependencies,
): Promise<Blob> {
  const { width, height, cell_size, cells, format, start_x, start_y, edge_padding, watermark, legend_options, labels } = request;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid canvas dimensions: ${width}x${height}`);
  }
  if (!Number.isFinite(cell_size) || cell_size <= 0) throw new Error(`Invalid cell size: ${cell_size}`);

  const margin = cell_size;
  const imgW = width * cell_size + margin * 2;
  const gridAreaH = height * cell_size + margin * 2;
  const headerH = computeHeaderHeight(cell_size, !!watermark?.show_header);
  validateDimensions(imgW, Math.ceil(headerH + gridAreaH));
  const legend = computeLegendLayout(cells, width, cell_size, {
    includeByCount: legend_options?.include_by_count !== false,
    includeByName: legend_options?.include_by_name === true,
  }, dependencies?.createCanvas, {
    byCount: labels.legendByCount,
    byCode: labels.legendByCode,
  });
  const imgH = Math.ceil(headerH + gridAreaH + legend.totalHeight);
  const { canvas, ctx } = prepareCanvas(imgW, imgH, dependencies);

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, imgW, imgH);
  if (headerH > 0 && watermark) {
    drawHeader(ctx, {
      cellSize: cell_size,
      width: imgW,
      headerHeight: headerH,
      iconImage: assets.appIcon ?? null,
      description: watermark.app_description,
    });
    ctx.imageSmoothingEnabled = false;
  }

  const gridX = margin;
  const gridY = headerH + margin;
  const axisFontPx = Math.max(8, cell_size * 0.45);
  ctx.font = `${axisFontPx}px ${FONT_FAMILY}`;
  ctx.fillStyle = "rgb(80,80,80)";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const rightLabelX = gridX + width * cell_size + cell_size / 8;
  const bottomLabelY = gridY + height * cell_size + cell_size / 4;
  for (let col = edge_padding; col < width - edge_padding; col++) {
    const label = String(col - edge_padding + start_x);
    const labelX = gridX + col * cell_size + cell_size / 6;
    ctx.fillText(label, labelX, headerH + cell_size / 4);
    ctx.fillText(label, labelX, bottomLabelY);
  }
  for (let row = edge_padding; row < height - edge_padding; row++) {
    const label = String(row - edge_padding + start_y);
    const labelY = gridY + row * cell_size + cell_size / 4;
    ctx.fillText(label, cell_size / 8, labelY);
    ctx.fillText(label, rightLabelX, labelY);
  }

  ctx.save();
  ctx.translate(gridX, gridY);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const cell = cells[row]?.[col];
      if (!cell) continue;
      const x = col * cell_size;
      const y = row * cell_size;
      if (cell.color_code === TRANSPARENT_BEAD_CODE) {
        drawTransparentBeadMarker(ctx, x, y, cell_size);
      } else {
        ctx.fillStyle = `rgb(${cell.r},${cell.g},${cell.b})`;
        ctx.fillRect(x, y, cell_size, cell_size);
      }
      if (cell_size >= 16) {
        const fontSize = Math.max(7, Math.min(cell_size * 0.4, 14));
        ctx.font = `${fontSize}px ${FONT_FAMILY}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const lum = 0.299 * cell.r + 0.587 * cell.g + 0.114 * cell.b;
        ctx.fillStyle = lum > 140 ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.95)";
        ctx.fillText(cell.color_code, x + cell_size / 2, y + cell_size / 2, cell_size - 2);
      }
    }
  }

  const gridW = width * cell_size;
  const gridH = height * cell_size;
  ctx.strokeStyle = "rgb(180,180,180)";
  ctx.lineWidth = 1;
  for (let col = 0; col <= width; col++) {
    const x = col * cell_size + 0.5;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, gridH); ctx.stroke();
  }
  for (let row = 0; row <= height; row++) {
    const y = row * cell_size + 0.5;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(gridW, y); ctx.stroke();
  }
  ctx.strokeStyle = "rgb(80,80,80)";
  ctx.lineWidth = 2;
  for (let col = edge_padding; col <= width - edge_padding; col += 5) {
    const x = col * cell_size;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, gridH); ctx.stroke();
  }
  for (let row = edge_padding; row <= height - edge_padding; row += 5) {
    const y = row * cell_size;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(gridW, y); ctx.stroke();
  }
  ctx.strokeStyle = "rgb(0,0,0)";
  ctx.lineWidth = 3;
  for (let col = edge_padding; col <= width - edge_padding; col += 10) {
    const x = col * cell_size;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, gridH); ctx.stroke();
  }
  for (let row = edge_padding; row <= height - edge_padding; row += 10) {
    const y = row * cell_size;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(gridW, y); ctx.stroke();
  }
  ctx.strokeStyle = "rgb(0,0,0)";
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, gridW, gridH);
  ctx.restore();

  if (watermark?.watermark_lines.length) {
    drawWatermark(ctx, { cellSize: cell_size, gridX, gridY, gridW, gridH, lines: watermark.watermark_lines });
  }
  drawLegend(ctx, legend, margin, headerH + gridAreaH);

  return encodeCanvas(canvas, format === "jpeg" ? "image/jpeg" : "image/png", 0.95);
}

export async function renderPreviewBlob(
  request: PreviewRenderRequest,
  assets: CanvasExportAssets = {},
  dependencies?: CanvasExportDependencies,
): Promise<Blob> {
  const { width, height, pixel_size, cells, watermark } = request;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid canvas dimensions: ${width}x${height}`);
  }
  if (!Number.isFinite(pixel_size) || pixel_size <= 0) throw new Error(`Invalid pixel size: ${pixel_size}`);
  const imgW = width * pixel_size;
  const gridH = height * pixel_size;
  const headerH = computeHeaderHeight(pixel_size, !!watermark?.show_header);
  const { canvas, ctx } = prepareCanvas(imgW, headerH + gridH, dependencies);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (headerH > 0 && watermark) {
    drawHeader(ctx, { cellSize: pixel_size, width: imgW, headerHeight: headerH, iconImage: assets.appIcon ?? null, description: watermark.app_description });
    ctx.imageSmoothingEnabled = false;
  }
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const cell = cells[row]?.[col];
      if (!cell) continue;
      if (cell.color_code === TRANSPARENT_BEAD_CODE) {
        drawTransparentBeadMarker(ctx, col * pixel_size, headerH + row * pixel_size, pixel_size);
      } else {
        ctx.fillStyle = `rgb(${cell.r},${cell.g},${cell.b})`;
        ctx.fillRect(col * pixel_size, headerH + row * pixel_size, pixel_size, pixel_size);
      }
    }
  }
  if (watermark?.watermark_lines.length) {
    drawWatermark(ctx, { cellSize: pixel_size, gridX: 0, gridY: headerH, gridW: imgW, gridH, lines: watermark.watermark_lines });
  }
  return encodeCanvas(canvas, "image/jpeg", 0.92);
}
