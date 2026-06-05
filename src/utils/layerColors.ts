/**
 * Per-layer accent colors — used in two places:
 *   1. The layer panel: a small color chip beside each layer's name.
 *   2. The floating cursor tag: shown on the canvas when the active layer
 *      is NOT the default (first) one, so the user can't forget which layer
 *      they're drawing on.
 *
 * The default layer (index 0) gets a neutral gray. Subsequent layers cycle
 * through a fixed palette of distinguishable hues.
 */

// Deeper-Morandi palette — same family as the original soft palette but
// pushed up in saturation so the chips read clearly at small sizes. Hues
// chosen for maximum mutual contrast: blue / green / terracotta / violet /
// coral / teal / amber / plum.
const DEFAULT_LAYER_COLOR = "#7a766f"; // warm stone — anchors the palette

const LAYER_PALETTE = [
  "#4a90c2", // blue
  "#5fa873", // green
  "#c97757", // terracotta
  "#9b7bb0", // violet
  "#d9777a", // coral
  "#52a9a3", // teal
  "#c4a162", // amber
  "#8a5e9c", // plum
] as const;

/**
 * Return the accent color for the layer at the given index in `layers[]`.
 * Index 0 → neutral gray (default layer). Index 1..N → palette[i-1 mod len].
 */
export function layerAccentColor(layerIndex: number): string {
  if (layerIndex <= 0) return DEFAULT_LAYER_COLOR;
  return LAYER_PALETTE[(layerIndex - 1) % LAYER_PALETTE.length];
}

export { DEFAULT_LAYER_COLOR, LAYER_PALETTE };
