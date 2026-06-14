# Selection Context Menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Right-click on canvas with a selection opens a context menu offering mirror, move-to-layer (new/existing), copy, duplicate-as-floating, and replace-color-in-selection actions; the replace dialog picks colors from the selection's own palette.

**Architecture:** Five new pure store actions in `src/store/editorStore.ts` (TDD via Playwright store-level tests). Two new React components (`SelectionContextMenu`, `ReplaceColorInSelectionDialog`) under `src/components/Canvas/`. `PixelCanvas.tsx` is the integration point: its existing `onContextMenu` opens the menu and mounts both new components. Cross-layer move actions clear undo/redo stacks (sympathetic to existing `setActiveLayer`/`removeLayer` behavior).

**Tech Stack:** TypeScript, React, Zustand, Tailwind CSS, Playwright.

**Spec:** [docs/superpowers/specs/2026-05-29-selection-context-menu-design.md](../specs/2026-05-29-selection-context-menu-design.md)

---

## File Structure

**New files:**
- `src/components/Canvas/SelectionContextMenu.tsx` — viewport-clamped menu with hover-open sub-menus.
- `src/components/Canvas/ReplaceColorInSelectionDialog.tsx` — from/to color picker scoped to selection colors.
- `platforms/vscode/tests/selection-actions.spec.ts` — 7 Playwright tests (5 store + 2 UI).

**Modified files:**
- `src/store/editorStore.ts` — declare + implement 5 new actions in the `EditorState` interface and the store body.
- `src/components/Canvas/PixelCanvas.tsx` — `onContextMenu` opens the menu; render menu + replace dialog conditionally.
- `platforms/vscode/CHANGELOG.md` — 0.9.6 entry.
- `platforms/vscode/package.json` — bump to 0.9.6.

---

## Task 1: Create feature branch and write all failing tests

**Files:**
- Create: `platforms/vscode/tests/selection-actions.spec.ts`

- [ ] **Step 1: Create the feature branch (from main)**

```bash
cd q:/repo/pindou
git checkout main
git checkout -b feature/selection-context-menu
```

- [ ] **Step 2: Create the test file with 7 failing tests**

