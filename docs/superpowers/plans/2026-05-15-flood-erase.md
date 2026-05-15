# Flood Erase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second eraser sub-mode (区域擦除) that flood-erases all connected cells of the same color, exposed via a flyout under the existing eraser button.

**Architecture:** Extract the BFS that powers the existing `fill` case into a pure helper module and expose `floodFill` / `floodErase` as Zustand store actions. Add `"eraserFill"` to the `EditorTool` union and a `lastEraserSubmode` field so the eraser button is sticky. The toolbar renders the eraser as a flyout group mirroring the existing shape-tools flyout pattern.

**Tech Stack:** React + Zustand store ([src/store/editorStore.ts](../../../src/store/editorStore.ts)), TypeScript, Vitest (root), Playwright webview tests (in `platforms/vscode/`).

**Reference spec:** [docs/superpowers/specs/2026-05-15-flood-erase-design.md](../specs/2026-05-15-flood-erase-design.md)

**Branch:** `feature/flood-erase` (already created)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/utils/floodFill.ts` | Create | Pure BFS that returns `{row, col, colorIndex}[]` entries for a flood-replace |
| `src/utils/floodFill.test.ts` | Create | Vitest unit tests for the helper |
| `src/types/index.ts` | Modify | Add `"eraserFill"` to `EditorTool` union |
| `src/store/editorStore.ts` | Modify | Add `lastEraserSubmode`, update `setTool`, add `floodFill` + `floodErase` actions |
| `src/components/Canvas/PixelCanvas.tsx` | Modify | Use `floodFill`/`floodErase` actions in the pointer handler; add `eraserFill` cursor + keyboard handling |
| `src/components/Canvas/CanvasToolbar.tsx` | Modify | Replace single eraser button with a flyout group (single 单格 / 区域 sub-modes) |
| `platforms/vscode/tests/drawing.spec.ts` | Modify | Update existing eraser-button test; add 4 new tests for flood erase + sticky sub-mode |

---

## Task 1: Pure flood-fill helper (TDD)

**Files:**
- Create: `src/utils/floodFill.ts`
- Create: `src/utils/floodFill.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `src/utils/floodFill.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeFloodReplaceEntries } from "./floodFill";
import type { CanvasData } from "../types";

function makeGrid(rows: (number | null)[][]): CanvasData {
  return rows.map((r) => r.map((c) => ({ colorIndex: c })));
}

describe("computeFloodReplaceEntries", () => {
  it("returns empty when target color equals replacement", () => {
    const grid = makeGrid([
      [1, 1],
      [1, 1],
    ]);
    expect(computeFloodReplaceEntries(grid, 0, 0, 1, 2, 2)).toEqual([]);
  });

  it("fills a 2x2 connected region of color 1 with color 2", () => {
    const grid = makeGrid([
      [1, 1, 3],
      [1, 1, 3],
      [3, 3, 3],
    ]);
    const entries = computeFloodReplaceEntries(grid, 0, 0, 2, 3, 3);
    expect(entries).toHaveLength(4);
    for (const e of entries) {
      expect(grid[e.row][e.col].colorIndex).toBe(1);
      expect(e.colorIndex).toBe(2);
    }
  });

  it("erases (replaces with null) a connected region of color 5", () => {
    const grid = makeGrid([
      [5, 5, null],
      [5, null, null],
    ]);
    const entries = computeFloodReplaceEntries(grid, 0, 0, null, 3, 2);
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.colorIndex === null)).toBe(true);
  });

  it("returns empty when clicking an empty cell with null replacement", () => {
    const grid = makeGrid([[null, null]]);
    expect(computeFloodReplaceEntries(grid, 0, 0, null, 2, 1)).toEqual([]);
  });

  it("does not cross to a disconnected region of the same color", () => {
    const grid = makeGrid([
      [1, 3, 1],
      [1, 3, 1],
    ]);
    // Click left island
    const entries = computeFloodReplaceEntries(grid, 0, 0, 2, 3, 2);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.col === 0)).toBe(true);
  });

  it("treats nulls as a color — empty regions flood as well", () => {
    const grid = makeGrid([
      [null, null, 1],
      [null, 1, 1],
    ]);
    const entries = computeFloodReplaceEntries(grid, 0, 0, 9, 3, 2);
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.colorIndex === 9)).toBe(true);
  });

  it("respects width/height bounds", () => {
    const grid = makeGrid([
      [1, 1],
      [1, 1],
    ]);
    // Pretend the canvas is only 1x1
    const entries = computeFloodReplaceEntries(grid, 0, 0, 2, 1, 1);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ row: 0, col: 0, colorIndex: 2 });
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run from repo root: `npx vitest run src/utils/floodFill.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

