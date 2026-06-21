import { create } from "zustand";
import { getAdapter } from "../adapters";
import type { SnapshotInfo } from "../adapters";
import { loadOverrides, saveOverrides, hexToRgb, type ColorOverrideMap } from "../utils/colorHelper";
import { computeFloodReplaceEntries } from "../utils/floodFill";
import { buildSelectionRemap, type ColorAdjustments } from "../utils/colorAdjust";
import { getGroupIndices } from "../data/mard221";
import type {
  BeadLayer,
  CanvasCell,
  CanvasData,
  CanvasSize,
  CellsHistoryAction,
  EditorTool,
  GridConfig,
  HistoryAction,
  HistoryEntry,
  ProjectFile,
  ProjectInfo,
} from "../types";

interface EditorState {
  // Canvas data (merged view from layers)
  canvasSize: CanvasSize;
  canvasData: CanvasData; // computed merged view
  gridConfig: GridConfig;

  // Multi-layer system
  layers: BeadLayer[];
  activeLayerId: string;

  // Reference image layer (resized original)
  refImagePixels: number[] | null; // flat RGB array
  refImageWidth: number;
  refImageHeight: number;
  refImageVisible: boolean;
  refImageOpacity: number; // 0-1

  // Bead layer
  beadLayerVisible: boolean;
  beadLayerOpacity: number; // 0-1

  // View state
  cellSize: number;
  offsetX: number;
  offsetY: number;
  zoom: number;
  blueprintMode: boolean;
  blueprintMirror: boolean;
  gridFocusMode: boolean;
  voiceControlEnabled: boolean;
  aiVoiceEnabled: boolean; // feature switch for LLM voice, default off
  showActiveLayerTag: boolean; // floating "active layer" tag on canvas, default on

  // Tool state
  currentTool: EditorTool;
  lastEraserSubmode: "eraser" | "eraserFill";
  selectedColorIndex: number | null;
  highlightColorIndex: number | null; // highlight all cells of this color

  // History
  undoStack: HistoryAction[];
  redoStack: HistoryAction[];

  // File state
  projectPath: string | null;
  isDirty: boolean;
  importedFileName: string | null;
  baselineCanvasData: CanvasData | null;
  projectInfo: ProjectInfo | undefined;

  // Cloud sync
  cloudGistId: string | null;
  cloudUpdatedAt: string | null;
  cloudProjectName: string | null;

  // Auto-save state
  lastSavedAt: string | null;
  autoSaveEnabled: boolean;

  // Snapshots
  snapshots: SnapshotInfo[];

  // Beta feature flags (hidden features, default false)
  betaFeatures: {
    blueprintImport: boolean;
    [key: string]: boolean;
  };

  // Custom color groups
  customColorGroups: { id: string; name: string; colorIndices: number[] }[];

  // Color overrides (user calibration)
  colorOverrides: ColorOverrideMap;
  // Selection
  selection: Set<string> | null;
  selectionBounds: { r1: number; c1: number; r2: number; c2: number } | null;
  clipboard: { cells: Map<string, CanvasCell>; width: number; height: number } | null;
  floatingSelection: { cells: Map<string, CanvasCell>; offsetRow: number; offsetCol: number } | null;

  // Transient color-adjust preview. Rendered on top of cells, never in history.
  previewOverlay: Map<string, number> | null;
  adjustSession: { layerId: string; cells: Map<string, number>; srcIndices: number[]; used: number[] } | null;

  // Actions
  newCanvas: (width: number, height: number) => void;
  setCell: (row: number, col: number, colorIndex: number | null) => void;
  batchSetCells: (entries: { row: number; col: number; colorIndex: number | null }[]) => void;
  floodFill: (row: number, col: number, colorIndex: number | null) => void;
  floodErase: (row: number, col: number) => void;
  pickActiveLayerColor: (row: number, col: number) => boolean;
  setTool: (tool: EditorTool) => void;
  setSelectedColor: (index: number | null) => void;
  setZoom: (zoom: number) => void;
  fitToWindow: (containerW: number, containerH: number) => void;
  setOffset: (x: number, y: number) => void;
  setBlueprintMode: (on: boolean) => void;
  setBlueprintMirror: (on: boolean) => void;
  setGridFocusMode: (on: boolean) => void;
  setVoiceControlEnabled: (on: boolean) => void;
  setAiVoiceEnabled: (on: boolean) => void;
  setShowActiveLayerTag: (on: boolean) => void;
  setBetaFeature: (key: string, on: boolean) => void;
  addCustomColorGroup: (name: string) => void;
  removeCustomColorGroup: (id: string) => void;
  renameCustomColorGroup: (id: string, name: string) => void;
  toggleColorInGroup: (groupId: string, colorIndex: number) => void;
  reorderCustomGroupColors: (groupId: string, colorIndices: number[]) => void;
  setColorOverride: (colorIndex: number, hex: string) => void;
  removeColorOverride: (colorIndex: number) => void;
  clearColorOverrides: () => void;
  setGridStartCoords: (startX: number, startY: number) => void;
  setEdgePadding: (padding: number) => void;
  setGridVisible: (visible: boolean) => void;
  setGridLineColor: (color: string) => void;
  setGridLineWidth: (width: number) => void;
  setGridGroupLineColor: (color: string) => void;
  setGridGroupLineWidth: (width: number) => void;
  undo: () => void;
  redo: () => void;
  beginStroke: () => void;
  endStroke: () => void;
  setCloudSync: (gistId: string | null, updatedAt: string | null, name: string | null) => void;
  loadCanvasData: (data: CanvasData, size: CanvasSize) => void;
  /** Restore layered state from a saved ProjectFile. Falls back to single-layer if no layers field. */
  loadProjectLayers: (layers: BeadLayer[], size: CanvasSize) => void;
  resizeCanvas: (newWidth: number, newHeight: number, anchorRow: number, anchorCol: number) => void;
  countLostPixels: (newWidth: number, newHeight: number, anchorRow: number, anchorCol: number) => number;
  setSelection: (cells: Set<string>) => void;
  clearSelection: () => void;
  selectAll: () => void;
  copySelection: () => void;
  /** Copy selection flattened across all VISIBLE layers (top-most non-null wins) into the clipboard. */
  copySelectionAllVisibleLayers: () => void;
  cutSelection: () => void;
  pasteClipboard: () => Promise<void>;
  deleteSelection: () => void;
  /** True if the active layer is empty within the selection but some other VISIBLE layer has content there. */
  selectionOnlyOnOtherLayers: () => boolean;
  commitFloatingSelection: () => void;
  liftSelectionToFloat: () => void;
  setFloatingSelectionOffset: (row: number, col: number) => void;
  /** Flip the floating selection's cells in place within their bbox; stays floating. */
  mirrorFloatingSelection: (direction: "horizontal" | "vertical") => void;
  /** Drop the floating selection without committing it to any layer. */
  discardFloatingSelection: () => void;
  moveSelectionCells: (dRow: number, dCol: number) => void;
  /** Flip selected cells in place within the selection bounds. */
  mirrorSelection: (direction: "horizontal" | "vertical") => void;
  /** Make a draggable floating duplicate without clearing the original cells. */
  duplicateSelectionAsFloating: () => void;
  /** Within selection, swap every cell of `fromIndex` to `toIndex`. */
  replaceColorInSelection: (fromIndex: number, toIndex: number) => void;
  /** Begin a color-adjust session on the current selection. */
  beginSelectionAdjust: () => void;
  /** Recompute the preview overlay for the current adjustment. */
  updateSelectionAdjustPreview: (adj: ColorAdjustments, snapRange: "all" | "used") => void;
  /** Commit the preview overlay as a real batchSetCells action. */
  commitSelectionAdjust: () => void;
  /** Discard the preview overlay without writing any cells. */
  cancelSelectionAdjust: () => void;
  /** Cut selected cells from active layer onto a NEW layer at the same positions. */
  moveSelectionToNewLayer: () => void;
  /** Cut selected cells from active layer onto an existing layer at the same positions. */
  moveSelectionToLayer: (targetLayerId: string) => void;
  placeImageOnCanvas: (
    imageData: CanvasData,
    imageW: number,
    imageH: number,
    canvasW: number,
    canvasH: number,
    startRow: number,
    startCol: number,
  ) => void;
  setProjectPath: (path: string | null) => void;
  setImportedFileName: (name: string | null) => void;
  setProjectInfo: (info: ProjectInfo) => void;

