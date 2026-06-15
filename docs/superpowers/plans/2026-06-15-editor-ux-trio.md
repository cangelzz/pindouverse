# 三个编辑器 UX 修复 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 选区调整框可拖动（去遮罩）；导入预览支持中键平移 + 框选边缘自动滚动，且曝光/对比度等实时作用到源图预览；隐藏的活动图层上绘制/擦除时警告并阻止。

**Architecture:** 问题3 在 store 的 `setCell`/`batchSetCells` 加隐藏层守卫（可测）+ PixelCanvas 守卫式 `appAlert`；问题1 改 `SelectionColorAdjustDialog` 为标题栏拖动 + 透明遮罩；问题2 源图预览改吃 `applyCalibration→applyAdjustmentsToPixels` 后的像素 + 容器中键平移 + 框选边缘自动滚动。

**Tech Stack:** React、zustand、Playwright（`platforms/vscode/` `npm run test:webview`）。

设计依据：`docs/superpowers/specs/2026-06-15-editor-ux-trio-design.md`

---

## 文件结构

**修改**
- `src/store/editorStore.ts` — `setCell`/`batchSetCells` 加 `if (!layer.visible) return;`
- `src/components/Canvas/PixelCanvas.tsx` — `warnIfActiveLayerHidden` 助手 + `applyTool`/形状提交守卫
- `src/components/Canvas/SelectionColorAdjustDialog.tsx` — 标题栏拖动 + 去遮罩
- `src/components/Import/ImageImportDialog.tsx` — 源图预览吃调整后像素 + 中键平移 + 边缘自动滚动

**新增**
- `platforms/vscode/tests/hiddenLayerGuard.spec.ts` — 隐藏层阻止集成测试

已知真实结构：
- store `setCell`（约 439 行）取 `const layer = state.layers[layerIdx];` 后改数据；`batchSetCells`（约 450 行）同样取 `const layer = state.layers[layerIdx];` 后改数据；`floodFill`/`floodErase` 经 `batchSetCells`。
- `PixelCanvas.tsx`：已 `import { appAlert } from "../Dialog/AppDialog"`，已 `import { useRef, useEffect, useCallback, useState, useMemo } from "react"`；`applyTool` 是 `useCallback((row,col)=>{ switch(currentTool){...} })`（约 826）；形状提交在 `handleMouseUp`（约 1176-1184）：`if (shapeStart.current && isShapeTool && shapePreview && shapePreview.length>0){ const entries=...; useEditorStore.getState().batchSetCells(entries); }`。
- `ImageImportDialog.tsx`：源图绘制 `drawCropCanvas`（约 202）用 `imagePreview.pixels`（预览分辨率 RGB）填 `createImageData`；匹配 useEffect（398-404）用 `rawPixels`（蓝图分辨率，独立）；已 `import { applyCalibration }`、`applyAdjustmentsToPixels`、`calibrationCoef`、`adjustments` 在作用域；缩放容器 `overflow:auto`，`cropCanvasRef`。
- 测试 helper：`setupPage`/`loadProject`/`cleanupHarness`/`callAction`/`getStoreState`/`setStoreState`。

---

## Task 1: 隐藏活动图层上绘制 → 警告并阻止

**Files:**
- Test: `platforms/vscode/tests/hiddenLayerGuard.spec.ts`
- Modify: `src/store/editorStore.ts`
- Modify: `src/components/Canvas/PixelCanvas.tsx`

- [ ] **Step 1: 写失败测试**

新建 `platforms/vscode/tests/hiddenLayerGuard.spec.ts`：