Create `src/utils/floodFill.ts`:

```ts
import type { CanvasData } from "../types";

export interface FloodEntry {
  row: number;
  col: number;
  colorIndex: number | null;
}

/**
 * Compute the cells affected by a 4-connected flood-replace starting at
 * (startRow, startCol). Returns an array of entries suitable for
 * `batchSetCells`. Returns empty if the target color already equals
 * `replaceWith` (no-op).
 */
export function computeFloodReplaceEntries(
  layerData: CanvasData,
  startRow: number,
  startCol: number,
  replaceWith: number | null,
  width: number,
  height: number,
): FloodEntry[] {
  if (startRow < 0 || startRow >= height || startCol < 0 || startCol >= width) {
    return [];
  }
  const target = layerData[startRow]?.[startCol]?.colorIndex ?? null;
  if (target === replaceWith) return [];

  const visited = new Set<string>();
  const queue: [number, number][] = [[startRow, startCol]];
  const entries: FloodEntry[] = [];

  while (queue.length > 0) {
    const [r, c] = queue.pop()!;
    const key = `${r},${c}`;
    if (visited.has(key)) continue;
    if (r < 0 || r >= height || c < 0 || c >= width) continue;
    const cellColor = layerData[r]?.[c]?.colorIndex ?? null;
    if (cellColor !== target) continue;
    visited.add(key);
    entries.push({ row: r, col: c, colorIndex: replaceWith });
    queue.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
  }

  return entries;
}
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `npx vitest run src/utils/floodFill.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/floodFill.ts src/utils/floodFill.test.ts
git commit -m "feat: add computeFloodReplaceEntries helper with tests"
```

---

## Task 2: Refactor existing fill case to use helper (no behavior change)

**Files:**
- Modify: `src/components/Canvas/PixelCanvas.tsx:749-778`

- [ ] **Step 1: Replace the inline BFS in the `case "fill"` handler**

In [src/components/Canvas/PixelCanvas.tsx](../../../src/components/Canvas/PixelCanvas.tsx), find the `case "fill":` block (currently lines 749-778) and replace its body with a call to the helper:

```ts
case "fill": {
  const state = useEditorStore.getState();
  const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
  if (layerIdx === -1) break;
  const layerData = state.layers[layerIdx].data;
  const entries = computeFloodReplaceEntries(
    layerData,
    row,
    col,
    selectedColorIndex,
    state.canvasSize.width,
    state.canvasSize.height,
  );
  if (entries.length > 0) {
    useEditorStore.getState().batchSetCells(entries);
  }
  break;
}
```

Add the import at the top of the file (next to the other `../../utils/...` imports):

```ts
import { computeFloodReplaceEntries } from "../../utils/floodFill";
```

- [ ] **Step 2: Verify the build and existing tests still pass**

Run from `platforms/vscode/`:
```bash
npm run build
npm run test:webview
```
Expected: all existing webview tests pass (this is a pure refactor).

- [ ] **Step 3: Commit**

```bash
git add src/components/Canvas/PixelCanvas.tsx
git commit -m "refactor: route fill tool through computeFloodReplaceEntries helper"
```

---

## Task 3: Add `eraserFill` to EditorTool union

**Files:**
- Modify: `src/types/index.ts:12`

- [ ] **Step 1: Update the union**

In [src/types/index.ts:12](../../../src/types/index.ts), change the line:

```ts
export type EditorTool = "pen" | "eraser" | "eyedropper" | "pan" | "fill" | "line" | "rect" | "circle" | "select" | "wand";
```

to:

```ts
export type EditorTool = "pen" | "eraser" | "eraserFill" | "eyedropper" | "pan" | "fill" | "line" | "rect" | "circle" | "select" | "wand";
```

- [ ] **Step 2: Run TypeScript build**

From root: `npx tsc --noEmit`
Expected: PASS (no type errors). The new value isn't used yet, so there's nothing else to fix.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add eraserFill to EditorTool union"
```

