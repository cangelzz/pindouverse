# 选区与图层三件套 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让浮动选区拥有和普通选区一致的右键菜单与操作、给选区加"内容不在当前图层"的双重警告与"复制所有可见图层"、并新增可撤销的"向下合并图层"。

**Architecture:** 全部围绕 `src/store/editorStore.ts`。把撤销历史从 `HistoryEntry[]` 升级为带标签联合 `cells | layers`，让"向下合并"成为一次进主历史的可撤销快照；浮动选区操作通过"提交并重新选中 footprint → 复用现有普通选区处理"来获得完整菜单；图层感知警告用一个 store 派生判定 + 内联 chip 提示 + 操作前 `appConfirm` 守卫。

**Tech Stack:** TypeScript, React, Zustand, Tailwind；测试用 `platforms/vscode/` 的 Playwright webview 套件（`callAction`/`getStoreState`/`setStoreState`/`clickButton`/`stageReply`，跑在 built bundle 上）。

参考规格：`docs/superpowers/specs/2026-06-17-selection-layer-trio-design.md`

---

## 文件结构

- `src/types/index.ts` — `HistoryAction` 改为带标签联合（Task 1）
- `src/store/editorStore.ts` — 历史联合改造、`mergeLayerDown`、`mirrorFloatingSelection`、`discardFloatingSelection`、`commitFloatingSelection` 重选、`copySelectionAllVisibleLayers`、`selectionOnlyOnOtherLayers`（Task 1/2/4/5/7/8）
- `src/App.tsx` — 图层行"合并到下层"按钮（Task 3）
- `src/components/Canvas/SelectionContextMenu.tsx` — `mode` prop + "提交到图层" / "复制（所有可见图层）"项（Task 6/7）
- `src/components/Canvas/SelectionActionsChip.tsx` — 浮动支持 + 琥珀警告（Task 6/8）
- `src/components/Canvas/PixelCanvas.tsx` — 浮动时触发 chip/右键、菜单接线、操作守卫（Task 6/8）
- `platforms/vscode/tests/*.spec.ts` — 测试（每个 Task）

**通用测试约定**：webview 测试加载 `platforms/vscode/dist/webview` 的构建产物，所以每个测试步骤先 `npm run build:webview` 再 `npx playwright test`。所有命令在 `platforms/vscode/` 目录下执行。

读取一层某格颜色的页面内取值写法（测试里复用）：
```ts
const cell = (r: number, c: number, layerIdx = 0) =>
  page.evaluate(({ r, c, layerIdx }) =>
    (window as any).__pindouStore.getState().layers[layerIdx].data[r][c].colorIndex,
    { r, c, layerIdx });
```

---

## Task 1: 撤销历史升级为带标签联合（行为不变的重构）

把 `HistoryAction` 从 `HistoryEntry[]` 改成 `{kind:"cells",entries} | {kind:"layers",...}`，更新所有压栈点与 `undo`/`redo`/`endStroke`，保证现有行为完全不变（`cells` 分支等价于现状）。这是后续合并撤销的地基。

**Files:**
- Modify: `src/types/index.ts:55-62`
- Modify: `src/store/editorStore.ts`（`setCell` 454-457、`batchSetCells` 475-489、`undo` 666-690、`redo` 692-716、`endStroke` 722-749、`replaceColor` 1552-1567）
- Test: `platforms/vscode/tests/edit-ops.spec.ts`（现有回归）+ 新增断言

- [ ] **Step 1: 改类型为带标签联合**

`src/types/index.ts`，把第 55-62 行替换为：
```ts
export interface HistoryEntry {
  row: number;
  col: number;
  prevColorIndex: number | null;
  newColorIndex: number | null;
}

/** A cell-delta action (drawing/selection edits on the active layer). */
export interface CellsHistoryAction {
  kind: "cells";
  entries: HistoryEntry[];
}

/** A whole-layers snapshot taken before a structural op (e.g. merge). */
export interface LayersHistoryAction {
  kind: "layers";
  layers: BeadLayer[];
  activeLayerId: string;
}

export type HistoryAction = CellsHistoryAction | LayersHistoryAction;
```

- [ ] **Step 2: 更新 `setCell` 压栈（editorStore.ts:454-457）**

把：
```ts
    const action: HistoryAction = [
      { row, col, prevColorIndex: prev, newColorIndex: colorIndex },
    ];
```
改为：
```ts
    const action: HistoryAction = {
      kind: "cells",
      entries: [{ row, col, prevColorIndex: prev, newColorIndex: colorIndex }],
    };
```

- [ ] **Step 3: 更新 `batchSetCells`（editorStore.ts:475-489）**

把 `const action: HistoryAction = [];` 改为 `const entries: HistoryEntry[] = [];`，循环里 `action.push(...)` 改为 `entries.push(...)`，`if (action.length === 0) return;` 改为 `if (entries.length === 0) return;`，并在压栈处用 `{ kind: "cells", entries }`：
```ts
    const entries2: HistoryEntry[] = [];
    for (const { row, col, colorIndex } of entries) {
      const prev = newLayerData[row]?.[col]?.colorIndex ?? null;
      if (prev !== colorIndex) {
        entries2.push({ row, col, prevColorIndex: prev, newColorIndex: colorIndex });
        newLayerData[row][col] = { colorIndex };
      }
    }
    if (entries2.length === 0) return;

    const newLayers = [...state.layers];
    newLayers[layerIdx] = { ...layer, data: newLayerData };
    const undoStack = [...state.undoStack, { kind: "cells", entries: entries2 } as HistoryAction].slice(-MAX_HISTORY);
```
（变量改名 `entries2` 以避开入参 `entries`。需要 `import { HistoryEntry }`——见 Step 7。）

- [ ] **Step 4: 更新 `undo`（editorStore.ts:666-690）按 kind 分支**

