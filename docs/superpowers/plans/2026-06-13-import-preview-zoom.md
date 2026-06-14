# Import Preview Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add button-controlled display zoom (1x–6x) to the import dialog's top preview canvas so users can precisely frame a region for color-correction sampling and cropping.

**Architecture:** Pure React component state in `ImageImportDialog.tsx`. A `previewZoom` factor multiplies the crop canvas's CSS size; the canvas is wrapped in an `overflow-auto` box sized to the 1x display dimensions so larger zoom levels scroll. Existing pointer math (`displayScale = canvas.width / rect.width`) and all canvas overlays already work in intrinsic preview coordinates, so they adapt to any rendered size with no changes. Zoom is gated to crop mode; the loupe tool's layout is untouched.

**Tech Stack:** React (TypeScript), Vite webview, Playwright webview tests.

---

## File Structure

- **Modify** `src/components/Import/ImageImportDialog.tsx` — the only production file. Adds a module-level `ZOOM_LEVELS` constant, a `previewZoom` state, derived base-size/zoom consts, a scroll wrapper around the crop canvas, a `−/value/+` zoom control in the toolbar row, and a zoom reset on file change. Adds `data-testid` hooks for testing.
- **Modify** `platforms/vscode/tests/import.spec.ts` — adds one Playwright test asserting zoom behavior.

No adapter, Rust, or store changes.

---

## Task 1: Playwright test for preview zoom (red first)

**Files:**
- Test: `platforms/vscode/tests/import.spec.ts` (append a test inside the existing `test.describe` block, before its closing `});` at line 143)

- [ ] **Step 1: Write the failing test**

Append this test as the last test inside the `test.describe("Image import (regression for 0.8.4)", ...)` block (i.e. immediately before the final `});` on line 143):

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `platforms/vscode/`):

```bash
npm run test:webview -- -g "预览缩放"
```

