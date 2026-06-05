import type { CanvasData } from '@pindou/core';

export interface SelectionBounds {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export interface ClipboardPayload {
  w: number;
  h: number;
  cells: (number | null)[][];
}

interface CellPatch {
  row: number;
  col: number;
  prev: number | null;
  next: number | null;
}

export function rectSelectionCells(b: SelectionBounds): Set<string> {
  const minR = Math.min(b.r1, b.r2);
  const maxR = Math.max(b.r1, b.r2);
  const minC = Math.min(b.c1, b.c2);
  const maxC = Math.max(b.c1, b.c2);
  const out = new Set<string>();
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      out.add(`${r},${c}`);
    }
  }
  return out;
}

export function cloneSelectionRegion(data: CanvasData, b: SelectionBounds): ClipboardPayload {
  const minR = Math.min(b.r1, b.r2);
  const maxR = Math.max(b.r1, b.r2);
  const minC = Math.min(b.c1, b.c2);
  const maxC = Math.max(b.c1, b.c2);
  const h = maxR - minR + 1;
  const w = maxC - minC + 1;
  const cells: (number | null)[][] = [];
  for (let r = 0; r < h; r++) {
    const row: (number | null)[] = [];
    for (let c = 0; c < w; c++) {
      const v = data[minR + r]?.[minC + c]?.colorIndex;
      row.push(v ?? null);
    }
    cells.push(row);
  }
  return { w, h, cells };
}

export function applyClipboardToData(
  data: CanvasData,
  payload: ClipboardPayload,
  offsetRow: number,
  offsetCol: number,
): CellPatch[] {
  const patches: CellPatch[] = [];
  const height = data.length;
  const width = data[0]?.length ?? 0;
  for (let r = 0; r < payload.h; r++) {
    for (let c = 0; c < payload.w; c++) {
      const tr = offsetRow + r;
      const tc = offsetCol + c;
      if (tr < 0 || tr >= height || tc < 0 || tc >= width) continue;
      const prev = data[tr][tc].colorIndex ?? null;
      const next = payload.cells[r][c];
      if (prev === next) continue;
      data[tr][tc] = { colorIndex: next };
      patches.push({ row: tr, col: tc, prev, next });
    }
  }
  return patches;
}
