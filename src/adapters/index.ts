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

  // Auto-save
  getAutosaveDir(): Promise<string>;

  // Snapshots
  saveSnapshot(project: ProjectFile, label: string): Promise<void>;
  listSnapshots(): Promise<SnapshotInfo[]>;
  loadSnapshot(path: string): Promise<ProjectFile>;

  // Image import
  previewImage(path: string): Promise<ImagePreview>;
  importImage(path: string, maxDimension: number, crop: CropRect | null, sharp: boolean, widthRatio?: number): Promise<PixelData>;

  // Image export
  exportImage(request: ExportImageRequest): Promise<void>;
  exportPreview(request: ExportPreviewRequest): Promise<void>;

  // Blueprint import
  importBlueprint(path: string, palette: PaletteColor[], gridWidth?: number, gridHeight?: number, mode?: ImportMode): Promise<BlueprintImportResult>;
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
