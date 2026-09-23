import { create } from "zustand";
import type { SnapshotInfo } from "../adapters";
import { getPlatformServices } from "../platform/serviceRegistry";
import type { ProjectDocumentRef } from "../platform/projectFileService";
import type { PlatformResult } from "../platform/result";
import { loadOverrides, saveOverrides, hexToRgb, type ColorOverrideMap } from "../utils/colorHelper";
import { computeFloodReplaceEntries } from "../utils/floodFill";
import { buildSelectionRemap, type ColorAdjustments } from "../utils/colorAdjust";
import { getGroupIndices, MARD_COLORS } from "../data/mard221";
import { canonicalizeDefaultLayer, getCanonicalDefaultLayerName } from "./defaultLayerNames";
import { applyCellsHistory, groupStrokeHistory, prepareProjectHistory } from "./editorHistory";
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
  ProjectHistoryPatch,
  ProjectInfo,
} from "../types";

export interface AutosaveTicket {
  projectGeneration: number;
  projectId: string;
  contentRevision: number;
}

interface EditorState {
  sessionLocked: boolean;
  // Canvas data (merged view from layers)
  canvasSize: CanvasSize;
  canvasData: CanvasData; // computed merged view
  gridConfig: GridConfig;

  // Multi-layer system
  layers: BeadLayer[];
  activeLayerId: string;
  nextDefaultLayerNameIndex: number;

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
  voiceEnhancementEnabled: boolean; // feature switch for LLM voice, default off
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
  projectDocument: ProjectDocumentRef | null;
  /** Stable only while edits belong to the same logical project/document. */
  /** Stable logical identity persisted as ProjectFile.projectId on the next save. */
  projectId: string;
  projectCreatedAt: string;
  /** Monotonic identity revision; changes whenever project content is replaced wholesale. */
  projectGeneration: number;
  isDirty: boolean;
  importedFileName: string | null;
  baselineCanvasData: CanvasData | null;
  projectInfo: ProjectInfo | undefined;

  // Cloud sync
  cloudGistId: string | null;
  cloudUpdatedAt: string | null;
  cloudVersion: string | null;
  cloudProjectName: string | null;
  cloudSyncStatus: "unlinked" | "synced" | "local-changes" | "remote-newer";
  cloudSyncedRevision: number | null;
  contentRevision: number;
  cloudOperationGeneration: number;

  // Auto-save state
  saveStatus: { kind: "saved" | "autosaved"; at: string; revision?: number } | null;
  currentSaveStatus: () => EditorState["saveStatus"];
  autoSaveEnabled: boolean;
  lastAutosaveErrorCode: string | null;
  createAutosaveTicket: () => AutosaveTicket;
  reportAutosaveResult: (result: PlatformResult<"saved" | "skipped">, ticket: AutosaveTicket) => boolean;

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
  newCanvas: (width: number, height: number, defaultLayerName?: string) => void;
  commitProjectPatch: (patch: ProjectHistoryPatch) => boolean;
  localizeDefaultLayerNames: () => void;
  setCell: (row: number, col: number, colorIndex: number | null) => void;
  batchSetCells: (entries: { row: number; col: number; colorIndex: number | null }[]) => void;
  batchSetLayerCells: (groups: { layerId: string; cells: { row: number; col: number; colorIndex: number | null }[] }[]) => number;
  getBlueprintBusyReason: () => string | null;
  floodFill: (row: number, col: number, colorIndex: number | null) => void;
  floodErase: (row: number, col: number) => void;
  pickActiveLayerColor: (row: number, col: number) => boolean;
  setTool: (tool: EditorTool) => void;
  setSelectedColor: (index: number | null) => void;
  setZoom: (zoom: number) => void;
  setViewport: (zoom: number, offsetX: number, offsetY: number) => void;
  fitToWindow: (containerW: number, containerH: number) => void;
  setOffset: (x: number, y: number) => void;
  setBlueprintMode: (on: boolean) => void;
  setBlueprintMirror: (on: boolean) => void;
  setGridFocusMode: (on: boolean) => void;
  setVoiceControlEnabled: (on: boolean) => void;
  setVoiceEnhancementEnabled: (on: boolean) => void;
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
  setCloudSync: (gistId: string | null, updatedAt: string | null, name: string | null, syncedRevision?: number, version?: string | null) => void;
  setCloudSyncStatus: (status: EditorState["cloudSyncStatus"]) => void;
  beginCloudOperation: () => number;
  invalidateCloudOperations: () => void;
  beginCloudDownload: () => number;
  replaceProjectFromCloud: (project: ProjectFile, gistId: string, name: string, updatedAt: string, ticket?: number, version?: string, cloudTicket?: number) => boolean;
  clearCloudAssociation: (gistId: string) => void;
  loadCanvasData: (data: CanvasData, size: CanvasSize) => void;
  /** Restore layered state from a saved ProjectFile. Falls back to single-layer if no layers field. */
  loadProjectLayers: (layers: BeadLayer[], size: CanvasSize) => void;
  loadProjectDocument: (project: ProjectFile, path: string | null, isBackup?: boolean) => void;
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
  saveProject: () => Promise<PlatformResult<void>>;
  saveProjectAs: () => Promise<PlatformResult<void>>;
  openProject: () => Promise<PlatformResult<void>>;
  restoreAutosave: (project: ProjectFile) => void;
  autoSave: () => Promise<PlatformResult<"saved" | "skipped">>;
  setAutoSaveEnabled: (enabled: boolean) => void;

