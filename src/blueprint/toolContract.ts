import { z } from "zod";

export const TOOL_LIMITS = {
  canvasDimension: 256, batchCells: 65_536, inspectCells: 4_096,
  responseBytes: 65_536, toolRequestBytes: 8 * 1024 * 1024,
  imageBytes: 25 * 1024 * 1024, decodedPixels: 16_777_216,
  exportPixels: 16_777_216, outputBytes: 64 * 1024 * 1024,
  sessionBytes: 64 * 1024 * 1024, pendingPerEditor: 16,
  toolTimeoutMs: 30_000, mediaTimeoutMs: 120_000, handoffTimeoutMs: 30_000,
} as const;

const identity = z.string().min(1).max(200);
const revision = z.number().int().nonnegative();
const dimension = z.number().int().min(1).max(TOOL_LIMITS.canvasDimension);
export const editorTargetSchema = z.strictObject({ editorId: identity, projectGeneration: revision, expectedRevision: revision.optional() });
export const pointSchema = z.strictObject({ x: z.number().int().min(0).max(255), y: z.number().int().min(0).max(255) });
export const rectangleSchema = pointSchema.extend({ width: dimension, height: dimension });
export const inspectionRegionSchema = rectangleSchema.extend({ x: revision, y: revision });
export const colorSchema = z.string().min(1).max(16).regex(/^\S+$/);
export const layerTargetSchema = editorTargetSchema.extend({ layerId: identity });
const name = z.string().min(1).max(200).regex(/\S/);
const layerId = { layerId: identity };
const readTarget = { editorId: identity.optional() };
const hex = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
const filePath = z.string().min(1).max(4096);
const shapeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("line"), start: pointSchema, end: pointSchema }),
  z.strictObject({ kind: z.literal("rectangle"), region: rectangleSchema, filled: z.boolean().default(false) }),
  z.strictObject({ kind: z.literal("circle"), center: pointSchema, radius: z.number().int().min(0).max(255), filled: z.boolean().default(false) }),
]);
const layerChangeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("add"), name: name.optional() }),
  z.strictObject({ kind: z.literal("rename"), ...layerId, name: name.optional() }),
  z.strictObject({ kind: z.literal("activate"), ...layerId }),
  z.strictObject({ kind: z.literal("visibility"), ...layerId, visible: z.boolean() }),
  z.strictObject({ kind: z.literal("opacity"), ...layerId, opacity: z.number().min(0).max(1) }),
  z.strictObject({ kind: z.literal("reorder"), ...layerId, direction: z.enum(["up", "down"]) }),
  z.strictObject({ kind: z.literal("duplicate"), ...layerId, name: name.optional() }),
  z.strictObject({ kind: z.literal("mergeDown"), ...layerId }),
  z.strictObject({ kind: z.literal("remove"), ...layerId, allowDataLoss: z.boolean().default(false) }),
]);

