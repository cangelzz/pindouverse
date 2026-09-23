import { test, expect } from "@playwright/test";
import { setupPage, loadProject, callAction, cleanupHarness, getStoreState, requestBlueprintTool, stageReply, getWrites } from "./helpers";

test.afterAll(() => cleanupHarness());

test("imports fresh PNG bytes with a scoped file request", async ({ page }) => {
  await setupPage(page);
  await loadProject(page);
  await callAction(page, "newCanvas", [2, 1]);
  const inspected = await requestBlueprintTool(page, "inspect_blueprint", {});
  if (!inspected.ok) throw new Error(inspected.error.message);
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 2; canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, 2, 1);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await stageReply(page, "readFile", { data });
  const result = await requestBlueprintTool(page, "import_image", {
    editorId: inspected.stamp.editorId, projectGeneration: inspected.stamp.projectGeneration,
    layerId: inspected.stamp.activeLayerId, path: "/image.png", width: 2, height: 1, position: { x: 0, y: 0 },
  }, { grantId: "test-grant", path: "/image.png" });
  expect(result.ok).toBe(true);
  expect((await getStoreState<any[][]>(page, "canvasData"))[0].every(cell => cell.colorIndex !== null)).toBe(true);
  await callAction(page, "undo");
  expect((await getStoreState<any[][]>(page, "canvasData"))[0].every(cell => cell.colorIndex === null)).toBe(true);
});

for (const format of ["png", "jpeg"] as const) {
  test(`exports real ${format} bytes without saving the project`, async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [2, 1]);
    await callAction(page, "setCell", [0, 0, 7]);
    const inspected = await requestBlueprintTool(page, "inspect_blueprint", {});
    if (!inspected.ok) throw new Error(inspected.error.message);
    const path = format === "png" ? "/export.png" : "/export.jpg";
    const result = await requestBlueprintTool(page, "export_blueprint", {
      editorId: inspected.stamp.editorId, projectGeneration: inspected.stamp.projectGeneration, path, format, cellSize: 16,
    }, { grantId: "test-grant", path });
    expect(result.ok).toBe(true);
    const writes = await getWrites(page);
    const bytes = Buffer.from(writes.find(write => write.path === path).data, "base64");
    expect([...bytes.subarray(0, 2)]).toEqual(format === "png" ? [137, 80] : [255, 216]);
    expect(await getStoreState(page, "isDirty")).toBe(true);
  });
}

test("Agent editing preserves hand edits and supports one-step Undo", async ({ page }) => {
  await setupPage(page);
  await loadProject(page);
  await callAction(page, "newCanvas", [2, 1]);
  await callAction(page, "setCell", [0, 0, 7]);
  await callAction(page, "setCell", [0, 1, 8]);
  const before = await getStoreState<any[]>(page, "undoStack");
  const pixelsBefore = await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    return [...document.querySelectorAll("canvas")].map(canvas => canvas.toDataURL());
  });
  const inspected = await requestBlueprintTool(page, "inspect_blueprint", {});
  expect(inspected.ok).toBe(true);
  if (!inspected.ok) throw new Error(inspected.error.message);
  const changed = await requestBlueprintTool(page, "set_beads", {
    editorId: inspected.stamp.editorId, projectGeneration: inspected.stamp.projectGeneration,
    expectedRevision: inspected.stamp.revision, layerId: inspected.stamp.activeLayerId,
    beads: [{ x: 1, y: 0, color: null }],
  });
  expect(changed.ok).toBe(true);
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll("canvas")].map(canvas => canvas.toDataURL())))
    .not.toEqual(pixelsBefore);
  expect((await getStoreState<any[]>(page, "undoStack")).length).toBe(before.length + 1);
  expect((await getStoreState<any[][]>(page, "canvasData"))[0].map(cell => cell.colorIndex)).toEqual([7, null]);
  await callAction(page, "undo");
  expect((await getStoreState<any[][]>(page, "canvasData"))[0].map(cell => cell.colorIndex)).toEqual([7, 8]);
  await callAction(page, "redo");
  expect((await getStoreState<any[][]>(page, "canvasData"))[0].map(cell => cell.colorIndex)).toEqual([7, null]);
  expect(await getStoreState(page, "isDirty")).toBe(true);
});

test("a stale tool request does not overwrite a newer hand edit", async ({ page }) => {
  await setupPage(page);
  await loadProject(page);
  const inspected = await requestBlueprintTool(page, "inspect_blueprint", {});
  if (!inspected.ok) throw new Error(inspected.error.message);
  await callAction(page, "setCell", [0, 0, 7]);
  const before = await getStoreState(page, "canvasData");
  const changed = await requestBlueprintTool(page, "set_beads", {
    editorId: inspected.stamp.editorId, projectGeneration: inspected.stamp.projectGeneration,
    expectedRevision: inspected.stamp.revision, layerId: inspected.stamp.activeLayerId,
    beads: [{ x: 0, y: 0, color: null }],
  });
  expect(changed).toMatchObject({ ok: false, error: { code: "stale_revision" } });
  expect(await getStoreState(page, "canvasData")).toEqual(before);
});