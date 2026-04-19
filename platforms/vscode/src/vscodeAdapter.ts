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

// Current document state (set by extension on load)
let currentDocPath = "";
let onDocumentLoad: ((content: string, path: string) => void) | null = null;
// Track content we just saved, so we can ignore the echo from extension host
let lastSavedContent: string | null = null;

export function setDocumentLoadHandler(handler: (content: string, path: string) => void) {
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
      onDocumentLoad(msg.content, msg.path);
    }
  }
});

// Signal ready
export function signalReady() {
  vscode.postMessage({ type: "ready" });
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

  async saveProject(_path: string, project: ProjectFile): Promise<void> {
    const content = JSON.stringify(project, null, 2);
    lastSavedContent = content;
    vscode.postMessage({ type: "save", content });
  }

  async loadProject(_path: string): Promise<ProjectFile> {
    // The document content is sent on load; parse it
    // If called with a different path, read the file
    const result = await sendRequest("readFile", { path: _path });
    const content = atob(result.data);
    return JSON.parse(content);
  }

  async getAutosaveDir(): Promise<string> {
    const result = await sendRequest("getAutosaveDir");
    return result.data;
  }

  async saveSnapshot(project: ProjectFile, label: string): Promise<void> {
    const dir = await this.getAutosaveDir();
    const filename = `snapshot_${Date.now()}_${label.replace(/[^a-zA-Z0-9]/g, "_")}.pindou`;
    const path = `${dir}/${filename}`;
    const content = JSON.stringify(project, null, 2);
    const data = btoa(content);
    await sendRequest("writeFile", { path, data });
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    // Simplified: return empty for now (full implementation would list files)
    return [];
  }

  async loadSnapshot(path: string): Promise<ProjectFile> {
    return this.loadProject(path);
  }

  async previewImage(_path: string): Promise<ImagePreview> {
    // Image preview requires canvas-based processing (done in webview)
    // For VS Code, we load the image directly in the webview
    throw new Error("Image preview not yet supported in VS Code extension. Use desktop app for image import.");
  }

  async importImage(_path: string, _maxDimension: number, _crop: CropRect | null, _sharp: boolean): Promise<PixelData> {
    throw new Error("Image import not yet supported in VS Code extension. Use desktop app for image import.");
  }

  async exportImage(request: ExportImageRequest): Promise<void> {
    const { width, height, cell_size, cells, output_path, format, start_x, start_y, edge_padding } = request;

    const imgW = width * cell_size;
    const imgH = height * cell_size;
    const canvas = document.createElement("canvas");
    canvas.width = imgW;
    canvas.height = imgH;
    const ctx = canvas.getContext("2d")!;

    // Fill background white
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, imgW, imgH);

    // Draw cells
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const cell = cells[row]?.[col];
        if (!cell) continue;
        const x = col * cell_size;
        const y = row * cell_size;
        ctx.fillStyle = `rgb(${cell.r},${cell.g},${cell.b})`;
        ctx.fillRect(x, y, cell_size, cell_size);

        // Cell border
        ctx.strokeStyle = "rgba(0,0,0,0.15)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, cell_size, cell_size);

        // Color code text
        if (cell_size >= 16) {
          const fontSize = Math.max(7, Math.min(cell_size * 0.32, 14));
          ctx.font = `${fontSize}px "Segoe UI", Arial, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const lum = 0.299 * cell.r + 0.587 * cell.g + 0.114 * cell.b;
          ctx.fillStyle = lum > 140 ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.95)";
          ctx.fillText(cell.color_code, x + cell_size / 2, y + cell_size / 2, cell_size - 2);
        }
      }
    }

    // Group grid lines
    const groupSize = 5;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 2;
    for (let col = edge_padding; col <= width - edge_padding; col += groupSize) {
      const x = col * cell_size;
      ctx.beginPath();
      ctx.moveTo(x, edge_padding * cell_size);
      ctx.lineTo(x, (height - edge_padding) * cell_size);
      ctx.stroke();
    }
    for (let row = edge_padding; row <= height - edge_padding; row += groupSize) {
      const y = row * cell_size;
      ctx.beginPath();
      ctx.moveTo(edge_padding * cell_size, y);
      ctx.lineTo((width - edge_padding) * cell_size, y);
      ctx.stroke();
    }

    // Coordinate labels
    const labelSize = Math.max(8, cell_size * 0.35);
    ctx.font = `${labelSize}px sans-serif`;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let col = edge_padding; col < width - edge_padding; col += groupSize) {
      ctx.fillText(String(col - edge_padding + start_x), (col + groupSize / 2) * cell_size, edge_padding > 0 ? (edge_padding * cell_size) / 2 : -labelSize);
    }
    for (let row = edge_padding; row < height - edge_padding; row += groupSize) {
      ctx.fillText(String(row - edge_padding + start_y), edge_padding > 0 ? (edge_padding * cell_size) / 2 : -labelSize, (row + groupSize / 2) * cell_size);
    }

    // Export to blob and save via extension host
    const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
    const dataUrl = canvas.toDataURL(mimeType, 0.95);
    const base64 = dataUrl.split(",")[1];
    await sendRequest("writeFile", { path: output_path, data: base64 });
  }

  async exportPreview(_request: ExportPreviewRequest): Promise<void> {
    throw new Error("Export preview not yet supported in VS Code extension.");
  }

  async importBlueprint(_path: string, _palette: PaletteColor[], _gridWidth?: number, _gridHeight?: number, _mode?: ImportMode): Promise<BlueprintImportResult> {
    throw new Error("Blueprint import not yet supported in VS Code extension. Use desktop app.");
  }
}
