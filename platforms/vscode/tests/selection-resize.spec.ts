import { test, expect } from "@playwright/test";
import {
  setupPage,
  loadProject,
  cleanupHarness,
  callAction,
  setStoreState,
  getStoreState,
} from "./helpers";

// Regression: the 8 resize handles drawn around a rectangle selection were
// purely visual — handleMouseDown had no hit-test for them, so clicking a
// handle either cleared the selection (if outside) or started a move drag
// (if inside). These tests verify the handle drag actually resizes.

test.describe("Selection resize handles", () => {
  test.afterAll(() => cleanupHarness());

  async function seedRectSelection(
    page: import("@playwright/test").Page,
    bounds: { r1: number; c1: number; r2: number; c2: number },
  ) {
    await callAction(page, "newCanvas", [20, 20]);
    await callAction(page, "setTool", ["select"]);
    const sel = new Set<string>();
    for (let r = bounds.r1; r <= bounds.r2; r++) {
      for (let c = bounds.c1; c <= bounds.c2; c++) sel.add(`${r},${c}`);
    }
    await setStoreState(page, { selection: sel, selectionBounds: bounds });
  }

  async function canvasGeom(page: import("@playwright/test").Page): Promise<{
    boxX: number; boxY: number; cellSize: number; offsetX: number; offsetY: number;
  }> {
    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas not visible");
    const cellSize = await getStoreState<number>(page, "cellSize");
    const offsetX = await getStoreState<number>(page, "offsetX");
    const offsetY = await getStoreState<number>(page, "offsetY");
    return { boxX: box.x, boxY: box.y, cellSize, offsetX, offsetY };
  }

  test("SE handle drag enlarges r2/c2 and leaves r1/c1 alone", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    const start = { r1: 2, c1: 3, r2: 5, c2: 8 };
    await seedRectSelection(page, start);

    const { boxX, boxY, cellSize, offsetX, offsetY } = await canvasGeom(page);

    // SE handle sits at the bottom-right outer corner: ((c2+1)*cs+ox, (r2+1)*cs+oy)
    const handleX = boxX + (start.c2 + 1) * cellSize + offsetX;
    const handleY = boxY + (start.r2 + 1) * cellSize + offsetY;

    // Target cell (9, 12) — center of that cell in screen coords
    const targetX = boxX + (12 + 0.5) * cellSize + offsetX;
    const targetY = boxY + (9 + 0.5) * cellSize + offsetY;

    await page.mouse.move(handleX, handleY);
    await page.mouse.down();
    await page.mouse.move(targetX, targetY, { steps: 5 });
    await page.mouse.up();

    const bounds = await getStoreState<typeof start>(page, "selectionBounds");
    expect(bounds).toEqual({ r1: 2, c1: 3, r2: 9, c2: 12 });
  });

  test("NW handle drag shrinks from top-left, keeps r2/c2", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    const start = { r1: 2, c1: 3, r2: 8, c2: 10 };
    await seedRectSelection(page, start);

    const { boxX, boxY, cellSize, offsetX, offsetY } = await canvasGeom(page);

    // NW handle sits at the top-left outer corner: (c1*cs+ox, r1*cs+oy)
    const handleX = boxX + start.c1 * cellSize + offsetX;
    const handleY = boxY + start.r1 * cellSize + offsetY;

    // Drag to (5, 6) → shrink to r1=5, c1=6
    const targetX = boxX + (6 + 0.5) * cellSize + offsetX;
    const targetY = boxY + (5 + 0.5) * cellSize + offsetY;

    await page.mouse.move(handleX, handleY);
    await page.mouse.down();
    await page.mouse.move(targetX, targetY, { steps: 5 });
    await page.mouse.up();

    const bounds = await getStoreState<typeof start>(page, "selectionBounds");
    expect(bounds).toEqual({ r1: 5, c1: 6, r2: 8, c2: 10 });
  });

  test("dragging within canvas updates bounds to mouse cell", async ({ page }) => {
    // Sanity that the wiring continues to track moves until mouseup. The
    // clamp-to-canvas behavior itself is unit-tested in computeResizedBounds
    // (src/utils/selectionResize.test.ts); a Playwright integration test for
    // it would need to thread the harness's layout-driven cellSize, which
    // makes assertions brittle.
    await setupPage(page);
    await loadProject(page);
    const start = { r1: 2, c1: 3, r2: 5, c2: 8 };
    await seedRectSelection(page, start);

    const { boxX, boxY, cellSize, offsetX, offsetY } = await canvasGeom(page);
    const handleX = boxX + (start.c2 + 1) * cellSize + offsetX;
    const handleY = boxY + (start.r2 + 1) * cellSize + offsetY;

    // Move SE corner two cells right + one cell down — well within the canvas.
    const targetX = boxX + (10 + 0.5) * cellSize + offsetX;
    const targetY = boxY + (6 + 0.5) * cellSize + offsetY;

    await page.mouse.move(handleX, handleY);
    await page.mouse.down();
    await page.mouse.move(targetX, targetY, { steps: 3 });
    await page.mouse.up();

    const bounds = await getStoreState<typeof start>(page, "selectionBounds");
    expect(bounds).toEqual({ r1: 2, c1: 3, r2: 6, c2: 10 });
  });
});