export const toolInputSchemas = {
  inspect_blueprint: z.strictObject({
    ...readTarget, view: z.enum(["composite", "layer"]).default("composite"),
    layerId: identity.optional(), region: inspectionRegionSchema.optional(),
  }).refine(input => input.view !== "layer" || input.layerId !== undefined, "Layer view requires layerId"),
  search_palette: z.strictObject({ ...readTarget, query: z.string().max(100).default(""), limit: z.number().int().min(1).max(50).default(20) }),
  set_beads: layerTargetSchema.extend({ beads: z.array(pointSchema.extend({ color: colorSchema.nullable() })).min(1).max(TOOL_LIMITS.batchCells) }),
  draw_shape: layerTargetSchema.extend({ color: colorSchema.nullable(), shape: shapeSchema }),
  fill_region: layerTargetSchema.extend({
    color: colorSchema.nullable(), region: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("rectangle"), bounds: rectangleSchema }),
      z.strictObject({ kind: z.literal("connected"), seed: pointSchema }),
    ]),
  }),
  replace_color: editorTargetSchema.extend({
    from: colorSchema, to: colorSchema,
    scope: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("layer"), ...layerId, region: rectangleSchema.optional() }),
      z.strictObject({ kind: z.literal("allLayers") }),
    ]),
  }),
  resize_canvas: editorTargetSchema.extend({
    width: dimension, height: dimension, anchorRow: z.number().int().min(0).max(2), anchorCol: z.number().int().min(0).max(2),
    allowDataLoss: z.boolean().default(false),
  }).refine(input => !input.allowDataLoss || input.expectedRevision !== undefined, "Data loss confirmation requires expectedRevision"),
  manage_layer: editorTargetSchema.extend({ change: layerChangeSchema })
    .refine(input => input.change.kind !== "remove" || !input.change.allowDataLoss || input.expectedRevision !== undefined,
      "Data loss confirmation requires expectedRevision"),
  configure_grid: editorTargetSchema.extend({
    patch: z.strictObject({
      groupSize: dimension.optional(), edgePadding: z.number().int().min(0).max(64).optional(),
      startX: z.number().int().min(-10000).max(10000).optional(), startY: z.number().int().min(-10000).max(10000).optional(),
      visible: z.boolean().optional(), lineColor: hex.optional(), groupLineColor: hex.optional(),
      lineWidth: z.number().min(0).max(8).optional(), groupLineWidth: z.number().min(0).max(8).optional(),
    }).refine(patch => Object.keys(patch).length > 0, "Patch cannot be empty"),
  }),
  update_project_info: editorTargetSchema.extend({
    patch: z.strictObject({
      title: z.string().max(200).nullable().optional(), author: z.string().max(200).nullable().optional(),
      description: z.string().max(4000).nullable().optional(),
      link: z.union([z.literal(""), z.url({ protocol: /^https?$/ }).max(2048)]).nullable().optional(),
    }).refine(patch => Object.keys(patch).length > 0, "Patch cannot be empty"),
  }),
  import_image: layerTargetSchema.extend({
    path: filePath.optional(), width: dimension, height: dimension, position: pointSchema,
    algorithm: z.enum(["euclidean", "ciede2000"]).default("ciede2000"),
  }),
  export_blueprint: editorTargetSchema.extend({
    path: filePath.optional(), format: z.enum(["png", "jpeg"]).default("png"), cellSize: z.number().int().min(8).max(64).default(32),
  }),
  save_blueprint: editorTargetSchema,
};

export type ToolName = keyof typeof toolInputSchemas;
export type ToolInput<Name extends ToolName> = z.infer<(typeof toolInputSchemas)[Name]>;
export const toolNames = Object.keys(toolInputSchemas) as ToolName[];
export const implementedToolNames: readonly ToolName[] = [
  "inspect_blueprint", "search_palette", "set_beads", "draw_shape", "fill_region", "replace_color",
  "resize_canvas", "manage_layer", "configure_grid", "update_project_info",
  "import_image", "export_blueprint", "save_blueprint",
];
const operationSchema = z.enum(toolNames as [ToolName, ...ToolName[]]);
const bindingShape = { editorId: identity, projectGeneration: revision };
const correlationShape = { ...bindingShape, toolRequestId: z.string().min(1).max(300).regex(/^tool:/) };
export type EditorBinding = z.infer<typeof editorTargetSchema>;
export const stampSchema = z.strictObject({ ...bindingShape, revision, isDirty: z.boolean(), activeLayerId: identity });
export type EditorStamp = z.infer<typeof stampSchema>;
export const errorCodeSchema = z.enum([
  "no_editor", "ambiguous_editor", "editor_not_ready", "editor_closed", "editor_busy", "invalid_arguments",
  "invalid_color", "invalid_layer", "stale_revision", "data_loss_confirmation_required", "cancelled",
  "io_error", "save_handoff_failed", "outcome_unknown", "permission_denied", "limit_exceeded",
]);
export type ToolErrorCode = z.infer<typeof errorCodeSchema>;
export const toolResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), stamp: stampSchema, summary: z.string(), value: z.unknown() }),
  z.strictObject({ ok: z.literal(false), error: z.strictObject({ code: errorCodeSchema, message: z.string(), details: z.unknown().optional() }) }),
]);
export type ToolResult = z.infer<typeof toolResultSchema>;
export const toolRequestSchema = z.strictObject({ type: z.literal("blueprintToolRequest"), ...correlationShape, operation: operationSchema, input: z.unknown(),
  fileAccess: z.strictObject({ grantId: identity, path: filePath }).optional() });
export const toolResponseSchema = z.strictObject({ type: z.literal("blueprintToolResponse"), ...correlationShape, result: toolResultSchema });
export const toolCancelSchema = z.strictObject({ type: z.literal("blueprintToolCancel"), ...correlationShape });
export type ToolRequest = z.infer<typeof toolRequestSchema>;
export type ToolResponse = z.infer<typeof toolResponseSchema>;

