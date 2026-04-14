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

export function setDocumentLoadHandler(handler: (content: string, path: string) => void) {
  onDocumentLoad = handler;
}

// Listen for document loads from extension
window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "loadDocument") {
    currentDocPath = msg.path;
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
    // Save directly through the TextDocument (the extension handles persistence)
    const content = JSON.stringify(project, null, 2);
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

  async exportImage(_request: ExportImageRequest): Promise<void> {
    // Export would require canvas rendering in webview + saving
    throw new Error("Image export not yet supported in VS Code extension. Use desktop app for export.");
  }

  async exportPreview(_request: ExportPreviewRequest): Promise<void> {
    throw new Error("Export preview not yet supported in VS Code extension.");
  }

  async importBlueprint(_path: string, _palette: PaletteColor[], _gridWidth?: number, _gridHeight?: number, _mode?: ImportMode): Promise<BlueprintImportResult> {
    throw new Error("Blueprint import not yet supported in VS Code extension. Use desktop app.");
  }
}
