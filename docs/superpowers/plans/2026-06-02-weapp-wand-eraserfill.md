# Magic Wand + Region Erase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Add two tools to the existing toolbar: `eraserFill` (flood-erase a connected region) and `wand` (flood-select a connected same-color region). The wand result feeds into the existing selection infrastructure built in feature #3, so the same long-press menu (copy/cut/delete/fill) works on irregular wand selections.

**Architecture:** Two new tools added to the existing `Tool` union. `eraserFill` reuses the inline `floodReplace` helper already in `result/index.tsx` (writes null instead of a color). `wand` extracts a new `computeFloodSelectCells` pure function (returns the cell coords without mutating) and stores results in a new `selectionCellsIrregular: Set<string> | null` state field. drawCanvas's existing selection-outline pass is extended to outline irregular selection cells by drawing per-edge boundaries (a cell edge is part of the outline iff the neighbor on that side is NOT in the selection set). The long-press menu from feature #3 already handles cell-set operations.

**Tech Stack:** TypeScript, React 18, Taro 4 (weapp), Canvas 2D API.

**Branch:** `feature/weapp-wand-eraserfill` off `miniapp/base`.

**Spec reference:** `docs/superpowers/specs/2026-06-02-weapp-feature-migration-design.md` § "#4 Magic wand + region erase".

---

## File map

| File | Action | Purpose |
|---|---|---|
| `platforms/weapp/src/utils/floodFill.ts` | create | Pure `computeFloodReplaceEntries` (extracted from result/index.tsx) and new `computeFloodSelectCells` |
| `platforms/weapp/src/utils/floodFill.test.ts` | create | vitest unit tests |
| `platforms/weapp/src/pages/result/index.tsx` | modify | New tools `eraserFill` + `wand`; new state `selectionCellsIrregular`; touch handler branches; irregular outline render; long-press menu extension; toolbar group button "选区▾" replaces the bare 选区 button |
| `platforms/weapp/tests/e2e/wand.test.ts` | create | e2e: assert wand button toggles active state via the 选区▾ group action sheet |

---

## Task 0: Branch + baseline

- [ ] Confirm `miniapp/base` is clean, on it, pulled.
- [ ] `git checkout -b feature/weapp-wand-eraserfill`
- [ ] `cd platforms/weapp && npm run type-check` → exit 0.

---

## Task 1: floodFill utility (TDD)

### Step 1: Write failing tests

Create `platforms/weapp/src/utils/floodFill.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeFloodReplaceEntries, computeFloodSelectCells } from './floodFill';
import type { CanvasData } from '@pindou/core';

function makeCanvas(rows: (number | null)[][]): CanvasData {
  return rows.map((row) => row.map((idx) => ({ colorIndex: idx })));
}

describe('computeFloodReplaceEntries', () => {
  it('returns empty when target color already equals replaceWith', () => {
    const data = makeCanvas([[1, 1], [1, 1]]);
    expect(computeFloodReplaceEntries(data, 0, 0, 1, 2, 2)).toEqual([]);
  });

  it('replaces a connected region of the target color', () => {
    const data = makeCanvas([
      [1, 1, 2],
      [1, 1, 2],
      [3, 3, 2],
    ]);
    const entries = computeFloodReplaceEntries(data, 0, 0, 9, 3, 3);
    expect(entries).toHaveLength(4);
    expect(entries.every((e) => e.colorIndex === 9)).toBe(true);
    const keys = new Set(entries.map((e) => `${e.row},${e.col}`));
    expect(keys).toEqual(new Set(['0,0', '0,1', '1,0', '1,1']));
  });

  it('handles writing null (erase) over a colored region', () => {
    const data = makeCanvas([
      [5, 5],
      [5, 0],
    ]);
    const entries = computeFloodReplaceEntries(data, 0, 0, null, 2, 2);
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.colorIndex === null)).toBe(true);
  });

  it('returns empty when start coords are out of bounds', () => {
    const data = makeCanvas([[1]]);
    expect(computeFloodReplaceEntries(data, 5, 5, 2, 1, 1)).toEqual([]);
    expect(computeFloodReplaceEntries(data, -1, 0, 2, 1, 1)).toEqual([]);
  });

  it('does not cross diagonally (4-connected only)', () => {
    const data = makeCanvas([
      [1, 2],
      [2, 1],
    ]);
    const entries = computeFloodReplaceEntries(data, 0, 0, 9, 2, 2);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ row: 0, col: 0, colorIndex: 9 });
  });
});

describe('computeFloodSelectCells', () => {
  it('returns a set of "r,c" keys for the connected same-color region', () => {
    const data = makeCanvas([
      [1, 1, 2],
      [1, 1, 2],
      [3, 3, 2],
    ]);
    const cells = computeFloodSelectCells(data, 0, 0, 3, 3);
    expect(cells).toEqual(new Set(['0,0', '0,1', '1,0', '1,1']));
  });

  it('returns null cells region', () => {
    const data = makeCanvas([
      [null, null, 1],
      [null, 1, 1],
    ]);
    const cells = computeFloodSelectCells(data, 0, 0, 3, 2);
    expect(cells).toEqual(new Set(['0,0', '0,1', '1,0']));
  });

  it('returns empty set when start is out of bounds', () => {
    const data = makeCanvas([[1]]);
    expect(computeFloodSelectCells(data, 5, 5, 1, 1)).toEqual(new Set());
  });

  it('single cell when surrounded by different colors', () => {
    const data = makeCanvas([
      [2, 1, 2],
      [1, 5, 1],
      [2, 1, 2],
    ]);
    const cells = computeFloodSelectCells(data, 1, 1, 3, 3);
    expect(cells).toEqual(new Set(['1,1']));
  });
});
```

