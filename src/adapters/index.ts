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

/** Serialized payload sent to the export backend (TS or Rust). */
export interface WatermarkPayload {
  show_header: boolean;
  app_description: string;
  /** Pre-resolved lines to tile across the grid. Length 0..2. */
  watermark_lines: string[];
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
  watermark?: WatermarkPayload;
}

export interface ExportPreviewRequest {
  width: number;
  height: number;
  pixel_size: number;
  cells: (null | { color_code: string; r: number; g: number; b: number })[][];
  output_path: string;
  watermark?: WatermarkPayload;
}

export interface SnapshotInfo {
  path: string;
  name: string;
  modified: string;
}

// ─── Platform adapter interface ──────────────────────────────────

export type ImportMode = "color_priority" | "text_priority";

export type CellSource = "color" | "text" | "color_fallback";

export interface CellResult {
  color_code: string;
  color_confidence: number;
  text_code: string;
  text_confidence: number;
  final_code: string;
  source: CellSource;
}

export type MismatchSeverity = "low" | "medium" | "high";
export type MismatchRecommendation = "trust_color" | "trust_text" | "manual_review";

export interface Mismatch {
  row: number;
  col: number;
  color_code: string;
  color_confidence: number;
  text_code: string;
  text_confidence: number;
  severity: MismatchSeverity;
  recommendation: MismatchRecommendation;
}

export interface SeveritySummary {
  high: number;
  medium: number;
  low: number;
}

export interface BlueprintImportResult {
  width: number;
  height: number;
  cells: CellResult[][];
  color_cells: string[][];  // legacy: from pixel color matching
  text_cells: string[][];   // legacy: from template OCR
  mismatch_count: number;
  mismatches: Mismatch[];
  severity_summary: SeveritySummary;
  cell_size_detected: number;
  confidence: number;
  mode: ImportMode;
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
  /**
   * Write a ProjectFile to `path` without any editor side effects.
   * Distinct from saveProject: in VS Code, saveProject routes through
   * saveAs (which disposes the current panel and opens the new file as
   * the active editor). writeProjectFile is for "export-only" flows
   * (snapshot export, backups) where the caller must NOT lose its
   * current editing context.
   */
  writeProjectFile(path: string, project: ProjectFile): Promise<void>;

  // Auto-save
  getAutosaveDir(): Promise<string>;

  // Snapshots
  saveSnapshot(project: ProjectFile, label: string): Promise<void>;
  listSnapshots(): Promise<SnapshotInfo[]>;
  loadSnapshot(path: string): Promise<ProjectFile>;
  deleteSnapshot(path: string): Promise<void>;

  // Image import
  previewImage(path: string): Promise<ImagePreview>;
  importImage(path: string, maxDimension: number, crop: CropRect | null, sharp: boolean, widthRatio?: number): Promise<PixelData>;

  // Image export
  exportImage(request: ExportImageRequest): Promise<void>;
  exportPreview(request: ExportPreviewRequest): Promise<void>;

  // Blueprint import
  importBlueprint(path: string, palette: PaletteColor[], gridWidth?: number, gridHeight?: number, mode?: ImportMode, bbox?: { left: number; top: number; right: number; bottom: number }): Promise<BlueprintImportResult>;
  /**
   * Fast pre-detection of grid dimensions for the import dialog. Skips full
   * color sampling — only runs bbox + autocorr + snap-to-lines. Returns
   * `hasMetadata: true` when the PNG carries a pindouverse-blueprint chunk
   * (signals to the UI that the subsequent full import will be exact).
   *
   * When `bbox` is supplied, auto-bbox detection is skipped and the grid is
   * recovered within the user-provided pixel rectangle. Lets the UI redraw
   * the detection region when auto-detect picked the wrong area.
   */
  detectBlueprintDims(path: string, bbox?: { left: number; top: number; right: number; bottom: number }): Promise<{
    width: number;
    height: number;
    cellSize: number;
    bbox: { left: number; top: number; right: number; bottom: number };
    hasMetadata: boolean;
  }>;
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
