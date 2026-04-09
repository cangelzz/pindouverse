import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { save, open as dialogOpen } from "@tauri-apps/plugin-dialog";
import type {
  CanvasCell,
  CanvasData,
  CanvasSize,
  EditorTool,
  GridConfig,
  HistoryAction,
  ProjectFile,
} from "../types";

interface SnapshotInfo {
  path: string;
  name: string;
  modified: string;
}

interface EditorState {
  // Canvas data
  canvasSize: CanvasSize;
  canvasData: CanvasData;
  gridConfig: GridConfig;

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

  // Auto-save state
  lastSavedAt: string | null;
  autoSaveEnabled: boolean;

  // Snapshots
  snapshots: SnapshotInfo[];

  // Actions
  newCanvas: (width: number, height: number) => void;
  setCell: (row: number, col: number, colorIndex: number | null) => void;
  batchSetCells: (entries: { row: number; col: number; colorIndex: number | null }[]) => void;
  setTool: (tool: EditorTool) => void;
  setSelectedColor: (index: number | null) => void;
  setZoom: (zoom: number) => void;
  setOffset: (x: number, y: number) => void;
  setBlueprintMode: (on: boolean) => void;
  setGridStartCoords: (startX: number, startY: number) => void;
  undo: () => void;
  redo: () => void;
  loadCanvasData: (data: CanvasData, size: CanvasSize) => void;
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

