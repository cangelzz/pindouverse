import { test, expect } from "@playwright/test";
import {
  setupPage,
  loadProject,
  cleanupHarness,
  setStoreState,
  stageReply,
  clearMessages,
  getMessages,
  getWrites,
} from "./helpers";

test.describe("Snapshot export (另存为)", () => {
  test.afterAll(() => cleanupHarness());

  test("clicking 另存为 writes the snapshot project via writeFile, not saveAs", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    // Seed the store with one synthetic snapshot. The mock harness intercepts
    // adapter.loadSnapshot via the generic ack reply path — but loadSnapshot
    // isn't stubbed in helpers.ts, so we instead stub via stageReply on
    // readFile (the adapter loads snapshots through readFile).
    const fakeProject = {
      version: 2,
      canvasSize: { width: 4, height: 4 },
      canvasData: [
        [{ colorIndex: 1 }, { colorIndex: null }, { colorIndex: null }, { colorIndex: null }],
        [{ colorIndex: null }, { colorIndex: null }, { colorIndex: null }, { colorIndex: null }],
        [{ colorIndex: null }, { colorIndex: null }, { colorIndex: null }, { colorIndex: null }],
        [{ colorIndex: null }, { colorIndex: null }, { colorIndex: null }, { colorIndex: null }],
      ],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const base64 = Buffer.from(JSON.stringify(fakeProject), "utf-8").toString("base64");
    await stageReply(page, "readFile", { data: base64 });

    // Inject a snapshot row into the store so the 版本管理 dialog renders it.
    await setStoreState(page, {
      snapshots: [
        { path: "/fake/.pindou_autosave/snapshot_123_test.pindou", name: "测试快照", modified: "2026-05-28 12:00" },
      ],
    });

    // Open the 版本管理 dialog. The toolbar button is labeled "版本".
    await page.getByRole("button", { name: /^版本$/ }).click();
    await page.getByRole("heading", { name: "版本管理" }).waitFor({ state: "visible" });

    // Stage the showSaveDialog reply (where the user picks the target path).
    const target = "/exported/my-snapshot.pindou";
    await stageReply(page, "showSaveDialog", target);

    await clearMessages(page);

    // Click the 另存为 button in the snapshot row.
    await page.getByRole("button", { name: /^另存为$/ }).click();

    // Wait for the writeFile to land.
    await page.waitForFunction(
      () => (window as any)._writes.some((w: any) => w.kind === "writeFile"),
      null,
      { timeout: 5_000 }
    );

    const messages = await getMessages(page);
    const writeFileMsg = messages.find((m: any) => m.type === "writeFile" && m.path === target);
    const saveAsMsg = messages.find((m: any) => m.type === "saveAs");

    // CRITICAL: export must use writeFile, never saveAs (which would
    // dispose the current panel and swap to the exported file).
    expect(writeFileMsg).toBeTruthy();
    expect(saveAsMsg).toBeFalsy();

    // Verify the exported file content is the snapshot's ProjectFile.
    const writes = await getWrites(page);
    const exportedWrite = writes.find((w: any) => w.kind === "writeFile" && w.path === target);
    expect(exportedWrite).toBeTruthy();
    const decoded = decodeURIComponent(
      escape(Buffer.from(exportedWrite.data, "base64").toString("binary"))
    );
    const exportedProject = JSON.parse(decoded);
    expect(exportedProject.canvasSize).toEqual({ width: 4, height: 4 });
    expect(exportedProject.canvasData[0][0].colorIndex).toBe(1);

    // Dismiss the success modal so the dialog stays clean for any later steps.
    const modal = page.locator("div.fixed.inset-0").filter({ hasText: /确定/ }).last();
    await modal.waitFor({ state: "visible" });
    await modal.getByRole("button", { name: /^确定$/ }).click();
  });

  test("cancel showSaveDialog → no writeFile, no editor change", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    const fakeProject = {
      version: 2,
      canvasSize: { width: 2, height: 2 },
      canvasData: [
        [{ colorIndex: 3 }, { colorIndex: null }],
        [{ colorIndex: null }, { colorIndex: null }],
      ],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const base64 = Buffer.from(JSON.stringify(fakeProject), "utf-8").toString("base64");
    await stageReply(page, "readFile", { data: base64 });

    await setStoreState(page, {
      snapshots: [
        { path: "/fake/.pindou_autosave/snapshot_999_x.pindou", name: "X", modified: "2026-05-28 12:00" },
      ],
    });

    await page.getByRole("button", { name: /^版本$/ }).click();
    await page.getByRole("heading", { name: "版本管理" }).waitFor({ state: "visible" });

    // User cancels the save dialog.
    await stageReply(page, "showSaveDialog", null);

    await clearMessages(page);
    await page.getByRole("button", { name: /^另存为$/ }).click();

    // Wait a brief moment to let any erroneous writes fire.
    await page.waitForTimeout(300);

    const writes = await getWrites(page);
    expect(writes.find((w: any) => w.kind === "writeFile")).toBeFalsy();

    const messages = await getMessages(page);
    expect(messages.find((m: any) => m.type === "saveAs")).toBeFalsy();
  });

  test("local-only hint is visible when 版本管理 dialog opens", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    await page.getByRole("button", { name: /^版本$/ }).click();
    await page.getByRole("heading", { name: "版本管理" }).waitFor({ state: "visible" });

    // The persistent info pill must be visible.
    await expect(
      page.getByText("快照保存在本地应用数据目录，换设备或重装应用会丢失")
    ).toBeVisible();
  });
});
