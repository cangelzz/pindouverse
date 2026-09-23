import { MARD_COLORS } from "../data/mard221";
import { projectFromEditorState, useEditorStore } from "../store/editorStore";
import { getEffectiveColor } from "../utils/colorHelper";
import { lineCells, rectCells, circleCells } from "../utils/shapeDrawing";
import { computeFloodReplaceEntries } from "../utils/floodFill";
import { buildToolExportRequest, mapToolImportPixels, type ToolMediaServices } from "./toolMedia";
import { i18n } from "../i18n";
import { TOOL_LIMITS, toolFailure, toolInputSchemas, toolRequestSchema, type EditorBinding, type EditorStamp, type ToolInput, type ToolName, type ToolRequest, type ToolResult } from "./toolContract";

const paletteIndices = new Map(MARD_COLORS.map((color, index) => [color.code, index]));

export function getEditorStamp(binding: EditorBinding): EditorStamp {
  const state = useEditorStore.getState();
  return { editorId: binding.editorId, projectGeneration: state.projectGeneration,
    revision: state.contentRevision, isDirty: state.isDirty, activeLayerId: state.activeLayerId };
}

function success(binding: EditorBinding, value: unknown, summary: string): ToolResult {
  const result: ToolResult = { ok: true, stamp: getEditorStamp(binding), summary, value };
  return new TextEncoder().encode(JSON.stringify(result)).byteLength > TOOL_LIMITS.responseBytes
    ? toolFailure("limit_exceeded", "Response is too large; request a smaller region") : result;
}

function inspect(input: ToolInput<"inspect_blueprint">, binding: EditorBinding): ToolResult {
  const state = useEditorStore.getState();
  const layer = input.layerId ? state.layers.find(item => item.id === input.layerId) : undefined;
  if (input.view === "layer" && !layer) return toolFailure("invalid_layer", "The selected layer does not exist");
  const data = input.view === "layer" ? layer!.data : state.canvasData;
  const counts = new Map<number, number>();
  for (const row of data) for (const cell of row) {
    if (cell.colorIndex !== null) counts.set(cell.colorIndex, (counts.get(cell.colorIndex) ?? 0) + 1);
  }
  let cells: (string | null)[][] | undefined;
  if (input.region) {
    const region = input.region;
    if (region.x + region.width > state.canvasSize.width || region.y + region.height > state.canvasSize.height)
      return toolFailure("invalid_arguments", "Inspection region is outside the canvas");
    if (region.width * region.height > TOOL_LIMITS.inspectCells) return toolFailure("limit_exceeded", "Inspect at most 4096 cells per request");
    cells = data.slice(region.y, region.y + region.height).map(row => row.slice(region.x, region.x + region.width)
      .map(cell => cell.colorIndex === null ? null : MARD_COLORS[cell.colorIndex]?.code ?? null));
  }
  return success(binding, {
    canvasSize: state.canvasSize, projectInfo: state.projectInfo ?? null, gridConfig: state.gridConfig,
    projectPath: state.projectPath, beadCount: [...counts.values()].reduce((total, count) => total + count, 0),
    colors: [...counts].map(([index, count]) => ({ code: MARD_COLORS[index]?.code, count })),
    layers: state.layers.map(({ id, name, visible, opacity }) => ({ id, name, visible, opacity })),
    ...(cells ? { cells } : {}),
  }, "Read live blueprint state");
}

function searchPalette(input: ToolInput<"search_palette">, binding: EditorBinding): ToolResult {
  const state = useEditorStore.getState();
  const query = input.query.toLowerCase();
  const colors = MARD_COLORS.map((color, index) => ({ ...color, ...getEffectiveColor(index, state.colorOverrides) }))
    .filter(color => color.code.toLowerCase().includes(query) || color.name.toLowerCase().includes(query) || color.hex.toLowerCase().includes(query))
    .slice(0, input.limit);
  return success(binding, colors, "Read palette matches");
}

function setBeads(input: ToolInput<"set_beads">, binding: EditorBinding): ToolResult {
  const state = useEditorStore.getState();
  const layer = state.layers.find(item => item.id === input.layerId);
  if (!layer) return toolFailure("invalid_layer", "The selected layer does not exist");
  if (!layer.visible) return toolFailure("editor_busy", "Show the target layer before editing it");
  const seen = new Set<string>();
  const cells: { row: number; col: number; colorIndex: number | null }[] = [];
  for (const bead of input.beads) {
    const key = `${bead.y},${bead.x}`;
    if (seen.has(key)) return toolFailure("invalid_arguments", "Duplicate bead coordinates");
    seen.add(key);
    if (bead.x >= state.canvasSize.width || bead.y >= state.canvasSize.height) return toolFailure("invalid_arguments", "Bead is outside the canvas");
    const colorIndex = bead.color === null ? null : paletteIndices.get(bead.color);
    if (colorIndex === undefined) return toolFailure("invalid_color", "Unknown palette code; use search_palette");
    cells.push({ row: bead.y, col: bead.x, colorIndex });
  }
  const changedCells = state.batchSetLayerCells([{ layerId: layer.id, cells }]);
  return success(binding, { changedCells }, `Changed ${changedCells} beads`);
}

