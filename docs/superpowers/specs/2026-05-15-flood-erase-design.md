# Flood Erase (区域擦除) — Design

**Date:** 2026-05-15
**Status:** Approved

## Summary

Add a second eraser sub-mode that erases all connected cells of the same color (flood-fill semantics, but writing `null` instead of a color index). Expose it as a flyout under the existing eraser button in the canvas toolbar, mirroring how the shape tools flyout works.

## Motivation

Today the eraser only clears one cell at a time. Clearing a large solid region requires either repeated clicks/drags or `wand` + delete. The fill (paint bucket) tool already has flood-fill semantics for painting; the corresponding "flood erase" operation has no equivalent. Adding it fills a symmetric gap and avoids the wand workflow for the common case of "remove this whole blob."

## Scope

### In scope
- New `EditorTool` value `"eraserFill"`.
- Flyout UI under the eraser button containing two sub-modes: 单格擦除 and 区域擦除.
- Sticky last-used sub-mode: pressing `E` (or clicking the parent eraser button) selects whichever sub-mode was used last.
- Reuse fill's BFS algorithm; produce a single undo entry per flood erase.
- Playwright tests for the new tool.

### Out of scope
- A dedicated keyboard shortcut for `eraserFill`. `E` activates whichever sub-mode is sticky; no `Shift+E` or similar.
- Cursor or icon polish beyond a reasonable initial choice.
- Touch/gesture changes.
- Any change to the existing `fill` tool.

## Design

### Types

Extend the `EditorTool` union in [src/types/index.ts:12](../../../src/types/index.ts):

```ts
export type EditorTool = "pen" | "eraser" | "eraserFill" | "eyedropper" | "pan" | "fill" | "line" | "rect" | "circle" | "select" | "wand";
```

### Store

In [src/store/editorStore.ts](../../../src/store/editorStore.ts):

- Add state `lastEraserSubmode: "eraser" | "eraserFill"`, default `"eraser"`.
- In `setTool`, when the new tool is `"eraser"` or `"eraserFill"`, also update `lastEraserSubmode` to that value.

This lets the toolbar render the right icon on the parent button and lets the `E` keyboard shortcut pick the sticky sub-mode.

### Flood-fill algorithm extraction

The BFS in [src/components/Canvas/PixelCanvas.tsx:749-774](../../../src/components/Canvas/PixelCanvas.tsx) currently lives inline inside the `case "fill"` handler. Extract it into a small helper (kept local to `PixelCanvas.tsx`, or moved to a `utils/` file if a natural home exists):

```ts
function floodFillEntries(
  layerData: CanvasData,
  startRow: number,
  startCol: number,
  replaceWith: number | null,
  width: number,
  height: number,
): HistoryEntry[] {
  const target = layerData[startRow]?.[startCol]?.colorIndex ?? null;
  if (target === replaceWith) return [];
  const visited = new Set<string>();
  const queue: [number, number][] = [[startRow, startCol]];
  const entries: HistoryEntry[] = [];
  while (queue.length) {
    const [r, c] = queue.shift()!;
    if (r < 0 || r >= height || c < 0 || c >= width) continue;
    const key = `${r},${c}`;
    if (visited.has(key)) continue;
    const cellColor = layerData[r]?.[c]?.colorIndex ?? null;
    if (cellColor !== target) continue;
    visited.add(key);
    entries.push({ row: r, col: c, prevColorIndex: target, newColorIndex: replaceWith });
    queue.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
  }
  return entries;
}
```

Both the existing `case "fill"` and the new `case "eraserFill"` call this helper. `fill` passes `selectedColorIndex`; `eraserFill` passes `null`.

Note: the existing inline version does not record `prevColorIndex` in its entries; check the actual `HistoryEntry` push site and match its shape exactly. The contract for an undoable batch must be preserved.

### Pointer handler

In the `pointerDown` handler of [PixelCanvas.tsx](../../../src/components/Canvas/PixelCanvas.tsx) (around line 743):

```ts
case "eraserFill": {
  const state = useEditorStore.getState();
  const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
  if (layerIdx === -1) break;
  const layerData = state.layers[layerIdx].data;
  const entries = floodFillEntries(
    layerData, row, col, null,
    state.canvasSize.width, state.canvasSize.height,
  );
  if (entries.length > 0) {
    // apply entries + push to undo stack — match how fill does it
  }
  break;
}
```

