# Selection + Clipboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Add a rectangular `select` tool plus copy / cut / paste / delete operations. Paste is a floating preview that must be confirmed before committing as a single history entry.

**Architecture:** Selection state lives in `result/index.tsx` locally (no global store). Rectangle selections store bounds + cells; clipboard is an in-memory `useRef` (not persisted, matching desktop). Paste creates a `floatingSelection` overlay that can be dragged; a top-floating "确认/取消" bar commits or discards. Long-press inside the selection opens an action sheet with the usual ops. Pure helpers (`rectSelectionCells`, `cloneSelectionRegion`, `applyClipboardToData`) live in `platforms/weapp/src/utils/selectionUtils.ts` with vitest coverage.

**Tech Stack:** TypeScript, React 18, Taro 4 (weapp), Canvas 2D API.

**Branch:** `feature/weapp-selection` off `miniapp/base`.

**Spec reference:** `docs/superpowers/specs/2026-06-02-weapp-feature-migration-design.md` § "#3 Selection + copy/cut/paste".

---

## File map

| File | Action | Purpose |
|---|---|---|
| `platforms/weapp/src/utils/selectionUtils.ts` | create | Pure helpers: rect→cells, region clone, clipboard apply, bounds clamp |
| `platforms/weapp/src/utils/selectionUtils.test.ts` | create | vitest unit tests |
| `platforms/weapp/src/pages/result/index.tsx` | modify | New tool `select`, selection state, clipboard ref, floating paste state, touch branches, render selection outline + paste overlay, long-press menu, confirm/cancel float bar, toolbar group button |
| `platforms/weapp/src/pages/result/index.scss` | modify | Styles for confirm/cancel floating bar |
| `platforms/weapp/tests/e2e/selection.test.ts` | create | e2e: activate select tool → assert state |

---

## Task 0: Create branch + baseline

- [ ] **Step 1: Confirm clean tree, on miniapp/base**

```
git status
git branch --show-current
```

- [ ] **Step 2: Pull, then branch**

```
git pull --ff-only
git checkout -b feature/weapp-selection
```

- [ ] **Step 3: Sanity build**

```
cd platforms/weapp && npm run type-check && cd ../..
```

---

## Task 1: selectionUtils (TDD)

### Step 1: Write the failing test

Create `platforms/weapp/src/utils/selectionUtils.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  rectSelectionCells,
  cloneSelectionRegion,
  applyClipboardToData,
  type ClipboardPayload,
  type SelectionBounds,
} from './selectionUtils';
import type { CanvasData } from '@pindou/core';

function emptyCanvas(w: number, h: number): CanvasData {
  return Array.from({ length: h }, () =>
    Array.from({ length: w }, () => ({ colorIndex: null as number | null })),
  );
}

function filledCanvas(w: number, h: number, idx: number | null): CanvasData {
  return Array.from({ length: h }, () =>
    Array.from({ length: w }, () => ({ colorIndex: idx })),
  );
}

describe('rectSelectionCells', () => {
  it('handles point order independence', () => {
    const a = rectSelectionCells({ r1: 0, c1: 0, r2: 1, c2: 1 });
    const b = rectSelectionCells({ r1: 1, c1: 1, r2: 0, c2: 0 });
    expect(a).toEqual(b);
  });

  it('includes both endpoints', () => {
    const cells = rectSelectionCells({ r1: 1, c1: 2, r2: 3, c2: 4 });
    expect(cells.has('1,2')).toBe(true);
    expect(cells.has('3,4')).toBe(true);
    expect(cells.size).toBe(3 * 3);
  });
});

describe('cloneSelectionRegion', () => {
  it('extracts a width-clamped rectangular region', () => {
    const data = filledCanvas(4, 4, 7);
    const payload = cloneSelectionRegion(data, { r1: 1, c1: 1, r2: 2, c2: 2 });
    expect(payload.w).toBe(2);
    expect(payload.h).toBe(2);
    expect(payload.cells).toEqual([
      [7, 7],
      [7, 7],
    ]);
  });

  it('records null cells', () => {
    const data = emptyCanvas(3, 3);
    data[1][1] = { colorIndex: 5 };
    const payload = cloneSelectionRegion(data, { r1: 0, c1: 0, r2: 2, c2: 2 });
    expect(payload.cells[1][1]).toBe(5);
    expect(payload.cells[0][0]).toBe(null);
  });
});

describe('applyClipboardToData', () => {
  it('writes payload cells starting at offset, clamps to canvas bounds, returns patches', () => {
    const data = emptyCanvas(4, 4);
    const payload: ClipboardPayload = {
      w: 2,
      h: 2,
      cells: [
        [9, 9],
        [9, null],
      ],
    };
    const patches = applyClipboardToData(data, payload, 1, 1);
    expect(patches).toHaveLength(3);
    expect(patches.find((p) => p.row === 1 && p.col === 1 && p.next === 9)).toBeTruthy();
    expect(patches.find((p) => p.row === 2 && p.col === 2 && p.next === null)).toBeUndefined();
    expect(data[1][1].colorIndex).toBe(9);
    expect(data[2][2].colorIndex).toBe(null);
  });

  it('does not write patches when prev equals next', () => {
    const data = filledCanvas(3, 3, 4);
    const payload: ClipboardPayload = { w: 2, h: 2, cells: [[4, 4], [4, 4]] };
    const patches = applyClipboardToData(data, payload, 0, 0);
    expect(patches).toHaveLength(0);
  });

  it('clamps offsets that put part of the payload off-canvas', () => {
    const data = emptyCanvas(3, 3);
    const payload: ClipboardPayload = {
      w: 3,
      h: 3,
      cells: [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ],
    };
    const patches = applyClipboardToData(data, payload, 1, 1);
    expect(patches.find((p) => p.row === 3 || p.col === 3)).toBeUndefined();
    expect(patches.find((p) => p.row === 2 && p.col === 2 && p.next === 5)).toBeTruthy();
  });
});

describe('type exports', () => {
  it('SelectionBounds shape compiles', () => {
    const b: SelectionBounds = { r1: 0, c1: 0, r2: 0, c2: 0 };
    expect(b).toBeTruthy();
  });
});
```

