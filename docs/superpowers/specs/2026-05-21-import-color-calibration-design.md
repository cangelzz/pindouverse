# Import Color Calibration — Design

**Date**: 2026-05-21
**Status**: Draft, awaiting user review
**Scope**: Add a multi-point color-calibration step to the image-import dialog that lets users correct color cast before MARD quantization.

---

## Problem

Source PNGs sometimes have a color cast (a uniform tint that makes white pixels read as slight blue / slight gray / etc.). The current quantizer faithfully maps each pixel to the nearest MARD color, so a slightly-blue white becomes `D16 light blue` instead of `H2 white`. The user wants a way to tell the software "this region should be H2", have the software compute the correction, and re-quantize.

## Decisions (already agreed with user)

1. **Correction math**: per-channel affine transform `out = a*in + b`. User picks one of three modes:
   - **Additive** — `a=1, b=target−sample` (fixes uniform tint)
   - **Multiplicative** — `a=target/sample, b=0` (white-balance style; fixes color-temperature drift)
   - **Affine** — both, fit via least squares (most flexible)
2. **Sampling**: drag rectangle on the preview, mean RGB of all pixels inside. Single-pixel click is just a 1×1 region — same code path.
3. **Target color**: picked from the MARD palette (the existing groups in `COLOR_GROUPS`).
4. **Multiple reference points**: user can add as many as they like. With ≥2 points, the affine mode solves a real least-squares fit per channel.
5. **No persistence**: calibration is per-import only. Not stored in `.pindou`, not in localStorage.
6. **Apply order**: source pixels → calibrate → resize → quantize is the conceptual model. In the current adapter pipeline, "resize" already happened by the time the dialog has `rawPixels` (the post-resize, pre-quantize array at the target cell resolution). Calibration is applied to that `rawPixels` directly. Sampling reads from `imagePreview.pixels` (the ~400-px preview); since the color cast is uniform across resolutions, the sampled mean is valid for the smaller `rawPixels` too.
7. **Live preview**: every change to settings recomputes coefficients, applies them, re-quantizes, updates the matched preview.

## Algorithm

For each color channel c ∈ {R, G, B}:

Given N pairs `(s_i, t_i)` of sampled-channel-value and target-channel-value:

- **N = 0** → identity (`a=1, b=0`), used when calibration is disabled or no points yet.
- **N = 1, additive** → `a=1, b=t-s`
- **N = 1, multiplicative** → if `s ≠ 0`: `a=t/s, b=0`; else identity
- **N = 1, affine** → under-determined; fall back to multiplicative
- **N ≥ 2, additive** → `a=1, b=mean(t_i − s_i)`
- **N ≥ 2, multiplicative** → `a = Σ(s_i·t_i) / Σ(s_i²), b=0`; if denominator = 0: identity
- **N ≥ 2, affine** → standard least squares:
  - Let `S = Σs_i, T = Σt_i, SS = Σs_i², ST = Σ(s_i·t_i)`
  - `a = (N·ST − S·T) / (N·SS − S²)`
  - `b = (T − a·S) / N`
  - If `N·SS − S² ≈ 0` (all samples identical): fall back to multiplicative

Apply per-pixel: `out[i,c] = clamp(round(a_c · in[i,c] + b_c), 0, 255)`.

Sanity check after compute: any NaN / Inf coefficient is reset to identity for that channel.

## Data Model

```ts
// src/utils/colorCalibration.ts
export type CalibrationMode = "additive" | "multiplicative" | "affine";

export interface CalibrationPoint {
  id: string;                                           // crypto.randomUUID() for React keys
  region: { x: number; y: number; w: number; h: number }; // px in imagePreview coordinates
  sampledRgb: [number, number, number];                 // mean RGB sampled from imagePreview.pixels
  targetColorIndex: number;                             // index into MARD_COLORS
}

export interface CalibrationSettings {
  enabled: boolean;        // master toggle. When false → identity even if points exist
  mode: CalibrationMode;   // default: "multiplicative"
  points: CalibrationPoint[];
}

export interface CalibrationCoefficients {
  a: [number, number, number];   // per-channel multiplier
  b: [number, number, number];   // per-channel offset
}
```

Defaults: `{ enabled: false, mode: "multiplicative", points: [] }`.

## Public API (`src/utils/colorCalibration.ts`)

```ts
export function computeCoefficients(
  pairs: { sample: [number, number, number]; target: [number, number, number] }[],
  mode: CalibrationMode,
): CalibrationCoefficients;

export function applyCalibration(
  pixels: Uint8Array | number[],
  coef: CalibrationCoefficients,
): number[];

export function sampleRegionMean(
  pixels: Uint8Array | number[],
  imageWidth: number,
  region: { x: number; y: number; w: number; h: number },
): [number, number, number];

export const IDENTITY_COEFFICIENTS: CalibrationCoefficients;
```