把整段 `undo` 替换为：
```ts
  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;

    const action = state.undoStack[state.undoStack.length - 1];

    if (action.kind === "layers") {
      const current: HistoryAction = { kind: "layers", layers: state.layers, activeLayerId: state.activeLayerId };
      set({
        layers: action.layers,
        activeLayerId: action.activeLayerId,
        canvasData: mergeLayers(action.layers, state.canvasSize.width, state.canvasSize.height),
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, current],
        isDirty: true,
      });
      return;
    }

    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layer = state.layers[layerIdx];
    const newLayerData = layer.data.map((r) => r.map((c) => ({ ...c })));
    for (const entry of action.entries) {
      newLayerData[entry.row][entry.col] = { colorIndex: entry.prevColorIndex };
    }
    const newLayers = [...state.layers];
    newLayers[layerIdx] = { ...layer, data: newLayerData };
    set({
      layers: newLayers,
      canvasData: mergeLayers(newLayers, state.canvasSize.width, state.canvasSize.height),
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, action],
      isDirty: true,
    });
  },
```

- [ ] **Step 5: 更新 `redo`（editorStore.ts:692-716）按 kind 分支**

把整段 `redo` 替换为：
```ts
  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;

    const action = state.redoStack[state.redoStack.length - 1];

    if (action.kind === "layers") {
      const current: HistoryAction = { kind: "layers", layers: state.layers, activeLayerId: state.activeLayerId };
      set({
        layers: action.layers,
        activeLayerId: action.activeLayerId,
        canvasData: mergeLayers(action.layers, state.canvasSize.width, state.canvasSize.height),
        undoStack: [...state.undoStack, current],
        redoStack: state.redoStack.slice(0, -1),
        isDirty: true,
      });
      return;
    }

    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layer = state.layers[layerIdx];
    const newLayerData = layer.data.map((r) => r.map((c) => ({ ...c })));
    for (const entry of action.entries) {
      newLayerData[entry.row][entry.col] = { colorIndex: entry.newColorIndex };
    }
    const newLayers = [...state.layers];
    newLayers[layerIdx] = { ...layer, data: newLayerData };
    set({
      layers: newLayers,
      canvasData: mergeLayers(newLayers, state.canvasSize.width, state.canvasSize.height),
      undoStack: [...state.undoStack, action],
      redoStack: state.redoStack.slice(0, -1),
      isDirty: true,
    });
  },
```

- [ ] **Step 6: 更新 `endStroke`（editorStore.ts:730-746）只合并 cells**

把第 730-746 段（从 `// Merge all actions since stroke start into one` 到 `set({ undoStack: newStack });` 前）替换为：
```ts
    // Merge all cell entries since stroke start into one cells-action.
    // Strokes never contain layer ops, so any layers-action is left intact.
    const merged: HistoryEntry[] = [];
    for (let i = _strokeStartIdx; i < stack.length; i++) {
      const a = stack[i];
      if (a.kind === "cells") merged.push(...a.entries);
    }
    const cellMap = new Map<string, HistoryEntry>();
    for (const entry of merged) {
      const key = `${entry.row},${entry.col}`;
      if (!cellMap.has(key)) cellMap.set(key, { ...entry });
      else cellMap.get(key)!.newColorIndex = entry.newColorIndex;
    }
    const combinedAction: HistoryAction = { kind: "cells", entries: Array.from(cellMap.values()) };
    const newStack = [...stack.slice(0, _strokeStartIdx), combinedAction];
```

- [ ] **Step 7: 更新 `replaceColor`（editorStore.ts:1552-1567）与 import**

`replaceColor` 内：把 `const action: HistoryAction = [];` 改为 `const entries: HistoryEntry[] = [];`，`action.push(...)` 改为 `entries.push(...)`，`if (action.length === 0) return;` 改为 `if (entries.length === 0) return;`，压栈处：
```ts
    const undoStack = [...state.undoStack, { kind: "cells", entries } as HistoryAction].slice(-MAX_HISTORY);
```
并在 `editorStore.ts` 顶部的类型 import（第 15 行 `HistoryAction,`）补上 `HistoryEntry,`：
```ts
  HistoryAction,
  HistoryEntry,
```

- [ ] **Step 8: 加一条回归断言**

在 `platforms/vscode/tests/edit-ops.spec.ts` 末尾（最后一个 `});` 之前的 describe 内）追加：
```ts
  test("union history: batch edit undo/redo still works", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    await callAction(page, "batchSetCells", [[
      { row: 0, col: 0, colorIndex: 5 },
      { row: 0, col: 1, colorIndex: 5 },
    ]]);
    const at = (r: number, c: number) => page.evaluate(({ r, c }) =>
      (window as any).__pindouStore.getState().layers[0].data[r][c].colorIndex, { r, c });
    expect(await at(0, 0)).toBe(5);
    await callAction(page, "undo", []);
    expect(await at(0, 0)).toBe(null);
    await callAction(page, "redo", []);
    expect(await at(0, 0)).toBe(5);
  });
```
确认该文件已 import `callAction`（若没有则补进顶部的 `import { ... } from "./helpers";`）。

- [ ] **Step 9: 构建并跑回归（撤销相关全绿）**

Run:
```
cd platforms/vscode && npm run build:webview && npx playwright test edit-ops.spec undo-host-driven.spec selection-actions.spec
```
Expected: 全部 PASS（含新加的 "union history" 用例）。

- [ ] **Step 10: Commit**

```bash
git add src/types/index.ts src/store/editorStore.ts platforms/vscode/tests/edit-ops.spec.ts
git commit -m "refactor(history): tagged-union HistoryAction (cells|layers), behavior-preserving"
```

---

## Task 2: `mergeLayerDown` 向下合并（可撤销）

> **注意（来自 Task 1 review）**：`mergeLayerDown` 必须只在用户点按钮时调用，**绝不能**夹在 `beginStroke()`/`endStroke()` 之间——`endStroke` 会把 `_strokeStartIdx` 之后的历史项合并成一个 cells action，期间若混入 `layers` 快照会被丢弃。当前合并由图层面板按钮触发（不在绘制笔画内），天然安全；实现时不要在绘制流程里调用它。

