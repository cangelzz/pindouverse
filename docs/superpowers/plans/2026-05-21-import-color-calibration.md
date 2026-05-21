# Import Color Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users correct color cast in imported images by sampling N regions, picking target MARD colors, and applying a per-channel affine transform before quantization, with live preview.

**Architecture:** Pure helpers (`src/utils/colorCalibration.ts`) compute per-channel `(a, b)` coefficients via least squares and apply them to the RGB pixel array. The import dialog gains a collapsible "色彩校正" panel, a dual-mode preview (crop vs sample), and an inline MARD color picker. Calibration is per-import only (not persisted); re-quantize is triggered live by a `useEffect` on the calibration state.

**Tech Stack:** TypeScript, React, Vitest, Canvas 2D (existing preview rendering).

---

## File Structure

**Created:**
- `src/utils/colorCalibration.ts` — pure helpers (`computeCoefficients`, `applyCalibration`, `sampleRegionMean`, `IDENTITY_COEFFICIENTS`, types)
- `src/utils/colorCalibration.test.ts` — Vitest unit tests

**Modified:**
- `src/components/Import/ImageImportDialog.tsx`:
  - new `calibration` state (settings + points)
  - new `previewMode` state (`"crop" | "sample"`)
  - new "色彩校正" collapsible panel
  - dual-mode preview interaction
  - inline MARD picker sub-modal
  - quantize call sites use calibrated pixels

No store, adapter, or Rust changes.

---

## Task 1: Pure helpers — types, computeCoefficients, identity

**Files:**
- Create: `src/utils/colorCalibration.ts`
- Create: `src/utils/colorCalibration.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/utils/colorCalibration.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  IDENTITY_COEFFICIENTS,
  computeCoefficients,
  type CalibrationMode,
} from "./colorCalibration";

const RGB = (r: number, g: number, b: number) => [r, g, b] as [number, number, number];

describe("IDENTITY_COEFFICIENTS", () => {
  it("is a=1 b=0 per channel", () => {
    expect(IDENTITY_COEFFICIENTS.a).toEqual([1, 1, 1]);
    expect(IDENTITY_COEFFICIENTS.b).toEqual([0, 0, 0]);
  });
});

describe("computeCoefficients — empty input", () => {
  it("returns identity when pairs is empty (any mode)", () => {
    for (const mode of ["additive", "multiplicative", "affine"] as CalibrationMode[]) {
      const c = computeCoefficients([], mode);
      expect(c.a).toEqual([1, 1, 1]);
      expect(c.b).toEqual([0, 0, 0]);
    }
  });
});

describe("computeCoefficients — N=1 additive", () => {
  it("computes b = target - sample, a = 1", () => {
    const c = computeCoefficients(
      [{ sample: RGB(200, 210, 225), target: RGB(255, 255, 255) }],
      "additive",
    );
    expect(c.a).toEqual([1, 1, 1]);
    expect(c.b).toEqual([55, 45, 30]);
  });
});

describe("computeCoefficients — N=1 multiplicative", () => {
  it("computes a = target / sample, b = 0", () => {
    const c = computeCoefficients(
      [{ sample: RGB(200, 200, 200), target: RGB(220, 200, 180) }],
      "multiplicative",
    );
    expect(c.a[0]).toBeCloseTo(220 / 200);
    expect(c.a[1]).toBeCloseTo(200 / 200);
    expect(c.a[2]).toBeCloseTo(180 / 200);
    expect(c.b).toEqual([0, 0, 0]);
  });

  it("guards against sample=0 (per channel)", () => {
    const c = computeCoefficients(
      [{ sample: RGB(0, 100, 0), target: RGB(50, 100, 50) }],
      "multiplicative",
    );
    // Channels 0 and 2 have sample=0 → identity for those channels
    expect(c.a[0]).toBe(1);
    expect(c.b[0]).toBe(0);
    expect(c.a[1]).toBeCloseTo(1);
    expect(c.a[2]).toBe(1);
    expect(c.b[2]).toBe(0);
  });
});

describe("computeCoefficients — N=1 affine falls back to multiplicative", () => {
  it("N=1 affine equals N=1 multiplicative result", () => {
    const pair = [{ sample: RGB(200, 200, 200), target: RGB(220, 200, 180) }];
    const a = computeCoefficients(pair, "affine");
    const m = computeCoefficients(pair, "multiplicative");
    expect(a.a).toEqual(m.a);
    expect(a.b).toEqual(m.b);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run src/utils/colorCalibration.test.ts`
Expected: all fail with "Cannot find module './colorCalibration'".