  // Save/Load
  saveProject: () => Promise<void>;
  saveProjectAs: () => Promise<void>;
  openProject: () => Promise<void>;
  autoSave: () => Promise<void>;
  setAutoSaveEnabled: (enabled: boolean) => void;

  // Snapshots
  createSnapshot: (label: string) => Promise<void>;
  loadSnapshots: () => Promise<void>;
  restoreSnapshot: (path: string) => Promise<void>;
  deleteSnapshot: (path: string) => Promise<void>;

  // Reference image
  setRefImage: (pixels: number[], width: number, height: number) => void;
  clearRefImage: () => void;
  setRefImageVisible: (visible: boolean) => void;
  setRefImageOpacity: (opacity: number) => void;

  // Layer management
  addLayer: (name?: string) => void;
  removeLayer: (id: string) => void;
  setActiveLayer: (id: string) => void;
  setLayerVisible: (id: string, visible: boolean) => void;
  setLayerOpacity: (id: string, opacity: number) => void;
  renameLayer: (id: string, name: string) => void;
  duplicateLayer: (id: string) => void;
  moveLayer: (id: string, direction: "up" | "down") => void;
  /** Flatten a layer onto the one below it (upper pixels win). The merged layer keeps the
   *  lower layer's id and name but is always set visible with opacity 1. Undoable via a layers snapshot. */
  mergeLayerDown: (id: string) => void;

  // Highlight & replace
  setHighlightColor: (index: number | null) => void;
  countColor: (index: number) => number;
  replaceColor: (fromIndex: number, toIndex: number) => void;
}

function createEmptyCanvas(width: number, height: number): CanvasData {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, (): CanvasCell => ({ colorIndex: null }))
  );
}

let layerIdCounter = 1;
function nextLayerId(): string {
  return `layer_${layerIdCounter++}`;
}

function createDefaultLayer(width: number, height: number, name = "拼豆层"): BeadLayer {
  return {
    id: nextLayerId(),
    name,
    data: createEmptyCanvas(width, height),
    visible: true,
    opacity: 1,
  };
}

/** Merge layers from bottom to top into a single CanvasData */
function mergeLayers(layers: BeadLayer[], width: number, height: number): CanvasData {
  const merged = createEmptyCanvas(width, height);
  for (const layer of layers) {
    if (!layer.visible) continue;
    for (let r = 0; r < height && r < layer.data.length; r++) {
      for (let c = 0; c < width && c < layer.data[r].length; c++) {
        if (layer.data[r][c].colorIndex !== null) {
          merged[r][c] = layer.data[r][c];
        }
      }
    }
  }
  return merged;
}

/** Resize a single layer's data to new dimensions, placing content at anchor offset */
function resizeLayerData(
  data: CanvasData,
  oldW: number, oldH: number,
  newW: number, newH: number,
  anchorRow: number, anchorCol: number,
): CanvasData {
  const offsetCol = Math.floor(anchorCol * (newW - oldW) / 2);
  const offsetRow = Math.floor(anchorRow * (newH - oldH) / 2);
  const result = createEmptyCanvas(newW, newH);
  for (let r = 0; r < oldH; r++) {
    for (let c = 0; c < oldW; c++) {
      const nr = r + offsetRow;
      const nc = c + offsetCol;
      if (nr >= 0 && nr < newH && nc >= 0 && nc < newW) {
        result[nr][nc] = data[r][c];
      }
    }
  }
  return result;
}

/** Compute default edge padding for a canvas size */
function defaultEdgePadding(width: number, height: number): number {
  const maxBorder = Math.max(width, height);
  if (maxBorder === 104) return 2;
  if (maxBorder === 52) return 1;
  return 0;
}

function computeBounds(cells: Set<string>): { r1: number; c1: number; r2: number; c2: number } {
  let r1 = Infinity, c1 = Infinity, r2 = -Infinity, c2 = -Infinity;
  for (const key of cells) {
    const [r, c] = key.split(",").map(Number);
    if (r < r1) r1 = r;
    if (c < c1) c1 = c;
    if (r > r2) r2 = r;
    if (c > c2) c2 = c;
  }
  return { r1, c1, r2, c2 };
}

function makeGridConfig(width: number, height: number): GridConfig {
  return {
    groupSize: 5,
    edgePadding: defaultEdgePadding(width, height),
    startX: 1,
    startY: 1,
    visible: true,
    lineColor: "rgba(0,0,0,0.15)",
    lineWidth: 1,
    groupLineColor: "rgba(0,0,0,0.5)",
    groupLineWidth: 2,
  };
}

const DEFAULT_GRID_CONFIG: GridConfig = makeGridConfig(52, 52);

const MAX_HISTORY = 200;

let _strokeStartIdx = -1;

function cloneCanvasData(data: CanvasData): CanvasData {
  return data.map(row => row.map(cell => ({ ...cell })));
}

function buildProjectFile(state: EditorState): ProjectFile {
  const now = new Date().toISOString();
  return {
    version: 2,
    canvasSize: state.canvasSize,
    canvasData: state.canvasData,
    layers: state.layers,
    gridConfig: state.gridConfig,
    projectInfo: state.projectInfo,
    createdAt: state.lastSavedAt || now,
    updatedAt: now,
  };
}

const _initLayer = createDefaultLayer(52, 52);

