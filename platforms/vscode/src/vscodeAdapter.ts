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
import {
  normalizeProjectFromDisk,
  serializeProjectToV3,
} from "../../../src/utils/projectSerialization";
import { renderBlueprintBlob, renderPreviewBlob } from "../../../src/utils/canvasExport";
import { importBlueprintTS, detectBlueprintDimsTS } from "../../../src/utils/blueprintImportTS";
import appIconUrl from "../../../src-tauri/icons/64x64.png";
import { TOOL_LIMITS } from "../../../src/blueprint/toolContract";
import type { ToolMediaServices } from "../../../src/blueprint/toolMedia";

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
const pendingRequests = new Map<number, {
  expectedType: string;
  resolve: (val: any) => void;
  reject: (err: any) => void;
  timeout: ReturnType<typeof setTimeout> | null;
}>();

const replyTypes: Record<string, string> = {
  save: "saveResult", saveAs: "fileResult",
  saveBlueprint: "saveBlueprintResult",
  showSaveDialog: "dialogResult", showOpenDialog: "dialogResult",
  readFile: "fileResult", writeFile: "fileResult", getAutosaveDir: "fileResult",
  listSnapshots: "fileResult", deleteSnapshot: "fileResult",
  getGitHubToken: "githubToken", getUiEnvironment: "uiEnvironment",
  storageGet: "storageResult", storageSet: "storageResult", storageRemove: "storageResult",
};

function requestTimeout(type: string, data: Record<string, any>): number | null {
  if (type === "getGitHubToken" && data.createIfNone) return null;
  if (type === "showOpenDialog" || type === "showSaveDialog" || type === "saveBlueprint") return null;
  if (type === "readFile" || type === "writeFile" || type === "save" || type === "saveAs") return 120_000;
  if (type === "listSnapshots" || type === "getAutosaveDir") return 30_000;
  return 5_000;
}

// Listen for responses from extension host
window.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object" || !Number.isInteger(msg.requestId)
    || "toolRequestId" in msg || "handoffId" in msg) return;
  const pending = pendingRequests.get(msg.requestId);
  if (pending && pending.expectedType === msg.type) {
    const { resolve, reject, timeout } = pending;
    pendingRequests.delete(msg.requestId);
    if (timeout !== null) clearTimeout(timeout);
    if (msg.error) {
      reject(new Error(msg.error));
    } else {
      resolve(msg);
    }
  }
});

export function sendRequest(
  type: string,
  data: Record<string, any> = {},
  timeoutMs = requestTimeout(type, data),
): Promise<any> {
  const expectedType = replyTypes[type];
  if (!expectedType) return Promise.reject(new Error(`Unsupported VS Code request ${type}`));
  const requestId = ++requestCounter;
  return new Promise((resolve, reject) => {
    const timeout = timeoutMs === null ? null : setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`VS Code request ${type} timed out`));
    }, timeoutMs);
    pendingRequests.set(requestId, { expectedType, resolve, reject, timeout });
    vscode.postMessage({ ...data, type, requestId });
  });
}

window.addEventListener("unload", () => {
  for (const { reject, timeout } of pendingRequests.values()) {
    if (timeout !== null) clearTimeout(timeout);
    reject(new Error("VS Code webview unloaded"));
  }
  pendingRequests.clear();
}, { once: true });

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      const comma = value.indexOf(",");
      if (comma < 0) reject(new Error("Failed to encode export Blob"));
      else resolve(value.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read export Blob"));
    reader.readAsDataURL(blob);
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
let liveSaveSupport = false;
export function hasLiveSaveSupport(): boolean { return liveSaveSupport; }
let onDocumentLoad: ((content: string, path: string, isUntitled: boolean, isBackup: boolean, editorId?: string, sessionOwnerId?: string) => void) | null = null;
// Track content we just saved, so we can ignore the echo from extension host
let lastSavedContent: string | null = null;

export function setDocumentLoadHandler(handler: (content: string, path: string, isUntitled: boolean, isBackup: boolean, editorId?: string, sessionOwnerId?: string) => void) {
  onDocumentLoad = handler;
}

// Listen for document loads from extension
window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "loadDocument") {
    if (typeof msg.liveSave === "boolean") liveSaveSupport = msg.liveSave;
    currentDocPath = msg.path;
    // Skip reload if this is an echo of our own save
    if (lastSavedContent !== null && msg.content === lastSavedContent) {
      lastSavedContent = null;
      return;
    }
    lastSavedContent = null;
    if (onDocumentLoad) {
      onDocumentLoad(msg.content, msg.path, !!msg.isUntitled, !!msg.isBackup, msg.editorId, msg.sessionOwnerId);
    }
  }
});

