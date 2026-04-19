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

  async importBlueprint(path: string, palette: PaletteColor[], gridWidth?: number, gridHeight?: number, mode?: ImportMode): Promise<BlueprintImportResult> {
    return await invoke<BlueprintImportResult>("import_blueprint", {
      request: { path, palette, grid_width: gridWidth ?? null, grid_height: gridHeight ?? null, mode: mode ?? "color_priority" }
    });
  }
}
