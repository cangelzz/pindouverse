/**
 * VS Code adapter — implements PlatformAdapter by delegating to the extension
 * host via postMessage. Each request gets a unique requestId for async response matching.
 */
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
} from "../../../src/adapters";
import type { ProjectFile } from "../../../src/types";
import { computeLegendLayout, drawLegend } from "../../../src/utils/blueprintLegend";
import {
  normalizeProjectFromDisk,
  serializeProjectToV3,
} from "../../../src/utils/projectSerialization";
import {
  computeHeaderHeight,
  drawHeader,
  drawWatermark,
} from "../../../src/utils/blueprintDecorations";
import { importBlueprintTS, detectBlueprintDimsTS } from "../../../src/utils/blueprintImportTS";
import appIconUrl from "../../../src-tauri/icons/64x64.png";

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

// VS Code webview API
declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
let requestCounter = 0;
const pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();

// Listen for responses from extension host
window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.requestId !== undefined && pendingRequests.has(msg.requestId)) {
    const { resolve, reject } = pendingRequests.get(msg.requestId)!;
    pendingRequests.delete(msg.requestId);
    if (msg.error) {
      reject(new Error(msg.error));
    } else {
      resolve(msg);
    }
  }
});

function sendRequest(type: string, data: Record<string, any> = {}): Promise<any> {
  const requestId = ++requestCounter;
  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });
    vscode.postMessage({ type, requestId, ...data });
  });
}

// ─── Image helpers (Canvas-based, mirrors browser adapter) ──────

/** Map a file extension to a MIME type for data: URLs */
function extToMime(path: string): string {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "bmp":
      return "image/bmp";
    case "webp":
      return "image/webp";
    case "png":
    default:
      return "image/png";
  }
}

/** Load an image element from a data URL */
function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode image"));
    img.src = dataUrl;
  });
}

/** Cache last decoded image so previewImage + importImage share work */
let _cachedImagePath: string | null = null;
let _cachedImage: HTMLImageElement | null = null;

async function getImageElement(path: string): Promise<HTMLImageElement> {
  if (_cachedImagePath === path && _cachedImage) return _cachedImage;
  const result = await sendRequest("readFile", { path });
  if (!result.data) throw new Error(result.error || "Failed to read image file");
  const dataUrl = `data:${extToMime(path)};base64,${result.data}`;
  const img = await loadImageFromDataUrl(dataUrl);
  _cachedImagePath = path;
  _cachedImage = img;
  return img;
}

/** Extract pixels from an image, optionally cropped + resized (mirrors browser adapter). */
function extractPixels(
  img: HTMLImageElement,
  maxDim: number,
  crop: CropRect | null,
  sharp: boolean,
  widthRatio?: number
): PixelData {
  const sx = crop ? crop.x : 0;
  const sy = crop ? crop.y : 0;
  const sw = crop ? crop.width : img.naturalWidth;
  const sh = crop ? crop.height : img.naturalHeight;

  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  let dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);
  if (widthRatio && widthRatio > 0 && widthRatio !== 1.0) {
    dw = Math.max(1, Math.round(dw * widthRatio));
  }

  const canvas = document.createElement("canvas");
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = !sharp;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);

  const imageData = ctx.getImageData(0, 0, dw, dh);
  const pixels: number[] = [];
  for (let i = 0; i < imageData.data.length; i += 4) {
    pixels.push(imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]);
  }
  return { width: dw, height: dh, pixels };
}

// Current document state (set by extension on load)
let currentDocPath = "";
let onDocumentLoad: ((content: string, path: string, isUntitled: boolean, isBackup: boolean) => void) | null = null;
// Track content we just saved, so we can ignore the echo from extension host
let lastSavedContent: string | null = null;

export function setDocumentLoadHandler(handler: (content: string, path: string, isUntitled: boolean, isBackup: boolean) => void) {
  onDocumentLoad = handler;
}