Run `cd platforms/weapp && npm test`. Expected: FAIL (module not found).

### Step 2: Implement selectionUtils

Create `platforms/weapp/src/utils/selectionUtils.ts`:

```ts
import type { CanvasData } from '@pindou/core';

export interface SelectionBounds {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export interface ClipboardPayload {
  w: number;
  h: number;
  cells: (number | null)[][];
}

export interface CellPatch {
  row: number;
  col: number;
  prev: number | null;
  next: number | null;
}

export function rectSelectionCells(b: SelectionBounds): Set<string> {
  const minR = Math.min(b.r1, b.r2);
  const maxR = Math.max(b.r1, b.r2);
  const minC = Math.min(b.c1, b.c2);
  const maxC = Math.max(b.c1, b.c2);
  const out = new Set<string>();
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      out.add(`${r},${c}`);
    }
  }
  return out;
}

export function cloneSelectionRegion(data: CanvasData, b: SelectionBounds): ClipboardPayload {
  const minR = Math.min(b.r1, b.r2);
  const maxR = Math.max(b.r1, b.r2);
  const minC = Math.min(b.c1, b.c2);
  const maxC = Math.max(b.c1, b.c2);
  const h = maxR - minR + 1;
  const w = maxC - minC + 1;
  const cells: (number | null)[][] = [];
  for (let r = 0; r < h; r++) {
    const row: (number | null)[] = [];
    for (let c = 0; c < w; c++) {
      const v = data[minR + r]?.[minC + c]?.colorIndex;
      row.push(v ?? null);
    }
    cells.push(row);
  }
  return { w, h, cells };
}

export function applyClipboardToData(
  data: CanvasData,
  payload: ClipboardPayload,
  offsetRow: number,
  offsetCol: number,
): CellPatch[] {
  const patches: CellPatch[] = [];
  const height = data.length;
  const width = data[0]?.length ?? 0;
  for (let r = 0; r < payload.h; r++) {
    for (let c = 0; c < payload.w; c++) {
      const tr = offsetRow + r;
      const tc = offsetCol + c;
      if (tr < 0 || tr >= height || tc < 0 || tc >= width) continue;
      const prev = data[tr][tc].colorIndex ?? null;
      const next = payload.cells[r][c];
      if (prev === next) continue;
      data[tr][tc] = { colorIndex: next };
      patches.push({ row: tr, col: tc, prev, next });
    }
  }
  return patches;
}
```

Run tests: all pass (10 tests across 4 describes).

Type-check + commit:
```
cd platforms/weapp && npm run type-check && cd ../..
git add platforms/weapp/src/utils/selectionUtils.ts platforms/weapp/src/utils/selectionUtils.test.ts
git commit -m "feat(weapp): selection utility helpers (rect / clone / apply) with tests"
```