  // Bead layer
  setBeadLayerVisible: (visible: boolean) => void;
  setBeadLayerOpacity: (opacity: number) => void;

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

const DEFAULT_GRID_CONFIG: GridConfig = {
  groupSize: 5,
  edgePadding: 2,
  startX: 1,
  startY: 1,
};

const MAX_HISTORY = 200;

function buildProjectFile(state: EditorState): ProjectFile {
  const now = new Date().toISOString();
  return {
    version: 1,
    canvasSize: state.canvasSize,
    canvasData: state.canvasData,
    createdAt: state.lastSavedAt || now,
    updatedAt: now,
  };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  canvasSize: { width: 52, height: 52 },
  canvasData: createEmptyCanvas(52, 52),
  gridConfig: DEFAULT_GRID_CONFIG,

  refImagePixels: null,
  refImageWidth: 0,
  refImageHeight: 0,
  refImageVisible: true,
  refImageOpacity: 0.3,

  beadLayerVisible: true,
  beadLayerOpacity: 1,

  cellSize: 16,
  offsetX: 0,
  offsetY: 0,
  zoom: 1,
  blueprintMode: false,

  currentTool: "pen",
  selectedColorIndex: 0,
  highlightColorIndex: null,

  undoStack: [],
  redoStack: [],

  projectPath: null,
  isDirty: false,
  importedFileName: null,

  lastSavedAt: null,
  autoSaveEnabled: true,

  snapshots: [],

  newCanvas: (width, height) => {
    set({
      canvasSize: { width, height },
      canvasData: createEmptyCanvas(width, height),
      undoStack: [],
      redoStack: [],
      isDirty: false,
      offsetX: 0,
      offsetY: 0,
    });
  },

  setCell: (row, col, colorIndex) => {
    const state = get();
    const prev = state.canvasData[row]?.[col]?.colorIndex ?? null;
    if (prev === colorIndex) return;

    const newData = state.canvasData.map((r) => r.map((c) => ({ ...c })));
    newData[row][col] = { colorIndex };

    const action: HistoryAction = [
      { row, col, prevColorIndex: prev, newColorIndex: colorIndex },
    ];

    const undoStack = [...state.undoStack, action].slice(-MAX_HISTORY);

    set({
      canvasData: newData,
      undoStack,
      redoStack: [],
      isDirty: true,
    });
  },

  batchSetCells: (entries) => {
    const state = get();
    const newData = state.canvasData.map((r) => r.map((c) => ({ ...c })));
    const action: HistoryAction = [];

    for (const { row, col, colorIndex } of entries) {
      const prev = newData[row]?.[col]?.colorIndex ?? null;
      if (prev !== colorIndex) {
        action.push({ row, col, prevColorIndex: prev, newColorIndex: colorIndex });
        newData[row][col] = { colorIndex };
      }
    }

    if (action.length === 0) return;

    const undoStack = [...state.undoStack, action].slice(-MAX_HISTORY);

    set({
      canvasData: newData,
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

  setOffset: (x, y) => set({ offsetX: x, offsetY: y }),

  setBlueprintMode: (on) => set({ blueprintMode: on }),

  setGridStartCoords: (startX, startY) => set((state) => ({
    gridConfig: { ...state.gridConfig, startX, startY },
  })),

  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;

    const action = state.undoStack[state.undoStack.length - 1];
    const newData = state.canvasData.map((r) => r.map((c) => ({ ...c })));

    for (const entry of action) {
      newData[entry.row][entry.col] = { colorIndex: entry.prevColorIndex };
    }

    set({
      canvasData: newData,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, action],
      isDirty: true,
    });
  },

  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;

    const action = state.redoStack[state.redoStack.length - 1];
    const newData = state.canvasData.map((r) => r.map((c) => ({ ...c })));

    for (const entry of action) {
      newData[entry.row][entry.col] = { colorIndex: entry.newColorIndex };
    }

    set({
      canvasData: newData,
      undoStack: [...state.undoStack, action],
      redoStack: state.redoStack.slice(0, -1),
      isDirty: true,
    });
  },

  loadCanvasData: (data, size) => {
    set({
      canvasData: data,
      canvasSize: size,
      undoStack: [],
      redoStack: [],
      isDirty: false,
    });
  },

  placeImageOnCanvas: (imageData, imageW, imageH, canvasW, canvasH, startRow, startCol) => {
    const canvas = createEmptyCanvas(canvasW, canvasH);
    for (let r = 0; r < imageH; r++) {
      for (let c = 0; c < imageW; c++) {
        const tr = startRow + r;
        const tc = startCol + c;
        if (tr >= 0 && tr < canvasH && tc >= 0 && tc < canvasW) {
          canvas[tr][tc] = imageData[r][c];
        }
      }
    }
    set({
      canvasData: canvas,
      canvasSize: { width: canvasW, height: canvasH },
      undoStack: [],
      redoStack: [],
      isDirty: false,
    });
  },

  setProjectPath: (path) => set({ projectPath: path }),
  setImportedFileName: (name: string | null) => set({ importedFileName: name }),

  saveProject: async () => {
    const state = get();
    let path = state.projectPath;
    if (!path) {
      const selected = await save({
        filters: [{ name: "PinDou Project", extensions: ["pindou"] }],
        defaultPath: "untitled.pindou",
      });
      if (!selected) return;
      path = selected;
    }
    const project = buildProjectFile(state);
    await invoke("save_project", { path, project });
    const now = new Date().toLocaleTimeString();
    set({ projectPath: path, isDirty: false, lastSavedAt: now });
  },

  saveProjectAs: async () => {
    const state = get();
    const selected = await save({
      filters: [{ name: "PinDou Project", extensions: ["pindou"] }],
      defaultPath: state.projectPath || "untitled.pindou",
    });
    if (!selected) return;
    const project = buildProjectFile(state);
    await invoke("save_project", { path: selected, project });
    const now = new Date().toLocaleTimeString();
    set({ projectPath: selected, isDirty: false, lastSavedAt: now });
  },

  openProject: async () => {
    const selected = await dialogOpen({
      filters: [{ name: "PinDou Project", extensions: ["pindou"] }],
      multiple: false,
    });
    if (!selected) return;
    const project = await invoke<ProjectFile>("load_project", { path: selected });
    set({
      canvasData: project.canvasData,
      canvasSize: project.canvasSize,
      projectPath: selected as string,
      undoStack: [],
      redoStack: [],
      isDirty: false,
      lastSavedAt: new Date().toLocaleTimeString(),
      offsetX: 0,
      offsetY: 0,
    });
  },

  autoSave: async () => {
    const state = get();
    if (!state.autoSaveEnabled || !state.isDirty) return;

    try {
      const dir = await invoke<string>("get_autosave_dir");
      const path = `${dir}\\autosave.pindou`;
      const project = buildProjectFile(state);
      await invoke("save_project", { path, project });
      const now = new Date().toLocaleTimeString();
      set({ lastSavedAt: now, isDirty: false });
    } catch {
      // Silent fail for auto-save
    }
  },

  setAutoSaveEnabled: (enabled) => set({ autoSaveEnabled: enabled }),

  createSnapshot: async (label) => {
    const state = get();
    const project = buildProjectFile(state);
    await invoke("save_snapshot", { project, label });
    await get().loadSnapshots();
  },

  loadSnapshots: async () => {
    try {
      const snapshots = await invoke<SnapshotInfo[]>("list_snapshots");
      set({ snapshots });
    } catch {
      set({ snapshots: [] });
    }
  },

  restoreSnapshot: async (path) => {
    const project = await invoke<ProjectFile>("load_snapshot", { path });
    set({
      canvasData: project.canvasData,
      canvasSize: project.canvasSize,
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

  setBeadLayerVisible: (visible) => set({ beadLayerVisible: visible }),
  setBeadLayerOpacity: (opacity) => set({ beadLayerOpacity: Math.max(0, Math.min(1, opacity)) }),

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
    const newData = state.canvasData.map((r) => r.map((c) => ({ ...c })));
    const action: HistoryAction = [];

    for (let row = 0; row < newData.length; row++) {
      for (let col = 0; col < newData[row].length; col++) {
        if (newData[row][col].colorIndex === fromIndex) {
          action.push({ row, col, prevColorIndex: fromIndex, newColorIndex: toIndex });
          newData[row][col] = { colorIndex: toIndex };
        }
      }
    }

    if (action.length === 0) return;

    const undoStack = [...state.undoStack, action].slice(-MAX_HISTORY);
    set({
      canvasData: newData,
      undoStack,
      redoStack: [],
      isDirty: true,
    });
  },
}));
