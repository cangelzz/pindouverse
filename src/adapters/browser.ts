import type {
  PlatformAdapter,
  FileFilter,
  ImagePreview,
  PixelData,
  CropRect,
  ExportImageRequest,
  ExportPreviewRequest,
  SnapshotInfo,
  PaletteColor,
  BlueprintImportResult,
  ImportMode,
} from "./index";
import type { ProjectFile } from "../types";
import { computeLegendLayout, drawLegend } from "../utils/blueprintLegend";
import {
  computeHeaderHeight,
  drawHeader,
  drawWatermark,
} from "../utils/blueprintDecorations";
import { importBlueprintTS, detectBlueprintDimsTS } from "../utils/blueprintImportTS";
import appIconUrl from "../../src-tauri/icons/64x64.png";

let _cachedIcon: HTMLImageElement | null = null;
let _iconPromise: Promise<HTMLImageElement | null> | null = null;

function loadAppIcon(): Promise<HTMLImageElement | null> {
  if (_cachedIcon) return Promise.resolve(_cachedIcon);
  if (_iconPromise) return _iconPromise;
  _iconPromise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      _cachedIcon = img;
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = appIconUrl;
  });
  return _iconPromise;
}

const DB_NAME = "pindouverse";
const DB_VERSION = 1;
const STORE_PROJECTS = "projects";
const STORE_SNAPSHOTS = "snapshots";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS);
      }
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        db.createObjectStore(STORE_SNAPSHOTS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readonly");
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
      })
  );
}

function idbPut(store: string, key: string, value: unknown): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

function idbAllKeys(store: string): Promise<string[]> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readonly");
        const req = tx.objectStore(store).getAllKeys();
        req.onsuccess = () => resolve(req.result as string[]);
        req.onerror = () => reject(req.error);
      })
  );
}

function idbDelete(store: string, key: string): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

/** Load an image from a File into an HTMLImageElement */
function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

/** Extract RGB pixels from image, optionally cropped and resized */
function extractPixels(
  img: HTMLImageElement,
  maxDim: number,
  crop: CropRect | null,
  sharp: boolean
): PixelData {
  const sx = crop ? crop.x : 0;
  const sy = crop ? crop.y : 0;
  const sw = crop ? crop.width : img.naturalWidth;
  const sh = crop ? crop.height : img.naturalHeight;

  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);

  const canvas = document.createElement("canvas");
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext("2d")!;
  if (sharp) {
    ctx.imageSmoothingEnabled = false;
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);

  const imageData = ctx.getImageData(0, 0, dw, dh);
  const pixels: number[] = [];
  for (let i = 0; i < imageData.data.length; i += 4) {
    pixels.push(imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]);
  }
  return { width: dw, height: dh, pixels };
}

/** Trigger a file download in the browser */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Pick a file via <input type="file"> */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/** Convert FileFilter[] to accept string */
function filtersToAccept(filters: FileFilter[]): string {
  return filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(",");
}

// ─── Browser / Extension adapter ─────────────────────────────────

export class BrowserAdapter implements PlatformAdapter {
  /** File picked by open dialog, stored for later use by previewImage/importImage */
  private _pendingFile: File | null = null;
  private _pendingImageEl: HTMLImageElement | null = null;

  async showSaveDialog(_filters: FileFilter[], defaultPath?: string): Promise<string | null> {
    // In browser we don't pick a path; return the suggested filename
    const name = defaultPath?.split(/[/\\]/).pop() ?? "download";
    return name;
  }

  async showOpenDialog(filters: FileFilter[]): Promise<string | null> {
    const accept = filtersToAccept(filters);
    const file = await pickFile(accept);
    if (!file) return null;
    this._pendingFile = file;
    this._pendingImageEl = null;
    return file.name;
  }

  // ─── Project I/O (IndexedDB) ───

  async saveProject(path: string, project: ProjectFile): Promise<void> {
    await idbPut(STORE_PROJECTS, path, project);
  }

  async writeProjectFile(path: string, project: ProjectFile): Promise<void> {
    // Browser has no editor concept — store the file under the chosen
    // IndexedDB key, same as saveProject.
    await idbPut(STORE_PROJECTS, path, project);
  }

  async loadProject(path: string): Promise<ProjectFile> {
    const project = await idbGet<ProjectFile>(STORE_PROJECTS, path);
    if (!project) throw new Error(`Project not found: ${path}`);
    return project;
  }

  async getAutosaveDir(): Promise<string> {
    return "__autosave__";
  }

  // ─── Snapshots (IndexedDB) ───