// Listen for document loads from extension
window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "loadDocument") {
    currentDocPath = msg.path;
    // Skip reload if this is an echo of our own save
    if (lastSavedContent !== null && msg.content === lastSavedContent) {
      lastSavedContent = null;
      return;
    }
    lastSavedContent = null;
    if (onDocumentLoad) {
      onDocumentLoad(msg.content, msg.path, !!msg.isUntitled, !!msg.isBackup);
    }
  }
});

// Signal ready
export function signalReady() {
  vscode.postMessage({ type: "ready" });
}

/**
 * Ask the extension host to create a brand-new untitled .pindou project of the
 * given size and open it in a new editor tab. Mirrors the pindouverse.newProject
 * command so the in-webview "新建" button never leaves the current tab pointing
 * at the previously opened file (which would risk an accidental overwrite on save).
 */
export function requestNewProject(width: number, height: number): void {
  vscode.postMessage({ type: "newProject", width, height });
}

/**
 * Request a GitHub token from VS Code's built-in authentication.
 * Uses vscode.authentication.getSession('github', ['gist']) on the extension host side.
 * @param createIfNone If true, prompts user to sign in if not already authenticated.
 */
export async function requestGitHubToken(createIfNone = false): Promise<{
  token: string | null;
  account: { label: string; id: string } | null;
}> {
  const result = await sendRequest("getGitHubToken", { createIfNone });
  return { token: result.token || null, account: result.account || null };
}

export class VScodeAdapter implements PlatformAdapter {
  async showSaveDialog(filters: FileFilter[], defaultPath?: string): Promise<string | null> {
    const result = await sendRequest("showSaveDialog", { filters, defaultPath });
    return result.path || null;
  }

  async showOpenDialog(filters: FileFilter[], multiple = false): Promise<string | null> {
    const result = await sendRequest("showOpenDialog", { filters, multiple });
    return result.path || null;
  }

  async saveProject(path: string, project: ProjectFile): Promise<void> {
    const content = serializeProjectToV3(project);
    // If a path was supplied that differs from the active document, this is
    // "Save As": write to the new file and re-open it in the custom editor.
    // Otherwise (no path or same path), do an in-place save of the active doc.
    if (path && path !== currentDocPath) {
      // EXCEPTION: writes to the autosave backup directory must NOT switch the
      // active editor — that would dispose the current webview panel mid-edit,
      // reloading state from the merged-canvas backup and collapsing any
      // multi-layer composition (bug: ↑/↓ reorder then idle for 60s → autosave
      // fires → editor swap → layers appear "merged" after the page refresh).
      if (/[\\/]autosave\.pindou$/i.test(path) || /\.pindou_autosave[\\/]/.test(path)) {
        await this.writeProjectFile(path, project);
        return;
      }
      await sendRequest("saveAs", { path, content });
    } else {
      lastSavedContent = content;
      vscode.postMessage({ type: "save", content });
    }
  }

  async writeProjectFile(path: string, project: ProjectFile): Promise<void> {
    // EXPORT-ONLY write: never route through saveAs/openWith. The caller
    // (e.g. snapshot 另存为) wants the file on disk without disturbing
    // the currently open editor. Always use raw writeFile.
    const content = serializeProjectToV3(project);
    const data = btoa(unescape(encodeURIComponent(content)));
    await sendRequest("writeFile", { path, data });
  }

  async loadProject(_path: string): Promise<ProjectFile> {
    // The document content is sent on load; parse it
    // If called with a different path, read the file
    const result = await sendRequest("readFile", { path: _path });
    const content = atob(result.data);
    return normalizeProjectFromDisk(content);
  }

  async getAutosaveDir(): Promise<string> {
    const result = await sendRequest("getAutosaveDir");
    return result.data;
  }

  async saveSnapshot(project: ProjectFile, label: string): Promise<void> {
    const dir = await this.getAutosaveDir();
    const filename = `snapshot_${Date.now()}_${label.replace(/[^a-zA-Z0-9]/g, "_")}.pindou`;
    const path = `${dir}/${filename}`;
    const content = serializeProjectToV3(project);
    const data = btoa(content);
    await sendRequest("writeFile", { path, data });
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    const dir = await this.getAutosaveDir();
    const result = await sendRequest("listSnapshots", { dir });
    return Array.isArray(result.data) ? (result.data as SnapshotInfo[]) : [];
  }

