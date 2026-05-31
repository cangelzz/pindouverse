import { invoke } from "@tauri-apps/api/core";
import { save, open as dialogOpen } from "@tauri-apps/plugin-dialog";
import type { PlatformAdapter, FileFilter, ImagePreview, PixelData, CropRect, ExportImageRequest, ExportPreviewRequest, SnapshotInfo, PaletteColor, BlueprintImportResult, ImportMode } from "./index";
import type { ProjectFile } from "../types";

export class TauriAdapter implements PlatformAdapter {
  async showSaveDialog(filters: FileFilter[], defaultPath?: string): Promise<string | null> {
    const selected = await save({ filters, defaultPath });
    return selected ?? null;
  }

  async showOpenDialog(filters: FileFilter[], multiple = false): Promise<string | null> {
    const selected = await dialogOpen({ filters, multiple });
    return (selected as string) ?? null;
  }

  async saveProject(path: string, project: ProjectFile): Promise<void> {
    await invoke("save_project", { path, project });
  }

  async writeProjectFile(path: string, project: ProjectFile): Promise<void> {
    // Tauri has no editor concept — saveProject already does a plain disk
    // write via the save_project IPC command. Reuse it.
    await invoke("save_project", { path, project });
  }

  async loadProject(path: string): Promise<ProjectFile> {
    return await invoke<ProjectFile>("load_project", { path });
  }

  async getAutosaveDir(): Promise<string> {
    return await invoke<string>("get_autosave_dir");
  }

  async saveSnapshot(project: ProjectFile, label: string): Promise<void> {
    await invoke("save_snapshot", { project, label });
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    return await invoke<SnapshotInfo[]>("list_snapshots");
  }

  async loadSnapshot(path: string): Promise<ProjectFile> {
    return await invoke<ProjectFile>("load_snapshot", { path });
  }

  async deleteSnapshot(path: string): Promise<void> {
    await invoke("delete_snapshot", { path });
  }

  async previewImage(path: string): Promise<ImagePreview> {
    return await invoke<ImagePreview>("preview_image", { path });
  }

  async importImage(path: string, maxDimension: number, crop: CropRect | null, sharp: boolean, widthRatio?: number): Promise<PixelData> {
    return await invoke<PixelData>("import_image", { path, maxDimension, crop, sharp, widthRatio: widthRatio ?? null });
  }

  async exportImage(request: ExportImageRequest): Promise<void> {
    await invoke("export_image", { request });
  }

  async exportPreview(request: ExportPreviewRequest): Promise<void> {
    await invoke("export_preview", { request });
  }

  async importBlueprint(path: string, palette: PaletteColor[], gridWidth?: number, gridHeight?: number, mode?: ImportMode, bbox?: { left: number; top: number; right: number; bottom: number }, _opts?: { onProgress?: (stage: string, fraction: number) => void; signal?: AbortSignal }): Promise<BlueprintImportResult> {
    return await invoke<BlueprintImportResult>("import_blueprint", {
      request: {
        path, palette,
        grid_width: gridWidth ?? null,
        grid_height: gridHeight ?? null,
        bbox_left: bbox?.left ?? null,
        bbox_top: bbox?.top ?? null,
        bbox_right: bbox?.right ?? null,
        bbox_bottom: bbox?.bottom ?? null,
        mode: mode ?? "color_priority",
      },
    });
  }

  async detectBlueprintDims(path: string, bbox?: { left: number; top: number; right: number; bottom: number }, _opts?: { onProgress?: (stage: string, fraction: number) => void; signal?: AbortSignal }): Promise<{ width: number; height: number; cellSize: number; bbox: { left: number; top: number; right: number; bottom: number }; hasMetadata: boolean }> {
    const raw = await invoke<{
      width: number; height: number; cell_size: number;
      bbox_left: number; bbox_top: number; bbox_right: number; bbox_bottom: number;
      has_metadata: boolean;
    }>("detect_blueprint_dims", {
      request: { path, bbox: bbox ? { left: bbox.left, top: bbox.top, right: bbox.right, bottom: bbox.bottom } : null },
    });
    return {
      width: raw.width,
      height: raw.height,
      cellSize: raw.cell_size,
      bbox: { left: raw.bbox_left, top: raw.bbox_top, right: raw.bbox_right, bottom: raw.bbox_bottom },
      hasMetadata: raw.has_metadata,
    };
  }

  async readFileBase64(_path: string): Promise<string> {
    throw new Error("readFileBase64 not used on Tauri; the Rust import command reads the file directly.");
  }
}