Expected: FAIL — `getByTestId("crop-canvas")` / `preview-zoom-in` resolve to 0 elements (testids and control don't exist yet), so `.click()` / `.evaluate()` time out.

- [ ] **Step 3: Commit the failing test**

```bash
git add platforms/vscode/tests/import.spec.ts
git commit -m "test: add failing import preview zoom test"
```

---

## Task 2: Add zoom state and constants

**Files:**
- Modify: `src/components/Import/ImageImportDialog.tsx`

- [ ] **Step 1: Add the `ZOOM_LEVELS` module constant**

At the top of the file, immediately after the import block (after the `} from "../../utils/colorCalibration";` line that ends the imports, before `export function ImageImportDialog`), add:

```ts
// Discrete zoom levels for the import preview canvas (crop mode only)
const ZOOM_LEVELS = [1, 2, 3, 4, 6];
```

- [ ] **Step 2: Add the `previewZoom` state**

Find the existing grid-related state near the magnifier section:

```ts
  const [showGrid, setShowGrid] = useState(true);
```

Immediately above it, add:

```ts
  // Display zoom for the top preview canvas (crop mode only)
  const [previewZoom, setPreviewZoom] = useState(1);
```

- [ ] **Step 3: Reset zoom when a new file is selected**

In `handleSelectFile`, find the block of resets that runs after a file is picked:

```ts
      setFilePath(selected as string);
      setImagePreview(null);
      setCropRect(null);
      setMatchedPreview(null);
      setActualSize(null);
      setLoupePos(null);
      setCalibration(DEFAULT_CALIBRATION_SETTINGS);
      setPendingCalPoint(null);
      setPreviewMode("crop");
```

Add `setPreviewZoom(1);` as the last line of that block (after `setPreviewMode("crop");`):

```ts
      setPreviewMode("crop");
      setPreviewZoom(1);
```

- [ ] **Step 4: Verify it compiles**

Run (from repo root `Q:/repo/pindou`):

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: PASS (no type errors). `previewZoom` is currently unused-but-assigned; TypeScript permits this for `useState` destructuring. If a linter flags `previewZoom` as unused, that resolves in Task 3/4 where it is consumed — proceed.

- [ ] **Step 5: Commit**

```bash
git add src/components/Import/ImageImportDialog.tsx
git commit -m "feat: add previewZoom state and reset on file change"
```

---

## Task 3: Derived size consts + scroll wrapper around the crop canvas

**Files:**
- Modify: `src/components/Import/ImageImportDialog.tsx`

- [ ] **Step 1: Add derived base-size and zoom-factor consts**

Find the existing derived values just before the `return (` (around the `gridCellSize` / `srcPixelsPerBead` computation):

```ts
  const gridCellSize = getGridCellSize();
  const srcPixelsPerBead = imagePreview
    ? Math.max(
        cropRect?.width ?? imagePreview.original_width,
        cropRect?.height ?? imagePreview.original_height
      ) / maxDimension
    : 0;
```

Immediately after that block, add:

```ts
  // Preview canvas display sizing. Base = current 1x size; zoom only applies in crop mode.
  const loupeMode = interactionMode === "loupe";
  const baseCanvasW = imagePreview
    ? Math.min(loupeMode ? 340 : 520, imagePreview.preview_width)
    : 0;
  const baseCanvasH = imagePreview
    ? Math.min(loupeMode ? 340 : 520, imagePreview.preview_height)
    : 0;
  const zoomFactor = loupeMode ? 1 : previewZoom;
```

- [ ] **Step 2: Wrap the crop canvas in a scroll container and use the derived sizes**

Find the canvas block:

```tsx
              <div className="border rounded p-2 bg-gray-50">
                <div className="flex gap-2">
                  <canvas
                    ref={cropCanvasRef}
                    onMouseDown={handleCanvasMouseDown}
                    onMouseMove={handleCanvasMouseMove}
                    onMouseUp={handleCanvasMouseUp}
                    onMouseLeave={handleCanvasMouseLeave}
                    className={
                      interactionMode === "loupe"
                        ? "cursor-crosshair"
                        : ""
                    }
                    style={{
                      cursor: previewMode === "sample"
                        ? "crosshair"
                        : interactionMode === "crop" ? cropCursor : undefined,
                      width: Math.min(
                        interactionMode === "loupe" ? 340 : 520,
                        imagePreview.preview_width
                      ),
                      height: Math.min(
                        interactionMode === "loupe" ? 340 : 520,
                        imagePreview.preview_height
                      ),
                    }}
                  />
```

Replace it with (wraps the canvas in an `overflow-auto` box and switches the inline size math to the derived consts; adds `data-testid`):

```tsx
              <div className="border rounded p-2 bg-gray-50">
                <div className="flex gap-2">
                  <div
                    style={{
                      maxWidth: baseCanvasW,
                      maxHeight: baseCanvasH,
                      overflow: loupeMode ? "visible" : "auto",
                    }}
                  >
                    <canvas
                      ref={cropCanvasRef}
                      data-testid="crop-canvas"
                      onMouseDown={handleCanvasMouseDown}
                      onMouseMove={handleCanvasMouseMove}
                      onMouseUp={handleCanvasMouseUp}
                      onMouseLeave={handleCanvasMouseLeave}
                      className={
                        interactionMode === "loupe"
                          ? "cursor-crosshair"
                          : ""
                      }
                      style={{
                        cursor: previewMode === "sample"
                          ? "crosshair"
                          : interactionMode === "crop" ? cropCursor : undefined,
                        width: baseCanvasW * zoomFactor,
                        height: baseCanvasH * zoomFactor,
                      }}
                    />
                  </div>
```

Note: a closing `</div>` must be added for the new wrapper. The original `<canvas ... />` was a self-closing sibling of the loupe panel inside `<div className="flex gap-2">`. After this change the structure is: `flex gap-2` → [ wrapper `div` → canvas ] + loupe panel. The wrapper's closing `</div>` is included above (the line after `/>`). Do not remove the loupe panel block that follows (`{/* Zoomed loupe panel */}` ... ). Verify the JSX still balances in Step 3.

- [ ] **Step 3: Verify it compiles and renders**

Run (from repo root):

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: PASS. If tsc reports a JSX nesting / unbalanced-tag error, recount the `</div>` after the canvas — there must be exactly one new wrapper `</div>` between the `<canvas .../>` and the `{/* Zoomed loupe panel */}` comment.

- [ ] **Step 4: Commit**

```bash
git add src/components/Import/ImageImportDialog.tsx
git commit -m "feat: wrap import crop canvas in zoomable scroll container"
```

---

## Task 4: Zoom control buttons in the toolbar row

**Files:**
- Modify: `src/components/Import/ImageImportDialog.tsx`

- [ ] **Step 1: Add the zoom control to the toolbar row**

Find the end of the "Mode & grid toggles" row — the 像素网格 checkbox label followed by the row's closing `</div>`:

```tsx
                <label className="flex items-center gap-1 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showGrid}
                    onChange={(e) => setShowGrid(e.target.checked)}
                    className="w-3 h-3"
                  />
                  像素网格
                </label>
              </div>
```

Insert the zoom control between the closing `</label>` and the closing `</div>` of the row:

```tsx
                  像素网格
                </label>
                {interactionMode === "crop" && (
                  <>
                    <div className="border-l mx-1 h-4" />
                    <span className="text-[10px] text-gray-500">缩放:</span>
                    <button
                      data-testid="preview-zoom-out"
                      onClick={() =>
                        setPreviewZoom((z) =>
                          ZOOM_LEVELS[Math.max(0, ZOOM_LEVELS.indexOf(z) - 1)]
                        )
                      }
                      className="w-5 h-5 text-[10px] border rounded hover:bg-gray-200 flex items-center justify-center"
                      title="缩小"
                    >
                      −
                    </button>
                    <button
                      data-testid="preview-zoom-reset"
                      onClick={() => setPreviewZoom(1)}
                      className="text-[10px] text-gray-500 w-7 text-center hover:text-gray-700"
                      title="重置缩放"
                    >
                      {previewZoom}x
                    </button>
                    <button
                      data-testid="preview-zoom-in"
                      onClick={() =>
                        setPreviewZoom((z) =>
                          ZOOM_LEVELS[
                            Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.indexOf(z) + 1)
                          ]
                        )
                      }
                      className="w-5 h-5 text-[10px] border rounded hover:bg-gray-200 flex items-center justify-center"
                      title="放大"
                    >
                      +
                    </button>
                  </>
                )}
              </div>
```

- [ ] **Step 2: Verify it compiles**

Run (from repo root):

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/Import/ImageImportDialog.tsx
git commit -m "feat: add import preview zoom control buttons"
```

---

## Task 5: Green the test and run the full webview suite

**Files:**
- None (verification only)

- [ ] **Step 1: Build the webview bundle the tests run against**

The webview tests run the built bundle. Build it first (from `platforms/vscode/`):

```bash
npm run build
```

Expected: build succeeds. (If `npm run build` is not the correct webview build script, inspect `platforms/vscode/package.json` `scripts` and run the one that produces the webview bundle the Playwright config loads — `test:webview` may build automatically; in that case this step is a no-op.)

- [ ] **Step 2: Run the zoom test — expect PASS**

Run (from `platforms/vscode/`):

```bash
npm run test:webview -- -g "预览缩放"
```

Expected: PASS (1 passed).

- [ ] **Step 3: Run the full webview suite — guard against regressions**

Run (from `platforms/vscode/`):

```bash
npm run test:webview
```

Expected: all tests pass (the prior 42 plus the new one = 43). Pay special attention to the existing import tests (`选择文件 → preview canvas appears`, `预览 button → matched preview rendered`, `确认导入`) — they exercise the same canvas and must stay green, confirming no regression at 1x.

- [ ] **Step 4: Final commit**

If Step 1 produced build artifacts that are tracked, or if nothing else changed, this may be a no-op. Otherwise:

```bash
git add -A
git commit -m "chore: verify import preview zoom passes webview suite"
```

(Skip if `git status` is clean.)

---

## Self-Review Notes

- **Spec coverage:** display-only zoom (Task 3 size math) ✓; button control `−/value/+` (Task 4) ✓; scoped to crop mode (`interactionMode === "crop"` guards in Tasks 3 & 4) ✓; reset on file change (Task 2 Step 3) ✓; no persistence (state is local, never written) ✓; no adapter/Rust/store changes ✓; loupe layout untouched (`zoomFactor = 1` in loupe mode, control hidden) ✓; Playwright assertion (Task 1) ✓.
- **Type consistency:** `previewZoom: number`, `setPreviewZoom`, `ZOOM_LEVELS: number[]`, `baseCanvasW/baseCanvasH/zoomFactor: number`, `loupeMode: boolean` — names used identically across Tasks 2–4.
- **Reset-via-label:** `preview-zoom-reset` sets `previewZoom` to `1`, and `1` is `ZOOM_LEVELS[0]`, so `−`/`+` stepping via `indexOf` remains valid after a reset.
- **Manual smoke (optional, recommended once):** in the running app, open 导入图片 → 选择文件, click `+` a few times, confirm the preview enlarges and the box scrolls, drag a calibration sample rectangle over a small area to confirm precise framing, switch to 放大镜 and confirm the zoom control disappears and the loupe panel is unchanged.