  async loadSnapshot(path: string): Promise<ProjectFile> {
    return this.loadProject(path);
  }

  async deleteSnapshot(path: string): Promise<void> {
    const result = await sendRequest("deleteSnapshot", { path });
    if (result.success === false) {
      throw new Error(result.error || "Delete failed");
    }
  }

  async previewImage(path: string): Promise<ImagePreview> {
    const img = await getImageElement(path);

    const maxPreview = 400;
    const scale = Math.min(1, maxPreview / Math.max(img.naturalWidth, img.naturalHeight));
    const pw = Math.max(1, Math.round(img.naturalWidth * scale));
    const ph = Math.max(1, Math.round(img.naturalHeight * scale));

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
    path: string,
    maxDimension: number,
    crop: CropRect | null,
    sharp: boolean,
    widthRatio?: number
  ): Promise<PixelData> {
    const img = await getImageElement(path);
    return extractPixels(img, maxDimension, crop, sharp, widthRatio);
  }

  async exportImage(request: ExportImageRequest): Promise<void> {
    const { width, height, cell_size, cells, output_path, format, start_x, start_y, edge_padding, watermark, legend_options } = request;

    // Reserve a single-cell margin on ALL four sides for axis labels.
    // Top + bottom carry column numbers; left + right carry row numbers.
    // Without these strips, labels land at negative y/x and get clipped.
    const margin = cell_size;
    const imgW = width * cell_size + margin * 2;
    const gridAreaH = height * cell_size + margin * 2;
    const headerH = computeHeaderHeight(cell_size, !!watermark?.show_header);
    const legend = computeLegendLayout(cells as any, width, cell_size, {
      includeByCount: legend_options?.include_by_count !== false,
      includeByName: legend_options?.include_by_name === true,
    });
    const imgH = headerH + gridAreaH + legend.totalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = imgW;
    canvas.height = imgH;
    const ctx = canvas.getContext("2d")!;

    // Fill background white (covers header + grid + legend)
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, imgW, imgH);

    // Optional header band
    if (headerH > 0 && watermark) {
      const icon = await loadAppIcon();
      drawHeader(ctx, {
        cellSize: cell_size,
        width: imgW,
        headerHeight: headerH,
        iconImage: icon,
        description: watermark.app_description,
      });
    }

    // Grid origin (top-left of cell [0,0]) in image-absolute coordinates.
    const gridX = margin;
    const gridY = headerH + margin;

    // Axis labels — drawn in the four margin strips, NOT in translated space.
    // Top + bottom = column numbers; left + right = row numbers.
    const axisFontPx = Math.max(8, cell_size * 0.45);
    ctx.font = `${axisFontPx}px monospace`;
    ctx.fillStyle = "rgb(80,80,80)";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const rightLabelX = gridX + width * cell_size + cell_size / 8;
    const bottomLabelY = gridY + height * cell_size + cell_size / 4;
    for (let col = edge_padding; col < width - edge_padding; col++) {
      const label = String(col - edge_padding + start_x);
      const labelX = gridX + col * cell_size + cell_size / 6;
      ctx.fillText(label, labelX, headerH + cell_size / 4);   // top
      ctx.fillText(label, labelX, bottomLabelY);              // bottom
    }
    for (let row = edge_padding; row < height - edge_padding; row++) {
      const label = String(row - edge_padding + start_y);
      const labelY = gridY + row * cell_size + cell_size / 4;
      ctx.fillText(label, cell_size / 8, labelY);             // left
      ctx.fillText(label, rightLabelX, labelY);               // right
    }

    // Translate into grid-local coordinates for cells + grid lines.
    ctx.save();
    ctx.translate(gridX, gridY);

