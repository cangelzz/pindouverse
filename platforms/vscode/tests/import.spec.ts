import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import {
  setupPage,
  loadProject,
  cleanupHarness,
  stageReply,
  clickButton,
  callAction,
  getStoreState,
  FIXTURES_DIR,
} from "./helpers";

const PNG_PATH = path.join(FIXTURES_DIR, "sample-32x32.png");
const PNG_BASE64 = fs.readFileSync(PNG_PATH).toString("base64");

async function openImportDialog(page: import("@playwright/test").Page) {
  await clickButton(page, "导入图片");
  await page.getByRole("heading", { name: "导入图片" }).waitFor({ timeout: 5_000 });
}

test.describe("Image import (regression for 0.8.4)", () => {
  test.afterAll(() => cleanupHarness());

  test("dialog opens", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await openImportDialog(page);
    await expect(page.getByRole("heading", { name: "导入图片" })).toBeVisible();
  });

  test("选择文件 → preview canvas appears + original size shown", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await openImportDialog(page);

    await stageReply(page, "showOpenDialog", "/img.png");
    await stageReply(page, "readFile", { data: PNG_BASE64 });

    await clickButton(page, "选择文件");

    // The "原图: 32×32" label only appears once previewImage resolves
    await expect(page.getByText(/原图:\s*32×32/)).toBeVisible({ timeout: 5_000 });
  });

  test("🔍 自动检测 button appears after preview (regression for 0.8.4)", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await openImportDialog(page);

    // Before any preview: no auto-detect button
    expect(await page.getByRole("button", { name: /自动检测/ }).count()).toBe(0);

    await stageReply(page, "showOpenDialog", "/img.png");
    await stageReply(page, "readFile", { data: PNG_BASE64 });
    await clickButton(page, "选择文件");
    await expect(page.getByText(/原图:\s*32×32/)).toBeVisible({ timeout: 5_000 });

    // After preview: auto-detect button shows up
    await expect(page.getByRole("button", { name: /自动检测/ })).toBeVisible();
  });

  test("预览 button → matched preview rendered (regression for 0.8.4)", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await openImportDialog(page);

    await stageReply(page, "showOpenDialog", "/img.png");
    await stageReply(page, "readFile", { data: PNG_BASE64 });
    await clickButton(page, "选择文件");
    await expect(page.getByText(/原图:\s*32×32/)).toBeVisible({ timeout: 5_000 });

    // Click 预览 — second instance of readFile is needed (importImage path)
    // but our adapter caches the decoded image so no second readFile fires
    await clickButton(page, /^预览$/);

    // "图片尺寸: 32×32" appears once color matching completes
    await expect(page.getByText(/图片尺寸:\s*\d+×\d+/)).toBeVisible({ timeout: 8_000 });
  });

  test("对比多种组合 button → 2 algorithm panels rendered", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await openImportDialog(page);

    await stageReply(page, "showOpenDialog", "/img.png");
    await stageReply(page, "readFile", { data: PNG_BASE64 });
    await clickButton(page, "选择文件");
    await expect(page.getByText(/原图:\s*32×32/)).toBeVisible({ timeout: 5_000 });

    await clickButton(page, "对比多种组合");

    // Both algorithm tabs should be visible (RGB + CIELAB)
    await expect(page.getByRole("button", { name: /^RGB/ })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /^CIELAB/ })).toBeVisible();
  });

  test("对比模式: 拖动最长尺寸滑块自动重算 (无需再点对比)", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await openImportDialog(page);

    await stageReply(page, "showOpenDialog", "/img.png");
    await stageReply(page, "readFile", { data: PNG_BASE64 });
    await clickButton(page, "选择文件");
    await expect(page.getByText(/原图:\s*32×32/)).toBeVisible({ timeout: 5_000 });

    await clickButton(page, "对比多种组合");
    await expect(page.getByRole("button", { name: /^RGB/ })).toBeVisible({ timeout: 10_000 });

    // Source is 32×32; default max dim 52 leaves it at 32×32 (no upscale).
    await expect(page.getByText(/点击选择 \(32×32\)/)).toBeVisible({ timeout: 8_000 });

    // The compare-area max-dimension slider shares state with the controls above.
    // Dropping it below 32 must shrink the output and re-run the compare on its
    // own — without clicking 对比 again.
    await page.getByTestId("compare-maxdim-number").fill("16");

    await expect(page.getByText(/点击选择 \(16×16\)/)).toBeVisible({ timeout: 8_000 });
    // Both algorithm panels are still present after the auto re-compare.
    await expect(page.getByRole("button", { name: /^RGB/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^CIELAB/ })).toBeVisible();
  });

  test("确认导入 → loads matched data into editor", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    const sizeBefore = await getStoreState<{ width: number; height: number }>(page, "canvasSize");
    await openImportDialog(page);

    await stageReply(page, "showOpenDialog", "/img.png");
    await stageReply(page, "readFile", { data: PNG_BASE64 });
    await clickButton(page, "选择文件");
    await expect(page.getByText(/原图:\s*32×32/)).toBeVisible({ timeout: 5_000 });

    await clickButton(page, /^预览$/);
    await expect(page.getByText(/图片尺寸:\s*\d+×\d+/)).toBeVisible({ timeout: 8_000 });

    await clickButton(page, "确认导入");
    // Dialog should close
    await page.getByRole("heading", { name: "导入图片" }).waitFor({ state: "hidden", timeout: 5_000 });

    // Canvas size should reflect the imported image (defaults: max dim 52, image 32x32 → fits as 32x32)
    const sizeAfter = await getStoreState<{ width: number; height: number }>(page, "canvasSize");
    // It should have changed in some way (either size or contents). Easier:
    // canvasData should now have at least some non-null cells from matching.
    const hasContent = await page.evaluate(() => {
      const data = (window as any).__pindouStore.getState().canvasData;
      for (const row of data) for (const cell of row) if (cell.colorIndex != null) return true;
      return false;
    });
    expect(hasContent).toBe(true);
  });

  test("cancel from open dialog → dialog stays empty", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await openImportDialog(page);

    await stageReply(page, "showOpenDialog", null); // cancel
    await clickButton(page, "选择文件");
    await page.waitForTimeout(300);

    // No 原图 label rendered
    expect(await page.getByText(/原图:/).count()).toBe(0);
    // "未选择" label still present
    await expect(page.getByText("未选择")).toBeVisible();
  });

  test("预览缩放: 放大/缩小/重置改变 canvas 显示尺寸, 放大镜模式隐藏控件", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await openImportDialog(page);

    await stageReply(page, "showOpenDialog", "/img.png");
    await stageReply(page, "readFile", { data: PNG_BASE64 });
    await clickButton(page, "选择文件");
    await expect(page.getByText(/原图:\s*32×32/)).toBeVisible({ timeout: 5_000 });

    const cropCanvas = page.getByTestId("crop-canvas");

    // 32×32 source → preview_width 32 → base display 32px at 1x
    const widthAt = async () =>
      cropCanvas.evaluate((el) => parseFloat((el as HTMLElement).style.width));

    const base = await widthAt();
    expect(base).toBe(32);

    // Zoom in once → 2x
    await page.getByTestId("preview-zoom-in").click();
    expect(await widthAt()).toBe(64);

    // Zoom in again → 3x
    await page.getByTestId("preview-zoom-in").click();
    expect(await widthAt()).toBe(96);

    // Reset (click the label) → back to 1x
    await page.getByTestId("preview-zoom-reset").click();
    expect(await widthAt()).toBe(32);

    // Zoom out at 1x stays clamped at 1x
    await page.getByTestId("preview-zoom-out").click();
    expect(await widthAt()).toBe(32);

    // Switching to the loupe tool hides the zoom control
    await clickButton(page, /放大镜/);
    expect(await page.getByTestId("preview-zoom-in").count()).toBe(0);
  });
});