Run: `cd platforms/weapp && npm test` → fail (module not found).

### Step 2: Implement

Create `platforms/weapp/src/utils/floodFill.ts`:

```ts
import type { CanvasData } from '@pindou/core';

export interface FloodEntry {
  row: number;
  col: number;
  colorIndex: number | null;
}

export function computeFloodReplaceEntries(
  data: CanvasData,
  startRow: number,
  startCol: number,
  replaceWith: number | null,
  width: number,
  height: number,
): FloodEntry[] {
  if (startRow < 0 || startRow >= height || startCol < 0 || startCol >= width) return [];
  const target = data[startRow]?.[startCol]?.colorIndex ?? null;
  if (target === replaceWith) return [];
  const visited = new Set<string>();
  const stack: [number, number][] = [[startRow, startCol]];
  const entries: FloodEntry[] = [];
  while (stack.length > 0) {
    const [r, c] = stack.pop()!;
    const key = `${r},${c}`;
    if (visited.has(key)) continue;
    if (r < 0 || r >= height || c < 0 || c >= width) continue;
    const cellColor = data[r]?.[c]?.colorIndex ?? null;
    if (cellColor !== target) continue;
    visited.add(key);
    entries.push({ row: r, col: c, colorIndex: replaceWith });
    stack.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
  }
  return entries;
}

export function computeFloodSelectCells(
  data: CanvasData,
  startRow: number,
  startCol: number,
  width: number,
  height: number,
): Set<string> {
  const out = new Set<string>();
  if (startRow < 0 || startRow >= height || startCol < 0 || startCol >= width) return out;
  const target = data[startRow]?.[startCol]?.colorIndex ?? null;
  const stack: [number, number][] = [[startRow, startCol]];
  while (stack.length > 0) {
    const [r, c] = stack.pop()!;
    const key = `${r},${c}`;
    if (out.has(key)) continue;
    if (r < 0 || r >= height || c < 0 || c >= width) continue;
    const cellColor = data[r]?.[c]?.colorIndex ?? null;
    if (cellColor !== target) continue;
    out.add(key);
    stack.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
  }
  return out;
}
```

Run tests: all pass (9 tests across 2 describes).

Commit:
```
git add platforms/weapp/src/utils/floodFill.ts platforms/weapp/src/utils/floodFill.test.ts
git commit -m "feat(weapp): floodFill utils (replace + select) with tests"
```

---

## Task 2: Refactor inline floodReplace + add new tools

In `result/index.tsx`:

### Step 1: Remove the inline floodReplace function

Find the inline `floodReplace` function in `result/index.tsx` (~line 72-96 originally; may have moved). Delete it.

### Step 2: Import the new utils

Add to imports:

```ts
import { computeFloodReplaceEntries, computeFloodSelectCells } from '../../utils/floodFill';
```

### Step 3: Add `eraserFill` and `wand` to Tool union

Extend the Tool type with two more entries:

```ts
type Tool = 'pen' | 'eraser' | 'fill' | 'eyedropper' | 'pan' | 'line' | 'rect' | 'circle' | 'select' | 'eraserFill' | 'wand';
```

### Step 4: Add state for irregular selection cells

Near other selection state, add:

```ts
const [selectionCellsIrregular, setSelectionCellsIrregular] = useState<Set<string> | null>(null);
```

