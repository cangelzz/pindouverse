import { test, expect } from "@playwright/test";
import {
  setupPage,
  loadProject,
  cleanupHarness,
  stageReply,
  clearMessages,
  getMessages,
  getStoreState,
  callAction,
} from "./helpers";

// Regression: prior to this fix, listSnapshots() returned [] and
// deleteSnapshot() threw "not yet supported". The 版本管理 dialog was
// effectively dead in the VS Code extension. These tests verify the
// host bridge is wired and round-trips the right data.

test.describe("Snapshot list & delete", () => {
  test.afterAll(() => cleanupHarness());

  test("loadSnapshots: adapter asks host for the autosave dir, then for the listing", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    const fakeDir = "/fake/autosave/.pindou_autosave";
    const fakeList = [
      { path: `${fakeDir}/snapshot_2_b.pindou`, name: "snapshot_2_b", modified: "2026-05-29 10:00:00" },
      { path: `${fakeDir}/snapshot_1_a.pindou`, name: "snapshot_1_a", modified: "2026-05-28 09:00:00" },
    ];
    await stageReply(page, "getAutosaveDir", fakeDir);
    await stageReply(page, "listSnapshots", fakeList);

    await clearMessages(page);
    await callAction(page, "loadSnapshots");

    const messages = await getMessages(page);
    const dirReq = messages.find((m: any) => m.type === "getAutosaveDir");
    const listReq = messages.find((m: any) => m.type === "listSnapshots");

    expect(dirReq).toBeTruthy();
    expect(listReq).toBeTruthy();
    expect(listReq.dir).toBe(fakeDir);

    const snapshots = await getStoreState<any[]>(page, "snapshots");
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].name).toBe("snapshot_2_b");
    expect(snapshots[1].name).toBe("snapshot_1_a");
  });

  test("loadSnapshots: empty list yields empty array (not stuck pending)", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    await stageReply(page, "getAutosaveDir", "/fake/empty/.pindou_autosave");
    // No listSnapshots stage → helper defaults to []

    await callAction(page, "loadSnapshots");
    const snapshots = await getStoreState<any[]>(page, "snapshots");
    expect(snapshots).toEqual([]);
  });

  test("deleteSnapshot: sends deleteSnapshot to host with the given path and refreshes the list", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    const targetPath = "/fake/autosave/.pindou_autosave/snapshot_doomed.pindou";

    // After delete, the store calls loadSnapshots() → getAutosaveDir + listSnapshots.
    await stageReply(page, "getAutosaveDir", "/fake/autosave/.pindou_autosave");
    await stageReply(page, "listSnapshots", []);

    await clearMessages(page);
    await callAction(page, "deleteSnapshot", [targetPath]);

    const messages = await getMessages(page);
    const deleteReq = messages.find((m: any) => m.type === "deleteSnapshot");
    expect(deleteReq).toBeTruthy();
    expect(deleteReq.path).toBe(targetPath);

    // Verify the post-delete refresh fired too.
    expect(messages.find((m: any) => m.type === "listSnapshots")).toBeTruthy();

    const snapshots = await getStoreState<any[]>(page, "snapshots");
    expect(snapshots).toEqual([]);
  });

  test("deleteSnapshot: host error surfaces as a rejected promise", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    await stageReply(page, "deleteSnapshot", { success: false, error: "Refusing to delete: path is outside .pindou_autosave" });

    const err = await page.evaluate(async () => {
      const store = (window as any).__pindouStore;
      try {
        await store.getState().deleteSnapshot("/etc/passwd");
        return null;
      } catch (e: any) {
        return e.message;
      }
    });

    expect(err).toContain("Refusing to delete");
  });
});