All four functions are pure and side-effect-free. `applyCalibration` returns a new array (doesn't mutate input).

## UI Integration — `ImageImportDialog.tsx`

### New collapsible panel "色彩校正"

Placement: between the crop selector and the algorithm-comparison section. Default collapsed. Header has a small enable-toggle on the right.

```
▼ 色彩校正          [☐ 启用]
  模式:  (●加法  ○乘法  ○混合)
  
  参考点 (在预览图上拖矩形 → 选 MARD 色):
  ┌──────────────────────────────────────┐
  │ ■ (200,210,225) → ■ H2 白色  [删]   │
  │ ■ (50,55,52)    → ■ H9 黑色  [删]   │
  └──────────────────────────────────────┘
  [+ 添加参考点]
  
  系数: R 1.02 +5, G 1.00 +2, B 0.98 −3
```

### Preview-image dual mode

Today the preview accepts mouse drag for the crop rectangle. Add a `previewMode: "crop" | "sample"` state:

- Default `"crop"` — drag modifies `cropRect`. Cursor: standard.
- When user clicks "+ 添加参考点" → switch to `"sample"`. Cursor: crosshair. Next drag's rectangle becomes the sample region.
- When sample drag ends → open a small MARD-color picker modal showing the sampled mean alongside MARD palette. User picks a target color. The new point is appended to `calibration.points`. Mode resets to `"crop"`.
- ESC key while in `"sample"` mode cancels the operation and resets to `"crop"`.

### MARD color picker

The picker should already exist conceptually — `COLOR_GROUPS` from `src/data/mard221.ts` is the source of truth, and `getEffectiveHex(index, overrides)` resolves to a display color. If a reusable small `<MardColorPicker onSelect={...} />` does not exist, build a minimal grid-style picker inline in the dialog: rows of color swatches grouped by color group, each clickable.

### Re-quantize flow

Wherever the matched preview is computed (look for the `useEffect` that invokes `matchImageToMard`), wrap the input pixels:

```ts
const coef = calibration.enabled && calibration.points.length > 0
  ? computeCoefficients(
      calibration.points.map((p) => ({
        sample: p.sampledRgb,
        target: mardRgbAt(p.targetColorIndex),  // helper: pulls .rgb from MARD_COLORS
      })),
      calibration.mode,
    )
  : IDENTITY_COEFFICIENTS;
const calibrated = calibration.enabled && calibration.points.length > 0
  ? applyCalibration(rawPixels, coef)
  : rawPixels;
const matched = matchImageToMard(calibrated, algorithm, groupId, colorOverrides);
```

`rawPixels` is never mutated — the calibration runs against a fresh source every time the user changes settings, so they can freely add/remove points and switch modes.

## Edge cases

- **No image loaded yet**: panel still renders but "+ 添加参考点" is disabled.
- **Region drag of 0×0 area**: ignore, no point added.
- **Sample region partially outside image bounds**: clamp to image rect before computing mean.
- **All sampled values identical across reference points**: affine mode degenerates; the implementation already falls back to multiplicative or identity per channel.
- **User toggles `enabled` off**: preview reverts to un-calibrated quantization immediately. Points and mode are preserved (so re-enabling restores them).
- **Image changes (user picks a different file)**: clear `calibration.points` (they refer to coordinates / pixels in the previous image).

## Testing

### Vitest unit tests — `src/utils/colorCalibration.test.ts`

Cover:
- `computeCoefficients` identity (N=0)
- N=1 in each of the three modes; assert exact coefficients
- N=1 affine → falls back to multiplicative
- N≥2 least-squares accuracy (use known linear data, assert ε-close)
- All-identical-samples degeneracy → identity (per channel)
- NaN / Inf guard
- `applyCalibration` identity returns same values
- `applyCalibration` non-identity clamps to [0,255]
- `sampleRegionMean` single-pixel, multi-pixel, region clamped to bounds, empty region

### No new Playwright tests

The existing import dialog has no Playwright coverage beyond the broader `import.spec.ts`. The new behavior is verified by manual smoke test (see plan).

## Files

**New:**
- `src/utils/colorCalibration.ts` — pure helpers (computeCoefficients, applyCalibration, sampleRegionMean, IDENTITY_COEFFICIENTS)
- `src/utils/colorCalibration.test.ts` — Vitest unit coverage

**Modified:**
- `src/components/Import/ImageImportDialog.tsx`:
  - New `calibration` state object
  - New `previewMode` state
  - New "色彩校正" collapsible panel
  - Dual-mode preview interaction (sample drag handler in addition to crop drag)
  - MARD picker sub-dialog
  - Re-quantize useEffect uses calibrated pixels

No store changes (calibration is not persisted). No adapter changes. No Rust changes.

## Risks / Trade-offs

- **RGB vs LAB calibration**: chose RGB for simplicity. The current quantizer can use either RGB or LAB internally; the calibration step runs in RGB before quantize regardless. For "uniform tint" use case (the user's reported problem) RGB is fine. If users later report inability to fix perceptual issues, we can add a LAB mode without disrupting the public API.
- **Per-channel affine**: doesn't model cross-channel mixing (e.g., a color shift where R partially becomes G). A full 3×3 matrix would handle that. Skipped because the user case is single-direction tint, not channel mixing.
- **No persistence**: users who want to apply the same correction to many images need to re-do the work. Acceptable for v1; a future "save calibration preset" feature can be added.

## Out of Scope

- Per-image calibration preset / save & load
- LAB-space correction
- Full 3×3 color matrix
- Real-time histogram visualization
- Auto white-balance (no reference point — just compute from image statistics)
- Calibration on already-imported canvases (out of the import dialog)
