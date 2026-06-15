import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { setupPage, loadProject, cleanupHarness, callAction, getStoreState, clickButton } from "./helpers";

test.describe("stats double-click jumps to palette", () => {
  test.afterAll(() => cleanupHarness());

  async function seed(page: Page) {
    await callAction(page, "newCanvas", [4, 4]);
    await callAction(page, "batchSetCells", [[
      { row: 0, col: 0, colorIndex: 0 },
      { row: 0, col: 1, colorIndex: 27 },
      { row: 1, col: 0, colorIndex: 27 },
    ]]);
  }

  test("double-clicking a stats row selects + highlights the color and shows the palette", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await seed(page);

    const toolBefore = await getStoreState<string>(page, "currentTool");

    await clickButton(page, "统计");
    const row = page.locator('[data-bead-row="27"]');
    await expect(row).toBeVisible();

    await row.dblclick();

    expect(await getStoreState<number | null>(page, "selectedColorIndex")).toBe(27);
    expect(await getStoreState<number | null>(page, "highlightColorIndex")).toBe(27);
    await expect(page.locator('button[data-color-index="27"]')).toBeVisible();
    expect(await getStoreState<string>(page, "currentTool")).toBe(toolBefore);
  });
});