export function toolFailure(code: ToolErrorCode, message: string, details?: unknown): ToolResult {
  return { ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } };
}

const descriptions: Record<ToolName, string> = {
  inspect_blueprint: "Inspect the selected live Pindou blueprint, including unsaved edits. Returns editorId, projectGeneration, revision and activeLayerId for writes. Layer view requires layerId; regions use zero-based x/y and width/height. Omit region for metadata only.",
  search_palette: "Find actual MARD palette codes by code, name or hex value in the selected Pindou editor. Use returned codes for writes; never guess array indices.",
  set_beads: "Atomically set or clear beads in the named live layer. Zero-based x/y; null means empty, not a transparent bead. Duplicate coordinates are rejected. Use expectedRevision from inspection to protect against intervening hand edits.",
  draw_shape: "Draw a line, rectangle or circle on a named layer using editor geometry. Coordinates are zero-based; null clears cells. Shapes outside canvas bounds are rejected, never clipped.",
  fill_region: "Fill a rectangle or a connected region on a named layer. Coordinates are zero-based; null erases. This is one reversible edit.",
  replace_color: "Replace actual palette codes in an explicit layer/rectangle or all layers in one reversible operation. Hidden layers are not silently edited or skipped.",
  resize_canvas: "Resize canvas bounds without resampling using anchorRow/anchorCol 0,1,2. Data loss requires allowDataLoss=true and the expectedRevision returned by the loss estimate.",
  manage_layer: "Add, rename, activate, show/hide, change opacity, reorder, duplicate, merge down or remove layers by ID. Removing nonempty layers requires allowDataLoss and the estimate's expectedRevision. Activation is nonpersistent.",
  configure_grid: "Atomically patch persisted grid settings. Provide at least one field; omitted fields remain unchanged. Does not move beads.",
  update_project_info: "Atomically patch project title, author, description or HTTP(S) link. At least one field is required. Null clears a field; omitted fields remain unchanged.",
  import_image: "Import a bounded local image into a named layer at zero-based position. Stale conversions are rejected. An omitted path opens the normal user file dialog.",
  export_blueprint: "Export a consistent live blueprint snapshot to PNG or JPEG using existing decoration defaults. Explicit paths are restricted to authorized local files; omitted path opens a save dialog. This writes a file, not the project.",
  save_blueprint: "Explicitly save live unsaved edits. First save opens a destination dialog and safely transfers the editor session. Results distinguish the written revision from newer dirty content and panel-handoff failures.",
};

export const toolDefinitions = toolNames.map(name => ({
  name,
  title: `Pindou: ${name.replace(/_/g, " ")}`,
  description: descriptions[name],
  writes: name !== "inspect_blueprint" && name !== "search_palette",
  schema: toolInputSchemas[name],
}));

export function createToolContributions(names: readonly ToolName[] = implementedToolNames) {
  return toolDefinitions.filter(tool => names.includes(tool.name)).map(tool => {
    const inputSchema = z.toJSONSchema(tool.schema, { target: "draft-7", io: "input" });
    if (tool.name === "resize_canvas") inputSchema.allOf = [{
      if: { required: ["allowDataLoss"], properties: { allowDataLoss: { const: true } } },
      then: { required: ["expectedRevision"] },
    }];
    if (tool.name === "manage_layer") inputSchema.allOf = [{
      if: { required: ["change"], properties: { change: { required: ["kind", "allowDataLoss"], properties: { kind: { const: "remove" }, allowDataLoss: { const: true } } } } },
      then: { required: ["expectedRevision"] },
    }];
    if (tool.name === "inspect_blueprint") inputSchema.allOf = [{
      if: { required: ["view"], properties: { view: { const: "layer" } } }, then: { required: ["layerId"] },
    }];
    if (tool.name === "configure_grid" || tool.name === "update_project_info") {
      const patch = inputSchema.properties?.patch;
      if (patch && typeof patch === "object") patch.minProperties = 1;
    }
    return {
      name: `pindouverse_${tool.name}`, displayName: tool.title, modelDescription: tool.description,
      toolReferenceName: `pindou_${tool.name}`, canBeReferencedInPrompt: true, inputSchema,
    };
  });
}