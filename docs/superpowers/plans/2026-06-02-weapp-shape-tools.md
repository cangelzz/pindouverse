# Shape Tools (line / rect / circle) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three shape-drawing tools (line, rectangle, circle) to the weapp editor's toolbar with drag-to-draw, live preview, and undo support.

**Architecture:** Pure-function shape generators live in `platforms/weapp/src/utils/shapeDrawing.ts` (ported verbatim from desktop's `src/utils/shapeDrawing.ts`). They're consumed by new touch handlers in `result/index.tsx` that record a start cell on touch-down, compute preview cells on touchmove, render the preview translucently over the grid, and commit a single history entry on touchend. A "形状▾" grouped toolbar button replaces a single slot — tapping it opens an action sheet to pick line/rect/circle; the active sub-tool's icon shows on the group button.

**Tech Stack:** TypeScript, React 18, Taro 4 (weapp), Canvas 2D API, vitest (new), miniprogram-automator (existing).

**Branch:** `feature/weapp-shape-tools` off `miniapp/base`.

**Spec reference:** `docs/superpowers/specs/2026-06-02-weapp-feature-migration-design.md` § "#1 Shape tools".

---

## File map

| File | Action | Purpose |
|---|---|---|
| `platforms/weapp/package.json` | modify | Add `vitest` devDependency + `test` script |
| `platforms/weapp/vitest.config.ts` | create | vitest config (jsdom not needed; pure functions) |
| `platforms/weapp/src/utils/shapeDrawing.ts` | create | `lineCells`, `rectCells`, `circleCells`, `constrainLine`, `constrainRect` |
| `platforms/weapp/src/utils/shapeDrawing.test.ts` | create | unit tests for all shape generators |
| `platforms/weapp/src/pages/result/index.tsx` | modify | Tool union, state for active shape + preview, toolbar group button, touch handlers, render overlay |
| `platforms/weapp/tests/e2e/shapes.test.ts` | create | e2e: assert shape group button toggles active state |

---

## Task 0: Create branch and verify baseline

**Files:** none

- [ ] **Step 1: Confirm clean working tree and current branch**

Run:
```
git status
git branch --show-current
```
Expected: `nothing to commit, working tree clean` and `miniapp/base`.

- [ ] **Step 2: Pull latest miniapp/base**

Run:
```
git pull --ff-only
```
Expected: `Already up to date.` or fast-forward.

- [ ] **Step 3: Create and switch to feature branch**

Run:
```
git checkout -b feature/weapp-shape-tools
```
Expected: `Switched to a new branch 'feature/weapp-shape-tools'`.

- [ ] **Step 4: Sanity build before any changes**

Run:
```
cd platforms/weapp && npm run type-check && cd ../..
```
Expected: exit 0, no TypeScript errors.

---

## Task 1: Add vitest to platforms/weapp

**Files:**
- Modify: `platforms/weapp/package.json`
- Create: `platforms/weapp/vitest.config.ts`

- [ ] **Step 1: Install vitest as devDependency**

Run:
```
cd platforms/weapp && npm install --save-dev vitest@^3.1.1 && cd ../..
```
Expected: vitest added to `devDependencies`, lockfile updated.

- [ ] **Step 2: Add test script to platforms/weapp/package.json**

In `platforms/weapp/package.json`, add `"test": "vitest run"` and `"test:watch": "vitest"` to the `scripts` block. Final scripts:

```json
"scripts": {
  "build:weapp": "taro build --type weapp",
  "build:weapp:watch": "taro build --type weapp --watch",
  "dev:weapp": "npm run build:weapp:watch",
  "type-check": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "jest --config tests/e2e/jest.config.cjs",
  "test:e2e:build": "npm run build:weapp && npm run test:e2e"
}
```

- [ ] **Step 3: Create vitest config**

Create `platforms/weapp/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
```

- [ ] **Step 4: Smoke-test the runner**

Create a temporary file `platforms/weapp/src/utils/__smoke__.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('vitest smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run:
```
cd platforms/weapp && npm test && cd ../..
```
Expected: `1 passed`.

- [ ] **Step 5: Delete smoke file**

Run:
```
rm platforms/weapp/src/utils/__smoke__.test.ts
```

- [ ] **Step 6: Commit**

Run:
```
git add platforms/weapp/package.json platforms/weapp/package-lock.json platforms/weapp/vitest.config.ts
git commit -m "chore(weapp): add vitest for unit testing pure utils"
```

---

## Task 2: Write failing tests for shapeDrawing

**Files:**
- Create: `platforms/weapp/src/utils/shapeDrawing.test.ts`

- [ ] **Step 1: Write the test file (all assertions, no implementation yet)**

Create `platforms/weapp/src/utils/shapeDrawing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  lineCells,
  rectCells,
  circleCells,
  constrainLine,
  constrainRect,
} from './shapeDrawing';