This single test file exercises every new store action (which doesn't exist yet) and the two UI smoke checks. They will all fail until later tasks implement the underlying behavior.

```typescript
import { test, expect } from "@playwright/test";
import {
  setupPage,
  loadProject,
  cleanupHarness,
  callAction,
  setStoreState,
  getStoreState,
} from "./helpers";

/**
 * Seed a 4×4 canvas with a known pattern and a 3×3 selection at (1,1)..(3,3).
 * Returns the layer id of the seeded active layer.
 */
async function seedSelection(page: import("@playwright/test").Page): Promise<string> {
  await callAction(page, "newCanvas", [4, 4]);
  // Paint a recognizable pattern on the active layer:
  //   (0,0)=A=1, (1,1)=B=2, (1,2)=B=2, (2,1)=C=3, (2,2)=A=1, (3,3)=A=1
  // and several cells outside the selection so we can verify isolation.
  await callAction(page, "setCell", [0, 0, 1]);
  await callAction(page, "setCell", [1, 1, 2]);
  await callAction(page, "setCell", [1, 2, 2]);
  await callAction(page, "setCell", [2, 1, 3]);
  await callAction(page, "setCell", [2, 2, 1]);
  await callAction(page, "setCell", [3, 3, 1]);

  // Selection covers (1,1)..(3,3) inclusive (a 3×3 box).
  const sel = new Set<string>();
  for (let r = 1; r <= 3; r++) for (let c = 1; c <= 3; c++) sel.add(`${r},${c}`);
  await setStoreState(page, {
    selection: sel,
    selectionBounds: { r1: 1, c1: 1, r2: 3, c2: 3 },
  });

  const layers = await getStoreState<any[]>(page, "layers");
  return layers[0].id;
}

async function cellColor(page: import("@playwright/test").Page, layerIdx: number, r: number, c: number): Promise<number | null> {
  return page.evaluate(
    ({ layerIdx, r, c }) => {
      const store = (window as any).__pindouStore;
      const layer = store.getState().layers[layerIdx];
      return layer.data[r][c].colorIndex;
    },
    { layerIdx, r, c }
  );
}

test.describe("Selection actions — store", () => {
  test.afterAll(() => cleanupHarness());

  test("mirrorSelection horizontal flips columns within bounds", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await seedSelection(page);

    await callAction(page, "mirrorSelection", ["horizontal"]);

    // Pattern at (r=1..3, c=1..3) before mirror:
    //   row 1: c1=null c2=2 c3=2  → after horizontal flip: c1=2 c2=2 c3=null
    //   row 2: c1=3 c2=1 c3=null → c1=null c2=1 c3=3
    //   row 3: c1=null c2=null c3=1 → c1=1 c2=null c3=null
    expect(await cellColor(page, 0, 1, 1)).toBe(2);
    expect(await cellColor(page, 0, 1, 2)).toBe(2);
    expect(await cellColor(page, 0, 1, 3)).toBe(null);
    expect(await cellColor(page, 0, 2, 1)).toBe(null);
    expect(await cellColor(page, 0, 2, 2)).toBe(1);
    expect(await cellColor(page, 0, 2, 3)).toBe(3);
    expect(await cellColor(page, 0, 3, 1)).toBe(1);
    expect(await cellColor(page, 0, 3, 2)).toBe(null);
    expect(await cellColor(page, 0, 3, 3)).toBe(null);
    // Cell OUTSIDE the selection must be unchanged.
    expect(await cellColor(page, 0, 0, 0)).toBe(1);
  });

  test("mirrorSelection vertical flips rows within bounds", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await seedSelection(page);

    await callAction(page, "mirrorSelection", ["vertical"]);

    // After vertical flip rows 1↔3 swap (row 2 stays):
    //   row 1 ← row 3: c1=null c2=null c3=1
    //   row 3 ← row 1: c1=null c2=2 c3=2
    expect(await cellColor(page, 0, 1, 1)).toBe(null);
    expect(await cellColor(page, 0, 1, 3)).toBe(1);
    expect(await cellColor(page, 0, 3, 2)).toBe(2);
    expect(await cellColor(page, 0, 3, 3)).toBe(2);
    expect(await cellColor(page, 0, 2, 1)).toBe(3); // row 2 untouched
    // Cell OUTSIDE the selection must be unchanged.
    expect(await cellColor(page, 0, 0, 0)).toBe(1);
  });

  test("duplicateSelectionAsFloating leaves original cells and creates floating", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await seedSelection(page);

    await callAction(page, "duplicateSelectionAsFloating");

    // Originals MUST still be there
    expect(await cellColor(page, 0, 1, 1)).toBe(2);
    expect(await cellColor(page, 0, 2, 2)).toBe(1);
    // selection cleared
    expect(await getStoreState(page, "selection")).toBe(null);
    // floatingSelection populated at the original offset
    const floating = await getStoreState<any>(page, "floatingSelection");
    expect(floating).toBeTruthy();
    expect(floating.offsetRow).toBe(1);
    expect(floating.offsetCol).toBe(1);
    // The floating cells map keys are LOCAL (r-r1,c-c1)
    expect(Object.keys(Object.fromEntries(new Map(floating.cells))).length).toBeGreaterThan(0);
  });

  test("replaceColorInSelection only changes in-selection cells", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await seedSelection(page);
    // Paint color 1 BOTH inside and outside the selection.
    await callAction(page, "setCell", [0, 0, 1]); // outside
    await callAction(page, "setCell", [2, 2, 1]); // inside
    await callAction(page, "setCell", [3, 3, 1]); // inside

    await callAction(page, "replaceColorInSelection", [1, 7]);

    expect(await cellColor(page, 0, 0, 0)).toBe(1); // outside stays color 1
    expect(await cellColor(page, 0, 2, 2)).toBe(7); // inside swapped to 7
    expect(await cellColor(page, 0, 3, 3)).toBe(7); // inside swapped to 7
    // Different color inside (color 2 at (1,1)) untouched
    expect(await cellColor(page, 0, 1, 1)).toBe(2);
  });

  test("moveSelectionToNewLayer creates new layer, transfers cells, clears source", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await seedSelection(page);
    const sourceLayerId = (await getStoreState<any[]>(page, "layers"))[0].id;

    await callAction(page, "moveSelectionToNewLayer");

    const layers = await getStoreState<any[]>(page, "layers");
    expect(layers.length).toBe(2);
    // New layer is at the END (top of z-order) and is now active.
    const activeId = await getStoreState<string>(page, "activeLayerId");
    expect(activeId).toBe(layers[1].id);
    expect(activeId).not.toBe(sourceLayerId);

    // Cells transferred to new layer at SAME positions
    expect(await cellColor(page, 1, 1, 1)).toBe(2);
    expect(await cellColor(page, 1, 2, 1)).toBe(3);
    expect(await cellColor(page, 1, 3, 3)).toBe(1);
    // Source layer's selected positions cleared
    expect(await cellColor(page, 0, 1, 1)).toBe(null);
    expect(await cellColor(page, 0, 2, 1)).toBe(null);
    expect(await cellColor(page, 0, 3, 3)).toBe(null);
    // Source layer cell OUTSIDE selection still intact
    expect(await cellColor(page, 0, 0, 0)).toBe(1);
    // Undo stack cleared (cross-layer op)
    expect(await getStoreState<any[]>(page, "undoStack")).toEqual([]);
  });

  test("moveSelectionToLayer transfers cells to existing target layer", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    const sourceLayerId = await seedSelection(page);
    await callAction(page, "addLayer", ["目标层"]);
    const layers = await getStoreState<any[]>(page, "layers");
    const targetLayerId = layers[1].id;
    // Re-set active to source so the move's source is the seeded layer.
    await callAction(page, "setActiveLayer", [sourceLayerId]);
    // setActiveLayer cleared selection — re-seed selection bounds.
    const sel = new Set<string>();
    for (let r = 1; r <= 3; r++) for (let c = 1; c <= 3; c++) sel.add(`${r},${c}`);
    await setStoreState(page, {
      selection: sel,
      selectionBounds: { r1: 1, c1: 1, r2: 3, c2: 3 },
    });

    await callAction(page, "moveSelectionToLayer", [targetLayerId]);

    const after = await getStoreState<any[]>(page, "layers");
    expect(after.length).toBe(2); // same count
    expect(await getStoreState<string>(page, "activeLayerId")).toBe(targetLayerId);
    // Target layer (idx 1) now holds the moved cells
    expect(await cellColor(page, 1, 1, 1)).toBe(2);
    expect(await cellColor(page, 1, 3, 3)).toBe(1);
    // Source (idx 0) cleared at selection positions
    expect(await cellColor(page, 0, 1, 1)).toBe(null);
    expect(await cellColor(page, 0, 3, 3)).toBe(null);
    // Source outside selection intact
    expect(await cellColor(page, 0, 0, 0)).toBe(1);
  });
});

test.describe("Selection actions — UI", () => {
  test.afterAll(() => cleanupHarness());

  test("right-click on canvas with selection opens menu", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await seedSelection(page);

    // Find the canvas container; the rightmost canvas in the editor area.
    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas not visible");

    await page.mouse.click(box.x + 20, box.y + 20, { button: "right" });

    // Menu should be visible — assert via a unique menu item label.
    await expect(page.getByRole("menuitem", { name: /^镜像$/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /^移到新图层$/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /^原地复制并拖动$/ })).toBeVisible();
  });

  test("right-click on canvas with NO selection does not open menu", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    // Ensure no selection.
    await setStoreState(page, { selection: null, selectionBounds: null });

    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas not visible");

    await page.mouse.click(box.x + 20, box.y + 20, { button: "right" });

    // Menu must NOT appear.
    await expect(page.getByRole("menuitem", { name: /^镜像$/ })).toHaveCount(0);
  });
});
```

- [ ] **Step 3: Run the tests and watch all 7 fail**

```bash
cd platforms/vscode && npm run build:webview 2>&1 | tail -3
cd platforms/vscode && npx playwright test tests/selection-actions.spec.ts 2>&1 | tail -15
```

Expected: build clean; tests fail (`No store action: mirrorSelection`, etc., and the UI tests time out looking for menu items). This proves the tests are real.

- [ ] **Step 4: Commit the failing tests**

```bash
git add platforms/vscode/tests/selection-actions.spec.ts
git commit -m "test: failing Playwright tests for selection context-menu actions

Cover the 5 new store actions (mirrorSelection h/v,
duplicateSelectionAsFloating, replaceColorInSelection,
moveSelectionToNewLayer, moveSelectionToLayer) plus 2 UI smoke
checks (right-click opens/does-not-open menu)."
```

---

## Task 2: Implement the 5 new store actions

**Files:**
- Modify: `src/store/editorStore.ts` — interface declarations near the existing selection-action group; implementations in the store body.

- [ ] **Step 1: Add the 5 method signatures to the `EditorState` interface**

Locate the existing selection method block in the interface (around lines 138-148). Add the 5 new signatures at the end of that group:

```typescript
  // (existing) setSelection, clearSelection, copySelection, cutSelection,
  // pasteClipboard, deleteSelection, commitFloatingSelection,
  // liftSelectionToFloat, setFloatingSelectionOffset, moveSelectionCells

  /** Flip selected cells in place within the selection bounds. */
  mirrorSelection: (direction: "horizontal" | "vertical") => void;
  /** Make a draggable floating duplicate without clearing the original cells. */
  duplicateSelectionAsFloating: () => void;
  /** Within selection, swap every cell of `fromIndex` to `toIndex`. */
  replaceColorInSelection: (fromIndex: number, toIndex: number) => void;
  /** Cut selected cells from active layer onto a NEW layer at the same positions. */
  moveSelectionToNewLayer: () => void;
  /** Cut selected cells from active layer onto an existing layer at the same positions. */
  moveSelectionToLayer: (targetLayerId: string) => void;
```

- [ ] **Step 2: Implement `mirrorSelection`**

In the store body, near the existing `liftSelectionToFloat` implementation, add:

```typescript
  mirrorSelection: (direction) => {
    const state = get();
    if (!state.selection || !state.selectionBounds) return;
    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layerData = state.layers[layerIdx].data;
    const { r1, c1, r2, c2 } = state.selectionBounds;

    // Snapshot the selection's cells by position so we can write the mirrored
    // values in a single pass without source/destination interference.
    const snapshot = new Map<string, number | null>();
    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      snapshot.set(key, layerData[r]?.[c]?.colorIndex ?? null);
    }

    const entries: { row: number; col: number; colorIndex: number | null }[] = [];
    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      const srcR = direction === "vertical" ? r2 - (r - r1) : r;
      const srcC = direction === "horizontal" ? c2 - (c - c1) : c;
      const srcVal = snapshot.get(`${srcR},${srcC}`);
      entries.push({ row: r, col: c, colorIndex: srcVal ?? null });
    }
    if (entries.length > 0) get().batchSetCells(entries);
  },
```

- [ ] **Step 3: Implement `duplicateSelectionAsFloating`**

```typescript
  duplicateSelectionAsFloating: () => {
    const state = get();
    if (!state.selection || !state.selectionBounds) return;
    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layerData = state.layers[layerIdx].data;
    const { r1, c1 } = state.selectionBounds;
    const floatingCells = new Map<string, CanvasCell>();
    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      const cell = layerData[r]?.[c];
      if (cell && cell.colorIndex !== null) {
        floatingCells.set(`${r - r1},${c - c1}`, { ...cell });
      }
    }
    if (floatingCells.size === 0) return;
    set({
      floatingSelection: { cells: floatingCells, offsetRow: r1, offsetCol: c1 },
      selection: null,
      selectionBounds: null,
    });
  },
```

(Note: structurally identical to `liftSelectionToFloat` but without the `batchSetCells(clearEntries)` call. If you prefer, you can extract a shared helper, but keep this commit focused — duplication is fine here.)

- [ ] **Step 4: Implement `replaceColorInSelection`**

```typescript
  replaceColorInSelection: (fromIndex, toIndex) => {
    const state = get();
    if (fromIndex === toIndex) return;
    if (!state.selection) return;
    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layerData = state.layers[layerIdx].data;
    const entries: { row: number; col: number; colorIndex: number | null }[] = [];
    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      if (layerData[r]?.[c]?.colorIndex === fromIndex) {
        entries.push({ row: r, col: c, colorIndex: toIndex });
      }
    }
    if (entries.length > 0) get().batchSetCells(entries);
  },
```

- [ ] **Step 5: Implement `moveSelectionToNewLayer`**

This is the more involved one. It mutates two layers atomically, creates a new layer, and clears history. Reuse `nextLayerId`/`createDefaultLayer` from the file:

```typescript
  moveSelectionToNewLayer: () => {
    const state = get();
    if (!state.selection || !state.selectionBounds) return;
    const sourceIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (sourceIdx === -1) return;
    const sourceLayer = state.layers[sourceIdx];

    // Build the new layer's data starting from an empty canvas, with cells
    // from the source written at the same positions.
    const { width, height } = state.canvasSize;
    const newLayer = createDefaultLayer(width, height, `图层 ${state.layers.length + 1}`);
    const newLayerData = newLayer.data.map((row) => row.map((c) => ({ ...c })));
    const clearedSourceData = sourceLayer.data.map((row) => row.map((c) => ({ ...c })));

    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      const srcCell = sourceLayer.data[r]?.[c];
      if (srcCell && srcCell.colorIndex !== null) {
        newLayerData[r][c] = { ...srcCell };
        clearedSourceData[r][c] = { colorIndex: null };
      }
    }

    const newLayers = [...state.layers];
    newLayers[sourceIdx] = { ...sourceLayer, data: clearedSourceData };
    newLayers.push({ ...newLayer, data: newLayerData });

    set({
      layers: newLayers,
      activeLayerId: newLayer.id,
      canvasData: mergeLayers(newLayers, width, height),
      undoStack: [],
      redoStack: [],
      isDirty: true,
    });
  },
```

- [ ] **Step 6: Implement `moveSelectionToLayer`**

```typescript
  moveSelectionToLayer: (targetLayerId) => {
    const state = get();
    if (!state.selection || !state.selectionBounds) return;
    if (targetLayerId === state.activeLayerId) return;
    const sourceIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    const targetIdx = state.layers.findIndex((l) => l.id === targetLayerId);
    if (sourceIdx === -1 || targetIdx === -1) return;

    const sourceLayer = state.layers[sourceIdx];
    const targetLayer = state.layers[targetIdx];
    const newSourceData = sourceLayer.data.map((row) => row.map((c) => ({ ...c })));
    const newTargetData = targetLayer.data.map((row) => row.map((c) => ({ ...c })));

    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      const srcCell = sourceLayer.data[r]?.[c];
      if (srcCell && srcCell.colorIndex !== null) {
        newTargetData[r][c] = { ...srcCell };
        newSourceData[r][c] = { colorIndex: null };
      }
    }

    const newLayers = [...state.layers];
    newLayers[sourceIdx] = { ...sourceLayer, data: newSourceData };
    newLayers[targetIdx] = { ...targetLayer, data: newTargetData };

    const { width, height } = state.canvasSize;
    set({
      layers: newLayers,
      activeLayerId: targetLayerId,
      canvasData: mergeLayers(newLayers, width, height),
      undoStack: [],
      redoStack: [],
      isDirty: true,
    });
  },
```

- [ ] **Step 7: Build the webview**

```bash
cd platforms/vscode && npm run build:webview 2>&1 | tail -5
```
Expected: clean build, no TypeScript errors.

- [ ] **Step 8: Run the store-action tests and confirm 6 pass; UI tests still fail**

```bash
cd platforms/vscode && npx playwright test tests/selection-actions.spec.ts 2>&1 | tail -15
```
Expected: the 6 store tests (mirror h, mirror v, duplicate, replace, moveToNewLayer, moveToLayer) PASS. The 2 UI tests still fail (no menu yet).

- [ ] **Step 9: Run the full suite to confirm no regressions in existing 61 tests**

```bash
cd platforms/vscode && npx playwright test 2>&1 | tail -5
```
Expected: 67 passed (61 existing + 6 new store tests). The 2 UI tests remain failing — actually they should still appear in the total because they ARE the failing ones. Re-check: if total is `65 passed, 2 failed`, that's the expected state.

If you see different numbers, stop and report.

- [ ] **Step 10: Commit the 5 store actions**

```bash
git add src/store/editorStore.ts
git commit -m "feat(store): selection actions — mirror, move-to-layer, duplicate, replace-color

Five new actions on selection:
- mirrorSelection(h|v): flips cell values in place within selection bounds
- duplicateSelectionAsFloating: like liftSelectionToFloat but keeps originals
- replaceColorInSelection(from, to): scoped swap within selection
- moveSelectionToNewLayer: atomically cuts cells onto a new top layer
- moveSelectionToLayer(targetId): atomically cuts cells onto an existing layer

Both move-to-layer actions clear undo/redo (same pattern as setActiveLayer/
removeLayer — existing convention for layer-list changes)."
```

---

## Task 3: Build the SelectionContextMenu component

**Files:**
- Create: `src/components/Canvas/SelectionContextMenu.tsx`

- [ ] **Step 1: Create the component file**

```typescript
import { useEffect, useRef, useState } from "react";
import type { BeadLayer } from "../../types";

interface Props {
  x: number;
  y: number;
  layers: BeadLayer[];
  activeLayerId: string;
  onMirror: (direction: "horizontal" | "vertical") => void;
  onMoveToNewLayer: () => void;
  onMoveToLayer: (targetLayerId: string) => void;
  onCopy: () => void;
  onDuplicateDraggable: () => void;
  onReplaceColor: () => void;
  onClose: () => void;
}

const MENU_WIDTH = 180;
const SUBMENU_WIDTH = 160;
const ITEM_HEIGHT = 28;

export function SelectionContextMenu({
  x,
  y,
  layers,
  activeLayerId,
  onMirror,
  onMoveToNewLayer,
  onMoveToLayer,
  onCopy,
  onDuplicateDraggable,
  onReplaceColor,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [openSubmenu, setOpenSubmenu] = useState<"mirror" | "moveToLayer" | null>(null);

  // Clamp to viewport
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = Math.min(x, vw - MENU_WIDTH - 8);
  const top = Math.min(y, vh - 240); // 240 ≈ approximate menu height with sections

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const otherLayers = layers.filter((l) => l.id !== activeLayerId);

  const Item = ({
    label,
    onClick,
    disabled,
    hasSubmenu,
  }: {
    label: string;
    onClick?: () => void;
    disabled?: boolean;
    hasSubmenu?: boolean;
  }) => (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        if (onClick) {
          onClick();
          onClose();
        }
      }}
      className={`w-full px-3 py-1 text-left text-xs flex items-center justify-between ${
        disabled ? "text-gray-300 cursor-not-allowed" : "hover:bg-blue-50 text-gray-700"
      }`}
      style={{ height: ITEM_HEIGHT }}
    >
      <span>{label}</span>
      {hasSubmenu && <span className="text-gray-400">▸</span>}
    </button>
  );

  const Divider = () => <div className="my-1 border-t border-gray-200" />;

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed bg-white border border-gray-300 rounded shadow-lg z-50 py-1"
      style={{ left, top, width: MENU_WIDTH }}
    >
      <div
        className="relative"
        onMouseEnter={() => setOpenSubmenu("mirror")}
        onMouseLeave={() => setOpenSubmenu(null)}
      >
        <Item label="镜像" hasSubmenu />
        {openSubmenu === "mirror" && (
          <div
            role="menu"
            className="absolute bg-white border border-gray-300 rounded shadow-lg py-1"
            style={{ left: MENU_WIDTH - 4, top: 0, width: SUBMENU_WIDTH }}
          >
            <Item label="水平翻转" onClick={() => onMirror("horizontal")} />
            <Item label="垂直翻转" onClick={() => onMirror("vertical")} />
          </div>
        )}
      </div>

      <Divider />

      <Item label="移到新图层" onClick={onMoveToNewLayer} />

      <div
        className="relative"
        onMouseEnter={() => setOpenSubmenu("moveToLayer")}
        onMouseLeave={() => setOpenSubmenu(null)}
      >
        <Item label="移到图层" hasSubmenu disabled={otherLayers.length === 0} />
        {openSubmenu === "moveToLayer" && otherLayers.length > 0 && (
          <div
            role="menu"
            className="absolute bg-white border border-gray-300 rounded shadow-lg py-1 max-h-60 overflow-y-auto"
            style={{ left: MENU_WIDTH - 4, top: 0, width: SUBMENU_WIDTH }}
          >
            {otherLayers.map((l) => (
              <Item key={l.id} label={l.name} onClick={() => onMoveToLayer(l.id)} />
            ))}
          </div>
        )}
      </div>

      <Divider />

      <Item label="复制" onClick={onCopy} />
      <Item label="原地复制并拖动" onClick={onDuplicateDraggable} />

      <Divider />

      <Item label="替换颜色..." onClick={onReplaceColor} />
    </div>
  );
}
```

- [ ] **Step 2: Do NOT commit yet** (component lands together with PixelCanvas wiring in Task 5)

---

## Task 4: Build the ReplaceColorInSelectionDialog component

**Files:**
- Create: `src/components/Canvas/ReplaceColorInSelectionDialog.tsx`

- [ ] **Step 1: Create the component file**

```typescript
import { useMemo, useState } from "react";
import { MARD_COLORS } from "../../data/mard221";
import { getEffectiveHex, type ColorOverrideMap } from "../../utils/colorHelper";

interface Props {
  /** Counts of each distinct colorIndex in the current selection. */
  selectionColorCounts: Map<number, number>;
  /** Currently active drawing color (for the "use current" affordance). */
  currentDrawingColorIndex: number | null;
  colorOverrides: ColorOverrideMap;
  onConfirm: (fromIndex: number, toIndex: number) => void;
  onClose: () => void;
}

function Swatch({
  index,
  selected,
  count,
  overrides,
  onClick,
}: {
  index: number;
  selected: boolean;
  count?: number;
  overrides: ColorOverrideMap;
  onClick: () => void;
}) {
  const hex = getEffectiveHex(index, overrides) || "#cccccc";
  const code = MARD_COLORS[index]?.code ?? "?";
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center px-1 py-1 rounded ${
        selected ? "ring-2 ring-blue-500" : "hover:bg-gray-100"
      }`}
      title={code}
    >
      <span
        className="block w-6 h-6 border border-gray-300"
        style={{ backgroundColor: hex }}
      />
      {count !== undefined && (
        <span className="text-[9px] text-gray-500 mt-0.5">×{count}</span>
      )}
    </button>
  );
}

