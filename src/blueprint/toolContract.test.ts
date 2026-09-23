import { describe, expect, it } from "vitest";
import { createToolContributions, toolInputSchemas, toolNames, toolRequestSchema, toolResponseSchema, type ToolName } from "./toolContract";

const target = { editorId: "editor-1", projectGeneration: 1 };

describe("blueprint tool contract", () => {
  it("publishes conditional revision and nonempty-patch constraints", () => {
    const tools = createToolContributions(toolNames);
    expect(tools.find(tool => tool.name === "pindouverse_resize_canvas")!.inputSchema.allOf).toBeDefined();
    expect(tools.find(tool => tool.name === "pindouverse_manage_layer")!.inputSchema.allOf).toBeDefined();
    expect(tools.find(tool => tool.name === "pindouverse_inspect_blueprint")!.inputSchema.allOf).toBeDefined();
    const grid = tools.find(tool => tool.name === "pindouverse_configure_grid")!.inputSchema;
    expect((grid.properties!.patch as { minProperties?: number }).minProperties).toBe(1);
  });
  const examples: Record<ToolName, unknown> = {
    inspect_blueprint: { region: { x: 500, y: 0, width: 1, height: 1 } },
    search_palette: { query: "#ffffff" },
    set_beads: { ...target, layerId: "layer-1", beads: [{ x: 0, y: 0, color: null }] },
    draw_shape: { ...target, layerId: "layer-1", color: null, shape: { kind: "circle", center: { x: 0, y: 0 }, radius: 0 } },
    fill_region: { ...target, layerId: "layer-1", color: null, region: { kind: "connected", seed: { x: 0, y: 0 } } },
    replace_color: { ...target, from: "A1", to: "A2", scope: { kind: "allLayers" } },
    resize_canvas: { ...target, width: 2, height: 2, anchorRow: 0, anchorCol: 0 },
    manage_layer: { ...target, change: { kind: "add" } },
    configure_grid: { ...target, patch: { groupSize: 5 } },
    update_project_info: { ...target, patch: { title: null } },
    import_image: { ...target, layerId: "layer-1", width: 2, height: 2, position: { x: 0, y: 0 } },
    export_blueprint: target,
    save_blueprint: target,
  };

  it.each(toolNames)("accepts documented %s input and rejects extra keys", name => {
    expect(toolInputSchemas[name].safeParse(examples[name]).success).toBe(true);
    expect(toolInputSchemas[name].safeParse({ ...examples[name] as object, arbitrary: true }).success).toBe(false);
  });

  it("generates thirteen bounded strict JSON schemas without registering unfinished tools", () => {
    expect(createToolContributions().map(tool => tool.name)).toEqual([
      "pindouverse_inspect_blueprint", "pindouverse_search_palette", "pindouverse_set_beads",
      "pindouverse_draw_shape", "pindouverse_fill_region", "pindouverse_replace_color", "pindouverse_resize_canvas",
      "pindouverse_manage_layer", "pindouverse_configure_grid", "pindouverse_update_project_info",
      "pindouverse_import_image", "pindouverse_export_blueprint", "pindouverse_save_blueprint",
    ]);
    const contributions = createToolContributions(toolNames);
    expect(contributions).toHaveLength(13);
    expect(new Set(contributions.map(tool => tool.name)).size).toBe(13);
    for (const tool of contributions) {
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.canBeReferencedInPrompt).toBe(true);
      expect(JSON.parse(JSON.stringify(tool.inputSchema))).toEqual(tool.inputSchema);
    }
  });

  it("requires editor and layer identity for writes", () => {
    expect(toolInputSchemas.set_beads.safeParse({ beads: [{ x: 0, y: 0, color: null }] }).success).toBe(false);
    expect(toolInputSchemas.inspect_blueprint.safeParse({}).success).toBe(true);
  });

  it.each([
    { x: -1, y: 0, color: null },
    { x: 0.5, y: 0, color: null },
    { x: 256, y: 0, color: null },
    { x: 0, y: 0, color: "" },
    { x: 0, y: 0, color: null, arbitrary: true },
  ])("rejects malformed bead %j", bead => {
    expect(toolInputSchemas.set_beads.safeParse({ ...target, layerId: "layer-1", beads: [bead] }).success).toBe(false);
  });

  it("distinguishes empty beads from palette codes", () => {
    expect(toolInputSchemas.set_beads.safeParse({ ...target, layerId: "layer-1", beads: [{ x: 0, y: 0, color: null }] }).success).toBe(true);
  });

  it("requires a revision for destructive confirmations", () => {
    const resize = { ...target, width: 1, height: 1, anchorRow: 0, anchorCol: 0, allowDataLoss: true };
    expect(toolInputSchemas.resize_canvas.safeParse(resize).success).toBe(false);
    expect(toolInputSchemas.resize_canvas.safeParse({ ...resize, expectedRevision: 2 }).success).toBe(true);
  });

  it("isolates tool and legacy request identities", () => {
    const request = { type: "blueprintToolRequest", toolRequestId: "tool:editor-1:1", ...target, operation: "inspect_blueprint", input: {} };
    expect(toolRequestSchema.safeParse(request).success).toBe(true);
    expect(toolRequestSchema.safeParse({ ...request, requestId: 1 }).success).toBe(false);
    expect(toolResponseSchema.safeParse(request).success).toBe(false);
  });
});