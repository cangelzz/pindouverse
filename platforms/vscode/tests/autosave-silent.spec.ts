import { test, expect } from "@playwright/test";
import {
  setupPage,
  loadProject,
  cleanupHarness,
  callAction,
  getStoreState,
  getWrites,
  getMessages,
  clearMessages,
} from "./helpers";

test.describe("Auto-save (autosave.pindou) must NOT switch editor", () => {
  test.afterAll(() => cleanupHarness());

  test("autoSave to backup path uses writeFile, not saveAs", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    // Build a multi-layer state.
    await callAction(page, "addLayer", ["L2"]);
    await callAction(page, "setCell", [0, 0, 5]); // dirties the project
    const beforeLayers = await getStoreState<any[]>(page, "layers");
    expect(beforeLayers.length).toBe(2);

    // Confirm isDirty (autoSave is a no-op otherwise).
    const isDirty = await getStoreState<boolean>(page, "isDirty");
    expect(isDirty).toBe(true);

    await clearMessages(page);

    // Trigger the autosave manually (instead of waiting 60s).
    await callAction(page, "autoSave");

    const messages = await getMessages(page);
    const writeFileMsg = messages.find((m: any) => m.type === "writeFile");
    const saveAsMsg = messages.find((m: any) => m.type === "saveAs");

    // CRITICAL: backup writes must go through writeFile (silent), NOT saveAs
    // (which would dispose the panel and reload, collapsing layers).
    expect(writeFileMsg).toBeTruthy();
    expect(writeFileMsg.path).toMatch(/autosave\.pindou$/);
    expect(saveAsMsg).toBeFalsy();

    // Also confirm the autosave actually wrote layered data — decode the base64
    // payload and check it includes the layers field.
    const writes = await getWrites(page);
    const autosaveWrite = writes.find(
      (w: any) => w.kind === "writeFile" && /autosave\.pindou$/i.test(w.path)
    );
    expect(autosaveWrite).toBeTruthy();
    const decoded = decodeURIComponent(escape(Buffer.from(autosaveWrite.data, "base64").toString("binary")));
    const parsed = JSON.parse(decoded);
    expect(Array.isArray(parsed.layers)).toBe(true);
    expect(parsed.layers.length).toBe(2);

    // And: in-store layers MUST be unchanged after autosave (no panel swap).
    const afterLayers = await getStoreState<any[]>(page, "layers");
    expect(afterLayers.length).toBe(2);
    expect(afterLayers[0].id).toBe(beforeLayers[0].id);
    expect(afterLayers[1].id).toBe(beforeLayers[1].id);
  });
});
