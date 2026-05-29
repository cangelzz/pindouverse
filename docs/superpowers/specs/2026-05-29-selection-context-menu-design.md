# Selection Context Menu

**Date**: 2026-05-29
**Status**: Approved, ready for plan
**Scope**: Cross-platform editor store + canvas UI + new dialog

## Problem

Once a user has a rectangular selection on the canvas, the only existing actions are: copy / cut / paste / delete via keyboard or top toolbar. There are several common pixel-art workflows that have no first-class action:

- Mirror the selected region in place
- Move (cut) the selected pixels onto a different layer (existing or new) while keeping their position
- Duplicate the selected pixels and immediately drag the copy to a new spot (today requires copy → paste → drag, three steps)
- Replace one color with another only within the selection

These would all be easier if discoverable from a right-click context menu on the canvas while a selection is active.

## Goals

- A right-click context menu on the canvas that appears when a non-floating selection exists.
- The menu provides six actions: mirror (sub-menu H/V), move to new layer, move to existing layer (sub-menu), copy, duplicate-and-drag, replace color in selection.
- Replace-color picks the "from" color and the "to" color from a dialog scoped to the selection's own color set, with an option to use the active drawing color as "to".
- All new actions integrate with the existing undo/redo stack.

## Non-Goals

- Free-form (lasso / magic-wand) selections — rectangular selection only, same as today.
- A floating action bar / heads-up toolbar — context menu only.
- Cross-layer copy-with-position (covered by paste at original offset, not in scope here).
- Whole-canvas color replace — already exists as `replaceColor`, not changing.

## Design

### 1. SelectionContextMenu component

New file `src/components/Canvas/SelectionContextMenu.tsx`.

Props:
- `x: number`, `y: number` — viewport-coordinate anchor
- `onClose: () => void`
- All action handlers (mirror, moveToNewLayer, moveToLayer(id), copy, duplicateDraggable, openReplaceDialog)
- `layers: BeadLayer[]`, `activeLayerId: string` (for the sub-menu listing other layers)

Behavior:
- Renders absolute-positioned at `(x, y)`; clamps to viewport so it doesn't overflow on the right/bottom edges.
- Outside click, Escape key, or selecting an item → `onClose`.
- Sub-menus open on hover and on click; they render to the right of the parent item with the same clamping.
- Menu items:
  ```
  镜像          ▸  水平翻转
                   垂直翻转
  ─────────────────────────
  移到新图层
  移到图层      ▸  [list of layers excluding active]
  ─────────────────────────
  复制
  原地复制并拖动
  ─────────────────────────
  替换颜色...
  ```
- "移到图层" submenu is disabled (greyed and unclickable) if `layers.length <= 1`.

### 2. Canvas wiring

Modify `src/components/Canvas/PixelCanvas.tsx`:
- The existing `onContextMenu={(e) => e.preventDefault()}` becomes a handler that also reads `selection`; if a non-floating selection exists, it captures `e.clientX`, `e.clientY` and sets local state to open the menu. preventDefault still fires.
- Render `<SelectionContextMenu />` conditionally on local state. The dialog (replace color) is rendered as a sibling at the same level.

### 3. Store actions (new)

In `src/store/editorStore.ts`:

```typescript
mirrorSelection(direction: "horizontal" | "vertical"): void;
moveSelectionToNewLayer(): void;
moveSelectionToLayer(targetLayerId: string): void;
duplicateSelectionAsFloating(): void;
replaceColorInSelection(fromIndex: number, toIndex: number): void;
```

#### `mirrorSelection(direction)`
- Read active layer + `selection` + `selectionBounds`.
- Build a map of selection cells indexed by `(r, c)`.
- For each cell `(r, c)` in selection, compute mirrored position within bounds:
  - horizontal: `(r, c2 - (c - c1))`
  - vertical: `(r2 - (r - r1), c)`