export function planShapeCells(shape: ToolInput<"draw_shape">["shape"]): [number, number][] {
  switch (shape.kind) {
    case "line": return lineCells(shape.start.y, shape.start.x, shape.end.y, shape.end.x);
    case "rectangle": return rectCells(shape.region.y, shape.region.x,
      shape.region.y + shape.region.height - 1, shape.region.x + shape.region.width - 1, shape.filled);
    case "circle": return circleCells(shape.center.y, shape.center.x, shape.radius, shape.filled);
  }
}

function drawShape(input: ToolInput<"draw_shape">, binding: EditorBinding): ToolResult {
  const cells = new Map(planShapeCells(input.shape).map(([row, col]) => [`${row},${col}`, { x: col, y: row, color: input.color }]));
  if ([...cells.values()].some(cell => cell.x < 0 || cell.y < 0)) return toolFailure("invalid_arguments", "Shape extends outside the canvas");
  return setBeads({ ...input, beads: [...cells.values()] }, binding);
}

function fillRegion(input: ToolInput<"fill_region">, binding: EditorBinding): ToolResult {
  if (input.region.kind === "rectangle") return drawShape({ ...input, shape: { kind: "rectangle", region: input.region.bounds, filled: true } }, binding);
  const state = useEditorStore.getState();
  const layer = state.layers.find(item => item.id === input.layerId);
  if (!layer) return toolFailure("invalid_layer", "The target layer does not exist");
  if (!layer.visible) return toolFailure("editor_busy", "Show the layer before editing it");
  const seed = input.region.seed;
  if (seed.x >= state.canvasSize.width || seed.y >= state.canvasSize.height) return toolFailure("invalid_arguments", "Seed is outside the canvas");
  const colorIndex = input.color === null ? null : paletteIndices.get(input.color);
  if (colorIndex === undefined) return toolFailure("invalid_color", "Unknown palette code");
  const cells = computeFloodReplaceEntries(layer.data, seed.y, seed.x, colorIndex, state.canvasSize.width, state.canvasSize.height);
  const changedCells = state.batchSetLayerCells([{ layerId: layer.id, cells }]);
  return success(binding, { changedCells }, `Filled ${changedCells} beads`);
}

function replaceColor(input: ToolInput<"replace_color">, binding: EditorBinding): ToolResult {
  const state = useEditorStore.getState();
  const from = paletteIndices.get(input.from);
  const to = paletteIndices.get(input.to);
  if (from === undefined || to === undefined) return toolFailure("invalid_color", "Unknown palette code");
  const scope = input.scope;
  const layers = scope.kind === "allLayers" ? state.layers : state.layers.filter(layer => layer.id === scope.layerId);
  if (!layers.length) return toolFailure("invalid_layer", "The target layer does not exist");
  const region = scope.kind === "layer" && scope.region ? scope.region : { x: 0, y: 0, ...state.canvasSize };
  if (region.x + region.width > state.canvasSize.width || region.y + region.height > state.canvasSize.height)
    return toolFailure("invalid_arguments", "Region is outside the canvas");
  if (from === to) return success(binding, { changedCells: 0 }, "No colors changed");
  const groups = layers.map(layer => {
    const cells: { row: number; col: number; colorIndex: number }[] = [];
    for (let row = region.y; row < region.y + region.height; row++) {
      for (let col = region.x; col < region.x + region.width; col++) {
        if (layer.data[row][col].colorIndex === from) cells.push({ row, col, colorIndex: to });
      }
    }
    return { layer, cells };
  }).filter(group => group.cells.length);
  const hidden = groups.filter(group => !group.layer.visible);
  if (hidden.length) return toolFailure("editor_busy", "Matching beads are on hidden layers; show them before replacing", { layerIds: hidden.map(group => group.layer.id) });
  const changedCells = state.batchSetLayerCells(groups.map(group => ({ layerId: group.layer.id, cells: group.cells })));
  return success(binding, { changedCells }, `Replaced ${changedCells} beads`);
}

function requireLossConfirmation(lostBeads: number, allow: boolean): ToolResult | null {
  return lostBeads > 0 && !allow ? toolFailure("data_loss_confirmation_required", "This operation removes beads; confirm against the current revision", {
    lostBeads, revision: useEditorStore.getState().contentRevision,
  }) : null;
}

