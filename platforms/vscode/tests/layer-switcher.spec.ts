import { test, expect } from "@playwright/test";
import {
  setupPage,
  loadProject,
  cleanupHarness,
  callAction,
  getStoreState,
} from "./helpers";

// Status-bar layer switcher — hover the "图层: <name>" chip above the canvas
// to drop down a menu of all layers; click a row to switch. Only renders the
// dropdown when there are 2+ layers (a single layer needs no switcher).

test.describe("Canvas status-bar layer switcher", () => {
  test.afterAll(() => cleanupHarness());

  test("single layer: chip is static text, no dropdown trigger", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    // Hovering the area should NOT spawn a menu.
    await expect(page.locator("[data-layer-switcher]")).toHaveCount(0);
    await expect(page.locator("[data-layer-switcher-menu]")).toHaveCount(0);
  });

  test("multiple layers: hover opens menu listing all layers", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "addLayer", ["草图"]);
    await callAction(page, "addLayer", ["参考"]);

    const trigger = page.locator("[data-layer-switcher] button").first();
    await expect(trigger).toBeVisible();
    await trigger.hover();

    const menu = page.locator("[data-layer-switcher-menu]");
    await expect(menu).toBeVisible();
    // Top-down menu order = reversed layers (newest first)
    await expect(menu).toContainText("参考");
    await expect(menu).toContainText("草图");
    await expect(menu).toContainText("拼豆层");
  });

  test("clicking a menu item switches the active layer", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "addLayer", ["草图"]);
    const layers = await getStoreState<any[]>(page, "layers");
    const draftId = layers.find((l) => l.name === "草图").id;

    await page.locator("[data-layer-switcher] button").first().hover();
    await page.locator("[data-layer-switcher-menu]").getByRole("button", { name: /草图/ }).click();

    const activeId = await getStoreState<string>(page, "activeLayerId");
    expect(activeId).toBe(draftId);

    // Menu auto-closes after click.
    await expect(page.locator("[data-layer-switcher-menu]")).toHaveCount(0);
  });

  test("menu closes after the cursor leaves the trigger+menu", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "addLayer", ["草图"]);

    const trigger = page.locator("[data-layer-switcher] button").first();
    await trigger.hover();
    await expect(page.locator("[data-layer-switcher-menu]")).toBeVisible();

    // Move far away — the 220 ms grace period elapses, menu closes.
    await page.mouse.move(10, 10);
    await page.waitForTimeout(400);
    await expect(page.locator("[data-layer-switcher-menu]")).toHaveCount(0);
  });
});