describe('lineCells', () => {
  it('returns a single cell when start equals end', () => {
    expect(lineCells(3, 3, 3, 3)).toEqual([[3, 3]]);
  });

  it('draws a straight horizontal line', () => {
    expect(lineCells(2, 0, 2, 3)).toEqual([
      [2, 0], [2, 1], [2, 2], [2, 3],
    ]);
  });

  it('draws a straight vertical line', () => {
    expect(lineCells(0, 5, 3, 5)).toEqual([
      [0, 5], [1, 5], [2, 5], [3, 5],
    ]);
  });

  it('draws a 45-degree diagonal', () => {
    expect(lineCells(0, 0, 3, 3)).toEqual([
      [0, 0], [1, 1], [2, 2], [3, 3],
    ]);
  });

  it('handles reverse direction', () => {
    expect(lineCells(3, 3, 0, 0)).toEqual([
      [3, 3], [2, 2], [1, 1], [0, 0],
    ]);
  });
});

describe('rectCells', () => {
  it('returns a single cell when start equals end', () => {
    expect(rectCells(2, 2, 2, 2, false)).toEqual([[2, 2]]);
  });

  it('draws an outline (counter-clockwise from top edge)', () => {
    // 2x2 outline: all 4 cells are perimeter
    const cells = rectCells(0, 0, 1, 1, false);
    expect(new Set(cells.map((c) => c.join(',')))).toEqual(
      new Set(['0,0', '0,1', '1,0', '1,1']),
    );
  });

  it('draws a filled rectangle', () => {
    const cells = rectCells(0, 0, 1, 2, true);
    expect(new Set(cells.map((c) => c.join(',')))).toEqual(
      new Set(['0,0', '0,1', '0,2', '1,0', '1,1', '1,2']),
    );
    expect(cells).toHaveLength(6);
  });

  it('is invariant to point order', () => {
    const a = new Set(rectCells(2, 4, 0, 0, true).map((c) => c.join(',')));
    const b = new Set(rectCells(0, 0, 2, 4, true).map((c) => c.join(',')));
    expect(a).toEqual(b);
  });
});

describe('circleCells', () => {
  it('returns a single cell when radius is 0', () => {
    expect(circleCells(5, 5, 0, false)).toEqual([[5, 5]]);
  });

  it('outlines a small circle', () => {
    const cells = circleCells(5, 5, 2, false);
    // Outline should NOT contain the center
    expect(cells.find((c) => c[0] === 5 && c[1] === 5)).toBeUndefined();
    // Outline should contain the four cardinal extremes
    const keys = new Set(cells.map((c) => c.join(',')));
    expect(keys.has('5,7')).toBe(true);
    expect(keys.has('5,3')).toBe(true);
    expect(keys.has('7,5')).toBe(true);
    expect(keys.has('3,5')).toBe(true);
  });

  it('fills a small circle', () => {
    const cells = circleCells(5, 5, 2, true);
    const keys = new Set(cells.map((c) => c.join(',')));
    // Center is included
    expect(keys.has('5,5')).toBe(true);
    // Cardinals are included
    expect(keys.has('5,7')).toBe(true);
    // Corner outside radius (4,4 is distance sqrt(2) ~= 1.41 from 5,5, inside)
    expect(keys.has('4,4')).toBe(true);
    // (3,3) distance sqrt(8) ~= 2.83, outside r=2
    expect(keys.has('3,3')).toBe(false);
  });
});

