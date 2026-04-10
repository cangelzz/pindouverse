import { describe, it, expect } from "vitest";
import type { PlatformAdapter, ImagePreview, PixelData, CropRect, ExportImageRequest, ExportPreviewRequest, SnapshotInfo, FileFilter } from "../../src/adapters";
import type { ProjectFile } from "../../src/types";
import { setAdapter, getAdapter } from "../../src/adapters";

class MockAdapter implements PlatformAdapter {
  calls: { method: string; args: unknown[] }[] = [];

  private record(method: string, ...args: unknown[]) {
    this.calls.push({ method, args });
  }

  async showSaveDialog(filters: FileFilter[], defaultPath?: string): Promise<string | null> {
    this.record("showSaveDialog", filters, defaultPath);
    return "/mock/save/path.pindou";
  }
  async showOpenDialog(filters: FileFilter[], multiple?: boolean): Promise<string | null> {
    this.record("showOpenDialog", filters, multiple);
    return "/mock/open/path.pindou";
  }
  async saveProject(path: string, project: ProjectFile): Promise<void> {
    this.record("saveProject", path, project);
  }
  async loadProject(path: string): Promise<ProjectFile> {
    this.record("loadProject", path);
    return {
      version: 1,
      canvasSize: { width: 10, height: 10 },
      canvasData: Array.from({ length: 10 }, () =>
        Array.from({ length: 10 }, () => ({ colorIndex: null }))
      ),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  async getAutosaveDir(): Promise<string> {
    this.record("getAutosaveDir");
    return "/mock/autosave";
  }
  async saveSnapshot(project: ProjectFile, label: string): Promise<void> {
    this.record("saveSnapshot", project, label);
  }
  async listSnapshots(): Promise<SnapshotInfo[]> {
    this.record("listSnapshots");
    return [];
  }
  async loadSnapshot(path: string): Promise<ProjectFile> {
    return this.loadProject(path);
  }
  async previewImage(path: string): Promise<ImagePreview> {
    this.record("previewImage", path);
    return { original_width: 100, original_height: 100, preview_width: 50, preview_height: 50, pixels: [] };
  }
  async importImage(path: string, maxDimension: number, crop: CropRect | null, sharp: boolean): Promise<PixelData> {
    this.record("importImage", path, maxDimension, crop, sharp);
    return { width: 10, height: 10, pixels: new Array(300).fill(128) };
  }
  async exportImage(request: ExportImageRequest): Promise<void> {
    this.record("exportImage", request);
  }
  async exportPreview(request: ExportPreviewRequest): Promise<void> {
    this.record("exportPreview", request);
  }
}

describe("PlatformAdapter", () => {
  it("setAdapter and getAdapter work", () => {
    const mock = new MockAdapter();
    setAdapter(mock);
    expect(getAdapter()).toBe(mock);
  });

  it("mock adapter records calls", async () => {
    const mock = new MockAdapter();
    setAdapter(mock);
    const adapter = getAdapter();
    await adapter.showSaveDialog([{ name: "Test", extensions: ["txt"] }], "test.txt");
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].method).toBe("showSaveDialog");
  });

  it("loadProject returns valid structure", async () => {
    const mock = new MockAdapter();
    setAdapter(mock);
    const project = await getAdapter().loadProject("/test");
    expect(project.version).toBe(1);
    expect(project.canvasSize.width).toBe(10);
    expect(project.canvasData).toHaveLength(10);
  });
});
