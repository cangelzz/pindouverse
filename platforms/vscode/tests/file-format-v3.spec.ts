import { test, expect } from "@playwright/test";
import {
  setupPage,
  cleanupHarness,
  loadProject,
  getStoreState,
  getWrites,
  clearMessages,
  callAction,
  SAMPLES_DIR,
} from "./helpers";
import * as path from "path";

const SAMPLE = path.join(SAMPLES_DIR, "asuka71x100.pindou");

test.describe(".pindou v3 file-format", () => {
  test.afterAll(() => cleanupHarness());

  test("loading a v2 file populates in-memory cells correctly", async ({ page }) => {
    await setupPage(page);
    await loadProject(page, { samplePath: SAMPLE });

    const cs = await getStoreState<{ width: number; height: number }>(page, "canvasSize");
    expect(cs).toEqual({ width: 71, height: 100 });

    const data = await getStoreState<any[][]>(page, "canvasData");
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(100);
    expect(data[0].length).toBe(71);
    expect(typeof data[0][0]).toBe("object");
    expect("colorIndex" in data[0][0]).toBe(true);
  });

  test("saving emits v3 (flat cells, no indent, version: 3)", async ({ page }) => {
    await setupPage(page);
    await loadProject(page, { samplePath: SAMPLE });

    await clearMessages(page);
    // Trigger save via the store action (no dialog — file has an existing path).
    await callAction(page, "saveProject");

    // Wait for the harness to capture the save payload.
    await page.waitForFunction(
      () => (window as any)._writes.some((w: any) => w.kind === "save"),
      null,
      { timeout: 5_000 }
    );

    const writes = await getWrites(page);
    const save = writes.find((w: any) => w.kind === "save");
    expect(save).toBeTruthy();
    // v3 is serialized without indentation — no newlines inside the JSON body
    expect(save.content).not.toMatch(/\n/);

    const parsed = JSON.parse(save.content);
    expect(parsed.version).toBe(3);
    expect(Array.isArray(parsed.canvasData)).toBe(true);
    // v3 flat encoding: each cell is null OR a bare number, NOT an {colorIndex} object
    const firstCell = parsed.canvasData[0][0];
    expect(typeof firstCell === "number" || firstCell === null).toBe(true);
  });
});