**Files:**
- Modify: `src/store/editorStore.ts`（接口签名 ~216 行后；实现放 `moveLayer` 1531 行后）
- Test: `platforms/vscode/tests/layer-merge.spec.ts`（新建）

- [ ] **Step 1: 写失败测试**

新建 `platforms/vscode/tests/layer-merge.spec.ts`：
```ts
import { test, expect } from "@playwright/test";
import { setupPage, loadProject, cleanupHarness, callAction, getStoreState } from "./helpers";

test.describe("Layer merge down", () => {
  test.afterAll(() => cleanupHarness());

  async function twoLayers(page: import("@playwright/test").Page) {
    await callAction(page, "newCanvas", [4, 4]);
    // bottom = layer[0]; put color 1 at (0,0)
    await callAction(page, "batchSetCells", [[{ row: 0, col: 0, colorIndex: 1 }]]);
    await callAction(page, "addLayer", ["上层"]); // becomes layer[1], active
    await callAction(page, "batchSetCells", [[{ row: 1, col: 1, colorIndex: 2 }]]);
  }
  const layerCount = (page: import("@playwright/test").Page) =>
    page.evaluate(() => (window as any).__pindouStore.getState().layers.length);
  const cell = (page: import("@playwright/test").Page, r: number, c: number, li: number) =>
    page.evaluate(({ r, c, li }) => (window as any).__pindouStore.getState().layers[li].data[r][c].colorIndex, { r, c, li });
  const activeId = (page: import("@playwright/test").Page) =>
    page.evaluate(() => (window as any).__pindouStore.getState().activeLayerId);

  test("merge down composites upper over lower, removes upper, undo/redo restores", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await twoLayers(page);
    const upperId = await activeId(page); // layer[1]

    await callAction(page, "mergeLayerDown", [upperId]);

    expect(await layerCount(page)).toBe(1);
    expect(await cell(page, 0, 0, 0)).toBe(1); // lower content kept
    expect(await cell(page, 1, 1, 0)).toBe(2); // upper content composited in
    const mergedId = await activeId(page);
    expect(mergedId).not.toBe(upperId);       // active = merged (lower) layer

    await callAction(page, "undo", []);
    expect(await layerCount(page)).toBe(2);    // two layers restored
    expect(await activeId(page)).toBe(upperId);
    expect(await cell(page, 1, 1, 1)).toBe(2); // upper cell back on its own layer

    await callAction(page, "redo", []);
    expect(await layerCount(page)).toBe(1);
    expect(await cell(page, 1, 1, 0)).toBe(2);
  });

  test("merge down on bottom layer is a no-op", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await twoLayers(page);
    const bottomId = await getStoreState<any[]>(page, "layers").then((ls) => ls[0].id);
    await callAction(page, "mergeLayerDown", [bottomId]);
    expect(await layerCount(page)).toBe(2);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd platforms/vscode && npm run build:webview && npx playwright test layer-merge.spec`
Expected: FAIL（`mergeLayerDown` 不是函数）。

- [ ] **Step 3: 加接口签名**

`src/store/editorStore.ts`，在 `moveLayer: (id: string, direction: "up" | "down") => void;`（216 行）下一行加：
```ts
  /** Flatten a layer onto the one below it (upper pixels win); undoable via a layers snapshot. */
  mergeLayerDown: (id: string) => void;
```

- [ ] **Step 4: 实现 `mergeLayerDown`**

在 `moveLayer` 实现（1531 行的 `},` 之后）插入：
```ts
  mergeLayerDown: (id) => {
    const state = get();
    const idx = state.layers.findIndex((l) => l.id === id);
    if (idx <= 0) return; // bottom layer or not found — nothing below to merge into
    const upper = state.layers[idx];
    const lower = state.layers[idx - 1];
    const { width, height } = state.canvasSize;

    const mergedData = lower.data.map((row) => row.map((c) => ({ ...c })));
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const up = upper.data[r]?.[c]?.colorIndex;
        if (up !== null && up !== undefined) mergedData[r][c] = { colorIndex: up };
      }
    }
    const mergedLayer = { ...lower, data: mergedData, visible: true, opacity: 1 };

    const newLayers = [...state.layers];
    newLayers[idx - 1] = mergedLayer;
    newLayers.splice(idx, 1);

    const snapshot: HistoryAction = { kind: "layers", layers: state.layers, activeLayerId: state.activeLayerId };
    const undoStack = [...state.undoStack, snapshot].slice(-MAX_HISTORY);

    set({
      layers: newLayers,
      activeLayerId: mergedLayer.id,
      canvasData: mergeLayers(newLayers, width, height),
      undoStack,
      redoStack: [],
      isDirty: true,
    });
  },
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd platforms/vscode && npm run build:webview && npx playwright test layer-merge.spec`
Expected: PASS（两个用例）。

- [ ] **Step 6: Commit**

```bash
git add src/store/editorStore.ts platforms/vscode/tests/layer-merge.spec.ts
git commit -m "feat(layers): mergeLayerDown with snapshot undo/redo"
```

---

## Task 3: 图层行"合并到下层"按钮 + 确认框

**Files:**
- Modify: `src/App.tsx`（store 绑定 ~190 行；按钮在图层行按钮区 768-791）
- Test: `platforms/vscode/tests/layer-merge.spec.ts`（追加 UI 用例）

- [ ] **Step 1: 写失败测试（UI 确认流）**

在 `layer-merge.spec.ts` 的 describe 内追加：
```ts
  test("UI: 合并到下层 confirms then merges; cancel keeps two layers; bottom has no button", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await twoLayers(page);

    // open the 图层 tab
    await page.getByRole("button", { name: "图层", exact: true }).click();

    const mergeButtons = page.getByRole("button", { name: "合并到下层" });
    // two layers → exactly one merge button (the upper row; bottom row has none)
    await expect(mergeButtons).toHaveCount(1);

    // cancel path
    mergeButtons.first().click();
    const cancelModal = page.locator("div.fixed.inset-0").filter({ hasText: "合并图层" }).last();
    await cancelModal.getByRole("button", { name: /^取消$/ }).click();
    expect(await layerCount(page)).toBe(2);

    // confirm path
    mergeButtons.first().click();
    const okModal = page.locator("div.fixed.inset-0").filter({ hasText: "合并图层" }).last();
    await okModal.getByRole("button", { name: /^确定$/ }).click();
    expect(await layerCount(page)).toBe(1);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd platforms/vscode && npm run build:webview && npx playwright test layer-merge.spec -g "UI"`
