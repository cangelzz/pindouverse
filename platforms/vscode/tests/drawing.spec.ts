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
 * NOTE: These tests exercise the store actions directly rather than synthesizing
 * pointer events on the canvas. The canvas mouse handler is a thin layer that
 * computes (row, col) from event coords and then calls the same store actions.
 * Testing those handlers via synthetic pointer events is fragile (zoom, offset,
 * device pixel ratio) and what we actually care about is "does the store mutate
 * correctly when a draw happens" — which is exactly what these tests cover.
 *
 * The toolbar wiring (button → currentTool) is verified separately at the end.
 */

test.describe("Drawing — store actions", () => {
  test.afterAll(() => cleanupHarness());

  test("setCell sets the colorIndex at (row,col)", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    await callAction(page, "setCell", [0, 0, 5]);

    const value = await page.evaluate(() => {
      const s = (window as any).__pindouStore.getState();
      return s.canvasData[0][0].colorIndex;
    });
    expect(value).toBe(5);
  });

  test("batchSetCells applies many cells in one undo step", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    const entries = Array.from({ length: 10 }, (_, i) => ({
      row: 1,
      col: i,
      colorIndex: 3,
    }));
    await callAction(page, "batchSetCells", [entries]);

    const row1 = await page.evaluate(() =>
      (window as any).__pindouStore.getState().canvasData[1].slice(0, 10).map((c: any) => c.colorIndex)
    );
    expect(row1).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);

    // Single batch creates a single undo step
    const undoLen = await getStoreState<any[]>(page, "undoStack");
    expect(undoLen.length).toBe(1);
  });

  test("eraser equivalent: setCell with null clears the cell", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    // Pick a cell that we know has content from the sample
    const before = await page.evaluate(() => {
      const data = (window as any).__pindouStore.getState().canvasData;
      for (let r = 0; r < data.length; r++) {
        for (let c = 0; c < data[r].length; c++) {
          if (data[r][c].colorIndex != null) return { r, c, color: data[r][c].colorIndex };
        }
      }
      return null;
    });
    expect(before).not.toBeNull();

    await callAction(page, "setCell", [before!.r, before!.c, null]);

    const after = await page.evaluate(
      ({ r, c }) => (window as any).__pindouStore.getState().canvasData[r][c].colorIndex,
      before!
    );
    expect(after).toBeNull();
  });

  test("setTool changes currentTool", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    for (const tool of ["pen", "eraser", "eyedropper", "fill", "line", "select"]) {
      await callAction(page, "setTool", [tool]);
      expect(await getStoreState(page, "currentTool")).toBe(tool);
    }
  });

  test("setSelectedColor updates the active color", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    await callAction(page, "setSelectedColor", [42]);
    expect(await getStoreState(page, "selectedColorIndex")).toBe(42);

    await callAction(page, "setSelectedColor", [null]);
    expect(await getStoreState(page, "selectedColorIndex")).toBeNull();
  });

  test("replaceColor swaps every cell of one color for another", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    // Find a color that's USED, and a destination color that's NOT used,
    // so we can cleanly verify the swap count.
    const { from, to, expected } = await page.evaluate(() => {
      const data = (window as any).__pindouStore.getState().canvasData;
      const counts: Record<number, number> = {};
      for (const row of data) for (const cell of row) {
        if (cell.colorIndex != null) counts[cell.colorIndex] = (counts[cell.colorIndex] || 0) + 1;
      }
      const used = Object.keys(counts).map(Number);
      const from = used[0];
      // Find an unused index in the valid palette range (0-294 for MARD-295)
      let to = 294;
      while (to >= 0 && counts[to]) to--;
      return { from, to, expected: counts[from] };
    });

    await callAction(page, "replaceColor", [from, to]);

    const newCount = await page.evaluate(
      (c) =>
        (window as any).__pindouStore
          .getState()
          .canvasData.flat()
          .filter((cell: any) => cell.colorIndex === c).length,
      to
    );
    expect(newCount).toBe(expected);

    const oldRemaining = await page.evaluate(
      (c) =>
        (window as any).__pindouStore
          .getState()
          .canvasData.flat()
          .filter((cell: any) => cell.colorIndex === c).length,
      from
    );
    expect(oldRemaining).toBe(0);
  });

  test("floodErase clears all connected cells of the clicked color", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    // Paint a 3x3 solid block of color 7 starting at (5, 5)
    const block = [];
    for (let r = 5; r < 8; r++) {
      for (let c = 5; c < 8; c++) {
        block.push({ row: r, col: c, colorIndex: 7 });
      }
    }
    await callAction(page, "batchSetCells", [block]);

    // Sanity: all 9 cells are color 7
    const before = await page.evaluate(() => {
      const d = (window as any).__pindouStore.getState().canvasData;
      const out: (number | null)[] = [];
      for (let r = 5; r < 8; r++) for (let c = 5; c < 8; c++) out.push(d[r][c].colorIndex);
      return out;
    });
    expect(before).toEqual(Array(9).fill(7));

    // Flood erase from the middle of the block
    await callAction(page, "floodErase", [6, 6]);

    const after = await page.evaluate(() => {
      const d = (window as any).__pindouStore.getState().canvasData;
      const out: (number | null)[] = [];
      for (let r = 5; r < 8; r++) for (let c = 5; c < 8; c++) out.push(d[r][c].colorIndex);
      return out;
    });
    expect(after).toEqual(Array(9).fill(null));
  });

  test("floodErase on an empty cell is a no-op (no history entry)", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    // Ensure (0, 0) is empty so we have a guaranteed null cell to test with
    await callAction(page, "setCell", [0, 0, null]);

    const undoBefore = (await getStoreState<any[]>(page, "undoStack")).length;
    // floodErase on the now-empty (0,0) should be a no-op
    await callAction(page, "floodErase", [0, 0]);
    const undoAfter = (await getStoreState<any[]>(page, "undoStack")).length;
    expect(undoAfter).toBe(undoBefore);
  });

  test("floodErase produces a single undo step that restores the whole region", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    const block = [];
    for (let r = 10; r < 13; r++) {
      for (let c = 10; c < 13; c++) {
        block.push({ row: r, col: c, colorIndex: 4 });
      }
    }
    await callAction(page, "batchSetCells", [block]);

    await callAction(page, "floodErase", [11, 11]);
    // One undo should bring all 9 cells back
    await callAction(page, "undo", []);

    const restored = await page.evaluate(() => {
      const d = (window as any).__pindouStore.getState().canvasData;
      const out: (number | null)[] = [];
      for (let r = 10; r < 13; r++) for (let c = 10; c < 13; c++) out.push(d[r][c].colorIndex);
      return out;
    });
    expect(restored).toEqual(Array(9).fill(4));
  });

  test("setTool tracks lastEraserSubmode for eraser tools only", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    await callAction(page, "setTool", ["eraserFill"]);
    expect(await getStoreState(page, "lastEraserSubmode")).toBe("eraserFill");

    // Switching to pen does NOT reset the submode
    await callAction(page, "setTool", ["pen"]);
    expect(await getStoreState(page, "lastEraserSubmode")).toBe("eraserFill");

    await callAction(page, "setTool", ["eraser"]);
    expect(await getStoreState(page, "lastEraserSubmode")).toBe("eraser");
  });
});

test.describe("Toolbar wiring", () => {
  test.afterAll(() => cleanupHarness());

  test("clicking pen toolbar button sets currentTool=pen", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    await callAction(page, "setTool", ["select"]);
    expect(await getStoreState(page, "currentTool")).toBe("select");

    // The CanvasToolbar buttons have `title` attributes for tooltips.
    // Find the pen button by its title text.
    await page.locator('button[title*="画笔"], button[title*="Pen"]').first().click();
    expect(await getStoreState(page, "currentTool")).toBe("pen");
  });

  test("clicking eraser toolbar button sets currentTool=eraser", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    await callAction(page, "setTool", ["pen"]);
    await page.locator('button[title*="橡皮"], button[title*="Eraser"]').first().click();
    expect(await getStoreState(page, "currentTool")).toBe("eraser");
  });
});
