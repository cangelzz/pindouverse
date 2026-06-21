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

    // Pattern at (r=1..3, c=1..3) before mirror (actual data):
    //   row 1: col1=2 col2=2 col3=null → after horizontal flip: col1=null col2=2 col3=2
    //   row 2: col1=3 col2=1 col3=null → col1=null col2=1 col3=3
    //   row 3: col1=null col2=null col3=1 → col1=1 col2=null col3=null
    expect(await cellColor(page, 0, 1, 1)).toBe(null);
    expect(await cellColor(page, 0, 1, 2)).toBe(2);
    expect(await cellColor(page, 0, 1, 3)).toBe(2);
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
    // Initial row 1: col1=2, col2=2, col3=null
    // Initial row 3: col1=null, col2=null, col3=1
    //   row 1 ← row 3: col1=null col2=null col3=1
    //   row 3 ← row 1: col1=2 col2=2 col3=null
    expect(await cellColor(page, 0, 1, 1)).toBe(null);
    expect(await cellColor(page, 0, 1, 3)).toBe(1);
    expect(await cellColor(page, 0, 3, 1)).toBe(2);
    expect(await cellColor(page, 0, 3, 2)).toBe(2);
    expect(await cellColor(page, 0, 3, 3)).toBe(null);
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
    // The floating cells Map must contain at least one entry — check in-browser.
    const floatingCellsSize = await page.evaluate(() => {
      const f = (window as any).__pindouStore.getState().floatingSelection;
      return f && f.cells instanceof Map ? f.cells.size : 0;
    });
    expect(floatingCellsSize).toBeGreaterThan(0);
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

  test("mirrorFloatingSelection flips floating cells in place, stays floating", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    await page.evaluate(() => {
      (window as any).__pindouStore.setState({
        floatingSelection: { cells: new Map([["0,0", { colorIndex: 1 }], ["0,1", { colorIndex: 2 }]]), offsetRow: 0, offsetCol: 0 },
      });
    });
    await callAction(page, "mirrorFloatingSelection", ["horizontal"]);
    const fs = await page.evaluate(() => {
      const f = (window as any).__pindouStore.getState().floatingSelection;
      return f ? Object.fromEntries([...f.cells.entries()].map(([k, v]: any) => [k, v.colorIndex])) : null;
    });
    expect(fs).toEqual({ "0,0": 2, "0,1": 1 }); // horizontal flip within cols [0..1]
  });

  test("mirrorFloatingSelection vertical flips rows within bbox", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    await page.evaluate(() => {
      (window as any).__pindouStore.setState({
        floatingSelection: { cells: new Map([["0,0", { colorIndex: 1 }], ["1,0", { colorIndex: 2 }]]), offsetRow: 0, offsetCol: 0 },
      });
    });
    await callAction(page, "mirrorFloatingSelection", ["vertical"]);
    const fs = await page.evaluate(() => {
      const f = (window as any).__pindouStore.getState().floatingSelection;
      return f ? Object.fromEntries([...f.cells.entries()].map(([k, v]: any) => [k, v.colorIndex])) : null;
    });
    expect(fs).toEqual({ "0,0": 2, "1,0": 1 }); // vertical flip within rows [0..1]
  });

  test("discardFloatingSelection drops the float without writing the layer", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    await page.evaluate(() => {
      (window as any).__pindouStore.setState({
        floatingSelection: { cells: new Map([["0,0", { colorIndex: 7 }]]), offsetRow: 0, offsetCol: 0 },
      });
    });
    await callAction(page, "discardFloatingSelection", []);
    const fs = await getStoreState(page, "floatingSelection");
    expect(fs).toBe(null);
    const v = await page.evaluate(() => (window as any).__pindouStore.getState().layers[0].data[0][0].colorIndex);
    expect(v).toBe(null); // nothing committed
  });

  test("commitFloatingSelection re-selects the dropped footprint", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    await page.evaluate(() => {
      (window as any).__pindouStore.setState({
        floatingSelection: { cells: new Map([["0,0", { colorIndex: 3 }], ["0,1", { colorIndex: 3 }]]), offsetRow: 1, offsetCol: 1 },
      });
    });
    await callAction(page, "commitFloatingSelection", []);
    expect(await getStoreState(page, "floatingSelection")).toBe(null);
    const v = await page.evaluate(() => (window as any).__pindouStore.getState().layers[0].data[1][1].colorIndex);
    expect(v).toBe(3);
    const sel = await page.evaluate(() => {
      const s = (window as any).__pindouStore.getState().selection;
      return s ? [...s].sort() : null;
    });
    expect(sel).toEqual(["1,1", "1,2"]); // footprint at offset (1,1): local (0,0)->(1,1), (0,1)->(1,2)
  });

  test("pasteClipboard over an existing float clears the stale footprint selection", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    // Force the internal-clipboard fallback (avoid real navigator.clipboard in headless),
    // seed a clipboard payload, an existing float, and a stale selection.
    await page.evaluate(() => {
      (navigator as any).clipboard = { readText: () => Promise.reject(new Error("no system clipboard")) };
      (window as any).__pindouStore.setState({
        clipboard: { cells: new Map([["0,0", { colorIndex: 5 }]]), width: 1, height: 1 },
        floatingSelection: { cells: new Map([["0,0", { colorIndex: 9 }]]), offsetRow: 0, offsetCol: 0 },
        selection: new Set(["3,3"]),
        selectionBounds: { r1: 3, c1: 3, r2: 3, c2: 3 },
      });
    });
    await callAction(page, "pasteClipboard", []);
    // a new float is installed, and no stale selection remains
    expect(await getStoreState(page, "floatingSelection")).not.toBe(null);
    expect(await getStoreState(page, "selection")).toBe(null);
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

  test("copySelectionAllVisibleLayers flattens visible layers into clipboard", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    await callAction(page, "batchSetCells", [[{ row: 0, col: 0, colorIndex: 8 }]]); // bottom layer has color 8
    await callAction(page, "addLayer", ["上层"]); // active(upper) layer is empty at (0,0)
    await setStoreState(page, { selection: new Set(["0,0"]), selectionBounds: { r1: 0, c1: 0, r2: 0, c2: 0 } });

    await callAction(page, "copySelectionAllVisibleLayers", []);
    const clip = await page.evaluate(() => {
      const cb = (window as any).__pindouStore.getState().clipboard;
      return cb ? Object.fromEntries([...cb.cells.entries()].map(([k, v]: any) => [k, v.colorIndex])) : null;
    });
    expect(clip).toEqual({ "0,0": 8 }); // grabbed from the lower visible layer
  });

  test("copySelectionAllVisibleLayers: top-most visible layer wins", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    await callAction(page, "batchSetCells", [[{ row: 0, col: 0, colorIndex: 8 }]]); // bottom
    await callAction(page, "addLayer", ["上层"]);
    await callAction(page, "batchSetCells", [[{ row: 0, col: 0, colorIndex: 3 }]]); // upper active, same cell
    await setStoreState(page, { selection: new Set(["0,0"]), selectionBounds: { r1: 0, c1: 0, r2: 0, c2: 0 } });

    await callAction(page, "copySelectionAllVisibleLayers", []);
    const clip = await page.evaluate(() => {
      const cb = (window as any).__pindouStore.getState().clipboard;
      return cb ? Object.fromEntries([...cb.cells.entries()].map(([k, v]: any) => [k, v.colorIndex])) : null;
    });
    expect(clip).toEqual({ "0,0": 3 }); // top-most visible wins
  });

  test("copySelectionAllVisibleLayers: hidden layer ignored; all-empty keeps clipboard", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    // middle layer has content but will be hidden; bottom + active upper are empty at (0,0)
    await callAction(page, "addLayer", ["中"]); // layer[1], active
    await callAction(page, "batchSetCells", [[{ row: 0, col: 0, colorIndex: 8 }]]);
    const midId = await page.evaluate(() => (window as any).__pindouStore.getState().layers[1].id);
    await callAction(page, "setLayerVisible", [midId, false]); // hide it
    await callAction(page, "addLayer", ["上"]); // layer[2], active, empty at (0,0)
    await setStoreState(page, {
      selection: new Set(["0,0"]),
      selectionBounds: { r1: 0, c1: 0, r2: 0, c2: 0 },
    });
    // Set sentinel clipboard via page.evaluate to avoid nested-Map serialization issues.
    await page.evaluate(() => {
      (window as any).__pindouStore.setState({
        clipboard: { cells: new Map([["9,9", { colorIndex: 99 }]]), width: 1, height: 1 },
      });
    });

    await callAction(page, "copySelectionAllVisibleLayers", []);
    // only the hidden layer had content → nothing copied → sentinel clipboard preserved
    const clip = await page.evaluate(() => {
      const cb = (window as any).__pindouStore.getState().clipboard;
      return cb ? Object.fromEntries([...cb.cells.entries()].map(([k, v]: any) => [k, v.colorIndex])) : null;
    });
    expect(clip).toEqual({ "9,9": 99 });
  });

  test("floating loop: duplicate → commit re-selects footprint → duplicate again keeps cycling", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    await callAction(page, "batchSetCells", [[{ row: 0, col: 0, colorIndex: 6 }]]);
    await setStoreState(page, { selection: new Set(["0,0"]), selectionBounds: { r1: 0, c1: 0, r2: 0, c2: 0 } });

    // duplicate → floating, selection cleared
    await callAction(page, "duplicateSelectionAsFloating", []);
    expect(await getStoreState(page, "floatingSelection")).not.toBe(null);
    expect(await getStoreState(page, "selection")).toBe(null);

    // commit → float lands, footprint re-selected
    await callAction(page, "commitFloatingSelection", []);
    expect(await getStoreState(page, "floatingSelection")).toBe(null);
    const sel = await page.evaluate(() => {
      const s = (window as any).__pindouStore.getState().selection;
      return s ? [...s].sort() : null;
    });
    expect(sel).toEqual(["0,0"]);

    // duplicate again works because we have a selection again
    await callAction(page, "duplicateSelectionAsFloating", []);
    expect(await getStoreState(page, "floatingSelection")).not.toBe(null);
    // original content remains on the layer
    const v = await page.evaluate(() => (window as any).__pindouStore.getState().layers[0].data[0][0].colorIndex);
    expect(v).toBe(6);
  });

  test("selectionOnlyOnOtherLayers: true when active empty but a visible layer has content", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    await callAction(page, "batchSetCells", [[{ row: 0, col: 0, colorIndex: 9 }]]); // bottom has content
    await callAction(page, "addLayer", ["上层"]); // active = empty upper
    await setStoreState(page, { selection: new Set(["0,0"]), selectionBounds: { r1: 0, c1: 0, r2: 0, c2: 0 } });
    expect(await callAction(page, "selectionOnlyOnOtherLayers", [])).toBe(true);

    // when the active layer itself has the content → false
    await callAction(page, "batchSetCells", [[{ row: 0, col: 0, colorIndex: 3 }]]);
    expect(await callAction(page, "selectionOnlyOnOtherLayers", [])).toBe(false);
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

  test("clicking 水平翻转 actually applies the mirror (regression: mousedown must not bubble to canvas)", async ({ page }) => {
    // Repro for bug "右键这几个菜单都点不了，点了没反映":
    // Without stopPropagation on the menu root, the menu button's mousedown
    // bubbles to the canvas container's handleMouseDown, which (when the
    // current tool is "select" and the click coordinate falls outside the
    // selection bounds) calls clearSelection() BEFORE the React onClick
    // handler runs. The action then sees selection==null and no-ops.
    await setupPage(page);
    await loadProject(page);
    await seedSelection(page);
    // Use the "select" tool — this is what triggers handleMouseDown's
    // clearSelection() path.
    await callAction(page, "setTool", ["select"]);

    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas not visible");

    // Open the menu near the canvas origin.
    await page.mouse.click(box.x + 20, box.y + 20, { button: "right" });
    await expect(page.getByRole("menuitem", { name: /^移到新图层$/ })).toBeVisible();

    // Click a TOP-LEVEL item that doesn't require a hover-opened submenu — if
    // the action runs, layer count goes 1 → 2 and the seeded cells transfer.
    const layersBefore = await getStoreState<any[]>(page, "layers");
    expect(layersBefore.length).toBe(1);

    await page.getByRole("menuitem", { name: /^移到新图层$/ }).click();

    const layersAfter = await getStoreState<any[]>(page, "layers");
    // BUG: if mousedown bubbles to canvas, currentTool==="select" clears the
    // selection before the React onClick fires; moveSelectionToNewLayer then
    // sees selection==null and no-ops, so layer count stays at 1.
    expect(layersAfter.length).toBe(2);
    // The new (top) layer must hold the moved cells.
    expect(await cellColor(page, 1, 1, 1)).toBe(2);
    expect(await cellColor(page, 1, 3, 3)).toBe(1);
    // Source layer cleared at the selection's positions.
    expect(await cellColor(page, 0, 1, 1)).toBe(null);
    expect(await cellColor(page, 0, 3, 3)).toBe(null);
  });

  test("SelectionActionsChip is visible when selection exists and opens the menu on click", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await seedSelection(page);

    // Chip should be visible with the discoverability label.
    const chip = page.getByRole("button", { name: /右键查看操作/ });
    await expect(chip).toBeVisible();

    // Clicking the chip opens the same context menu (assert via a menuitem).
    await chip.click();
    await expect(page.getByRole("menuitem", { name: /^镜像$/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /^移到新图层$/ })).toBeVisible();
  });

  test("floating region: right-click menu mirrors in place and stays floating", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [6, 6]);
    await callAction(page, "batchSetCells", [[{ row: 0, col: 0, colorIndex: 4 }, { row: 0, col: 1, colorIndex: 5 }]]);
    await setStoreState(page, { selection: new Set(["0,0", "0,1"]), selectionBounds: { r1: 0, c1: 0, r2: 0, c2: 1 } });
    await callAction(page, "duplicateSelectionAsFloating", []);
    expect(await getStoreState(page, "floatingSelection")).not.toBe(null);

    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas not visible");
    await page.mouse.click(box.x + 12, box.y + 12, { button: "right" });
    await page.getByRole("menuitem", { name: /^镜像$/ }).hover();
    await page.getByRole("menuitem", { name: "水平翻转" }).click();

    const fs = await page.evaluate(() => {
      const f = (window as any).__pindouStore.getState().floatingSelection;
      return f ? Object.fromEntries([...f.cells.entries()].map(([k, v]: any) => [k, v.colorIndex])) : null;
    });
    expect(fs).toEqual({ "0,0": 5, "0,1": 4 }); // flipped, still floating
  });

  test("SelectionActionsChip disappears when selection is cleared", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await seedSelection(page);
    await expect(page.getByRole("button", { name: /右键查看操作/ })).toBeVisible();

    await setStoreState(page, { selection: null, selectionBounds: null });

    await expect(page.getByRole("button", { name: /右键查看操作/ })).toHaveCount(0);
  });

  test("Replace-color dialog: add rule, pick from/to, execute replaces in-selection cells", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await seedSelection(page);

    // Open the menu via the chip (the chip click path doubles as a smoke test).
    await page.getByRole("button", { name: /右键查看操作/ }).click();
    await page.getByRole("menuitem", { name: /^替换颜色/ }).click();

    // Dialog open; empty-state placeholder shown.
    await expect(page.getByText("暂无替换规则。点下方「+ 添加替换规则」开始。")).toBeVisible();
    await expect(page.getByRole("button", { name: /执行替换/ })).toBeDisabled();

    // Add a rule — auto-opens the from-picker.
    await page.getByRole("button", { name: /^\+ 添加替换规则$/ }).click();

    // From-picker visible. Pick the first selection-color swatch.
    const fromPicker = page.locator('[data-testid="replace-from-picker"]');
    await expect(fromPicker).toBeVisible();
    await fromPicker.locator("button").first().click();

    // After picking from, the to-picker auto-opens with the full MARD palette.
    const toPicker = page.locator('[data-testid="replace-to-picker"]');
    await expect(toPicker).toBeVisible();
    await toPicker.locator("button").first().click();

    // Confirm enabled, then execute.
    await expect(page.getByRole("button", { name: /执行替换/ })).toBeEnabled();
    const beforeColor = await page.evaluate(() => {
      const store = (window as any).__pindouStore;
      return store.getState().layers[0].data[1][1].colorIndex;
    });
    await page.getByRole("button", { name: /执行替换/ }).click();
    const afterColor = await page.evaluate(() => {
      const store = (window as any).__pindouStore;
      return store.getState().layers[0].data[1][1].colorIndex;
    });
    // The selected from-color was the most-common one in the selection
    // (the seed has multiple cells of color 2). After replace, that color
    // in the selection should be gone, so cell (1,1) must change.
    expect(afterColor).not.toBe(beforeColor);
  });

  test("on-action guard: mirror on other-layer-only selection asks to confirm", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [6, 6]);
    await callAction(page, "batchSetCells", [[{ row: 0, col: 0, colorIndex: 9 }]]);
    await callAction(page, "addLayer", ["上层"]);
    await setStoreState(page, { selection: new Set(["0,0"]), selectionBounds: { r1: 0, c1: 0, r2: 0, c2: 0 } });

    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas not visible");
    await page.mouse.click(box.x + 8, box.y + 8, { button: "right" });
    await page.getByRole("menuitem", { name: /^镜像$/ }).hover();
    await page.getByRole("menuitem", { name: "水平翻转" }).click();

    const modal = page.locator("div.fixed.inset-0").filter({ hasText: "选区不在当前图层" }).last();
    await expect(modal).toBeVisible({ timeout: 3000 });
    await modal.getByRole("button", { name: /^取消$/ }).click();
  });
});