Expected: FAIL（找不到"合并到下层"按钮）。

- [ ] **Step 3: 绑定 store action**

`src/App.tsx`，在 `const moveLayer = useEditorStore((s) => s.moveLayer);`（190 行）下一行加：
```ts
  const mergeLayerDown = useEditorStore((s) => s.mergeLayerDown);
```

- [ ] **Step 4: 加按钮（App.tsx 图层行按钮区）**

在"复制"按钮（779-783 行）和 `{layers.length > 1 && (` 删除按钮之间插入：
```tsx
                        {layerIdx > 0 && (
                          <button
                            onClick={async () => {
                              const lower = layers[layerIdx - 1];
                              const ok = await appConfirm(
                                `向下合并？「${layer.name}」将并入「${lower.name}」，合并为一层。\n切换图层前可用 Ctrl+Z 撤销。`,
                                { title: "合并图层" },
                              );
                              if (ok) mergeLayerDown(layer.id);
                            }}
                            className="px-1 py-0 border rounded text-[9px] hover:bg-gray-100"
                            title="合并到下层（与下方图层合为一层）"
                          >合并到下层</button>
                        )}
```
（`appConfirm` 已在 App.tsx 第 13 行 import；`layerIdx`、`layer`、`layers` 均在该 `.map` 作用域内。）

- [ ] **Step 5: 跑测试确认通过**

Run: `cd platforms/vscode && npm run build:webview && npx playwright test layer-merge.spec`
Expected: PASS（含 UI 用例）。

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx platforms/vscode/tests/layer-merge.spec.ts
git commit -m "feat(layers): 合并到下层 button with confirm dialog"
```

---

## Task 4: `mirrorFloatingSelection` + `discardFloatingSelection`

**Files:**
- Modify: `src/store/editorStore.ts`（签名 156 行附近；实现放 `setFloatingSelectionOffset` 1250 行后）
- Test: `platforms/vscode/tests/selection-actions.spec.ts`（追加）

- [ ] **Step 1: 写失败测试**

在 `selection-actions.spec.ts` 顶部 describe 内追加（该文件已 import `callAction`/`setStoreState`/`getStoreState`）：
```ts
  test("mirrorFloatingSelection flips floating cells in place, stays floating", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    // floating buffer: (0,0)=1, (0,1)=2 at offset (0,0)
    await page.evaluate(() => {
      (window as any).__pindouStore.setState({
        floatingSelection: { cells: new Map([["0,0", { colorIndex: 1 }], ["0,1", { colorIndex: 2 }]]), offsetRow: 0, offsetCol: 0 },
      });
    });
    await callAction(page, "mirrorFloatingSelection", ["horizontal"]);
    const fs = await page.evaluate(() => {
      const f = (window as any).__pindouStore.getState().floatingSelection;
      return f ? Object.fromEntries([...f.cells.entries()].map(([k, v]: any) => [k, v.colorIndex])) : null;
    });
    // horizontal flip within bbox cols [0..1]: (0,0)->color2, (0,1)->color1
    expect(fs).toEqual({ "0,0": 2, "0,1": 1 });
  });

  test("discardFloatingSelection drops the float without writing the layer", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    await page.evaluate(() => {
      (window as any).__pindouStore.setState({
        floatingSelection: { cells: new Map([["0,0", { colorIndex: 7 }]]), offsetRow: 0, offsetCol: 0 },
      });
    });
    await callAction(page, "discardFloatingSelection", []);
    const fs = await getStoreState(page, "floatingSelection");
    expect(fs).toBe(null);
    const v = await page.evaluate(() => (window as any).__pindouStore.getState().layers[0].data[0][0].colorIndex);
    expect(v).toBe(null); // nothing committed
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd platforms/vscode && npm run build:webview && npx playwright test selection-actions.spec -g "Floating|floating"`
Expected: FAIL（函数不存在）。

- [ ] **Step 3: 加接口签名**

`src/store/editorStore.ts`，在 `setFloatingSelectionOffset: (row: number, col: number) => void;`（156 行）下加：
```ts
  /** Flip the floating selection's cells in place within their bbox; stays floating. */
  mirrorFloatingSelection: (direction: "horizontal" | "vertical") => void;
  /** Drop the floating selection without committing it to any layer. */
  discardFloatingSelection: () => void;
```

- [ ] **Step 4: 实现两个 action**

在 `setFloatingSelectionOffset` 实现（1250 行 `},` 之后）插入：
```ts
  mirrorFloatingSelection: (direction) => {
    const state = get();
    const fs = state.floatingSelection;
    if (!fs) return;
    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
    for (const key of fs.cells.keys()) {
      const [lr, lc] = key.split(",").map(Number);
      if (lr < minR) minR = lr;
      if (lr > maxR) maxR = lr;
      if (lc < minC) minC = lc;
      if (lc > maxC) maxC = lc;
    }
    if (minR === Infinity) return;
    const newCells = new Map<string, CanvasCell>();
    for (const [key, cell] of fs.cells) {
      const [lr, lc] = key.split(",").map(Number);
      const nr = direction === "vertical" ? minR + maxR - lr : lr;
      const nc = direction === "horizontal" ? minC + maxC - lc : lc;
      newCells.set(`${nr},${nc}`, { ...cell });
    }
    set({ floatingSelection: { cells: newCells, offsetRow: fs.offsetRow, offsetCol: fs.offsetCol } });
  },

  discardFloatingSelection: () => set({ floatingSelection: null }),
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd platforms/vscode && npm run build:webview && npx playwright test selection-actions.spec -g "Floating|floating"`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/store/editorStore.ts platforms/vscode/tests/selection-actions.spec.ts
git commit -m "feat(selection): mirrorFloatingSelection + discardFloatingSelection"
```

