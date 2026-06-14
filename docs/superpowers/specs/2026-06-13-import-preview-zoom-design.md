# Import Preview Zoom — Design

**Date**: 2026-06-13
**Status**: Draft, awaiting user review
**Scope**: Make the top preview area of the image-import dialog zoomable (display-only, button-controlled) so users can more precisely drag a region for color correction (and crop).

---

## Problem

In the import dialog (`src/components/Import/ImageImportDialog.tsx`) the top preview canvas renders a downscaled preview of the source image (capped at 400×400 px by `preview_image` in Rust and the VS Code adapter). For the color-correction "sample" flow, the user drags a rectangle on this preview to sample a region's mean RGB. When the area that should be sampled (e.g. a small patch that ought to be pure white) is small on screen, it's hard to drag a rectangle precisely over just that area. The user wants to zoom in/out on the preview so the target gets bigger on screen and is easier to frame.

## Decisions (already agreed with user)

1. **Display-only zoom**, not higher-resolution re-fetch. Zooming scales the existing 400px preview up on screen; it becomes blocky when enlarged. This is acceptable because color-correction sampling reads the **mean** RGB over the dragged region — pointing precision is what matters, not pixel sharpness. (User explicitly chose "放大框选 / 显示缩放" over "重新取高清".)
2. **Button control**: a `−  100%  +` control that steps through discrete zoom levels. (User chose buttons over mouse-wheel.)
3. **Scope to the crop tool only**. The zoom control appears only while `interactionMode === "crop"`. That mode also covers the calibration sample sub-mode (`previewMode === "sample"`), which is the actual color-correction picking flow. The "放大镜" (loupe) tool keeps its existing two-column magnifier layout untouched, to avoid layout conflict and reduce risk.
4. **No persistence**: zoom is per-session UI state, reset to 1× when a new file is selected. Not stored in `.pindou` or localStorage.

## Why no other code needs to change

The existing pointer math already adapts to whatever size the canvas is rendered at:

```ts
const rect = canvas.getBoundingClientRect();
const displayScale = canvas.width / rect.width;  // intrinsic px per rendered px
```

`canvas.width` stays at `preview_width` (intrinsic preview resolution); `rect.width` becomes the zoomed display width. So `mouseToPreview` / `mouseToOriginal` map client coordinates → intrinsic preview/original coordinates correctly at any zoom. `getBoundingClientRect()` returns viewport-relative coordinates that already account for scroll offset, and `e.clientX` is viewport-relative, so `e.clientX - rect.left` stays correct even when the preview is scrolled inside its container.

All overlays (pixel grid, crop rectangle + handles, loupe indicator, calibration markers, live sample rectangle) are drawn in **intrinsic preview pixel coordinates** on the canvas, so they scale with the canvas's CSS size automatically. No drawing code changes.

## Implementation

All changes are confined to `src/components/Import/ImageImportDialog.tsx`. No adapter, Rust, or store changes.

### 1. New state

```ts
const [previewZoom, setPreviewZoom] = useState(1); // discrete levels
const ZOOM_LEVELS = [1, 2, 3, 4, 6];
```

### 2. Scrollable container around the crop canvas

Today the canvas sits directly inside:

```
<div className="border rounded p-2 bg-gray-50">
  <div className="flex gap-2">
    <canvas ref={cropCanvasRef} ... style={{ width: ..., height: ... }} />
    {/* loupe panel, only in loupe mode */}
  </div>
```

Define the base (1×) display size — the current computed value:

```ts
const baseCanvasW = Math.min(interactionMode === "loupe" ? 340 : 520, imagePreview.preview_width);
const baseCanvasH = Math.min(interactionMode === "loupe" ? 340 : 520, imagePreview.preview_height);
```

Wrap the canvas in an `overflow-auto` box whose max dimensions equal the base size, and scale the canvas style by zoom:

```
<div style={{ maxWidth: baseCanvasW, maxHeight: baseCanvasH, overflow: "auto" }}>
  <canvas ... style={{ width: baseCanvasW * previewZoom, height: baseCanvasH * previewZoom }} />
</div>
```