```ts
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { setupPage, loadProject, cleanupHarness, callAction, getStoreState } from "./helpers";

test.describe("hidden active layer blocks edits", () => {
  test.afterAll(() => cleanupHarness());

  async function activeCell(page: Page, r: number, c: number): Promise<number | null> {
    return page.evaluate(({ r, c }) => {
      const st = (window as any).__pindouStore.getState();
      const layer = st.layers.find((l: any) => l.id === st.activeLayerId);
      return layer.data[r][c].colorIndex;
    }, { r, c });
  }
  async function hideActive(page: Page) {
    const id = await getStoreState<string>(page, "activeLayerId");
    await callAction(page, "setLayerVisible", [id, false]);
  }
  async function showActive(page: Page) {
    const id = await getStoreState<string>(page, "activeLayerId");
    await callAction(page, "setLayerVisible", [id, true]);
  }

  test("setCell / batchSetCells / floodFill are no-ops on a hidden active layer", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    await callAction(page, "addLayer", []); // new active top layer (visible by default)
    await hideActive(page);

    await callAction(page, "setCell", [0, 0, 5]);
    expect(await activeCell(page, 0, 0)).toBeNull(); // blocked

    await callAction(page, "batchSetCells", [[{ row: 1, col: 1, colorIndex: 5 }]]);
    expect(await activeCell(page, 1, 1)).toBeNull(); // blocked

    await callAction(page, "floodFill", [2, 2, 5]);
    expect(await activeCell(page, 2, 2)).toBeNull(); // blocked (routes through batchSetCells)
  });

  test("edits resume after the layer is shown again", async ({ page }) => {
    await setupPage(page);
    await loadProject(page);
    await callAction(page, "newCanvas", [4, 4]);
    await callAction(page, "addLayer", []);
    await hideActive(page);
    await callAction(page, "setCell", [0, 0, 5]);
    expect(await activeCell(page, 0, 0)).toBeNull();

    await showActive(page);
    await callAction(page, "setCell", [0, 0, 5]);
    expect(await activeCell(page, 0, 0)).toBe(5); // works again
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run（在 `platforms/vscode/`）：`npm run test:webview -- hiddenLayerGuard`
Expected: FAIL —— 当前无守卫，隐藏层上 `setCell` 仍写入，`activeCell` 得到 5 而非 null。

- [ ] **Step 3: store 加隐藏层守卫**

在 `src/store/editorStore.ts`：

`setCell` 实现里，把
```ts
  setCell: (row, col, colorIndex) => {
    const state = get();
    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layer = state.layers[layerIdx];
    const prev = layer.data[row]?.[col]?.colorIndex ?? null;
```
改为（加一行守卫）：
```ts
  setCell: (row, col, colorIndex) => {
    const state = get();
    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layer = state.layers[layerIdx];
    if (!layer.visible) return; // don't edit a hidden layer
    const prev = layer.data[row]?.[col]?.colorIndex ?? null;
```

`batchSetCells` 实现里，把
```ts
  batchSetCells: (entries) => {
    const state = get();
    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layer = state.layers[layerIdx];
    const newLayerData = layer.data.map((r) => r.map((c) => ({ ...c })));
```
改为：
```ts
  batchSetCells: (entries) => {
    const state = get();
    const layerIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
    if (layerIdx === -1) return;
    const layer = state.layers[layerIdx];
    if (!layer.visible) return; // don't edit a hidden layer
    const newLayerData = layer.data.map((r) => r.map((c) => ({ ...c })));
```

> `floodFill` 经 `batchSetCells` 写入，`floodErase` 经 `floodFill`，故被一并阻止，无需单独改。

- [ ] **Step 4: 跑测试确认通过**

Run（在 `platforms/vscode/`）：`npm run test:webview -- hiddenLayerGuard`
Expected: PASS（2 用例）。

- [ ] **Step 5: PixelCanvas 加守卫式警告**

在 `src/components/Canvas/PixelCanvas.tsx`：

在组件内（与其它 `useRef` 并列处，例如 `eyedropWarnOpenRef` 附近）加：
```ts
  const hiddenLayerWarnRef = useRef(false);
  const warnIfActiveLayerHidden = useCallback((): boolean => {
    const st = useEditorStore.getState();
    const layer = st.layers.find((l) => l.id === st.activeLayerId);
    if (layer && !layer.visible) {
      if (!hiddenLayerWarnRef.current) {
        hiddenLayerWarnRef.current = true;
        appAlert("当前图层已隐藏，无法编辑，请先在图层面板显示该图层。", { title: "图层已隐藏" })
          .finally(() => { hiddenLayerWarnRef.current = false; });
      }
      return true;
    }
    return false;
  }, []);
```

在 `applyTool` 的 `useCallback((row, col) => {` 之后、`switch (currentTool) {` 之前插入：
```ts
      if (
        (currentTool === "pen" || currentTool === "eraser" ||
         currentTool === "fill" || currentTool === "eraserFill") &&
        warnIfActiveLayerHidden()
      ) {
        return;
      }
```
并把 `warnIfActiveLayerHidden` 加进 `applyTool` 的依赖数组。

在 `handleMouseUp` 的形状提交处（约 1176-1184），把
```ts
      if (shapeStart.current && isShapeTool && shapePreview && shapePreview.length > 0) {
        const entries = shapePreview
```
改为先查隐藏层：
```ts
      if (shapeStart.current && isShapeTool && shapePreview && shapePreview.length > 0 && !warnIfActiveLayerHidden()) {
        const entries = shapePreview
```
并把 `warnIfActiveLayerHidden` 加进 `handleMouseUp` 的依赖数组。

- [ ] **Step 6: 类型检查 + 全量回归**

Run（仓库根）：`npx tsc --noEmit -p tsconfig.json`
Expected: 无错误。

Run（在 `platforms/vscode/`）：`npm run test:webview`
Expected: 原有用例 + 新增 2 个全过。

- [ ] **Step 7: 提交**

```bash
git add src/store/editorStore.ts src/components/Canvas/PixelCanvas.tsx platforms/vscode/tests/hiddenLayerGuard.spec.ts
git commit -m "fix(layers): block + warn when editing a hidden active layer"
```
> 提交只 `git add` 这三个文件，不要 `git commit -am`/`git add -A`。

---

## Task 2: 选区颜色调整框可拖动 + 去遮罩

**Files:**
- Modify: `src/components/Canvas/SelectionColorAdjustDialog.tsx`

- [ ] **Step 1: 整体改写为可拖动浮窗**

把 `src/components/Canvas/SelectionColorAdjustDialog.tsx` 全文替换为：

```tsx
import { useState, useEffect, useRef } from "react";
import { useEditorStore } from "../../store/editorStore";
import { ColorAdjustPanel } from "../ColorAdjust/ColorAdjustPanel";
import { IDENTITY_ADJUSTMENTS, type ColorAdjustments } from "../../utils/colorAdjust";

interface Props {
  onClose: () => void;
}

const CARD_W = 288; // w-72

export function SelectionColorAdjustDialog({ onClose }: Props) {
  const begin = useEditorStore((s) => s.beginSelectionAdjust);
  const update = useEditorStore((s) => s.updateSelectionAdjustPreview);
  const commit = useEditorStore((s) => s.commitSelectionAdjust);
  const cancel = useEditorStore((s) => s.cancelSelectionAdjust);

  const [adj, setAdj] = useState<ColorAdjustments>({ ...IDENTITY_ADJUSTMENTS });
  const [snapRange, setSnapRange] = useState<"all" | "used">("all");

  // Floating position (initially centered horizontally, near the top third).
  const [pos, setPos] = useState(() => ({
    x: Math.max(8, Math.round(window.innerWidth / 2 - CARD_W / 2)),
    y: Math.max(8, Math.round(window.innerHeight * 0.18)),
  }));
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, px: 0, py: 0 });

  const onTitleDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    dragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return;
      const nx = dragStart.current.px + (e.clientX - dragStart.current.x);
      const ny = dragStart.current.py + (e.clientY - dragStart.current.y);
      setPos({
        x: Math.max(-CARD_W + 60, Math.min(window.innerWidth - 60, nx)), // keep grabbable
        y: Math.max(0, Math.min(window.innerHeight - 36, ny)),
      });
    };
    const up = () => { dragging.current = false; };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

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

  const apply = () => { commit(); onClose(); };
  const close = () => { cancel(); onClose(); };

  return (
    <div className="fixed inset-0 z-50" onMouseDown={close}>
      <div
        className="bg-white rounded-lg shadow-xl w-72 absolute"
        style={{ left: pos.x, top: pos.y }}
        onMouseDown={(e) => e.stopPropagation()}
        data-testid="selection-adjust-dialog"
      >
        <h3
          className="text-sm font-semibold px-4 py-2 border-b cursor-move select-none"
          onMouseDown={onTitleDown}
        >
          颜色调整
        </h3>
        <div className="p-4">
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
    </div>
  );
}
```

变化要点：外层去掉 `flex items-center justify-center bg-black/30`（透明、不变暗，仍 `onMouseDown={close}`）；卡片 `absolute` + `left/top` 定位；标题栏成为 `cursor-move` 拖动把手；拖动经 window 事件更新 `pos`，并钳制保证标题栏不被拖出视口。

- [ ] **Step 2: 类型检查 + 既有选区调整测试回归**

Run（仓库根）：`npx tsc --noEmit -p tsconfig.json`
Expected: 无错误。

Run（在 `platforms/vscode/`）：`npm run test:webview -- colorAdjust`
Expected: 既有 3 个选区调整集成用例仍全过（它们经 store action，不依赖对话框样式）。

- [ ] **Step 3: 手测**

启动应用 → 画布框选 → 右键「颜色调整...」→ 背景不变暗、能看清画布预览 → 拖标题栏移动对话框 → 点对话框外区域取消。

- [ ] **Step 4: 提交**

```bash
git add src/components/Canvas/SelectionColorAdjustDialog.tsx
git commit -m "fix(canvas): make selection color-adjust dialog draggable, drop the dimming scrim"
```

---

## Task 3: 导入预览中键平移 + 边缘自动滚动 + 源图实时调整

**Files:**
- Modify: `src/components/Import/ImageImportDialog.tsx`

- [ ] **Step 1: 源图预览吃调整后像素（问题 2b）**

在 `src/components/Import/ImageImportDialog.tsx`：

在 `adjustments` state 之后加一个 memo（`applyCalibration`/`applyAdjustmentsToPixels` 已 import）：
```ts
  const adjustedPreviewPixels = useMemo(() => {
    if (!imagePreview) return null;
    const calibrated = applyCalibration(imagePreview.pixels as number[], calibrationCoef);
    return applyAdjustmentsToPixels(calibrated, adjustments);
  }, [imagePreview, calibrationCoef, adjustments]);
```
> 若 `useMemo` 未在该文件 import，则在顶部 `from "react"` 里补 `useMemo`。

在 `drawCropCanvas`（约 202）里，把
```ts
    const { preview_width: pw, preview_height: ph, pixels } = imagePreview;
```
改为用调整后像素（无调整/无校正时与原图一致）：
```ts
    const { preview_width: pw, preview_height: ph } = imagePreview;
    const pixels = adjustedPreviewPixels ?? imagePreview.pixels;
```
把 `drawCropCanvas` 的依赖数组里加上 `adjustedPreviewPixels`，并在调用 `drawCropCanvas` 的 redraw `useEffect`（约 392 的依赖数组）里也加上 `adjustedPreviewPixels`，使拖动滑块时源图重绘。

- [ ] **Step 2: 中键平移（问题 2a-平移）**

找到缩放容器（`overflow:auto` 的那个 `<div>`，约 1063-1092 包着 `cropCanvasRef` 的容器）。给它加一个 ref 与中键拖动平移：

在组件内加：
```ts
  const zoomScrollRef = useRef<HTMLDivElement>(null);
  const panning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, sl: 0, st: 0 });
  const onPanDown = (e: React.MouseEvent) => {
    if (e.button !== 1) return; // middle button only
    const el = zoomScrollRef.current;
    if (!el) return;
    e.preventDefault();
    panning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!panning.current) return;
      const el = zoomScrollRef.current;
      if (!el) return;
      el.scrollLeft = panStart.current.sl - (e.clientX - panStart.current.x);
      el.scrollTop = panStart.current.st - (e.clientY - panStart.current.y);
    };
    const up = () => { panning.current = false; };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);
```
给该容器 `<div>` 加 `ref={zoomScrollRef}` 和 `onMouseDown={onPanDown}`（中键专用，不影响左键框选；其它已有 onMouseDown 行为保留，因 `onPanDown` 仅在 `button===1` 时动作）。

> 若该容器已有 `onMouseDown`，则在其处理器开头加 `if (e.button === 1) { onPanDown(e); return; }`，其余左键逻辑不变。

- [ ] **Step 3: 框选边缘自动滚动（问题 2a-自动滚动）**

加自动滚动逻辑：在框选拖动（`isDraggingCrop.current`）期间，指针接近容器边缘时滚动容器。加状态与 effect：
```ts
  const autoScroll = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const autoScrollRAF = useRef<number | null>(null);
  const EDGE = 24;   // px from edge to trigger
  const SPEED = 14;  // px per frame
  const runAutoScroll = () => {
    const el = zoomScrollRef.current;
    if (el && (autoScroll.current.dx || autoScroll.current.dy)) {
      el.scrollLeft += autoScroll.current.dx;
      el.scrollTop += autoScroll.current.dy;
    }
    autoScrollRAF.current = requestAnimationFrame(runAutoScroll);
  };
  useEffect(() => {
    autoScrollRAF.current = requestAnimationFrame(runAutoScroll);
    return () => { if (autoScrollRAF.current) cancelAnimationFrame(autoScrollRAF.current); };
  }, []);
  const updateAutoScrollFromEvent = (e: React.MouseEvent) => {
    const el = zoomScrollRef.current;
    if (!el || !isDraggingCrop.current) { autoScroll.current = { dx: 0, dy: 0 }; return; }
    const r = el.getBoundingClientRect();
    let dx = 0, dy = 0;
    if (e.clientX < r.left + EDGE) dx = -SPEED;
    else if (e.clientX > r.right - EDGE) dx = SPEED;
    if (e.clientY < r.top + EDGE) dy = -SPEED;
    else if (e.clientY > r.bottom - EDGE) dy = SPEED;
    autoScroll.current = { dx, dy };
  };
```
在 canvas 的 `onMouseMove` 处理器里（处理 crop 拖动那个，约 633 的 `handleCanvasMouseMove`）开头调用 `updateAutoScrollFromEvent(e)`；在 `onMouseUp`/`onMouseLeave` 时把 `autoScroll.current = { dx: 0, dy: 0 }` 清零（找到 crop 拖动结束处，约 633-684 的 mouseup/leave）。

> `isDraggingCrop` 是现有 ref（见文件顶部 state 区）。自动滚动只在框选拖动期间生效；选区坐标仍由现有 `mouseToOriginal` clamp 到图片内。

- [ ] **Step 4: 类型检查**

Run（仓库根）：`npx tsc --noEmit -p tsconfig.json`
Expected: 无错误。

- [ ] **Step 5: 手测**

启动应用 → 文件导入图片 → 放大（+ 到 3x/4x）：
- 拖曝光/对比度/饱和度滑块 → **源图预览实时变化**，下方拼豆/蓝图预览随之更新且一致；
- 按住**中键拖动** → 图片在框内平移；
- 左键框选拖到容器边缘 → 自动滚动，可框选到原先不可见的区域。

- [ ] **Step 6: 提交**

```bash
git add src/components/Import/ImageImportDialog.tsx
git commit -m "feat(import): live-adjusted source preview, middle-drag pan, edge auto-scroll for region select"
```

---

## 收尾

- [ ] 全量回归：root `npm test`；`platforms/vscode/` `npm run test:webview` 全过。
- [ ] 手测三项均符合验收口径（见各 Task 的手测步骤）。
- [ ] 按项目规范 squash 合并到 main（`git checkout main && git merge --squash fix/editor-ux-trio && git commit`），删分支。

---

## 自检结论

- **Spec 覆盖**：问题1=Task2（标题栏拖动+去遮罩）；问题2b=Task3 Step1（源图吃调整后像素）；问题2a=Task3 Step2-3（中键平移+边缘自动滚动）；问题3=Task1（store 阻止+UI 警告+测试）。全覆盖。
- **占位符**：无 TBD/TODO；每步含真实代码或确切命令。对话框给全文替换；store/PixelCanvas/import 给精确插入点与上下文锚点。
- **类型/名称一致**：`warnIfActiveLayerHidden`/`hiddenLayerWarnRef`、`layer.visible`、`adjustedPreviewPixels`、`zoomScrollRef`/`panning`/`autoScroll`、`applyCalibration`/`applyAdjustmentsToPixels`(已 import)、`appAlert(message,{title})`、`setLayerVisible(id,boolean)`、`getStoreState`/`callAction` 均与真实签名一致。