### Step 5: Update existing fill caller to use the new util

Find the existing `tool === 'fill'` branch in handleTouchStart that calls the inline `floodReplace`. Update it to use `computeFloodReplaceEntries` and apply the entries:

```ts
if (tool === 'fill' || tool === 'eraserFill') {
  const next = tool === 'eraserFill' ? null : selectedColorIndex;
  const entries = computeFloodReplaceEntries(
    dataRef.current,
    cell.row,
    cell.col,
    next,
    project.width,
    project.height,
  );
  if (entries.length === 0) return;
  const patches = entries.map((e) => ({
    row: e.row,
    col: e.col,
    prev: dataRef.current![e.row][e.col].colorIndex ?? null,
    next: e.colorIndex,
  }));
  for (const e of entries) {
    dataRef.current![e.row][e.col] = { colorIndex: e.colorIndex };
  }
  strokeRef.current = { patches, lastCell: null };
  commitStroke();
  setData(cloneData(dataRef.current));
  return;
}
```

This handles both `fill` and `eraserFill` in one block (they only differ in `next`).

### Step 6: Add `wand` branch in handleTouchStart

After the fill/eraserFill block, add:

```ts
if (tool === 'wand') {
  const cells = computeFloodSelectCells(
    dataRef.current,
    cell.row,
    cell.col,
    project.width,
    project.height,
  );
  if (cells.size === 0) return;
  setSelectionBounds(null);
  setSelectionCellsIrregular(cells);
  return;
}
```

### Step 7: Clear irregular selection appropriately

