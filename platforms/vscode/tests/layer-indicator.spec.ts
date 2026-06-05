import { test, expect } from "@playwright/test";
import {
  setupPage,
  loadProject,
  cleanupHarness,
  callAction,
  getStoreState,
} from "./helpers";

// New floating tag on the canvas that reminds the user which layer they're
// drawing on — appears only when the active layer is NOT the default (first)
// one, and follows the cursor.

test.describe("Floating active-layer tag", () => {
  test.afterAll(() => cleanupHarness());

  test("not rendered when the active layer is the default (first) one", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas not visible");

    // Move mouse over the canvas — even with cursor present, the tag must NOT
    // appear because activeLayer === layers[0].
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(100);

    await expect(page.locator("[data-active-layer-tag]")).toHaveCount(0);
  });

  test("appears when active layer is non-default, with layer name + color chip", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    // Add a 2nd layer and switch to it.
    await callAction(page, "addLayer", ["草图层"]);
    const layers = await getStoreState<any[]>(page, "layers");
    await callAction(page, "setActiveLayer", [layers[layers.length - 1].id]);

    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas not visible");

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(100);

    const tag = page.locator("[data-active-layer-tag]");
    await expect(tag).toHaveCount(1);
    await expect(tag).toContainText("草图层");
  });

  test("disappears when mouse leaves the canvas", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "addLayer", ["层2"]);
    const layers = await getStoreState<any[]>(page, "layers");
    await callAction(page, "setActiveLayer", [layers[layers.length - 1].id]);

    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas not visible");

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(100);
    await expect(page.locator("[data-active-layer-tag]")).toHaveCount(1);

    // Move mouse far above the canvas (to the title bar area).
    await page.mouse.move(box.x + 10, 5);
    await page.waitForTimeout(100);
    await expect(page.locator("[data-active-layer-tag]")).toHaveCount(0);
  });

  test("position tracks the cursor (left/top change between two mouse positions)", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "addLayer", ["层2"]);
    const layers = await getStoreState<any[]>(page, "layers");
    await callAction(page, "setActiveLayer", [layers[layers.length - 1].id]);

    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas not visible");

    await page.mouse.move(box.x + 50, box.y + 50);
    await page.waitForTimeout(80);
    const tag = page.locator("[data-active-layer-tag]");
    const firstBox = await tag.boundingBox();

    await page.mouse.move(box.x + 200, box.y + 150);
    await page.waitForTimeout(80);
    const secondBox = await tag.boundingBox();

    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();
    expect(secondBox!.x).toBeGreaterThan(firstBox!.x);
    expect(secondBox!.y).toBeGreaterThan(firstBox!.y);
  });

  test("setShowActiveLayerTag(false) hides the tag even on a non-default layer", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "addLayer", ["层2"]);
    const layers = await getStoreState<any[]>(page, "layers");
    await callAction(page, "setActiveLayer", [layers[layers.length - 1].id]);

    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas not visible");

    await page.mouse.move(box.x + 100, box.y + 100);
    await page.waitForTimeout(80);
    await expect(page.locator("[data-active-layer-tag]")).toHaveCount(1);

    // User toggles the "always show" checkbox off.
    await callAction(page, "setShowActiveLayerTag", [false]);
    await page.waitForTimeout(50);
    await expect(page.locator("[data-active-layer-tag]")).toHaveCount(0);

    // Toggle back on — tag returns the moment the cursor moves over the canvas.
    await callAction(page, "setShowActiveLayerTag", [true]);
    await page.mouse.move(box.x + 105, box.y + 105);
    await page.waitForTimeout(80);
    await expect(page.locator("[data-active-layer-tag]")).toHaveCount(1);
  });
});
