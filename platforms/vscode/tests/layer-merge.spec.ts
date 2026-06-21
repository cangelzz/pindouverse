import { test, expect } from "@playwright/test";
import { setupPage, loadProject, cleanupHarness, callAction, getStoreState } from "./helpers";

test.describe("Layer merge down", () => {
  test.afterAll(() => cleanupHarness());

  async function twoLayers(page: import("@playwright/test").Page) {
    await callAction(page, "newCanvas", [4, 4]);
    await callAction(page, "batchSetCells", [[{ row: 0, col: 0, colorIndex: 1 }, { row: 2, col: 2, colorIndex: 4 }]]); // bottom layer[0]
    await callAction(page, "addLayer", ["上层"]); // layer[1], becomes active
    await callAction(page, "batchSetCells", [[{ row: 1, col: 1, colorIndex: 2 }, { row: 2, col: 2, colorIndex: 5 }]]);
  }
  const layerCount = (page: import("@playwright/test").Page) =>
    page.evaluate(() => (window as any).__pindouStore.getState().layers.length);
  const cell = (page: import("@playwright/test").Page, r: number, c: number, li: number) =>
    page.evaluate(({ r, c, li }) => (window as any).__pindouStore.getState().layers[li].data[r][c].colorIndex, { r, c, li });
  const activeId = (page: import("@playwright/test").Page) =>
    page.evaluate(() => (window as any).__pindouStore.getState().activeLayerId);

  test("merge down composites upper over lower, removes upper, undo/redo restores", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await twoLayers(page);
    const upperId = await activeId(page);
    const bottomId = await page.evaluate(() => (window as any).__pindouStore.getState().layers[0].id);

    await callAction(page, "mergeLayerDown", [upperId]);

    expect(await layerCount(page)).toBe(1);
    expect(await cell(page, 0, 0, 0)).toBe(1);
    expect(await cell(page, 1, 1, 0)).toBe(2);
    expect(await cell(page, 2, 2, 0)).toBe(5);              // overlap: upper wins
    const mergedId = await activeId(page);
    expect(mergedId).toBe(bottomId);                         // merged layer keeps lower's id
    expect(await page.evaluate(() => (window as any).__pindouStore.getState().layers[0].visible)).toBe(true); // merged is visible
    expect(await page.evaluate(() => (window as any).__pindouStore.getState().layers[0].opacity)).toBe(1); // opacity reset on merge
    expect(mergedId).not.toBe(upperId);

    await callAction(page, "undo", []);
    expect(await layerCount(page)).toBe(2);
    expect(await activeId(page)).toBe(upperId);
    expect(await cell(page, 1, 1, 1)).toBe(2);

    await callAction(page, "redo", []);
    expect(await layerCount(page)).toBe(1);
    expect(await cell(page, 1, 1, 0)).toBe(2);
  });

  test("merge down on bottom layer is a no-op", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await twoLayers(page);
    const bottomId = await getStoreState<any[]>(page, "layers").then((ls) => ls[0].id);
    await callAction(page, "mergeLayerDown", [bottomId]);
    expect(await layerCount(page)).toBe(2);
  });

  test("UI: 合并到下层 confirms then merges; cancel keeps two layers; bottom has no button", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await twoLayers(page);

    // open the 图层 tab
    await page.getByRole("button", { name: "图层", exact: true }).click();

    const mergeButtons = page.getByRole("button", { name: "合并到下层" });
    // two layers → exactly one merge button (the upper row; bottom row has none)
    await expect(mergeButtons).toHaveCount(1);

    // cancel path
    await mergeButtons.first().click();
    const cancelModal = page.locator("div.fixed.inset-0").filter({ hasText: "合并图层" }).last();
    await cancelModal.getByRole("button", { name: /^取消$/ }).click();
    expect(await layerCount(page)).toBe(2);

    // confirm path
    await mergeButtons.first().click();
    const okModal = page.locator("div.fixed.inset-0").filter({ hasText: "合并图层" }).last();
    await okModal.getByRole("button", { name: /^确定$/ }).click();
    expect(await layerCount(page)).toBe(1);
  });
});