test.describe("Deselect", () => {
  test.afterAll(() => cleanupHarness());

  test("context menu has 取消选区 item that clears the selection", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await seedSelection(page);

    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas not visible");

    // Open the context menu over the canvas.
    await page.mouse.click(box.x + 20, box.y + 20, { button: "right" });
    const item = page.getByRole("menuitem", { name: /^取消选区$/ });
    await expect(item).toBeVisible();

    await item.click();

    // Selection cleared and the menu closed.
    expect(await getStoreState(page, "selection")).toBe(null);
    await expect(page.getByRole("menuitem", { name: /^取消选区$/ })).toHaveCount(0);
  });

  test("toolbar 取消选区 button appears only with a selection and clears it", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    const btn = page.getByRole("button", { name: "取消选区" });
    // No selection initially → no button.
    await expect(btn).toHaveCount(0);

    await seedSelection(page);
    await expect(btn).toBeVisible();

    await btn.click();
    expect(await getStoreState(page, "selection")).toBe(null);
    await expect(page.getByRole("button", { name: "取消选区" })).toHaveCount(0);
  });

  test("select tool: clicking the gray canvas margin clears a whole-canvas selection", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [8, 8]);
    await callAction(page, "setTool", ["select"]);
    await callAction(page, "selectAll");
    expect(await getStoreState(page, "selection")).not.toBe(null);

    // Shrink the grid so there is a wide gray margin to the right of it.
    await callAction(page, "setZoom", [0.2]);

    const container = page.locator("[data-canvas-container]");
    const box = await container.boundingBox();
    if (!box) throw new Error("container not visible");

    // Geometry from the store: the grid occupies container-local
    // [offsetX, offsetX + width*cellSize] horizontally.
    const geom = await page.evaluate(() => {
      const s = (window as any).__pindouStore.getState();
      return {
        offsetX: s.offsetX,
        cellSize: s.cellSize,
        w: s.canvasSize.width,
      };
    });
    const gridRight = geom.offsetX + geom.w * geom.cellSize;
    const marginX = box.x + gridRight + 10; // 10px past the grid's right edge
    const marginY = box.y + box.height / 2;
    // Sanity: the margin point must still be inside the container.
    expect(marginX).toBeLessThan(box.x + box.width - 1);

    await page.mouse.click(marginX, marginY, { button: "left" });

    expect(await getStoreState(page, "selection")).toBe(null);
  });
});