- [ ] **Step 3: Implement types + computeCoefficients (N≤1 only)**

Create `src/utils/colorCalibration.ts`:

```ts
/**
 * Color calibration for image import.
 *
 * Solves a per-channel affine transform `out = a*in + b` from N reference
 * (sample, target) RGB pairs, then applies it to a pixel array. The dialog
 * runs this on raw RGB pixels before MARD quantization to correct color cast.
 */

export type CalibrationMode = "additive" | "multiplicative" | "affine";

export interface CalibrationPoint {
  id: string;
  region: { x: number; y: number; w: number; h: number };
  sampledRgb: [number, number, number];
  targetColorIndex: number;
}

export interface CalibrationSettings {
  enabled: boolean;
  mode: CalibrationMode;
  points: CalibrationPoint[];
}

export interface CalibrationCoefficients {
  a: [number, number, number];
  b: [number, number, number];
}

export const IDENTITY_COEFFICIENTS: CalibrationCoefficients = {
  a: [1, 1, 1],
  b: [0, 0, 0],
};

export const DEFAULT_CALIBRATION_SETTINGS: CalibrationSettings = {
  enabled: false,
  mode: "multiplicative",
  points: [],
};

interface SampleTargetPair {
  sample: [number, number, number];
  target: [number, number, number];
}

function sanitize(coef: CalibrationCoefficients): CalibrationCoefficients {
  // Any NaN/Inf in any channel → reset that channel to identity.
  const a: [number, number, number] = [1, 1, 1];
  const b: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const ac = coef.a[c];
    const bc = coef.b[c];
    if (Number.isFinite(ac) && Number.isFinite(bc)) {
      a[c] = ac;
      b[c] = bc;
    }
  }
  return { a, b };
}

export function computeCoefficients(
  pairs: SampleTargetPair[],
  mode: CalibrationMode,
): CalibrationCoefficients {
  if (pairs.length === 0) return { a: [1, 1, 1], b: [0, 0, 0] };

  if (pairs.length === 1) {
    const { sample, target } = pairs[0];
    if (mode === "additive") {
      return sanitize({
        a: [1, 1, 1],
        b: [target[0] - sample[0], target[1] - sample[1], target[2] - sample[2]],
      });
    }
    // multiplicative OR affine (single point — fall back)
    const a: [number, number, number] = [1, 1, 1];
    for (let c = 0; c < 3; c++) {
      a[c] = sample[c] === 0 ? 1 : target[c] / sample[c];
    }
    return sanitize({ a, b: [0, 0, 0] });
  }

  // N≥2 paths in Task 2
  return { a: [1, 1, 1], b: [0, 0, 0] };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run src/utils/colorCalibration.test.ts`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/colorCalibration.ts src/utils/colorCalibration.test.ts
git commit -m "calibration: types + N<=1 computeCoefficients with identity fallback"
```

---

## Task 2: N≥2 least-squares paths

**Files:**
- Modify: `src/utils/colorCalibration.ts`
- Modify: `src/utils/colorCalibration.test.ts`

- [ ] **Step 1: Add failing tests for N≥2 paths**

Append to `src/utils/colorCalibration.test.ts`:

```ts
describe("computeCoefficients — N=2+ additive", () => {
  it("computes b = mean(target - sample)", () => {
    // Point 1: (100,100,100) -> (110,90,100)  → delta = (10,-10, 0)
    // Point 2: (150,150,150) -> (155,145,155) → delta = ( 5, -5, 5)
    // mean = (7.5, -7.5, 2.5)
    const c = computeCoefficients(
      [
        { sample: RGB(100, 100, 100), target: RGB(110, 90, 100) },
        { sample: RGB(150, 150, 150), target: RGB(155, 145, 155) },
      ],
      "additive",
    );
    expect(c.a).toEqual([1, 1, 1]);
    expect(c.b[0]).toBeCloseTo(7.5);
    expect(c.b[1]).toBeCloseTo(-7.5);
    expect(c.b[2]).toBeCloseTo(2.5);
  });
});

