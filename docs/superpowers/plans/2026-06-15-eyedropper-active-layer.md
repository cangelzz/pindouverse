# 取色器只取活动图层 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 取色器（eyedropper）只取活动图层该格的颜色；活动层为空则不取（保持当前选中色）并提示用户，且拖过多个空格只弹一次提示。

**Architecture:** 新增 store action `pickActiveLayerColor(row,col)` 按活动图层取色（便于 `callAction` 测试，避免合成 canvas 指针事件）；`PixelCanvas` 的 eyedropper 分支改调它，取到则切画笔，为空则用 `useRef` 守卫弹一次模态 `appAlert`。

**Tech Stack:** React、zustand、Playwright（webview 集成，`platforms/vscode/` 下 `npm run test:webview`）。

设计依据：`docs/superpowers/specs/2026-06-15-eyedropper-active-layer-design.md`

---

## 文件结构

**修改**
- `src/store/editorStore.ts` — 新增 action `pickActiveLayerColor(row,col): boolean`
- `src/components/Canvas/PixelCanvas.tsx` — eyedropper 分支改用该 action + 守卫式 `appAlert`

**新增**
- `platforms/vscode/tests/eyedropperLayer.spec.ts` — 集成测试（store action 覆盖核心修复）

**复用（不改）**
- `src/components/Dialog/AppDialog.tsx`（`appAlert`）

已知真实结构：
- `applyTool` 的 eyedropper 分支在 `src/components/Canvas/PixelCanvas.tsx:841`，现读合并视图 `canvasData[row]?.[col]`；`applyTool` 也被 `handleMouseMove` 在拖动时调用。
- store：action 声明区在 107-110（`floodFill`/`floodErase`/`setSelectedColor`）；实现 `setSelectedColor: (index) => set({ selectedColorIndex: index })` 在第 524 行；`get`/`set` 可用；`state.layers`（每个有 `.id`/`.data`）、`state.activeLayerId`。
- `addLayer(name?)`：新建**空**图层追加到顶部并设为**活动层**（`set({ layers, activeLayerId: layer.id })`）。
- `setCell(row,col,colorIndex)` 写**活动图层**。
- 测试 helper：`setupPage`/`loadProject`/`cleanupHarness`/`callAction`/`getStoreState`。`npm run test:webview` 会先 build。

---

## Task 1: 取色器按活动图层取色 + 空格提示

**Files:**
- Test: `platforms/vscode/tests/eyedropperLayer.spec.ts`
- Modify: `src/store/editorStore.ts`
- Modify: `src/components/Canvas/PixelCanvas.tsx`

- [ ] **Step 1: 写失败的集成测试**

新建 `platforms/vscode/tests/eyedropperLayer.spec.ts`：

```ts
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { setupPage, loadProject, cleanupHarness, callAction, getStoreState } from "./helpers";

test.describe("eyedropper samples the active layer only", () => {
  test.afterAll(() => cleanupHarness());

  test("does not pick a lower layer's color when active layer is empty there", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);

    // Bottom (initial) layer: paint (0,0) = color 5.
    await callAction(page, "setCell", [0, 0, 5]);

    // Add a new top layer — it becomes active and is empty at (0,0).
    await callAction(page, "addLayer", []);

    // Pre-set a known selected color so we can detect an unwanted change.
    await callAction(page, "setSelectedColor", [3]);

    // Picking at (0,0): active layer is empty there → returns false, selection unchanged.
    const picked = await callAction<boolean>(page, "pickActiveLayerColor", [0, 0]);
    expect(picked).toBe(false);
    expect(await getStoreState<number | null>(page, "selectedColorIndex")).toBe(3);
  });

  test("picks the active layer's own color", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    await callAction(page, "addLayer", []); // active top layer

    // Paint on the active layer and pick it.
    await callAction(page, "setCell", [1, 1, 9]);
    await callAction(page, "setSelectedColor", [3]);

    const picked = await callAction<boolean>(page, "pickActiveLayerColor", [1, 1]);
    expect(picked).toBe(true);
    expect(await getStoreState<number | null>(page, "selectedColorIndex")).toBe(9);
  });

  test("empty / out-of-bounds cell returns false and keeps the selection", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    await callAction(page, "setSelectedColor", [3]);

    const picked = await callAction<boolean>(page, "pickActiveLayerColor", [99, 99]);
    expect(picked).toBe(false);
    expect(await getStoreState<number | null>(page, "selectedColorIndex")).toBe(3);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run（在 `platforms/vscode/`）：`npm run test:webview -- eyedropperLayer`
Expected: FAIL —— `pickActiveLayerColor` 不是 store action（`No store action: pickActiveLayerColor`）。

- [ ] **Step 3: 加 store action `pickActiveLayerColor`**

在 `src/store/editorStore.ts`：

声明区（第 108 行 `floodErase: (row: number, col: number) => void;` 之后）加：
```ts
  pickActiveLayerColor: (row: number, col: number) => boolean;
