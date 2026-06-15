import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { setupPage, loadProject, cleanupHarness, callAction, getStoreState } from "./helpers";

test.describe("eyedropper samples the active layer only", () => {
  test.afterAll(() => cleanupHarness());

  test("does not pick a lower layer's color when active layer is empty there", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    await callAction(page, "setCell", [0, 0, 5]);
    await callAction(page, "addLayer", []);
    await callAction(page, "setSelectedColor", [3]);
    const picked = await callAction<boolean>(page, "pickActiveLayerColor", [0, 0]);
    expect(picked).toBe(false);
    expect(await getStoreState<number | null>(page, "selectedColorIndex")).toBe(3);
  });

  test("picks the active layer's own color", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    await callAction(page, "addLayer", []);
    await callAction(page, "setCell", [1, 1, 9]);
    await callAction(page, "setSelectedColor", [3]);
    const picked = await callAction<boolean>(page, "pickActiveLayerColor", [1, 1]);
    expect(picked).toBe(true);
    expect(await getStoreState<number | null>(page, "selectedColorIndex")).toBe(9);
  });

  test("empty / out-of-bounds cell returns false and keeps the selection", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    await callAction(page, "setSelectedColor", [3]);
    const picked = await callAction<boolean>(page, "pickActiveLayerColor", [99, 99]);
    expect(picked).toBe(false);
    expect(await getStoreState<number | null>(page, "selectedColorIndex")).toBe(3);
  });
});
