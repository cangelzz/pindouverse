import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { setupPage, loadProject, cleanupHarness, callAction, setStoreState } from "./helpers";

test.describe("selection color adjust", () => {
  test.afterAll(() => cleanupHarness());

  async function cellColor(page: Page, r: number, c: number): Promise<number | null> {
    return page.evaluate(
      ({ r, c }) => (window as any).__pindouStore.getState().layers[0].data[r][c].colorIndex,
      { r, c }
    );
  }
  async function overlaySize(page: Page): Promise<number> {
    return page.evaluate(() => (window as any).__pindouStore.getState().previewOverlay?.size ?? 0);
  }
  async function overlayIsNull(page: Page): Promise<boolean> {
    return page.evaluate(() => (window as any).__pindouStore.getState().previewOverlay === null);
  }
  async function seed2x2(page: Page) {
    await callAction(page, "newCanvas", [4, 4]);
    await callAction(page, "batchSetCells", [[
      { row: 0, col: 0, colorIndex: 0 },
      { row: 0, col: 1, colorIndex: 0 },
      { row: 1, col: 0, colorIndex: 0 },
      { row: 1, col: 1, colorIndex: 0 },
    ]]);
    await setStoreState(page, {
      selection: new Set(["0,0", "0,1", "1,0", "1,1"]),
      selectionBounds: { r1: 0, c1: 0, r2: 1, c2: 1 },
    });
  }

  const EXPOSE = { exposure: 80, contrast: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0 };

  test("preview does not mutate data; apply commits; undo restores", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await seed2x2(page);
    expect(await cellColor(page, 0, 0)).toBe(0);

    await callAction(page, "beginSelectionAdjust", []);
    await callAction(page, "updateSelectionAdjustPreview", [EXPOSE, "all"]);

    expect(await cellColor(page, 0, 0)).toBe(0);          // data unchanged
    expect(await overlaySize(page)).toBeGreaterThan(0);   // overlay populated

    await callAction(page, "commitSelectionAdjust", []);
    expect(await cellColor(page, 0, 0)).not.toBe(0);      // data committed
    expect(await overlayIsNull(page)).toBe(true);

    await callAction(page, "undo", []);
    expect(await cellColor(page, 0, 0)).toBe(0);          // single-step undo restores
  });

  test("cancel leaves data unchanged and clears overlay", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await seed2x2(page);

    await callAction(page, "beginSelectionAdjust", []);
    await callAction(page, "updateSelectionAdjustPreview", [EXPOSE, "all"]);
    await callAction(page, "cancelSelectionAdjust", []);

    expect(await cellColor(page, 0, 0)).toBe(0);
    expect(await overlayIsNull(page)).toBe(true);
  });

  test("used-only snap maps into existing colors and changes a saturated cell", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    // Project uses exactly two colors: 27 (B2, saturated green) and 0 (A1, pale).
    // The used pool is therefore {0, 27}.
    await callAction(page, "batchSetCells", [[
      { row: 0, col: 0, colorIndex: 27 },
      { row: 0, col: 1, colorIndex: 0 },
    ]]);
    await setStoreState(page, {
      selection: new Set(["0,0"]),
      selectionBounds: { r1: 0, c1: 0, r2: 0, c2: 0 },
    });
    await callAction(page, "beginSelectionAdjust", []);
    // Full desaturation turns the green cell grey, which cannot stay color 27,
    // so the overlay must be non-empty and snap to the only other used color.
    await callAction(page, "updateSelectionAdjustPreview", [
      { exposure: 0, contrast: 0, saturation: -100, vibrance: 0, temperature: 0, tint: 0 },
      "used",
    ]);

    const vals: number[] = await page.evaluate(() => {
      const o = (window as any).__pindouStore.getState().previewOverlay;
      return o ? Array.from(o.values()) : [];
    });
    expect(vals.length).toBeGreaterThan(0); // not a vacuous check
    for (const dst of vals) {
      expect([0, 27]).toContain(dst); // never snaps outside the used set
    }
  });
});