describe("computeCoefficients — N=2+ multiplicative", () => {
  it("computes a = Σ(s·t) / Σ(s²)", () => {
    // sample = [100, 150], target = [110, 165]
    // Σ(s·t) = 100*110 + 150*165 = 35750
    // Σ(s²)  = 10000 + 22500 = 32500
    // a = 35750 / 32500 ≈ 1.1
    const c = computeCoefficients(
      [
        { sample: RGB(100, 100, 100), target: RGB(110, 110, 110) },
        { sample: RGB(150, 150, 150), target: RGB(165, 165, 165) },
      ],
      "multiplicative",
    );
    expect(c.a[0]).toBeCloseTo(1.1);
    expect(c.a[1]).toBeCloseTo(1.1);
    expect(c.a[2]).toBeCloseTo(1.1);
    expect(c.b).toEqual([0, 0, 0]);
  });

  it("falls back to identity when Σ(s²)=0", () => {
    const c = computeCoefficients(
      [
        { sample: RGB(0, 100, 0), target: RGB(10, 110, 10) },
        { sample: RGB(0, 200, 0), target: RGB(20, 220, 20) },
      ],
      "multiplicative",
    );
    expect(c.a[0]).toBe(1);
    expect(c.a[2]).toBe(1);
    // Channel 1 still works
    expect(c.a[1]).toBeGreaterThan(1);
  });
});

describe("computeCoefficients — N=2+ affine", () => {
  it("fits a perfect linear relation exactly", () => {
    // Construct target = 1.5 * sample + 10 across many points
    const pairs = [
      { sample: RGB(0, 0, 0), target: RGB(10, 10, 10) },
      { sample: RGB(50, 50, 50), target: RGB(85, 85, 85) },
      { sample: RGB(100, 100, 100), target: RGB(160, 160, 160) },
    ];
    const c = computeCoefficients(pairs, "affine");
    for (let i = 0; i < 3; i++) {
      expect(c.a[i]).toBeCloseTo(1.5, 6);
      expect(c.b[i]).toBeCloseTo(10, 6);
    }
  });

  it("falls back to multiplicative when all samples identical", () => {
    const pairs = [
      { sample: RGB(100, 100, 100), target: RGB(120, 110, 100) },
      { sample: RGB(100, 100, 100), target: RGB(110, 105, 100) },
    ];
    const c = computeCoefficients(pairs, "affine");
    // Affine degenerates → multiplicative path:
    // a = Σ(s·t)/Σ(s²) per channel; b = 0
    // For channel 0: Σ(s·t) = 100*120 + 100*110 = 23000; Σ(s²) = 20000; a = 1.15
    expect(c.a[0]).toBeCloseTo(1.15);
    expect(c.b[0]).toBeCloseTo(0);
  });
});
```

- [ ] **Step 2: Run tests, verify the new ones fail**

Run: `npx vitest run src/utils/colorCalibration.test.ts`
Expected: 5 new tests fail (the N≥2 placeholder returns identity).

- [ ] **Step 3: Implement N≥2 paths**

Replace the `// N≥2 paths in Task 2` block in `src/utils/colorCalibration.ts` with:

```ts
  // N >= 2
  const a: [number, number, number] = [1, 1, 1];
  const b: [number, number, number] = [0, 0, 0];
  const n = pairs.length;

  for (let c = 0; c < 3; c++) {
    const samples = pairs.map((p) => p.sample[c]);
    const targets = pairs.map((p) => p.target[c]);

    if (mode === "additive") {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += targets[i] - samples[i];
      a[c] = 1;
      b[c] = sum / n;
      continue;
    }

    if (mode === "multiplicative") {
      let st = 0;
      let ss = 0;
      for (let i = 0; i < n; i++) {
        st += samples[i] * targets[i];
        ss += samples[i] * samples[i];
      }
      if (ss === 0) {
        a[c] = 1;
        b[c] = 0;
      } else {
        a[c] = st / ss;
        b[c] = 0;
      }
      continue;
    }

    // affine
    let S = 0, T = 0, SS = 0, ST = 0;
    for (let i = 0; i < n; i++) {
      S += samples[i];
      T += targets[i];
      SS += samples[i] * samples[i];
      ST += samples[i] * targets[i];
    }
    const denom = n * SS - S * S;
    if (Math.abs(denom) < 1e-9) {
      // All samples identical → fall back to multiplicative for this channel
      if (SS === 0) {
        a[c] = 1;
        b[c] = 0;
      } else {
        a[c] = ST / SS;
        b[c] = 0;
      }
    } else {
      a[c] = (n * ST - S * T) / denom;
      b[c] = (T - a[c] * S) / n;
    }
  }

  return sanitize({ a, b });
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `npx vitest run src/utils/colorCalibration.test.ts`
Expected: all 12 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/colorCalibration.ts src/utils/colorCalibration.test.ts
git commit -m "calibration: N>=2 least-squares for additive/multiplicative/affine"
```

---

## Task 3: applyCalibration and sampleRegionMean

