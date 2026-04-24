// @pindou/core — shared logic extracted from pindouverse
// Keep in sync with https://github.com/cangelzz/pindouverse

// Types
export type {
  MardColor,
  EditorTool,
  CanvasSize,
  GridConfig,
  CanvasCell,
  CanvasData,
  BeadLayer,
  HistoryEntry,
  HistoryAction,
  ColorMatchAlgorithm,
  ImportSettings,
  ExportSettings,
  BeadCount,
  ProjectInfo,
  ProjectFile,
  ProjectSnapshot,
} from "./types";

// Data
export { MARD_COLORS, COLOR_GROUPS, getGroupIndices } from "./data/mard221";

// Color utilities
export {
  rgbToLab,
  deltaE76,
  euclideanRGB,
} from "./utils/colorConversion";
export type { Lab } from "./utils/colorConversion";

export {
  getEffectiveColor,
  getEffectiveHex,
  loadOverrides,
  saveOverrides,
  hexToRgb,
} from "./utils/colorHelper";
export type { ColorOverrideMap } from "./utils/colorHelper";

export {
  findClosestColor,
  matchImageToMard,
  invalidateLabCache,
} from "./utils/colorMatching";

export { renderPixels } from "./utils/canvasRenderer";
export type { RenderOptions } from "./utils/canvasRenderer";

export { detectPixelGrid } from "./utils/gridDetect";