---

## Task 4: Add `lastEraserSubmode` state and update `setTool`

**Files:**
- Modify: `src/store/editorStore.ts` (interface ~line 50, default ~line 335, action ~line 459)

- [ ] **Step 1: Add the field to the `EditorState` interface**

In [src/store/editorStore.ts](../../../src/store/editorStore.ts), find the `// Tool state` section (around line 49-52):

```ts
  // Tool state
  currentTool: EditorTool;
  selectedColorIndex: number | null;
  highlightColorIndex: number | null;
```

Add after `currentTool`:

```ts
  currentTool: EditorTool;
  lastEraserSubmode: "eraser" | "eraserFill";
```

- [ ] **Step 2: Set the default**

In the same file find the initial state (search for `currentTool: "pan"` — around line 335) and add the default right after it:

```ts
  currentTool: "pan",
  lastEraserSubmode: "eraser",
```

- [ ] **Step 3: Update `setTool` to track the sub-mode**

Find `setTool: (tool) => set({ currentTool: tool }),` (around line 459) and replace with:

```ts
  setTool: (tool) => set((state) => ({
    currentTool: tool,
    lastEraserSubmode:
      tool === "eraser" || tool === "eraserFill"
        ? tool
        : state.lastEraserSubmode,
  })),
```

- [ ] **Step 4: Type-check**

Run from root: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/editorStore.ts
git commit -m "feat: track last-used eraser submode in the store"
```

---

## Task 5: Add `floodFill` / `floodErase` store actions + Playwright tests

The existing inline pointer handler does BFS then calls `batchSetCells`. We move that into store actions so they're testable via `callAction` (matching the project's webview test pattern documented in [drawing.spec.ts:11-20](../../../platforms/vscode/tests/drawing.spec.ts#L11-L20)).

**Files:**
- Modify: `src/store/editorStore.ts` (interface + implementation)
- Modify: `platforms/vscode/tests/drawing.spec.ts` (new tests)

- [ ] **Step 1: Write failing Playwright tests**

Append to the `test.describe("Drawing — store actions", ...)` block in `platforms/vscode/tests/drawing.spec.ts`, BEFORE the closing `});`:

```ts
  test("floodErase clears all connected cells of the clicked color", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    // Paint a 3x3 solid block of color 7 starting at (5, 5)
    const block = [];
    for (let r = 5; r < 8; r++) {
      for (let c = 5; c < 8; c++) {
        block.push({ row: r, col: c, colorIndex: 7 });
      }
    }
    await callAction(page, "batchSetCells", [block]);

    // Sanity: all 9 cells are color 7
    const before = await page.evaluate(() => {
      const d = (window as any).__pindouStore.getState().canvasData;
      const out: (number | null)[] = [];
      for (let r = 5; r < 8; r++) for (let c = 5; c < 8; c++) out.push(d[r][c].colorIndex);
      return out;
    });
    expect(before).toEqual(Array(9).fill(7));

    // Flood erase from the middle of the block
    await callAction(page, "floodErase", [6, 6]);

    const after = await page.evaluate(() => {
      const d = (window as any).__pindouStore.getState().canvasData;
      const out: (number | null)[] = [];
      for (let r = 5; r < 8; r++) for (let c = 5; c < 8; c++) out.push(d[r][c].colorIndex);
      return out;
    });
    expect(after).toEqual(Array(9).fill(null));
  });

  test("floodErase on an empty cell is a no-op (no history entry)", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    // Find an empty cell
    const empty = await page.evaluate(() => {
      const d = (window as any).__pindouStore.getState().canvasData;
      for (let r = 0; r < d.length; r++) {
        for (let c = 0; c < d[r].length; c++) {
          if (d[r][c].colorIndex == null) return { r, c };
        }
      }
      return null;
    });
    expect(empty).not.toBeNull();

    const undoBefore = (await getStoreState<any[]>(page, "undoStack")).length;
    await callAction(page, "floodErase", [empty!.r, empty!.c]);
    const undoAfter = (await getStoreState<any[]>(page, "undoStack")).length;
    expect(undoAfter).toBe(undoBefore);
  });

  test("floodErase produces a single undo step that restores the whole region", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    const block = [];
    for (let r = 10; r < 13; r++) {
      for (let c = 10; c < 13; c++) {
        block.push({ row: r, col: c, colorIndex: 4 });
      }
    }
    await callAction(page, "batchSetCells", [block]);

    await callAction(page, "floodErase", [11, 11]);
    // One undo should bring all 9 cells back
    await callAction(page, "undo", []);

    const restored = await page.evaluate(() => {
      const d = (window as any).__pindouStore.getState().canvasData;
      const out: (number | null)[] = [];
      for (let r = 10; r < 13; r++) for (let c = 10; c < 13; c++) out.push(d[r][c].colorIndex);
      return out;
    });
    expect(restored).toEqual(Array(9).fill(4));
  });

  test("setTool tracks lastEraserSubmode for eraser tools only", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);

    await callAction(page, "setTool", ["eraserFill"]);
    expect(await getStoreState(page, "lastEraserSubmode")).toBe("eraserFill");

    // Switching to pen does NOT reset the submode
    await callAction(page, "setTool", ["pen"]);
    expect(await getStoreState(page, "lastEraserSubmode")).toBe("eraserFill");

    await callAction(page, "setTool", ["eraser"]);
    expect(await getStoreState(page, "lastEraserSubmode")).toBe("eraser");
  });