**Files:**
- Modify: `src/utils/colorCalibration.ts`
- Modify: `src/utils/colorCalibration.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/utils/colorCalibration.test.ts`:

```ts
import { applyCalibration, sampleRegionMean } from "./colorCalibration";

describe("applyCalibration", () => {
  it("identity returns equivalent pixel values", () => {
    const pixels = [100, 150, 200, 50, 75, 100];
    const out = applyCalibration(pixels, IDENTITY_COEFFICIENTS);
    expect(out).toEqual(pixels);
  });

  it("applies per-channel a*in + b and clamps", () => {
    const pixels = [100, 150, 200];
    const coef: CalibrationCoefficients = { a: [1.5, 1, 0.5], b: [0, 50, 100] };
    const out = applyCalibration(pixels, coef);
    // ch0: 1.5*100 + 0 = 150
    // ch1: 1*150 + 50 = 200
    // ch2: 0.5*200 + 100 = 200
    expect(out).toEqual([150, 200, 200]);
  });

  it("clamps to [0, 255]", () => {
    const pixels = [10, 200, 100];
    const coef: CalibrationCoefficients = { a: [10, 2, -1], b: [0, 0, 0] };
    const out = applyCalibration(pixels, coef);
    // 10*10 = 100 (ok)
    // 2*200 = 400 → 255
    // -1*100 = -100 → 0
    expect(out).toEqual([100, 255, 0]);
  });

  it("returns a new array, doesn't mutate input", () => {
    const pixels = [100, 100, 100];
    const out = applyCalibration(pixels, IDENTITY_COEFFICIENTS);
    expect(out).not.toBe(pixels);
    out[0] = 0;
    expect(pixels[0]).toBe(100);
  });
});

describe("sampleRegionMean", () => {
  // 3-wide image: idx 0=(R,G,B)=(10,20,30); idx 1=(40,50,60); idx 2=(70,80,90)
  //               idx 3=(100,110,120);     idx 4=(130,140,150); idx 5=(160,170,180)
  const img3x2 = [
    10, 20, 30, 40, 50, 60, 70, 80, 90,
    100, 110, 120, 130, 140, 150, 160, 170, 180,
  ];

  it("single-pixel region", () => {
    const m = sampleRegionMean(img3x2, 3, { x: 1, y: 0, w: 1, h: 1 });
    expect(m).toEqual([40, 50, 60]);
  });

  it("multi-pixel region mean", () => {
    // 2x1 region at (0,0) → pixels (10,20,30) and (40,50,60), mean (25,35,45)
    const m = sampleRegionMean(img3x2, 3, { x: 0, y: 0, w: 2, h: 1 });
    expect(m[0]).toBeCloseTo(25);
    expect(m[1]).toBeCloseTo(35);
    expect(m[2]).toBeCloseTo(45);
  });

  it("clamps region to image bounds", () => {
    // Request 5x5 starting at (1,1); image is 3x2, so effective region is 2x1
    // starting at (1,1) → pixels (130,140,150) and (160,170,180), mean (145,155,165)
    const m = sampleRegionMean(img3x2, 3, { x: 1, y: 1, w: 5, h: 5 });
    expect(m[0]).toBeCloseTo(145);
    expect(m[1]).toBeCloseTo(155);
    expect(m[2]).toBeCloseTo(165);
  });

  it("returns zeros for empty region (0 area)", () => {
    const m = sampleRegionMean(img3x2, 3, { x: 0, y: 0, w: 0, h: 0 });
    expect(m).toEqual([0, 0, 0]);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run src/utils/colorCalibration.test.ts`
Expected: new tests fail with "applyCalibration is not exported" etc.

- [ ] **Step 3: Implement applyCalibration and sampleRegionMean**

Append to `src/utils/colorCalibration.ts`:

```ts
export function applyCalibration(
  pixels: Uint8Array | number[],
  coef: CalibrationCoefficients,
): number[] {
  const out: number[] = new Array(pixels.length);
  for (let i = 0; i < pixels.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const v = coef.a[c] * pixels[i + c] + coef.b[c];
      out[i + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return out;
}

export function sampleRegionMean(
  pixels: Uint8Array | number[],
  imageWidth: number,
  region: { x: number; y: number; w: number; h: number },
): [number, number, number] {
  // Clamp region to image bounds. Image height inferred from pixels length.
  const imageHeight = pixels.length / 3 / imageWidth;
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(imageWidth, Math.floor(region.x + region.w));
  const y1 = Math.min(imageHeight, Math.floor(region.y + region.h));

  if (x1 <= x0 || y1 <= y0) return [0, 0, 0];

  let sumR = 0, sumG = 0, sumB = 0, count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * imageWidth + x) * 3;
      sumR += pixels[i];
      sumG += pixels[i + 1];
      sumB += pixels[i + 2];
      count++;
    }
  }
  return [sumR / count, sumG / count, sumB / count];
}
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `npx vitest run src/utils/colorCalibration.test.ts`
Expected: all 20 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/colorCalibration.ts src/utils/colorCalibration.test.ts
git commit -m "calibration: applyCalibration + sampleRegionMean helpers with tests"
```

