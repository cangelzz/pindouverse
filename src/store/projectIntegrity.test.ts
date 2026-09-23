import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformAdapter, SnapshotInfo } from "../adapters";
import type { ProjectFile } from "../types";
import type { ProjectFileService } from "../platform/projectFileService";
import type { RecoveryStorage } from "../platform/recoveryStorage";
import { createLegacyPlatformServices } from "../platform/services";
import { createBrowserCapabilities } from "../platform/capabilities";
import { resetPlatformServicesForTest, setPlatformServices } from "../platform/serviceRegistry";

let storeModule: typeof import("./editorStore");
const memory = new Map<string, string>();

const project = (createdAt = "2020-01-02T03:04:05.000Z", color = 7): ProjectFile => ({
  version: 3,
  canvasSize: { width: 1, height: 1 },
  canvasData: [[{ colorIndex: color }]],
  layers: [{ id: "source", name: "Source", visible: true, opacity: 1, data: [[{ colorIndex: color }]] }],
  gridConfig: { groupSize: 5, edgePadding: 0, startX: 1, startY: 1, visible: true, lineColor: "#000", lineWidth: 1, groupLineColor: "#000", groupLineWidth: 2 },
  projectInfo: { title: "Original" },
  createdAt,
  updatedAt: "2024-01-01T00:00:00.000Z",
});

function recovery(overrides: Partial<RecoveryStorage> = {}): RecoveryStorage {
  return {
    availability: "available",
    saveAutosave: vi.fn(async () => ({ ok: true as const, value: undefined })),
    loadAutosave: vi.fn(async () => ({ ok: true as const, value: null })),
    clearAutosave: vi.fn(async () => ({ ok: true as const, value: undefined })),
    saveSnapshot: vi.fn(async (_project, label, sourceProjectId) => ({ ok: true as const, value: { path: "snapshot", name: label, modified: "2025-01-01", sourceProjectId } })),
    listSnapshots: vi.fn(async () => ({ ok: true as const, value: [] })),
    loadSnapshot: vi.fn(async () => ({ ok: false as const, code: "invalid-data" as const })),
    deleteSnapshot: vi.fn(async () => ({ ok: true as const, value: undefined })),
    ...overrides,
  };
}

function install(projectFiles: Partial<ProjectFileService> = {}, recoveryStorage = recovery()) {
  const legacy = createLegacyPlatformServices({} as PlatformAdapter, createBrowserCapabilities("chrome", true));
  setPlatformServices({
    ...legacy,
    recovery: recoveryStorage,
    projectFiles: {
      openProject: vi.fn(async () => ({ ok: false as const, code: "cancelled" })),
      saveProject: vi.fn(async (_project, document) => ({ ok: true as const, value: document })),
      saveProjectAs: vi.fn(async () => ({ ok: true as const, value: { displayName: "new.pindou", writable: true } })),
      exportProject: vi.fn(async () => ({ ok: true as const, value: undefined })),
      ...projectFiles,
    } as ProjectFileService,
  });
}

beforeAll(async () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
    clear: () => memory.clear(),
  } });
  storeModule = await import("./editorStore");
});

beforeEach(() => {
  resetPlatformServicesForTest();
  memory.clear();
  let next = 0;
  storeModule.setProjectIdentityGeneratorForTest(() => `identity-${++next}`);
  storeModule.useEditorStore.getState().newCanvas(1, 1);
  install();
});

describe("layer-bound history", () => {
  it("keeps cell history when switching active layers", () => {
    const store = storeModule.useEditorStore;
    const firstId = store.getState().activeLayerId;
    store.getState().addLayer("Second");
    const secondId = store.getState().activeLayerId;
    store.getState().setActiveLayer(firstId);
    store.getState().setCell(0, 0, 7);
    store.getState().setActiveLayer(secondId);
    store.getState().setCell(0, 0, 8);
    store.getState().setActiveLayer(firstId);
    store.getState().undo();
    expect(store.getState().layers.find(layer => layer.id === firstId)!.data[0][0].colorIndex).toBe(7);
    expect(store.getState().layers.find(layer => layer.id === secondId)!.data[0][0].colorIndex).toBeNull();
    store.getState().redo();
    expect(store.getState().layers.find(layer => layer.id === secondId)!.data[0][0].colorIndex).toBe(8);
    store.getState().undo();
    store.getState().undo();
    expect(store.getState().layers.find(layer => layer.id === firstId)!.data[0][0].colorIndex).toBeNull();
  });

  it.each(["undo", "redo"] as const)("rejects %s if a history target is missing", (direction) => {
    const store = storeModule.useEditorStore;
    const firstId = store.getState().activeLayerId;
    store.getState().addLayer("Second");
    const secondId = store.getState().activeLayerId;
    store.getState().setCell(0, 0, 8);
    if (direction === "redo") store.getState().undo();
    store.setState({ layers: store.getState().layers.filter(layer => layer.id !== secondId), activeLayerId: firstId });
    const before = store.getState();
    store.getState()[direction]();
    expect(store.getState()).toBe(before);
  });

  it("groups a stroke by layer and coordinate", () => {
    const store = storeModule.useEditorStore;
    const firstId = store.getState().activeLayerId;
    store.getState().addLayer("Second");
    const secondId = store.getState().activeLayerId;
    const historyLength = store.getState().undoStack.length;
    store.getState().beginStroke();
    store.getState().setCell(0, 0, 8);
    store.getState().setActiveLayer(firstId);
    store.getState().setCell(0, 0, 7);
    store.getState().setCell(0, 0, 9);
    store.getState().endStroke();
    expect(store.getState().undoStack).toHaveLength(historyLength + 1);
    store.getState().undo();
    expect(store.getState().layers.every(layer => layer.data[0][0].colorIndex === null)).toBe(true);
    store.getState().redo();
    expect(store.getState().layers.find(layer => layer.id === firstId)!.data[0][0].colorIndex).toBe(9);
    expect(store.getState().layers.find(layer => layer.id === secondId)!.data[0][0].colorIndex).toBe(8);
  });
});