```

实现（在 `setSelectedColor: (index) => set({ selectedColorIndex: index }),`（第 524 行）之后）加：
```ts
  pickActiveLayerColor: (row, col) => {
    const state = get();
    const layer = state.layers.find((l) => l.id === state.activeLayerId);
    const idx = layer?.data[row]?.[col]?.colorIndex;
    if (idx === null || idx === undefined) return false;
    set({ selectedColorIndex: idx });
    return true;
  },
```

- [ ] **Step 4: 跑测试确认通过**

Run（在 `platforms/vscode/`）：`npm run test:webview -- eyedropperLayer`
Expected: PASS（3 个用例）。

- [ ] **Step 5: 改 PixelCanvas eyedropper 分支 + 守卫**

在 `src/components/Canvas/PixelCanvas.tsx`：

顶部 import 区加：
```ts
import { appAlert } from "../Dialog/AppDialog";
```

组件体内（与其它 `useRef` 并列处，或在 `applyTool` 定义之前）加守卫 ref：
```ts
  const eyedropWarnOpenRef = useRef(false);
```
（若 `useRef` 尚未从 react 引入，确认顶部 `import { ..., useRef } from "react";` 已含 `useRef`——本文件已大量使用 ref，应已引入。）

把 eyedropper 分支（第 841-848 行）：
```ts
        case "eyedropper": {
          const cell = canvasData[row]?.[col];
          if (cell?.colorIndex !== null && cell?.colorIndex !== undefined) {
            setSelectedColor(cell.colorIndex);
            setTool("pen");
          }
          break;
        }
```
改为：
```ts
        case "eyedropper": {
          if (useEditorStore.getState().pickActiveLayerColor(row, col)) {
            setTool("pen");
          } else if (!eyedropWarnOpenRef.current) {
            eyedropWarnOpenRef.current = true;
            appAlert("当前图层的这个位置没有颜色。", { title: "无法取色" })
              .finally(() => {
                eyedropWarnOpenRef.current = false;
              });
          }
          break;
        }
```

> `applyTool` 依赖数组里的 `canvasData` 保留即可（无害）。`setSelectedColor` 若在改后不再被 eyedropper 直接使用，但文件其它地方仍用它，依赖数组按现状保留，不要删。

- [ ] **Step 6: 类型检查 + 全量 webview 回归**

Run（仓库根）：`npx tsc --noEmit -p tsconfig.json`
Expected: 无错误。

Run（在 `platforms/vscode/`）：`npm run test:webview`
Expected: 原有用例 + 新增 3 个全过。

- [ ] **Step 7: 提交**

```bash
git add src/store/editorStore.ts src/components/Canvas/PixelCanvas.tsx platforms/vscode/tests/eyedropperLayer.spec.ts
git commit -m "fix(canvas): eyedropper samples active layer, warns when empty"
```

> 提交只 `git add` 这三个文件，**不要** `git commit -am` / `git add -A`（仓库有无关 samples 改动）。

---

## 收尾

- [ ] **手测**：建两层，下层某格有色、上层（活动）该格为空 → 用取色器点该格 → 选中色不变、弹一次"无法取色"提示；按住拖过多个空格 → 只弹一个框；点活动层有色处 → 正常取到该色并切画笔；单图层 → 取色如常。
- [ ] 按项目规范 squash 合并到 main（`git checkout main && git merge --squash fix/eyedropper-active-layer && git commit`），删分支。

---

## 自检结论

- **Spec 覆盖**：仅活动层取色（Step 3 action 读 `layers.find(active).data`）；空格保持原选中色（action 返回 false 不改状态 + Step 1 断言 selectedColorIndex 不变）；模态提示（Step 5 `appAlert`）；防刷屏守卫（Step 5 `eyedropWarnOpenRef`）；越界返回 false（Step 1 第三个用例）。全覆盖。
- **占位符**：无 TBD/TODO，每步含真实代码或确切命令。
- **类型/名称一致**：`pickActiveLayerColor(row,col):boolean`（声明↔实现↔组件调用↔测试 callAction）、`eyedropWarnOpenRef`、`appAlert(message,{title})`（与 AppDialog 真实签名一致）、`setCell`/`addLayer`/`setSelectedColor`/`getStoreState` 均与真实签名一致。
