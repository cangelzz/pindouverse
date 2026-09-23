import { test, expect, type Page } from "@playwright/test";
import { setupPage, loadProject, callAction, getStoreState, cleanupHarness } from "./helpers";
import { SaveHandoffCoordinator, type SavedBlueprint } from "../src/saveHandoff";
import type { EditorSessionSnapshot } from "../../../src/types";
import type { EditorStamp } from "../../../src/blueprint/toolContract";

async function control(page: Page, type: string, data: Record<string, unknown> = {}): Promise<any> {
  const handoffId = `handoff:test:${Date.now()}:${Math.random()}`;
  await page.evaluate(message => window.dispatchEvent(new MessageEvent("message", { data: message })), { type, handoffId, ownerId: "handoff:test", ...data });
  await page.waitForFunction(({ handoffId, type }) => (window as any)._messages.some((message: any) => message.handoffId === handoffId && message.type === `${type}Result`), { handoffId, type }, { timeout: 5000 });
  const response = await page.evaluate(id => (window as any)._messages.find((message: any) => message.handoffId === id), handoffId);
  if (response.error) throw new Error(response.error);
  return response.value;
}

test.afterAll(() => cleanupHarness());

test("Save As transfers newer live content and history after writing an older snapshot", async ({ page: source, context }) => {
  await setupPage(source);
  await loadProject(source);
  await callAction(source, "newCanvas", [2, 1]);
  await callAction(source, "setCell", [0, 0, 7]);
  const destination = await context.newPage();
  await setupPage(destination);
  await loadProject(destination);
  let written: SavedBlueprint | undefined;
  const coordinator = new SaveHandoffCoordinator({
    selectDestination: async () => "/saved.pindou",
    capture: async () => control(source, "blueprintCaptureForSave"),
    write: async (_path, saved) => {
      written = saved;
      await callAction(source, "setCell", [0, 1, 8]);
    },
    lock: async () => control(source, "blueprintAcquireSession") as Promise<EditorSessionSnapshot>,
    restore: async (path, snapshot, saved) => control(destination, "blueprintRestoreSession", { path, snapshot, saved }) as Promise<EditorStamp>,
    finalize: async saved => { await control(source, "blueprintFinalizeSave", { saved, inPlace: false }); },
    enable: async () => { await control(destination, "blueprintEnableSession"); },
    disposeSource: () => { void source.close(); },
    abortDestination: async () => { await destination.close(); },
    releaseSource: async () => { if (!source.isClosed()) await control(source, "blueprintReleaseSession"); },
  });
  const result = await coordinator.run(new AbortController().signal);
  expect(result.ok).toBe(true);
  expect(written!.project.canvasData[0].map(cell => cell.colorIndex)).toEqual([7, null]);
  expect((await getStoreState<any[][]>(destination, "canvasData"))[0].map(cell => cell.colorIndex)).toEqual([7, 8]);
  expect(await getStoreState(destination, "isDirty")).toBe(true);
  await callAction(destination, "undo");
  expect((await getStoreState<any[][]>(destination, "canvasData"))[0].map(cell => cell.colorIndex)).toEqual([7, null]);
  await callAction(destination, "redo");
  expect((await getStoreState<any[][]>(destination, "canvasData"))[0].map(cell => cell.colorIndex)).toEqual([7, 8]);
  await destination.close();
});