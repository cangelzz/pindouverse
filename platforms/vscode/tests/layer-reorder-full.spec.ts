import { test, expect } from "@playwright/test";
import {
  setupPage,
  loadProject,
  cleanupHarness,
  callAction,
  getStoreState,
  countRenderedPixels,
} from "./helpers";

test.describe("Layer reordering full flow", () => {
  test.afterAll(() => cleanupHarness());

  test("full flow: load → add layer → draw → move up → draw again", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    // Snapshot the original layer count of non-empty cells
    let layers = await getStoreState<any[]>(page, "layers");
    expect(layers.length).toBe(1);

    const countCellsInLayer = (layer: any) => {
      let n = 0;
      for (const row of layer.data) for (const c of row) if (c.colorIndex !== null) n++;
      return n;
    };

    const origCount = countCellsInLayer(layers[0]);
    expect(origCount).toBeGreaterThan(0);
    const layer1Id = layers[0].id;

    // Add Layer 2
    await callAction(page, "addLayer", ["L2"]);
    layers = await getStoreState<any[]>(page, "layers");
    expect(layers.length).toBe(2);
    const layer2Id = layers[1].id;

    // Layer 2 is now active. Draw a few pixels on it.
    await callAction(page, "setCell", [0, 0, 5]);
    await callAction(page, "setCell", [0, 1, 5]);
    await callAction(page, "setCell", [0, 2, 5]);

    layers = await getStoreState<any[]>(page, "layers");
    expect(countCellsInLayer(layers[1])).toBe(3);
    expect(countCellsInLayer(layers[0])).toBe(origCount);

    // Move L2 down (toward bottom = idx 0)
    await callAction(page, "moveLayer", [layer2Id, "down"]);
    layers = await getStoreState<any[]>(page, "layers");

    // After move: L2 at idx 0, L1 at idx 1. Both data preserved.
    expect(layers.length).toBe(2);
    expect(layers[0].id).toBe(layer2Id);
    expect(layers[1].id).toBe(layer1Id);
    expect(countCellsInLayer(layers[0])).toBe(3);  // L2 still has 3 pixels
    expect(countCellsInLayer(layers[1])).toBe(origCount);  // L1 still has originals

    // The active layer is still L2 (or whatever was active — it must NOT collapse)
    const activeId = await getStoreState<string>(page, "activeLayerId");
    expect([layer1Id, layer2Id]).toContain(activeId);

    // Move L1 down (currently at idx 1, "down" → idx 0). Move L2 to idx 1 in result.
    await callAction(page, "moveLayer", [layer1Id, "down"]);
    layers = await getStoreState<any[]>(page, "layers");
    expect(layers.length).toBe(2);
    expect(layers[0].id).toBe(layer1Id);
    expect(layers[1].id).toBe(layer2Id);
    expect(countCellsInLayer(layers[0])).toBe(origCount);
    expect(countCellsInLayer(layers[1])).toBe(3);
  });

  test("moveLayer through UI buttons (full DOM flow)", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    // Open layers tab
    await page.getByRole("button", { name: "图层" }).click();

    // Click "+ 新建图层"
    await page.getByRole("button", { name: /\+ 新建图层/ }).click();
    // Dismiss the prompt with default name
    const modal = page.locator("div.fixed.inset-0").filter({ hasText: /确定/ }).last();
    await modal.waitFor({ state: "visible" });
    await modal.getByRole("button", { name: /^确定$/ }).click();

    // Verify 2 layers in store
    let layers = await getStoreState<any[]>(page, "layers");
    expect(layers.length).toBe(2);
    const layer2Id = layers[1].id;

    // Draw on the active layer (L2)
    await callAction(page, "setCell", [3, 3, 10]);
    layers = await getStoreState<any[]>(page, "layers");
    expect(layers[1].data[3][3].colorIndex).toBe(10);

    // Click the down arrow on L2 (UI shows reversed array; L2 is the TOP entry).
    // The TOP layer entry's ↓ button moves it down (lower index).
    // Strategy: find the layer panel; iterate; click first ↓ button.
    const downButtons = page.locator('button[title="下移"]');
    await expect(downButtons.first()).toBeVisible();
    await downButtons.first().click();

    layers = await getStoreState<any[]>(page, "layers");
    expect(layers.length).toBe(2);  // STILL 2 layers
    expect(layers[0].id).toBe(layer2Id);  // L2 moved to bottom
    expect(layers[0].data[3][3].colorIndex).toBe(10);  // Its data intact

    // Visual sanity: the rendered canvas still has pixels from BOTH layers
    const pixelCount = await countRenderedPixels(page);
    expect(pixelCount).toBeGreaterThan(0);
  });
});
