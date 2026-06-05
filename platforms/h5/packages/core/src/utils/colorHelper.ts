import { MARD_COLORS } from "../data/mard221";
import type { MardColor } from "../types";

export interface ColorOverride {
  hex: string;
  rgb: [number, number, number];
}

export type ColorOverrideMap = Map<number, ColorOverride>;

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export function getEffectiveColor(index: number, overrides: ColorOverrideMap): MardColor {
  const base = MARD_COLORS[index];
  if (!base) return { code: "?", name: "?", hex: "#FF00FF", rgb: [255, 0, 255] };
  const ov = overrides.get(index);
  if (!ov) return base;
  return { ...base, hex: ov.hex, rgb: ov.rgb };
}

export function getEffectiveHex(index: number, overrides: ColorOverrideMap): string {
  const ov = overrides.get(index);
  if (ov) return ov.hex;
  return MARD_COLORS[index]?.hex || "#FF00FF";
}

export function getEffectiveRgb(index: number, overrides: ColorOverrideMap): [number, number, number] {
  const ov = overrides.get(index);
  if (ov) return ov.rgb;
  return MARD_COLORS[index]?.rgb || [255, 0, 255];
}

const STORAGE_KEY = "pindou_color_overrides";

export function loadOverrides(): ColorOverrideMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const entries: [number, ColorOverride][] = JSON.parse(raw);
    return new Map(entries);
  } catch {
    return new Map();
  }
}

export function saveOverrides(overrides: ColorOverrideMap): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...overrides.entries()]));
}