- At `previewZoom === 1` the canvas exactly fills the box → no scrollbars, visually identical to today (no regression).
- At `previewZoom > 1` the canvas overflows → the box shows scrollbars; the user pans to reach any region.

Zoom only applies in crop mode; in loupe mode the canvas keeps its current fixed rendering (zoom factor is effectively 1, control hidden — see §3). Implementation note: apply the `* previewZoom` multiplier only when `interactionMode === "crop"` so the loupe layout is byte-for-byte unchanged.

### 3. Zoom control (crop mode only)

In the toolbar row that holds the ✂️裁剪 / 🔍放大镜 / 像素网格 toggles, add — only when `interactionMode === "crop"` — a small control reusing the existing `−/value/+` button styling from the result-preview zoom (around lines 1483–1491):

```
[−]  1x  [+]
```

- `−` → previous level in `ZOOM_LEVELS` (clamped at 1×).
- `+` → next level (clamped at 6×).
- Clicking the zoom label resets to 1×.
- The label shows `${previewZoom}x` (e.g. `1x`, `2x`), matching the existing result-preview control's `{previewScale}x` label for consistency.

### 4. Reset on file change

In `handleSelectFile`, alongside the existing resets (`setCropRect(null)`, etc.), add `setPreviewZoom(1)`.

## Edge cases

- **No image loaded**: the preview block (and thus the zoom control) is not rendered — unchanged.
- **Switching to loupe mode while zoomed in**: the zoom multiplier is not applied in loupe mode, so the loupe view renders at its normal fixed size; switching back to crop restores the previous `previewZoom`. (State is preserved; only its visual effect is gated by mode.)
- **Dragging a crop/sample rectangle to the container edge**: no auto-scroll (v1 limitation). The user releases, scrolls, and continues. Documented, acceptable.
- **Very small preview (e.g. a tiny source image)**: `baseCanvasW/H` already clamps to `preview_width/height`; zooming still multiplies that, which is the desired "make small things bigger" behavior.

## Testing

### Playwright (webview suite, `platforms/vscode/tests/import.spec.ts`)

The zoom is pure display state with no store action, so most assertions are DOM/style-based. Add a focused test that:

1. Loads the dialog with a mocked image preview (follow the existing import-spec setup).
2. Asserts the zoom control renders in crop mode and not in loupe mode.
3. Clicks `+` and asserts the preview canvas's rendered `style.width` increases by the expected factor; clicks `−`/reset and asserts it returns to base.

If driving the real preview pipeline in the webview test harness is impractical (the preview depends on adapter image decoding), fall back to a manual smoke test documented in the plan and keep the Playwright test limited to whatever the harness can mount. Do not synthesize canvas pointer events.

### No unit tests

No new pure functions are introduced; zoom is local component state.

## Files

**Modified:**
- `src/components/Import/ImageImportDialog.tsx`
  - New `previewZoom` state + `ZOOM_LEVELS` constant
  - `overflow-auto` wrapper around the crop canvas with zoom-scaled canvas style (crop mode only)
  - `−/value/+` zoom control in the toolbar row (crop mode only)
  - `setPreviewZoom(1)` in `handleSelectFile`

**Possibly added:**
- A Playwright assertion in `platforms/vscode/tests/import.spec.ts` (extent depends on what the harness can mount)

No adapter changes, no Rust changes, no store changes.

## Risks / Trade-offs

- **Blocky enlargement**: enlarging a 400px preview shows visible pixel blocks. Accepted per the user's chosen approach; mean-based sampling is unaffected.
- **No drag-edge auto-scroll**: minor ergonomic gap, deferred.
- **Mode-gated zoom effect**: gating the multiplier on crop mode keeps the loupe layout untouched but means the same `previewZoom` value renders differently per mode. This is intentional and the simplest way to avoid regressing the loupe's fixed two-column layout.

## Out of Scope

- Mouse-wheel zoom
- Higher-resolution / re-fetched preview tiles
- Zoom inside the loupe tool
- Auto-scroll while dragging a selection to the container edge
- Persisting zoom level across sessions or in `.pindou`
- Zoom on the lower matched-result preview (already has its own `previewScale` control)