  async saveSnapshot(project: ProjectFile, label: string): Promise<void> {
    const key = `snapshot_${Date.now()}_${label}`;
    await idbPut(STORE_SNAPSHOTS, key, { project, label, timestamp: new Date().toISOString() });
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    const keys = await idbAllKeys(STORE_SNAPSHOTS);
    const results: SnapshotInfo[] = [];
    for (const key of keys) {
      const data = await idbGet<{ label: string; timestamp: string }>(STORE_SNAPSHOTS, key);
      if (data) {
        results.push({ path: key, name: data.label, modified: data.timestamp });
      }
    }
    results.sort((a, b) => b.modified.localeCompare(a.modified));
    return results;
  }

  async loadSnapshot(path: string): Promise<ProjectFile> {
    const data = await idbGet<{ project: ProjectFile }>(STORE_SNAPSHOTS, path);
    if (!data) throw new Error(`Snapshot not found: ${path}`);
    return data.project;
  }

  async deleteSnapshot(path: string): Promise<void> {
    await idbDelete(STORE_SNAPSHOTS, path);
  }

  // ─── Image import (Canvas API) ───

  async previewImage(_path: string): Promise<ImagePreview> {
    if (!this._pendingFile) throw new Error("No file selected");
    const img = await loadImageFromFile(this._pendingFile);
    this._pendingImageEl = img;

    const maxPreview = 400;
    const scale = Math.min(1, maxPreview / Math.max(img.naturalWidth, img.naturalHeight));
    const pw = Math.round(img.naturalWidth * scale);
    const ph = Math.round(img.naturalHeight * scale);

    const canvas = document.createElement("canvas");
    canvas.width = pw;
    canvas.height = ph;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, pw, ph);
    const imageData = ctx.getImageData(0, 0, pw, ph);
    const pixels: number[] = [];
    for (let i = 0; i < imageData.data.length; i += 4) {
      pixels.push(imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]);
    }

    return {
      original_width: img.naturalWidth,
      original_height: img.naturalHeight,
      preview_width: pw,
      preview_height: ph,
      pixels,
    };
  }

  async importImage(
    _path: string,
    maxDimension: number,
    crop: CropRect | null,
    sharp: boolean
  ): Promise<PixelData> {
    if (!this._pendingImageEl && this._pendingFile) {
      this._pendingImageEl = await loadImageFromFile(this._pendingFile);
    }
    if (!this._pendingImageEl) throw new Error("No image loaded");
    return extractPixels(this._pendingImageEl, maxDimension, crop, sharp);
  }

  // ─── Image export (Canvas API + download) ───

  async exportImage(request: ExportImageRequest): Promise<void> {
    const {
      width, height, cell_size, cells, output_path, format,
      start_x, start_y, edge_padding, watermark, legend_options,
    } = request;
    const cw = width * cell_size;
    const gridAreaH = height * cell_size;
    const headerH = computeHeaderHeight(cell_size, !!watermark?.show_header);
    const legend = computeLegendLayout(cells as any, width, cell_size, {
      includeByCount: legend_options?.include_by_count !== false,
      includeByName: legend_options?.include_by_name === true,
    });
    const ch = headerH + gridAreaH + legend.totalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, cw, ch);

    // Optional header
    if (headerH > 0 && watermark) {
      const icon = await loadAppIcon();
      drawHeader(ctx, {
        cellSize: cell_size,
        width: cw,
        headerHeight: headerH,
        iconImage: icon,
        description: watermark.app_description,
      });
    }

    // Translate the existing grid/axis/legend drawing into the post-header band
    const useTranslate = headerH > 0;
    if (useTranslate) {
      ctx.save();
      ctx.translate(0, headerH);
    }

    // Draw cells
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const cell = cells[row]?.[col];
        if (cell) {
          ctx.fillStyle = `rgb(${cell.r},${cell.g},${cell.b})`;
          ctx.fillRect(col * cell_size, row * cell_size, cell_size, cell_size);
        }
      }
    }

    // Grid lines
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1;
    for (let col = 0; col <= width; col++) {
      ctx.beginPath();
      ctx.moveTo(col * cell_size, 0);
      ctx.lineTo(col * cell_size, gridAreaH);
      ctx.stroke();
    }
    for (let row = 0; row <= height; row++) {
      ctx.beginPath();
      ctx.moveTo(0, row * cell_size);
      ctx.lineTo(cw, row * cell_size);
      ctx.stroke();
    }

    // Thick group lines (5×5)
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 2;
    for (let col = edge_padding; col <= width - edge_padding; col += 5) {
      ctx.beginPath();
      ctx.moveTo(col * cell_size, edge_padding * cell_size);
      ctx.lineTo(col * cell_size, (height - edge_padding) * cell_size);
      ctx.stroke();
    }
    for (let row = edge_padding; row <= height - edge_padding; row += 5) {
      ctx.beginPath();
      ctx.moveTo(edge_padding * cell_size, row * cell_size);
      ctx.lineTo((width - edge_padding) * cell_size, row * cell_size);
      ctx.stroke();
    }

    // Color codes
    if (cell_size >= 20) {
      const fontSize = Math.max(8, cell_size * 0.28);
      ctx.font = `${fontSize}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const cell = cells[row]?.[col];
          if (cell) {
            const lum = 0.299 * cell.r + 0.587 * cell.g + 0.114 * cell.b;
            ctx.fillStyle = lum > 140 ? "rgba(0,0,0,0.8)" : "rgba(255,255,255,0.9)";
            ctx.fillText(cell.color_code, col * cell_size + cell_size / 2, row * cell_size + cell_size / 2, cell_size - 2);
          }
        }
      }
    }

    // Axis numbers
    const axisFont = Math.max(8, cell_size * 0.3);
    ctx.font = `bold ${axisFont}px monospace`;
    ctx.fillStyle = "rgba(60,60,60,0.9)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let col = edge_padding; col < width - edge_padding; col++) {
      ctx.fillText(`${col - edge_padding + start_x}`, col * cell_size + cell_size / 2, edge_padding * cell_size / 2 || axisFont);
    }
    for (let row = edge_padding; row < height - edge_padding; row++) {
      ctx.fillText(`${row - edge_padding + start_y}`, edge_padding * cell_size / 2 || axisFont, row * cell_size + cell_size / 2);
    }

    // Bead-count legend below grid (matches Tauri output)
    drawLegend(ctx, legend, cell_size, gridAreaH);

    if (useTranslate) {
      ctx.restore();
    }

    // Watermark (in absolute coords — inside the grid area only, after the header offset)
    if (watermark && watermark.watermark_lines.length > 0) {
      drawWatermark(ctx, {
        cellSize: cell_size,
        gridX: 0,
        gridY: headerH,
        gridW: cw,
        gridH: gridAreaH,
        lines: watermark.watermark_lines,
      });
    }

    const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
    const ext = format === "jpeg" ? "jpg" : "png";
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), mimeType, 0.92)
    );
    const filename = output_path.split(/[/\\]/).pop() ?? `export.${ext}`;
    downloadBlob(blob, filename);
  }

  async exportPreview(request: ExportPreviewRequest): Promise<void> {
    const { width, height, pixel_size, cells, output_path, watermark } = request;
    const cw = width * pixel_size;
    const gridAreaH = height * pixel_size;
    const headerH = computeHeaderHeight(pixel_size, !!watermark?.show_header);
    const ch = headerH + gridAreaH;
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, cw, ch);

    if (headerH > 0 && watermark) {
      const icon = await loadAppIcon();
      drawHeader(ctx, {
        cellSize: pixel_size,
        width: cw,
        headerHeight: headerH,
        iconImage: icon,
        description: watermark.app_description,
      });
    }

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const cell = cells[row]?.[col];
        if (cell) {
          ctx.fillStyle = `rgb(${cell.r},${cell.g},${cell.b})`;
          ctx.fillRect(col * pixel_size, headerH + row * pixel_size, pixel_size, pixel_size);
        }
      }
    }

    if (watermark && watermark.watermark_lines.length > 0) {
      drawWatermark(ctx, {
        cellSize: pixel_size,
        gridX: 0,
        gridY: headerH,
        gridW: cw,
        gridH: gridAreaH,
        lines: watermark.watermark_lines,
      });
    }

    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.92)
    );
    const filename = output_path.split(/[/\\]/).pop() ?? "preview.jpg";
    downloadBlob(blob, filename);
  }

  async importBlueprint(
    path: string,
    palette: PaletteColor[],
    gridWidth?: number,
    gridHeight?: number,
    mode?: ImportMode,
    bbox?: { left: number; top: number; right: number; bottom: number },
    opts?: { onProgress?: (stage: string, fraction: number) => void; signal?: AbortSignal },
  ): Promise<BlueprintImportResult> {
    return await importBlueprintTS(
      { path, palette, gridWidth, gridHeight, bbox, mode },
      this,
      opts,
    );
  }

  async detectBlueprintDims(
    path: string,
    bbox?: { left: number; top: number; right: number; bottom: number },
    opts?: { onProgress?: (stage: string, fraction: number) => void; signal?: AbortSignal },
  ): Promise<{ width: number; height: number; cellSize: number; bbox: { left: number; top: number; right: number; bottom: number }; hasMetadata: boolean }> {
    return await detectBlueprintDimsTS(path, this, bbox, opts);
  }

  async readFileBase64(path: string): Promise<string> {
    if (path.startsWith("data:")) {
      const comma = path.indexOf(",");
      if (comma < 0) throw new Error("Invalid data URL");
      return path.slice(comma + 1);
    }
    throw new Error("readFileBase64 in browser only supports data: URLs (full file access via picker not implemented yet)");
  }
}