describe("project transaction history", () => {
  it("redoes a layer deletion after activating the restored layer", () => {
    const store = storeModule.useEditorStore;
    const firstId = store.getState().activeLayerId;
    store.getState().addLayer("Second");
    const secondId = store.getState().activeLayerId;
    store.getState().setActiveLayer(firstId);
    store.getState().removeLayer(secondId);
    store.getState().undo();
    store.getState().setActiveLayer(secondId);
    const revision = store.getState().contentRevision;
    store.getState().redo();
    expect(store.getState().layers.map(layer => layer.id)).toEqual([firstId]);
    expect(store.getState().activeLayerId).toBe(firstId);
    expect(store.getState().contentRevision).toBe(revision + 1);
    expect(store.getState().redoStack).toHaveLength(0);
  });

  it("replays a session with a pending deletion of the current active layer", async () => {
    const store = storeModule.useEditorStore;
    const session = await import("./editorSession");
    const firstId = store.getState().activeLayerId;
    store.getState().addLayer("Second");
    const secondId = store.getState().activeLayerId;
    store.getState().setActiveLayer(firstId);
    store.getState().removeLayer(secondId);
    store.getState().undo();
    store.getState().setActiveLayer(secondId);
    const snapshot = session.captureEditorSession();
    expect(() => session.restoreEditorSession(snapshot, { displayName: "/saved.pindou", writable: true },
      { project: snapshot.project, savedRevision: snapshot.revision })).not.toThrow();
    expect(store.getState().activeLayerId).toBe(secondId);
    store.getState().redo();
    expect(store.getState().layers.map(layer => layer.id)).toEqual([firstId]);
    const replayed = session.captureEditorSession();
    expect(() => session.restoreEditorSession(replayed, { displayName: "/saved.pindou", writable: true },
      { project: snapshot.project, savedRevision: snapshot.revision })).not.toThrow();
  });

  it("preserves active layer focus when replaying unrelated property edits", () => {
    const store = storeModule.useEditorStore;
    const firstId = store.getState().activeLayerId;
    store.getState().addLayer("Second");
    const secondId = store.getState().activeLayerId;
    store.getState().setActiveLayer(firstId);
    store.getState().renameLayer(firstId, "Renamed");
    store.getState().setActiveLayer(secondId);
    store.getState().undo();
    expect(store.getState().activeLayerId).toBe(secondId);
    store.getState().redo();
    expect(store.getState().activeLayerId).toBe(secondId);
    expect(store.getState().layers.find(layer => layer.id === firstId)?.name).toBe("Renamed");
  });

  it("delegates VS Code saves to the live service without legacy bookkeeping", async () => {
    const saveLiveProject = vi.fn(async () => ({ ok: true as const, value: undefined }));
    const saveProject = vi.fn();
    const saveProjectAs = vi.fn();
    install({ saveLiveProject, saveProject, saveProjectAs });
    await storeModule.useEditorStore.getState().saveProject();
    await storeModule.useEditorStore.getState().saveProjectAs();
    expect(saveLiveProject.mock.calls).toEqual([["save"], ["saveAs"]]);
    expect(saveProject).not.toHaveBeenCalled();
    expect(saveProjectAs).not.toHaveBeenCalled();
  });
  it("restores an identical clean session and rejects corrupted history without mutation", async () => {
    const store = storeModule.useEditorStore;
    const session = await import("./editorSession");
    store.getState().setCell(0, 0, 7);
    const snapshot = session.captureEditorSession();
    const saved = { project: snapshot.project, savedRevision: snapshot.revision };
    session.restoreEditorSession(snapshot, { displayName: "/same.pindou", writable: true }, saved);
    expect(store.getState().isDirty).toBe(false);
    const corrupt = session.captureEditorSession();
    const cells = corrupt.undoStack.find(action => action.kind === "cells");
    if (cells?.kind !== "cells") throw new Error("Missing test cell history");
    cells.changesByLayer[0].layerId = "missing";
    const before = store.getState();
    expect(() => session.restoreEditorSession(corrupt, { displayName: "/same.pindou", writable: true }, saved)).toThrow();
    expect(store.getState()).toBe(before);
  });

  it("restores live edits newer than the written snapshot", async () => {
    const store = storeModule.useEditorStore;
    const session = await import("./editorSession");
    store.getState().newCanvas(2, 1);
    store.getState().setCell(0, 0, 7);
    const written = storeModule.projectFromEditorState(store.getState());
    const savedRevision = store.getState().contentRevision;
    store.getState().setCell(0, 1, 8);
    const live = JSON.parse(JSON.stringify(session.captureEditorSession()));
    store.getState().newCanvas(1, 1);
    session.restoreEditorSession(live, { displayName: "/saved.pindou", writable: true }, { project: written, savedRevision });
    expect(store.getState().canvasData[0].map(cell => cell.colorIndex)).toEqual([7, 8]);
    expect(store.getState().isDirty).toBe(true);
    expect(store.getState().saveStatus?.revision).toBe(savedRevision);
    store.getState().undo();
    expect(store.getState().canvasData[0].map(cell => cell.colorIndex)).toEqual([7, null]);
  });

  it("blocks public mutations while a handoff lock is held", async () => {
    const store = storeModule.useEditorStore;
    const session = await import("./editorSession");
    store.getState().setCell(0, 0, 7);
    expect(session.acquireEditorSessionLock("handoff:1")).toBe(true);
    const before = store.getState();
    store.getState().setCell(0, 0, null);
    store.getState().undo();
    store.getState().newCanvas(4, 4);
    store.getState().setZoom(2);
    store.getState().setProjectInfo({ title: "Blocked" });
    expect(store.getState()).toBe(before);
    session.releaseEditorSessionLock("wrong-owner");
    store.getState().setCell(0, 0, null);
    expect(store.getState()).toBe(before);
    session.releaseEditorSessionLock("handoff:1");
    store.getState().setCell(0, 0, null);
    expect(store.getState().canvasData[0][0].colorIndex).toBeNull();
  });

  it("rejects invalid patches atomically and clears metadata reversibly", () => {
    const store = storeModule.useEditorStore;
    store.getState().setProjectInfo({ title: "Original" });
    const before = store.getState();
    expect(before.commitProjectPatch({ layers: [] })).toBe(false);
    expect(before.commitProjectPatch({ canvasSize: { width: 2, height: 1 } })).toBe(false);
    expect(before.commitProjectPatch({ activeLayerId: "missing" })).toBe(false);
    expect(before.commitProjectPatch({ layers: [before.layers[0], before.layers[0]] })).toBe(false);
    expect(store.getState()).toBe(before);
    expect(store.getState().commitProjectPatch({ projectInfo: null })).toBe(true);
    expect(store.getState().projectInfo).toBeUndefined();
    store.getState().undo();
    expect(store.getState().projectInfo).toEqual({ title: "Original" });
    store.getState().redo();
    expect(store.getState().projectInfo).toBeUndefined();
  });

  it("undoes resize and then the older hand edit", () => {
    const store = storeModule.useEditorStore;
    store.getState().setCell(0, 0, 7);
    const before = storeModule.projectFromEditorState(store.getState(), "2026-01-01T00:00:00Z");
    store.getState().resizeCanvas(2, 2, 0, 0);
    store.getState().undo();
    expect(storeModule.projectFromEditorState(store.getState(), "2026-01-01T00:00:00Z")).toEqual(before);
    store.getState().undo();
    expect(store.getState().canvasData[0][0].colorIndex).toBeNull();
  });

  it.each([
    ["add", () => storeModule.useEditorStore.getState().addLayer("Third")],
    ["remove", () => { const state = storeModule.useEditorStore.getState(); state.removeLayer(state.activeLayerId); }],
    ["duplicate", () => { const state = storeModule.useEditorStore.getState(); state.duplicateLayer(state.activeLayerId); }],
    ["rename", () => { const state = storeModule.useEditorStore.getState(); state.renameLayer(state.activeLayerId, "Renamed"); }],
    ["visibility", () => { const state = storeModule.useEditorStore.getState(); state.setLayerVisible(state.activeLayerId, false); }],
    ["opacity", () => { const state = storeModule.useEditorStore.getState(); state.setLayerOpacity(state.activeLayerId, 0.5); }],
    ["reorder", () => { const state = storeModule.useEditorStore.getState(); state.moveLayer(state.activeLayerId, "down"); }],
    ["merge", () => { const state = storeModule.useEditorStore.getState(); state.mergeLayerDown(state.activeLayerId); }],
    ["grid origin", () => storeModule.useEditorStore.getState().setGridStartCoords(2, 3)],
    ["grid margin", () => storeModule.useEditorStore.getState().setEdgePadding(3)],
    ["grid visibility", () => storeModule.useEditorStore.getState().setGridVisible(false)],
    ["grid color", () => storeModule.useEditorStore.getState().setGridLineColor("#123456")],
    ["grid width", () => storeModule.useEditorStore.getState().setGridLineWidth(3)],
    ["group color", () => storeModule.useEditorStore.getState().setGridGroupLineColor("#123456")],
    ["group width", () => storeModule.useEditorStore.getState().setGridGroupLineWidth(3)],
    ["project info", () => storeModule.useEditorStore.getState().setProjectInfo({ title: "Updated" })],
  ] as const)("round-trips %s without losing older history", (_label, change) => {
    const store = storeModule.useEditorStore;
    store.getState().addLayer("Second");
    store.getState().setCell(0, 0, 7);
    const snapshot = () => storeModule.projectFromEditorState(store.getState(), "2026-01-01T00:00:00Z");
    const before = snapshot();
    const historyLength = store.getState().undoStack.length;
    const revision = store.getState().contentRevision;
    change();
    const after = snapshot();
    expect(after).not.toEqual(before);
    expect(store.getState().contentRevision).toBe(revision + 1);
    expect(store.getState().undoStack).toHaveLength(historyLength + 1);
    store.getState().undo();
    expect(snapshot()).toEqual(before);
    store.getState().redo();
    expect(snapshot()).toEqual(after);
    store.getState().undo();
    store.getState().undo();
    expect(store.getState().layers.every(layer => layer.data[0][0].colorIndex === null)).toBe(true);
  });

  it("preserves redo and revision for unchanged persistent settings", () => {
    const store = storeModule.useEditorStore;
    store.getState().setCell(0, 0, 7);
    store.getState().undo();
    const before = store.getState();
    store.getState().setGridVisible(before.gridConfig.visible);
    store.getState().setProjectInfo({});
    const afterEmptyInfo = store.getState();
    store.getState().setProjectInfo({});
    expect(store.getState()).toBe(afterEmptyInfo);
    expect(afterEmptyInfo.contentRevision).toBe(before.contentRevision + 1);
    store.getState().undo();
    const settings = store.getState();
    store.getState().setGridVisible(settings.gridConfig.visible);
    store.getState().setLayerOpacity(settings.activeLayerId, settings.layers[0].opacity);
    expect(store.getState()).toBe(settings);
  });
});

