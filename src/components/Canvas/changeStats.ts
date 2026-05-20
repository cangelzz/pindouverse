import type { CanvasData } from "../../types";

export interface ChangeStats {
  added: number;
  removed: number;
  modified: number;
}

export function computeChangeStats(
  current: CanvasData,
  baseline: CanvasData | null,
  viewW: number,
  viewH: number,
): ChangeStats {
  if (!baseline) return { added: 0, removed: 0, modified: 0 };
  let added = 0, removed = 0, modified = 0;
  for (let r = 0; r < viewH; r++) {
    for (let c = 0; c < viewW; c++) {
      const base = baseline[r]?.[c]?.colorIndex ?? null;
      const curr = current[r]?.[c]?.colorIndex ?? null;
      if (base === curr) continue;
      if (base === null) added++;
      else if (curr === null) removed++;
      else modified++;
    }
  }
  return { added, removed, modified };
}