    // Draw cells (filled rect only; the universal thin grid below provides
    // borders for empty cells too — earlier version drew strokeRect only for
    // non-empty cells, leaving empty regions with no visible grid).
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const cell = cells[row]?.[col];
        if (!cell) continue;
        const x = col * cell_size;
        const y = row * cell_size;
        ctx.fillStyle = `rgb(${cell.r},${cell.g},${cell.b})`;
        ctx.fillRect(x, y, cell_size, cell_size);

        if (cell_size >= 16) {
          const fontSize = Math.max(7, Math.min(cell_size * 0.4, 14));
          ctx.font = `${fontSize}px "Segoe UI", Arial, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const lum = 0.299 * cell.r + 0.587 * cell.g + 0.114 * cell.b;
          ctx.fillStyle = lum > 140 ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.95)";
          ctx.fillText(cell.color_code, x + cell_size / 2, y + cell_size / 2, cell_size - 2);
        }
      }
    }

    // Three-layer grid (matches Rust thin/mid/thick passes). Draw order matters:
    // mid overwrites thin, thick overwrites mid, so a position that's both a
    // 5-step and a 10-step line ends up thick.
    const gridW = width * cell_size;
    const gridH = height * cell_size;

    // Thin per-cell grid covers the FULL grid area, including empty cells.
    ctx.strokeStyle = "rgb(180,180,180)";
    ctx.lineWidth = 1;
    for (let col = 0; col <= width; col++) {
      const x = col * cell_size + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, gridH);
      ctx.stroke();
    }
    for (let row = 0; row <= height; row++) {
      const y = row * cell_size + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(gridW, y);
      ctx.stroke();
    }

    // Mid 5-cell grid
    ctx.strokeStyle = "rgb(80,80,80)";
    ctx.lineWidth = 2;
    for (let col = edge_padding; col <= width - edge_padding; col += 5) {
      const x = col * cell_size;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, gridH);
      ctx.stroke();
    }
    for (let row = edge_padding; row <= height - edge_padding; row += 5) {
      const y = row * cell_size;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(gridW, y);
      ctx.stroke();
    }

    // Thick 10-cell grid
    ctx.strokeStyle = "rgb(0,0,0)";
    ctx.lineWidth = 3;
    for (let col = edge_padding; col <= width - edge_padding; col += 10) {
      const x = col * cell_size;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, gridH);
      ctx.stroke();
    }
    for (let row = edge_padding; row <= height - edge_padding; row += 10) {
      const y = row * cell_size;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(gridW, y);
      ctx.stroke();
    }

    // Outer thick border around the grid
    ctx.strokeStyle = "rgb(0,0,0)";
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, gridW, gridH);

    ctx.restore();

    // Watermark over the grid area (absolute coords)
    if (watermark && watermark.watermark_lines.length > 0) {
      drawWatermark(ctx, {
        cellSize: cell_size,
        gridX,
        gridY,
        gridW,
        gridH,
        lines: watermark.watermark_lines,
      });
    }

    // Bead-count legend below grid. drawLegend's `margin` param drives both
    // left padding and innerW = canvas.width - margin*2; passing cell_size
    // keeps it consistent with the grid's left margin.
    drawLegend(ctx, legend, margin, headerH + gridAreaH);

    // Export to blob and save via extension host
    const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
    const dataUrl = canvas.toDataURL(mimeType, 0.95);
    const base64 = dataUrl.split(",")[1];
    await sendRequest("writeFile", { path: output_path, data: base64 });
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

    // Optional header band
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
        if (!cell) continue;
        ctx.fillStyle = `rgb(${cell.r},${cell.g},${cell.b})`;
        ctx.fillRect(col * pixel_size, headerH + row * pixel_size, pixel_size, pixel_size);
      }
    }

    // Watermark over the color block area
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

    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const base64 = dataUrl.split(",")[1];
    await sendRequest("writeFile", { path: output_path, data: base64 });
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
    // The existing host-side handler for the "readFile" message reads the file
    // via vscode.workspace.fs.readFile and returns it base64-encoded. Reuse it.
    const result = await sendRequest("readFile", { path });
    if (!result?.data || typeof result.data !== "string") {
      throw new Error(`Read failed: ${result?.error ?? "unknown error"}`);
    }
    return result.data;
  }
}