  // Snapshots
  createSnapshot: (label: string) => Promise<PlatformResult<void>>;
  loadSnapshots: () => Promise<PlatformResult<SnapshotInfo[]>>;
  restoreSnapshot: (snapshot: SnapshotInfo | string) => Promise<PlatformResult<void>>;
  exportSnapshot: (path: string, name: string) => Promise<PlatformResult<void>>;
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
  renameLayer: (id: string, name?: string) => void;
  duplicateLayer: (id: string, copyName?: string) => void;
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
let liveLayerIds = new Set<string>();
function nextLayerId(): string {
  let id: string;
  do {
    id = `layer_${layerIdCounter++}`;
  } while (liveLayerIds.has(id));
  return id;
}

function hydrateLayers(layers: BeadLayer[]): BeadLayer[] {
  return layers.map((layer, index) => canonicalizeDefaultLayer({
    id: nextLayerId(),
    name: layer.name ?? "Layer",
    data: layer.data,
    visible: layer.visible !== false,
    opacity: typeof layer.opacity === "number" ? Math.max(0, Math.min(1, layer.opacity)) : 1,
    defaultNameIndex: layer.defaultNameIndex,
    isDefaultName: (layer as BeadLayer & { isDefaultName?: boolean }).isDefaultName,
  }, index + 1));
}

function nextDefaultNameIndex(layers: BeadLayer[]): number {
  return Math.max(0, ...layers.map((layer) => layer.defaultNameIndex ?? 0)) + 1;
}

function createDefaultLayer(width: number, height: number, name?: string, number = 1): BeadLayer {
  return {
    id: nextLayerId(),
    name: name ?? getCanonicalDefaultLayerName(number),
    data: createEmptyCanvas(width, height),
    visible: true,
    opacity: 1,
    defaultNameIndex: name === undefined ? number : undefined,
  };
}

/** Merge layers from bottom to top into a single CanvasData */
export function mergeLayers(layers: BeadLayer[], width: number, height: number): CanvasData {
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
let _projectOperationGeneration = 0;
let _openRequestGeneration = 0;
let _autosaveQueue: Promise<void> = Promise.resolve();
let _cancelPendingFormalAutosaveClear: (() => void) | null = null;
function enqueueAutosaveOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = _autosaveQueue.then(operation, operation);
  _autosaveQueue = result.then(() => undefined, () => undefined);
  return result;
}
function queueFormalAutosaveClear(): { settle: (success: boolean) => void; done: Promise<void> } {
  _cancelPendingFormalAutosaveClear?.();
  let settle!: (success: boolean) => void;
  const outcome = new Promise<boolean>((resolve) => { settle = resolve; });
  const cancel = () => settle(false);
  _cancelPendingFormalAutosaveClear = cancel;
  const done = enqueueAutosaveOperation(async () => {
    const success = await outcome;
    if (_cancelPendingFormalAutosaveClear === cancel) _cancelPendingFormalAutosaveClear = null;
    if (success) await getPlatformServices().recovery.clearAutosave?.();
  });
  return { settle, done };
}
let _snapshotLoadGeneration = 0;
let _snapshotRestoreRequestGeneration = 0;

function invalidateFileOperations(): number {
  return ++_projectOperationGeneration;
}

function beginProjectReplacement(): void {
  invalidateFileOperations();
  _snapshotRestoreRequestGeneration++;
  if (typeof useEditorStore !== "undefined") useEditorStore.setState((state) => ({ cloudOperationGeneration: state.cloudOperationGeneration + 1 }));
}

function cloneCanvasData(data: CanvasData): CanvasData {
  return data.map(row => row.map(cell => ({ ...cell })));
}

function projectStateIsUnchanged(before: EditorState, after: EditorState): boolean {
  return before.canvasSize === after.canvasSize
    && before.canvasData === after.canvasData
    && before.layers === after.layers
    && before.gridConfig === after.gridConfig
    && before.projectInfo === after.projectInfo;
}

let projectIdentityGenerator: () => string = () => globalThis.crypto?.randomUUID?.()
  ?? `project-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function setProjectIdentityGeneratorForTest(generator: () => string): void {
  projectIdentityGenerator = generator;
}
function newProjectIdentity(): string { return projectIdentityGenerator(); }
function nowIso(): string { return new Date().toISOString(); }
function markPersistentChange<T extends object>(patch: T): T & Pick<EditorState, "isDirty" | "contentRevision" | "cloudSyncStatus"> {
  const state = useEditorStore.getState();
  const revision = state.contentRevision + 1;
  return {
    ...patch,
    isDirty: true,
    contentRevision: revision,
    cloudSyncStatus: state.cloudGistId && state.cloudSyncedRevision !== revision ? "local-changes" : state.cloudSyncStatus,
  };
}

export function projectFromEditorState(state: Pick<EditorState, "canvasSize" | "canvasData" | "layers" | "gridConfig" | "projectInfo" | "projectCreatedAt" | "projectId">, now = new Date().toISOString()): ProjectFile {
  return {
    version: 3,
    projectId: state.projectId,
    canvasSize: state.canvasSize,
    canvasData: state.canvasData,
    layers: state.layers.map((layer, index) => canonicalizeDefaultLayer(layer, index + 1)),
    gridConfig: state.gridConfig,
    projectInfo: state.projectInfo,
    createdAt: state.projectCreatedAt,
    updatedAt: now,
  };
}

function buildProjectFile(state: EditorState): ProjectFile { return projectFromEditorState(state); }

const _initLayer = createDefaultLayer(52, 52);
liveLayerIds.add(_initLayer.id);
const _initialCreatedAt = nowIso();
const _initialIdentity = newProjectIdentity();

export const useEditorStore = create<EditorState>((write, get) => {
  const set: typeof write = ((partial: Parameters<typeof write>[0], replace?: false) => {
    if (!get()?.sessionLocked) write(partial, replace);
  }) as typeof write;
  return ({
  sessionLocked: false,
  canvasSize: { width: 52, height: 52 },
  canvasData: createEmptyCanvas(52, 52),
  gridConfig: DEFAULT_GRID_CONFIG,

  layers: [_initLayer],
  activeLayerId: _initLayer.id,
  nextDefaultLayerNameIndex: 2,

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
  voiceEnhancementEnabled: false,
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
  projectDocument: null,
  projectId: _initialIdentity,
  projectCreatedAt: _initialCreatedAt,
  projectGeneration: 0,
  isDirty: false,
  baselineCanvasData: null,
  importedFileName: null,
  projectInfo: undefined,
  cloudGistId: null,
  cloudUpdatedAt: null,
  cloudVersion: null,
  cloudProjectName: null,
  cloudSyncStatus: "unlinked",
  cloudSyncedRevision: null,
  contentRevision: 0,
  cloudOperationGeneration: 0,

  saveStatus: null,
  currentSaveStatus: () => {
    const state = get();
    return state.saveStatus?.revision === state.contentRevision ? state.saveStatus : null;
  },
  autoSaveEnabled: true,
  lastAutosaveErrorCode: null,

  snapshots: [],

  betaFeatures: {
    blueprintImport: false,
    voiceEnhancement: false,
  },

  customColorGroups: JSON.parse(localStorage.getItem("pindou_custom_groups") || "[]"),
  colorOverrides: loadOverrides(),

  selection: null,
  selectionBounds: null,
  clipboard: null,
  floatingSelection: null,
  previewOverlay: null,
  adjustSession: null,

  newCanvas: (width, height, defaultLayerName) => {
    beginProjectReplacement();
    const layer = createDefaultLayer(width, height, defaultLayerName);
    set({
      canvasSize: { width, height },
      canvasData: createEmptyCanvas(width, height),
      gridConfig: makeGridConfig(width, height),
      layers: [layer],
      activeLayerId: layer.id,
      nextDefaultLayerNameIndex: 2,
      undoStack: [],
      redoStack: [],
      isDirty: false,
      offsetX: 0,
      offsetY: 0,
      projectPath: null,
      projectDocument: null,
      projectId: newProjectIdentity(),
      projectCreatedAt: nowIso(),
      projectGeneration: get().projectGeneration + 1,
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
      clipboard: null,
      previewOverlay: null,
      adjustSession: null,
      cloudGistId: null,
      cloudUpdatedAt: null,
      cloudVersion: null,
      cloudProjectName: null,
      cloudSyncStatus: "unlinked",
      cloudSyncedRevision: null,
      saveStatus: null,
      lastAutosaveErrorCode: null,
    });
  },

  commitProjectPatch: (patch) => {
    const state = get();
    const action = prepareProjectHistory(state, patch);
    if (!action) return false;
    const next = { ...state, ...action.after };
    set(markPersistentChange({
      ...action.after,
      projectInfo: next.projectInfo ?? undefined,
      canvasData: action.after.layers || action.after.canvasSize
        ? mergeLayers(next.layers, next.canvasSize.width, next.canvasSize.height) : state.canvasData,
      undoStack: [...state.undoStack, action].slice(-MAX_HISTORY),
      redoStack: [],
    }));
    return true;
  },

  localizeDefaultLayerNames: () => {},

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
      changesByLayer: [{ layerId: layer.id, entries: [{ row, col, prevColorIndex: prev, newColorIndex: colorIndex }] }],
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

  batchSetCells: (entries) => { get().batchSetLayerCells([{ layerId: get().activeLayerId, cells: entries }]); },

  batchSetLayerCells: (groups) => {
    const state = get();
    const action: CellsHistoryAction = { kind: "cells", changesByLayer: [] };
    const seenLayers = new Set<string>();
    for (const group of groups) {
      const layer = state.layers.find(item => item.id === group.layerId);
      if (!layer?.visible || seenLayers.has(group.layerId)) return 0;
      seenLayers.add(group.layerId);
      const entries = new Map<string, HistoryEntry>();
      for (const cell of group.cells) {
        if (!Number.isInteger(cell.row) || !Number.isInteger(cell.col)
          || cell.row < 0 || cell.col < 0 || !layer.data[cell.row]?.[cell.col]
          || (cell.colorIndex !== null && (!Number.isInteger(cell.colorIndex) || cell.colorIndex < 0 || cell.colorIndex >= MARD_COLORS.length))) return 0;
        const key = `${cell.row},${cell.col}`;
        entries.set(key, {
          row: cell.row, col: cell.col, prevColorIndex: layer.data[cell.row][cell.col].colorIndex,
          newColorIndex: cell.colorIndex,
        });
      }
      const changed = [...entries.values()].filter(entry => entry.prevColorIndex !== entry.newColorIndex);
      if (changed.length) action.changesByLayer.push({ layerId: group.layerId, entries: changed });
    }
    const count = action.changesByLayer.reduce((total, group) => total + group.entries.length, 0);
    if (!count) return 0;
    const layers = applyCellsHistory(state.layers, action, "redo");
    if (!layers) return 0;
    set(markPersistentChange({ layers, canvasData: mergeLayers(layers, state.canvasSize.width, state.canvasSize.height),
      undoStack: [...state.undoStack, action].slice(-MAX_HISTORY), redoStack: [] }));
    return count;
  },

  getBlueprintBusyReason: () => {
    const state = get();
    if (state.sessionLocked) return "An editor session handoff is in progress";
    if (_strokeStartIdx >= 0) return "A drawing stroke is in progress";
    if (state.floatingSelection) return "A floating selection is being edited";
    if (state.adjustSession) return "A color adjustment is in progress";
    return null;
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
    if (!Number.isFinite(zoom)) return;
    const clamped = Math.max(0.5, Math.min(40, zoom));
    set({ zoom: clamped, cellSize: 16 * clamped });
  },

  setViewport: (zoom, offsetX, offsetY) => {
    if (![zoom, offsetX, offsetY].every(Number.isFinite)) return;
    const clamped = Math.max(0.5, Math.min(40, zoom));
    set({ zoom: clamped, cellSize: 16 * clamped, offsetX, offsetY });
  },

  fitToWindow: (containerW, containerH) => {
    const state = get();
    const { width, height } = state.canvasSize;
    if (![containerW, containerH, width, height].every((value) => Number.isFinite(value) && value > 0)) return;
    const padding = 20; // px margin
    const zoomX = (containerW - padding * 2) / (width * 16);
    const zoomY = (containerH - padding * 2) / (height * 16);
    const zoom = Math.max(0.5, Math.min(40, Math.min(zoomX, zoomY)));
    const cellSize = 16 * zoom;
    const offsetX = (containerW - width * cellSize) / 2;
    const offsetY = (containerH - height * cellSize) / 2;
    if (![zoom, cellSize, offsetX, offsetY].every(Number.isFinite)) return;
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

  setVoiceEnhancementEnabled: (on) => set({ voiceEnhancementEnabled: on }),

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

  setGridStartCoords: (startX, startY) => { get().commitProjectPatch({ gridConfig: { ...get().gridConfig, startX, startY } }); },

  setEdgePadding: (padding) => { get().commitProjectPatch({ gridConfig: { ...get().gridConfig, edgePadding: Math.max(0, padding) } }); },

  setGridVisible: (visible) => { get().commitProjectPatch({ gridConfig: { ...get().gridConfig, visible } }); },

  setGridLineColor: (color) => { get().commitProjectPatch({ gridConfig: { ...get().gridConfig, lineColor: color } }); },

  setGridLineWidth: (width) => { get().commitProjectPatch({ gridConfig: { ...get().gridConfig, lineWidth: Math.max(0, width) } }); },

  setGridGroupLineColor: (color) => { get().commitProjectPatch({ gridConfig: { ...get().gridConfig, groupLineColor: color } }); },

  setGridGroupLineWidth: (width) => { get().commitProjectPatch({ gridConfig: { ...get().gridConfig, groupLineWidth: Math.max(0, width) } }); },

  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;

    const action = state.undoStack[state.undoStack.length - 1];

    if (action.kind === "projectPatch") {
      const prepared = prepareProjectHistory(state, action.before);
      if (!prepared) return;
      const next = { ...state, ...prepared.after };
      set(markPersistentChange({
        ...prepared.after,
        projectInfo: next.projectInfo ?? undefined,
        canvasData: mergeLayers(next.layers, next.canvasSize.width, next.canvasSize.height),
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, action],
      }));
      return;
    }

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

    const newLayers = applyCellsHistory(state.layers, action, "undo");
    if (!newLayers) return;
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

    if (action.kind === "projectPatch") {
      const prepared = prepareProjectHistory(state, action.after);
      if (!prepared) return;
      const next = { ...state, ...prepared.after };
      set(markPersistentChange({
        ...prepared.after,
        projectInfo: next.projectInfo ?? undefined,
        canvasData: mergeLayers(next.layers, next.canvasSize.width, next.canvasSize.height),
        undoStack: [...state.undoStack, action],
        redoStack: state.redoStack.slice(0, -1),
      }));
      return;
    }

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

    const newLayers = applyCellsHistory(state.layers, action, "redo");
    if (!newLayers) return;
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
    const newStack = [...stack.slice(0, _strokeStartIdx), ...groupStrokeHistory(stack.slice(_strokeStartIdx))];
    set({ undoStack: newStack });
    _strokeStartIdx = -1;
  },

  setCloudSync: (gistId, updatedAt, name, syncedRevision, version) => set((state) => ({
    cloudGistId: gistId,
    cloudUpdatedAt: updatedAt,
    cloudVersion: gistId ? (version ?? state.cloudVersion) : null,
    cloudProjectName: name,
    cloudSyncStatus: gistId ? ((syncedRevision ?? state.contentRevision) === state.contentRevision ? "synced" : "local-changes") : "unlinked",
    cloudSyncedRevision: gistId ? (syncedRevision ?? state.contentRevision) : null,
  })),
  setCloudSyncStatus: (cloudSyncStatus) => set({ cloudSyncStatus }),

  beginCloudOperation: () => { const generation = get().cloudOperationGeneration + 1; set({ cloudOperationGeneration: generation }); return generation; },
  invalidateCloudOperations: () => set((state) => ({ cloudOperationGeneration: state.cloudOperationGeneration + 1 })),
  beginCloudDownload: () => {
    beginProjectReplacement();
    const generation = get().cloudOperationGeneration + 1;
    set({ cloudOperationGeneration: generation });
    return _projectOperationGeneration;
  },

  replaceProjectFromCloud: (project, gistId, name, updatedAt, ticket, version, cloudTicket) => {
    if (ticket !== undefined && ticket !== _projectOperationGeneration) return false;
    if (cloudTicket !== undefined && cloudTicket !== get().cloudOperationGeneration) return false;
    if (ticket === undefined) beginProjectReplacement();
    const hasLayers = Array.isArray(project.layers) && project.layers.length > 0;
    const restoredLayers: BeadLayer[] = hasLayers ? hydrateLayers(project.layers!) : (() => { const layer = createDefaultLayer(project.canvasSize.width, project.canvasSize.height); layer.data = project.canvasData; return [layer]; })();
    const canvasData = hasLayers ? mergeLayers(restoredLayers, project.canvasSize.width, project.canvasSize.height) : project.canvasData;
    const revision = get().contentRevision + 1;
    set({
      canvasData, canvasSize: project.canvasSize, layers: restoredLayers,
      activeLayerId: restoredLayers[restoredLayers.length - 1].id,
      nextDefaultLayerNameIndex: nextDefaultNameIndex(restoredLayers),
      gridConfig: project.gridConfig ? { ...makeGridConfig(project.canvasSize.width, project.canvasSize.height), ...project.gridConfig } : makeGridConfig(project.canvasSize.width, project.canvasSize.height),
      projectInfo: project.projectInfo, projectPath: null, projectDocument: null,
      projectId: project.projectId || newProjectIdentity(), projectCreatedAt: project.createdAt,
      baselineCanvasData: null, isDirty: true, saveStatus: null,
      projectGeneration: get().projectGeneration + 1, undoStack: [], redoStack: [],
      selection: null, selectionBounds: null, floatingSelection: null, clipboard: null,
      previewOverlay: null, adjustSession: null, offsetX: 0, offsetY: 0,
      refImagePixels: null, refImageWidth: 0, refImageHeight: 0,
      refImageVisible: true, refImageOpacity: 0.3, importedFileName: null,
      cloudGistId: gistId, cloudUpdatedAt: updatedAt, cloudVersion: version ?? null, cloudProjectName: name,
      contentRevision: revision, cloudSyncedRevision: revision, cloudSyncStatus: "synced",
    });
    return true;
  },

  clearCloudAssociation: (gistId) => set((state) => state.cloudGistId === gistId ? {
    cloudGistId: null, cloudUpdatedAt: null, cloudVersion: null, cloudProjectName: null,
    cloudSyncStatus: "unlinked", cloudSyncedRevision: null,
  } : {}),

  loadCanvasData: (data, size) => {
    beginProjectReplacement();
    const layer = createDefaultLayer(size.width, size.height);
    layer.data = data;
    set({
      canvasData: data,
      canvasSize: size,
      gridConfig: makeGridConfig(size.width, size.height),
      layers: [layer],
      activeLayerId: layer.id,
      nextDefaultLayerNameIndex: 2,
      undoStack: [],
      redoStack: [],
      projectGeneration: get().projectGeneration + 1,
      isDirty: false,
      projectId: newProjectIdentity(),
      projectCreatedAt: nowIso(),
    });
  },

  loadProjectLayers: (layers, size) => {
    if (!Array.isArray(layers) || layers.length === 0) return;
    beginProjectReplacement();
    // Re-id layers to keep nextLayerId() monotonic and avoid collisions with the
    // current session's counter (saved files may have been authored elsewhere).
    const remapped = hydrateLayers(layers);
    set({
      canvasSize: size,
      gridConfig: makeGridConfig(size.width, size.height),
      layers: remapped,
      activeLayerId: remapped[remapped.length - 1].id,
      nextDefaultLayerNameIndex: nextDefaultNameIndex(remapped),
      canvasData: mergeLayers(remapped, size.width, size.height),
      undoStack: [],
      redoStack: [],
      projectGeneration: get().projectGeneration + 1,
      projectId: newProjectIdentity(),
      projectCreatedAt: nowIso(),
      isDirty: false,
    });
  },

  loadProjectDocument: (project, path, isBackup = false) => {
    beginProjectReplacement();
    const replacementRevision = get().contentRevision + 1;
    const hasLayers = Array.isArray(project.layers) && project.layers.length > 0;
    const restoredLayers = hasLayers ? hydrateLayers(project.layers!) : (() => { const layer = createDefaultLayer(project.canvasSize.width, project.canvasSize.height); layer.data = project.canvasData; return [layer]; })();
    const canvasData = hasLayers ? mergeLayers(restoredLayers, project.canvasSize.width, project.canvasSize.height) : project.canvasData;
    set({
      canvasSize: project.canvasSize, canvasData, layers: restoredLayers,
      activeLayerId: restoredLayers[restoredLayers.length - 1].id,
      nextDefaultLayerNameIndex: nextDefaultNameIndex(restoredLayers),
      gridConfig: project.gridConfig ? { ...makeGridConfig(project.canvasSize.width, project.canvasSize.height), ...project.gridConfig } : makeGridConfig(project.canvasSize.width, project.canvasSize.height),
      projectInfo: project.projectInfo, projectCreatedAt: project.createdAt,
      projectId: project.projectId || newProjectIdentity(), projectGeneration: get().projectGeneration + 1,
      projectPath: path, projectDocument: path ? { displayName: path, writable: true } : null,
      baselineCanvasData: isBackup ? null : cloneCanvasData(canvasData), isDirty: isBackup,
      contentRevision: replacementRevision,
      saveStatus: isBackup ? null : { kind: "saved", at: new Date().toISOString(), revision: replacementRevision }, autoSaveEnabled: !isBackup,
      undoStack: [], redoStack: [], selection: null, selectionBounds: null, floatingSelection: null,
      clipboard: null, previewOverlay: null, adjustSession: null, offsetX: 0, offsetY: 0,
      cloudGistId: null, cloudUpdatedAt: null, cloudVersion: null, cloudProjectName: null,
      cloudSyncStatus: "unlinked", cloudSyncedRevision: null,
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

    get().commitProjectPatch({
      canvasSize: { width: newWidth, height: newHeight },
      gridConfig: makeGridConfig(newWidth, newHeight),
      layers: newLayers,
    });
    set({ offsetX: 0, offsetY: 0 });
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
    const projectGeneration = state.projectGeneration;
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

    if (projectGeneration !== get().projectGeneration || !clipData) return;
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
    // Always snap into the MARD 221 base group (A–H, M) — never the special
    // 295-set series (P/Q/R/T/Y/ZG). "全色板" is the full base group; "仅已用色"
    // is the project's used colors intersected with that base group.
    const base221 = getGroupIndices("mard221");
    let pool: number[];
    if (snapRange === "used") {
      const base = new Set(base221);
      pool = session.used.filter((i) => base.has(i));
    } else {
      pool = base221;
    }
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
    const defaultNameIndex = state.nextDefaultLayerNameIndex;
    const newLayer = createDefaultLayer(width, height, undefined, defaultNameIndex);
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
      nextDefaultLayerNameIndex: defaultNameIndex + 1,
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
      nextDefaultLayerNameIndex: 2,
      undoStack: [],
      redoStack: [],
      ...markPersistentChange({}),
      projectId: newProjectIdentity(),
      projectCreatedAt: nowIso(),
      projectGeneration: get().projectGeneration + 1,
      projectPath: null,
      projectDocument: null,
      baselineCanvasData: null,
      saveStatus: null,
      cloudGistId: null,
      cloudUpdatedAt: null,
      cloudVersion: null,
      cloudProjectName: null,
      cloudSyncStatus: "unlinked",
      cloudSyncedRevision: null,
    });
  },

  setProjectPath: (path) => set({
    projectPath: path,
    projectDocument: path ? { displayName: path, writable: true } : null,
  }),
  setImportedFileName: (name: string | null) => set({ importedFileName: name }),
  setProjectInfo: (info: ProjectInfo) => { get().commitProjectPatch({ projectInfo: info }); },

  saveProject: async () => {
    const liveService = getPlatformServices().projectFiles;
    if (liveService.saveLiveProject) return liveService.saveLiveProject("save");
    const operationGeneration = invalidateFileOperations();
    const state = get();
    const formalClear = queueFormalAutosaveClear();
    const service = getPlatformServices().projectFiles;
    const project = buildProjectFile(state);
    const currentDocument = state.projectDocument
      ?? (state.projectPath ? { displayName: state.projectPath, writable: true } : null);
    let result: Awaited<ReturnType<typeof service.saveProject>>;
    try {
      result = currentDocument
        ? await service.saveProject(project, currentDocument)
        : await service.saveProjectAs(project, "untitled.pindou");
    } catch (error) {
      formalClear.settle(false);
      await formalClear.done;
      return { ok: false, code: "unknown", cause: error };
    }
    if (!result.ok || operationGeneration !== _projectOperationGeneration) {
      formalClear.settle(false);
      await formalClear.done;
      return !result.ok ? result : { ok: false, code: "stale" };
    }
    formalClear.settle(true);
    const now = new Date().toISOString();
    set({
      projectPath: result.value.displayName,
      projectDocument: result.value,
      isDirty: projectStateIsUnchanged(state, get()) ? false : get().isDirty,
      saveStatus: { kind: "saved", at: now, revision: state.contentRevision },
      baselineCanvasData: projectStateIsUnchanged(state, get())
        ? cloneCanvasData(state.canvasData)
        : get().baselineCanvasData,
    });
    await formalClear.done;
    return { ok: true, value: undefined };
  },

  saveProjectAs: async () => {
    const liveService = getPlatformServices().projectFiles;
    if (liveService.saveLiveProject) return liveService.saveLiveProject("saveAs");
    const operationGeneration = invalidateFileOperations();
    const state = get();
    const formalClear = queueFormalAutosaveClear();
    let result: Awaited<ReturnType<ReturnType<typeof getPlatformServices>["projectFiles"]["saveProjectAs"]>>;
    try {
      result = await getPlatformServices().projectFiles.saveProjectAs(
        buildProjectFile(state),
        state.projectDocument?.fallbackDownloadName || state.projectPath || "untitled.pindou",
      );
    } catch (error) {
      formalClear.settle(false);
      await formalClear.done;
      return { ok: false, code: "unknown", cause: error };
    }
    if (!result.ok || operationGeneration !== _projectOperationGeneration) {
      formalClear.settle(false);
      await formalClear.done;
      return !result.ok ? result : { ok: false, code: "stale" };
    }
    formalClear.settle(true);
    const now = new Date().toISOString();
    set({
      projectPath: result.value.displayName,
      projectDocument: result.value,
      isDirty: projectStateIsUnchanged(state, get()) ? false : get().isDirty,
      saveStatus: { kind: "saved", at: now, revision: state.contentRevision },
      baselineCanvasData: projectStateIsUnchanged(state, get())
        ? cloneCanvasData(state.canvasData)
        : get().baselineCanvasData,
    });
    await formalClear.done;
    return { ok: true, value: undefined };
  },

  openProject: async () => {
    const openRequestGeneration = ++_openRequestGeneration;
    const contentRevision = get().contentRevision;
    const projectGeneration = get().projectGeneration;
    const result = await getPlatformServices().projectFiles.openProject();
    if (!result.ok) return result;
    if (openRequestGeneration !== _openRequestGeneration
      || contentRevision !== get().contentRevision
      || projectGeneration !== get().projectGeneration) {
      return { ok: false, code: "stale" };
    }
    beginProjectReplacement();
    const { project, document } = result.value;
    const defaultGrid = makeGridConfig(project.canvasSize.width, project.canvasSize.height);
    const savedGrid = project.gridConfig;
    const hasLayers = Array.isArray(project.layers) && project.layers.length > 0;
    const restoredLayers: BeadLayer[] = hasLayers
      ? hydrateLayers(project.layers!)
      : (() => {
          const layer = createDefaultLayer(project.canvasSize.width, project.canvasSize.height);
          layer.data = project.canvasData;
          return [layer];
        })();
    const mergedCanvas = hasLayers
      ? mergeLayers(restoredLayers, project.canvasSize.width, project.canvasSize.height)
      : project.canvasData;
    const replacementRevision = get().contentRevision + 1;
    set({
      canvasData: mergedCanvas,
      canvasSize: project.canvasSize,
      gridConfig: savedGrid ? { ...defaultGrid, ...savedGrid } : defaultGrid,
      layers: restoredLayers,
      activeLayerId: restoredLayers[restoredLayers.length - 1].id,
      projectPath: document.displayName,
      projectDocument: document,
      projectId: project.projectId || newProjectIdentity(),
      projectCreatedAt: project.createdAt,
      projectGeneration: get().projectGeneration + 1,
      projectInfo: project.projectInfo,
      baselineCanvasData: cloneCanvasData(mergedCanvas),
      undoStack: [],
      redoStack: [],
      isDirty: false,
      contentRevision: replacementRevision,
      saveStatus: { kind: "saved", at: new Date().toISOString(), revision: replacementRevision },
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
      cloudVersion: null,
      cloudProjectName: null,
      cloudSyncStatus: "unlinked",
      cloudSyncedRevision: null,
    });
    return { ok: true, value: undefined };
  },

  restoreAutosave: (project) => {
    const ticket = get().beginCloudDownload();
    get().replaceProjectFromCloud(project, "", "", "", ticket);
    set({
      cloudGistId: null, cloudUpdatedAt: null, cloudVersion: null, cloudProjectName: null,
      cloudSyncStatus: "unlinked", cloudSyncedRevision: null,
    });
  },

  autoSave: async () => {
    const state = get();
    if (!state.autoSaveEnabled || !state.isDirty) return { ok: true, value: "skipped" };
    // Recovery is deliberately not a formal save: never update document identity,
    // dirty state, baseline, or saveStatus. Serialize it with formal-save clears
    // so an older delayed write cannot erase or overwrite a newer backup.
    const result = await enqueueAutosaveOperation(() => getPlatformServices().recovery.saveAutosave(buildProjectFile(state)));
    return result.ok ? { ok: true, value: "saved" } : result;
  },

  createAutosaveTicket: () => {
    const state = get();
    return { projectGeneration: state.projectGeneration, projectId: state.projectId, contentRevision: state.contentRevision };
  },

  reportAutosaveResult: (result, ticket) => {
    const state = get();
    if (state.projectGeneration !== ticket.projectGeneration || state.projectId !== ticket.projectId || state.contentRevision !== ticket.contentRevision) return false;
    set(result.ok
      ? result.value === "saved"
        ? { lastAutosaveErrorCode: null, saveStatus: { kind: "autosaved" as const, at: new Date().toISOString(), revision: ticket.contentRevision } }
        : { lastAutosaveErrorCode: null }
      : { lastAutosaveErrorCode: result.code });
    return true;
  },

  setAutoSaveEnabled: (enabled) => set({ autoSaveEnabled: enabled }),

  createSnapshot: async (label) => {
    const state = get();
    const result = await getPlatformServices().recovery.saveSnapshot(buildProjectFile(state), label, state.projectId);
    if (!result.ok) return result;
    _snapshotLoadGeneration++;
    set((state) => ({ snapshots: [result.value, ...state.snapshots.filter((item) => item.path !== result.value.path)]
      .sort((a, b) => b.modified.localeCompare(a.modified) || b.path.localeCompare(a.path)) }));
    return { ok: true, value: undefined };
  },

  loadSnapshots: async () => {
    const generation = ++_snapshotLoadGeneration;
    const result = await getPlatformServices().recovery.listSnapshots();
    if (generation !== _snapshotLoadGeneration) return { ok: false, code: "cancelled" };
    if (result.ok) set({ snapshots: result.value });
    return result;
  },

  restoreSnapshot: async (snapshot) => {
    const path = typeof snapshot === "string" ? snapshot : snapshot.path;
    const requestGeneration = ++_snapshotRestoreRequestGeneration;
    const projectGeneration = get().projectGeneration;
    const result = await getPlatformServices().recovery.loadSnapshot(path);
    if (!result.ok) return result;
    if (requestGeneration !== _snapshotRestoreRequestGeneration
      || projectGeneration !== get().projectGeneration) {
      return { ok: false, code: "cancelled" };
    }
    const loaded = "project" in result.value ? result.value : { project: result.value };
    const project = loaded.project;
    const sourceProjectId = loaded.sourceProjectId
      ?? project.projectId
      ?? (typeof snapshot === "string" ? undefined : snapshot.sourceProjectId);
    const sameProject = !!sourceProjectId && sourceProjectId === get().projectId;
    const hasLayers = Array.isArray(project.layers) && project.layers.length > 0;
    const restoredLayers: BeadLayer[] = hasLayers
      ? hydrateLayers(project.layers!)
      : (() => {
          const layer = createDefaultLayer(project.canvasSize.width, project.canvasSize.height);
          layer.data = project.canvasData;
          return [layer];
        })();
    const mergedCanvas = hasLayers
      ? mergeLayers(restoredLayers, project.canvasSize.width, project.canvasSize.height)
      : project.canvasData;
    invalidateFileOperations();
    set((state) => ({
      canvasData: mergedCanvas,
      canvasSize: project.canvasSize,
      layers: restoredLayers,
      activeLayerId: restoredLayers[restoredLayers.length - 1].id,
      nextDefaultLayerNameIndex: nextDefaultNameIndex(restoredLayers),
      gridConfig: project.gridConfig ?? makeGridConfig(project.canvasSize.width, project.canvasSize.height),
      projectInfo: project.projectInfo,
      projectCreatedAt: project.createdAt,
      projectId: sameProject ? state.projectId : newProjectIdentity(),
      projectDocument: sameProject ? state.projectDocument : null,
      projectPath: sameProject ? state.projectPath : null,
      baselineCanvasData: sameProject ? state.baselineCanvasData : null,
      saveStatus: sameProject ? state.saveStatus : null,
      cloudGistId: sameProject ? state.cloudGistId : null,
      cloudUpdatedAt: sameProject ? state.cloudUpdatedAt : null,
      cloudVersion: sameProject ? state.cloudVersion : null,
      cloudProjectName: sameProject ? state.cloudProjectName : null,
      cloudSyncStatus: sameProject ? state.cloudSyncStatus : "unlinked",
      cloudSyncedRevision: sameProject ? state.cloudSyncedRevision : null,
      projectGeneration: state.projectGeneration + 1,
      undoStack: [],
      redoStack: [],
      isDirty: true,
      offsetX: 0,
      offsetY: 0,
    }));
    return { ok: true, value: undefined };
  },

  exportSnapshot: async (path, name) => {
    const result = await getPlatformServices().recovery.loadSnapshot(path);
    if (!result.ok) return result;
    const project = "project" in result.value ? result.value.project : result.value;
    const safeName = name.replace(/[\\/:*?"<>|]/g, "_");
    return getPlatformServices().projectFiles.exportProject(project, `${safeName}.pindou`);
  },

  deleteSnapshot: async (path) => {
    const result = await getPlatformServices().recovery.deleteSnapshot(path);
    if (!result.ok) throw result.cause ?? new Error(result.code);
    _snapshotLoadGeneration++;
    set((state) => ({ snapshots: state.snapshots.filter((item) => item.path !== path) }));
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
    const layer = name
      ? createDefaultLayer(state.canvasSize.width, state.canvasSize.height, name)
      : createDefaultLayer(state.canvasSize.width, state.canvasSize.height, undefined, state.nextDefaultLayerNameIndex);
    const newLayers = [...state.layers, layer];
    get().commitProjectPatch({
      layers: newLayers,
      activeLayerId: layer.id,
      nextDefaultLayerNameIndex: name ? state.nextDefaultLayerNameIndex : state.nextDefaultLayerNameIndex + 1,
    });
  },

  removeLayer: (id) => {
    const state = get();
    if (state.layers.length <= 1) return; // keep at least 1
    const newLayers = state.layers.filter((l) => l.id !== id);
    const newActive = state.activeLayerId === id ? newLayers[newLayers.length - 1].id : state.activeLayerId;
    get().commitProjectPatch({
      layers: newLayers,
      activeLayerId: newActive,
    });
  },

  setActiveLayer: (id) => {
    if (get().layers.some(layer => layer.id === id)) set({ activeLayerId: id });
  },

  setLayerVisible: (id, visible) => {
    const state = get();
    const newLayers = state.layers.map((l) => l.id === id ? { ...l, visible } : l);
    get().commitProjectPatch({ layers: newLayers });
  },

  setLayerOpacity: (id, opacity) => {
    const state = get();
    const newLayers = state.layers.map((l) => l.id === id ? { ...l, opacity: Math.max(0, Math.min(1, opacity)) } : l);
    get().commitProjectPatch({ layers: newLayers });
  },

  renameLayer: (id, name) => {
    const state = get();
    const newLayers = state.layers.map((l) => l.id === id
      ? name === undefined && l.defaultNameIndex !== undefined
        ? { ...l, name: getCanonicalDefaultLayerName(l.defaultNameIndex) }
        : { ...l, name: name ?? l.name, defaultNameIndex: undefined }
      : l);
    get().commitProjectPatch({ layers: newLayers });
  },

  duplicateLayer: (id, copyName) => {
    const state = get();
    const src = state.layers.find((l) => l.id === id);
    if (!src) return;
    const copy: BeadLayer = {
      id: nextLayerId(),
      name: copyName || `${src.name} Copy`,
      data: src.data.map((r) => r.map((c) => ({ ...c }))),
      visible: true,
      opacity: src.opacity,
    };
    const idx = state.layers.findIndex((l) => l.id === id);
    const newLayers = [...state.layers];
    newLayers.splice(idx + 1, 0, copy);
    get().commitProjectPatch({
      layers: newLayers,
      activeLayerId: copy.id,
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
    get().commitProjectPatch({ layers: newLayers });
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

    get().commitProjectPatch({
      layers: newLayers,
      activeLayerId: mergedLayer.id,
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
    const action: CellsHistoryAction = { kind: "cells", changesByLayer: [{ layerId: layer.id, entries }] };
    const undoStack = [...state.undoStack, action].slice(-MAX_HISTORY);
    set({
      layers: newLayers,
      canvasData: mergeLayers(newLayers, state.canvasSize.width, state.canvasSize.height),
      undoStack,
      redoStack: [],
      isDirty: true,
    });
  },
  });
});

let pendingSessionActions = 0;
export function getPendingSessionActions(): number { return pendingSessionActions; }
const readOnlyActions = new Set(["currentSaveStatus", "getBlueprintBusyReason", "countColor", "countLostPixels", "selectionOnlyOnOtherLayers", "createAutosaveTicket"]);
const guardedActions: Record<string, unknown> = {};
for (const [name, value] of Object.entries(useEditorStore.getState())) {
  if (typeof value !== "function" || readOnlyActions.has(name)) continue;
  guardedActions[name] = (...args: unknown[]) => {
    if (useEditorStore.getState().sessionLocked) {
      return value.constructor.name === "AsyncFunction" ? Promise.resolve({ ok: false, code: "cancelled" }) : false;
    }
    const result = value(...args);
    if (result instanceof Promise && name !== "saveProject" && name !== "saveProjectAs") {
      pendingSessionActions++;
      return result.finally(() => { pendingSessionActions--; });
    }
    return result;
  };
}
useEditorStore.setState(guardedActions as Partial<EditorState>);

// Keep cloud freshness independent from local-file dirty state. Persisted
// project-content changes advance a lightweight cloud revision.
let _observedCloudContent = (() => {
  const state = useEditorStore.getState();
  return { canvasData: state.canvasData, layers: state.layers, gridConfig: state.gridConfig, projectInfo: state.projectInfo, revision: state.contentRevision };
})();
useEditorStore.subscribe((state) => {
  if (state.layers !== _observedCloudContent.layers) liveLayerIds = new Set(state.layers.map(layer => layer.id));
  const changed = state.canvasData !== _observedCloudContent.canvasData || state.layers !== _observedCloudContent.layers
    || state.gridConfig !== _observedCloudContent.gridConfig || state.projectInfo !== _observedCloudContent.projectInfo;
  if (!changed) { _observedCloudContent.revision = state.contentRevision; return; }
  const explicitlyAdvanced = state.contentRevision !== _observedCloudContent.revision;
  const revision = explicitlyAdvanced ? state.contentRevision : state.contentRevision + 1;
  _observedCloudContent = { canvasData: state.canvasData, layers: state.layers, gridConfig: state.gridConfig, projectInfo: state.projectInfo, revision };
  if (!explicitlyAdvanced) useEditorStore.setState({
    contentRevision: revision,
    cloudSyncStatus: state.cloudGistId && state.cloudSyncedRevision !== revision ? "local-changes" : state.cloudSyncStatus,
  });
});
