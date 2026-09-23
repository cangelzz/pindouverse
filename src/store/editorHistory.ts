import type { BeadLayer, CellsHistoryAction, HistoryAction, HistoryEntry, ProjectHistoryPatch, ProjectPatchHistoryAction } from "../types";
import { MARD_COLORS } from "../data/mard221";

export function historyValuesEqual(before: unknown, after: unknown): boolean {
  if (Object.is(before, after)) return true;
  if (!before || !after || typeof before !== "object" || typeof after !== "object") return false;
  if (Array.isArray(before) !== Array.isArray(after)) return false;
  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  const keys = Object.keys(beforeRecord);
  return keys.length === Object.keys(afterRecord).length
    && keys.every(key => Object.prototype.hasOwnProperty.call(afterRecord, key) && historyValuesEqual(beforeRecord[key], afterRecord[key]));
}

export function prepareProjectHistory(
  state: ProjectHistoryPatch,
  patch: ProjectHistoryPatch,
  allowUnchanged = false,
): ProjectPatchHistoryAction | null {
  const keys = Object.keys(patch) as (keyof ProjectHistoryPatch)[];
  if (keys.some(key => !["canvasSize", "layers", "activeLayerId", "gridConfig", "projectInfo", "nextDefaultLayerNameIndex"].includes(key)
    || patch[key] === undefined)) return null;
  const next = { ...state, ...patch };
  const size = next.canvasSize;
  const layers = next.layers;
  if (!size || !Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width < 1 || size.height < 1
    || !layers?.length || new Set(layers.map(layer => layer.id)).size !== layers.length
    || !layers.some(layer => layer.id === next.activeLayerId)) return null;
  if (layers.some(layer => !layer.id || typeof layer.name !== "string" || typeof layer.visible !== "boolean"
    || !Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1
    || layer.data.length !== size.height || layer.data.some(row => row.length !== size.width
      || row.some(cell => cell.colorIndex !== null && (!Number.isInteger(cell.colorIndex)
        || cell.colorIndex < 0 || cell.colorIndex >= MARD_COLORS.length))))) return null;
  const grid = next.gridConfig;
  if (!grid || !Number.isInteger(grid.groupSize) || grid.groupSize < 1
    || !Number.isFinite(grid.edgePadding) || grid.edgePadding < 0
    || !Number.isInteger(grid.startX) || !Number.isInteger(grid.startY)
    || !Number.isFinite(grid.lineWidth) || grid.lineWidth < 0
    || !Number.isFinite(grid.groupLineWidth) || grid.groupLineWidth < 0
    || typeof grid.visible !== "boolean" || typeof grid.lineColor !== "string" || typeof grid.groupLineColor !== "string") return null;
  if (next.projectInfo && Object.values(next.projectInfo).some(value => value !== undefined && typeof value !== "string")) return null;
  if (!Number.isInteger(next.nextDefaultLayerNameIndex) || next.nextDefaultLayerNameIndex! < 1) return null;
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const key of keys) {
    const previous = key === "projectInfo" ? state[key] ?? null : state[key];
    if (historyValuesEqual(previous, patch[key])) continue;
    before[key] = previous;
    after[key] = patch[key];
  }
  if (patch.layers && state.layers && (patch.layers.length !== state.layers.length
    || state.layers.some(layer => !patch.layers!.some(nextLayer => nextLayer.id === layer.id)))) {
    before.activeLayerId = state.activeLayerId;
    after.activeLayerId = next.activeLayerId;
  }
  if (!Object.keys(after).length && !allowUnchanged) return null;
  return { kind: "projectPatch", before: before as ProjectHistoryPatch, after: after as ProjectHistoryPatch };
}

export function applyCellsHistory(
  layers: BeadLayer[],
  action: CellsHistoryAction,
  direction: "undo" | "redo",
): BeadLayer[] | null {
  const byId = new Map(layers.map(layer => [layer.id, layer]));
  if (byId.size !== layers.length) return null;
  for (const group of action.changesByLayer) {
    const layer = byId.get(group.layerId);
    if (!layer) return null;
    for (const entry of group.entries) {
      if (!Number.isInteger(entry.row) || !Number.isInteger(entry.col)
        || entry.row < 0 || entry.col < 0 || !layer.data[entry.row]?.[entry.col]) return null;
    }
  }
  const updated = new Map<string, BeadLayer>();
  for (const group of action.changesByLayer) {
    let layer = updated.get(group.layerId);
    if (!layer) {
      const original = byId.get(group.layerId)!;
      layer = { ...original, data: original.data.map(row => row.map(cell => ({ ...cell }))) };
      updated.set(group.layerId, layer);
    }
    const entries = direction === "undo" ? [...group.entries].reverse() : group.entries;
    for (const entry of entries) {
      layer.data[entry.row][entry.col] = {
        colorIndex: direction === "undo" ? entry.prevColorIndex : entry.newColorIndex,
      };
    }
  }
  return layers.map(layer => updated.get(layer.id) ?? layer);
}

export function groupStrokeHistory(actions: HistoryAction[]): HistoryAction[] {
  const result: HistoryAction[] = [];
  let groups = new Map<string, Map<string, HistoryEntry>>();
  const flush = () => {
    if (groups.size) result.push({
      kind: "cells",
      changesByLayer: [...groups].map(([layerId, entries]) => ({ layerId, entries: [...entries.values()] })),
    });
    groups = new Map();
  };
  for (const action of actions) {
    if (action.kind !== "cells") {
      flush();
      result.push(action);
      continue;
    }
    for (const group of action.changesByLayer) {
      let entries = groups.get(group.layerId);
      if (!entries) {
        entries = new Map();
        groups.set(group.layerId, entries);
      }
      for (const entry of group.entries) {
        const key = `${entry.row},${entry.col}`;
        const previous = entries.get(key);
        entries.set(key, previous ? { ...previous, newColorIndex: entry.newColorIndex } : { ...entry });
      }
    }
  }
  flush();
  return result;
}