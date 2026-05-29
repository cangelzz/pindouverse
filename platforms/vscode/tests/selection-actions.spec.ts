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