- Produce a `batchSetCells` entries array: each ORIGINAL selected position gets the mirrored cell's value (or null if the mirrored position has no selected cell — but in a rectangular selection every position is selected, so this case is fully populated).
- One history entry.
- Selection itself stays put (the bounds don't change; the pixels flip).

#### `moveSelectionToNewLayer()`
- If selection empty or `floatingSelection` present, no-op (commit float first via existing patterns if needed).
- Capture cells from active layer at the selected positions.
- Atomically:
  1. Create a new `BeadLayer` (use `createDefaultLayer` + `nextLayerId`); name = `图层 ${layers.length + 1}` (matches existing addLayer naming).
  2. Write the captured cells onto the new layer's data at the SAME positions (not offset).
  3. Clear the same positions on the original active layer.
  4. Push a single combined entry to undoStack representing both writes? Or use two `batchSetCells` calls.
- After the move: set the new layer as `activeLayerId`. Selection stays valid (same bounds, now refers to the new layer's cells).
- `isDirty: true`, recompute `canvasData = mergeLayers(...)`.

**Implementation note:** the simplest correct way is to manually construct the new state in one `set({...})` call rather than chaining `addLayer` + `batchSetCells` + `batchSetCells` — chaining would produce 3 history entries and 3 re-renders. A dedicated atomic action also keeps undo behavior clean (one ctrl+z reverts the whole move).

#### `moveSelectionToLayer(targetLayerId)`
- Same as above but writes to an existing layer instead of creating one. `activeLayerId` switches to the target.
- If `targetLayerId === activeLayerId`, no-op.

#### `duplicateSelectionAsFloating()`
- Identical to `liftSelectionToFloat` except it does NOT clear the original cells.
- Produces a `floatingSelection` at the selection's current offset; user drags and commits (existing flow).
- No history entry yet — commit happens when the user drops, which is already handled by `commitFloatingSelection`.

#### `replaceColorInSelection(fromIndex, toIndex)`
- If `fromIndex === toIndex`, no-op.
- For each cell in `selection`, if its current `colorIndex === fromIndex`, push a `batchSetCells` entry setting it to `toIndex`.
- One history entry.

### 4. ReplaceColorInSelectionDialog component

New file `src/components/Canvas/ReplaceColorInSelectionDialog.tsx`.

Props:
- `selectionColorCounts: Map<number, number>` — distinct colorIndex → count within selection (controller computes from store).
- `currentDrawingColorIndex: number` — for the "use current drawing color" affordance.
- `colorOverrides`, etc. for swatch hex lookup (existing helpers).
- `onClose: () => void`
- `onConfirm: (from: number, to: number) => void`

Layout:
```
┌──── 替换选区内颜色 ──────────────────┐
│ 从：                                  │
│ [swatch] [swatch] [swatch] ...        │
│ (each shows count under swatch)       │
│                                       │
│ 到：                                  │
│ [swatch] [swatch] [swatch] ...        │
│ + [当前画笔色 <swatch>]               │
│                                       │
│           [取消]   [替换]             │
└───────────────────────────────────────┘
```

- Each swatch is clickable; the selected one in each row gets a blue border.
- Counts (e.g. `×42`) shown only under the 从 swatches — counts are meaningless for the destination side.
- The "use current drawing color" extra option lives in the 到 row only; clicking it sets `to = currentDrawingColorIndex`.
- 替换 is disabled until both from and to are picked.
- Dialog is built on the existing AppDialog primitive style (or just a fixed-position div like ExportDialog), no new primitive.

### 5. History behavior

All new store actions that mutate layer data use `batchSetCells` (existing primitive) so they integrate with the existing undo stack automatically.

`moveSelectionToNewLayer` and `moveSelectionToLayer` are special because they touch two layers and the existing `HistoryAction` shape (a flat array of single-layer cell changes) cannot describe a two-layer mutation. **Required approach:** these two actions clear the undo and redo stacks at the end of their `set({...})` call (same pattern as `setActiveLayer`, `removeLayer`, `loadCanvasData` — all of which reset history when the active layer or layer list changes). Users will need to re-do the move manually if they regret it; this is an acceptable trade-off and matches how layer-affecting operations already behave in this codebase.

## Testing

Playwright tests in `platforms/vscode/tests/selection-actions.spec.ts`:

1. **mirrorSelection horizontal** — set up a 4×4 region with a known pattern, call `mirrorSelection("horizontal")`, assert each cell is mirrored within bounds.
2. **mirrorSelection vertical** — analogous.
3. **moveSelectionToNewLayer** — assert layer count increases by 1, new layer holds the moved cells at the original positions, original layer's positions are cleared, `activeLayerId` is the new layer.
4. **moveSelectionToLayer** — pre-create a target layer, assert cells transferred to target, cleared from source, `activeLayerId` is target.
5. **duplicateSelectionAsFloating** — assert original cells unchanged, `floatingSelection` exists with the cells at the selection's offset.
6. **replaceColorInSelection** — set up cells of color A both inside and outside selection; call action; assert only in-selection cells flip to color B.

UI smoke tests:
7. **Right-click on canvas with selection opens menu** — verify menu items are present.
8. **Right-click on canvas with no selection does NOT open menu** — verify menu absent.

The existing 61 webview tests must continue to pass.

## Backwards compatibility

- New store fields: none.
- New adapter methods: none.
- Existing keyboard shortcuts (Ctrl+C / Ctrl+V / Ctrl+X / Delete) keep working; the context menu's 复制 entry is a parallel surface for the same action.

## Open questions

None — answered during brainstorming:
- Mirror direction: sub-menu with both H and V.
- Replace color UI: from-selection picker with optional "use current drawing color" for the "to" side.

## Out of scope

- Lasso/wand selection.
- Custom-named "move to new layer" naming dialog (auto-name like existing addLayer).
- Persisting the menu position across opens.
- Floating action bar near the selection bounds (alternative UI surface).
