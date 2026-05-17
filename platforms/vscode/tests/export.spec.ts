import { test, expect } from "@playwright/test";
import {
  setupPage,
  loadProject,
  cleanupHarness,
  stageReply,
  getWrites,
  callAction,
  clearMessages,
} from "./helpers";

async function openExportDialog(page: import("@playwright/test").Page) {
  await page
    .getByRole("button", { name: "导出" })
    .filter({ hasNot: page.locator("[disabled]") })
    .first()
    .click();
  await page
    .getByRole("heading", { name: "导出高分辨率图片" })
    .waitFor({ timeout: 5_000 });
}

function decodeBase64Header(b64: string): number[] {
  const bin = Buffer.from(b64, "base64");
  return [bin[0], bin[1], bin[2], bin[3]];
}

test.describe("Export", () => {
  test.afterAll(() => cleanupHarness());

  test("export blueprint PNG → writeFile called with PNG bytes", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await openExportDialog(page);

    // The dialog needs a save path
    await stageReply(page, "showSaveDialog", "/out/test.png");

    await clearMessages(page);
    // Capture the success alert so it doesn't linger past the test boundary
    const alertDismissed = page.waitForEvent("dialog").then((d) => d.accept());
    // Click the dialog's 导出 button (the only one inside the modal that's enabled)
    await page.getByRole("button", { name: /^导出$/ }).last().click();

    await page.waitForFunction(
      () => (window as any)._writes.some((w: any) => w.kind === "writeFile"),
      null,
      { timeout: 10_000 }
    );

    const writes = await getWrites(page);
    const fileWrite = writes.find((w: any) => w.kind === "writeFile" && w.path === "/out/test.png");
    expect(fileWrite).toBeTruthy();

    const header = decodeBase64Header(fileWrite.data);
    expect(header).toEqual([0x89, 0x50, 0x4e, 0x47]); // PNG signature
    await alertDismissed;
  });

  test("watermark section: header checkbox visible and toggles", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await openExportDialog(page);

    const headerToggle = page.getByLabel(/顶部应用标题/);
    await expect(headerToggle).toBeVisible();
    await expect(headerToggle).toBeChecked();

    await headerToggle.uncheck();
    await expect(headerToggle).not.toBeChecked();

    await headerToggle.check();
    await expect(page.getByPlaceholder(/犬夜叉桔梗/)).toBeVisible();
  });

  test("watermark section: empty-author hint shows when author missing", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await openExportDialog(page);

    // The hint appears when resolvedAuthor is empty (sample has no author)
    const hint = page.getByText("未设置作者名，将不绘制作者水印");
    await expect(hint).toBeVisible();
  });

  test("watermark settings persist across dialog reopens", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await openExportDialog(page);

    // Set non-default values
    await page.getByLabel(/顶部应用标题/).uncheck();
    await page.getByLabel(/PindouVerse 水印/).check();

    // Trigger export so saveWatermarkSettings is called (persists to localStorage)
    await stageReply(page, "showSaveDialog", "/out/persist-test.png");
    await clearMessages(page);
    // Capture the success alert before clicking so it resolves within the test
    const alertDismissed = page.waitForEvent("dialog").then((d) => d.accept());
    await page.getByRole("button", { name: /^导出$/ }).last().click();
    await page.waitForFunction(
      () => (window as any)._writes.some((w: any) => w.kind === "writeFile"),
      null,
      { timeout: 10_000 }
    );
    await alertDismissed;

    // Wait for the dialog to close (onClose is called after alert)
    await page
      .getByRole("heading", { name: "导出高分辨率图片" })
      .waitFor({ state: "hidden", timeout: 5_000 });

    // Reopen the export dialog — settings should be loaded from localStorage
    await openExportDialog(page);

    await expect(page.getByLabel(/顶部应用标题/)).not.toBeChecked();
    await expect(page.getByLabel(/PindouVerse 水印/)).toBeChecked();
  });

  test("default export with header band produces PNG with expected dimensions", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await openExportDialog(page);

    // Explicitly ensure the header toggle is ON, regardless of localStorage state
    // from a previous test (file:// origin shares localStorage across all tests).
    await page.getByLabel(/顶部应用标题/).check();

    // Default settings: showHeader=true (header is 2*cellSize tall)
    await stageReply(page, "showSaveDialog", "/out/test.png");
    await clearMessages(page);
    const alertDismissed = page.waitForEvent("dialog").then((d) => d.accept());
    await page.getByRole("button", { name: /^导出$/ }).last().click();

    await page.waitForFunction(
      () => (window as any)._writes.some((w: any) => w.kind === "writeFile"),
      null,
      { timeout: 10_000 }
    );

    const writes = await getWrites(page);
    const pngWrite = writes.find((w: any) => w.kind === "writeFile" && /\.png$/i.test(w.path));
    expect(pngWrite).toBeTruthy();
    expect(decodeBase64Header(pngWrite.data)).toEqual([0x89, 0x50, 0x4e, 0x47]);

    // Decode the PNG IHDR to extract width and height. PNG layout:
    //   8-byte signature | 4-byte length | 4-byte "IHDR" | 4-byte width | 4-byte height | ...
    // → width starts at byte 16, height at byte 20 (big-endian u32 each)
    const bin = Buffer.from(pngWrite.data, "base64");
    const width = bin.readUInt32BE(16);
    const height = bin.readUInt32BE(20);

    // The header band adds 2*cellSize. The dialog defaults to cellSize=30.
    // The grid is the loaded sample's canvas — we don't know its exact dims,
    // but we know the height must exceed (canvasHeight*30 + legend) by exactly 60.
    // Compare against a no-header export by disabling the header.
    await alertDismissed;

    // Now uncheck the header and export again to compare.
    await openExportDialog(page);
    await page.getByLabel(/顶部应用标题/).uncheck();
    await stageReply(page, "showSaveDialog", "/out/test-no-header.png");
    await clearMessages(page);
    const alertDismissed2 = page.waitForEvent("dialog").then((d) => d.accept());
    await page.getByRole("button", { name: /^导出$/ }).last().click();

    await page.waitForFunction(
      () => (window as any)._writes.some((w: any) => w.kind === "writeFile" && /no-header/.test(w.path)),
      null,
      { timeout: 10_000 }
    );

    const writes2 = await getWrites(page);
    const noHeaderWrite = writes2.find((w: any) => w.kind === "writeFile" && /no-header/.test(w.path));
    expect(noHeaderWrite).toBeTruthy();
    const bin2 = Buffer.from(noHeaderWrite.data, "base64");
    const widthNoHeader = bin2.readUInt32BE(16);
    const heightNoHeader = bin2.readUInt32BE(20);

    // Width must be identical (header doesn't change horizontal layout)
    expect(width).toBe(widthNoHeader);
    // Height with header must be larger by exactly 60 (= 2 * default cellSize 30)
    expect(height - heightNoHeader).toBe(60);
    await alertDismissed2;
  });

  test("export with cancelled save dialog → no writeFile", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await openExportDialog(page);

    await stageReply(page, "showSaveDialog", null);
    await clearMessages(page);
    await page.getByRole("button", { name: /^导出$/ }).last().click();
    await page.waitForTimeout(500);

    const writes = await getWrites(page);
    expect(writes.find((w: any) => w.kind === "writeFile")).toBeFalsy();
  });

  test("export with mirror also writes a mirrored file", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await openExportDialog(page);

    // Enable mirror checkbox
    await page.getByLabel(/同时导出左右镜像/).check();
    await stageReply(page, "showSaveDialog", "/out/test.png");
    // Mirror file is written without a separate dialog (path derived from base)
    await clearMessages(page);
    // Capture the success alert so it doesn't linger past the test boundary
    const alertDismissed = page.waitForEvent("dialog").then((d) => d.accept());

    await page.getByRole("button", { name: /^导出$/ }).last().click();
    await page.waitForFunction(
      () => (window as any)._writes.filter((w: any) => w.kind === "writeFile").length >= 2,
      null,
      { timeout: 15_000 }
    );

    const writes = await getWrites(page);
    const fileWrites = writes.filter((w: any) => w.kind === "writeFile");
    expect(fileWrites.length).toBeGreaterThanOrEqual(2);

    // Both should be PNG
    for (const w of fileWrites) {
      const header = decodeBase64Header(w.data);
      expect(header).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }
    // Mirror filename should differ from the original
    const paths = fileWrites.map((w: any) => w.path);
    expect(new Set(paths).size).toBe(paths.length);
    await alertDismissed;
  });

  test("export preview JPG → writeFile called with JPEG bytes", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await openExportDialog(page);

    // Switch off blueprint, on preview (preview-only path uses its own save dialog)
    await page.getByLabel(/图纸（带网格线/).uncheck();
    await page.getByLabel(/效果图（模拟/).check();

    await stageReply(page, "showSaveDialog", "/out/test_preview.jpg");

    await clearMessages(page);
    // Capture the success alert so it doesn't linger past the test boundary
    const alertDismissed = page.waitForEvent("dialog").then((d) => d.accept());
    await page.getByRole("button", { name: /^导出$/ }).last().click();

    await page.waitForFunction(
      () => (window as any)._writes.some((w: any) => w.kind === "writeFile"),
      null,
      { timeout: 10_000 }
    );

    const writes = await getWrites(page);
    const previewWrite = writes.find(
      (w: any) => w.kind === "writeFile" && /\.jpe?g$/i.test(w.path)
    );
    expect(previewWrite).toBeTruthy();
    const header = decodeBase64Header(previewWrite.data);
    expect(header.slice(0, 3)).toEqual([0xff, 0xd8, 0xff]); // JPEG SOI
    await alertDismissed;
  });
});
