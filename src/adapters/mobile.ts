/**
 * Mobile adapter for Tauri v2 (iOS & Android).
 *
 * Extends TauriAdapter since the Rust backend and invoke() API are identical.
 * Overrides dialog behavior for mobile platforms where native file pickers
 * differ from desktop (e.g. no "Save As" dialog — uses app-local storage
 * and share sheet for export).
 */
import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { TauriAdapter } from "./tauri";
import type { FileFilter, ExportImageRequest, ExportPreviewRequest } from "./index";

export class MobileAdapter extends TauriAdapter {
  /**
   * On mobile, "Save" dialog is replaced by saving to app-local storage
   * and returning a generated path. The user shares/exports via share sheet.
   */
  async showSaveDialog(filters: FileFilter[], defaultPath?: string): Promise<string | null> {
    // Generate a path in app-local documents directory
    const dir = await invoke<string>("get_mobile_documents_dir");
    const filename = defaultPath?.split(/[/\\]/).pop() ?? "untitled";
    return `${dir}/${filename}`;
  }

  /**
   * On mobile, use the system file picker (photos/files app).
   */
  async showOpenDialog(filters: FileFilter[]): Promise<string | null> {
    try {
      const selected = await dialogOpen({
        filters,
        multiple: false,
      });
      return (selected as string) ?? null;
    } catch {
      // Fallback: some mobile platforms may not support filters
      const selected = await dialogOpen({ multiple: false });
      return (selected as string) ?? null;
    }
  }

  /**
   * After export, trigger native share sheet so user can save to Photos/Files.
   */
  async exportImage(request: ExportImageRequest): Promise<void> {
    await super.exportImage(request);
    // Trigger share sheet for the exported file
    try {
      await invoke("share_file", { path: request.output_path });
    } catch {
      // Share not available — file is still saved locally
    }
  }

  async exportPreview(request: ExportPreviewRequest): Promise<void> {
    await super.exportPreview(request);
    try {
      await invoke("share_file", { path: request.output_path });
    } catch {
      // Share not available — file is still saved locally
    }
  }
}
