import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { setupPage, loadProject, cleanupHarness, callAction, getStoreState } from "./helpers";

test.describe("hidden active layer blocks edits", () => {
  test.afterAll(() => cleanupHarness());

  async function activeCell(page: Page, r: number, c: number): Promise<number | null> {
    return page.evaluate(({ r, c }) => {
      const st = (window as any).__pindouStore.getState();
      const layer = st.layers.find((l: any) => l.id === st.activeLayerId);
      return layer.data[r][c].colorIndex;
    }, { r, c });
  }
  async function hideActive(page: Page) {
    const id = await getStoreState<string>(page, "activeLayerId");
    await callAction(page, "setLayerVisible", [id, false]);
  }
  async function showActive(page: Page) {
    const id = await getStoreState<string>(page, "activeLayerId");
    await callAction(page, "setLayerVisible", [id, true]);
  }

  test("setCell / batchSetCells / floodFill are no-ops on a hidden active layer", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    await callAction(page, "addLayer", []);
    await hideActive(page);

    await callAction(page, "setCell", [0, 0, 5]);
    expect(await activeCell(page, 0, 0)).toBeNull();

    await callAction(page, "batchSetCells", [[{ row: 1, col: 1, colorIndex: 5 }]]);
    expect(await activeCell(page, 1, 1)).toBeNull();

    await callAction(page, "floodFill", [2, 2, 5]);
    expect(await activeCell(page, 2, 2)).toBeNull();
  });

  test("edits resume after the layer is shown again", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    await callAction(page, "addLayer", []);
    await hideActive(page);
    await callAction(page, "setCell", [0, 0, 5]);
    expect(await activeCell(page, 0, 0)).toBeNull();

    await showActive(page);
    await callAction(page, "setCell", [0, 0, 5]);
    expect(await activeCell(page, 0, 0)).toBe(5);
  });
});
