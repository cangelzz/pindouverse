# 色彩调整机制 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为导入图片和画布选区提供照片式色彩调整（曝光/对比度/饱和度/鲜艳度/色温/色调），调整后拼豆色号自动重新吸附。

**Architecture:** 纯函数引擎 `colorAdjust.ts`（RGB→RGB + 选区 LUT）；选区路径用临时 `previewOverlay` 叠层实时预览、「应用」时一次 `batchSetCells` 单步撤销；导入路径在现有 `applyCalibration → matchImageToMard` 之间插一步。导入与选区共用 `ColorAdjustPanel`。

**Tech Stack:** TypeScript、React、zustand、Vitest（单测 `tests/core/`，`npm test`）、Playwright（webview 集成 `platforms/vscode/tests/`，`npm run test:webview`）。

设计依据：`docs/superpowers/specs/2026-06-15-color-adjust-design.md`

---

## 文件结构

**新增**
- `src/utils/colorAdjust.ts` — 引擎：`ColorAdjustments` 类型、`applyAdjustments`、`applyAdjustmentsToPixels`、`isIdentity`、`buildSelectionRemap`
- `src/components/ColorAdjust/ColorAdjustPanel.tsx` — 6 滑块受控面板
- `src/components/Canvas/SelectionColorAdjustDialog.tsx` — 选区调整对话框
- `tests/core/colorAdjust.test.ts` — 引擎单测
- `platforms/vscode/tests/colorAdjust.spec.ts` — 选区调整 webview 集成测试

**修改**
- `src/store/editorStore.ts` — `previewOverlay`/`adjustSession` 状态 + `beginSelectionAdjust`/`updateSelectionAdjustPreview`/`commitSelectionAdjust`/`cancelSelectionAdjust`
- `src/components/Canvas/PixelCanvas.tsx` — 渲染时优先用 `previewOverlay`；挂菜单项与对话框
- `src/components/Canvas/SelectionContextMenu.tsx` — 新增「颜色调整...」项
- `src/components/Import/ImageImportDialog.tsx` — 管线插入调整 + 嵌入面板

> 注：单测放 `tests/core/`（与现有用例同目录），非 spec 写的 `tests/` 根。

---

## Task 1: 调整引擎类型与 `applyAdjustments`/`isIdentity`

**Files:**
- Create: `src/utils/colorAdjust.ts`
- Test: `tests/core/colorAdjust.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// tests/core/colorAdjust.test.ts
import { describe, it, expect } from "vitest";
import { applyAdjustments, isIdentity, IDENTITY_ADJUSTMENTS } from "../../src/utils/colorAdjust";

describe("applyAdjustments", () => {
  it("identity returns the same channels", () => {
    expect(applyAdjustments([100, 150, 200], IDENTITY_ADJUSTMENTS)).toEqual([100, 150, 200]);
    expect(applyAdjustments([0, 0, 0], IDENTITY_ADJUSTMENTS)).toEqual([0, 0, 0]);
    expect(applyAdjustments([255, 255, 255], IDENTITY_ADJUSTMENTS)).toEqual([255, 255, 255]);
  });

  it("exposure up never decreases any channel", () => {
    const [r, g, b] = applyAdjustments([100, 100, 100], { ...IDENTITY_ADJUSTMENTS, exposure: 50 });
    expect(r).toBeGreaterThanOrEqual(100);
    expect(g).toBeGreaterThanOrEqual(100);
    expect(b).toBeGreaterThanOrEqual(100);
  });

  it("contrast up pushes darks down and lights up", () => {
    const dark = applyAdjustments([60, 60, 60], { ...IDENTITY_ADJUSTMENTS, contrast: 50 });
    const light = applyAdjustments([200, 200, 200], { ...IDENTITY_ADJUSTMENTS, contrast: 50 });
    expect(dark[0]).toBeLessThan(60);
    expect(light[0]).toBeGreaterThan(200);
  });

  it("saturation -100 yields grayscale (equal channels)", () => {
    const [r, g, b] = applyAdjustments([200, 100, 50], { ...IDENTITY_ADJUSTMENTS, saturation: -100 });
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it("temperature up raises red and lowers blue", () => {
    const [r, , b] = applyAdjustments([100, 100, 100], { ...IDENTITY_ADJUSTMENTS, temperature: 100 });
    expect(r).toBeGreaterThan(100);
    expect(b).toBeLessThan(100);
  });

  it("clamps extreme params to 0..255", () => {
    const out = applyAdjustments([10, 250, 130], { exposure: 100, contrast: 100, saturation: 100, vibrance: 100, temperature: 100, tint: 100 });
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("isIdentity true only when all zero", () => {
    expect(isIdentity(IDENTITY_ADJUSTMENTS)).toBe(true);
    expect(isIdentity({ ...IDENTITY_ADJUSTMENTS, tint: 1 })).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- colorAdjust`
