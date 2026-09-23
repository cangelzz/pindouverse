import { z } from "zod";
import type { EditorSessionSnapshot, ProjectFile, ProjectHistoryPatch } from "../types";
export type { EditorSessionSnapshot } from "../types";
import type { ProjectDocumentRef } from "../platform/projectFileService";
import { getPendingSessionActions, mergeLayers, projectFromEditorState, useEditorStore } from "./editorStore";
import { applyCellsHistory, prepareProjectHistory } from "./editorHistory";
import { MARD_COLORS } from "../data/mard221";
import { TOOL_LIMITS } from "../blueprint/toolContract";

const viewKeys = ["zoom", "cellSize", "offsetX", "offsetY", "blueprintMode", "blueprintMirror", "gridFocusMode", "currentTool",
	"selectedColorIndex", "highlightColorIndex", "beadLayerVisible", "beadLayerOpacity", "refImagePixels", "refImageWidth", "refImageHeight",
	"refImageVisible", "refImageOpacity", "showActiveLayerTag", "autoSaveEnabled", "importedFileName", "lastEraserSubmode"] as const;

const cellSchema = z.strictObject({ colorIndex: z.number().int().min(0).max(MARD_COLORS.length - 1).nullable() });
const historyEntrySchema = z.strictObject({ row: z.number().int().nonnegative(), col: z.number().int().nonnegative(),
	prevColorIndex: cellSchema.shape.colorIndex, newColorIndex: cellSchema.shape.colorIndex });
const historySchema = z.discriminatedUnion("kind", [
	z.strictObject({ kind: z.literal("cells"), changesByLayer: z.array(z.strictObject({ layerId: z.string().min(1), entries: z.array(historyEntrySchema) })) }),
	z.strictObject({ kind: z.literal("layers"), layers: z.array(z.unknown()), activeLayerId: z.string() }),
	z.strictObject({ kind: z.literal("projectPatch"), before: z.record(z.string(), z.unknown()), after: z.record(z.string(), z.unknown()) }),
]);
let lockOwner: string | null = null;

export function acquireEditorSessionLock(owner: string): boolean {
	if (lockOwner || useEditorStore.getState().getBlueprintBusyReason() || getPendingSessionActions()) return false;
	lockOwner = owner;
	useEditorStore.setState({ sessionLocked: true });
	return true;
}

export function releaseEditorSessionLock(owner: string): void {
	if (lockOwner !== owner) return;
	lockOwner = null;
	useEditorStore.setState({ sessionLocked: false });
}

export function finalizeEditorSave(saved: { project: ProjectFile; savedRevision: number }): void {
	const state = useEditorStore.getState();
	if (saved.project.projectId !== state.projectId || saved.savedRevision > state.contentRevision)
		throw new Error("Save acknowledgement targets a different project");
	useEditorStore.setState({
		isDirty: state.contentRevision !== saved.savedRevision,
		baselineCanvasData: saved.project.canvasData.map(row => row.map(cell => ({ ...cell }))),
		saveStatus: { kind: "saved", at: new Date().toISOString(), revision: saved.savedRevision },
	});
}

export function captureEditorSession(): EditorSessionSnapshot {
	const state = useEditorStore.getState();
	const view = Object.fromEntries(viewKeys.map(key => [key, state[key]])) as EditorSessionSnapshot["view"];
	const snapshot: EditorSessionSnapshot = {
		version: 1, project: projectFromEditorState(state), projectGeneration: state.projectGeneration, revision: state.contentRevision,
		activeLayerId: state.activeLayerId, nextDefaultLayerNameIndex: state.nextDefaultLayerNameIndex,
		undoStack: state.undoStack, redoStack: state.redoStack, isDirty: state.isDirty,
		baselineCanvasData: state.baselineCanvasData, saveStatus: state.saveStatus,
		selection: state.selection ? [...state.selection] : null, selectionBounds: state.selectionBounds,
		clipboard: state.clipboard ? { ...state.clipboard, cells: [...state.clipboard.cells] } : null,
		colorOverrides: [...state.colorOverrides], view,
	};
	const json = JSON.stringify(snapshot);
	if (new TextEncoder().encode(json).byteLength > TOOL_LIMITS.sessionBytes) throw new Error("Editor session exceeds transfer size limit");
	return JSON.parse(json) as EditorSessionSnapshot;
}