When the user activates the rectangular select tool from the toolbar, also clear `selectionCellsIrregular`. Locate the toolbar select button (added in feature #3, the `<View>` whose label is "选区" and onClick clears floatingPaste/mirror). Update its onClick:

```ts
onClick={() => {
  setFloatingPaste(null);
  setBlueprintMirror(false);
  setSelectionCellsIrregular(null);
  setSelectionBounds(null);
  setTool('select');
}}
```

When the user explicitly cancels (action sheet "取消选区"), clear both:

In the existing `openSelectionMenu` (added in feature #3), update the "取消选区" branch:

```ts
if (label === '取消选区') {
  setSelectionBounds(null);
  setSelectionCellsIrregular(null);
  return;
}
```

Type-check + commit:
```
cd platforms/weapp && npm run type-check && cd ../..
git add platforms/weapp/src/pages/result/index.tsx
git commit -m "feat(weapp): eraserFill + wand tools using floodFill utils"
```

---

## Task 3: Extend long-press menu and cell-set ops for irregular selections

In `result/index.tsx`:

### Step 1: Make `openSelectionMenu` accept either bounds or irregular cells

Refactor the existing `openSelectionMenu` to work with whichever is set. Find the function (created in feature #3). Replace the early `if (!selectionBounds || !dataRef.current) return;` with:

```ts
if (!dataRef.current) return;
const haveBounds = !!selectionBounds;
const haveIrregular = !!selectionCellsIrregular && selectionCellsIrregular.size > 0;
if (!haveBounds && !haveIrregular) return;
```

Where the code uses `rectSelectionCells(selectionBounds)` to get the cell set, replace with:

```ts
const sCells: Set<string> = haveIrregular
  ? selectionCellsIrregular!
  : rectSelectionCells(selectionBounds!);
```

For the 复制 / 剪切 branches that create a `ClipboardPayload`, an irregular region is not a tight rectangle. Use `cloneSelectionRegion` with a bounding box. Add this helper inline before the existing `cloneSelectionRegion` call:

```ts
function boundsFromCells(cells: Set<string>): SelectionBounds {
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (const key of cells) {
    const [rStr, cStr] = key.split(',');
    const r = Number(rStr);
    const c = Number(cStr);
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
  }
  return { r1: minR, c1: minC, r2: maxR, c2: maxC };
}
```

Then replace the existing payload-creating line with:

```ts
const boundsForClone: SelectionBounds = haveBounds ? selectionBounds! : boundsFromCells(selectionCellsIrregular!);
const payload = cloneSelectionRegion(d, boundsForClone);
```

(For irregular selections, the clipboard payload will include some null cells outside the actual selection but inside its bounding box. That's acceptable for the v1 — paste will overlay the bounding-box-shape region. A future enhancement could mask the clipboard to only the actual cells.)

For the 取消选区 branch, clear both:

```ts
if (label === '取消选区') {
  setSelectionBounds(null);
  setSelectionCellsIrregular(null);
  return;
}
```

### Step 2: Update the `openSelectionMenu` deps array

```ts
}, [selectionBounds, selectionCellsIrregular, project, selectedColorIndex, commitStroke]);
```

### Step 3: Update the long-press gate

The existing `onLongPress` handler on the canvas (added in feature #3) reads `selectionBounds`. Extend it to also trigger when `selectionCellsIrregular` is set:

```tsx
onLongPress={() => {
  if (
    (tool === 'select' || tool === 'wand') &&
    (selectionBounds || (selectionCellsIrregular && selectionCellsIrregular.size > 0)) &&
    !floatingPaste
  ) {
    openSelectionMenu();
  }
}}
```

Type-check + commit:
```
cd platforms/weapp && npm run type-check && cd ../..
git add platforms/weapp/src/pages/result/index.tsx
git commit -m "feat(weapp): long-press menu works on wand (irregular) selections too"
```

---

## Task 4: Render irregular selection outline

In `result/index.tsx`:

### Step 1: Extend the drawCanvas overlay block

In drawCanvas, after the existing `selectionBounds` outline render (blue dashed rect), add:

```ts
if (selectionCellsIrregular && selectionCellsIrregular.size > 0) {
  ctx.save();
  ctx.fillStyle = 'rgba(80, 180, 100, 0.18)';
  for (const key of selectionCellsIrregular) {
    const [rStr, cStr] = key.split(',');
    const r = Number(rStr);
    const c = Number(cStr);
    ctx.fillRect(c * cell, r * cell, cell, cell);
  }
  ctx.strokeStyle = 'rgba(40, 120, 60, 0.95)';
  ctx.lineWidth = Math.max(1, cell * 0.06);
  ctx.beginPath();
  for (const key of selectionCellsIrregular) {
    const [rStr, cStr] = key.split(',');
    const r = Number(rStr);
    const c = Number(cStr);
    // Each edge contributes to the outline iff the neighbor is NOT in the set.
    if (!selectionCellsIrregular.has(`${r - 1},${c}`)) {
      ctx.moveTo(c * cell, r * cell);
      ctx.lineTo((c + 1) * cell, r * cell);
    }
    if (!selectionCellsIrregular.has(`${r + 1},${c}`)) {
      ctx.moveTo(c * cell, (r + 1) * cell);
      ctx.lineTo((c + 1) * cell, (r + 1) * cell);
    }
    if (!selectionCellsIrregular.has(`${r},${c - 1}`)) {
      ctx.moveTo(c * cell, r * cell);
      ctx.lineTo(c * cell, (r + 1) * cell);
    }
    if (!selectionCellsIrregular.has(`${r},${c + 1}`)) {
      ctx.moveTo((c + 1) * cell, r * cell);
      ctx.lineTo((c + 1) * cell, (r + 1) * cell);
    }
  }
  ctx.stroke();
  ctx.restore();
}
```

### Step 2: Add `selectionCellsIrregular` to drawCanvas and useEffect deps

```ts
// drawCanvas useCallback deps
}, [project, shapePreview, selectedColorIndex, overrides, blueprintMode, blueprintMirror, selectionBounds, floatingPaste, selectionCellsIrregular]);

// useEffect that calls drawCanvas
}, [project, data, view, drawCanvas, overrides, showGrid, shapePreview, blueprintMode, blueprintMirror, selectionBounds, floatingPaste, selectionCellsIrregular]);
```

Type-check + build + commit:
```
cd platforms/weapp && npm run type-check && npm run build:weapp && cd ../..
git add platforms/weapp/src/pages/result/index.tsx
git commit -m "feat(weapp): render per-edge outline for wand (irregular) selections"
```

---

## Task 5: Replace toolbar select button with "选区▾" group button

In `result/index.tsx`:

### Step 1: Add openSelectionToolMenu callback

Near the other menu openers, add:

```ts
const openSelectionToolMenu = useCallback(() => {
  const isSelect = tool === 'select';
  const isWand = tool === 'wand';
  const isEraserFill = tool === 'eraserFill';
  const items = [
    `矩形选区${isSelect ? ' ✓' : ''}`,
    `魔棒${isWand ? ' ✓' : ''}`,
    `区域擦除${isEraserFill ? ' ✓' : ''}`,
  ];
  Taro.showActionSheet({
    itemList: items,
    success: (res) => {
      const label = items[res.tapIndex];
      const switchTo = (next: Tool) => {
        setFloatingPaste(null);
        setBlueprintMirror(false);
        setSelectionCellsIrregular(null);
        setSelectionBounds(null);
        setTool(next);
      };
      if (label.startsWith('矩形选区')) switchTo('select');
      else if (label.startsWith('魔棒')) switchTo('wand');
      else if (label.startsWith('区域擦除')) switchTo('eraserFill');
    },
  });
}, [tool]);
```

### Step 2: Replace the bare 选区 button with the group button

Find the existing `<View>` for the 选区 button (added in feature #3, with `⬚` icon and onClick that sets tool=select). Replace it with:

```tsx
<View
  className={`editor__tool${
    tool === 'select' || tool === 'wand' || tool === 'eraserFill' ? ' editor__tool--active' : ''
  }`}
  onClick={openSelectionToolMenu}
>
  <Text className="editor__tool-icon">
    {tool === 'wand' ? '✦' : tool === 'eraserFill' ? '🧽' : '⬚'}
  </Text>
  <Text className="editor__tool-label">选区▾</Text>
</View>
```

Type-check + build + commit:
```
cd platforms/weapp && npm run type-check && npm run build:weapp && cd ../..
git add platforms/weapp/src/pages/result/index.tsx
git commit -m "feat(weapp): 选区▾ grouped toolbar button (select/wand/eraserFill)"
```

---

## Task 6: e2e test

Create `platforms/weapp/tests/e2e/wand.test.ts`:

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

describe('PinDou miniapp - wand + eraserFill', () => {
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

  it('activates wand via the 选区▾ group button', async () => {
    const project = makeProject('p-wand', 'Wand Test', 20, 20);
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
    let selIdx = -1;
    for (let i = 0; i < allLabels.length; i++) {
      const text = await allLabels[i].text();
      if (text && text.includes('选区')) {
        selIdx = i;
        break;
      }
    }
    expect(selIdx).toBeGreaterThanOrEqual(0);

    // Stub action sheet to pick 魔棒 (tapIndex 1)
    await mp.mockWxMethod('showActionSheet', { tapIndex: 1, errMsg: 'showActionSheet:ok' });
    await allTools[selIdx].tap();
    await page.waitFor(300);
    await mp.restoreWxMethod('showActionSheet');

    const cls = await allTools[selIdx].attribute('class');
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
git add platforms/weapp/tests/e2e/wand.test.ts
git commit -m "test(weapp): e2e for 选区▾ group button → wand activation"
```

---

## Task 7: Squash-merge

```
git status                                                # clean
git checkout miniapp/base
git pull --ff-only
git merge --squash feature/weapp-wand-eraserfill
git status                                                # restore any unrelated changes
git commit -m "$(cat <<'EOF'
feat(weapp): magic wand + region erase tools

Adds two new tools to the editor:

- 区域擦除 (eraserFill): flood-fills a connected region with null (eraser),
  using the same code path as the existing 油漆桶 with a null target.
- 魔棒 (wand): flood-selects a connected same-color region. The result
  populates an "irregular" selection set rendered with a per-edge green
  outline. The existing long-press menu from selection works on wand
  selections too — copy/cut produce a bounding-box-shaped clipboard
  payload, fill applies to exactly the wand cells.

Toolbar's bare 选区 button becomes a 选区▾ group button that opens an
action sheet for: 矩形选区 / 魔棒 / 区域擦除. Switching between them
clears any pending selection state to avoid coord confusion.

floodFill logic extracted to src/utils/floodFill.ts (replaces the
inline floodReplace in result/index.tsx). 9 vitest unit tests cover
replace + select with 4-connected boundary, bounds clamping, no-op
detection.

Spec: docs/superpowers/specs/2026-06-02-weapp-feature-migration-design.md
EOF
)"
git branch -D feature/weapp-wand-eraserfill
```

---

## Self-review checklist

- `computeFloodReplaceEntries` and old inline `floodReplace` behave identically; the migration is mechanical
- `wand` selections do NOT overwrite `selectionBounds` — they use their own `selectionCellsIrregular` state, so the two never coexist (one is set, the other cleared)
- Long-press menu correctly dispatches both flavors via the same callback
- Switching tools via the 选区▾ group button clears all prior selection/paste/mirror state
- The bare `区域擦除` operation is undoable (uses commitStroke)
- The per-edge outline render is O(N) in cells; for typical wand selections (<500 cells) negligible
- Copy-from-irregular uses the bounding-box clone (cells outside the actual selection but inside the bbox are nulls in the payload); paste targets a bbox-shaped region. Documented as v1 limitation in the commit message