Expected: FAIL，`applyAdjustments` 等未定义。

- [ ] **Step 3: 写实现**

```ts
// src/utils/colorAdjust.ts

/** Photo-style color adjustments. Each slider is -100..+100, 0 = no change. */
export interface ColorAdjustments {
  exposure: number;    // -100..+100 → maps to about ±2 stops
  contrast: number;    // -100..+100
  saturation: number;  // -100..+100
  vibrance: number;    // -100..+100 (boosts low-saturation pixels more)
  temperature: number; // -100..+100 (blue ↔ yellow; warm raises R, lowers B)
  tint: number;        // -100..+100 (green ↔ magenta)
}

export const IDENTITY_ADJUSTMENTS: ColorAdjustments = {
  exposure: 0,
  contrast: 0,
  saturation: 0,
  vibrance: 0,
  temperature: 0,
  tint: 0,
};

export function isIdentity(adj: ColorAdjustments): boolean {
  return (
    adj.exposure === 0 &&
    adj.contrast === 0 &&
    adj.saturation === 0 &&
    adj.vibrance === 0 &&
    adj.temperature === 0 &&
    adj.tint === 0
  );
}

const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Apply adjustments to a single RGB triple (0..255 in, 0..255 rounded int out).
 * Pipeline order (in 0..1 float): exposure → white balance → contrast → saturation → vibrance.
 * Returns the input unchanged when adj is identity.
 */
export function applyAdjustments(
  rgb: [number, number, number],
  adj: ColorAdjustments,
): [number, number, number] {
  let r = rgb[0] / 255;
  let g = rgb[1] / 255;
  let b = rgb[2] / 255;

  // 1. Exposure: out = in * 2^stops, stops in [-2, +2]
  if (adj.exposure !== 0) {
    const f = Math.pow(2, (adj.exposure / 100) * 2);
    r *= f;
    g *= f;
    b *= f;
  }

  // 2. White balance. Temperature warm(+) raises R, lowers B. Tint magenta(+) lowers G, raises R/B.
  if (adj.temperature !== 0) {
    const t = adj.temperature / 100; // -1..1
    r += t * 0.1;
    b -= t * 0.1;
  }
  if (adj.tint !== 0) {
    const ti = adj.tint / 100; // -1..1
    g -= ti * 0.1;
    r += ti * 0.05;
    b += ti * 0.05;
  }

  // 3. Contrast around mid-grey 0.5
  if (adj.contrast !== 0) {
    const k = 1 + adj.contrast / 100;
    r = (r - 0.5) * k + 0.5;
    g = (g - 0.5) * k + 0.5;
    b = (b - 0.5) * k + 0.5;
  }

  // 4. Saturation: lerp between luma and color
  if (adj.saturation !== 0) {
    const s = 1 + adj.saturation / 100; // 0 → grayscale, 2 → double
    const luma = LUMA_R * r + LUMA_G * g + LUMA_B * b;
    r = luma + (r - luma) * s;
    g = luma + (g - luma) * s;
    b = luma + (b - luma) * s;
  }

  // 5. Vibrance: like saturation but weighted toward low-saturation pixels
  if (adj.vibrance !== 0) {
    const vb = adj.vibrance / 100;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const sat = mx <= 0 ? 0 : (mx - mn) / mx;
    const vs = 1 + vb * (1 - sat);
    const luma = LUMA_R * r + LUMA_G * g + LUMA_B * b;
    r = luma + (r - luma) * vs;
    g = luma + (g - luma) * vs;
    b = luma + (b - luma) * vs;
  }

  return [
    Math.round(clamp01(r) * 255),
    Math.round(clamp01(g) * 255),
    Math.round(clamp01(b) * 255),
  ];
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- colorAdjust`
Expected: PASS（6 个用例全过）。

- [ ] **Step 5: 提交**

```bash
git add src/utils/colorAdjust.ts tests/core/colorAdjust.test.ts
git commit -m "feat(color): add applyAdjustments engine"
```

---

## Task 2: `applyAdjustmentsToPixels`（导入用，扁平像素）

**Files:**
- Modify: `src/utils/colorAdjust.ts`
- Test: `tests/core/colorAdjust.test.ts`

- [ ] **Step 1: 写失败测试**

追加到 `tests/core/colorAdjust.test.ts`：

