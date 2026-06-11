import { test, expect } from "@playwright/test";
import {
  setupPage,
  loadProject,
  cleanupHarness,
  callAction,
  getStoreState,
} from "./helpers";

test.describe("Undo / redo", () => {
  test.afterAll(() => cleanupHarness());

  test("undo reverts a setCell", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    const before = await page.evaluate(
      () => (window as any).__pindouStore.getState().canvasData[0][0].colorIndex
    );
    await callAction(page, "setCell", [0, 0, 99]);
    expect(
      await page.evaluate(
        () => (window as any).__pindouStore.getState().canvasData[0][0].colorIndex
      )
    ).toBe(99);

    await callAction(page, "undo");
    expect(
      await page.evaluate(
        () => (window as any).__pindouStore.getState().canvasData[0][0].colorIndex
      )
    ).toBe(before);
  });

  test("redo replays an undone setCell", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    await callAction(page, "setCell", [2, 2, 77]);
    await callAction(page, "undo");
    await callAction(page, "redo");
    expect(
      await page.evaluate(
        () => (window as any).__pindouStore.getState().canvasData[2][2].colorIndex
      )
    ).toBe(77);
  });

  test("multiple draws → multiple undos walk back to baseline", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    const baseline = await page.evaluate(() => {
      const data = (window as any).__pindouStore.getState().canvasData;
      return [data[5][5].colorIndex, data[5][6].colorIndex, data[5][7].colorIndex];
    });

    await callAction(page, "setCell", [5, 5, 10]);
    await callAction(page, "setCell", [5, 6, 11]);
    await callAction(page, "setCell", [5, 7, 12]);

    await callAction(page, "undo");
    await callAction(page, "undo");
    await callAction(page, "undo");

    const after = await page.evaluate(() => {
      const data = (window as any).__pindouStore.getState().canvasData;
      return [data[5][5].colorIndex, data[5][6].colorIndex, data[5][7].colorIndex];
    });
    expect(after).toEqual(baseline);
  });

  test("undo via the VS Code host command reverts the last edit", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    const before = await page.evaluate(
      () => (window as any).__pindouStore.getState().canvasData[3][3].colorIndex
    );
    await callAction(page, "setCell", [3, 3, 50]);

    // In VS Code the webview does NOT self-handle Ctrl+Z (that would double-undo
    // against the host's keybinding). The extension's pindouverse.undo command
    // forwards a {type:'undo'} message instead — that's the path under test here.
    // See undo-host-driven.spec.ts for the full host-driven contract.
    await page.evaluate(() =>
      window.dispatchEvent(new MessageEvent("message", { data: { type: "undo" } }))
    );
    await page.waitForTimeout(100);

    expect(
      await page.evaluate(
        () => (window as any).__pindouStore.getState().canvasData[3][3].colorIndex
      )
    ).toBe(before);
  });

  test("undoStack and redoStack lengths track operations", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    const initialUndo = (await getStoreState<any[]>(page, "undoStack")).length;
    await callAction(page, "setCell", [0, 1, 1]);
    await callAction(page, "setCell", [0, 2, 2]);
    expect((await getStoreState<any[]>(page, "undoStack")).length).toBe(initialUndo + 2);
    expect((await getStoreState<any[]>(page, "redoStack")).length).toBe(0);

    await callAction(page, "undo");
    expect((await getStoreState<any[]>(page, "redoStack")).length).toBe(1);
  });
});

test.describe("Selection / clipboard", () => {
  test.afterAll(() => cleanupHarness());

  test("selectAll populates selection covering whole canvas", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    await callAction(page, "selectAll");
    const bounds = await getStoreState<any>(page, "selectionBounds");
    const size = await getStoreState<{ width: number; height: number }>(page, "canvasSize");
    expect(bounds).not.toBeNull();
    expect(bounds.r1).toBe(0);
    expect(bounds.c1).toBe(0);
    expect(bounds.r2).toBe(size.height - 1);
    expect(bounds.c2).toBe(size.width - 1);
  });

  test("clearSelection wipes the selection", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    await callAction(page, "selectAll");
    expect(await getStoreState(page, "selectionBounds")).not.toBeNull();

    await callAction(page, "clearSelection");
    expect(await getStoreState(page, "selection")).toBeNull();
    expect(await getStoreState(page, "selectionBounds")).toBeNull();
  });

  test("copySelection captures cells into clipboard", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    // Manually set a small selection
    await page.evaluate(() => {
      const sel = new Set<string>();
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++) sel.add(`${r},${c}`);
      (window as any).__pindouStore.setState({
        selection: sel,
        selectionBounds: { r1: 0, c1: 0, r2: 2, c2: 2 },
      });
    });

    await callAction(page, "copySelection");
    const clip = await page.evaluate(() => {
      const c = (window as any).__pindouStore.getState().clipboard;
      return c ? { width: c.width, height: c.height, size: c.cells.size } : null;
    });
    expect(clip).not.toBeNull();
    expect(clip!.width).toBe(3);
    expect(clip!.height).toBe(3);
  });

  test("deleteSelection clears cells inside selection", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    // Force-fill a 3x3 region first
    await callAction(page, "batchSetCells", [
      Array.from({ length: 9 }, (_, i) => ({
        row: Math.floor(i / 3),
        col: i % 3,
        colorIndex: 5,
      })),
    ]);

    // Select that region
    await page.evaluate(() => {
      const sel = new Set<string>();
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++) sel.add(`${r},${c}`);
      (window as any).__pindouStore.setState({
        selection: sel,
        selectionBounds: { r1: 0, c1: 0, r2: 2, c2: 2 },
      });
    });

    await callAction(page, "deleteSelection");

    const remaining = await page.evaluate(() => {
      const data = (window as any).__pindouStore.getState().canvasData;
      let count = 0;
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++)
          if (data[r][c].colorIndex != null) count++;
      return count;
    });
    expect(remaining).toBe(0);
  });

  test("paste creates a floatingSelection from clipboard", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    // Build a clipboard
    await callAction(page, "selectAll");
    await callAction(page, "copySelection");
    await callAction(page, "clearSelection");
    expect(await getStoreState(page, "clipboard")).not.toBeNull();

    await callAction(page, "pasteClipboard");
    const floating = await page.evaluate(() => {
      const f = (window as any).__pindouStore.getState().floatingSelection;
      return f ? { size: f.cells.size } : null;
    });
    expect(floating).not.toBeNull();
    expect(floating!.size).toBeGreaterThan(0);
  });
});