export function ReplaceColorInSelectionDialog({
  selectionColorCounts,
  currentDrawingColorIndex,
  colorOverrides,
  onConfirm,
  onClose,
}: Props) {
  const colors = useMemo(
    () =>
      [...selectionColorCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([index, count]) => ({ index, count })),
    [selectionColorCounts]
  );
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);

  const canConfirm = from !== null && to !== null && from !== to;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[55]">
      <div className="bg-white rounded-lg shadow-xl w-[420px] max-w-[90vw]">
        <div className="px-4 py-3 border-b text-sm font-semibold">替换选区内颜色</div>
        <div className="p-4 flex flex-col gap-3">
          <div>
            <div className="text-xs text-gray-500 mb-1">从（选区内）</div>
            <div className="flex flex-wrap gap-1">
              {colors.map((c) => (
                <Swatch
                  key={`from-${c.index}`}
                  index={c.index}
                  selected={from === c.index}
                  count={c.count}
                  overrides={colorOverrides}
                  onClick={() => setFrom(c.index)}
                />
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">到</div>
            <div className="flex flex-wrap gap-1">
              {colors.map((c) => (
                <Swatch
                  key={`to-${c.index}`}
                  index={c.index}
                  selected={to === c.index}
                  overrides={colorOverrides}
                  onClick={() => setTo(c.index)}
                />
              ))}
              {currentDrawingColorIndex !== null && (
                <button
                  onClick={() => setTo(currentDrawingColorIndex)}
                  className={`flex flex-col items-center px-2 py-1 rounded border border-dashed ${
                    to === currentDrawingColorIndex
                      ? "ring-2 ring-blue-500 border-blue-500"
                      : "border-gray-300 hover:bg-gray-100"
                  }`}
                  title="使用当前画笔色"
                >
                  <span
                    className="block w-6 h-6 border border-gray-300"
                    style={{
                      backgroundColor:
                        getEffectiveHex(currentDrawingColorIndex, colorOverrides) || "#ccc",
                    }}
                  />
                  <span className="text-[9px] text-gray-500 mt-0.5">画笔色</span>
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="px-4 py-3 border-t flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1 rounded border text-sm hover:bg-gray-100"
          >
            取消
          </button>
          <button
            onClick={() => {
              if (canConfirm) {
                onConfirm(from!, to!);
                onClose();
              }
            }}
            disabled={!canConfirm}
            className={`px-3 py-1 rounded text-sm text-white ${
              canConfirm ? "bg-blue-500 hover:bg-blue-600" : "bg-blue-300 cursor-not-allowed"
            }`}
          >
            替换
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Do NOT commit yet** (lands with the canvas wiring in Task 5)

---

## Task 5: Wire menu + dialog into PixelCanvas, then commit everything together

**Files:**
- Modify: `src/components/Canvas/PixelCanvas.tsx` — imports, state, contextMenu handler, JSX.

- [ ] **Step 1: Add imports + state at the top of `PixelCanvas`**

Find the existing import block at the top and add:

```typescript
import { SelectionContextMenu } from "./SelectionContextMenu";
import { ReplaceColorInSelectionDialog } from "./ReplaceColorInSelectionDialog";
```

Inside the component body, near the existing `selection`/`selectionBounds` reads, add new store hooks and local state. Hooks (read both from store):

```typescript
  const layersForMenu = useEditorStore((s) => s.layers);
  const activeLayerIdForMenu = useEditorStore((s) => s.activeLayerId);
  const colorOverrides = useEditorStore((s) => s.colorOverrides);
  const selectedColorIndex = useEditorStore((s) => s.selectedColorIndex);
  const mirrorSelection = useEditorStore((s) => s.mirrorSelection);
  const moveSelectionToNewLayer = useEditorStore((s) => s.moveSelectionToNewLayer);
  const moveSelectionToLayer = useEditorStore((s) => s.moveSelectionToLayer);
  const copySelection = useEditorStore((s) => s.copySelection);
  const duplicateSelectionAsFloating = useEditorStore((s) => s.duplicateSelectionAsFloating);
  const replaceColorInSelection = useEditorStore((s) => s.replaceColorInSelection);
```

Some of these may already be in the file — use existing references if present; only add what's missing.

Local state for the menu and dialog:
```typescript
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
```

- [ ] **Step 2: Wire `onContextMenu`**

Find the existing line:
```typescript
        onContextMenu={(e) => e.preventDefault()}
```

Replace with:
```typescript
        onContextMenu={(e) => {
          e.preventDefault();
          if (selection && selection.size > 0 && !floatingSelectionState) {
            setContextMenu({ x: e.clientX, y: e.clientY });
          }
        }}
```

(`floatingSelectionState` is already in scope as a store-derived ref — verify by searching the file. If it's named differently, use the existing local variable.)

- [ ] **Step 3: Compute `selectionColorCounts` for the dialog**

Add this memoized derivation in the component body (near the other useMemos):

```typescript
  const selectionColorCounts = useMemo(() => {
    const counts = new Map<number, number>();
    if (!selection) return counts;
    const layerIdx = layersForMenu.findIndex((l) => l.id === activeLayerIdForMenu);
    if (layerIdx === -1) return counts;
    const data = layersForMenu[layerIdx].data;
    for (const key of selection) {
      const [r, c] = key.split(",").map(Number);
      const idx = data[r]?.[c]?.colorIndex;
      if (idx !== null && idx !== undefined) {
        counts.set(idx, (counts.get(idx) ?? 0) + 1);
      }
    }
    return counts;
  }, [selection, layersForMenu, activeLayerIdForMenu]);
```

- [ ] **Step 4: Mount the menu and the dialog in JSX**

At the end of the return statement (just before the closing `</div>` of the root), add:

```tsx
      {contextMenu && (
        <SelectionContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          layers={layersForMenu}
          activeLayerId={activeLayerIdForMenu}
          onMirror={(dir) => mirrorSelection(dir)}
          onMoveToNewLayer={() => moveSelectionToNewLayer()}
          onMoveToLayer={(id) => moveSelectionToLayer(id)}
          onCopy={() => copySelection()}
          onDuplicateDraggable={() => duplicateSelectionAsFloating()}
          onReplaceColor={() => setReplaceOpen(true)}
          onClose={() => setContextMenu(null)}
        />
      )}
      {replaceOpen && (
        <ReplaceColorInSelectionDialog
          selectionColorCounts={selectionColorCounts}
          currentDrawingColorIndex={selectedColorIndex}
          colorOverrides={colorOverrides}
          onConfirm={(from, to) => replaceColorInSelection(from, to)}
          onClose={() => setReplaceOpen(false)}
        />
      )}
```

- [ ] **Step 5: Build the webview**

```bash
cd platforms/vscode && npm run build:webview 2>&1 | tail -5
```
Expected: clean build.

- [ ] **Step 6: Run the full Playwright suite**

```bash
cd platforms/vscode && npx playwright test 2>&1 | tail -5
```
Expected: 69 passed (61 existing + 6 store + 2 UI = 69).

If any of the 2 UI tests fail, common causes:
- The menu's `role="menu"`/`role="menuitem"` isn't reachable by `getByRole`. Confirm both attributes are present.
- The right-click on `page.locator("canvas").first()` lands on the wrong canvas (there are several stacked canvases). If that's the case, target the container div instead of the canvas, or use `page.locator("canvas").last()`. Verify by checking which canvas receives `onContextMenu`.

- [ ] **Step 7: Commit components + wiring + bring the UI tests green**

```bash
git add src/components/Canvas/SelectionContextMenu.tsx \
        src/components/Canvas/ReplaceColorInSelectionDialog.tsx \
        src/components/Canvas/PixelCanvas.tsx
git commit -m "feat(canvas): right-click selection context menu + replace-color dialog

SelectionContextMenu opens on right-click when a non-floating selection
exists. Six actions: mirror (H/V submenu), move-to-new-layer,
move-to-layer (submenu), copy, duplicate-as-floating, replace-color.
ReplaceColorInSelectionDialog picks from/to from the selection's own
colors, with an option to target the current drawing color."
```

---

## Task 6: Version bump + changelog + package

**Files:**
- Modify: `platforms/vscode/package.json`
- Modify: `platforms/vscode/CHANGELOG.md`

- [ ] **Step 1: Bump version**

In `platforms/vscode/package.json`, change `"version": "0.9.5"` to `"version": "0.9.6"`.

- [ ] **Step 2: Prepend the 0.9.6 entry in the changelog**

In `platforms/vscode/CHANGELOG.md`, insert directly under `# Changelog`:

```markdown
## 0.9.6

- Feature: 选区右键菜单。当画布上存在选区时右键弹出菜单，提供 6 个动作：镜像（水平/垂直子菜单）、移到新图层、移到指定图层（子菜单列出其他图层）、复制、原地复制并拖动、替换选区内颜色（弹小对话框选 from/to，to 可以用当前画笔色）。
- Internal: 5 个新 store action（mirrorSelection / duplicateSelectionAsFloating / replaceColorInSelection / moveSelectionToNewLayer / moveSelectionToLayer）。跨图层移动遵循现有 setActiveLayer/removeLayer 的惯例 — 清空 undo/redo 栈。
```

- [ ] **Step 3: Package**

```bash
cd platforms/vscode && npm run package 2>&1 | tail -5
```
Expected: `Packaged: Q:\repo\pindou\platforms\vscode\pindouverse-0.9.6.vsix`.

- [ ] **Step 4: Commit**

```bash
git add platforms/vscode/package.json platforms/vscode/CHANGELOG.md
git commit -m "vscode: release 0.9.6 — selection right-click context menu"
```

---

## Task 7: Squash-merge to main + publish

**Files:** none (git + npm operations).

- [ ] **Step 1: Verify the four commits**

```bash
git log --oneline main..HEAD
```

Expected: four commits — failing tests, store actions, components+wiring, release.

- [ ] **Step 2: Switch to main, squash-merge, commit, delete branch**

```bash
git checkout main
git merge --squash feature/selection-context-menu
git commit -m "feat: selection right-click context menu (mirror / move-to-layer / duplicate / replace-color)

Adds a right-click context menu on canvas when a selection exists.
Six actions: mirror (horizontal/vertical sub-menu), move selection to a
new layer, move selection to an existing layer (sub-menu), copy,
duplicate-as-floating (drag without losing the original), replace a
color within the selection (small dialog scoped to the selection's
own palette, with an option to target the current drawing color).

Five new store actions wire each menu item. Cross-layer moves clear
undo/redo per existing convention.

Released as VS Code extension 0.9.6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git branch -D feature/selection-context-menu
```

- [ ] **Step 3: Publish 0.9.6 via Entra ID**

```bash
cd platforms/vscode && npm run publish:entra 2>&1 | tail -15
```
Expected: `Publishing: success`.

---

## Self-Review

**Spec coverage:**
- Spec §1 (context menu component) → Task 3.
- Spec §2 (canvas wiring via onContextMenu) → Task 5 Steps 2, 4.
- Spec §3 (five store actions w/ exact signatures) → Task 2 Steps 1-6.
- Spec §4 (ReplaceColorInSelectionDialog with from-side counts, to-side optional drawing-color affordance) → Task 4 Step 1.
- Spec §5 (history: cross-layer ops clear undo/redo) → Task 2 Steps 5, 6.
- Spec Testing (7 Playwright tests) → Task 1 Step 2, verified passing in Tasks 2 and 5.

**Placeholder scan:** no TBD / TODO. Every code block is final. Step 7 commands include exact `npm run` invocations.

**Type consistency:**
- `mirrorSelection(direction: "horizontal" | "vertical")` — same string-literal union in interface, implementation, test, menu wiring.
- `moveSelectionToLayer(targetLayerId: string)` — same name everywhere.
- `replaceColorInSelection(fromIndex, toIndex)` — same signature in interface, implementation, dialog onConfirm.
- `duplicateSelectionAsFloating(): void` — same.

**Risk areas:**
- The UI test in Task 1 right-clicks `page.locator("canvas").first()` — the canvas stack in PixelCanvas has multiple `<canvas>` elements (ref/pixel/selection). The contextmenu handler is attached to the container `<div>`, so the right-click on any child canvas should bubble. If the event doesn't bubble, the fallback in Task 5 Step 6 says to try targeting the container div instead. This is the most likely UI-test failure mode and is documented in-place.
- `floatingSelectionState` in Task 5 Step 2 — assumed already in scope. The plan instructs the engineer to verify and use the existing variable name if different.
- The `setStoreState` call in test setup passes a `Set` — the helper does `page.evaluate` so the value must be serializable. `Set` is serializable in Playwright's `evaluate` via structured clone, so this works. If issues arise, swap to passing an array and reconstruct the Set on the page side.