```

- [ ] **Step 2: Run tests and confirm they fail**

From `platforms/vscode/`:
```bash
npm run test:webview
```
Expected: the 4 new tests FAIL — `floodErase` is not a store action.

- [ ] **Step 3: Add the actions to the store interface**

In [src/store/editorStore.ts](../../../src/store/editorStore.ts), in the `// Actions` block, add after `batchSetCells`:

```ts
  batchSetCells: (entries: { row: number; col: number; colorIndex: number | null }[]) => void;
  floodFill: (row: number, col: number, colorIndex: number | null) => void;
  floodErase: (row: number, col: number) => void;
  setTool: (tool: EditorTool) => void;
```

- [ ] **Step 4: Implement the actions**

In the same file, add the implementation right after the `batchSetCells` implementation (around line 457). Make sure `computeFloodReplaceEntries` is imported at the top:

```ts
import { computeFloodReplaceEntries } from "../utils/floodFill";
```

Then add:

```ts
  floodFill: (row, col, colorIndex) => {
    const state = get();
    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layerData = state.layers[layerIdx].data;
    const entries = computeFloodReplaceEntries(
      layerData,
      row,
      col,
      colorIndex,
      state.canvasSize.width,
      state.canvasSize.height,
    );
    if (entries.length > 0) get().batchSetCells(entries);
  },

  floodErase: (row, col) => {
    get().floodFill(row, col, null);
  },
```

- [ ] **Step 5: Run tests and confirm they pass**

From `platforms/vscode/`:
```bash
npm run test:webview
```
Expected: PASS — all 4 new tests + every existing test.

- [ ] **Step 6: Commit**

```bash
git add src/store/editorStore.ts platforms/vscode/tests/drawing.spec.ts
git commit -m "feat: add floodFill and floodErase store actions with tests"
```

---

## Task 6: Wire `eraserFill` into the canvas pointer + keyboard handlers

**Files:**
- Modify: `src/components/Canvas/PixelCanvas.tsx`

- [ ] **Step 1: Simplify the `fill` case + add `eraserFill` case in `applyTool`**

In [src/components/Canvas/PixelCanvas.tsx](../../../src/components/Canvas/PixelCanvas.tsx), find the `applyTool` switch (around line 742). Replace the `case "fill":` block (the one introduced in Task 2) with:

```ts
case "fill": {
  if (selectedColorIndex == null) break;
  useEditorStore.getState().floodFill(row, col, selectedColorIndex);
  break;
}
case "eraserFill": {
  useEditorStore.getState().floodErase(row, col);
  break;
}
```

You can now remove the now-unused `computeFloodReplaceEntries` import from this file (the store handles it).

- [ ] **Step 2: Update the cursor branch**