---

## Task 5: `commitFloatingSelection` 落下后重新选中 footprint

**Files:**
- Modify: `src/store/editorStore.ts`（`commitFloatingSelection` 952-970）
- Test: `platforms/vscode/tests/selection-actions.spec.ts`（追加）

- [ ] **Step 1: 写失败测试**

在 `selection-actions.spec.ts` 追加：
```ts
  test("commitFloatingSelection re-selects the dropped footprint", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    await page.evaluate(() => {
      (window as any).__pindouStore.setState({
        floatingSelection: { cells: new Map([["0,0", { colorIndex: 3 }], ["0,1", { colorIndex: 3 }]]), offsetRow: 1, offsetCol: 1 },
      });
    });
    await callAction(page, "commitFloatingSelection", []);
    // floating cleared, cells written at offset (1,1)/(1,2)
    expect(await getStoreState(page, "floatingSelection")).toBe(null);
    const v = await page.evaluate(() => (window as any).__pindouStore.getState().layers[0].data[1][1].colorIndex);
    expect(v).toBe(3);
    // selection now equals the footprint {"1,1","1,2"}
    const sel = await page.evaluate(() => {
      const s = (window as any).__pindouStore.getState().selection;
      return s ? [...s].sort() : null;
    });
    expect(sel).toEqual(["1,1", "1,2"]);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd platforms/vscode && npm run build:webview && npx playwright test selection-actions.spec -g "re-selects the dropped"`
Expected: FAIL（commit 后 selection 为 null）。

- [ ] **Step 3: 修改 `commitFloatingSelection`（editorStore.ts:952-970）**

把整段替换为：
```ts
  commitFloatingSelection: () => {
    const state = get();
    if (!state.floatingSelection) return;
    const { cells, offsetRow, offsetCol } = state.floatingSelection;
    const { width, height } = state.canvasSize;
    const entries: { row: number; col: number; colorIndex: number | null }[] = [];
    const footprint = new Set<string>();
    for (const [key, cell] of cells) {
      const [lr, lc] = key.split(",").map(Number);
      const r = lr + offsetRow;
      const c = lc + offsetCol;
      if (r >= 0 && r < height && c >= 0 && c < width && cell.colorIndex !== null) {
        entries.push({ row: r, col: c, colorIndex: cell.colorIndex });
        footprint.add(`${r},${c}`);
      }
    }
    if (entries.length > 0) {
      get().batchSetCells(entries);
    }
    if (footprint.size > 0) {
      set({ floatingSelection: null, selection: footprint, selectionBounds: computeBounds(footprint) });
    } else {
      set({ floatingSelection: null, selection: null, selectionBounds: null });
    }
  },
```

- [ ] **Step 4: 跑测试确认通过（含未回归 clearSelection/Escape 行为）**

Run: `cd platforms/vscode && npm run build:webview && npx playwright test selection-actions.spec`
Expected: PASS（新用例 + 现有选区用例全绿）。

- [ ] **Step 5: Commit**

```bash
git add src/store/editorStore.ts platforms/vscode/tests/selection-actions.spec.ts
git commit -m "feat(selection): commitFloatingSelection re-selects dropped footprint"
```

---

## Task 6: 浮动右键菜单/chip + `mode` prop（完整菜单）

让浮动状态也能弹 chip 与右键菜单；菜单加 `mode`，浮动时"镜像/取消"走浮动特例、其余项"先提交再走普通处理"。

**Files:**
- Modify: `src/components/Canvas/SelectionContextMenu.tsx`（加 `mode` + "提交到图层"）
- Modify: `src/components/Canvas/PixelCanvas.tsx`（chip/右键触发条件、菜单接线、浮动 bbox）
- Test: `platforms/vscode/tests/selection-actions.spec.ts`（追加）

- [ ] **Step 1: 写失败测试（浮动→右键镜像→仍浮动；提交到图层→落盘+重选）**

在 `selection-actions.spec.ts` 追加：
```ts
  test("floating region: right-click menu mirrors in place and commits", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [6, 6]);
    // make a real selection then duplicate-as-floating so the canvas knows the bbox
    await callAction(page, "batchSetCells", [[{ row: 0, col: 0, colorIndex: 4 }, { row: 0, col: 1, colorIndex: 5 }]]);
    await setStoreState(page, { selection: new Set(["0,0", "0,1"]), selectionBounds: { r1: 0, c1: 0, r2: 0, c2: 1 } });
    await callAction(page, "duplicateSelectionAsFloating", []);
    expect(await getStoreState(page, "floatingSelection")).not.toBe(null);

    // right-click the canvas to open the floating menu (same pattern as existing right-click tests)
    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas not visible");
    await page.mouse.click(box.x + 12, box.y + 12, { button: "right" });
    // 水平翻转 via 镜像 submenu
    await page.getByRole("menuitem", { name: /^镜像$/ }).hover();
    await page.getByRole("menuitem", { name: "水平翻转" }).click();
    const fs = await page.evaluate(() => {
      const f = (window as any).__pindouStore.getState().floatingSelection;
      return f ? Object.fromEntries([...f.cells.entries()].map(([k, v]: any) => [k, v.colorIndex])) : null;
    });
    expect(fs).toEqual({ "0,0": 5, "0,1": 4 }); // flipped, still floating
  });
```
注意：右键命中画布即可打开菜单（浮动 bbox 不影响菜单弹出，菜单由 `floatingSelectionState` 存在驱动）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd platforms/vscode && npm run build:webview && npx playwright test selection-actions.spec -g "floating region: right-click"`
Expected: FAIL（浮动时菜单不弹）。

- [ ] **Step 3: `SelectionContextMenu` 加 `mode` 与浮动项**

`src/components/Canvas/SelectionContextMenu.tsx`：
- `Props` 接口加：
```ts
  mode?: "selection" | "floating";
  onCommitFloating?: () => void;
