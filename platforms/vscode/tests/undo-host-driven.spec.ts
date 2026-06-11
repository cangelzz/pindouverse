import { test, expect } from "@playwright/test";
import {
  setupPage,
  loadProject,
  cleanupHarness,
  callAction,
  getStoreState,
} from "./helpers";

/**
 * Regression suite for the "Ctrl+Z wipes everything since last save" bug.
 *
 * Root cause: the extension uses a CustomTextEditorProvider whose underlying
 * .pindou TEXT document only changes on save (one full-document replace per
 * save). VS Code's built-in `undo` command, fired by Ctrl+Z while the editor
 * is active, undid that last full-document edit — reverting the file to its
 * last-saved state. The resulting onDidChangeTextDocument reloaded the webview,
 * wiping every unsaved drawing edit AND clearing the redo stack.
 *
 * Fix: the host now binds Ctrl+Z/Ctrl+Y/Ctrl+Shift+Z (scoped to our custom
 * editor) to pindouverse.undo/redo commands that forward an {type:'undo'|'redo'}
 * message to the webview. The webview owns the single undo stack. PixelCanvas's
 * own Ctrl+Z handler stands down in VS Code (via __pindouHostHandlesUndo) so we
 * never undo twice.
 */
test.describe("Host-driven undo/redo (VS Code Ctrl+Z must not wipe the document)", () => {
  test.afterAll(() => cleanupHarness());

  test("webview signals that the host owns undo/redo", async ({ page }) => {
    await setupPage(page);
    const flag = await page.evaluate(() => (window as any).__pindouHostHandlesUndo);
    expect(flag).toBe(true);
  });

  test("host 'undo' message reverts exactly one step (not the whole document)", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    await callAction(page, "setCell", [0, 0, 5]);
    await callAction(page, "setCell", [0, 1, 6]);
    expect((await getStoreState<any[]>(page, "undoStack")).length).toBe(2);

    // Simulate the extension host's pindouverse.undo command forwarding to webview.
    await page.evaluate(() =>
      window.dispatchEvent(new MessageEvent("message", { data: { type: "undo" } }))
    );

    // Exactly one step undone — NOT wiped to 0 — and redo is available.
    expect((await getStoreState<any[]>(page, "undoStack")).length).toBe(1);
    expect((await getStoreState<any[]>(page, "redoStack")).length).toBe(1);
  });

  test("host 'redo' message re-applies one step", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    await callAction(page, "setCell", [0, 0, 5]);
    await page.evaluate(() =>
      window.dispatchEvent(new MessageEvent("message", { data: { type: "undo" } }))
    );
    expect((await getStoreState<any[]>(page, "redoStack")).length).toBe(1);

    await page.evaluate(() =>
      window.dispatchEvent(new MessageEvent("message", { data: { type: "redo" } }))
    );
    expect((await getStoreState<any[]>(page, "undoStack")).length).toBe(1);
    expect((await getStoreState<any[]>(page, "redoStack")).length).toBe(0);
  });

  test("host 'undo' is ignored while a text input is focused", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "setCell", [0, 0, 5]);

    await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "__test_input";
      document.body.appendChild(input);
      input.focus();
    });

    await page.evaluate(() =>
      window.dispatchEvent(new MessageEvent("message", { data: { type: "undo" } }))
    );

    // The focused input owns Ctrl+Z for native text editing; canvas undo must not fire.
    expect((await getStoreState<any[]>(page, "undoStack")).length).toBe(1);
  });

  test("Ctrl+Z keydown does NOT self-undo in VS Code (host command drives it)", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "setCell", [0, 0, 5]);

    // PixelCanvas listens for Ctrl+Z on window. With __pindouHostHandlesUndo set,
    // it must defer to the host command and NOT call store.undo() itself —
    // otherwise VS Code would undo twice per keypress.
    await page.evaluate(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true })
      )
    );

    expect((await getStoreState<any[]>(page, "undoStack")).length).toBe(1);
  });

  test("opening a file inside .pindou_autosave disables autosave (won't cannibalize the backup)", async ({ page }) => {
    await setupPage(page);

    const content = JSON.stringify({
      version: 1,
      canvasSize: { width: 4, height: 4 },
      canvasData: Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => null)),
    });

    await page.evaluate((c) => {
      (window as any)._currentDocPath = "/proj/.pindou_autosave/autosave.pindou";
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "loadDocument",
            content: c,
            path: "/proj/.pindou_autosave/autosave.pindou",
            isUntitled: false,
            isBackup: true,
          },
        })
      );
    }, content);

    await page.waitForFunction(
      () => (window as any).__pindouStore?.getState().canvasData?.length > 0,
      null,
      { timeout: 5_000 }
    );

    expect(await getStoreState<boolean>(page, "autoSaveEnabled")).toBe(false);
  });
});