Find the cursor expression (around line 1162-1168):

```ts
currentTool === "eyedropper" || currentTool === "fill"
  ? "crosshair"
```

Change to:

```ts
currentTool === "eyedropper" || currentTool === "fill" || currentTool === "eraserFill"
  ? "crosshair"
```

- [ ] **Step 3: Update the keyboard shortcut**

Find the tool shortcut map (around lines 1131-1135):

```ts
const toolMap: Record<string, import("../../types").EditorTool> = {
  p: "pen", l: "line", r: "rect", c: "circle",
  f: "fill", e: "eraser", i: "eyedropper",
  s: "select", w: "wand",
};
const tool = toolMap[e.key.toLowerCase()];
```

Replace the line that uses the looked-up tool. The full block becomes:

```ts
const toolMap: Record<string, import("../../types").EditorTool> = {
  p: "pen", l: "line", r: "rect", c: "circle",
  f: "fill", e: "eraser", i: "eyedropper",
  s: "select", w: "wand",
};
let tool = toolMap[e.key.toLowerCase()];
if (tool === "eraser") {
  tool = useEditorStore.getState().lastEraserSubmode;
}
```

The rest of the keyboard handler that calls `setTool(tool)` stays the same.

- [ ] **Step 4: Verify ensemble**

From `platforms/vscode/`:
```bash
npm run build
npm run test:webview
```
Expected: all tests pass (no regression — pointer handler now routes through store actions and the keyboard map fall-through preserves the prior `E` behavior because `lastEraserSubmode` defaults to `"eraser"`).

- [ ] **Step 5: Commit**

```bash
git add src/components/Canvas/PixelCanvas.tsx
git commit -m "feat: route canvas pointer + keyboard handlers through eraserFill"
```

---

## Task 7: Refactor toolbar — eraser flyout group

**Files:**
- Modify: `src/components/Canvas/CanvasToolbar.tsx`

- [ ] **Step 1: Remove the single eraser entry from the `tools` array**

In [src/components/Canvas/CanvasToolbar.tsx:6-14](../../../src/components/Canvas/CanvasToolbar.tsx), change the `tools` constant from:

```ts
const tools: { id: EditorTool; label: string; icon: string; shortcut: string }[] = [
  { id: "select", label: "选区", icon: "⬚", shortcut: "S" },
  { id: "wand", label: "魔棒", icon: "✦", shortcut: "W" },
  { id: "pen", label: "画笔", icon: "✏️", shortcut: "P" },
  { id: "fill", label: "填充", icon: "🪣", shortcut: "F" },
  { id: "eraser", label: "橡皮擦", icon: "🩹", shortcut: "E" },
  { id: "eyedropper", label: "取色", icon: "💧", shortcut: "I" },
  { id: "pan", label: "平移", icon: "✋", shortcut: "Space" },
];
```

to (remove the eraser line):

```ts
const tools: { id: EditorTool; label: string; icon: string; shortcut: string }[] = [
  { id: "select", label: "选区", icon: "⬚", shortcut: "S" },
  { id: "wand", label: "魔棒", icon: "✦", shortcut: "W" },
  { id: "pen", label: "画笔", icon: "✏️", shortcut: "P" },
  { id: "fill", label: "填充", icon: "🪣", shortcut: "F" },
  { id: "eyedropper", label: "取色", icon: "💧", shortcut: "I" },
  { id: "pan", label: "平移", icon: "✋", shortcut: "Space" },
];
```

- [ ] **Step 2: Add the `eraserTools` array next to `shapeTools`**

After the `shapeTools` declaration (around line 20), add:

```ts
const eraserTools: { id: EditorTool; label: string; icon: string; shortcut: string }[] = [
  { id: "eraser",     label: "单格擦除", icon: "🩹", shortcut: "E" },
  { id: "eraserFill", label: "区域擦除", icon: "🧽", shortcut: "" },
];
```

- [ ] **Step 3: Add `lastEraserSubmode` + `showEraserMenu` and a wrapping `<div>` for the new flyout**

Update the component top section (around lines 23-26):