```ts
import { applyAdjustmentsToPixels } from "../../src/utils/colorAdjust";

describe("applyAdjustmentsToPixels", () => {
  it("identity leaves pixels unchanged", () => {
    const px = new Uint8Array([10, 20, 30, 200, 100, 50]);
    const out = applyAdjustmentsToPixels(px, IDENTITY_ADJUSTMENTS);
    expect(Array.from(out)).toEqual([10, 20, 30, 200, 100, 50]);
  });

  it("processes every pixel (length preserved, triple-aligned)", () => {
    const px = new Uint8Array([100, 100, 100, 100, 100, 100]);
    const out = applyAdjustmentsToPixels(px, { ...IDENTITY_ADJUSTMENTS, temperature: 100 });
    expect(out.length).toBe(6);
    expect(out[0]).toBeGreaterThan(100); // R raised
    expect(out[2]).toBeLessThan(100);    // B lowered
    expect(out[3]).toBe(out[0]);         // same input → same output
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- colorAdjust`
Expected: FAIL，`applyAdjustmentsToPixels` 未定义。

- [ ] **Step 3: 写实现**

追加到 `src/utils/colorAdjust.ts`：

```ts
/**
 * Apply adjustments to a flat [r,g,b, r,g,b, ...] pixel array.
 * Returns a new Uint8Array; input is left untouched. Identity is a fast copy.
 */
export function applyAdjustmentsToPixels(
  pixels: Uint8Array | number[],
  adj: ColorAdjustments,
): Uint8Array {
  const out = new Uint8Array(pixels.length);
  if (isIdentity(adj)) {
    out.set(pixels as ArrayLike<number>);
    return out;
  }
  // Cache by packed color: photos have far fewer distinct colors than pixels.
  const cache = new Map<number, [number, number, number]>();
  for (let i = 0; i + 2 < pixels.length; i += 3) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const key = (r << 16) | (g << 8) | b;
    let mapped = cache.get(key);
    if (!mapped) {
      mapped = applyAdjustments([r, g, b], adj);
      cache.set(key, mapped);
    }
    out[i] = mapped[0];
    out[i + 1] = mapped[1];
    out[i + 2] = mapped[2];
  }
  return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- colorAdjust`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/utils/colorAdjust.ts tests/core/colorAdjust.test.ts
git commit -m "feat(color): add applyAdjustmentsToPixels"
```

---

## Task 3: `buildSelectionRemap`（选区 LUT）

**Files:**
- Modify: `src/utils/colorAdjust.ts`
- Test: `tests/core/colorAdjust.test.ts`

- [ ] **Step 1: 写失败测试**

追加到 `tests/core/colorAdjust.test.ts`：

```ts
import { buildSelectionRemap } from "../../src/utils/colorAdjust";