Like `fill`, `eraserFill` commits in one shot on pointer down. It does NOT enter the `pen`/`eraser` stroke-batching path at [PixelCanvas.tsx:887](../../../src/components/Canvas/PixelCanvas.tsx#L887) — leave that condition unchanged.

### Cursor

Add `eraserFill` to the `crosshair` branch alongside `fill` at [PixelCanvas.tsx:1165](../../../src/components/Canvas/PixelCanvas.tsx#L1165).

### Keyboard

In the tool shortcut map at [PixelCanvas.tsx:1131-1135](../../../src/components/Canvas/PixelCanvas.tsx#L1131-L1135), keep the map intact but post-process: after the lookup, if the resolved tool is `"eraser"`, replace it with `useEditorStore.getState().lastEraserSubmode` before calling `setTool`. This keeps the existing map structure and behavior for every other key.

### Toolbar UI

Refactor [CanvasToolbar.tsx](../../../src/components/Canvas/CanvasToolbar.tsx):

- Define an `eraserTools` array similar to `shapeTools`:
  ```ts
  const eraserTools: { id: EditorTool; label: string; icon: string; shortcut: string }[] = [
    { id: "eraser",     label: "单格擦除", icon: "🩹", shortcut: "E" },
    { id: "eraserFill", label: "区域擦除", icon: "🧽", shortcut: "" },
  ];
  ```
  Final emoji for the second mode is open to revision during implementation, but should visually distinguish from the single-cell eraser.
- Remove the `eraser` entry from the existing `tools` array.
- Render the eraser group in the same slot the old `eraser` button occupied (between `fill` and `eyedropper`), as a flyout button mirroring the existing `shapeTools` block at [CanvasToolbar.tsx:48-77](../../../src/components/Canvas/CanvasToolbar.tsx#L48-L77):
  - The parent button shows the icon of `lastEraserSubmode` (or `currentTool` when it's an eraser tool).
  - Parent button is highlighted when `currentTool === "eraser" || currentTool === "eraserFill"`.
  - Clicking opens a flyout with both sub-modes.
- Insertion order in the rendered toolbar: `select`, `wand`, `pen`, `fill`, **`eraser-group`**, `eyedropper`, `pan`.

### History / undo

A flood erase pushes a single `HistoryAction` (array of `HistoryEntry`) — same shape as fill. One undo restores the entire region. The existing undo/redo machinery handles this without changes.

### Selection mask interaction (verify during implementation)

If `fill` respects an active selection mask (only fills inside the selection), `eraserFill` must respect it identically. Implementation step: read the fill handler carefully and replicate any masking; don't introduce a divergence between the two flood operations.

## Testing

Add to [platforms/vscode/tests/drawing.spec.ts](../../../platforms/vscode/tests/drawing.spec.ts):

1. **Flood erase clears connected region.** Paint a 3×3 block, set tool to `eraserFill`, simulate a click on a cell in the block (via store action that the test harness uses for fill), assert all 9 cells are now `null` and surrounding cells unchanged.
2. **Flood erase on empty cell is no-op.** Tool `eraserFill`, click an empty cell, assert no history entry pushed and canvas unchanged.
3. **Single undo restores the whole region.** After a flood erase, one `undo()` brings every erased cell back.
4. **Sticky sub-mode.** After `setTool("eraserFill")`, switching to another tool then calling `setTool` via the `E` shortcut path should return to `"eraserFill"`, not `"eraser"`. (If the existing test harness doesn't simulate keyboard, assert on `lastEraserSubmode` directly.)
5. **Toolbar button wiring.** Clicking the eraser flyout's 区域擦除 option sets `currentTool === "eraserFill"`. Mirrors the existing pattern at [drawing.spec.ts:165-171](../../../platforms/vscode/tests/drawing.spec.ts#L165-L171).

Run `npm run test:webview` from `platforms/vscode/` before publishing, per project rules in [CLAUDE.md](../../../CLAUDE.md).

## Risks / open questions

- **Icon choice** for 区域擦除 — 🧽 is the placeholder; the implementer may swap for something clearer. Not blocking.
- **Selection mask** — confirmed above as an implementation-time check, not a design unknown. If fill ignores the mask today, eraserFill should too (and that becomes a separate ticket if changed later).
- **VS Code extension test harness** — relies on `callAction` / `setTool` exposed via the store. Both already exist; no new harness wiring needed.