---

## Task 4: Wire calibration into ImageImportDialog quantize call sites

**Files:**
- Modify: `src/components/Import/ImageImportDialog.tsx`

This task only adds the calibration state object and threads it through the existing quantize calls. It does NOT add UI yet — that's Task 5. Default settings keep the dialog behaving exactly as before.

- [ ] **Step 1: Add imports + state**

Open `src/components/Import/ImageImportDialog.tsx`. After the existing import lines at the top, add:

```ts
import {
  DEFAULT_CALIBRATION_SETTINGS,
  computeCoefficients,
  applyCalibration,
  IDENTITY_COEFFICIENTS,
  type CalibrationSettings,
  type CalibrationCoefficients,
} from "../../utils/colorCalibration";
import { MARD_COLORS } from "../../data/mard221";
```

(Check if `MARD_COLORS` is already imported via `COLOR_GROUPS`; if so, add `MARD_COLORS` to the same line. Search with `grep -n "MARD_COLORS\|COLOR_GROUPS" src/components/Import/ImageImportDialog.tsx | head -3`.)

After the existing state hooks near the top of the component (around line 60, after `loupePos`), add:

```ts
  // Color calibration
  const [calibration, setCalibration] = useState<CalibrationSettings>(
    DEFAULT_CALIBRATION_SETTINGS,
  );
```

- [ ] **Step 2: Helper for resolved coefficients**

Inside the component, after the calibration state declaration:

```ts
  const calibrationCoef: CalibrationCoefficients = useMemo(() => {
    if (!calibration.enabled || calibration.points.length === 0) {
      return IDENTITY_COEFFICIENTS;
    }
    const pairs = calibration.points.map((p) => {
      const mc = MARD_COLORS[p.targetColorIndex];
      const target: [number, number, number] = mc?.rgb ?? [0, 0, 0];
      return { sample: p.sampledRgb, target };
    });
    return computeCoefficients(pairs, calibration.mode);
  }, [calibration]);
```

If `useMemo` isn't already imported, add it to the `react` import at the top of the file.

- [ ] **Step 3: Thread calibration through both quantize sites**

Find the two call sites (line ~587 and line ~617). Change:

```ts
let matched = matchImageToMard(data.pixels, algorithm, colorGroupId, colorOverrides);
```

to:

```ts
const calibratedPixels = applyCalibration(data.pixels as number[], calibrationCoef);
let matched = matchImageToMard(calibratedPixels, algorithm, colorGroupId, colorOverrides);
```

And similarly at the other site (`handleCompare`):

```ts
const calibratedPixels = applyCalibration(data.pixels as number[], calibrationCoef);
const matched = matchImageToMard(calibratedPixels, algo, colorGroupId, colorOverrides);
```

When `calibrationCoef === IDENTITY_COEFFICIENTS`, `applyCalibration` does an effectively no-op pass (still allocates a new array, but values are unchanged). That's fine for clarity.

- [ ] **Step 4: Live re-quantize on calibration change**

Find or create a `useEffect` that re-runs `matchImageToMard` when `rawPixels` or `algorithm` or `colorGroupId` changes. If there is no such effect (the current code only re-quantizes inside `handleImport`/`handleCompare`), add one:

Look for `setMatchedPreview` usage; if it's only inside the button handlers, add this effect near the other `useEffect`s:

```ts
  useEffect(() => {
    if (!rawPixels) return;
    const calibrated = applyCalibration(rawPixels, calibrationCoef);
    const matched = matchImageToMard(calibrated, algorithm, colorGroupId, colorOverrides);
    setMatchedPreview(matched);
  }, [rawPixels, algorithm, colorGroupId, colorOverrides, calibrationCoef]);
```

If a similar effect already exists, just add `calibrationCoef` to the dep list and replace `rawPixels` with `applyCalibration(rawPixels, calibrationCoef)` inside.

- [ ] **Step 5: Type-check and run tests**

Run:
- `npx tsc --noEmit` — expect clean
- `npx vitest run` — expect all tests pass (20 new + existing 99 = 119+)

