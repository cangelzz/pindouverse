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
} from "./index";
import type { ProjectFile } from "../types";

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
    const { width, height, cell_size, cells, output_path, format, start_x, start_y, edge_padding } = request;
    const cw = width * cell_size;
    const ch = height * cell_size;
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d")!;

    // White background
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, cw, ch);

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
      ctx.lineTo(col * cell_size, ch);
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

    const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
    const ext = format === "jpeg" ? "jpg" : "png";
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), mimeType, 0.92)
    );
    const filename = output_path.split(/[/\\]/).pop() ?? `export.${ext}`;
    downloadBlob(blob, filename);
  }

  async exportPreview(request: ExportPreviewRequest): Promise<void> {
    const { width, height, pixel_size, cells, output_path } = request;
    const cw = width * pixel_size;
    const ch = height * pixel_size;
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, cw, ch);

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const cell = cells[row]?.[col];
        if (cell) {
          ctx.fillStyle = `rgb(${cell.r},${cell.g},${cell.b})`;
          ctx.fillRect(col * pixel_size, row * pixel_size, pixel_size, pixel_size);
        }
      }
    }

    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.92)
    );
    const filename = output_path.split(/[/\\]/).pop() ?? "preview.jpg";
    downloadBlob(blob, filename);
  }

  async importBlueprint(_path: string, _palette: PaletteColor[], _gridWidth?: number, _gridHeight?: number): Promise<BlueprintImportResult> {
    throw new Error("Blueprint import not yet supported in browser. Use desktop app.");
  }
}