// Signal ready
export function signalReady() {
  vscode.postMessage({ type: "ready" });
}

export function postHostMessage(message: unknown): void {
  vscode.postMessage(message);
}

export function createToolMediaServices(file: { grantId: string; path: string }, operationId: string): ToolMediaServices {
  const grant = { agentFileGrantId: file.grantId, agentOperationId: operationId, path: file.path };
  return {
    async importPixels(input, signal) {
      if (signal.aborted) throw new Error("Image import cancelled");
      const reply = await sendRequest("readFile", grant);
      const decoded = atob(reply.data);
      if (decoded.length > TOOL_LIMITS.imageBytes) throw new Error("Image exceeds byte budget");
      const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: reply.mimeType || "image/png" }));
      try {
        if (signal.aborted || bitmap.width * bitmap.height > TOOL_LIMITS.decodedPixels) throw new Error("Image decode cancelled or oversized");
        const canvas = document.createElement("canvas");
        canvas.width = input.width;
        canvas.height = input.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Image context is unavailable");
        context.imageSmoothingEnabled = true;
        context.drawImage(bitmap, 0, 0, input.width, input.height);
        const rgba = context.getImageData(0, 0, input.width, input.height).data;
        const pixels: number[] = [];
        for (let offset = 0; offset < rgba.length; offset += 4) pixels.push(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
        return { width: input.width, height: input.height, pixels };
      } finally { bitmap.close(); }
    },
    async exportImage(request, signal) {
      if (signal.aborted) throw new Error("Export cancelled");
      const { output_path: _path, ...renderRequest } = request;
      const blob = await renderBlueprintBlob(renderRequest, { appIcon: await loadAppIcon() }, { maxPixels: TOOL_LIMITS.exportPixels });
      if (blob.size > TOOL_LIMITS.outputBytes) throw new Error("Export exceeds byte budget");
      const data = await blobToBase64(blob);
      if (signal.aborted) throw new Error("Export cancelled before write");
      const reply = await sendRequest("writeFile", { ...grant, data });
      if (reply.success === false) throw new Error("Host rejected the export write");
    },
  };
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
      const result = await sendRequest("saveAs", { path, content });
      if (result.success === false) throw new Error(String(result.error || "saveAs failed"));
    } else {
      const result = await sendRequest("save", { content });
      if (result.success === false) throw new Error(String(result.error || "save failed"));
      lastSavedContent = content;
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

  async clearAutosave(): Promise<void> {
    const dir = await this.getAutosaveDir();
    await sendRequest("deleteSnapshot", { path: `${dir}/autosave.pindou` });
  }

  async saveSnapshot(project: ProjectFile, label: string, sourceProjectId?: string): Promise<void> {
    if (sourceProjectId && !project.projectId) project = { ...project, projectId: sourceProjectId };
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
    const { output_path, ...renderRequest } = request;
    const icon = await loadAppIcon();
    const blob = await renderBlueprintBlob(renderRequest, { appIcon: icon });
    await sendRequest("writeFile", { path: output_path, data: await blobToBase64(blob), operation: "export" });
  }

  async exportPreview(request: ExportPreviewRequest): Promise<void> {
    const { output_path, ...renderRequest } = request;
    const icon = await loadAppIcon();
    const blob = await renderPreviewBlob(renderRequest, { appIcon: icon });
    await sendRequest("writeFile", { path: output_path, data: await blobToBase64(blob), operation: "export" });
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