---

## Task 2: Selection state + tool registration

In `result/index.tsx`:

### Step 1: Extend Tool union

Find current `Tool` type (after feature #1 it includes `'line' | 'rect' | 'circle'`). Add `'select'`:

```ts
type Tool = 'pen' | 'eraser' | 'fill' | 'eyedropper' | 'pan' | 'line' | 'rect' | 'circle' | 'select';
```

### Step 2: Import selection helpers

Add at the top (after existing imports):

```ts
import {
  rectSelectionCells,
  cloneSelectionRegion,
  applyClipboardToData,
  type ClipboardPayload,
  type SelectionBounds,
} from '../../utils/selectionUtils';
```

### Step 3: Add state + ref

Near other tool state (after the shape state added in feature #1), add:

```ts
const [selectionBounds, setSelectionBounds] = useState<SelectionBounds | null>(null);
const [floatingPaste, setFloatingPaste] = useState<{
  payload: ClipboardPayload;
  offsetRow: number;
  offsetCol: number;
} | null>(null);
const selectionDragRef = useRef<{ startRow: number; startCol: number } | null>(null);
const pasteDragRef = useRef<{ startTouchX: number; startTouchY: number; startOffsetRow: number; startOffsetCol: number } | null>(null);
const clipboardRef = useRef<ClipboardPayload | null>(null);
```

### Step 4: Type-check and commit

```
cd platforms/weapp && npm run type-check && cd ../..
git add platforms/weapp/src/pages/result/index.tsx
git commit -m "feat(weapp): selection state, clipboard ref, floating paste state"
```

---

## Task 3: Selection drag touch handlers

In `result/index.tsx`:

### Step 1: handleTouchStart select branch

After the existing shape branch in handleTouchStart, add a `select` branch (and a `floatingPaste` precedence check before any tool dispatch):

Find the start of single-touch handling in handleTouchStart (just before the `if (tool === 'pan')` block). Insert AT THE TOP of single-touch handling:

```ts
// Floating paste takes precedence — touch-drag moves the floating region.
if (floatingPaste && touches.length === 1) {
  const { x, y } = touches[0];
  pasteDragRef.current = {
    startTouchX: x,
    startTouchY: y,
    startOffsetRow: floatingPaste.offsetRow,
    startOffsetCol: floatingPaste.offsetCol,
  };
  return;
}
```

Then, after the `fill` branch and before the `applyCellEdit` fallback, add (alongside the shape branch):

```ts
if (tool === 'select') {
  selectionDragRef.current = { startRow: cell.row, startCol: cell.col };
  setSelectionBounds({ r1: cell.row, c1: cell.col, r2: cell.row, c2: cell.col });
  return;
}
```

### Step 2: handleTouchMove select branch + paste drag

In handleTouchMove, AFTER the existing pan check and BEFORE the pen/eraser/shape branches, add:

```ts
if (floatingPaste && pasteDragRef.current) {
  const dx = x - pasteDragRef.current.startTouchX;
  const dy = y - pasteDragRef.current.startTouchY;
  const scale = viewRef.current.scale;
  const cellPx = cellBaseRef.current * scale;
  const dCol = Math.round(dx / cellPx);
  const dRow = Math.round(dy / cellPx);
  setFloatingPaste((cur) => cur && {
    ...cur,
    offsetRow: pasteDragRef.current!.startOffsetRow + dRow,
    offsetCol: pasteDragRef.current!.startOffsetCol + dCol,
  });
  return;
}

if (tool === 'select' && selectionDragRef.current) {
  const cell = pickCell(x, y);
  if (!cell) return;
  setSelectionBounds({
    r1: selectionDragRef.current.startRow,
    c1: selectionDragRef.current.startCol,
    r2: cell.row,
    c2: cell.col,
  });
  return;
}
```

### Step 3: handleTouchEnd select cleanup

In handleTouchEnd, after the shape commit branch and before the pen/eraser commitStroke branch, add:

```ts
if (selectionDragRef.current) {
  selectionDragRef.current = null;
  return;
}
if (pasteDragRef.current) {
  pasteDragRef.current = null;
  return;
}
```

### Step 4: Type-check and commit

```
cd platforms/weapp && npm run type-check && cd ../..
git add platforms/weapp/src/pages/result/index.tsx
git commit -m "feat(weapp): selection drag + floating paste drag touch handlers"
```

---

## Task 4: Render selection outline + paste overlay

In `result/index.tsx`:

### Step 1: Add overlay render inside drawCanvas

Inside `drawCanvas`, AFTER the shapePreview overlay block and BEFORE the grid line drawing, add:

```ts
if (selectionBounds) {
  const b = selectionBounds;
  const minR = Math.min(b.r1, b.r2);
  const maxR = Math.max(b.r1, b.r2);
  const minC = Math.min(b.c1, b.c2);
  const maxC = Math.max(b.c1, b.c2);
  const x = minC * cell;
  const y = minR * cell;
  const w = (maxC - minC + 1) * cell;
  const h = (maxR - minR + 1) * cell;
  ctx.save();
  ctx.fillStyle = 'rgba(80, 130, 255, 0.15)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(40, 80, 220, 0.9)';
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = Math.max(1, cell * 0.05);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.restore();
}

if (floatingPaste) {
  const fp = floatingPaste;
  ctx.save();
  ctx.globalAlpha = 0.85;
  for (let r = 0; r < fp.payload.h; r++) {
    for (let c = 0; c < fp.payload.w; c++) {
      const tr = fp.offsetRow + r;
      const tc = fp.offsetCol + c;
      if (tr < 0 || tr >= project.height || tc < 0 || tc >= project.width) continue;
      const idx = fp.payload.cells[r][c];
      if (idx === null) continue;
      ctx.fillStyle = getEffectiveHex(idx, overrides);
      ctx.fillRect(tc * cell, tr * cell, cell, cell);
    }
  }
  ctx.globalAlpha = 1;
  // Outline the floating region
  ctx.strokeStyle = 'rgba(220, 80, 40, 0.9)';
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = Math.max(1, cell * 0.05);
  const minR = Math.max(0, fp.offsetRow);
  const minC = Math.max(0, fp.offsetCol);
  const maxR = Math.min(project.height, fp.offsetRow + fp.payload.h);
  const maxC = Math.min(project.width, fp.offsetCol + fp.payload.w);
  if (maxR > minR && maxC > minC) {
    ctx.strokeRect(minC * cell, minR * cell, (maxC - minC) * cell, (maxR - minR) * cell);
  }
  ctx.setLineDash([]);
  ctx.restore();
}
```

### Step 2: Add deps

Add `selectionBounds, floatingPaste` to drawCanvas useCallback deps. Add the same to the useEffect that drives drawCanvas.

### Step 3: Type-check + build

```
cd platforms/weapp && npm run type-check && npm run build:weapp && cd ../..
```

### Step 4: Commit

```
git add platforms/weapp/src/pages/result/index.tsx
git commit -m "feat(weapp): render selection outline + floating paste overlay"
```

---

## Task 5: Long-press menu on selection

In `result/index.tsx`:

### Step 1: Add `openSelectionMenu` and the long-press wiring

Add the menu opener near other menu callbacks:

```ts
const openSelectionMenu = useCallback(() => {
  if (!selectionBounds || !dataRef.current) return;
  const sc = MARD_COLORS[selectedColorIndex]?.code || '当前色';
  const items = ['复制', '剪切', '删除', `填充为 ${sc}`, '取消选区'];
  Taro.showActionSheet({
    itemList: items,
    success: (res) => {
      const label = items[res.tapIndex];
      if (label === '取消选区') {
        setSelectionBounds(null);
        return;
      }
      const d = dataRef.current;
      if (!d || !project) return;
      const payload = cloneSelectionRegion(d, selectionBounds);
      if (label === '复制') {
        clipboardRef.current = payload;
        Taro.showToast({ title: `已复制 ${payload.w}×${payload.h}`, icon: 'success' });
        return;
      }
      // For cut/delete/fill we apply patches in-place and use the existing
      // strokeRef + commitStroke pipeline so undo gets one entry.
      const sCells = rectSelectionCells(selectionBounds);
      const patches: { row: number; col: number; prev: number | null; next: number | null }[] = [];
      const fillIdx = label === `填充为 ${sc}` ? selectedColorIndex : null;
      for (const key of sCells) {
        const [rStr, cStr] = key.split(',');
        const r = Number(rStr);
        const c = Number(cStr);
        const prev = d[r][c].colorIndex ?? null;
        if (prev === fillIdx) continue;
        d[r][c] = { colorIndex: fillIdx };
        patches.push({ row: r, col: c, prev, next: fillIdx });
      }
      if (patches.length > 0) {
        strokeRef.current = { patches, lastCell: null };
        commitStroke();
        setData(cloneData(dataRef.current));
      }
      if (label === '剪切') {
        clipboardRef.current = payload;
        Taro.showToast({ title: `已剪切 ${payload.w}×${payload.h}`, icon: 'success' });
        setSelectionBounds(null);
      } else if (label === '删除') {
        Taro.showToast({ title: '已删除', icon: 'success' });
        setSelectionBounds(null);
      } else {
        Taro.showToast({ title: `已填充 ${patches.length} 颗`, icon: 'success' });
      }
    },
  });
}, [selectionBounds, project, selectedColorIndex, commitStroke]);
```

### Step 2: Wire onLongPress on the canvas

In the canvas JSX (search `<Canvas`), find where touch handlers are bound and add:

```tsx
onLongPress={(e) => {
  if (tool === 'select' && selectionBounds && !floatingPaste) {
    openSelectionMenu();
  }
}}
```

The exact JSX placement: add this prop alongside `onTouchStart` etc., e.g. right after `onTouchEnd={handleTouchEnd}`.

### Step 3: Type-check + commit

```
cd platforms/weapp && npm run type-check && cd ../..
git add platforms/weapp/src/pages/result/index.tsx
git commit -m "feat(weapp): long-press menu on selection (copy/cut/delete/fill/cancel)"
```

---

## Task 6: Paste flow + confirm/cancel floating bar

In `result/index.tsx`:

### Step 1: Add a paste-trigger button (in the existing menu or a new dedicated button)

In `openProjectMenu`, prepend `'粘贴'` to the items list ONLY when `clipboardRef.current` is non-null. Add the dispatcher branch:

```ts
const items = [];
if (clipboardRef.current) items.push('粘贴');
items.push('调整画布尺寸', ...); // existing items
// ...
else if (label === '粘贴') {
  if (clipboardRef.current && project) {
    const payload = clipboardRef.current;
    const offsetRow = Math.max(0, Math.floor((project.height - payload.h) / 2));
    const offsetCol = Math.max(0, Math.floor((project.width - payload.w) / 2));
    setFloatingPaste({ payload, offsetRow, offsetCol });
    setTool('select');
  }
}
```

Add `clipboardRef.current` reads — but since refs aren't reactive, the menu re-creates `items` on each invocation so the entry appears/disappears correctly.

### Step 2: Floating confirm/cancel bar

Below the canvas in the JSX (above or below the toolbar — search for the toolbar JSX and place this above it):

```tsx
{floatingPaste && (
  <View className="editor__paste-bar">
    <Text className="editor__paste-bar-info">
      粘贴 {floatingPaste.payload.w}×{floatingPaste.payload.h}
    </Text>
    <View className="editor__paste-bar-actions">
      <View
        className="editor__paste-bar-btn editor__paste-bar-btn--cancel"
        onClick={() => setFloatingPaste(null)}
      >
        <Text>取消</Text>
      </View>
      <View
        className="editor__paste-bar-btn editor__paste-bar-btn--confirm"
        onClick={() => {
          if (!floatingPaste || !dataRef.current) return;
          const patches = applyClipboardToData(
            dataRef.current,
            floatingPaste.payload,
            floatingPaste.offsetRow,
            floatingPaste.offsetCol,
          );
          if (patches.length > 0) {
            strokeRef.current = { patches, lastCell: null };
            commitStroke();
            setData(cloneData(dataRef.current));
          }
          setFloatingPaste(null);
        }}
      >
        <Text>确认</Text>
      </View>
    </View>
  </View>
)}
```

### Step 3: Style the bar

In `platforms/weapp/src/pages/result/index.scss`, append:

```scss
.editor__paste-bar {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
  z-index: 30;
  background: rgba(20, 20, 22, 0.88);
  color: #fff;
  border-radius: 12px;
  padding: 10px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.2);

  &-info {
    flex: 1;
  }

  &-actions {
    display: flex;
    gap: 8px;
  }

  &-btn {
    padding: 6px 14px;
    border-radius: 8px;
    font-size: 14px;

    &--cancel {
      background: rgba(255, 255, 255, 0.12);
    }

    &--confirm {
      background: linear-gradient(135deg, #ff5e62, #ff9966);
      color: #fff;
    }
  }
}
```

### Step 4: Type-check + build

```
cd platforms/weapp && npm run type-check && npm run build:weapp && cd ../..
```

### Step 5: Commit

```
git add platforms/weapp/src/pages/result/index.tsx platforms/weapp/src/pages/result/index.scss
git commit -m "feat(weapp): paste flow with confirm/cancel floating bar"
```

---

## Task 7: Add select to toolbar (re-use shape group pattern)

Replace the existing shape group button with a more general "更多▾" or add a parallel "选区" button. Cleaner: add a NEW button right next to shape group:

In the toolbar JSX (find the shape group button added in feature #1), add an adjacent button:

```tsx
<View
  className={`editor__tool${tool === 'select' ? ' editor__tool--active' : ''}`}
  onClick={() => {
    setFloatingPaste(null);
    setTool('select');
  }}
>
  <Text className="editor__tool-icon">⬚</Text>
  <Text className="editor__tool-label">选区</Text>
</View>
```

Type-check + build + commit:
```
cd platforms/weapp && npm run type-check && npm run build:weapp && cd ../..
git add platforms/weapp/src/pages/result/index.tsx
git commit -m "feat(weapp): select tool button in toolbar"
```

---

## Task 8: e2e test for select tool

Create `platforms/weapp/tests/e2e/selection.test.ts`:

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

describe('PinDou miniapp - selection tool', () => {
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

  it('activates the select tool from the toolbar', async () => {
    const project = makeProject('p-sel', 'Selection Test', 20, 20);
    await mp.callWxMethod('setStorage', { key: 'pindou:projects', data: [project] });

    const list = await mp.reLaunch('/pages/projects/index');
    await list.waitFor(400);
    const items = await list.$$('.projects__item');
    expect(items.length).toBeGreaterThan(0);
    await items[0].tap();
    await mp.evaluate(() => new Promise((r) => setTimeout(r, 500)));

    const page = await mp.currentPage();
    expect(page.path).toBe('pages/result/index');

    const allTools = await page.$$('.editor__tool');
    const allLabels = await page.$$('.editor__tool-label');
    expect(allLabels.length).toBe(allTools.length);
    let selectIdx = -1;
    for (let i = 0; i < allLabels.length; i++) {
      const text = await allLabels[i].text();
      if (text && text.includes('选区')) {
        selectIdx = i;
        break;
      }
    }
    expect(selectIdx).toBeGreaterThanOrEqual(0);

    await allTools[selectIdx].tap();
    await page.waitFor(200);
    const cls = await allTools[selectIdx].attribute('class');
    expect(cls).toMatch(/editor__tool--active/);
  }, 60_000);
});
```

Try running:
```
cd platforms/weapp && npm run test:e2e:build && cd ../..
```

Commit:
```
git add platforms/weapp/tests/e2e/selection.test.ts
git commit -m "test(weapp): e2e for select tool activation"
```

---

## Task 9: Squash-merge to miniapp/base

- [ ] `git status` clean
- [ ] `git checkout miniapp/base && git pull --ff-only`
- [ ] `git merge --squash feature/weapp-selection`
- [ ] `git status` — restore any unrelated changes
- [ ] Commit with summary message:

```
git commit -m "$(cat <<'EOF'
feat(weapp): rectangle selection + clipboard with paste preview

Adds a 选区 toolbar button that drag-selects a rectangle of cells. Long-
press inside the selection opens an action sheet: 复制 / 剪切 / 删除 /
填充为 <code> / 取消选区. Copy and cut populate an in-memory clipboard
(not persisted, matching the desktop editor). Pasting (from the project
menu, available only when the clipboard is non-empty) shows a draggable
floating preview at the canvas center with a top-screen "确认 / 取消"
bar; only the confirm commits a single undoable history entry.

Selection cells, region clone, and clipboard apply live as pure functions
in src/utils/selectionUtils.ts with 10 vitest unit tests.

Spec: docs/superpowers/specs/2026-06-02-weapp-feature-migration-design.md
EOF
)"
```

- [ ] `git branch -D feature/weapp-selection`

---

## Self-review checklist

- Selection bounds normalize via min/max so out-of-order drag still works
- floatingPaste drag uses ROUND of dx/dy so movement snaps to whole cells
- All clipboard operations (copy/cut/delete/fill/paste-confirm) use the existing strokeRef + commitStroke pipeline → undo is automatic
- Long-press only fires when in select tool, with bounds set, not paste-floating
- Paste button only shows in project menu when clipboard is non-null
- floatingPaste cleared when user explicitly cancels OR confirms; also cleared when switching to select tool from the toolbar
- Existing tools (pen / eraser / fill / etc) untouched
- No code shared with the desktop editor (per user decision)
