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

export type EditorTool = "pen" | "eraser" | "eyedropper" | "pan" | "fill" | "line" | "rect" | "circle" | "select" | "wand";

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
}

export interface HistoryEntry {
  row: number;
  col: number;
  prevColorIndex: number | null;
  newColorIndex: number | null;
}

export type HistoryAction = HistoryEntry[];

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
  canvasSize: CanvasSize;
  canvasData: CanvasData;
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
