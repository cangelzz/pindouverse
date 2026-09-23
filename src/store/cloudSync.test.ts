import { beforeAll, beforeEach, describe, expect, it } from "vitest";

let useEditorStore: typeof import("./editorStore").useEditorStore;
let projectFromEditorState: typeof import("./editorStore").projectFromEditorState;
const memory = new Map<string, string>();
beforeAll(async () => {
  (globalThis as any).localStorage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key), clear: () => memory.clear() };
  ({ useEditorStore, projectFromEditorState } = await import("./editorStore"));
});

const project: any = {
  version: 3, canvasSize: { width: 1, height: 1 }, canvasData: [[{ colorIndex: 6 }]],
  layers: [{ id: "l", name: "L", visible: true, opacity: 1, data: [[{ colorIndex: 6 }]] }],
  gridConfig: { groupSize: 8, edgePadding: 0, startX: 2, startY: 3, visible: true, lineColor: "x", lineWidth: 1, groupLineColor: "y", groupLineWidth: 2 },
  projectInfo: { title: "Cloud" }, createdAt: "created", updatedAt: "updated",
};

describe("editor cloud semantics", () => {
  beforeEach(() => { localStorage.clear(); useEditorStore.getState().newCanvas(1, 1); });

  it("builds a complete v3-ready project from editor state", () => {
    useEditorStore.setState({ layers: project.layers, canvasData: project.canvasData, gridConfig: project.gridConfig, projectInfo: project.projectInfo });
    expect(projectFromEditorState(useEditorStore.getState())).toMatchObject({ version: 3, layers: project.layers, gridConfig: project.gridConfig, projectInfo: project.projectInfo });
  });

  it("tracks cloud sync separately from local file dirty state", () => {
    useEditorStore.setState({ isDirty: true, projectPath: "local.pindou", saveStatus: { kind: "saved", at: "2026-08-20T00:00:00.000Z" } });
    useEditorStore.getState().setCloudSync("g", "remote", "Cloud");
    expect(useEditorStore.getState()).toMatchObject({ isDirty: true, projectPath: "local.pindou", saveStatus: { kind: "saved", at: "2026-08-20T00:00:00.000Z" }, cloudSyncStatus: "synced" });
    useEditorStore.getState().setCell(0, 0, 4);
    expect(useEditorStore.getState().cloudSyncStatus).toBe("local-changes");
  });

  it("replaces a project from cloud as unsaved local content with synced cloud association", () => {
    useEditorStore.setState({ projectPath: "old.pindou", projectDocument: { displayName: "old.pindou", writable: true }, baselineCanvasData: [[{ colorIndex: 1 }]], selection: new Set(["0,0"]), undoStack: [{ kind: "cells", changesByLayer: [{ layerId: useEditorStore.getState().activeLayerId, entries: [] }] }] });
    useEditorStore.getState().replaceProjectFromCloud(project, "g", "Cloud", "remote");
    expect(useEditorStore.getState()).toMatchObject({ canvasData: [[{ colorIndex: 6 }]], projectPath: null, projectDocument: null, baselineCanvasData: null, isDirty: true, cloudGistId: "g", cloudProjectName: "Cloud", cloudSyncStatus: "synced", selection: null, undoStack: [] });
  });

  it("ignores stale cloud downloads after another replacement begins", () => {
    const ticket = useEditorStore.getState().beginCloudDownload();
    useEditorStore.getState().newCanvas(2, 2);
    expect(useEditorStore.getState().replaceProjectFromCloud(project, "g", "Cloud", "remote", ticket)).toBe(false);
    expect(useEditorStore.getState().canvasSize).toEqual({ width: 2, height: 2 });
  });

  it("resets every cloud field on new project", () => {
    useEditorStore.setState({ cloudGistId: "g", cloudUpdatedAt: "u", cloudProjectName: "N", cloudSyncStatus: "synced", cloudSyncedRevision: 4 });
    useEditorStore.getState().newCanvas(2, 2);
    expect(useEditorStore.getState()).toMatchObject({ cloudGistId: null, cloudUpdatedAt: null, cloudProjectName: null, cloudSyncStatus: "unlinked", cloudSyncedRevision: null });
  });

  it("deleting only the linked gist clears association and preserves local state", () => {
    useEditorStore.setState({ cloudGistId: "linked", cloudUpdatedAt: "u", cloudProjectName: "N", cloudSyncStatus: "synced", isDirty: true, projectPath: "local.pindou" });
    useEditorStore.getState().clearCloudAssociation("other");
    expect(useEditorStore.getState().cloudGistId).toBe("linked");
    useEditorStore.getState().clearCloudAssociation("linked");
    expect(useEditorStore.getState()).toMatchObject({ cloudGistId: null, cloudSyncStatus: "unlinked", isDirty: true, projectPath: "local.pindou" });
  });
});