export function restoreEditorSession(snapshot: EditorSessionSnapshot, destination: ProjectDocumentRef,
	saved: { project: ProjectFile; savedRevision: number }): void {
	if (snapshot.version !== 1 || !Number.isInteger(snapshot.revision) || snapshot.revision < saved.savedRevision
		|| !Number.isInteger(snapshot.projectGeneration) || snapshot.projectGeneration < 0
		|| new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > TOOL_LIMITS.sessionBytes) throw new Error("Invalid session transfer");
	z.array(historySchema).parse(snapshot.undoStack);
	z.array(historySchema).parse(snapshot.redoStack);
	const project = snapshot.project;
	const current = useEditorStore.getState();
	const patch = { canvasSize: project.canvasSize, layers: project.layers, activeLayerId: snapshot.activeLayerId,
		gridConfig: project.gridConfig, projectInfo: project.projectInfo ?? null, nextDefaultLayerNameIndex: snapshot.nextDefaultLayerNameIndex };
	if (!prepareProjectHistory(current, patch, true)) throw new Error("Invalid project state in session transfer");
	for (const direction of ["undo", "redo"] as const) {
		let state: ProjectHistoryPatch = patch;
		const stack = direction === "undo" ? snapshot.undoStack : snapshot.redoStack;
		for (const action of [...stack].reverse()) {
			if (action.kind === "cells") {
				const layers = applyCellsHistory(state.layers!, action, direction);
				if (!layers) throw new Error("Invalid layer target in transferred history");
				state = { ...state, layers };
			} else {
				const historyPatch = action.kind === "layers" ? { layers: action.layers, activeLayerId: action.activeLayerId }
					: direction === "undo" ? action.before : action.after;
				if (!prepareProjectHistory(state, historyPatch, true)) throw new Error("Invalid project history in session transfer");
				state = { ...state, ...historyPatch };
			}
		}
	}
	if (project.projectId !== saved.project.projectId) throw new Error("Saved and live project identities differ");
	const view = Object.fromEntries(viewKeys.map(key => [key, snapshot.view[key]])) as EditorSessionSnapshot["view"];
	if ([view.zoom, view.cellSize, view.offsetX, view.offsetY].some(value => !Number.isFinite(value)) || view.zoom <= 0 || view.cellSize <= 0)
		throw new Error("Invalid viewport in session transfer");
	useEditorStore.setState({
		...view, ...patch, projectInfo: project.projectInfo, canvasData: mergeLayers(project.layers!, project.canvasSize.width, project.canvasSize.height),
		projectId: project.projectId!, projectCreatedAt: project.createdAt,
		projectGeneration: snapshot.projectGeneration, contentRevision: snapshot.revision,
		projectPath: destination.displayName, projectDocument: destination,
		undoStack: snapshot.undoStack, redoStack: snapshot.redoStack,
		isDirty: snapshot.revision !== saved.savedRevision,
		baselineCanvasData: saved.project.canvasData.map(row => row.map(cell => ({ ...cell }))),
		saveStatus: { kind: "saved", at: new Date().toISOString(), revision: saved.savedRevision },
		selection: snapshot.selection ? new Set(snapshot.selection) : null, selectionBounds: snapshot.selectionBounds,
		clipboard: snapshot.clipboard ? { ...snapshot.clipboard, cells: new Map(snapshot.clipboard.cells) } : null,
		colorOverrides: new Map(snapshot.colorOverrides), floatingSelection: null, previewOverlay: null, adjustSession: null,
		cloudGistId: null, cloudUpdatedAt: null, cloudVersion: null, cloudProjectName: null, cloudSyncStatus: "unlinked", cloudSyncedRevision: null,
	});
}