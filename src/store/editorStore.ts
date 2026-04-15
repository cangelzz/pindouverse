import { create } from "zustand";
import { getAdapter } from "../adapters";
import type { SnapshotInfo } from "../adapters";
import type {
  BeadLayer,
  CanvasCell,
  CanvasData,
  CanvasSize,
  EditorTool,
  GridConfig,
  HistoryAction,
  ProjectFile,
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

  // Tool state
  currentTool: EditorTool;
  selectedColorIndex: number | null;
  highlightColorIndex: number | null; // highlight all cells of this color

  // History
  undoStack: HistoryAction[];
  redoStack: HistoryAction[];

  // File state
  projectPath: string | null;
  isDirty: boolean;
  importedFileName: string | null;

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

  // Selection
  selection: Set<string> | null;
  selectionBounds: { r1: number; c1: number; r2: number; c2: number } | null;
  clipboard: { cells: Map<string, CanvasCell>; width: number; height: number } | null;
  floatingSelection: { cells: Map<string, CanvasCell>; offsetRow: number; offsetCol: number } | null;

  // Actions
  newCanvas: (width: number, height: number) => void;
  setCell: (row: number, col: number, colorIndex: number | null) => void;
  batchSetCells: (entries: { row: number; col: number; colorIndex: number | null }[]) => void;
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
  setBetaFeature: (key: string, on: boolean) => void;
  addCustomColorGroup: (name: string) => void;
  removeCustomColorGroup: (id: string) => void;
  renameCustomColorGroup: (id: string, name: string) => void;
  toggleColorInGroup: (groupId: string, colorIndex: number) => void;
  reorderCustomGroupColors: (groupId: string, colorIndices: number[]) => void;
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
  resizeCanvas: (newWidth: number, newHeight: number, anchorRow: number, anchorCol: number) => void;
  countLostPixels: (newWidth: number, newHeight: number, anchorRow: number, anchorCol: number) => number;
  setSelection: (cells: Set<string>) => void;
  clearSelection: () => void;
  selectAll: () => void;
  copySelection: () => void;
  cutSelection: () => void;
  pasteClipboard: () => void;
  deleteSelection: () => void;
  commitFloatingSelection: () => void;
  liftSelectionToFloat: () => void;
  setFloatingSelectionOffset: (row: number, col: number) => void;
  moveSelectionCells: (dRow: number, dCol: number) => void;
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

function buildProjectFile(state: EditorState): ProjectFile {
  const now = new Date().toISOString();
  return {
    version: 1,
    canvasSize: state.canvasSize,
    canvasData: state.canvasData,
    gridConfig: state.gridConfig,
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

  beadLayerVisible: true,
  beadLayerOpacity: 1,

  currentTool: "pen",
  selectedColorIndex: 0,
  highlightColorIndex: null,

  undoStack: [],
  redoStack: [],

  projectPath: null,
  isDirty: false,
  importedFileName: null,
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

  selection: null,
  selectionBounds: null,
  clipboard: null,
  floatingSelection: null,

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
    const prev = layer.data[row]?.[col]?.colorIndex ?? null;
    if (prev === colorIndex) return;

    const newLayerData = layer.data.map((r) => r.map((c) => ({ ...c })));
    newLayerData[row][col] = { colorIndex };

    const newLayers = [...state.layers];
    newLayers[layerIdx] = { ...layer, data: newLayerData };

    const action: HistoryAction = [
      { row, col, prevColorIndex: prev, newColorIndex: colorIndex },
    ];
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
    const newLayerData = layer.data.map((r) => r.map((c) => ({ ...c })));
    const action: HistoryAction = [];

    for (const { row, col, colorIndex } of entries) {
      const prev = newLayerData[row]?.[col]?.colorIndex ?? null;
      if (prev !== colorIndex) {
        action.push({ row, col, prevColorIndex: prev, newColorIndex: colorIndex });
        newLayerData[row][col] = { colorIndex };
      }
    }

    if (action.length === 0) return;

    const newLayers = [...state.layers];
    newLayers[layerIdx] = { ...layer, data: newLayerData };
    const undoStack = [...state.undoStack, action].slice(-MAX_HISTORY);

    set({
      layers: newLayers,
      canvasData: mergeLayers(newLayers, state.canvasSize.width, state.canvasSize.height),
      undoStack,
      redoStack: [],
      isDirty: true,
    });
  },

  setTool: (tool) => set({ currentTool: tool }),
  setSelectedColor: (index) => set({ selectedColorIndex: index }),

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
    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layer = state.layers[layerIdx];
    const newLayerData = layer.data.map((r) => r.map((c) => ({ ...c })));

    for (const entry of action) {
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
    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layer = state.layers[layerIdx];
    const newLayerData = layer.data.map((r) => r.map((c) => ({ ...c })));

    for (const entry of action) {
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
    // Merge all actions since stroke start into one
    const merged: HistoryAction = [];
    for (let i = _strokeStartIdx; i < stack.length; i++) {
      merged.push(...stack[i]);
    }
    // Deduplicate: keep first prev and last new for each cell
    const cellMap = new Map<string, { row: number; col: number; prevColorIndex: number | null; newColorIndex: number | null }>();
    for (const entry of merged) {
      const key = `${entry.row},${entry.col}`;
      if (!cellMap.has(key)) {
        cellMap.set(key, { ...entry });
      } else {
        cellMap.get(key)!.newColorIndex = entry.newColorIndex;
      }
    }
    const combinedAction: HistoryAction = Array.from(cellMap.values());
    const newStack = [...stack.slice(0, _strokeStartIdx), combinedAction];
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
  },

  cutSelection: () => {
    const state = get();
    if (!state.selection) return;
    get().copySelection();
    get().deleteSelection();
  },

  pasteClipboard: () => {
    const state = get();
    if (!state.clipboard) return;
    if (state.floatingSelection) {
      get().commitFloatingSelection();
    }
    const { width: cw, height: ch } = state.canvasSize;
    const { width: pw, height: ph } = state.clipboard;
    const offsetRow = Math.floor((ch - ph) / 2);
    const offsetCol = Math.floor((cw - pw) / 2);
    set({
      floatingSelection: {
        cells: new Map(state.clipboard.cells),
        offsetRow,
        offsetCol,
      },
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

  commitFloatingSelection: () => {
    const state = get();
    if (!state.floatingSelection) return;
    const { cells, offsetRow, offsetCol } = state.floatingSelection;
    const { width, height } = state.canvasSize;
    const entries: { row: number; col: number; colorIndex: number | null }[] = [];
    for (const [key, cell] of cells) {
      const [lr, lc] = key.split(",").map(Number);
      const r = lr + offsetRow;
      const c = lc + offsetCol;
      if (r >= 0 && r < height && c >= 0 && c < width && cell.colorIndex !== null) {
        entries.push({ row: r, col: c, colorIndex: cell.colorIndex });
      }
    }
    if (entries.length > 0) {
      get().batchSetCells(entries);
    }
    set({ floatingSelection: null, selection: null, selectionBounds: null });
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

  setFloatingSelectionOffset: (row, col) => {
    const state = get();
    if (!state.floatingSelection) return;
    set({ floatingSelection: { ...state.floatingSelection, offsetRow: row, offsetCol: col } });
  },

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
    set({ projectPath: path, isDirty: false, lastSavedAt: now });
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
    set({ projectPath: selected, isDirty: false, lastSavedAt: now });
  },

  openProject: async () => {
    const adapter = getAdapter();
    const selected = await adapter.showOpenDialog(
      [{ name: "PinDou Project", extensions: ["pindou"] }],
    );
    if (!selected) return;
    const project = await adapter.loadProject(selected);
    const layer = createDefaultLayer(project.canvasSize.width, project.canvasSize.height);
    layer.data = project.canvasData;
    const defaultGrid = makeGridConfig(project.canvasSize.width, project.canvasSize.height);
    const savedGrid = project.gridConfig;
    set({
      canvasData: project.canvasData,
      canvasSize: project.canvasSize,
      gridConfig: savedGrid ? { ...defaultGrid, ...savedGrid } : defaultGrid,
      layers: [layer],
      activeLayerId: layer.id,
      projectPath: selected as string,
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
    const layer = createDefaultLayer(project.canvasSize.width, project.canvasSize.height);
    layer.data = project.canvasData;
    set({
      canvasData: project.canvasData,
      canvasSize: project.canvasSize,
      layers: [layer],
      activeLayerId: layer.id,
      undoStack: [],
      redoStack: [],
      isDirty: false,
      lastSavedAt: new Date().toLocaleTimeString(),
      offsetX: 0,
      offsetY: 0,
    });
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
    const action: HistoryAction = [];

    for (let row = 0; row < newLayerData.length; row++) {
      for (let col = 0; col < newLayerData[row].length; col++) {
        if (newLayerData[row][col].colorIndex === fromIndex) {
          action.push({ row, col, prevColorIndex: fromIndex, newColorIndex: toIndex });
          newLayerData[row][col] = { colorIndex: toIndex };
        }
      }
    }

    if (action.length === 0) return;

    const newLayers = [...state.layers];
    newLayers[layerIdx] = { ...layer, data: newLayerData };
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
