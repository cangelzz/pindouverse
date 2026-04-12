import type { ProjectFile } from "../types";

// ─── Shared types for adapter I/O ────────────────────────────────

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface ImagePreview {
  original_width: number;
  original_height: number;
  preview_width: number;
  preview_height: number;
  pixels: number[];
}

export interface PixelData {
  width: number;
  height: number;
  pixels: number[];
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExportImageRequest {
  width: number;
  height: number;
  cell_size: number;
  cells: (null | { color_code: string; r: number; g: number; b: number })[][];
  output_path: string;
  format: "png" | "jpeg";
  start_x: number;
  start_y: number;
  edge_padding: number;
}

export interface ExportPreviewRequest {
  width: number;
  height: number;
  pixel_size: number;
  cells: (null | { color_code: string; r: number; g: number; b: number })[][];
  output_path: string;
}

export interface SnapshotInfo {
  path: string;
  name: string;
  modified: string;
}

// ─── Platform adapter interface ──────────────────────────────────

export interface BlueprintImportResult {
  width: number;
  height: number;
  color_cells: string[][];  // from pixel color matching
  text_cells: string[][];   // from template OCR
  cells: string[][];        // merged result
  mismatch_count: number;
  mismatches: [number, number, string, string][]; // [row, col, color_code, text_code]
  cell_size_detected: number;
  confidence: number;
}

export interface PaletteColor {
  code: string;
  r: number;
  g: number;
  b: number;
}

export interface PlatformAdapter {
  // File dialogs
  showSaveDialog(filters: FileFilter[], defaultPath?: string): Promise<string | null>;
  showOpenDialog(filters: FileFilter[], multiple?: boolean): Promise<string | null>;

  // Project I/O
  saveProject(path: string, project: ProjectFile): Promise<void>;
  loadProject(path: string): Promise<ProjectFile>;

  // Auto-save
  getAutosaveDir(): Promise<string>;

  // Snapshots
  saveSnapshot(project: ProjectFile, label: string): Promise<void>;
  listSnapshots(): Promise<SnapshotInfo[]>;
  loadSnapshot(path: string): Promise<ProjectFile>;

  // Image import
  previewImage(path: string): Promise<ImagePreview>;
  importImage(path: string, maxDimension: number, crop: CropRect | null, sharp: boolean): Promise<PixelData>;

  // Image export
  exportImage(request: ExportImageRequest): Promise<void>;
  exportPreview(request: ExportPreviewRequest): Promise<void>;

  // Blueprint import
  importBlueprint(path: string, palette: PaletteColor[]): Promise<BlueprintImportResult>;
}

// ─── Singleton adapter instance ──────────────────────────────────

let _adapter: PlatformAdapter | null = null;

export function setAdapter(adapter: PlatformAdapter): void {
  _adapter = adapter;
}

export function getAdapter(): PlatformAdapter {
  if (!_adapter) throw new Error("Platform adapter not initialized. Call setAdapter() first.");
  return _adapter;
}