- [ ] **Step 6: Commit**

```bash
git add src/components/Import/ImageImportDialog.tsx
git commit -m "import: thread calibration state through quantize call sites (no UI yet)"
```

---

## Task 5: MARD picker sub-component (inline)

**Files:**
- Modify: `src/components/Import/ImageImportDialog.tsx`

The picker shows the user's MARD palette and lets them select a target color when a new calibration point is being added. It's a small inline modal — no need for a separate file unless it grows.

- [ ] **Step 1: Add picker state + helpers**

Near the other calibration state at the top of the component:

```ts
  const [pendingCalPoint, setPendingCalPoint] = useState<{
    region: { x: number; y: number; w: number; h: number };
    sampledRgb: [number, number, number];
  } | null>(null);
```

After the existing `MARD_COLORS` import is in place, you'll need the existing `COLOR_GROUPS` and `getEffectiveHex` (both should already be imported — verify with `grep -n "COLOR_GROUPS\|getEffectiveHex" src/components/Import/ImageImportDialog.tsx | head`).

- [ ] **Step 2: Render the picker conditionally**

At the very end of the dialog JSX (right before the closing tag of the dialog wrapper), add:

```tsx
{pendingCalPoint && (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]">
    <div className="bg-white rounded-lg shadow-xl p-4 w-[480px] max-h-[70vh] flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">选择目标 MARD 色</h3>
        <button
          onClick={() => setPendingCalPoint(null)}
          className="text-gray-400 hover:text-gray-600 text-lg leading-none"
        >
          ×
        </button>
      </div>

      <div className="flex items-center gap-3 text-xs">
        <span className="text-gray-500">采样色:</span>
        <div
          className="w-8 h-8 rounded border"
          style={{
            background: `rgb(${pendingCalPoint.sampledRgb[0].toFixed(0)},${pendingCalPoint.sampledRgb[1].toFixed(0)},${pendingCalPoint.sampledRgb[2].toFixed(0)})`,
          }}
        />
        <span className="text-gray-600">
          ({pendingCalPoint.sampledRgb.map((v) => v.toFixed(0)).join(", ")})
        </span>
      </div>

      <div className="overflow-y-auto flex flex-col gap-2">
        {COLOR_GROUPS.filter((g) => g.id !== "all").map((group) => (
          <div key={group.id}>
            <div className="text-[11px] text-gray-500 mb-1">{group.name}</div>
            <div className="flex flex-wrap gap-1">
              {group.indices.map((idx) => {
                const c = MARD_COLORS[idx];
                if (!c) return null;
                const hex = getEffectiveHex(idx, colorOverrides);
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      const newPoint = {
                        id: crypto.randomUUID(),
                        region: pendingCalPoint.region,
                        sampledRgb: pendingCalPoint.sampledRgb,
                        targetColorIndex: idx,
                      };
                      setCalibration((prev) => ({
                        ...prev,
                        enabled: true,
                        points: [...prev.points, newPoint],
                      }));
                      setPendingCalPoint(null);
                    }}
                    title={`${c.code} ${c.name}`}
                    className="w-6 h-6 rounded border hover:ring-2 hover:ring-blue-400"
                    style={{ background: hex }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/Import/ImageImportDialog.tsx
git commit -m "import: MARD color picker for calibration target selection"
```

---

## Task 6: Calibration UI panel

**Files:**
- Modify: `src/components/Import/ImageImportDialog.tsx`

- [ ] **Step 1: Add panel-visible state**

Near the other state:

```ts
  const [calibrationPanelOpen, setCalibrationPanelOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<"crop" | "sample">("crop");
```

- [ ] **Step 2: Insert the panel JSX**

Find a good spot in the JSX — between the crop selector area and the algorithm/comparison area. Look for `showComparison` or the algorithm dropdown to anchor placement. Insert this block right before the algorithm section:

```tsx
<div className="border rounded">
  <button
    type="button"
    onClick={() => setCalibrationPanelOpen((v) => !v)}
    className="w-full px-3 py-2 flex justify-between items-center text-xs hover:bg-gray-50"
  >
    <span>{calibrationPanelOpen ? "▼" : "▶"} 色彩校正</span>
    <label className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        checked={calibration.enabled}
        onChange={(e) =>
          setCalibration((prev) => ({ ...prev, enabled: e.target.checked }))
        }
      />
      <span>启用</span>
    </label>
  </button>

  {calibrationPanelOpen && (
    <div className="p-3 border-t flex flex-col gap-3 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-gray-500">模式:</span>
        {(["additive", "multiplicative", "affine"] as const).map((m) => (
          <label key={m} className="flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name="cal-mode"
              checked={calibration.mode === m}
              onChange={() => setCalibration((p) => ({ ...p, mode: m }))}
            />
            <span>{m === "additive" ? "加法" : m === "multiplicative" ? "乘法" : "混合"}</span>
          </label>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-gray-500">参考点 (在预览图上拖矩形 → 选 MARD 色):</span>
        {calibration.points.length === 0 ? (
          <p className="text-gray-400 italic py-1">暂无参考点</p>
        ) : (
          calibration.points.map((p) => {
            const target = MARD_COLORS[p.targetColorIndex];
            const targetHex = getEffectiveHex(p.targetColorIndex, colorOverrides);
            return (
              <div key={p.id} className="flex items-center gap-2 p-1.5 bg-gray-50 rounded border">
                <div
                  className="w-5 h-5 rounded border shrink-0"
                  style={{
                    background: `rgb(${p.sampledRgb.map((v) => v.toFixed(0)).join(",")})`,
                  }}
                  title={`采样 (${p.sampledRgb.map((v) => v.toFixed(0)).join(",")})`}
                />
                <span className="text-gray-400">→</span>
                <div
                  className="w-5 h-5 rounded border shrink-0"
                  style={{ background: targetHex }}
                  title={`${target?.code} ${target?.name}`}
                />
                <span className="flex-1 truncate text-gray-600">
                  {target?.code} {target?.name}
                </span>
                <button
                  onClick={() =>
                    setCalibration((prev) => ({
                      ...prev,
                      points: prev.points.filter((pt) => pt.id !== p.id),
                    }))
                  }
                  className="text-red-500 hover:bg-red-50 px-2 py-0.5 rounded"
                >
                  删
                </button>
              </div>
            );
          })
        )}
      </div>

      <button
        onClick={() => {
          setPreviewMode("sample");
        }}
        disabled={!imagePreview || previewMode === "sample"}
        className="self-start px-3 py-1 border border-blue-300 text-blue-600 rounded hover:bg-blue-50 disabled:opacity-50"
      >
        {previewMode === "sample" ? "拖矩形选择采样区..." : "+ 添加参考点"}
      </button>

      <div className="text-[10px] text-gray-400">
        系数: R {calibrationCoef.a[0].toFixed(2)} {calibrationCoef.b[0] >= 0 ? "+" : ""}{calibrationCoef.b[0].toFixed(1)},
        G {calibrationCoef.a[1].toFixed(2)} {calibrationCoef.b[1] >= 0 ? "+" : ""}{calibrationCoef.b[1].toFixed(1)},
        B {calibrationCoef.a[2].toFixed(2)} {calibrationCoef.b[2] >= 0 ? "+" : ""}{calibrationCoef.b[2].toFixed(1)}
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/Import/ImageImportDialog.tsx
git commit -m "import: collapsible calibration panel UI"
```

---

## Task 7: Dual-mode preview interaction (crop vs sample)

**Files:**
- Modify: `src/components/Import/ImageImportDialog.tsx`

The preview canvas already accepts drag input to set `cropRect`. We need a second path for `previewMode === "sample"` that produces a sample point instead.

- [ ] **Step 1: Identify the existing drag handler**

Look for the preview canvas's `onMouseDown`/`onMouseMove`/`onMouseUp` handlers. There should be drag state that tracks the in-progress rectangle. Search with `grep -n "onMouseDown\|onMouseMove\|onMouseUp\|isDragging" src/components/Import/ImageImportDialog.tsx | head`.

- [ ] **Step 2: Wrap mode handling in the mouseup logic**

When the user releases the mouse:

- If `previewMode === "crop"`: existing behavior (set `cropRect`).
- If `previewMode === "sample"`: take the dragged rectangle (in preview-pixel coords), convert to image-resolution coords (scale by `original_width / preview_width`), compute `sampleRegionMean` against `imagePreview.pixels` (preview-resolution), set `pendingCalPoint`, and reset `previewMode = "crop"`.

Concretely: at the end of the existing mouse-up handler (just before `setCropRect(...)` or wherever the dragged rect is committed), branch:

```ts
// At the mouseup handler, after dragging has been recognized:
if (previewMode === "sample" && imagePreview) {
  // The drag rect is in preview-image coords. Compute mean in preview pixels.
  const region = { x: dragRect.x, y: dragRect.y, w: dragRect.w, h: dragRect.h };
  // Sanity: empty drag → ignore
  if (region.w <= 0 || region.h <= 0) {
    setPreviewMode("crop");
    return;
  }
  const mean = sampleRegionMean(
    imagePreview.pixels,
    imagePreview.preview_width,
    region,
  );
  setPendingCalPoint({ region, sampledRgb: mean });
  setPreviewMode("crop");
  return; // skip the crop-set fall-through
}
// else: existing crop-set logic
```