describe('constrainLine', () => {
  it('snaps to horizontal when dc dominates', () => {
    expect(constrainLine(2, 0, 3, 10)).toEqual([2, 10]);
  });

  it('snaps to vertical when dr dominates', () => {
    expect(constrainLine(0, 2, 10, 3)).toEqual([10, 2]);
  });

  it('snaps to 45 diagonal in between', () => {
    expect(constrainLine(0, 0, 5, 4)).toEqual([4, 4]);
  });
});

describe('constrainRect', () => {
  it('produces a square sized to the larger dimension', () => {
    expect(constrainRect(0, 0, 3, 7)).toEqual([7, 7]);
    expect(constrainRect(0, 0, 7, 3)).toEqual([7, 7]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```
cd platforms/weapp && npm test && cd ../..
```
Expected: FAIL with "Cannot find module './shapeDrawing'" or similar.

---

## Task 3: Implement shapeDrawing utility

**Files:**
- Create: `platforms/weapp/src/utils/shapeDrawing.ts`

- [ ] **Step 1: Write the implementation (ported verbatim from src/utils/shapeDrawing.ts)**

Create `platforms/weapp/src/utils/shapeDrawing.ts`:

```ts
// Shape drawing utilities for line, rectangle, and circle tools.
// All functions return an array of [row, col] cell coordinates.
// Ported from desktop src/utils/shapeDrawing.ts.

export function lineCells(r1: number, c1: number, r2: number, c2: number): [number, number][] {
  const cells: [number, number][] = [];
  const dr = Math.abs(r2 - r1);
  const dc = Math.abs(c2 - c1);
  const sr = r1 < r2 ? 1 : -1;
  const sc = c1 < c2 ? 1 : -1;
  let err = dr - dc;
  let r = r1;
  let c = c1;

  while (true) {
    cells.push([r, c]);
    if (r === r2 && c === c2) break;
    const e2 = 2 * err;
    if (e2 > -dc) {
      err -= dc;
      r += sr;
    }
    if (e2 < dr) {
      err += dr;
      c += sc;
    }
  }
  return cells;
}

export function rectCells(
  r1: number,
  c1: number,
  r2: number,
  c2: number,
  filled: boolean,
): [number, number][] {
  const minR = Math.min(r1, r2);
  const maxR = Math.max(r1, r2);
  const minC = Math.min(c1, c2);
  const maxC = Math.max(c1, c2);
  const cells: [number, number][] = [];

  if (filled) {
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        cells.push([r, c]);
      }
    }
  } else {
    for (let c = minC; c <= maxC; c++) {
      cells.push([minR, c]);
      cells.push([maxR, c]);
    }
    for (let r = minR + 1; r < maxR; r++) {
      cells.push([r, minC]);
      cells.push([r, maxC]);
    }
  }
  return cells;
}

export function circleCells(
  cr: number,
  cc: number,
  radius: number,
  filled: boolean,
): [number, number][] {
  const cells = new Set<string>();
  const add = (r: number, c: number) => {
    cells.add(`${r},${c}`);
  };

  if (radius <= 0) {
    return [[cr, cc]];
  }

  if (filled) {
    for (let r = cr - radius; r <= cr + radius; r++) {
      for (let c = cc - radius; c <= cc + radius; c++) {
        const dr = r - cr;
        const dc = c - cc;
        if (dr * dr + dc * dc <= radius * radius) {
          add(r, c);
        }
      }
    }
  } else {
    // Midpoint circle algorithm
    let x = radius;
    let y = 0;
    let err = 1 - radius;
    while (x >= y) {
      add(cr + y, cc + x);
      add(cr + x, cc + y);
      add(cr + x, cc - y);
      add(cr + y, cc - x);
      add(cr - y, cc - x);
      add(cr - x, cc - y);
      add(cr - x, cc + y);
      add(cr - y, cc + x);
      y++;
      if (err < 0) {
        err += 2 * y + 1;
      } else {
        x--;
        err += 2 * (y - x) + 1;
      }
    }
  }

  return Array.from(cells).map((s) => {
    const [r, c] = s.split(',').map(Number);
    return [r, c] as [number, number];
  });
}

export function constrainLine(
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): [number, number] {
  const dr = Math.abs(r2 - r1);
  const dc = Math.abs(c2 - c1);
  if (dc > dr * 2) {
    return [r1, c2];
  } else if (dr > dc * 2) {
    return [r2, c1];
  } else {
    const d = Math.min(dr, dc);
    return [r1 + d * Math.sign(r2 - r1), c1 + d * Math.sign(c2 - c1)];
  }
}

export function constrainRect(
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): [number, number] {
  const dr = Math.abs(r2 - r1);
  const dc = Math.abs(c2 - c1);
  const d = Math.max(dr, dc);
  return [r1 + d * Math.sign(r2 - r1), c1 + d * Math.sign(c2 - c1)];
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run:
```
cd platforms/weapp && npm test && cd ../..
```
Expected: all `shapeDrawing.test.ts` tests pass (15+ tests across the 5 describe blocks).

- [ ] **Step 3: Run type-check**

Run:
```
cd platforms/weapp && npm run type-check && cd ../..
```
Expected: exit 0.

- [ ] **Step 4: Commit**

Run:
```
git add platforms/weapp/src/utils/shapeDrawing.ts platforms/weapp/src/utils/shapeDrawing.test.ts
git commit -m "feat(weapp): shape drawing pure utils (line/rect/circle) with tests"
```

---

## Task 4: Extend Tool union and shape state in result/index.tsx

**Files:**
- Modify: `platforms/weapp/src/pages/result/index.tsx`

- [ ] **Step 1: Extend the Tool type**

In `platforms/weapp/src/pages/result/index.tsx`, find line 16:

```ts
type Tool = 'pen' | 'eraser' | 'fill' | 'eyedropper' | 'pan';
```

Replace with:

```ts
type Tool = 'pen' | 'eraser' | 'fill' | 'eyedropper' | 'pan' | 'line' | 'rect' | 'circle';
type ShapeTool = 'line' | 'rect' | 'circle';
```

- [ ] **Step 2: Update TOOL_LIST (remove direct buttons for shapes; group button is added in Task 6)**

Leave `TOOL_LIST` as-is for now. The 5 existing tools stay; the shape group button is rendered separately.

- [ ] **Step 3: Add state for active shape sub-tool and preview**

In the `ResultPage` function body, near the other `useState` calls (around line 114), add:

```ts
const [activeShape, setActiveShape] = useState<ShapeTool>('line');
const [shapeFilled, setShapeFilled] = useState<boolean>(false);
const [shapePreview, setShapePreview] = useState<[number, number][] | null>(null);
const shapeStartRef = useRef<{ row: number; col: number } | null>(null);
```

Add the `useRef` import if not already present (it's already in line 1).

- [ ] **Step 4: Add import for shape utilities**

At the top of the file, after the existing imports, add:

```ts
import { lineCells, rectCells, circleCells } from '../../utils/shapeDrawing';
```

- [ ] **Step 5: Run type-check**

Run:
```
cd platforms/weapp && npm run type-check && cd ../..
```
Expected: exit 0.

- [ ] **Step 6: Commit**

Run:
```
git add platforms/weapp/src/pages/result/index.tsx
git commit -m "feat(weapp): tool union + state for shape drawing"
```

---

## Task 5: Add touch handlers for shape tools

**Files:**
- Modify: `platforms/weapp/src/pages/result/index.tsx`

- [ ] **Step 1: Add helper to compute preview cells for current shape**

Inside `ResultPage`, after the `pickCell` definition (around line 371), add:

```ts
const computeShapeCells = useCallback(
  (start: { row: number; col: number }, end: { row: number; col: number }): [number, number][] => {
    if (activeShape === 'line') {
      return lineCells(start.row, start.col, end.row, end.col);
    }
    if (activeShape === 'rect') {
      return rectCells(start.row, start.col, end.row, end.col, shapeFilled);
    }
    // circle
    const dr = end.row - start.row;
    const dc = end.col - start.col;
    const radius = Math.round(Math.hypot(dr, dc));
    return circleCells(start.row, start.col, radius, shapeFilled);
  },
  [activeShape, shapeFilled],
);
```

- [ ] **Step 2: Branch handleTouchStart for shape tools**

In `handleTouchStart` (starts ~line 402), after the `tool === 'fill'` block (which ends around line 463), and before the final `applyCellEdit` call, insert:

```ts
if (tool === 'line' || tool === 'rect' || tool === 'circle') {
  shapeStartRef.current = cell;
  setShapePreview([[cell.row, cell.col]]);
  return;
}
```

- [ ] **Step 3: Branch handleTouchMove for shape tools**

In `handleTouchMove` (starts ~line 474), after the `tool === 'pen' || tool === 'eraser'` block, add:

```ts
if (
  (tool === 'line' || tool === 'rect' || tool === 'circle') &&
  shapeStartRef.current
) {
  const cell = pickCell(x, y);
  if (!cell) return;
  const preview = computeShapeCells(shapeStartRef.current, cell);
  setShapePreview(preview);
  return;
}
```

- [ ] **Step 4: Branch handleTouchEnd to commit shape**

Locate `handleTouchEnd` at line 527. Currently it is:

```ts
const handleTouchEnd = useCallback(() => {
  pinchRef.current = null;
  panRef.current = null;
  if (strokeRef.current && strokeRef.current.patches.length > 0) {
    commitStroke();
  } else {
    strokeRef.current = null;
  }
}, [commitStroke]);
```

Replace with:

```ts
const handleTouchEnd = useCallback(() => {
  pinchRef.current = null;
  panRef.current = null;

  if (
    (tool === 'line' || tool === 'rect' || tool === 'circle') &&
    shapeStartRef.current &&
    shapePreview &&
    shapePreview.length > 0 &&
    dataRef.current &&
    project
  ) {
    const patches: CellPatch[] = [];
    const next = selectedColorIndex;
    for (const [r, c] of shapePreview) {
      if (r < 0 || r >= project.height || c < 0 || c >= project.width) continue;
      const prev = dataRef.current[r][c].colorIndex ?? null;
      if (prev === next) continue;
      dataRef.current[r][c] = { colorIndex: next };
      patches.push({ row: r, col: c, prev, next });
    }
    if (patches.length > 0) {
      strokeRef.current = { patches, lastCell: null };
      commitStroke();
      setData(cloneData(dataRef.current));
      pushRecent(selectedColorIndex);
    }
    shapeStartRef.current = null;
    setShapePreview(null);
    return;
  }

  if (strokeRef.current && strokeRef.current.patches.length > 0) {
    commitStroke();
  } else {
    strokeRef.current = null;
  }
}, [commitStroke, tool, shapePreview, project, selectedColorIndex, pushRecent]);
```

- [ ] **Step 5: Run type-check**

Run:
```
cd platforms/weapp && npm run type-check && cd ../..
```
Expected: exit 0. If `CellPatch` import is missing, add it; it's defined locally in the same file.

- [ ] **Step 6: Commit**

Run:
```
git add platforms/weapp/src/pages/result/index.tsx
git commit -m "feat(weapp): touch handlers for shape drawing with live preview"
```

---

## Task 6: Render the shape preview overlay

**Files:**
- Modify: `platforms/weapp/src/pages/result/index.tsx`

- [ ] **Step 1: Update drawCanvas dependency list**

Find the `useEffect` that depends on `drawCanvas` (around line 356-358). It currently lists `[project, data, view, drawCanvas, overrides, showGrid]`. Add `shapePreview` to the dependencies:

```ts
}, [project, data, view, drawCanvas, overrides, showGrid, shapePreview]);
```

- [ ] **Step 2: Render preview cells in drawCanvas**

Inside `drawCanvas` (defined around line 279), after the main grid render loop and before the grid lines are drawn, add a preview pass:

```ts
if (shapePreview && shapePreview.length > 0) {
  const hex = getEffectiveHex(selectedColorIndex, overrides);
  const rgb = hexToRgb(hex);
  ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.55)`;
  for (const [r, c] of shapePreview) {
    if (r < 0 || r >= project.height || c < 0 || c >= project.width) continue;
    ctx.fillRect(c * cell, r * cell, cell, cell);
  }
}
```

Place this after the existing per-cell draw loop and before the grid line drawing. Make sure `selectedColorIndex`, `overrides`, `getEffectiveHex`, and `hexToRgb` are accessible (the imports already include them — see line 6).

- [ ] **Step 3: Add selectedColorIndex to drawCanvas dependency list**

If `drawCanvas` is `useCallback`'d with a dependency array, add `selectedColorIndex` and `shapePreview` to it. Locate the `useCallback` for `drawCanvas` (around line 279) and ensure its deps include both.

- [ ] **Step 4: Run type-check and build**

Run:
```
cd platforms/weapp && npm run type-check && npm run build:weapp && cd ../..
```
Expected: exit 0 from both.

- [ ] **Step 5: Commit**

Run:
```
git add platforms/weapp/src/pages/result/index.tsx
git commit -m "feat(weapp): render translucent shape preview during drag"
```

---

## Task 7: Add the "形状" grouped toolbar button

**Files:**
- Modify: `platforms/weapp/src/pages/result/index.tsx`
- Modify: `platforms/weapp/src/pages/result/index.scss` (likely; minor)

- [ ] **Step 1: Add a tap handler that opens the shape action sheet**

In `ResultPage`, near other menu openers (around `openProjectMenu`, line 827), add:

```ts
const openShapeMenu = useCallback(() => {
  Taro.showActionSheet({
    itemList: [
      `直线${activeShape === 'line' ? ' ✓' : ''}`,
      `矩形${activeShape === 'rect' ? ' ✓' : ''} ${shapeFilled ? '(实心)' : '(描边)'}`,
      `圆形${activeShape === 'circle' ? ' ✓' : ''} ${shapeFilled ? '(实心)' : '(描边)'}`,
      shapeFilled ? '切换为描边模式' : '切换为实心模式',
    ],
    success: (res) => {
      if (res.tapIndex === 0) {
        setActiveShape('line');
        setTool('line');
      } else if (res.tapIndex === 1) {
        setActiveShape('rect');
        setTool('rect');
      } else if (res.tapIndex === 2) {
        setActiveShape('circle');
        setTool('circle');
      } else if (res.tapIndex === 3) {
        setShapeFilled((v) => !v);
      }
    },
  });
}, [activeShape, shapeFilled]);
```

- [ ] **Step 2: Add the group button to the toolbar**

In the toolbar JSX (around line 1543-1561), insert a new `<View>` for the shape group button between the existing tool loop and the export button:

```tsx
<View
  className={`editor__tool${
    tool === 'line' || tool === 'rect' || tool === 'circle' ? ' editor__tool--active' : ''
  }`}
  onClick={openShapeMenu}
>
  <Text className="editor__tool-icon">
    {activeShape === 'line' ? '⟋' : activeShape === 'rect' ? '⬜' : '⭕'}
  </Text>
  <Text className="editor__tool-label">形状▾</Text>
</View>
```

Place it BEFORE the export button. The full toolbar block should look like:

```tsx
<View className="editor__toolbar">
  {TOOL_LIST.map((t) => (
    <View
      key={t.id}
      className={`editor__tool${tool === t.id ? ' editor__tool--active' : ''}`}
      onClick={() => setTool(t.id)}
    >
      <Text className="editor__tool-icon">{t.icon}</Text>
      <Text className="editor__tool-label">{t.label}</Text>
    </View>
  ))}
  <View
    className={`editor__tool${
      tool === 'line' || tool === 'rect' || tool === 'circle' ? ' editor__tool--active' : ''
    }`}
    onClick={openShapeMenu}
  >
    <Text className="editor__tool-icon">
      {activeShape === 'line' ? '⟋' : activeShape === 'rect' ? '⬜' : '⭕'}
    </Text>
    <Text className="editor__tool-label">形状▾</Text>
  </View>
  <View
    className={`editor__tool editor__tool--export${exporting ? ' editor__tool--disabled' : ''}`}
    onClick={openExportMenu}
  >
    <Text className="editor__tool-icon">📷</Text>
    <Text className="editor__tool-label">{exporting ? '…' : '导出'}</Text>
  </View>
</View>
```

- [ ] **Step 3: Run type-check and build**

Run:
```
cd platforms/weapp && npm run type-check && npm run build:weapp && cd ../..
```
Expected: exit 0.

- [ ] **Step 4: Commit**

Run:
```
git add platforms/weapp/src/pages/result/index.tsx
git commit -m "feat(weapp): shape toolbar group button with action sheet"
```

---

## Task 8: Add e2e test for shape tool selection

**Files:**
- Create: `platforms/weapp/tests/e2e/shapes.test.ts`

- [ ] **Step 1: Write the e2e test**

Create `platforms/weapp/tests/e2e/shapes.test.ts`:

```ts
import type { MiniProgram } from 'miniprogram-automator';
import { launchMiniProgram } from './helpers';

interface MockProject {
  id: string;
  name: string;
  data: Array<Array<{ colorIndex: number | null }>>;
  width: number;
  height: number;
  algorithm: string;
  createdAt: number;
}

function makeProject(id: string, name: string, w: number, h: number): MockProject {
  const row = Array.from({ length: w }, () => ({ colorIndex: 0 }));
  const data = Array.from({ length: h }, () => row.map((c) => ({ ...c })));
  return {
    id,
    name,
    data,
    width: w,
    height: h,
    algorithm: 'cielab',
    createdAt: Date.now(),
  };
}

describe('PinDou miniapp - shape tools', () => {
  let mp: MiniProgram;

  beforeAll(async () => {
    mp = await launchMiniProgram();
  }, 90_000);

  afterAll(async () => {
    if (mp) {
      try {
        await mp.close();
      } catch {
        /* noop */
      }
    }
  });

  it('opens the shape action sheet and activates the line tool', async () => {
    const project = makeProject('p-shape', 'Shape Tool Test', 26, 26);
    await mp.callWxMethod('setStorage', { key: 'pindou:projects', data: [project] });

    const list = await mp.reLaunch('/pages/projects/index');
    await list.waitFor(400);
    const items = await list.$$('.projects__item');
    expect(items.length).toBeGreaterThan(0);
    await items[0].tap();
    await mp.evaluate(() => new Promise((r) => setTimeout(r, 500)));

    const page = await mp.currentPage();
    expect(page.path).toBe('pages/result/index');

    // Stub the action sheet to select "直线" (tapIndex 0)
    await mp.mockWxMethod('showActionSheet', { tapIndex: 0, errMsg: 'showActionSheet:ok' });

    const shapeBtn = await page.$('.editor__tool--active');
    // Find the shape group button (it's the one whose label contains "形状")
    const allTools = await page.$$('.editor__tool');
    let shapeBtnIdx = -1;
    for (let i = 0; i < allTools.length; i++) {
      const label = await (await allTools[i].$('.editor__tool-label'))?.text();
      if (label && label.includes('形状')) {
        shapeBtnIdx = i;
        break;
      }
    }
    expect(shapeBtnIdx).toBeGreaterThanOrEqual(0);

    await allTools[shapeBtnIdx].tap();
    await page.waitFor(300);
    await mp.restoreWxMethod('showActionSheet');

    // After action sheet returned tapIndex 0, the shape button should be active
    // (since tool === 'line' is in the active set)
    const afterTools = await page.$$('.editor__tool');
    const shapeBtnAfter = afterTools[shapeBtnIdx];
    const classAttr = await shapeBtnAfter.attribute('class');
    expect(classAttr).toMatch(/editor__tool--active/);
  }, 60_000);
});
```

- [ ] **Step 2: Build and run e2e**

Run:
```
cd platforms/weapp && npm run test:e2e:build && cd ../..
```
Expected: existing tests + new `shapes.test.ts` all pass. If the WeChat DevTools CLI is not installed or the HTTP automation port is closed, document the failure and proceed to manual verification only — note this in the commit message.

- [ ] **Step 3: Commit**

Run:
```
git add platforms/weapp/tests/e2e/shapes.test.ts
git commit -m "test(weapp): e2e for shape tool group button activation"
```

---

## Task 9: Manual verification in WeChat DevTools

**Files:** none

- [ ] **Step 1: Build and open in DevTools**

Run:
```
cd platforms/weapp && npm run build:weapp && cd ../..
```

Open WeChat DevTools, point at `platforms/weapp/dist`.

- [ ] **Step 2: Golden path — draw a line**

1. Open any existing project (or create one via the home tab).
2. Tap "形状▾" in the toolbar.
3. Choose "直线" — confirm the action sheet closes and the toolbar button now shows the line glyph and is highlighted as active.
4. Drag from one corner of the canvas to another.
5. Confirm a translucent line previews along the drag.
6. Release; the line commits with the currently selected color.
7. Tap "撤销" — the line disappears in one undo step.

- [ ] **Step 3: Edge cases**

- Tap "形状▾", choose "切换为实心模式", then "矩形". Draw a small rectangle — confirm it fills completely.
- Choose "圆形" outline. Draw a small circle — confirm only the outline appears.
- Switch back to "画笔" via the existing pen button — confirm the shape preview state clears and pen works.
- Try drawing a shape that extends beyond the canvas edge — confirm out-of-bounds cells are silently clipped and no error toast.

- [ ] **Step 4: Capture a screenshot or short clip**

Save under `/tmp/weapp-shape-tools-verification.png` (or wherever your dev machine collects screenshots) for the merge note.

- [ ] **Step 5: If any issue is found, return to the relevant task to fix; otherwise proceed**

---

## Task 10: Squash-merge to miniapp/base

**Files:** none

- [ ] **Step 1: Make sure everything is committed on the feature branch**

Run:
```
git status
```
Expected: `nothing to commit, working tree clean`.

- [ ] **Step 2: Switch to miniapp/base and pull**

Run:
```
git checkout miniapp/base
git pull --ff-only
```

- [ ] **Step 3: Squash merge**

Run:
```
git merge --squash feature/weapp-shape-tools
```
Expected: changes staged.

- [ ] **Step 4: Commit with the summary message**

Run (HEREDOC for multi-line message):
```
git commit -m "feat(weapp): shape tools (line/rect/circle) with drag preview

Adds a 形状▾ grouped toolbar button with action sheet to choose between
line, rectangle, and circle tools. Shapes draw with live translucent
preview during drag and commit as a single undoable history entry.
Outline vs filled toggle for rect/circle. Vitest added to platforms/weapp
for testing the new pure shape utilities.

Spec: docs/superpowers/specs/2026-06-02-weapp-feature-migration-design.md"
```

- [ ] **Step 5: Verify the commit**

Run:
```
git log -1 --stat
```
Expected: one commit summarizing all the feature-branch work, listing the new files (shapeDrawing.ts, shapeDrawing.test.ts, vitest.config.ts, shapes.test.ts) and the modifications to result/index.tsx and package.json.

- [ ] **Step 6: Delete the feature branch**

Run:
```
git branch -d feature/weapp-shape-tools
```
Expected: `Deleted branch feature/weapp-shape-tools`.

- [ ] **Step 7: Hand off**

Notify the user that feature #1 is merged. Ask whether to proceed with feature #2 (blueprint mode + mirror) and write the next plan.

---

## Self-review checklist

- All tasks have file paths
- All test code is concrete (no "test the function" placeholders)
- Tool union, state names, ref names, function names, and CSS class names are consistent across all tasks
- The shape preview render reads `selectedColorIndex` and `overrides` — both are confirmed accessible in scope (the import for `getEffectiveHex` and `hexToRgb` already exists in result/index.tsx:6)
- Undo behavior follows the same `commitStroke` path used by pen/fill, so undo/redo works "for free"
- The toolbar layout adds exactly one new button — falls within Option A from the spec