export const useEditorStore = create<EditorState>((set, get) => ({
  canvasSize: { width: 52, height: 52 },
  canvasData: createEmptyCanvas(52, 52),
  gridConfig: DEFAULT_GRID_CONFIG,

  layers: [_initLayer],
  activeLayerId: _initLayer.id,

  refImagePixels: null,
  refImageWidth: 0,
  refImageHeight: 0,
  refImageVisible: true,
  refImageOpacity: 0.3,

  cellSize: 16,
  offsetX: 0,
  offsetY: 0,
  zoom: 1,
  blueprintMode: false,
  blueprintMirror: false,
  gridFocusMode: false,
  voiceControlEnabled: false,
  aiVoiceEnabled: false,
  showActiveLayerTag: true,

  beadLayerVisible: true,
  beadLayerOpacity: 1,

  currentTool: "pan",
  lastEraserSubmode: "eraser",
  selectedColorIndex: 0,
  highlightColorIndex: null,

  undoStack: [],
  redoStack: [],

  projectPath: null,
  isDirty: false,
  baselineCanvasData: null,
  importedFileName: null,
  projectInfo: undefined,
  cloudGistId: null,
  cloudUpdatedAt: null,
  cloudProjectName: null,

  lastSavedAt: null,
  autoSaveEnabled: true,

  snapshots: [],

  betaFeatures: {
    blueprintImport: false,
    aiVoice: false,
  },

  customColorGroups: JSON.parse(localStorage.getItem("pindou_custom_groups") || "[]"),
  colorOverrides: loadOverrides(),

  selection: null,
  selectionBounds: null,
  clipboard: null,
  floatingSelection: null,
  previewOverlay: null,
  adjustSession: null,

  newCanvas: (width, height) => {
    const layer = createDefaultLayer(width, height);
    set({
      canvasSize: { width, height },
      canvasData: createEmptyCanvas(width, height),
      gridConfig: makeGridConfig(width, height),
      layers: [layer],
      activeLayerId: layer.id,
      undoStack: [],
      redoStack: [],
      isDirty: false,
      offsetX: 0,
      offsetY: 0,
      projectPath: null,
      projectInfo: undefined,
      importedFileName: null,
      baselineCanvasData: null,
      refImagePixels: null,
      refImageWidth: 0,
      refImageHeight: 0,
      refImageVisible: true,
      refImageOpacity: 0.3,
      selection: null,
      selectionBounds: null,
      floatingSelection: null,
      cloudGistId: null,
      cloudUpdatedAt: null,
      cloudProjectName: null,
    });
  },

  setCell: (row, col, colorIndex) => {
    const state = get();
    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layer = state.layers[layerIdx];
    if (!layer.visible) return; // don't edit a hidden layer
    const prev = layer.data[row]?.[col]?.colorIndex ?? null;
    if (prev === colorIndex) return;

    const newLayerData = layer.data.map((r) => r.map((c) => ({ ...c })));
    newLayerData[row][col] = { colorIndex };

    const newLayers = [...state.layers];
    newLayers[layerIdx] = { ...layer, data: newLayerData };

    const action: HistoryAction = {
      kind: "cells",
      entries: [{ row, col, prevColorIndex: prev, newColorIndex: colorIndex }],
    };
    const undoStack = [...state.undoStack, action].slice(-MAX_HISTORY);

    set({
      layers: newLayers,
      canvasData: mergeLayers(newLayers, state.canvasSize.width, state.canvasSize.height),
      undoStack,
      redoStack: [],
      isDirty: true,
    });
  },

  batchSetCells: (entries) => {
    const state = get();
    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layer = state.layers[layerIdx];
    if (!layer.visible) return; // don't edit a hidden layer
    const newLayerData = layer.data.map((r) => r.map((c) => ({ ...c })));
    const changedEntries: HistoryEntry[] = [];
    for (const { row, col, colorIndex } of entries) {
      const prev = newLayerData[row]?.[col]?.colorIndex ?? null;
      if (prev !== colorIndex) {
        changedEntries.push({ row, col, prevColorIndex: prev, newColorIndex: colorIndex });
        newLayerData[row][col] = { colorIndex };
      }
    }

    if (changedEntries.length === 0) return;

    const newLayers = [...state.layers];
    newLayers[layerIdx] = { ...layer, data: newLayerData };
    const action: CellsHistoryAction = { kind: "cells", entries: changedEntries };
    const undoStack = [...state.undoStack, action].slice(-MAX_HISTORY);

    set({
      layers: newLayers,
      canvasData: mergeLayers(newLayers, state.canvasSize.width, state.canvasSize.height),
      undoStack,
      redoStack: [],
      isDirty: true,
    });
  },

  floodFill: (row, col, colorIndex) => {
    const state = get();
    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layerData = state.layers[layerIdx].data;
    const entries = computeFloodReplaceEntries(
      layerData,
      row,
      col,
      colorIndex,
      state.canvasSize.width,
      state.canvasSize.height,
    );
    if (entries.length > 0) get().batchSetCells(entries);
  },

  floodErase: (row, col) => {
    get().floodFill(row, col, null);
  },

  setTool: (tool) => set((state) => ({
    currentTool: tool,
    lastEraserSubmode:
      tool === "eraser" || tool === "eraserFill"
        ? tool
        : state.lastEraserSubmode,
  })),
  setSelectedColor: (index) => set({ selectedColorIndex: index }),

  pickActiveLayerColor: (row, col) => {
    const state = get();
    const layer = state.layers.find((l) => l.id === state.activeLayerId);
    const idx = layer?.data[row]?.[col]?.colorIndex;
    if (idx === null || idx === undefined) return false;
    set({ selectedColorIndex: idx });
    return true;
  },

  setZoom: (zoom) => {
    const clamped = Math.max(0.5, Math.min(40, zoom));
    set({ zoom: clamped, cellSize: Math.round(16 * clamped) });
  },

  fitToWindow: (containerW, containerH) => {
    const state = get();
    const { width, height } = state.canvasSize;
    const padding = 20; // px margin
    const zoomX = (containerW - padding * 2) / (width * 16);
    const zoomY = (containerH - padding * 2) / (height * 16);
    const zoom = Math.max(0.5, Math.min(40, Math.min(zoomX, zoomY)));
    const cellSize = Math.round(16 * zoom);
    const offsetX = (containerW - width * cellSize) / 2;
    const offsetY = (containerH - height * cellSize) / 2;
    set({ zoom, cellSize, offsetX, offsetY });
  },

  setOffset: (x, y) => set({ offsetX: x, offsetY: y }),

  setBlueprintMode: (on) => set((state) => ({
    blueprintMode: on,
    currentTool: on ? "pan" : (state.currentTool === "pan" ? "pen" : state.currentTool),
  })),

  setBlueprintMirror: (on) => set({ blueprintMirror: on }),

  setGridFocusMode: (on) => set({ gridFocusMode: on }),

  setVoiceControlEnabled: (on) => set({ voiceControlEnabled: on }),

  setAiVoiceEnabled: (on) => set({ aiVoiceEnabled: on }),

  setShowActiveLayerTag: (on) => set({ showActiveLayerTag: on }),

  setBetaFeature: (key, on) => set((state) => ({
    betaFeatures: { ...state.betaFeatures, [key]: on },
  })),

  addCustomColorGroup: (name) => set((state) => {
    const id = `custom_${Date.now()}`;
    const groups = [...state.customColorGroups, { id, name, colorIndices: [] }];
    localStorage.setItem("pindou_custom_groups", JSON.stringify(groups));
    return { customColorGroups: groups };
  }),

  removeCustomColorGroup: (id) => set((state) => {
    const groups = state.customColorGroups.filter((g) => g.id !== id);
    localStorage.setItem("pindou_custom_groups", JSON.stringify(groups));
    return { customColorGroups: groups };
  }),

  renameCustomColorGroup: (id, name) => set((state) => {
    const groups = state.customColorGroups.map((g) => g.id === id ? { ...g, name } : g);
    localStorage.setItem("pindou_custom_groups", JSON.stringify(groups));
    return { customColorGroups: groups };
  }),

  toggleColorInGroup: (groupId, colorIndex) => set((state) => {
    const groups = state.customColorGroups.map((g) => {
      if (g.id !== groupId) return g;
      const has = g.colorIndices.includes(colorIndex);
      return {
        ...g,
        colorIndices: has
          ? g.colorIndices.filter((i) => i !== colorIndex)
          : [...g.colorIndices, colorIndex],
      };
    });
    localStorage.setItem("pindou_custom_groups", JSON.stringify(groups));
    return { customColorGroups: groups };
  }),

  reorderCustomGroupColors: (groupId, colorIndices) => set((state) => {
    const groups = state.customColorGroups.map((g) =>
      g.id === groupId ? { ...g, colorIndices } : g
    );
    localStorage.setItem("pindou_custom_groups", JSON.stringify(groups));
    return { customColorGroups: groups };
  }),

  setColorOverride: (colorIndex, hex) => set((state) => {
    const overrides = new Map(state.colorOverrides);
    overrides.set(colorIndex, { hex, rgb: hexToRgb(hex) });
    saveOverrides(overrides);
    return { colorOverrides: overrides };
  }),

  removeColorOverride: (colorIndex) => set((state) => {
    const overrides = new Map(state.colorOverrides);
    overrides.delete(colorIndex);
    saveOverrides(overrides);
    return { colorOverrides: overrides };
  }),

  clearColorOverrides: () => {
    saveOverrides(new Map());
    set({ colorOverrides: new Map() });
  },

  setGridStartCoords: (startX, startY) => set((state) => ({
    gridConfig: { ...state.gridConfig, startX, startY },
  })),

  setEdgePadding: (padding) => set((state) => ({
    gridConfig: { ...state.gridConfig, edgePadding: Math.max(0, padding) },
  })),

  setGridVisible: (visible) => set((state) => ({
    gridConfig: { ...state.gridConfig, visible },
  })),

  setGridLineColor: (color) => set((state) => ({
    gridConfig: { ...state.gridConfig, lineColor: color },
  })),

  setGridLineWidth: (width) => set((state) => ({
    gridConfig: { ...state.gridConfig, lineWidth: Math.max(0, width) },
  })),

  setGridGroupLineColor: (color) => set((state) => ({
    gridConfig: { ...state.gridConfig, groupLineColor: color },
  })),

  setGridGroupLineWidth: (width) => set((state) => ({
    gridConfig: { ...state.gridConfig, groupLineWidth: Math.max(0, width) },
  })),

  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;

    const action = state.undoStack[state.undoStack.length - 1];

    if (action.kind === "layers") {
      const current: HistoryAction = { kind: "layers", layers: state.layers, activeLayerId: state.activeLayerId };
      set({
        layers: action.layers,
        activeLayerId: action.activeLayerId,
        canvasData: mergeLayers(action.layers, state.canvasSize.width, state.canvasSize.height),
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, current],
        isDirty: true,
      });
      return;
    }

    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layer = state.layers[layerIdx];
    const newLayerData = layer.data.map((r) => r.map((c) => ({ ...c })));
    for (const entry of action.entries) {
      newLayerData[entry.row][entry.col] = { colorIndex: entry.prevColorIndex };
    }
    const newLayers = [...state.layers];
    newLayers[layerIdx] = { ...layer, data: newLayerData };
    set({
      layers: newLayers,
      canvasData: mergeLayers(newLayers, state.canvasSize.width, state.canvasSize.height),
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, action],
      isDirty: true,
    });
  },

  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;

    const action = state.redoStack[state.redoStack.length - 1];

    if (action.kind === "layers") {
      const current: HistoryAction = { kind: "layers", layers: state.layers, activeLayerId: state.activeLayerId };
      set({
        layers: action.layers,
        activeLayerId: action.activeLayerId,
        canvasData: mergeLayers(action.layers, state.canvasSize.width, state.canvasSize.height),
        undoStack: [...state.undoStack, current],
        redoStack: state.redoStack.slice(0, -1),
        isDirty: true,
      });
      return;
    }

    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layer = state.layers[layerIdx];
    const newLayerData = layer.data.map((r) => r.map((c) => ({ ...c })));
    for (const entry of action.entries) {
      newLayerData[entry.row][entry.col] = { colorIndex: entry.newColorIndex };
    }
    const newLayers = [...state.layers];
    newLayers[layerIdx] = { ...layer, data: newLayerData };
    set({
      layers: newLayers,
      canvasData: mergeLayers(newLayers, state.canvasSize.width, state.canvasSize.height),
      undoStack: [...state.undoStack, action],
      redoStack: state.redoStack.slice(0, -1),
      isDirty: true,
    });
  },

  beginStroke: () => {
    _strokeStartIdx = get().undoStack.length;
  },

  endStroke: () => {
    if (_strokeStartIdx < 0) return;
    const state = get();
    const stack = state.undoStack;
    if (stack.length <= _strokeStartIdx) {
      _strokeStartIdx = -1;
      return;
    }
    // Merge all cell entries since stroke start into one cells-action.
    // Preserve any non-cells (layers) action that somehow landed in range
    // rather than dropping it.
    const merged: HistoryEntry[] = [];
    const layerActions: HistoryAction[] = [];
    for (let i = _strokeStartIdx; i < stack.length; i++) {
      const a = stack[i];
      if (a.kind === "cells") merged.push(...a.entries);
      else layerActions.push(a);
    }
    const cellMap = new Map<string, HistoryEntry>();
    for (const entry of merged) {
      const key = `${entry.row},${entry.col}`;
      if (!cellMap.has(key)) cellMap.set(key, { ...entry });
      else cellMap.get(key)!.newColorIndex = entry.newColorIndex;
    }
    const combinedAction: HistoryAction = { kind: "cells", entries: Array.from(cellMap.values()) };
    const newStack = [...stack.slice(0, _strokeStartIdx), ...layerActions, combinedAction];
    set({ undoStack: newStack });
    _strokeStartIdx = -1;
  },

  setCloudSync: (gistId, updatedAt, name) => set({
    cloudGistId: gistId,
    cloudUpdatedAt: updatedAt,
    cloudProjectName: name,
  }),

  loadCanvasData: (data, size) => {
    const layer = createDefaultLayer(size.width, size.height);
    layer.data = data;
    set({
      canvasData: data,
      canvasSize: size,
      gridConfig: makeGridConfig(size.width, size.height),
      layers: [layer],
      activeLayerId: layer.id,
      undoStack: [],
      redoStack: [],
      isDirty: false,
    });
  },

  loadProjectLayers: (layers, size) => {
    if (!Array.isArray(layers) || layers.length === 0) return;
    // Re-id layers to keep nextLayerId() monotonic and avoid collisions with the
    // current session's counter (saved files may have been authored elsewhere).
    const remapped: BeadLayer[] = layers.map((l) => ({
      id: nextLayerId(),
      name: l.name ?? "拼豆层",
      data: l.data,
      visible: l.visible !== false,
      opacity: typeof l.opacity === "number" ? Math.max(0, Math.min(1, l.opacity)) : 1,
    }));
    set({
      canvasSize: size,
      gridConfig: makeGridConfig(size.width, size.height),
      layers: remapped,
      activeLayerId: remapped[remapped.length - 1].id,
      canvasData: mergeLayers(remapped, size.width, size.height),
      undoStack: [],
      redoStack: [],
      isDirty: false,
    });
  },

  resizeCanvas: (newWidth, newHeight, anchorRow, anchorCol) => {
    const state = get();
    const { width: oldW, height: oldH } = state.canvasSize;
    if (newWidth === oldW && newHeight === oldH) return;

    const newLayers = state.layers.map((layer) => ({
      ...layer,
      data: resizeLayerData(layer.data, oldW, oldH, newWidth, newHeight, anchorRow, anchorCol),
    }));

    set({
      canvasSize: { width: newWidth, height: newHeight },
      canvasData: mergeLayers(newLayers, newWidth, newHeight),
      gridConfig: makeGridConfig(newWidth, newHeight),
      layers: newLayers,
      undoStack: [],
      redoStack: [],
      isDirty: true,
      offsetX: 0,
      offsetY: 0,
    });
  },

  countLostPixels: (newWidth, newHeight, anchorRow, anchorCol) => {
    const state = get();
    const { width: oldW, height: oldH } = state.canvasSize;
    const offsetCol = Math.floor(anchorCol * (newWidth - oldW) / 2);
    const offsetRow = Math.floor(anchorRow * (newHeight - oldH) / 2);
    let lost = 0;
    for (const layer of state.layers) {
      if (!layer.visible) continue;
      for (let r = 0; r < oldH; r++) {
        for (let c = 0; c < oldW; c++) {
          if (layer.data[r][c].colorIndex === null) continue;
          const nr = r + offsetRow;
          const nc = c + offsetCol;
          if (nr < 0 || nr >= newHeight || nc < 0 || nc >= newWidth) {
            lost++;
          }
        }
      }
    }
    return lost;
  },

  setSelection: (cells) => {
    if (cells.size === 0) {
      set({ selection: null, selectionBounds: null });
      return;
    }
    set({ selection: cells, selectionBounds: computeBounds(cells) });
  },

  clearSelection: () => {
    const state = get();
    if (state.floatingSelection) {
      get().commitFloatingSelection();
    }
    set({ selection: null, selectionBounds: null });
  },

  selectAll: () => {
    const state = get();
    const { width, height } = state.canvasSize;
    const cells = new Set<string>();
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        cells.add(`${r},${c}`);
      }
    }
    set({ selection: cells, selectionBounds: { r1: 0, c1: 0, r2: height - 1, c2: width - 1 } });
  },

  copySelection: () => {
    const state = get();
    if (!state.selection || !state.selectionBounds) return;
    const { r1, c1, r2, c2 } = state.selectionBounds;
    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layerData = state.layers[layerIdx].data;
    const cells = new Map<string, CanvasCell>();
    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      const cell = layerData[r]?.[c];
      if (cell && cell.colorIndex !== null) {
        cells.set(`${r - r1},${c - c1}`, { ...cell });
      }
    }
    set({ clipboard: { cells, width: c2 - c1 + 1, height: r2 - r1 + 1 } });
    // Write to system clipboard for cross-window paste
    const data = {
      type: "pindou-selection",
      width: c2 - c1 + 1,
      height: r2 - r1 + 1,
      cells: [...cells.entries()].map(([k, v]) => [k, v.colorIndex]),
    };
    navigator.clipboard.writeText(JSON.stringify(data)).catch(() => {});
  },

  copySelectionAllVisibleLayers: () => {
    const state = get();
    if (!state.selection || !state.selectionBounds) return;
    const { r1, c1, r2, c2 } = state.selectionBounds;
    const cells = new Map<string, CanvasCell>();
    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      let ci: number | null = null;
      for (const l of state.layers) {
        if (!l.visible) continue;
        const v = l.data[r]?.[c]?.colorIndex;
        if (v !== null && v !== undefined) ci = v; // bottom→top, top-most wins
      }
      // Flatten discards per-layer cell metadata by design — only the composited colorIndex is copied.
      if (ci !== null) cells.set(`${r - r1},${c - c1}`, { colorIndex: ci });
    }
    if (cells.size === 0) return;
    set({ clipboard: { cells, width: c2 - c1 + 1, height: r2 - r1 + 1 } });
    const data = {
      type: "pindou-selection",
      width: c2 - c1 + 1,
      height: r2 - r1 + 1,
      cells: [...cells.entries()].map(([k, v]) => [k, v.colorIndex]),
    };
    navigator.clipboard.writeText(JSON.stringify(data)).catch(() => {});
  },

  cutSelection: () => {
    const state = get();
    if (!state.selection) return;
    get().copySelection();
    get().deleteSelection();
  },

  pasteClipboard: async () => {
    const state = get();
    if (state.floatingSelection) {
      get().commitFloatingSelection();
    }

    // Try system clipboard first (cross-window paste)
    let clipData = state.clipboard;
    try {
      const text = await navigator.clipboard.readText();
      const parsed = JSON.parse(text);
      if (parsed?.type === "pindou-selection" && parsed.cells) {
        const cells = new Map<string, CanvasCell>();
        for (const [k, ci] of parsed.cells) {
          cells.set(k, { colorIndex: ci });
        }
        clipData = { cells, width: parsed.width, height: parsed.height };
      }
    } catch {
      // System clipboard unavailable or not pindou data, use local
    }

    if (!clipData) return;
    const { width: cw, height: ch } = get().canvasSize;
    const { width: pw, height: ph } = clipData;
    const offsetRow = Math.floor((ch - ph) / 2);
    const offsetCol = Math.floor((cw - pw) / 2);
    set({
      floatingSelection: {
        cells: new Map(clipData.cells),
        offsetRow,
        offsetCol,
      },
      selection: null,
      selectionBounds: null,
    });
  },

  deleteSelection: () => {
    const state = get();
    if (!state.selection) return;
    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const entries: { row: number; col: number; colorIndex: number | null }[] = [];
    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      entries.push({ row: r, col: c, colorIndex: null });
    }
    if (entries.length > 0) {
      get().batchSetCells(entries);
    }
  },

  selectionOnlyOnOtherLayers: () => {
    const state = get();
    if (!state.selection || state.selection.size === 0) return false;
    const activeIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (activeIdx === -1) return false;
    const active = state.layers[activeIdx];
    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      if (active.data[r]?.[c]?.colorIndex != null) return false; // active has content → not "only other"
    }
    for (let i = 0; i < state.layers.length; i++) {
      if (i === activeIdx) continue;
      const l = state.layers[i];
      if (!l.visible) continue;
      for (const key of state.selection) {
        const [r, c] = key.split(",").map(Number);
        if (l.data[r]?.[c]?.colorIndex != null) return true;
      }
    }
    return false;
  },

  commitFloatingSelection: () => {
    const state = get();
    if (!state.floatingSelection) return;
    const { cells, offsetRow, offsetCol } = state.floatingSelection;
    const { width, height } = state.canvasSize;
    const entries: { row: number; col: number; colorIndex: number | null }[] = [];
    const footprint = new Set<string>();
    for (const [key, cell] of cells) {
      const [lr, lc] = key.split(",").map(Number);
      const r = lr + offsetRow;
      const c = lc + offsetCol;
      if (r >= 0 && r < height && c >= 0 && c < width && cell.colorIndex !== null) {
        entries.push({ row: r, col: c, colorIndex: cell.colorIndex });
        footprint.add(`${r},${c}`);
      }
    }
    if (entries.length > 0) {
      get().batchSetCells(entries);
    }
    if (footprint.size > 0) {
      set({ floatingSelection: null, selection: footprint, selectionBounds: computeBounds(footprint) });
    } else {
      set({ floatingSelection: null, selection: null, selectionBounds: null });
    }
  },

  moveSelectionCells: (dRow, dCol) => {
    const state = get();
    if (!state.selection || !state.selectionBounds) return;
    const { r1, c1 } = state.selectionBounds;
    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layerData = state.layers[layerIdx].data;
    const floatingCells = new Map<string, CanvasCell>();
    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      const cell = layerData[r]?.[c];
      if (cell && cell.colorIndex !== null) {
        floatingCells.set(`${r - r1},${c - c1}`, { ...cell });
      }
    }
    const clearEntries: { row: number; col: number; colorIndex: number | null }[] = [];
    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      clearEntries.push({ row: r, col: c, colorIndex: null });
    }
    if (clearEntries.length > 0) {
      get().batchSetCells(clearEntries);
    }
    set({
      floatingSelection: {
        cells: floatingCells,
        offsetRow: r1 + dRow,
        offsetCol: c1 + dCol,
      },
      selection: null,
      selectionBounds: null,
    });
  },

  liftSelectionToFloat: () => {
    const state = get();
    if (!state.selection || !state.selectionBounds) return;
    const { r1, c1 } = state.selectionBounds;
    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layerData = state.layers[layerIdx].data;
    const floatingCells = new Map<string, CanvasCell>();
    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      const cell = layerData[r]?.[c];
      if (cell && cell.colorIndex !== null) {
        floatingCells.set(`${r - r1},${c - c1}`, { ...cell });
      }
    }
    const clearEntries: { row: number; col: number; colorIndex: number | null }[] = [];
    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      clearEntries.push({ row: r, col: c, colorIndex: null });
    }
    if (clearEntries.length > 0) {
      get().batchSetCells(clearEntries);
    }
    set({
      floatingSelection: { cells: floatingCells, offsetRow: r1, offsetCol: c1 },
      selection: null,
      selectionBounds: null,
    });
  },

  mirrorSelection: (direction) => {
    const state = get();
    if (!state.selection || !state.selectionBounds) return;
    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layerData = state.layers[layerIdx].data;
    const { r1, c1, r2, c2 } = state.selectionBounds;

    // Snapshot the selection's cells by position so we can write the mirrored
    // values in a single pass without source/destination interference.
    const snapshot = new Map<string, number | null>();
    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      snapshot.set(key, layerData[r]?.[c]?.colorIndex ?? null);
    }

    const entries: { row: number; col: number; colorIndex: number | null }[] = [];
    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      const srcR = direction === "vertical" ? r2 - (r - r1) : r;
      const srcC = direction === "horizontal" ? c2 - (c - c1) : c;
      const srcVal = snapshot.get(`${srcR},${srcC}`);
      entries.push({ row: r, col: c, colorIndex: srcVal ?? null });
    }
    if (entries.length > 0) get().batchSetCells(entries);
  },

  duplicateSelectionAsFloating: () => {
    const state = get();
    if (!state.selection || !state.selectionBounds) return;
    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layerData = state.layers[layerIdx].data;
    const { r1, c1 } = state.selectionBounds;
    const floatingCells = new Map<string, CanvasCell>();
    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      const cell = layerData[r]?.[c];
      if (cell && cell.colorIndex !== null) {
        floatingCells.set(`${r - r1},${c - c1}`, { ...cell });
      }
    }
    if (floatingCells.size === 0) return;
    set({
      floatingSelection: { cells: floatingCells, offsetRow: r1, offsetCol: c1 },
      selection: null,
      selectionBounds: null,
    });
  },

  replaceColorInSelection: (fromIndex, toIndex) => {
    const state = get();
    if (fromIndex === toIndex) return;
    if (!state.selection) return;
    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layerData = state.layers[layerIdx].data;
    const entries: { row: number; col: number; colorIndex: number | null }[] = [];
    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      if (layerData[r]?.[c]?.colorIndex === fromIndex) {
        entries.push({ row: r, col: c, colorIndex: toIndex });
      }
    }
    if (entries.length > 0) get().batchSetCells(entries);
  },

  beginSelectionAdjust: () => {
    const state = get();
    if (!state.selection) return;
    const layer = state.layers.find((l) => l.id === state.activeLayerId);
    if (!layer) return;

    const cells = new Map<string, number>();
    const srcSet = new Set<number>();
    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      const ci = layer.data[r]?.[c]?.colorIndex;
      if (ci !== null && ci !== undefined) {
        cells.set(key, ci);
        srcSet.add(ci);
      }
    }

    const used = new Set<number>();
    for (const l of state.layers) {
      for (const row of l.data) {
        for (const cell of row) {
          if (cell.colorIndex !== null && cell.colorIndex !== undefined) used.add(cell.colorIndex);
        }
      }
    }

    set({
      adjustSession: { layerId: state.activeLayerId, cells, srcIndices: [...srcSet], used: [...used] },
      previewOverlay: new Map(),
    });
  },

  updateSelectionAdjustPreview: (adj, snapRange) => {
    const state = get();
    const session = state.adjustSession;
    if (!session) return;
    const pool = snapRange === "used" ? session.used : getGroupIndices("mard221");
    const remap = buildSelectionRemap(session.srcIndices, adj, pool, "ciede2000", state.colorOverrides);
    const overlay = new Map<string, number>();
    for (const [key, src] of session.cells) {
      const dst = remap.get(src);
      if (dst !== undefined && dst !== src) overlay.set(key, dst);
    }
    set({ previewOverlay: overlay });
  },

  commitSelectionAdjust: () => {
    const state = get();
    if (!state.previewOverlay) return;
    // Guard against the active layer changing while the dialog was open: the
    // overlay was computed from the original layer, so committing it to a
    // different layer would write wrong colors. Abort instead.
    if (state.adjustSession && state.adjustSession.layerId !== state.activeLayerId) {
      set({ previewOverlay: null, adjustSession: null });
      return;
    }
    const entries: { row: number; col: number; colorIndex: number | null }[] = [];
    for (const [key, dst] of state.previewOverlay) {
      const [r, c] = key.split(",").map(Number);
      entries.push({ row: r, col: c, colorIndex: dst });
    }
    if (entries.length > 0) get().batchSetCells(entries);
    set({ previewOverlay: null, adjustSession: null });
  },

  cancelSelectionAdjust: () => {
    set({ previewOverlay: null, adjustSession: null });
  },

  moveSelectionToNewLayer: () => {
    const state = get();
    if (!state.selection || !state.selectionBounds) return;
    const sourceIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (sourceIdx === -1) return;
    const sourceLayer = state.layers[sourceIdx];

    // Build the new layer's data starting from an empty canvas, with cells
    // from the source written at the same positions.
    const { width, height } = state.canvasSize;
    const newLayer = createDefaultLayer(width, height, `图层 ${state.layers.length + 1}`);
    const newLayerData = newLayer.data.map((row) => row.map((c) => ({ ...c })));
    const clearedSourceData = sourceLayer.data.map((row) => row.map((c) => ({ ...c })));

    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      const srcCell = sourceLayer.data[r]?.[c];
      if (srcCell && srcCell.colorIndex !== null) {
        newLayerData[r][c] = { ...srcCell };
        clearedSourceData[r][c] = { colorIndex: null };
      }
    }

    const newLayers = [...state.layers];
    newLayers[sourceIdx] = { ...sourceLayer, data: clearedSourceData };
    newLayers.push({ ...newLayer, data: newLayerData });

    set({
      layers: newLayers,
      activeLayerId: newLayer.id,
      canvasData: mergeLayers(newLayers, width, height),
      undoStack: [],
      redoStack: [],
      isDirty: true,
    });
  },

  moveSelectionToLayer: (targetLayerId) => {
    const state = get();
    if (!state.selection || !state.selectionBounds) return;
    if (targetLayerId === state.activeLayerId) return;
    const sourceIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    const targetIdx = state.layers.findIndex((l) => l.id === targetLayerId);
    if (sourceIdx === -1 || targetIdx === -1) return;

    const sourceLayer = state.layers[sourceIdx];
    const targetLayer = state.layers[targetIdx];
    const newSourceData = sourceLayer.data.map((row) => row.map((c) => ({ ...c })));
    const newTargetData = targetLayer.data.map((row) => row.map((c) => ({ ...c })));

    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      const srcCell = sourceLayer.data[r]?.[c];
      if (srcCell && srcCell.colorIndex !== null) {
        newTargetData[r][c] = { ...srcCell };
        newSourceData[r][c] = { colorIndex: null };
      }
    }

    const newLayers = [...state.layers];
    newLayers[sourceIdx] = { ...sourceLayer, data: newSourceData };
    newLayers[targetIdx] = { ...targetLayer, data: newTargetData };

    const { width, height } = state.canvasSize;
    set({
      layers: newLayers,
      activeLayerId: targetLayerId,
      canvasData: mergeLayers(newLayers, width, height),
      undoStack: [],
      redoStack: [],
      isDirty: true,
    });
  },

  setFloatingSelectionOffset: (row, col) => {
    const state = get();
    if (!state.floatingSelection) return;
    set({ floatingSelection: { ...state.floatingSelection, offsetRow: row, offsetCol: col } });
  },

  mirrorFloatingSelection: (direction) => {
    const state = get();
    const fs = state.floatingSelection;
    if (!fs) return;
    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
    for (const key of fs.cells.keys()) {
      const [lr, lc] = key.split(",").map(Number);
      if (lr < minR) minR = lr;
      if (lr > maxR) maxR = lr;
      if (lc < minC) minC = lc;
      if (lc > maxC) maxC = lc;
    }
    if (minR === Infinity) return;
    const newCells = new Map<string, CanvasCell>();
    for (const [key, cell] of fs.cells) {
      const [lr, lc] = key.split(",").map(Number);
      const nr = direction === "vertical" ? minR + maxR - lr : lr;
      const nc = direction === "horizontal" ? minC + maxC - lc : lc;
      newCells.set(`${nr},${nc}`, { ...cell });
    }
    // Float is ephemeral (not serialized to the project), so no isDirty — same as setFloatingSelectionOffset.
    set({ floatingSelection: { cells: newCells, offsetRow: fs.offsetRow, offsetCol: fs.offsetCol } });
  },

  discardFloatingSelection: () => set({ floatingSelection: null }),

  placeImageOnCanvas: (imageData, imageW, imageH, canvasW, canvasH, startRow, startCol) => {
    const layer = createDefaultLayer(canvasW, canvasH);
    for (let r = 0; r < imageH; r++) {
      for (let c = 0; c < imageW; c++) {
        const tr = startRow + r;
        const tc = startCol + c;
        if (tr >= 0 && tr < canvasH && tc >= 0 && tc < canvasW) {
          layer.data[tr][tc] = imageData[r][c];
        }
      }
    }
    set({
      canvasData: layer.data,
      canvasSize: { width: canvasW, height: canvasH },
      gridConfig: makeGridConfig(canvasW, canvasH),
      layers: [layer],
      activeLayerId: layer.id,
      undoStack: [],
      redoStack: [],
      isDirty: false,
    });
  },

  setProjectPath: (path) => set({ projectPath: path }),
  setImportedFileName: (name: string | null) => set({ importedFileName: name }),
  setProjectInfo: (info: ProjectInfo) => set({ projectInfo: info, isDirty: true }),

  saveProject: async () => {
    const adapter = getAdapter();
    const state = get();
    let path = state.projectPath;
    if (!path) {
      const selected = await adapter.showSaveDialog(
        [{ name: "PinDou Project", extensions: ["pindou"] }],
        "untitled.pindou",
      );
      if (!selected) return;
      path = selected;
    }
    const project = buildProjectFile(state);
    await adapter.saveProject(path, project);
    const now = new Date().toLocaleTimeString();
    set({ projectPath: path, isDirty: false, lastSavedAt: now, baselineCanvasData: cloneCanvasData(state.canvasData) });
  },

  saveProjectAs: async () => {
    const adapter = getAdapter();
    const state = get();
    const selected = await adapter.showSaveDialog(
      [{ name: "PinDou Project", extensions: ["pindou"] }],
      state.projectPath || "untitled.pindou",
    );
    if (!selected) return;
    const project = buildProjectFile(state);
    await adapter.saveProject(selected, project);
    const now = new Date().toLocaleTimeString();
    set({ projectPath: selected, isDirty: false, lastSavedAt: now, baselineCanvasData: cloneCanvasData(state.canvasData) });
  },

  openProject: async () => {
    const adapter = getAdapter();
    const selected = await adapter.showOpenDialog(
      [{ name: "PinDou Project", extensions: ["pindou"] }],
    );
    if (!selected) return;
    const project = await adapter.loadProject(selected);
    const defaultGrid = makeGridConfig(project.canvasSize.width, project.canvasSize.height);
    const savedGrid = project.gridConfig;
    const hasLayers = Array.isArray(project.layers) && project.layers.length > 0;
    const restoredLayers: BeadLayer[] = hasLayers
      ? project.layers!.map((l) => ({
          id: nextLayerId(),
          name: l.name ?? "拼豆层",
          data: l.data,
          visible: l.visible !== false,
          opacity: typeof l.opacity === "number" ? Math.max(0, Math.min(1, l.opacity)) : 1,
        }))
      : (() => {
          const layer = createDefaultLayer(project.canvasSize.width, project.canvasSize.height);
          layer.data = project.canvasData;
          return [layer];
        })();
    const mergedCanvas = hasLayers
      ? mergeLayers(restoredLayers, project.canvasSize.width, project.canvasSize.height)
      : project.canvasData;
    set({
      canvasData: mergedCanvas,
      canvasSize: project.canvasSize,
      gridConfig: savedGrid ? { ...defaultGrid, ...savedGrid } : defaultGrid,
      layers: restoredLayers,
      activeLayerId: restoredLayers[restoredLayers.length - 1].id,
      projectPath: selected as string,
      projectInfo: project.projectInfo,
      baselineCanvasData: cloneCanvasData(mergedCanvas),
      undoStack: [],
      redoStack: [],
      isDirty: false,
      lastSavedAt: new Date().toLocaleTimeString(),
      offsetX: 0,
      offsetY: 0,
      refImagePixels: null,
      refImageWidth: 0,
      refImageHeight: 0,
      refImageVisible: true,
      refImageOpacity: 0.3,
      selection: null,
      selectionBounds: null,
      floatingSelection: null,
      cloudGistId: null,
      cloudUpdatedAt: null,
      cloudProjectName: null,
    });
  },

  autoSave: async () => {
    const adapter = getAdapter();
    const state = get();
    if (!state.autoSaveEnabled || !state.isDirty) return;

    try {
      const dir = await adapter.getAutosaveDir();
      const path = `${dir}\\autosave.pindou`;
      const project = buildProjectFile(state);
      await adapter.saveProject(path, project);
      const now = new Date().toLocaleTimeString();
      // Don't clear isDirty — autosave is a backup, not a real save to the original file
      set({ lastSavedAt: `自动备份 ${now}` });
    } catch {
      // Silent fail for auto-save
    }
  },

  setAutoSaveEnabled: (enabled) => set({ autoSaveEnabled: enabled }),

  createSnapshot: async (label) => {
    const adapter = getAdapter();
    const state = get();
    const project = buildProjectFile(state);
    await adapter.saveSnapshot(project, label);
    await get().loadSnapshots();
  },

  loadSnapshots: async () => {
    try {
      const adapter = getAdapter();
      const snapshots = await adapter.listSnapshots();
      set({ snapshots });
    } catch {
      set({ snapshots: [] });
    }
  },

  restoreSnapshot: async (path) => {
    const adapter = getAdapter();
    const project = await adapter.loadSnapshot(path);
    const hasLayers = Array.isArray(project.layers) && project.layers.length > 0;
    const restoredLayers: BeadLayer[] = hasLayers
      ? project.layers!.map((l) => ({
          id: nextLayerId(),
          name: l.name ?? "拼豆层",
          data: l.data,
          visible: l.visible !== false,
          opacity: typeof l.opacity === "number" ? Math.max(0, Math.min(1, l.opacity)) : 1,
        }))
      : (() => {
          const layer = createDefaultLayer(project.canvasSize.width, project.canvasSize.height);
          layer.data = project.canvasData;
          return [layer];
        })();
    const mergedCanvas = hasLayers
      ? mergeLayers(restoredLayers, project.canvasSize.width, project.canvasSize.height)
      : project.canvasData;
    set({
      canvasData: mergedCanvas,
      canvasSize: project.canvasSize,
      layers: restoredLayers,
      activeLayerId: restoredLayers[restoredLayers.length - 1].id,
      undoStack: [],
      redoStack: [],
      isDirty: false,
      lastSavedAt: new Date().toLocaleTimeString(),
      offsetX: 0,
      offsetY: 0,
    });
  },

  deleteSnapshot: async (path) => {
    const adapter = getAdapter();
    await adapter.deleteSnapshot(path);
    await get().loadSnapshots();
  },

  setRefImage: (pixels, width, height) =>
    set({ refImagePixels: pixels, refImageWidth: width, refImageHeight: height }),
  clearRefImage: () =>
    set({ refImagePixels: null, refImageWidth: 0, refImageHeight: 0 }),
  setRefImageVisible: (visible) => set({ refImageVisible: visible }),
  setRefImageOpacity: (opacity) => set({ refImageOpacity: Math.max(0, Math.min(1, opacity)) }),

  // Layer management
  addLayer: (name) => {
    const state = get();
    const layer = createDefaultLayer(state.canvasSize.width, state.canvasSize.height, name || `图层 ${state.layers.length + 1}`);
    const newLayers = [...state.layers, layer];
    set({ layers: newLayers, activeLayerId: layer.id });
  },

  removeLayer: (id) => {
    const state = get();
    if (state.layers.length <= 1) return; // keep at least 1
    const newLayers = state.layers.filter((l) => l.id !== id);
    const newActive = state.activeLayerId === id ? newLayers[newLayers.length - 1].id : state.activeLayerId;
    set({
      layers: newLayers,
      activeLayerId: newActive,
      canvasData: mergeLayers(newLayers, state.canvasSize.width, state.canvasSize.height),
      undoStack: [],
      redoStack: [],
      isDirty: true,
    });
  },

  setActiveLayer: (id) => set({ activeLayerId: id, undoStack: [], redoStack: [] }),

  setLayerVisible: (id, visible) => {
    const state = get();
    const newLayers = state.layers.map((l) => l.id === id ? { ...l, visible } : l);
    set({
      layers: newLayers,
      canvasData: mergeLayers(newLayers, state.canvasSize.width, state.canvasSize.height),
    });
  },

  setLayerOpacity: (id, opacity) => {
    const state = get();
    const newLayers = state.layers.map((l) => l.id === id ? { ...l, opacity: Math.max(0, Math.min(1, opacity)) } : l);
    set({ layers: newLayers });
  },

  renameLayer: (id, name) => {
    const state = get();
    const newLayers = state.layers.map((l) => l.id === id ? { ...l, name } : l);
    set({ layers: newLayers });
  },

  duplicateLayer: (id) => {
    const state = get();
    const src = state.layers.find((l) => l.id === id);
    if (!src) return;
    const copy: BeadLayer = {
      id: nextLayerId(),
      name: `${src.name} 副本`,
      data: src.data.map((r) => r.map((c) => ({ ...c }))),
      visible: true,
      opacity: src.opacity,
    };
    const idx = state.layers.findIndex((l) => l.id === id);
    const newLayers = [...state.layers];
    newLayers.splice(idx + 1, 0, copy);
    set({
      layers: newLayers,
      activeLayerId: copy.id,
      canvasData: mergeLayers(newLayers, state.canvasSize.width, state.canvasSize.height),
      isDirty: true,
    });
  },

  moveLayer: (id, direction) => {
    const state = get();
    const idx = state.layers.findIndex((l) => l.id === id);
    if (idx === -1) return;
    const newIdx = direction === "up" ? idx + 1 : idx - 1;
    if (newIdx < 0 || newIdx >= state.layers.length) return;
    const newLayers = [...state.layers];
    [newLayers[idx], newLayers[newIdx]] = [newLayers[newIdx], newLayers[idx]];
    set({
      layers: newLayers,
      canvasData: mergeLayers(newLayers, state.canvasSize.width, state.canvasSize.height),
    });
  },

  mergeLayerDown: (id) => {
    const state = get();
    const idx = state.layers.findIndex((l) => l.id === id);
    if (idx <= 0) return; // bottom layer or not found — nothing below to merge into
    const upper = state.layers[idx];
    const lower = state.layers[idx - 1];
    const { width, height } = state.canvasSize;

    const mergedData = lower.data.map((row) => row.map((c) => ({ ...c })));
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const up = upper.data[r]?.[c]?.colorIndex;
        if (up !== null && up !== undefined) mergedData[r][c] = { colorIndex: up };
      }
    }
    const mergedLayer = { ...lower, data: mergedData, visible: true, opacity: 1 };

    const newLayers = [...state.layers];
    newLayers[idx - 1] = mergedLayer;
    newLayers.splice(idx, 1);

    const snapshot: HistoryAction = { kind: "layers", layers: state.layers, activeLayerId: state.activeLayerId };
    const undoStack = [...state.undoStack, snapshot].slice(-MAX_HISTORY);

    set({
      layers: newLayers,
      activeLayerId: mergedLayer.id,
      canvasData: mergeLayers(newLayers, width, height),
      undoStack,
      redoStack: [],
      isDirty: true,
    });
  },

  setHighlightColor: (index) => set({ highlightColorIndex: index }),

  countColor: (index) => {
    const { canvasData } = get();
    let count = 0;
    for (const row of canvasData) {
      for (const cell of row) {
        if (cell.colorIndex === index) count++;
      }
    }
    return count;
  },

  replaceColor: (fromIndex, toIndex) => {
    const state = get();
    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layer = state.layers[layerIdx];
    const newLayerData = layer.data.map((r) => r.map((c) => ({ ...c })));
    const entries: HistoryEntry[] = [];

    for (let row = 0; row < newLayerData.length; row++) {
      for (let col = 0; col < newLayerData[row].length; col++) {
        if (newLayerData[row][col].colorIndex === fromIndex) {
          entries.push({ row, col, prevColorIndex: fromIndex, newColorIndex: toIndex });
          newLayerData[row][col] = { colorIndex: toIndex };
        }
      }
    }

    if (entries.length === 0) return;

    const newLayers = [...state.layers];
    newLayers[layerIdx] = { ...layer, data: newLayerData };
    const action: CellsHistoryAction = { kind: "cells", entries };
    const undoStack = [...state.undoStack, action].slice(-MAX_HISTORY);
    set({
      layers: newLayers,
      canvasData: mergeLayers(newLayers, state.canvasSize.width, state.canvasSize.height),
      undoStack,
      redoStack: [],
      isDirty: true,
    });
  },
}));
