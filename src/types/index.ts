export interface MardColor {
  /** Color code, e.g. "M001" */
  code: string;
  /** Color name in Chinese, e.g. "白色" */
  name: string;
  /** Hex string, e.g. "#FFFFFF". Empty string if unknown. */
  hex: string;
  /** RGB tuple [r, g, b]. null if unknown. */
  rgb: [number, number, number] | null;
}

export type EditorTool = "pen" | "eraser" | "eraserFill" | "eyedropper" | "pan" | "fill" | "line" | "rect" | "circle" | "select" | "wand";

export interface CanvasSize {
  width: number;
  height: number;
}

export interface GridConfig {
  /** Grid cell group size (e.g. 5 means 5x5 grouping) */
  groupSize: number;
  /** Padding pixels outside the grid on each edge */
  edgePadding: number;
  /** Starting coordinate label for columns (default 0) */
  startX: number;
  /** Starting coordinate label for rows (default 0) */
  startY: number;
  /** Whether grid lines are visible */
  visible: boolean;
  /** Thin cell border color */
  lineColor: string;
  /** Thin cell border width */
  lineWidth: number;
  /** Thick group divider color */
  groupLineColor: string;
  /** Thick group divider width */
  groupLineWidth: number;
}

export interface CanvasCell {
  /** Index into MARD_COLORS array, or null for empty */
  colorIndex: number | null;
}

export type CanvasData = CanvasCell[][];

export interface BeadLayer {
  id: string;
  name: string;
  data: CanvasData;
  visible: boolean;
  opacity: number; // 0-1
  /** Stable sequence number for a generated name. Display localization is derived and never persisted. */
  defaultNameIndex?: number;
}

export interface HistoryEntry {
  row: number;
  col: number;
  prevColorIndex: number | null;
  newColorIndex: number | null;
}

/** A cell-delta action (drawing/selection edits on the active layer). */
export interface CellsHistoryAction {
  kind: "cells";
  changesByLayer: Array<{ layerId: string; entries: HistoryEntry[] }>;
}

/** A whole-layers snapshot taken before a structural op (e.g. merge). */
export interface LayersHistoryAction {
  kind: "layers";
  layers: BeadLayer[];
  activeLayerId: string;
}

export interface ProjectHistoryPatch {
  canvasSize?: CanvasSize;
  layers?: BeadLayer[];
  activeLayerId?: string;
  gridConfig?: GridConfig;
  projectInfo?: ProjectInfo | null;
  nextDefaultLayerNameIndex?: number;
}

export interface ProjectPatchHistoryAction {
  kind: "projectPatch";
  before: ProjectHistoryPatch;
  after: ProjectHistoryPatch;
}

export type HistoryAction = CellsHistoryAction | LayersHistoryAction | ProjectPatchHistoryAction;

export type ColorMatchAlgorithm = "euclidean" | "ciede2000";

export interface ImportSettings {
  targetWidth: number;
  targetHeight: number;
  algorithm: ColorMatchAlgorithm;
}

export interface ExportSettings {
  cellSize: number;
  format: "png" | "jpeg";
}

export interface BeadCount {
  colorIndex: number;
  code: string;
  name: string;
  hex: string;
  count: number;
}

export interface ProjectInfo {
  title?: string;
  author?: string;
  description?: string;
  link?: string;
}

export interface ProjectFile {
  version: number;
  /** Stable logical project identity. Optional for legacy v1-v3 files. */
  projectId?: string;
  canvasSize: CanvasSize;
  /** Flattened bottom-to-top composite of all visible layers. Always present for
   * back-compat with v1 loaders that don't know about `layers`. */
  canvasData: CanvasData;
  /** Source of truth when present (v2+). Bottom-to-top stacking order. */
  layers?: BeadLayer[];
  gridConfig?: GridConfig;
  projectInfo?: ProjectInfo;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSnapshot {
  id: number;
  timestamp: string;
  label: string;
  canvasSize: CanvasSize;
  canvasData: CanvasData;
}

export interface EditorSessionSnapshot {
  version: 1;
  project: ProjectFile;
  projectGeneration: number;
  revision: number;
  activeLayerId: string;
  nextDefaultLayerNameIndex: number;
  undoStack: HistoryAction[];
  redoStack: HistoryAction[];
  isDirty: boolean;
  baselineCanvasData: CanvasData | null;
  saveStatus: { kind: "saved" | "autosaved"; at: string; revision?: number } | null;
  selection: string[] | null;
  selectionBounds: { r1: number; c1: number; r2: number; c2: number } | null;
  clipboard: { cells: [string, CanvasCell][]; width: number; height: number } | null;
  colorOverrides: [number, { hex: string; rgb: [number, number, number] }][];
  view: {
    zoom: number; cellSize: number; offsetX: number; offsetY: number;
    blueprintMode: boolean; blueprintMirror: boolean; gridFocusMode: boolean;
    currentTool: EditorTool; selectedColorIndex: number | null; highlightColorIndex: number | null;
    beadLayerVisible: boolean; beadLayerOpacity: number; refImagePixels: number[] | null;
    refImageWidth: number; refImageHeight: number; refImageVisible: boolean; refImageOpacity: number;
    showActiveLayerTag: boolean; autoSaveEnabled: boolean; importedFileName: string | null;
    lastEraserSubmode: "eraser" | "eraserFill";
  };
}

export interface ExportWatermarkSettings {
  /** Show top header band with icon + PindouVerse text. Default true. */
  showHeader: boolean;
  /** Tile PindouVerse text at 45° across the grid. Default false. */
  appWatermark: boolean;
  /** Tile resolved author text at 45° across the grid. Default true. */
  authorWatermark: boolean;
  /** Per-session author override; not persisted. Empty falls back to projectInfo.author. */
  authorOverride: string;
}
