import type { CanvasData } from '@pindou/core';

export interface FloodEntry {
  row: number;
  col: number;
  colorIndex: number | null;
}

export function computeFloodReplaceEntries(
  data: CanvasData,
  startRow: number,
  startCol: number,
  replaceWith: number | null,
  width: number,
  height: number,
): FloodEntry[] {
  if (startRow < 0 || startRow >= height || startCol < 0 || startCol >= width) return [];
  const target = data[startRow]?.[startCol]?.colorIndex ?? null;
  if (target === replaceWith) return [];
  const visited = new Set<string>();
  const stack: [number, number][] = [[startRow, startCol]];
  const entries: FloodEntry[] = [];
  while (stack.length > 0) {
    const [r, c] = stack.pop()!;
    const key = `${r},${c}`;
    if (visited.has(key)) continue;
    if (r < 0 || r >= height || c < 0 || c >= width) continue;
    const cellColor = data[r]?.[c]?.colorIndex ?? null;
    if (cellColor !== target) continue;
    visited.add(key);
    entries.push({ row: r, col: c, colorIndex: replaceWith });
    stack.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
  }
  return entries;
}

export function computeFloodSelectCells(
  data: CanvasData,
  startRow: number,
  startCol: number,
  width: number,
  height: number,
): Set<string> {
  const out = new Set<string>();
  if (startRow < 0 || startRow >= height || startCol < 0 || startCol >= width) return out;
  const target = data[startRow]?.[startCol]?.colorIndex ?? null;
  const stack: [number, number][] = [[startRow, startCol]];
  while (stack.length > 0) {
    const [r, c] = stack.pop()!;
    const key = `${r},${c}`;
    if (out.has(key)) continue;
    if (r < 0 || r >= height || c < 0 || c >= width) continue;
    const cellColor = data[r]?.[c]?.colorIndex ?? null;
    if (cellColor !== target) continue;
    out.add(key);
    stack.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
  }
  return out;
}