describe("live blueprint tools", () => {
  it("exports a captured blueprint without consuming later edits", async () => {
    const store = storeModule.useEditorStore;
    const { dispatchBlueprintTool } = await import("../blueprint/toolDispatcher");
    const state = store.getState();
    const binding = { editorId: "editor-1", projectGeneration: state.projectGeneration };
    let captured: import("../adapters").ExportImageRequest | undefined;
    const result = await dispatchBlueprintTool({ type: "blueprintToolRequest", toolRequestId: "tool:editor-1:1", ...binding,
      operation: "export_blueprint", input: { ...binding, path: "/export.png" } }, binding, new AbortController().signal, {
      importPixels: async () => ({ width: 1, height: 1, pixels: [] }),
      exportImage: async request => { captured = request; store.getState().setCell(0, 0, 7); },
    });
    expect(result.ok).toBe(true);
    expect(captured?.cells[0][0]).toBeNull();
    expect(captured?.format).toBe("png");
    expect(store.getState().canvasData[0][0].colorIndex).toBe(7);
    expect(store.getState().isDirty).toBe(true);
  });
  it("rejects image conversion completed after a manual edit", async () => {
    const store = storeModule.useEditorStore;
    const { dispatchBlueprintTool } = await import("../blueprint/toolDispatcher");
    const state = store.getState();
    const binding = { editorId: "editor-1", projectGeneration: state.projectGeneration };
    let resolvePixels!: (pixels: { width: number; height: number; pixels: number[] }) => void;
    const pixels = new Promise<{ width: number; height: number; pixels: number[] }>(resolve => { resolvePixels = resolve; });
    const pending = dispatchBlueprintTool({ type: "blueprintToolRequest", toolRequestId: "tool:editor-1:1", ...binding,
      operation: "import_image", input: { ...binding, layerId: state.activeLayerId, width: 1, height: 1, position: { x: 0, y: 0 } } }, binding, new AbortController().signal,
      { importPixels: async () => pixels, exportImage: async () => undefined });
    store.getState().setCell(0, 0, 7);
    const afterHandEdit = store.getState();
    resolvePixels({ width: 1, height: 1, pixels: [255, 255, 255] });
    expect(await pending).toMatchObject({ ok: false, error: { code: "stale_revision" } });
    expect(store.getState()).toBe(afterHandEdit);
  });

  it("imports a valid image into the named layer as one history action", async () => {
    const store = storeModule.useEditorStore;
    const { dispatchBlueprintTool } = await import("../blueprint/toolDispatcher");
    const state = store.getState();
    const binding = { editorId: "editor-1", projectGeneration: state.projectGeneration };
    const result = await dispatchBlueprintTool({ type: "blueprintToolRequest", toolRequestId: "tool:editor-1:1", ...binding,
      operation: "import_image", input: { ...binding, layerId: state.activeLayerId, width: 1, height: 1, position: { x: 0, y: 0 } } }, binding, new AbortController().signal,
      { importPixels: async () => ({ width: 1, height: 1, pixels: [255, 255, 255] }), exportImage: async () => undefined });
    expect(result.ok).toBe(true);
    expect(store.getState().undoStack.length).toBe(state.undoStack.length + 1);
    store.getState().undo();
    expect(store.getState().canvasData[0][0].colorIndex).toBeNull();
  });
  it.each(["rename", "activate", "visibility", "opacity", "reorder", "duplicate", "mergeDown", "remove"] as const)(
    "supports the %s layer operation", async kind => {
      const store = storeModule.useEditorStore;
      const { dispatchBlueprintTool } = await import("../blueprint/toolDispatcher");
      store.getState().addLayer("Second");
      const layerId = store.getState().activeLayerId;
      store.getState().setCell(0, 0, 7);
      store.getState().setActiveLayer(store.getState().layers[0].id);
      const state = store.getState();
      const binding = { editorId: "editor-1", projectGeneration: state.projectGeneration };
      const changes = {
        rename: { kind, layerId, name: "New name" }, activate: { kind, layerId }, visibility: { kind, layerId, visible: false },
        opacity: { kind, layerId, opacity: 0.25 }, reorder: { kind, layerId, direction: "down" }, duplicate: { kind, layerId },
        mergeDown: { kind, layerId }, remove: { kind, layerId, allowDataLoss: true },
      };
      const result = await dispatchBlueprintTool({ type: "blueprintToolRequest", toolRequestId: "tool:editor-1:1", ...binding,
        operation: "manage_layer", input: { ...binding, expectedRevision: state.contentRevision, change: changes[kind] } }, binding, new AbortController().signal);
      expect(result.ok).toBe(true);
      if (kind === "activate") {
        expect(store.getState().activeLayerId).toBe(layerId);
        expect(store.getState().undoStack).toBe(state.undoStack);
      } else {
        expect(store.getState().undoStack.length).toBe(state.undoStack.length + 1);
        store.getState().undo();
        expect(store.getState().layers).toEqual(state.layers);
      }
    });

  it("rejects all-layer color replacement if hidden matching beads exist", async () => {
    const store = storeModule.useEditorStore;
    const { dispatchBlueprintTool } = await import("../blueprint/toolDispatcher");
    const { MARD_COLORS } = await import("../data/mard221");
    store.getState().setCell(0, 0, 7);
    store.getState().addLayer("Hidden");
    store.getState().setCell(0, 0, 7);
    store.getState().setLayerVisible(store.getState().activeLayerId, false);
    const state = store.getState();
    const binding = { editorId: "editor-1", projectGeneration: state.projectGeneration };
    const result = await dispatchBlueprintTool({ type: "blueprintToolRequest", toolRequestId: "tool:editor-1:1", ...binding,
      operation: "replace_color", input: { ...binding, from: MARD_COLORS[7].code, to: MARD_COLORS[8].code, scope: { kind: "allLayers" } } }, binding, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, error: { code: "editor_busy" } });
    expect(store.getState()).toBe(state);
  });

  it.each(["draw_shape", "fill_region", "replace_color", "resize_canvas", "manage_layer", "configure_grid", "update_project_info"] as const)(
    "executes %s as one reversible transaction", async operation => {
      const store = storeModule.useEditorStore;
      const { dispatchBlueprintTool } = await import("../blueprint/toolDispatcher");
      const { MARD_COLORS } = await import("../data/mard221");
      store.getState().newCanvas(3, 3);
      store.getState().setCell(1, 1, 7);
      const state = store.getState();
      const binding = { editorId: "editor-1", projectGeneration: state.projectGeneration };
      const inputs = {
        draw_shape: { layerId: state.activeLayerId, color: MARD_COLORS[8].code, shape: { kind: "line", start: { x: 0, y: 0 }, end: { x: 2, y: 2 } } },
        fill_region: { layerId: state.activeLayerId, color: MARD_COLORS[8].code, region: { kind: "rectangle", bounds: { x: 0, y: 0, width: 2, height: 2 } } },
        replace_color: { from: MARD_COLORS[7].code, to: MARD_COLORS[8].code, scope: { kind: "allLayers" } },
        resize_canvas: { width: 4, height: 4, anchorRow: 0, anchorCol: 0 },
        manage_layer: { change: { kind: "add", name: "Tool layer" } },
        configure_grid: { patch: { groupSize: 2, startX: 3 } },
        update_project_info: { patch: { title: "Tool project", author: "Test" } },
      };
      const snapshot = () => storeModule.projectFromEditorState(store.getState(), "2026-01-01T00:00:00Z");
      const before = snapshot();
      const result = await dispatchBlueprintTool({ type: "blueprintToolRequest", toolRequestId: "tool:editor-1:1", ...binding,
        operation, input: { ...binding, expectedRevision: state.contentRevision, ...inputs[operation] } }, binding, new AbortController().signal);
      expect(result.ok).toBe(true);
      const after = snapshot();
      expect(after).not.toEqual(before);
      expect(store.getState().undoStack.length).toBe(state.undoStack.length + 1);
      store.getState().undo();
      expect(snapshot()).toEqual(before);
      store.getState().redo();
      expect(snapshot()).toEqual(after);
    });

  it("requires loss confirmation including hidden beads before shrinking", async () => {
    const store = storeModule.useEditorStore;
    const { dispatchBlueprintTool } = await import("../blueprint/toolDispatcher");
    store.getState().newCanvas(2, 1);
    store.getState().setCell(0, 1, 7);
    store.getState().setLayerVisible(store.getState().activeLayerId, false);
    const state = store.getState();
    const binding = { editorId: "editor-1", projectGeneration: state.projectGeneration };
    const result = await dispatchBlueprintTool({ type: "blueprintToolRequest", toolRequestId: "tool:editor-1:1", ...binding,
      operation: "resize_canvas", input: { ...binding, width: 1, height: 1, anchorRow: 0, anchorCol: 0 } }, binding, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, error: { code: "data_loss_confirmation_required", details: { lostBeads: 1 } } });
    expect(store.getState()).toBe(state);
  });

  it("tool bead writes retain earlier manual edits and reject a stale retry", async () => {
    const store = storeModule.useEditorStore;
    const { dispatchBlueprintTool } = await import("../blueprint/toolDispatcher");
    const { MARD_COLORS } = await import("../data/mard221");
    store.getState().newCanvas(2, 1);
    store.getState().setCell(0, 0, 7);
    const before = store.getState();
    const binding = { editorId: "editor-1", projectGeneration: before.projectGeneration };
    const input = { ...binding, expectedRevision: before.contentRevision,
      layerId: before.activeLayerId, beads: [{ x: 1, y: 0, color: MARD_COLORS[8].code }] };
    const request = { type: "blueprintToolRequest" as const, toolRequestId: "tool:editor-1:1",
      ...binding, operation: "set_beads" as const, input };
    expect((await dispatchBlueprintTool(request, binding, new AbortController().signal)).ok).toBe(true);
    expect(store.getState().canvasData[0].map(cell => cell.colorIndex)).toEqual([7, 8]);
    const retry = await dispatchBlueprintTool({ ...request, toolRequestId: "tool:editor-1:2" }, binding, new AbortController().signal);
    expect(retry).toMatchObject({ ok: false, error: { code: "stale_revision" } });
    store.getState().undo();
    expect(store.getState().canvasData[0].map(cell => cell.colorIndex)).toEqual([7, null]);
  });

  it("reads the live state and palette without adding history", async () => {
    const store = storeModule.useEditorStore;
    const { dispatchBlueprintTool } = await import("../blueprint/toolDispatcher");
    store.getState().setCell(0, 0, 7);
    const before = store.getState();
    const binding = { editorId: "editor-1", projectGeneration: before.projectGeneration };
    const request = { type: "blueprintToolRequest" as const, toolRequestId: "tool:editor-1:1", ...binding,
      operation: "inspect_blueprint" as const, input: { region: { x: 0, y: 0, width: 1, height: 1 } } };
    const result = await dispatchBlueprintTool(request, binding, new AbortController().signal);
    expect(result).toMatchObject({ ok: true, stamp: { isDirty: true, revision: before.contentRevision }, value: { beadCount: 1 } });
    const palette = await dispatchBlueprintTool({ ...request, operation: "search_palette", input: { limit: 2 } }, binding, new AbortController().signal);
    expect(palette).toMatchObject({ ok: true });
    if (palette.ok) expect(palette.value).toHaveLength(2);
    expect(store.getState()).toBe(before);
  });

  it("rejects an invalid last bead without partially changing the first", async () => {
    const store = storeModule.useEditorStore;
    const { dispatchBlueprintTool } = await import("../blueprint/toolDispatcher");
    const before = store.getState();
    const binding = { editorId: "editor-1", projectGeneration: before.projectGeneration };
    const result = await dispatchBlueprintTool({ type: "blueprintToolRequest", toolRequestId: "tool:editor-1:1", ...binding,
      operation: "set_beads", input: { ...binding, layerId: before.activeLayerId,
        beads: [{ x: 0, y: 0, color: null }, { x: 0, y: 0, color: "not-a-color" }] } }, binding, new AbortController().signal);
    expect(result.ok).toBe(false);
    expect(store.getState()).toBe(before);
  });
});