```
- 解构参数加 `mode = "selection"`, `onCommitFloating`。
- 在 `<Divider />`（136 行后、"移到新图层"之前）插入一个仅浮动可见的"提交到图层"项；并把最后的"取消选区"在浮动模式下文案改为"取消（丢弃浮动）"。具体：在第一组 `<Divider />`（136 行）之后插入：
```tsx
      {mode === "floating" && (
        <>
          <Item label="提交到图层" onClick={onCommitFloating} onCloseMenu={onClose} />
          <Divider />
        </>
      )}
```
- 末尾"取消选区"项（171 行）改为：
```tsx
      <Item label={mode === "floating" ? "取消（丢弃浮动）" : "取消选区"} onClick={onDeselect} onCloseMenu={onClose} />
```

- [ ] **Step 4: `PixelCanvas` 计算浮动 bbox + 放开触发条件**

`src/components/Canvas/PixelCanvas.tsx`：
- 在组件内（`floatingSelectionState` 已订阅）加一个浮动屏幕 bbox 计算（放在 chip 渲染前）：
```tsx
      {floatingSelectionState && (() => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return null;
        let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
        for (const key of floatingSelectionState.cells.keys()) {
          const [lr, lc] = key.split(",").map(Number);
          const r = lr + floatingSelectionState.offsetRow;
          const c = lc + floatingSelectionState.offsetCol;
          if (r < minR) minR = r; if (r > maxR) maxR = r;
          if (c < minC) minC = c; if (c > maxC) maxC = c;
        }
        if (minR === Infinity) return null;
        const selectionTop = rect.top + minR * cellSize + offsetY;
        const selectionRight = rect.left + (maxC + 1) * cellSize + offsetX;
        return (
          <SelectionActionsChip
            selectionTop={selectionTop}
            selectionRight={selectionRight}
            containerTop={rect.top}
            onClick={(x, y) => setContextMenu({ x, y })}
          />
        );
      })()}
```
- `onContextMenu`（1518 行）把条件改为：
```tsx
          if ((selection && selection.size > 0 && !floatingSelectionState) || floatingSelectionState) {
            setContextMenu({ x: e.clientX, y: e.clientY });
          }
```

- [ ] **Step 5: `PixelCanvas` 菜单接线（floating 模式 + commit-then-handler）**

把 `<SelectionContextMenu ... />`（1594-1609）替换为：
```tsx
      {contextMenu && (
        <SelectionContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          mode={floatingSelectionState ? "floating" : "selection"}
          layers={layers}
          activeLayerId={activeLayerId}
          onMirror={(dir) => {
            if (floatingSelectionState) mirrorFloatingSelection(dir);
            else mirrorSelection(dir);
          }}
          onCommitFloating={() => commitFloatingSelection()}
          onMoveToNewLayer={() => { if (floatingSelectionState) commitFloatingSelection(); moveSelectionToNewLayer(); }}
          onMoveToLayer={(id) => { if (floatingSelectionState) commitFloatingSelection(); moveSelectionToLayer(id); }}
          onCopy={() => { if (floatingSelectionState) commitFloatingSelection(); copySelection(); }}
          onDuplicateDraggable={() => { if (floatingSelectionState) commitFloatingSelection(); duplicateSelectionAsFloating(); }}
          onReplaceColor={() => { if (floatingSelectionState) commitFloatingSelection(); setReplaceOpen(true); }}
          onColorAdjust={() => { if (floatingSelectionState) commitFloatingSelection(); setAdjustOpen(true); }}
          onDeselect={() => { if (floatingSelectionState) discardFloatingSelection(); else clearSelection(); }}
          onClose={() => setContextMenu(null)}
        />
      )}
```
- 确保这些 action 已从 store 取出（在组件顶部 `useEditorStore` 绑定处补齐缺的）：`mirrorFloatingSelection`、`discardFloatingSelection`、`commitFloatingSelection`（已存在订阅则跳过）。新增绑定示例：
```tsx
  const mirrorFloatingSelection = useEditorStore((s) => s.mirrorFloatingSelection);
  const discardFloatingSelection = useEditorStore((s) => s.discardFloatingSelection);
```
（`commitFloatingSelection`、`mirrorSelection`、`moveSelectionToNewLayer`、`moveSelectionToLayer`、`copySelection`、`duplicateSelectionAsFloating` 应已在现有绑定中；缺则补。）

- [ ] **Step 6: 跑测试确认通过**

Run: `cd platforms/vscode && npm run build:webview && npx playwright test selection-actions.spec`
Expected: PASS（含浮动右键用例 + 现有用例）。

- [ ] **Step 7: Commit**

```bash
git add src/components/Canvas/SelectionContextMenu.tsx src/components/Canvas/PixelCanvas.tsx platforms/vscode/tests/selection-actions.spec.ts
git commit -m "feat(selection): full context menu on floating regions (commit-then-handler)"
```

---

## Task 7: `copySelectionAllVisibleLayers` + 菜单项

**Files:**
- Modify: `src/store/editorStore.ts`（签名 150 行后；实现放 `copySelection` 892 行后）
- Modify: `src/components/Canvas/SelectionContextMenu.tsx`（"复制（所有可见图层）"项）
- Modify: `src/components/Canvas/PixelCanvas.tsx`（接线）
- Test: `platforms/vscode/tests/selection-actions.spec.ts`（追加）

- [ ] **Step 1: 写失败测试**

在 `selection-actions.spec.ts` 追加：
```ts
  test("copySelectionAllVisibleLayers flattens visible layers into clipboard", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    // bottom layer has color 8 at (0,0); active(upper) layer empty there
    await callAction(page, "batchSetCells", [[{ row: 0, col: 0, colorIndex: 8 }]]);
    await callAction(page, "addLayer", ["上层"]);
    await setStoreState(page, { selection: new Set(["0,0"]), selectionBounds: { r1: 0, c1: 0, r2: 0, c2: 0 } });

    await callAction(page, "copySelectionAllVisibleLayers", []);
    const clip = await page.evaluate(() => {
      const cb = (window as any).__pindouStore.getState().clipboard;
      return cb ? Object.fromEntries([...cb.cells.entries()].map(([k, v]: any) => [k, v.colorIndex])) : null;
    });
    expect(clip).toEqual({ "0,0": 8 }); // grabbed from the lower visible layer
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd platforms/vscode && npm run build:webview && npx playwright test selection-actions.spec -g "flattens visible layers"`
Expected: FAIL。

- [ ] **Step 3: 加接口签名**

`src/store/editorStore.ts`，在 `copySelection: () => void;`（150 行）下加：
```ts
  /** Copy selection flattened across all VISIBLE layers (top-most non-null wins) into the clipboard. */
  copySelectionAllVisibleLayers: () => void;
```

- [ ] **Step 4: 实现 action**

在 `copySelection` 实现（892 行 `},` 之后）插入：
```ts
  copySelectionAllVisibleLayers: () => {
    const state = get();
    if (!state.selection || !state.selectionBounds) return;
    const { r1, c1, r2, c2 } = state.selectionBounds;
    const cells = new Map<string, CanvasCell>();
    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      let ci: number | null = null;
      for (const l of state.layers) {
        if (!l.visible) continue;
        const v = l.data[r]?.[c]?.colorIndex;
        if (v !== null && v !== undefined) ci = v; // bottom→top, top-most wins
      }
      if (ci !== null) cells.set(`${r - r1},${c - c1}`, { colorIndex: ci });
    }
    if (cells.size === 0) return;
    set({ clipboard: { cells, width: c2 - c1 + 1, height: r2 - r1 + 1 } });
    const data = {
      type: "pindou-selection",
      width: c2 - c1 + 1,
      height: r2 - r1 + 1,
      cells: [...cells.entries()].map(([k, v]) => [k, v.colorIndex]),
    };
    navigator.clipboard.writeText(JSON.stringify(data)).catch(() => {});
  },
