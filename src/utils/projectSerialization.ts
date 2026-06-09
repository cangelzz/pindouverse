import type { ProjectFile, CanvasCell, BeadLayer } from "../types";

/** A cell as it appears on disk: either the verbose v2 form `{colorIndex}` or
 *  the flat v3 form (`null | number`). */
type DiskCell = number | null | { colorIndex: number | null };

function expandCell(cell: DiskCell, ctx: string): CanvasCell {
  if (cell === null) return { colorIndex: null };
  if (typeof cell === "number") return { colorIndex: cell };
  if (typeof cell === "object" && "colorIndex" in cell) {
    const ci = (cell as any).colorIndex;
    if (ci === null || typeof ci === "number") return { colorIndex: ci };
    throw new Error(`Invalid cell at ${ctx}: ${JSON.stringify(cell)}`);
  }
  throw new Error(`Invalid cell at ${ctx}: ${JSON.stringify(cell)}`);
}

function expandRow(row: unknown, ctx: string): CanvasCell[] {
  if (!Array.isArray(row)) throw new Error(`Expected array at ${ctx}`);
  return row.map((c, i) => expandCell(c as DiskCell, `${ctx}[${i}]`));
}

function expandGrid(grid: unknown, ctx: string): CanvasCell[][] {
  if (!Array.isArray(grid)) throw new Error(`Expected 2D array at ${ctx}`);
  return grid.map((row, i) => expandRow(row, `${ctx}[${i}]`));
}

function collapseCell(cell: CanvasCell): number | null {
  return cell.colorIndex;
}

function collapseGrid(grid: CanvasCell[][]): (number | null)[][] {
  return grid.map((row) => row.map(collapseCell));
}

/**
 * Parse raw JSON text from disk and produce a fully-normalised in-memory
 * ProjectFile. The disk format is auto-detected from the `version` field:
 *   - version >= 3 : cells are flat (`null | number`).
 *   - version < 3 or missing : cells are verbose (`{colorIndex}`).
 *   - unknown future version : treated as v3.
 *
 * After this call, every cell in `canvasData` and every layer's `data` is
 * a `CanvasCell = { colorIndex: number | null }` regardless of source.
 * The in-memory `version` is always 3 after normalisation, regardless of source.
 */
export function normalizeProjectFromDisk(rawJson: string): ProjectFile {
  const raw = JSON.parse(rawJson) as any;
  const canvasData = expandGrid(raw.canvasData, "canvasData");
  const layers: BeadLayer[] | undefined = Array.isArray(raw.layers)
    ? raw.layers.map((l: any, i: number): BeadLayer => ({
        id: String(l.id),
        name: String(l.name ?? "图层"),
        visible: l.visible !== false,
        opacity: typeof l.opacity === "number" ? l.opacity : 1,
        data: expandGrid(l.data, `layers[${i}].data`),
      }))
    : undefined;

  return {
    version: 3,
    canvasSize: raw.canvasSize,
    canvasData,
    layers,
    gridConfig: raw.gridConfig,
    projectInfo: raw.projectInfo,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

/**
 * Serialise an in-memory ProjectFile as compact v3 JSON. Always stamps
 * `version: 3`, collapses every cell to `null | number`, and uses
 * `JSON.stringify` with no indent.
 */
export function serializeProjectToV3(project: ProjectFile): string {
  const out: any = {
    ...project,
    version: 3,
    canvasData: collapseGrid(project.canvasData),
  };
  if (project.layers) {
    out.layers = project.layers.map((l) => ({
      ...l,
      data: collapseGrid(l.data),
    }));
  }
  return JSON.stringify(out);
}