```ts
export function CanvasToolbar() {
  const currentTool = useEditorStore((s) => s.currentTool);
  const setTool = useEditorStore((s) => s.setTool);
  const lastEraserSubmode = useEditorStore((s) => s.lastEraserSubmode);

  const [showShapeMenu, setShowShapeMenu] = useState(false);
  const [showEraserMenu, setShowEraserMenu] = useState(false);
```

- [ ] **Step 4: Render the eraser flyout group between fill and eyedropper**

Inside the JSX, between the `tools.map(...)` block and the divider, the existing render order needs adjustment. The simplest non-invasive change: render basic tools split into two slices with the eraser group inserted in between. Replace the `{tools.map((t) => (` block (lines 80-90) with a manual interleaved render:

```tsx
{/* Basic tools (first slice: select, wand, pen, fill) */}
{tools.slice(0, 4).map((t) => (
  <button
    key={t.id}
    onClick={() => setTool(t.id)}
    className={`w-9 h-9 rounded flex items-center justify-center text-lg transition-colors
      ${currentTool === t.id ? "bg-blue-500 text-white shadow" : "hover:bg-gray-200"}`}
    title={`${t.label} (${t.shortcut})`}
  >
    {t.icon}
  </button>
))}

{/* Eraser tools flyout */}
<div className="relative">
  <button
    onClick={() => setShowEraserMenu(!showEraserMenu)}
    className={`w-9 h-9 rounded flex items-center justify-center text-lg transition-colors
      ${currentTool === "eraser" || currentTool === "eraserFill" ? "bg-blue-500 text-white shadow" : "hover:bg-gray-200"}`}
    title={`橡皮擦 (E)`}
  >
    {eraserTools.find((t) => t.id === lastEraserSubmode)?.icon || "🩹"}
  </button>
  {showEraserMenu && (
    <div className="absolute left-full top-0 ml-1 bg-white border rounded shadow-lg flex flex-col gap-0.5 p-1 z-50">
      {eraserTools.map((t) => (
        <button
          key={t.id}
          onClick={() => {
            setTool(t.id);
            setShowEraserMenu(false);
          }}
          className={`w-20 h-8 rounded flex items-center gap-1.5 px-2 text-xs transition-colors
            ${currentTool === t.id ? "bg-blue-500 text-white" : "hover:bg-gray-100"}`}
          title={t.shortcut ? `${t.label} (${t.shortcut})` : t.label}
        >
          <span className="text-sm">{t.icon}</span>
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  )}
</div>

{/* Basic tools (second slice: eyedropper, pan) */}
{tools.slice(4).map((t) => (
  <button
    key={t.id}
    onClick={() => setTool(t.id)}
    className={`w-9 h-9 rounded flex items-center justify-center text-lg transition-colors
      ${currentTool === t.id ? "bg-blue-500 text-white shadow" : "hover:bg-gray-200"}`}
    title={`${t.label} (${t.shortcut})`}
  >
    {t.icon}
  </button>
))}
```