```

- [ ] **Step 5: 菜单项 + 接线**

`SelectionContextMenu.tsx`：
- `Props` 加 `onCopyAllVisible: () => void;`，解构参数加 `onCopyAllVisible`。
- 在"复制"项（161 行）下一行加：
```tsx
      <Item label="复制（所有可见图层）" onClick={onCopyAllVisible} onCloseMenu={onClose} />
```
`PixelCanvas.tsx` 的 `<SelectionContextMenu>` 加：
```tsx
          onCopyAllVisible={() => { if (floatingSelectionState) commitFloatingSelection(); copySelectionAllVisibleLayers(); }}
```
并在组件顶部绑定：
```tsx
  const copySelectionAllVisibleLayers = useEditorStore((s) => s.copySelectionAllVisibleLayers);
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd platforms/vscode && npm run build:webview && npx playwright test selection-actions.spec`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/store/editorStore.ts src/components/Canvas/SelectionContextMenu.tsx src/components/Canvas/PixelCanvas.tsx platforms/vscode/tests/selection-actions.spec.ts
git commit -m "feat(selection): copy across all visible layers + menu item"
```

---

## Task 8: 图层感知警告（选中时内联 + 操作时确认）

**Files:**
- Modify: `src/store/editorStore.ts`（签名 153 行后；实现放 `deleteSelection` 950 行后）
- Modify: `src/components/Canvas/SelectionActionsChip.tsx`（琥珀警告）
- Modify: `src/components/Canvas/PixelCanvas.tsx`（chip 传 warn、操作守卫）
- Test: `platforms/vscode/tests/selection-actions.spec.ts`（追加 store 判定）

- [ ] **Step 1: 写失败测试（判定函数）**

在 `selection-actions.spec.ts` 追加：
```ts
  test("selectionOnlyOnOtherLayers: true when active empty but a visible layer has content", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    await callAction(page, "batchSetCells", [[{ row: 0, col: 0, colorIndex: 9 }]]); // bottom has content
    await callAction(page, "addLayer", ["上层"]); // active = empty upper
    await setStoreState(page, { selection: new Set(["0,0"]), selectionBounds: { r1: 0, c1: 0, r2: 0, c2: 0 } });
    const flag = await callAction(page, "selectionOnlyOnOtherLayers", []);
    expect(flag).toBe(true);

    // when active layer itself has the content → false
    await callAction(page, "batchSetCells", [[{ row: 0, col: 0, colorIndex: 3 }]]);
    expect(await callAction(page, "selectionOnlyOnOtherLayers", [])).toBe(false);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd platforms/vscode && npm run build:webview && npx playwright test selection-actions.spec -g "selectionOnlyOnOtherLayers"`
Expected: FAIL。

- [ ] **Step 3: 加签名 + 实现**

`src/store/editorStore.ts`，在 `deleteSelection: () => void;`（153 行）下加：
```ts
  /** True if the active layer is empty within the selection but some other VISIBLE layer has content there. */
  selectionOnlyOnOtherLayers: () => boolean;
```
在 `deleteSelection` 实现（950 行 `},` 之后）插入：
```ts
  selectionOnlyOnOtherLayers: () => {
    const state = get();
    if (!state.selection || state.selection.size === 0) return false;
    const activeIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (activeIdx === -1) return false;
    const active = state.layers[activeIdx];
    for (const key of state.selection) {
      const [r, c] = key.split(",").map(Number);
      if (active.data[r]?.[c]?.colorIndex != null) return false; // active has content → not "only other"
    }
    for (let i = 0; i < state.layers.length; i++) {
      if (i === activeIdx) continue;
      const l = state.layers[i];
      if (!l.visible) continue;
      for (const key of state.selection) {
        const [r, c] = key.split(",").map(Number);
        if (l.data[r]?.[c]?.colorIndex != null) return true;
      }
    }
    return false;
  },
```

- [ ] **Step 4: chip 显示琥珀警告**