function resizeCanvas(input: ToolInput<"resize_canvas">, binding: EditorBinding): ToolResult {
  const state = useEditorStore.getState();
  const offsetRow = Math.floor(input.anchorRow * (input.height - state.canvasSize.height) / 2);
  const offsetCol = Math.floor(input.anchorCol * (input.width - state.canvasSize.width) / 2);
  let lostBeads = 0;
  for (const layer of state.layers) layer.data.forEach((row, rowIndex) => row.forEach((cell, colIndex) => {
    if (cell.colorIndex !== null && (rowIndex + offsetRow < 0 || rowIndex + offsetRow >= input.height
      || colIndex + offsetCol < 0 || colIndex + offsetCol >= input.width)) lostBeads++;
  }));
  const denied = requireLossConfirmation(lostBeads, input.allowDataLoss);
  if (denied) return denied;
  state.resizeCanvas(input.width, input.height, input.anchorRow, input.anchorCol);
  return success(binding, { lostBeads, canvasSize: useEditorStore.getState().canvasSize }, "Updated canvas dimensions");
}

function manageLayer(input: ToolInput<"manage_layer">, binding: EditorBinding): ToolResult {
  const state = useEditorStore.getState();
  const change = input.change;
  if (change.kind === "add") {
    state.addLayer(change.name);
    return success(binding, { layerId: useEditorStore.getState().activeLayerId }, "Added layer");
  }
  const index = state.layers.findIndex(layer => layer.id === change.layerId);
  if (index < 0) return toolFailure("invalid_layer", "The target layer does not exist");
  const layer = state.layers[index];
  switch (change.kind) {
    case "rename": state.renameLayer(layer.id, change.name); break;
    case "activate": state.setActiveLayer(layer.id); break;
    case "visibility": state.setLayerVisible(layer.id, change.visible); break;
    case "opacity": state.setLayerOpacity(layer.id, change.opacity); break;
    case "reorder": state.moveLayer(layer.id, change.direction); break;
    case "duplicate": state.duplicateLayer(layer.id, change.name); break;
    case "mergeDown":
      if (index === 0) return toolFailure("invalid_layer", "The bottom layer cannot be merged down");
      if (!layer.visible || !state.layers[index - 1].visible) return toolFailure("editor_busy", "Show both layers before merging");
      state.mergeLayerDown(layer.id);
      break;
    case "remove": {
      if (state.layers.length === 1) return toolFailure("invalid_layer", "The last layer cannot be removed");
      const lostBeads = layer.data.reduce((count, row) => count + row.filter(cell => cell.colorIndex !== null).length, 0);
      const denied = requireLossConfirmation(lostBeads, change.allowDataLoss);
      if (denied) return denied;
      state.removeLayer(layer.id);
      break;
    }
  }
  return success(binding, { layerId: change.kind === "duplicate" || change.kind === "mergeDown" ? useEditorStore.getState().activeLayerId : layer.id }, "Updated layer");
}

function configureGrid(input: ToolInput<"configure_grid">, binding: EditorBinding): ToolResult {
  const state = useEditorStore.getState();
  const changed = state.commitProjectPatch({ gridConfig: { ...state.gridConfig, ...input.patch } });
  return success(binding, { changed }, "Updated grid settings");
}

function updateProjectInfo(input: ToolInput<"update_project_info">, binding: EditorBinding): ToolResult {
  const state = useEditorStore.getState();
  const info = { ...state.projectInfo };
  for (const key of Object.keys(input.patch) as (keyof typeof input.patch)[]) {
    const value = input.patch[key];
    if (value === null) delete info[key]; else if (value !== undefined) info[key] = value;
  }
  const changed = state.commitProjectPatch({ projectInfo: info });
  return success(binding, { changed }, "Updated project information");
}

export const dispatcherToolNames: readonly ToolName[] = ["inspect_blueprint", "search_palette", "set_beads", "draw_shape", "fill_region", "replace_color", "resize_canvas", "manage_layer", "configure_grid", "update_project_info", "import_image", "export_blueprint"];