describe("buildSelectionRemap", () => {
  const overrides = new Map();

  it("identity maps every index to itself", () => {
    const map = buildSelectionRemap([0, 5, 42], IDENTITY_ADJUSTMENTS, undefined, "ciede2000", overrides);
    expect(map.get(0)).toBe(0);
    expect(map.get(5)).toBe(5);
    expect(map.get(42)).toBe(42);
  });

  it("empty selection yields empty map", () => {
    const map = buildSelectionRemap([], { ...IDENTITY_ADJUSTMENTS, exposure: 30 }, undefined, "ciede2000", overrides);
    expect(map.size).toBe(0);
  });

  it("restricted pool only ever maps into that pool", () => {
    const pool = [0, 1, 2];
    const map = buildSelectionRemap([40, 41, 42], { ...IDENTITY_ADJUSTMENTS, exposure: 80 }, pool, "ciede2000", overrides);
    for (const dst of map.values()) {
      expect(pool).toContain(dst);
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- colorAdjust`
Expected: FAIL，`buildSelectionRemap` 未定义。

- [ ] **Step 3: 写实现**

追加到 `src/utils/colorAdjust.ts`（顶部加 import）：

```ts
import { findClosestColor } from "./colorMatching";
import { getEffectiveColor, type ColorOverrideMap } from "./colorHelper";
import type { ColorMatchAlgorithm } from "../types";
```

```ts
/**
 * Build a srcIndex → dstIndex remap for a selection: take each source color's
 * effective RGB, apply adjustments, then re-snap to the nearest color in the pool.
 * At most `srcIndices.length` (≤295) matches — independent of cell count.
 *
 * @param candidatePool indices to snap into; undefined = full palette.
 */
export function buildSelectionRemap(
  srcIndices: number[],
  adj: ColorAdjustments,
  candidatePool: number[] | undefined,
  algorithm: ColorMatchAlgorithm,
  overrides: ColorOverrideMap,
): Map<number, number> {
  const map = new Map<number, number>();
  for (const src of srcIndices) {
    const rgb = getEffectiveColor(src, overrides).rgb;
    if (!rgb) {
      map.set(src, src);
      continue;
    }
    const [r, g, b] = applyAdjustments(rgb, adj);
    map.set(src, findClosestColor(r, g, b, algorithm, candidatePool, overrides));
  }
  return map;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- colorAdjust`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/utils/colorAdjust.ts tests/core/colorAdjust.test.ts
git commit -m "feat(color): add buildSelectionRemap LUT"
```

---

## Task 4: store —— 预览叠层与四个 action

**Files:**
- Modify: `src/store/editorStore.ts`

- [ ] **Step 1: 在 `EditorState` 接口加字段与方法签名**

在 `src/store/editorStore.ts` 的 `interface EditorState`（约第 18 行起）里，`selectionBounds` 声明附近加：

```ts
  // Transient color-adjust preview. Rendered on top of cells, never in history.
  previewOverlay: Map<string, number> | null;
  adjustSession: { cells: Map<string, number>; srcIndices: number[]; used: number[] } | null;
```

在 actions 区（与 `replaceColorInSelection` 同区，约第 156 行附近）加：

```ts
  beginSelectionAdjust: () => void;
  updateSelectionAdjustPreview: (adj: ColorAdjustments, snapRange: "all" | "used") => void;
  commitSelectionAdjust: () => void;
  cancelSelectionAdjust: () => void;
```

文件顶部 import 区加：

```ts
import { buildSelectionRemap, type ColorAdjustments } from "../utils/colorAdjust";
import { getGroupIndices } from "../data/mard221";
```

> `getGroupIndices` 若已被 import 则跳过；检查文件顶部是否已有 `from "../data/mard221"`。

- [ ] **Step 2: 在初始 state 设默认值**

在初始 state 里 `selection: null,` / `selectionBounds: null,`（约第 386-387 行）旁加：

```ts
  previewOverlay: null,
  adjustSession: null,
```

- [ ] **Step 3: 实现四个 action**

在 `replaceColorInSelection` 实现之后（约第 1073 行后）插入：

```ts
  beginSelectionAdjust: () => {
    const state = get();
    if (!state.selection) return;
    const layer = state.layers.find((l) => l.id === state.activeLayerId);
    if (!layer) return;

    const cells = new Map<string, number>();
    const srcSet = new Set<number>();
    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      const ci = layer.data[r]?.[c]?.colorIndex;
      if (ci !== null && ci !== undefined) {
        cells.set(key, ci);
        srcSet.add(ci);
      }
    }

    const used = new Set<number>();
    for (const l of state.layers) {
      for (const row of l.data) {
        for (const cell of row) {
          if (cell.colorIndex !== null && cell.colorIndex !== undefined) used.add(cell.colorIndex);
        }
      }
    }

    set({
      adjustSession: { cells, srcIndices: [...srcSet], used: [...used] },
      previewOverlay: new Map(),
    });
  },

  updateSelectionAdjustPreview: (adj, snapRange) => {
    const state = get();
    const session = state.adjustSession;
    if (!session) return;
    const pool = snapRange === "used" ? session.used : getGroupIndices("mard221");
    const remap = buildSelectionRemap(session.srcIndices, adj, pool, "ciede2000", state.colorOverrides);
    const overlay = new Map<string, number>();
    for (const [key, src] of session.cells) {
      const dst = remap.get(src);
      if (dst !== undefined && dst !== src) overlay.set(key, dst);
    }
    set({ previewOverlay: overlay });
  },

  commitSelectionAdjust: () => {
    const state = get();
    if (!state.previewOverlay) return;
    const entries: { row: number; col: number; colorIndex: number | null }[] = [];
    for (const [key, dst] of state.previewOverlay) {
      const [r, c] = key.split(",").map(Number);
      entries.push({ row: r, col: c, colorIndex: dst });
    }
    if (entries.length > 0) get().batchSetCells(entries); // single undo step
    set({ previewOverlay: null, adjustSession: null });
  },

  cancelSelectionAdjust: () => {
    set({ previewOverlay: null, adjustSession: null });
  },
```

- [ ] **Step 4: 类型检查通过**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无错误（新字段/方法均已声明并实现）。

- [ ] **Step 5: 提交**

```bash
git add src/store/editorStore.ts
git commit -m "feat(store): selection color-adjust preview + commit actions"
```

---

## Task 5: PixelCanvas 渲染预览叠层

**Files:**
- Modify: `src/components/Canvas/PixelCanvas.tsx`

- [ ] **Step 1: 订阅 previewOverlay**

在组件内其它 `useEditorStore((s) => ...)` 选择器附近加一行：

```ts
  const previewOverlay = useEditorStore((s) => s.previewOverlay);
```

- [ ] **Step 2: 渲染时优先用叠层色号**

定位主单元格绘制（约第 497-499 行）：

```ts
          const cell = canvasData[r]?.[c];
          if (cell?.colorIndex !== null && cell?.colorIndex !== undefined) {
            const hex = getEffectiveHex(cell.colorIndex, colorOverrides);
```

改为：

```ts
          const cell = canvasData[r]?.[c];
          const overlayIdx = previewOverlay?.get(`${r},${c}`);
          const drawIdx = overlayIdx !== undefined ? overlayIdx : cell?.colorIndex;
          if (drawIdx !== null && drawIdx !== undefined) {
            const hex = getEffectiveHex(drawIdx, colorOverrides);
```

> 注意：把后续用到 `cell.colorIndex` 的绘制分支改用 `drawIdx`，并保持原有缩进与 `}` 配对。

- [ ] **Step 3: 让叠层变化触发重绘**

找到该绘制所在的 `useEffect` 依赖数组（含 `canvasData`、`colorOverrides` 的那个），把 `previewOverlay` 加进依赖：

```ts
  }, [canvasData, colorOverrides, /* …existing deps… */, previewOverlay]);
```

- [ ] **Step 4: 构建确认无回归**

Run: `npm run build`
Expected: 构建成功，无 TS 报错。

- [ ] **Step 5: 提交**

```bash
git add src/components/Canvas/PixelCanvas.tsx
git commit -m "feat(canvas): render color-adjust preview overlay"
```

---

## Task 6: 共享组件 `ColorAdjustPanel`

**Files:**
- Create: `src/components/ColorAdjust/ColorAdjustPanel.tsx`

- [ ] **Step 1: 实现受控面板**

```tsx
// src/components/ColorAdjust/ColorAdjustPanel.tsx
import type { ColorAdjustments } from "../../utils/colorAdjust";
import { IDENTITY_ADJUSTMENTS, isIdentity } from "../../utils/colorAdjust";

interface SliderDef {
  key: keyof ColorAdjustments;
  label: string;
}

const SLIDERS: SliderDef[] = [
  { key: "exposure", label: "曝光" },
  { key: "contrast", label: "对比度" },
  { key: "saturation", label: "饱和度" },
  { key: "vibrance", label: "鲜艳度" },
  { key: "temperature", label: "色温" },
  { key: "tint", label: "色调" },
];

interface ColorAdjustPanelProps {
  value: ColorAdjustments;
  onChange: (next: ColorAdjustments) => void;
}

export function ColorAdjustPanel({ value, onChange }: ColorAdjustPanelProps) {
  const setKey = (key: keyof ColorAdjustments, v: number) => {
    onChange({ ...value, [key]: Math.max(-100, Math.min(100, Math.round(v))) });
  };

  return (
    <div className="space-y-2" data-testid="color-adjust-panel">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">{isIdentity(value) ? "无调整" : "已调整"}</span>
        <button
          type="button"
          className="text-xs text-blue-600 hover:underline disabled:text-gray-300"
          disabled={isIdentity(value)}
          onClick={() => onChange({ ...IDENTITY_ADJUSTMENTS })}
        >
          全部重置
        </button>
      </div>
      {SLIDERS.map(({ key, label }) => (
        <div key={key} className="flex items-center gap-2">
          <label className="w-12 text-xs text-gray-700">{label}</label>
          <input
            type="range"
            min={-100}
            max={100}
            value={value[key]}
            onChange={(e) => setKey(key, Number(e.target.value))}
            onDoubleClick={() => setKey(key, 0)}
            className="flex-1"
            aria-label={label}
          />
          <input
            type="number"
            min={-100}
            max={100}
            value={value[key]}
            onChange={(e) => setKey(key, Number(e.target.value))}
            className="w-12 text-xs border rounded px-1 py-0.5"
            aria-label={`${label}数值`}
          />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 构建确认**

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 3: 提交**

```bash
git add src/components/ColorAdjust/ColorAdjustPanel.tsx
git commit -m "feat(color): shared ColorAdjustPanel component"
```

---

## Task 7: 选区调整对话框 + 右键菜单接线

**Files:**
- Create: `src/components/Canvas/SelectionColorAdjustDialog.tsx`
- Modify: `src/components/Canvas/SelectionContextMenu.tsx`
- Modify: `src/components/Canvas/PixelCanvas.tsx`

- [ ] **Step 1: 实现对话框**

```tsx
// src/components/Canvas/SelectionColorAdjustDialog.tsx
import { useState, useEffect, useRef } from "react";
import { useEditorStore } from "../../store/editorStore";
import { ColorAdjustPanel } from "../ColorAdjust/ColorAdjustPanel";
import { IDENTITY_ADJUSTMENTS, type ColorAdjustments } from "../../utils/colorAdjust";

interface Props {
  onClose: () => void;
}

export function SelectionColorAdjustDialog({ onClose }: Props) {
  const begin = useEditorStore((s) => s.beginSelectionAdjust);
  const update = useEditorStore((s) => s.updateSelectionAdjustPreview);
  const commit = useEditorStore((s) => s.commitSelectionAdjust);
  const cancel = useEditorStore((s) => s.cancelSelectionAdjust);

  const [adj, setAdj] = useState<ColorAdjustments>({ ...IDENTITY_ADJUSTMENTS });
  const [snapRange, setSnapRange] = useState<"all" | "used">("all");

  // Start the session once on mount.
  useEffect(() => {
    begin();
    return () => cancel(); // discard preview if unmounted without applying
  }, [begin, cancel]);

  // Debounced live preview whenever params or snap range change.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => update(adj, snapRange), 16);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [adj, snapRange, update]);

  const apply = () => {
    commit();
    onClose();
  };
  const close = () => {
    cancel();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={close}>
      <div
        className="bg-white rounded-lg shadow-xl p-4 w-72"
        onMouseDown={(e) => e.stopPropagation()}
        data-testid="selection-adjust-dialog"
      >
        <h3 className="text-sm font-semibold mb-3">颜色调整</h3>
        <ColorAdjustPanel value={adj} onChange={setAdj} />
        <div className="flex items-center gap-2 mt-3 text-xs">
          <span className="text-gray-700">吸附范围</span>
          <button
            className={`px-2 py-0.5 rounded border ${snapRange === "all" ? "bg-blue-600 text-white" : ""}`}
            onClick={() => setSnapRange("all")}
          >
            全色板
          </button>
          <button
            className={`px-2 py-0.5 rounded border ${snapRange === "used" ? "bg-blue-600 text-white" : ""}`}
            onClick={() => setSnapRange("used")}
          >
            仅已用色
          </button>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button className="px-3 py-1 text-xs rounded border" onClick={close}>取消</button>
          <button className="px-3 py-1 text-xs rounded bg-blue-600 text-white" onClick={apply}>应用</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 菜单加项**

在 `src/components/Canvas/SelectionContextMenu.tsx` 的 props 类型里加 `onColorAdjust: () => void;`，并在「替换颜色...」项（约第 164 行）后面加一项：

```tsx
      <Item label="颜色调整..." onClick={onColorAdjust} onCloseMenu={onClose} />
```

并在该组件的解构参数列表里加入 `onColorAdjust`。

- [ ] **Step 3: PixelCanvas 接线**

在 `src/components/Canvas/PixelCanvas.tsx`：

加状态（与 `replaceOpen` 同处）：

```ts
  const [adjustOpen, setAdjustOpen] = useState(false);
```

给 `<SelectionContextMenu .../>`（约第 1549 行）加 prop：

```tsx
          onColorAdjust={() => setAdjustOpen(true)}
```

加 import（与 `ReplaceColorInSelectionDialog` 同处）：

```ts
import { SelectionColorAdjustDialog } from "./SelectionColorAdjustDialog";
```

在 `{replaceOpen && (...)}` 块后渲染：

```tsx
      {adjustOpen && <SelectionColorAdjustDialog onClose={() => setAdjustOpen(false)} />}
```

- [ ] **Step 4: 构建确认**

Run: `npm run build`
Expected: 构建成功，无 TS 报错。

- [ ] **Step 5: 提交**

```bash
git add src/components/Canvas/SelectionColorAdjustDialog.tsx src/components/Canvas/SelectionContextMenu.tsx src/components/Canvas/PixelCanvas.tsx
git commit -m "feat(canvas): selection color-adjust dialog + menu entry"
```

---

## Task 8: 导入对话框集成

**Files:**
- Modify: `src/components/Import/ImageImportDialog.tsx`

- [ ] **Step 1: 加调整状态与 import**

顶部 import 区加：

```ts
import { applyAdjustmentsToPixels, IDENTITY_ADJUSTMENTS, type ColorAdjustments } from "../../utils/colorAdjust";
import { ColorAdjustPanel } from "../ColorAdjust/ColorAdjustPanel";
```

在 `const [colorGroupId, setColorGroupId] = useState("mard221");`（约第 35 行）后加：

```ts
  const [adjustments, setAdjustments] = useState<ColorAdjustments>({ ...IDENTITY_ADJUSTMENTS });
```

- [ ] **Step 2: 预览管线插入调整**

定位 useMemo（约第 397-400 行）：

```ts
    const calibrated = applyCalibration(rawPixels, calibrationCoef);
    const matched = matchImageToMard(calibrated, algorithm, colorGroupId, colorOverrides);
    return matched;
  }, [rawPixels, algorithm, colorGroupId, colorOverrides, calibrationCoef]);
```

改为：

```ts
    const calibrated = applyCalibration(rawPixels, calibrationCoef);
    const adjusted = applyAdjustmentsToPixels(calibrated, adjustments);
    const matched = matchImageToMard(adjusted, algorithm, colorGroupId, colorOverrides);
    return matched;
  }, [rawPixels, algorithm, colorGroupId, colorOverrides, calibrationCoef, adjustments]);
```

- [ ] **Step 3: 落盘管线插入调整**

定位导出落盘处（约第 743-744 行）：

```ts
      const calibratedPixels = applyCalibration(data.pixels as number[], calibrationCoef);
      let matched = matchImageToMard(calibratedPixels, algorithm, colorGroupId, colorOverrides);
```

改为（在 calibrate 后插一步）：

```ts
      const calibratedPixels = applyCalibration(data.pixels as number[], calibrationCoef);
      const adjustedPixels = applyAdjustmentsToPixels(calibratedPixels, adjustments);
      let matched = matchImageToMard(adjustedPixels, algorithm, colorGroupId, colorOverrides);
```

定位第二处（约第 773-775 行）：

```ts
      const calibratedPixels = applyCalibration(data.pixels as number[], calibrationCoef);
      ...
        const matched = matchImageToMard(calibratedPixels, algo, colorGroupId, colorOverrides);
```

把这里 `matchImageToMard` 的第一参数也换成 `applyAdjustmentsToPixels(calibratedPixels, adjustments)` 的结果：在该 `calibratedPixels` 定义后加一行 `const adjustedPixels = applyAdjustmentsToPixels(calibratedPixels, adjustments);`，并把后续 `matchImageToMard(calibratedPixels, ...)` 改为 `matchImageToMard(adjustedPixels, ...)`。

> 用 `grep -n "matchImageToMard(calibratedPixels" src/components/Import/ImageImportDialog.tsx` 找全部残留，逐一改为 `adjustedPixels`。

- [ ] **Step 4: 在校正面板下方嵌入调整面板**

在色彩校正系数显示区块（约第 1411-1413 行的「系数: R…」）所在面板的末尾、该面板闭合标签前，插入：

```tsx
              <div className="mt-3 pt-3 border-t">
                <div className="text-xs font-medium text-gray-600 mb-2">图像调整</div>
                <ColorAdjustPanel value={adjustments} onChange={setAdjustments} />
              </div>
```

> 若该区块是条件渲染（仅校正开启时显示），把上面这段放在条件块**之外**、确保导入时始终可调整。

- [ ] **Step 5: 构建确认**

Run: `npm run build`
Expected: 构建成功，无 TS 报错。

- [ ] **Step 6: 提交**

```bash
git add src/components/Import/ImageImportDialog.tsx
git commit -m "feat(import): exposure/contrast/etc adjustments in import pipeline"
```

---

## Task 9: 选区调整 webview 集成测试

**Files:**
- Create: `platforms/vscode/tests/colorAdjust.spec.ts`

- [ ] **Step 1: 写测试**

```ts
// platforms/vscode/tests/colorAdjust.spec.ts
import { test, expect } from "@playwright/test";
import { setupHarness, cleanupHarness, callAction, setStoreState } from "./helpers";

test.describe("selection color adjust", () => {
  test.beforeEach(async ({ page }) => {
    await setupHarness(page);
  });
  test.afterEach(async () => {
    await cleanupHarness();
  });

  async function paintAndSelect(page: any) {
    // Paint a 2x2 block with color index 0, then select it.
    await callAction(page, "batchSetCells", [[
      { row: 0, col: 0, colorIndex: 0 },
      { row: 0, col: 1, colorIndex: 0 },
      { row: 1, col: 0, colorIndex: 0 },
      { row: 1, col: 1, colorIndex: 0 },
    ]]);
    await setStoreState(page, { selection: new Set(["0,0", "0,1", "1,0", "1,1"]) });
    await callAction(page, "setSelection", [new Set(["0,0", "0,1", "1,0", "1,1"])]);
  }

  async function cellColor(page: any, key: string): Promise<number | null> {
    return page.evaluate((k: string) => {
      const [r, c] = k.split(",").map(Number);
      const st = (window as any).__pindouStore.getState();
      return st.canvasData[r][c].colorIndex;
    }, key);
  }

  test("preview does not mutate data; apply commits; undo restores", async ({ page }) => {
    await paintAndSelect(page);
    expect(await cellColor(page, "0,0")).toBe(0);

    await callAction(page, "beginSelectionAdjust", []);
    await callAction(page, "updateSelectionAdjustPreview", [
      { exposure: 80, contrast: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0 },
      "all",
    ]);

    // Underlying data still 0; overlay holds the previewed index.
    expect(await cellColor(page, "0,0")).toBe(0);
    const overlaySize = await page.evaluate(
      () => (window as any).__pindouStore.getState().previewOverlay?.size ?? 0
    );
    expect(overlaySize).toBeGreaterThan(0);

    await callAction(page, "commitSelectionAdjust", []);
    const after = await cellColor(page, "0,0");
    expect(after).not.toBe(0);
    expect(
      await page.evaluate(() => (window as any).__pindouStore.getState().previewOverlay)
    ).toBeNull();

    await callAction(page, "undo", []);
    expect(await cellColor(page, "0,0")).toBe(0);
  });

  test("cancel leaves data unchanged and clears overlay", async ({ page }) => {
    await paintAndSelect(page);
    await callAction(page, "beginSelectionAdjust", []);
    await callAction(page, "updateSelectionAdjustPreview", [
      { exposure: 80, contrast: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0 },
      "all",
    ]);
    await callAction(page, "cancelSelectionAdjust", []);
    expect(await cellColor(page, "0,0")).toBe(0);
    expect(
      await page.evaluate(() => (window as any).__pindouStore.getState().previewOverlay)
    ).toBeNull();
  });

  test("used-only snap maps into existing colors", async ({ page }) => {
    // Two colors present in project: 0 and 1.
    await callAction(page, "batchSetCells", [[
      { row: 0, col: 0, colorIndex: 0 },
      { row: 0, col: 1, colorIndex: 1 },
    ]]);
    await callAction(page, "setSelection", [new Set(["0,0"])]);
    await callAction(page, "beginSelectionAdjust", []);
    await callAction(page, "updateSelectionAdjustPreview", [
      { exposure: 90, contrast: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0 },
      "used",
    ]);
    const overlay = await page.evaluate(() => {
      const o = (window as any).__pindouStore.getState().previewOverlay;
      return o ? Array.from(o.values()) : [];
    });
    for (const dst of overlay) {
      expect([0, 1]).toContain(dst);
    }
  });
});
```

> 注：`setupHarness` 的确切名以 `platforms/vscode/tests/helpers.ts` 为准（参见 `createTestHtml`/`cleanupHarness` 同文件导出）。若初始化函数名不同，按现有 spec 文件（如 `tests/selection.spec.ts`）的用法对齐。

- [ ] **Step 2: 跑测试**

Run（在 `platforms/vscode/`）：`npm run test:webview -- colorAdjust`
Expected: PASS（3 个用例）。

- [ ] **Step 3: 全量 webview 回归**

Run（在 `platforms/vscode/`）：`npm run test:webview`
Expected: 原有 42 + 新增 3 全过。

- [ ] **Step 4: 提交**

```bash
git add platforms/vscode/tests/colorAdjust.spec.ts
git commit -m "test(vscode): selection color-adjust webview integration"
```

---

## 收尾

- [ ] **全量单测**：`npm test` → 全过（含新 `colorAdjust.test.ts`）
- [ ] **全量 webview**：`platforms/vscode/` 下 `npm run test:webview` → 全过
- [ ] **手测**：导入一张图，拖曝光/色温滑块看预览实时变；画布框选一块右键「颜色调整...」拖滑块看实时、应用后 Ctrl+Z 复原
- [ ] 按项目规范 squash 合并到 main（`git checkout main && git merge --squash feature/color-adjust && git commit`），删分支

---

## 自检结论

- **Spec 覆盖**：双滑块(饱和度+鲜艳度)=Task1/6；离散重吸附=Task3/4；实时预览=Task4/5/7；统一面板=Task6/7/8；必须先选区=Task7（菜单仅选区时弹出）；snap 开关=Task3/4/7；色调=tint=Task1。全覆盖。
- **占位符**：无 TBD/TODO，每步含真实代码或确切命令。
- **类型一致**：`ColorAdjustments`/`buildSelectionRemap`/`previewOverlay`/`adjustSession`/四个 action 名在 Task3→4→5→7→9 全一致；`findClosestColor(r,g,b,algorithm,allowedIndices,overrides)` 与实际签名一致；`batchSetCells(entries[])` 与实际一致。