describe("project timestamps", () => {
  it("preserves an opened createdAt through save, save-as, autosave and snapshot", async () => {
    const opened = project();
    const saved: ProjectFile[] = [];
    const autosaved: ProjectFile[] = [];
    const snapshotted: ProjectFile[] = [];
    install({
      openProject: vi.fn(async () => ({ ok: true as const, value: { project: opened, document: { displayName: "old.pindou", writable: true } } })),
      saveProject: vi.fn(async (value, document) => { saved.push(value); return { ok: true as const, value: document }; }),
      saveProjectAs: vi.fn(async (value) => { saved.push(value); return { ok: true as const, value: { displayName: "copy.pindou", writable: true } }; }),
    }, recovery({
      saveAutosave: vi.fn(async (value) => { autosaved.push(value); return { ok: true as const, value: undefined }; }),
      saveSnapshot: vi.fn(async (value, label, sourceProjectId) => { snapshotted.push(value); return { ok: true as const, value: { path: "s", name: label, modified: "now", sourceProjectId } }; }),
    }));

    await storeModule.useEditorStore.getState().openProject();
    storeModule.useEditorStore.getState().setCell(0, 0, 8);
    await storeModule.useEditorStore.getState().saveProject();
    storeModule.useEditorStore.getState().setCell(0, 0, 9);
    await storeModule.useEditorStore.getState().saveProjectAs();
    storeModule.useEditorStore.setState({ isDirty: true });
    await storeModule.useEditorStore.getState().autoSave();
    await storeModule.useEditorStore.getState().createSnapshot("snapshot");

    expect([...saved, ...autosaved, ...snapshotted].map((value) => value.createdAt)).toEqual(Array(4).fill(opened.createdAt));
  });

  it("keeps a new project's ISO createdAt stable across builds", () => {
    const state = storeModule.useEditorStore.getState();
    const first = storeModule.projectFromEditorState(state, "2030-01-01T00:00:00.000Z");
    const second = storeModule.projectFromEditorState(state, "2031-01-01T00:00:00.000Z");
    expect(first.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBe("2031-01-01T00:00:00.000Z");
  });

  it("preserves createdAt when downloading a cloud project", () => {
    storeModule.useEditorStore.getState().replaceProjectFromCloud(project(), "gist", "Cloud", "remote");
    expect(storeModule.projectFromEditorState(storeModule.useEditorStore.getState()).createdAt).toBe(project().createdAt);
  });
});

describe("persistent change tracking", () => {
  it.each([
    ["grid origin", () => storeModule.useEditorStore.getState().setGridStartCoords(2, 3)],
    ["grid margin", () => storeModule.useEditorStore.getState().setEdgePadding(2)],
    ["grid visibility", () => storeModule.useEditorStore.getState().setGridVisible(false)],
    ["grid color", () => storeModule.useEditorStore.getState().setGridLineColor("#123")],
    ["grid width", () => storeModule.useEditorStore.getState().setGridLineWidth(3)],
    ["group color", () => storeModule.useEditorStore.getState().setGridGroupLineColor("#456")],
    ["group width", () => storeModule.useEditorStore.getState().setGridGroupLineWidth(4)],
    ["layer add", () => storeModule.useEditorStore.getState().addLayer("Two")],
    ["layer visibility", () => storeModule.useEditorStore.getState().setLayerVisible(storeModule.useEditorStore.getState().activeLayerId, false)],
    ["layer opacity", () => storeModule.useEditorStore.getState().setLayerOpacity(storeModule.useEditorStore.getState().activeLayerId, 0.5)],
    ["layer rename", () => storeModule.useEditorStore.getState().renameLayer(storeModule.useEditorStore.getState().activeLayerId, "Renamed")],
    ["project info", () => storeModule.useEditorStore.getState().setProjectInfo({ title: "Changed" })],
  ])("marks %s dirty, advances content revision and enables autosave", async (_name, change) => {
    const saveAutosave = vi.fn(async () => ({ ok: true as const, value: undefined }));
    install({}, recovery({ saveAutosave }));
    storeModule.useEditorStore.setState({ isDirty: false });
    const revision = storeModule.useEditorStore.getState().contentRevision;
    change();
    expect(storeModule.useEditorStore.getState().isDirty).toBe(true);
    expect(storeModule.useEditorStore.getState().contentRevision).toBeGreaterThan(revision);
    await storeModule.useEditorStore.getState().autoSave();
    expect(saveAutosave).toHaveBeenCalledOnce();
  });

  it("does not mark selection and zoom-only actions dirty", () => {
    storeModule.useEditorStore.setState({ isDirty: false });
    storeModule.useEditorStore.getState().setZoom(2);
    storeModule.useEditorStore.getState().setSelection(new Set(["0,0"]));
    expect(storeModule.useEditorStore.getState().isDirty).toBe(false);
  });
});

describe("persistence outcomes", () => {
  it("distinguishes skipped and saved autosaves without mutating status on skip", async () => {
    const saveAutosave = vi.fn(async () => ({ ok: true as const, value: undefined }));
    install({}, recovery({ saveAutosave }));
    const before = { kind: "saved" as const, at: "before" };
    storeModule.useEditorStore.setState({ isDirty: false, autoSaveEnabled: true, saveStatus: before });
    await expect(storeModule.useEditorStore.getState().autoSave()).resolves.toEqual({ ok: true, value: "skipped" });
    expect(saveAutosave).not.toHaveBeenCalled();
    expect(storeModule.useEditorStore.getState().saveStatus).toEqual(before);

    storeModule.useEditorStore.setState({ isDirty: true });
    await expect(storeModule.useEditorStore.getState().autoSave()).resolves.toEqual({ ok: true, value: "saved" });
    storeModule.useEditorStore.getState().reportAutosaveResult({ ok: true, value: "saved" }, storeModule.useEditorStore.getState().createAutosaveTicket());
    expect(saveAutosave).toHaveBeenCalledOnce();
    expect(storeModule.useEditorStore.getState().saveStatus?.kind).toBe("autosaved");
  });

  it("returns save failures and converts thrown saves to unknown without changing dirty state", async () => {
    install({ saveProjectAs: vi.fn(async () => ({ ok: false as const, code: "permission-denied" as const })) });
    storeModule.useEditorStore.setState({ isDirty: true, saveStatus: null });
    await expect(storeModule.useEditorStore.getState().saveProject()).resolves.toEqual({ ok: false, code: "permission-denied" });
    expect(storeModule.useEditorStore.getState()).toMatchObject({ isDirty: true, saveStatus: null });

    install({ saveProjectAs: vi.fn(async () => { throw new Error("disk"); }) });
    await expect(storeModule.useEditorStore.getState().saveProjectAs()).resolves.toMatchObject({ ok: false, code: "unknown" });
    expect(storeModule.useEditorStore.getState()).toMatchObject({ isDirty: true, saveStatus: null });
  });
});

describe("open staleness", () => {
  it("returns a language-neutral stale result when content changes while the picker is pending", async () => {
    let finish!: (result: any) => void;
    install({ openProject: vi.fn((): Promise<any> => new Promise((resolve) => { finish = resolve; })) });
    const pending = storeModule.useEditorStore.getState().openProject();
    storeModule.useEditorStore.getState().setCell(0, 0, 3);
    finish({ ok: true as const, value: { project: project(undefined, 9), document: { displayName: "picked.pindou", writable: true } } });
    await expect(pending).resolves.toEqual({ ok: false as const, code: "stale" });
    expect(storeModule.useEditorStore.getState().canvasData[0][0].colorIndex).toBe(3);
  });
});

describe("stable project identity", () => {
  it("writes the same projectId across save-as and cloud serialization", async () => {
    const saved: ProjectFile[] = [];
    install({ saveProjectAs: vi.fn(async (value) => { saved.push(value); return { ok: true as const, value: { displayName: "copy.pindou", writable: true } }; }) });
    const projectId = storeModule.useEditorStore.getState().projectId;
    await storeModule.useEditorStore.getState().saveProjectAs();
    expect(saved[0].projectId).toBe(projectId);
    expect(storeModule.projectFromEditorState(storeModule.useEditorStore.getState()).projectId).toBe(projectId);
  });

  it("adopts a persisted projectId on open and cloud download", async () => {
    const persisted = { ...project(), projectId: "persisted-project" };
    install({ openProject: vi.fn(async () => ({ ok: true as const, value: { project: persisted, document: { displayName: "saved.pindou", writable: true } } })) });
    await storeModule.useEditorStore.getState().openProject();
    expect(storeModule.useEditorStore.getState().projectId).toBe("persisted-project");
    storeModule.useEditorStore.getState().newCanvas(1, 1);
    storeModule.useEditorStore.getState().replaceProjectFromCloud(persisted, "gist", "Cloud", "remote");
    expect(storeModule.useEditorStore.getState().projectId).toBe("persisted-project");
  });
});

describe("snapshot identity", () => {
  const info = (sourceProjectId?: string): SnapshotInfo => ({ path: "snapshot", name: "Snapshot", modified: "now", sourceProjectId });

  it("preserves local document and cloud association only for the same identity", async () => {
    const currentIdentity = storeModule.useEditorStore.getState().projectId;
    install({}, recovery({ loadSnapshot: vi.fn(async () => ({ ok: true as const, value: { project: project(undefined, 5), sourceProjectId: currentIdentity } })) }));
    const document = { displayName: "A.pindou", writable: true };
    storeModule.useEditorStore.setState({ projectDocument: document, projectPath: document.displayName, cloudGistId: "gist", baselineCanvasData: [[{ colorIndex: 1 }]] });
    await storeModule.useEditorStore.getState().restoreSnapshot(info(currentIdentity));
    expect(storeModule.useEditorStore.getState()).toMatchObject({ projectDocument: document, projectPath: "A.pindou", cloudGistId: "gist", projectId: currentIdentity, isDirty: true });
  });

  it("preserves legacy-adapter snapshots when the serialized ProjectFile carries the same projectId", async () => {
    const currentProjectId = storeModule.useEditorStore.getState().projectId;
    install({}, recovery({ loadSnapshot: vi.fn(async () => ({ ok: true as const, value: { ...project(undefined, 4), projectId: currentProjectId } })) }));
    const document = { displayName: "legacy.pindou", writable: true };
    storeModule.useEditorStore.setState({ projectDocument: document, projectPath: document.displayName });
    await storeModule.useEditorStore.getState().restoreSnapshot("legacy-path");
    expect(storeModule.useEditorStore.getState()).toMatchObject({ projectDocument: document, projectPath: "legacy.pindou", projectId: currentProjectId });
  });

  it.each(["different", undefined])("detaches a %s identity snapshot so Ctrl+S uses save-as", async (sourceProjectId) => {
    const saveProject = vi.fn();
    const saveProjectAs = vi.fn(async () => ({ ok: true as const, value: { displayName: "restored.pindou", writable: true } }));
    install({ saveProject, saveProjectAs }, recovery({ loadSnapshot: vi.fn(async () => ({ ok: true as const, value: { project: project(undefined, 5), sourceProjectId } })) }));
    const oldIdentity = storeModule.useEditorStore.getState().projectId;
    storeModule.useEditorStore.setState({ projectDocument: { displayName: "A.pindou", writable: true }, projectPath: "A.pindou", cloudGistId: "gist", baselineCanvasData: [[{ colorIndex: 1 }]], saveStatus: { kind: "saved", at: "2026-08-20T00:00:00.000Z" } });
    await storeModule.useEditorStore.getState().restoreSnapshot(info(sourceProjectId));
    expect(storeModule.useEditorStore.getState()).toMatchObject({ projectDocument: null, projectPath: null, cloudGistId: null, baselineCanvasData: null, saveStatus: null, isDirty: true });
    expect(storeModule.useEditorStore.getState().projectId).not.toBe(oldIdentity);
    await storeModule.useEditorStore.getState().saveProject();
    expect(saveProject).not.toHaveBeenCalled();
    expect(saveProjectAs).toHaveBeenCalledOnce();
  });
});

describe("localized default layer names", () => {
  it.each([
    ["en", (number: number) => `Layer ${number}`, ["Layer 1", "Layer 2"]],
    ["zh-CN", (number: number) => `图层 ${number}`, ["图层 1", "图层 2"]],
  ] as const)("keeps canonical names while displaying defaults in %s", async (_language, provider, displayNames) => {
    const { getLayerDisplayName, setDefaultLayerNameProvider } = await import("./defaultLayerNames");
    setDefaultLayerNameProvider(provider);
    storeModule.useEditorStore.getState().newCanvas(2, 2);
    storeModule.useEditorStore.getState().addLayer();
    const before = storeModule.useEditorStore.getState().layers;
    expect(before.map((layer) => layer.name)).toEqual(["Layer 1", "Layer 2"]);
    expect(before.map(getLayerDisplayName)).toEqual(displayNames);
    expect(storeModule.useEditorStore.getState().layers).toBe(before);
  });

  it("keeps stable generated-name indexes when layers are removed and added", async () => {
    const { getLayerDisplayName, normalizeDefaultLayerPromptName, setDefaultLayerNameProvider } = await import("./defaultLayerNames");
    setDefaultLayerNameProvider((number) => `图层 ${number}`);
    storeModule.useEditorStore.getState().newCanvas(2, 2);
    storeModule.useEditorStore.getState().addLayer();
    const second = storeModule.useEditorStore.getState().layers[1];
    storeModule.useEditorStore.getState().removeLayer(second.id);
    const stateAfterDelete = storeModule.useEditorStore.getState();
    const promptLayer = { name: `Layer ${stateAfterDelete.nextDefaultLayerNameIndex}`, defaultNameIndex: stateAfterDelete.nextDefaultLayerNameIndex };
    const promptValue = getLayerDisplayName(promptLayer);
    expect(promptValue).toBe("图层 3");
    expect(normalizeDefaultLayerPromptName(promptValue, promptValue)).toBeUndefined();
    stateAfterDelete.addLayer(normalizeDefaultLayerPromptName(promptValue, promptValue));
    expect(storeModule.useEditorStore.getState().layers.map((layer) => layer.defaultNameIndex)).toEqual([1, 3]);
  });

  it("uses the stable generated-name sequence when moving a selection to a new layer", () => {
    storeModule.useEditorStore.getState().newCanvas(2, 2);
    storeModule.useEditorStore.getState().addLayer();
    storeModule.useEditorStore.getState().addLayer();
    const second = storeModule.useEditorStore.getState().layers[1];
    storeModule.useEditorStore.getState().removeLayer(second.id);
    storeModule.useEditorStore.setState({ selection: new Set(["0,0"]), selectionBounds: { r1: 0, c1: 0, r2: 0, c2: 0 } });
    storeModule.useEditorStore.getState().moveSelectionToNewLayer();
    expect(storeModule.useEditorStore.getState().layers.map((layer) => layer.defaultNameIndex)).toEqual([1, 3, 4]);
    expect(storeModule.useEditorStore.getState().nextDefaultLayerNameIndex).toBe(5);
  });

  it.each(["open", "snapshot"] as const)("preserves generated-name metadata through %s hydration", async (kind) => {
    const generated = { ...project(), layers: [{ ...project().layers![0], name: "Layer 1", defaultNameIndex: 1 }] };
    if (kind === "open") {
      install({ openProject: vi.fn(async () => ({ ok: true as const, value: { project: generated, document: { displayName: "x.pindou", writable: true } } })) });
      await storeModule.useEditorStore.getState().openProject();
    } else {
      install({}, recovery({ loadSnapshot: vi.fn(async () => ({ ok: true as const, value: generated })) }));
      await storeModule.useEditorStore.getState().restoreSnapshot("snapshot");
    }
    const { setDefaultLayerNameProvider } = await import("./defaultLayerNames");
    setDefaultLayerNameProvider((number) => `Layer ${number}`);
    storeModule.useEditorStore.getState().localizeDefaultLayerNames();
    expect(storeModule.useEditorStore.getState().layers[0]).toMatchObject({ name: "Layer 1", defaultNameIndex: 1 });
  });

  it("marks an empty add-layer name as generated without persisting localization", async () => {
    const { getLayerDisplayName, setDefaultLayerNameProvider } = await import("./defaultLayerNames");
    setDefaultLayerNameProvider((number) => `图层 ${number}`);
    storeModule.useEditorStore.getState().addLayer();
    const layers = storeModule.useEditorStore.getState().layers;
    const layer = layers[layers.length - 1];
    expect(layer).toMatchObject({ name: "Layer 2", defaultNameIndex: 2 });
    expect(getLayerDisplayName(layer)).toBe("图层 2");
  });

  it("creates canonical generated layers and preserves custom names", async () => {
    const { setDefaultLayerNameProvider } = await import("./defaultLayerNames");
    setDefaultLayerNameProvider((number) => `图层 ${number}`);
    storeModule.useEditorStore.getState().newCanvas(2, 2);
    expect(storeModule.useEditorStore.getState().layers[0].name).toBe("Layer 1");
    const id = storeModule.useEditorStore.getState().layers[0].id;
    storeModule.useEditorStore.getState().renameLayer(id, "自定义");
    setDefaultLayerNameProvider((number) => `Layer ${number}`);
    storeModule.useEditorStore.getState().localizeDefaultLayerNames();
    expect(storeModule.useEditorStore.getState().layers[0].name).toBe("自定义");
  });

  it("does not mutate untouched generated layers when language changes", async () => {
    const { setDefaultLayerNameProvider } = await import("./defaultLayerNames");
    setDefaultLayerNameProvider((number) => `Layer ${number}`);
    storeModule.useEditorStore.getState().newCanvas(2, 2);
    const before = storeModule.useEditorStore.getState().layers;
    setDefaultLayerNameProvider((number) => `图层 ${number}`);
    storeModule.useEditorStore.getState().localizeDefaultLayerNames();
    expect(storeModule.useEditorStore.getState().layers).toBe(before);
    expect(before[0]).toMatchObject({ name: "Layer 1", defaultNameIndex: 1 });
  });

  it("migrates only exact historical default names and derives the next index from the max marker", () => {
    const empty = [[{ colorIndex: null }]];
    storeModule.useEditorStore.getState().loadProjectLayers([
      { id: "en", name: "Layer 7", data: empty, visible: true, opacity: 1 },
      { id: "zh", name: "图层 3", data: empty, visible: true, opacity: 1 },
      { id: "marker", name: "stale localized value", defaultNameIndex: 11, data: empty, visible: true, opacity: 1 },
      { id: "custom", name: "拼豆层 12", data: empty, visible: true, opacity: 1 },
    ], { width: 1, height: 1 });
    const state = storeModule.useEditorStore.getState();
    expect(state.layers.map(({ name, defaultNameIndex }) => ({ name, defaultNameIndex }))).toEqual([
      { name: "Layer 7", defaultNameIndex: 7 },
      { name: "Layer 3", defaultNameIndex: 3 },
      { name: "Layer 11", defaultNameIndex: 11 },
      { name: "拼豆层 12", defaultNameIndex: undefined },
    ]);
    expect(state.nextDefaultLayerNameIndex).toBe(12);
  });
});

describe("autosave lifecycle", () => {
  it("keeps loaded project save status on the replacement content revision", async () => {
    const loaded = project();
    storeModule.useEditorStore.setState({ contentRevision: 11 });
    storeModule.useEditorStore.getState().loadProjectDocument(loaded, "loaded.pindou");
    expect(storeModule.useEditorStore.getState().currentSaveStatus()).toMatchObject({ kind: "saved", revision: 12 });

    install({ openProject: vi.fn(async () => ({ ok: true as const, value: { project: loaded, document: { displayName: "opened.pindou", writable: true } } })) });
    await storeModule.useEditorStore.getState().openProject();
    expect(storeModule.useEditorStore.getState().currentSaveStatus()).toMatchObject({ kind: "saved", revision: 13 });
  });

  it("only exposes save status for the current content revision", () => {
    storeModule.useEditorStore.setState({ contentRevision: 4, saveStatus: { kind: "saved", at: "now", revision: 3 } });
    expect(storeModule.useEditorStore.getState().currentSaveStatus()).toBeNull();
    storeModule.useEditorStore.setState({ saveStatus: { kind: "saved", at: "now", revision: 4 } });
    expect(storeModule.useEditorStore.getState().currentSaveStatus()).toEqual({ kind: "saved", at: "now", revision: 4 });
  });

  it("captures the revision completed by formal save when edits race the write", async () => {
    let finish!: (value: any) => void;
    install({ saveProjectAs: vi.fn((): Promise<any> => new Promise((resolve) => { finish = resolve; })) });
    storeModule.useEditorStore.setState({ contentRevision: 5, isDirty: true });
    const pending = storeModule.useEditorStore.getState().saveProjectAs();
    storeModule.useEditorStore.getState().setCell(0, 0, 9);
    finish({ ok: true as const, value: { displayName: "saved.pindou", writable: true } });
    await pending;
    expect(storeModule.useEditorStore.getState().saveStatus?.revision).toBe(5);
    expect(storeModule.useEditorStore.getState().currentSaveStatus()).toBeNull();
  });

  it("captures the autosave ticket revision in its status", () => {
    storeModule.useEditorStore.setState({ contentRevision: 8, isDirty: true });
    const ticket = storeModule.useEditorStore.getState().createAutosaveTicket();
    expect(storeModule.useEditorStore.getState().reportAutosaveResult({ ok: true, value: "saved" }, ticket)).toBe(true);
    expect(storeModule.useEditorStore.getState().saveStatus?.revision).toBe(8);
  });

  it("ignores a stale autosave result after replacing project A with B", async () => {
    const stateA = storeModule.useEditorStore.getState();
    const ticket = stateA.createAutosaveTicket();
    storeModule.useEditorStore.getState().newCanvas(3, 3);
    storeModule.useEditorStore.getState().reportAutosaveResult({ ok: true, value: "saved" }, ticket);
    expect(storeModule.useEditorStore.getState().saveStatus).toBeNull();
    expect(storeModule.useEditorStore.getState().reportAutosaveResult({ ok: false, code: "network" }, ticket)).toBe(false);
    expect(storeModule.useEditorStore.getState().lastAutosaveErrorCode).toBeNull();
  });

  it("serializes deferred autosave A, formal clear, then newer autosave B", async () => {
    let finishA!: (value: any) => void;
    let stored: ProjectFile | null = null;
    const events: string[] = [];
    const saveAutosave = vi.fn((value: ProjectFile): Promise<any> => {
      const color = value.canvasData[0][0].colorIndex;
      events.push(`save-${color}-start`);
      if (color === 1) {
        return new Promise((resolve) => { finishA = (result) => { stored = value; events.push("save-1-end"); resolve(result); }; });
      }
      stored = value;
      events.push(`save-${color}-end`);
      return Promise.resolve({ ok: true as const, value: undefined });
    });
    const clearAutosave = vi.fn(async () => { stored = null; events.push("clear"); return { ok: true as const, value: undefined }; });
    install({}, recovery({ saveAutosave, clearAutosave }));

    storeModule.useEditorStore.getState().setCell(0, 0, 1);
    const pendingA = storeModule.useEditorStore.getState().autoSave();
    const formalSave = storeModule.useEditorStore.getState().saveProject();
    storeModule.useEditorStore.getState().setCell(0, 0, 2);
    const pendingB = storeModule.useEditorStore.getState().autoSave();

    await vi.waitFor(() => expect(saveAutosave).toHaveBeenCalledTimes(1));
    finishA({ ok: true as const, value: undefined });
    await Promise.all([pendingA, formalSave, pendingB]);

    expect(events).toEqual(["save-1-start", "save-1-end", "clear", "save-2-start", "save-2-end"]);
    expect((stored as ProjectFile | null)?.canvasData[0][0].colorIndex).toBe(2);
  });

  it("releases the autosave queue when a formal save rejects", async () => {
    const events: string[] = [];
    const saveAutosave = vi.fn(async (value: ProjectFile) => {
      events.push(`save-${value.canvasData[0][0].colorIndex}`);
      return { ok: true as const, value: undefined };
    });
    install({ saveProjectAs: vi.fn(async () => { throw new Error("write rejected"); }) }, recovery({ saveAutosave }));
    storeModule.useEditorStore.getState().setCell(0, 0, 1);
    const formal = storeModule.useEditorStore.getState().saveProject();
    storeModule.useEditorStore.getState().setCell(0, 0, 2);
    const backup = storeModule.useEditorStore.getState().autoSave();
    await expect(formal).resolves.toMatchObject({ ok: false, code: "unknown" });
    await expect(backup).resolves.toMatchObject({ ok: true });
    expect(events).toEqual(["save-2"]);
  });

  it("restores autosave as a detached dirty project with a new identity", () => {
    const before = storeModule.useEditorStore.getState().projectId;
    storeModule.useEditorStore.setState({ projectPath: "A.pindou", projectDocument: { displayName: "A.pindou", writable: true }, cloudGistId: "gist", baselineCanvasData: [[{ colorIndex: 1 }]] });
    storeModule.useEditorStore.getState().restoreAutosave(project(undefined, 8));
    expect(storeModule.useEditorStore.getState()).toMatchObject({ canvasData: [[{ colorIndex: 8 }]], projectPath: null, projectDocument: null, cloudGistId: null, baselineCanvasData: null, isDirty: true });
    expect(storeModule.useEditorStore.getState().projectId).not.toBe(before);
  });
});

describe("fresh webview layer allocation", () => {
  it.each(["add", "duplicate"] as const)("allocates unique IDs for %s after session restore and undo", async operation => {
    vi.resetModules();
    const { useEditorStore: store } = await import("./editorStore");
    const session = await import("./editorSession");
    expect(store.getState().activeLayerId).toBe("layer_1");
    const snapshot = session.captureEditorSession();
    snapshot.project = { ...project(), projectId: snapshot.project.projectId,
      layers: ["layer_2", "layer_4"].map(id => ({ ...project().layers![0], id, name: id })) };
    snapshot.activeLayerId = "layer_2";
    session.restoreEditorSession(snapshot, { displayName: "/saved.pindou", writable: true },
      { project: snapshot.project, savedRevision: snapshot.revision });
    const create = () => operation === "add" ? store.getState().addLayer("Added")
      : store.getState().duplicateLayer("layer_2", "Copy");
    create();
    const createdId = store.getState().activeLayerId;
    expect(store.getState().layers).toHaveLength(3);
    expect(["layer_2", "layer_4"]).not.toContain(createdId);
    expect(store.getState().layers.find(layer => layer.id === createdId)).toMatchObject({
      name: operation === "add" ? "Added" : "Copy",
      data: [[{ colorIndex: operation === "add" ? null : 7 }]],
    });
    store.getState().undo();
    expect(store.getState().layers.map(layer => layer.id)).toEqual(["layer_2", "layer_4"]);
    store.getState().removeLayer("layer_4");
    store.getState().undo();
    create();
    const ids = store.getState().layers.map(layer => layer.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toContain("layer_2");
    expect(ids).toContain("layer_4");
    const replayed = session.captureEditorSession();
    expect(() => session.restoreEditorSession(replayed, { displayName: "/saved.pindou", writable: true },
      { project: snapshot.project, savedRevision: snapshot.revision })).not.toThrow();
  });
});