export async function dispatchBlueprintTool(request: ToolRequest, binding: EditorBinding, signal: AbortSignal, media?: ToolMediaServices): Promise<ToolResult> {
  if (signal.aborted) return toolFailure("cancelled", "Tool request was cancelled");
  const parsed = toolRequestSchema.safeParse(request);
  if (!parsed.success) return toolFailure("invalid_arguments", "Invalid tool request envelope");
  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > TOOL_LIMITS.toolRequestBytes)
    return toolFailure("limit_exceeded", "Tool request is too large");
  const state = useEditorStore.getState();
  if (request.editorId !== binding.editorId) return toolFailure("editor_closed", "Editor identity no longer matches");
  if (request.projectGeneration !== binding.projectGeneration || state.projectGeneration !== binding.projectGeneration)
    return toolFailure("stale_revision", "The editor now contains a different project");
  const input = toolInputSchemas[request.operation].safeParse(request.input);
  if (!input.success) return toolFailure("invalid_arguments", input.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  const value = input.data;
  if ("editorId" in value && value.editorId !== undefined && value.editorId !== binding.editorId)
    return toolFailure("editor_closed", "Input targets a different editor");
  if ("projectGeneration" in value && value.projectGeneration !== state.projectGeneration)
    return toolFailure("stale_revision", "Input targets a different project generation");
  if ("expectedRevision" in value && value.expectedRevision !== undefined && value.expectedRevision !== state.contentRevision)
    return toolFailure("stale_revision", "Blueprint changed; inspect it again before editing");
  if (request.operation !== "inspect_blueprint" && request.operation !== "search_palette") {
    const busy = state.getBlueprintBusyReason();
    if (busy) return toolFailure("editor_busy", busy);
    if (state.canvasSize.width > 256 || state.canvasSize.height > 256) return toolFailure("limit_exceeded", "This canvas exceeds the tool editing limit");
  }
  switch (request.operation) {
    case "inspect_blueprint": return inspect(value as ToolInput<"inspect_blueprint">, binding);
    case "search_palette": return searchPalette(value as ToolInput<"search_palette">, binding);
    case "set_beads": return setBeads(value as ToolInput<"set_beads">, binding);
    case "draw_shape": return drawShape(value as ToolInput<"draw_shape">, binding);
    case "fill_region": return fillRegion(value as ToolInput<"fill_region">, binding);
    case "replace_color": return replaceColor(value as ToolInput<"replace_color">, binding);
    case "resize_canvas": return resizeCanvas(value as ToolInput<"resize_canvas">, binding);
    case "manage_layer": return manageLayer(value as ToolInput<"manage_layer">, binding);
    case "configure_grid": return configureGrid(value as ToolInput<"configure_grid">, binding);
    case "update_project_info": return updateProjectInfo(value as ToolInput<"update_project_info">, binding);
    case "import_image": {
      if (!media) return toolFailure("permission_denied", "An authorized image service is required");
      const input = value as ToolInput<"import_image">;
      const layer = state.layers.find(item => item.id === input.layerId);
      if (!layer) return toolFailure("invalid_layer", "The target layer does not exist");
      if (!layer.visible) return toolFailure("editor_busy", "Show the target layer before importing");
      if (input.position.x + input.width > state.canvasSize.width || input.position.y + input.height > state.canvasSize.height)
        return toolFailure("invalid_arguments", "Imported image would exceed the canvas bounds");
      try {
        const pixels = await media.importPixels(input, signal);
        if (signal.aborted) return toolFailure("cancelled", "Image import cancelled");
        const current = useEditorStore.getState();
        if (current.projectGeneration !== state.projectGeneration || current.contentRevision !== state.contentRevision)
          return toolFailure("stale_revision", "Blueprint changed while the image was decoded");
        const busy = current.getBlueprintBusyReason();
        if (busy) return toolFailure("editor_busy", busy);
        if (pixels.width !== input.width || pixels.height !== input.height) return toolFailure("invalid_arguments", "Decoded image dimensions differ from the request");
        const cells = mapToolImportPixels(pixels, input.algorithm, state.colorOverrides)
          .map(cell => ({ ...cell, row: cell.row + input.position.y, col: cell.col + input.position.x }));
        const changedCells = current.batchSetLayerCells([{ layerId: layer.id, cells }]);
        return success(binding, { changedCells }, "Imported image into the target layer");
      } catch (error) {
        return toolFailure(signal.aborted ? "cancelled" : error instanceof RangeError ? "invalid_arguments" : "io_error", "Image import failed before committing changes");
      }
    }
    case "export_blueprint": {
      if (!media) return toolFailure("permission_denied", "An authorized export service is required");
      const settings = value as ToolInput<"export_blueprint">;
      if ((state.canvasSize.width + 2) * (state.canvasSize.height + 2) * settings.cellSize ** 2 > TOOL_LIMITS.exportPixels)
        return toolFailure("limit_exceeded", "Export exceeds the pixel limit; reduce cellSize");
      const request = buildToolExportRequest(projectFromEditorState(state), state.colorOverrides, settings, {
        legendByCount: i18n.t("export.labels.legendByCount"), legendByCode: i18n.t("export.labels.legendByCode"),
      });
      try {
        await media.exportImage(request, signal);
        return success(binding, { path: request.output_path, exportedRevision: state.contentRevision }, "Exported blueprint snapshot");
      } catch {
        return toolFailure(signal.aborted ? "outcome_unknown" : "io_error", "Export file write could not be confirmed");
      }
    }
    default: return toolFailure("invalid_arguments", "Operation is not implemented");
  }
}