(The two `.map` blocks render the same buttons — they're split so the eraser flyout sits in its old position. Acceptable duplication: 10 lines, no behavior fork.)

- [ ] **Step 5: Build and verify no TypeScript errors**

From root: `npx tsc --noEmit`
Expected: PASS.

From `platforms/vscode/`: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/Canvas/CanvasToolbar.tsx
git commit -m "feat: replace eraser toolbar button with a sub-mode flyout"
```

---

## Task 8: Update existing eraser button test + add new toolbar test

The existing test at [drawing.spec.ts:165-172](../../../platforms/vscode/tests/drawing.spec.ts#L165-L172) clicks the eraser button and expects `currentTool === "eraser"`. With the new flyout, clicking the parent button only opens the flyout, so the test must be updated. Then add coverage for picking 区域擦除 from the flyout.

**Files:**
- Modify: `platforms/vscode/tests/drawing.spec.ts`

- [ ] **Step 1: Replace the existing eraser button test**

Find the test at line 165:

```ts
test("clicking eraser toolbar button sets currentTool=eraser", async ({ page }) => {
  await setupPage(page);
  await loadProject(page);

  await callAction(page, "setTool", ["pen"]);
  await page.locator('button[title*="橡皮"], button[title*="Eraser"]').first().click();
  expect(await getStoreState(page, "currentTool")).toBe("eraser");
});
```

Replace with two tests:

```ts
test("eraser flyout: clicking 单格擦除 sets currentTool=eraser", async ({ page }) => {
  await setupPage(page);
  await loadProject(page);

  await callAction(page, "setTool", ["pen"]);

  // Open the eraser flyout (parent button has title containing "橡皮")
  await page.locator('button[title*="橡皮"]').first().click();
  // Pick 单格擦除 from the flyout
  await page.locator('button[title^="单格擦除"]').first().click();
  expect(await getStoreState(page, "currentTool")).toBe("eraser");
});

test("eraser flyout: clicking 区域擦除 sets currentTool=eraserFill", async ({ page }) => {
  await setupPage(page);
  await loadProject(page);

  await callAction(page, "setTool", ["pen"]);

  await page.locator('button[title*="橡皮"]').first().click();
  await page.locator('button[title^="区域擦除"]').first().click();
  expect(await getStoreState(page, "currentTool")).toBe("eraserFill");
});
```

- [ ] **Step 2: Also extend the `setTool` round-trip test**

Find the test at line 84-92:

```ts
for (const tool of ["pen", "eraser", "eyedropper", "fill", "line", "select"]) {
```

Add `"eraserFill"` to the list:

```ts
for (const tool of ["pen", "eraser", "eraserFill", "eyedropper", "fill", "line", "select"]) {
```

- [ ] **Step 3: Run the full webview suite**

From `platforms/vscode/`:
```bash
npm run test:webview
```
Expected: all tests pass — both the old eraser test (now split) and the four flood-erase tests added in Task 5.

- [ ] **Step 4: Commit**

```bash
git add platforms/vscode/tests/drawing.spec.ts
git commit -m "test: cover eraser flyout sub-modes in toolbar tests"
```

---

## Task 9: Final verification + manual smoke

- [ ] **Step 1: Run the full test suite from the root**

```bash
npx vitest run
```
Expected: helper unit tests pass.

```bash
cd platforms/vscode && npm run test:webview
```
Expected: all webview tests pass.

- [ ] **Step 2: Manual smoke (dev build)**

From root: `npm run dev` (or whichever script boots the web app).

Open the app and verify:
1. Eraser button in the toolbar shows the bandaid icon (`🩹`) by default.
2. Click eraser button → flyout shows two options: 单格擦除 and 区域擦除.
3. Pick 单格擦除, paint a few cells, click them — they clear one at a time.
4. Paint a connected blob, pick 区域擦除 from the flyout, click anywhere in the blob — the whole blob clears in one shot.
5. One Ctrl+Z restores the entire blob.
6. After using 区域擦除, press P then E — eraser activates as 区域擦除 (sticky), parent button shows 🧽 icon.
7. Click an empty cell with 区域擦除 active — nothing happens, no undo step recorded.
8. Cursor over the canvas with 区域擦除 active shows a crosshair.

If any step fails, fix and re-test.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin feature/flood-erase
```

- [ ] **Step 4: Squash-merge to main per CLAUDE.md rules**

```bash
git checkout main
git merge --squash feature/flood-erase
git commit -m "feat: add 区域擦除 sub-mode under the eraser tool"
git branch -d feature/flood-erase
```

---

## Self-review summary

- **Spec coverage:** all four "in scope" items from [the spec](../specs/2026-05-15-flood-erase-design.md) are covered: new `EditorTool` value (Task 3), flyout UI (Task 7), sticky sub-mode via `lastEraserSubmode` (Task 4), flood BFS reuse + single undo entry (Tasks 1-2, verified in Task 5), Playwright tests (Tasks 5, 8).
- **Placeholders:** every step shows the actual code change. The only "open" point is the icon for 区域擦除 (🧽), called out in the spec; the plan picks 🧽 and the implementer may swap.
- **Type consistency:** action names match across tasks (`floodFill`, `floodErase`, `computeFloodReplaceEntries`, `lastEraserSubmode`); the helper signature and the entry shape (`{ row, col, colorIndex }`) match what `batchSetCells` consumes (verified at [editorStore.ts:97, 428-457](../../../src/store/editorStore.ts)).
- **Selection mask:** fill does not mask today; the plan reuses fill's path verbatim, so eraserFill inherits the same behavior — no divergence introduced.