`src/components/Canvas/SelectionActionsChip.tsx`：
- `Props` 加 `warnOtherLayer?: boolean;`，解构加 `warnOtherLayer`。
- 把返回的单个 `<button>` 包成一个 `<>` 片段，在按钮后追加警告小标签（仅 `warnOtherLayer` 时）：
```tsx
  return (
    <>
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onClick(e.clientX, e.clientY); }}
        className="fixed flex items-center gap-1 px-2 text-[11px] leading-none bg-white border border-gray-300 rounded-full shadow-sm hover:bg-blue-50 text-gray-700 z-40 whitespace-nowrap select-none"
        style={{
          top,
          right: typeof window !== "undefined" ? Math.max(2, window.innerWidth - selectionRight) : 0,
          height: CHIP_HEIGHT,
        }}
      >
        <span aria-hidden="true" className="text-gray-400">⋮</span>
        <span>右键查看操作</span>
      </button>
      {warnOtherLayer && (
        <div
          className="fixed z-40 px-2 py-0.5 text-[10px] leading-none bg-amber-50 border border-amber-300 text-amber-700 rounded shadow-sm whitespace-nowrap select-none pointer-events-none"
          style={{
            top: top + CHIP_HEIGHT + 4,
            right: typeof window !== "undefined" ? Math.max(2, window.innerWidth - selectionRight) : 0,
          }}
        >
          ⚠ 选区内容在其他图层（当前图层为空）
        </div>
      )}
    </>
  );
```

- [ ] **Step 5: `PixelCanvas` 传 warn + 操作守卫**

`src/components/Canvas/PixelCanvas.tsx`：
- 顶部 import 增加 `appConfirm`：
```tsx
import { appConfirm } from "../Dialog/AppDialog";
```
（若已 import 其他 AppDialog 成员则合并。）
- 计算警告标志（放在普通选区 chip 渲染块内，用 `useMemo` 或直接调用 store）：在普通选区 chip（1576-1593）里给 `<SelectionActionsChip>` 加：
```tsx
            warnOtherLayer={useEditorStore.getState().selectionOnlyOnOtherLayers()}
```
> 由于该块已在 `selection`/`selectionBounds`/`layers` 变化时重渲染，直接 `getState().selectionOnlyOnOtherLayers()` 取实时值即可。
- 操作守卫：定义一个 helper（组件内）：
```tsx
  const guardActiveLayer = async (): Promise<boolean> => {
    if (!useEditorStore.getState().selectionOnlyOnOtherLayers()) return true;
    return await appConfirm("当前图层在选区内没有内容，操作不会有效果。是否继续？", { title: "选区不在当前图层" });
  };
```
- 在普通选区（非 floating）的菜单回调里对 `onMirror/onCopy/onMoveToNewLayer/onReplaceColor/onColorAdjust` 加守卫。把 Task 6 Step 5 里这些回调的 selection 分支改成 async + 守卫，例如 `onMirror`：
```tsx
          onMirror={async (dir) => {
            if (floatingSelectionState) { mirrorFloatingSelection(dir); return; }
            if (await guardActiveLayer()) mirrorSelection(dir);
          }}
```
同理给 `onCopy`、`onMoveToNewLayer`、`onReplaceColor`、`onColorAdjust` 的 selection 分支套 `if (await guardActiveLayer()) { ... }`。`onCopyAllVisible` 不加守卫（它本就是为此场景准备）。

- [ ] **Step 6: 写守卫的 UI 测试**

在 `selection-actions.spec.ts` 追加：
```ts
  test("on-action guard: mirror on other-layer-only selection asks to confirm", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [6, 6]);
    await callAction(page, "batchSetCells", [[{ row: 0, col: 0, colorIndex: 9 }]]);
    await callAction(page, "addLayer", ["上层"]);
    await setStoreState(page, { selection: new Set(["0,0"]), selectionBounds: { r1: 0, c1: 0, r2: 0, c2: 0 } });

    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("canvas not visible");
    await page.mouse.click(box.x + 8, box.y + 8, { button: "right" });
    await page.getByRole("menuitem", { name: /^镜像$/ }).hover();
    await page.getByRole("menuitem", { name: "水平翻转" }).click();

    // confirm modal appears
    const modal = page.locator("div.fixed.inset-0").filter({ hasText: "选区不在当前图层" }).last();
    await expect(modal).toBeVisible({ timeout: 3000 });
    await modal.getByRole("button", { name: /^取消$/ }).click();
  });
```

- [ ] **Step 7: 跑全套选区测试**

Run: `cd platforms/vscode && npm run build:webview && npx playwright test selection-actions.spec`
Expected: PASS（含判定 + chip + 守卫；现有用例不回归）。

- [ ] **Step 8: Commit**

```bash
git add src/store/editorStore.ts src/components/Canvas/SelectionActionsChip.tsx src/components/Canvas/PixelCanvas.tsx platforms/vscode/tests/selection-actions.spec.ts
git commit -m "feat(selection): layer-aware warning (inline + confirm guard)"
```

---

## Task 9: 全量回归 + typecheck

**Files:** 无（验证）

- [ ] **Step 1: typecheck**

Run: `cd Q:/repo/pindou && npx tsc --noEmit -p tsconfig.json`
Expected: 无输出（通过）。

- [ ] **Step 2: 全量 webview 套件**

Run: `cd platforms/vscode && npm run test:webview`
Expected: 全绿（含本计划新增用例 + 全部历史用例）。

- [ ] **Step 3: 根引擎单测**

Run: `cd Q:/repo/pindou && npm test`
Expected: 全绿。

- [ ] **Step 4: Commit（如有快照/小修）**

```bash
git add -A
git commit -m "test: full regression green for selection+layer trio"
```

---

## 自检对照（spec 覆盖）

- 功能 1 浮动完整菜单：Task 4（镜像/丢弃）、Task 5（commit 重选）、Task 6（mode + 触发 + commit-then-handler）✓
- 功能 2 警告 + 复制所有可见：Task 7（复制所有可见）、Task 8（判定 + 内联 + 守卫）✓
- 功能 3 合并 + 撤销 + 确认：Task 1（历史联合）、Task 2（mergeLayerDown + undo）、Task 3（按钮 + appConfirm 文案含回退）✓
- 非目标：未触碰 add/remove/move/duplicate 的可撤销性；合并纯上层优先、无 alpha；替换/调整在浮动下走"提交后再改"。
