import type { CanvasData } from "../types";

export interface FloodEntry {
  row: number;
  col: number;
  colorIndex: number | null;
}

/**
 * Compute the cells affected by a 4-connected flood-replace starting at
 * (startRow, startCol). Returns an array of entries suitable for
 * `batchSetCells`. Returns empty if the target color already equals
 * `replaceWith` (no-op).
 */
export function computeFloodReplaceEntries(
  layerData: CanvasData,
  startRow: number,
  startCol: number,
  replaceWith: number | null,
  width: number,
  height: number,
): FloodEntry[] {
  if (startRow < 0 || startRow >= height || startCol < 0 || startCol >= width) {
    return [];
  }
  const target = layerData[startRow]?.[startCol]?.colorIndex ?? null;
  if (target === replaceWith) return [];

  const visited = new Set<string>();
  const stack: [number, number][] = [[startRow, startCol]];
  const entries: FloodEntry[] = [];

  while (stack.length > 0) {
    const [r, c] = stack.pop()!;
    const key = `${r},${c}`;
    if (visited.has(key)) continue;
    if (r < 0 || r >= height || c < 0 || c >= width) continue;
    const cellColor = layerData[r]?.[c]?.colorIndex ?? null;
    if (cellColor !== target) continue;
    visited.add(key);
    entries.push({ row: r, col: c, colorIndex: replaceWith });
    stack.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
  }

  return entries;
}