Adjust the variable names to match the actual existing handler. Add `sampleRegionMean` to the imports if not already there.

Add an ESC keypress handler at the dialog root (or on the canvas) that resets `previewMode` to `"crop"` and clears any in-progress drag rect:

```tsx
useEffect(() => {
  if (previewMode !== "sample") return;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") setPreviewMode("crop");
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [previewMode]);
```

Update the canvas cursor: in the canvas style prop, switch cursor based on mode:

```ts
style={{ cursor: previewMode === "sample" ? "crosshair" : (existing cursor) }}
```

(Match the existing canvas style structure.)

- [ ] **Step 3: Clear calibration points on file change**

Find the place where `filePath` is set when the user picks a different file (e.g., `setFilePath(...)`). After setting it, also clear calibration points:

```ts
setCalibration(DEFAULT_CALIBRATION_SETTINGS);
setPreviewMode("crop");
setPendingCalPoint(null);
```

If `DEFAULT_CALIBRATION_SETTINGS` is imported (Task 4), reuse it.

- [ ] **Step 4: Type-check + test**

Run:
- `npx tsc --noEmit` — clean
- `npx vitest run` — all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/components/Import/ImageImportDialog.tsx
git commit -m "import: sample-mode preview drag + ESC cancel + clear on file change"
```

---

## Task 8: Manual smoke test

**Files:** none

- [ ] **Step 1: Start the dev app**

Run: `npm run tauri dev` (or check `cat package.json` for the right command).

- [ ] **Step 2: Reproduce the original problem**

1. Open the import dialog and pick `temp/sesshoumaru-small.png`.
2. Note the matched preview — the hair should match `D16 light blue` (the original cast).

- [ ] **Step 3: Apply calibration**

1. Open the "色彩校正" panel and check 启用.
2. Set mode to 乘法 (multiplicative — common for color-temperature issues).
3. Click "+ 添加参考点". Cursor becomes crosshair.
4. Drag a rectangle over Sesshoumaru's hair area.
5. MARD picker opens with the sampled color shown on the left. Click on `H2 白色`.
6. The picker closes. The new point appears in the panel.
7. The matched preview re-renders with the calibration applied. The hair should now be matched to `H2`.

- [ ] **Step 4: Iterate**

1. Try Inuyasha's image (`temp/inuyasha-small.png`); pick the hair area, target `H17 浅灰`. Confirm matched preview now shows the gray hair correctly.
2. Try 加法 mode; observe the difference.
3. Try 混合 mode with 2 points (e.g., a white area → `H2`, a dark area → `H9`). Confirm the affine fit is reasonable.
4. Try the 删 button on a point; matched preview reverts.
5. Try toggling 启用 off and on; preview switches between calibrated and uncalibrated.
6. Press ESC during a sample drag; mode resets to crop.
7. Pick a different file; confirm calibration points are cleared.

If anything looks wrong, file a follow-up commit. Otherwise mark complete.

---

## Self-Review

**Spec coverage:**
- Per-channel affine (additive / multiplicative / affine) — Tasks 1 + 2
- N=0 identity, N=1 closed-form, N≥2 least squares — Tasks 1 + 2 (with degenerate fallbacks)
- `applyCalibration` per-pixel + clamp + sample-region mean — Task 3
- Calibration state threaded through quantize — Task 4
- Live re-quantize on calibration change — Task 4 step 4
- MARD picker UI — Task 5
- Collapsible calibration panel — Task 6
- Dual-mode preview interaction (crop vs sample) — Task 7
- ESC cancel + clear on file change — Task 7
- Pure-function test coverage — Tasks 1–3
- Manual smoke test — Task 8

**Placeholder scan:** No TBDs. All code blocks shown.

**Type consistency:**
- `CalibrationSettings`, `CalibrationPoint`, `CalibrationMode`, `CalibrationCoefficients` consistent across the file.
- `computeCoefficients(pairs, mode)`, `applyCalibration(pixels, coef)`, `sampleRegionMean(pixels, width, region)` signatures consistent between extraction and call sites.
- `IDENTITY_COEFFICIENTS` used in both `useMemo` short-circuit and disable path.
- `DEFAULT_CALIBRATION_SETTINGS` used at initial state and on file change reset.
