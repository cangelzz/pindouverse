# 三个编辑器 UX 修复设计（可拖动调整框 / 导入缩放选区+实时调整 / 隐藏图层警告）

日期：2026-06-15
状态：已批准设计，待写实现计划

三个独立但相关的编辑器 UX 问题，合并为一份规格、一个实现计划（三个任务）。

## 决策汇总

| 问题 | 决策 |
|------|------|
| 1 调整框拖动 | 标题栏拖动 + 去掉变暗遮罩（背景透明，点框外仍取消） |
| 2a 缩放选区 | 中键拖动平移 + 左键框选拖到容器边缘自动滚动（两者都要） |
| 2b 实时调整 | 曝光/对比度等实时作用到可缩放的**源图预览**，蓝图/拼豆预览与之一致 |
| 3 隐藏层操作 | 警告并**阻止**（store 兜底阻止 + UI 守卫式单次 appAlert） |

---

## 问题 1：选区颜色调整框可拖动

**文件**：`src/components/Canvas/SelectionColorAdjustDialog.tsx`

**现状**：固定居中模态——外层 `fixed inset-0 z-50 flex items-center justify-center bg-black/30`（`onMouseDown={close}`），内层白卡片 `bg-white rounded-lg shadow-xl p-4 w-72`（`onMouseDown` stopPropagation）；标题 `<h3>颜色调整</h3>`。

**改动**：
- 外层：去掉 `bg-black/30`（改透明）与 `flex items-center justify-center`；保留 `fixed inset-0 z-50` 与 `onMouseDown={close}`（点框外仍取消）。
- 卡片定位：用 state `pos {x,y}`（初始居中，挂载时按视口与卡片尺寸计算）+ `transform: translate(x,y)`；卡片仍 `onMouseDown` stopPropagation。
- 拖动把手：标题 `<h3>` 加 `cursor-move` 与 `onMouseDown` 开始拖动。复用 `ChangesCompareDialog.tsx`（108-145 行）的 useRef 模式：
  ```tsx
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
      setPos(clampToViewport(dragStart.current.px + (e.clientX - dragStart.current.x),
                             dragStart.current.py + (e.clientY - dragStart.current.y)));
    };
    const up = () => { dragging.current = false; };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);
  ```
- `clampToViewport`：保证卡片至少有一部分留在视口内（例如标题栏不被拖出屏幕），避免拖丢。

**不改**：调整逻辑、预览叠层、begin/commit/cancel 流程。

---

## 问题 2：导入图片缩放/平移选区 + 实时调整

**文件**：`src/components/Import/ImageImportDialog.tsx`

### 2b 实时调整源图预览（核心）
**现状**：可缩放的源图 canvas（`cropCanvasRef`）画的是原始预览像素；调整(`adjustments`)只经 `applyCalibration → applyAdjustmentsToPixels → matchImageToMard` 反映在**下方拼豆匹配预览**上，源图不变。

**改动**：源图预览 canvas 改为渲染**调整后**的像素。
- 新增 `useMemo`：
  ```ts
  const adjustedPreviewPixels = useMemo(() => {
    if (!previewPixels) return null;
    return applyAdjustmentsToPixels(applyCalibration(previewPixels, calibrationCoef), adjustments);
  }, [previewPixels, calibrationCoef, adjustments]);
  ```
  （`previewPixels` 为现有用于匹配的预览像素源；以代码中实际变量名为准，可能即 `rawPixels` 或 `imagePreview.pixels`。）
- 绘制源图预览的地方（现用原始像素 putImageData/绘制）改用 `adjustedPreviewPixels`（无调整且无校正时与原图一致）。
- 结果：拖曝光/对比度/饱和度滑块时，源图预览实时变化；蓝图/拼豆预览本就吃同一套调整后像素，二者一致。

### 2a 平移 + 边缘自动滚动
**现状**：缩放用 CSS 放大 canvas（`width/height = base * previewZoom`），容器 `overflow:auto` 提供滚动条；左键拖动用于框选 crop（new/move/edge），坐标经 `mouseToOriginal` 换算并 clamp 到图片内。

**改动**：
- **中键平移**：容器上监听中键（`button===1`）拖动 → 改 `container.scrollLeft/scrollTop`（`-= dx/-= dy`）；不与左键框选冲突，滚动条保留。中键拖动时 `preventDefault` 防止浏览器自动滚动模式。
- **边缘自动滚动**：左键框选拖动(`isDraggingCrop`)期间，若指针距容器边缘 < `EDGE`(约 24px)，按 `requestAnimationFrame` 循环朝该方向滚动容器（步长 ~12px/帧），并用当前指针位置持续更新 crop 终点（经 `mouseToOriginal` 换算+clamp）。指针离开边缘区或松开则停止自动滚动。
- 选区坐标仍 clamp 到图片边界（不越过图片本身）。

**不改**：缩放级别、crop 数据结构与现有换算函数 `mouseToOriginal`/`mouseToPreview`。

---

## 问题 3：隐藏图层操作警告并阻止

**文件**：`src/store/editorStore.ts`、`src/components/Canvas/PixelCanvas.tsx`

**现状**：活动图层 `visible===false` 时仍可绘制/擦除——`setCell`/`batchSetCells`/`floodFill`/`floodErase` 写活动层数据，但因图层隐藏在画布上看不到，造成困惑。`applyTool`（pen/eraser→`setCell`，fill→`floodFill`，eraserFill→`floodErase`）是绘制入口；形状(line/rect/circle)在 `handleMouseUp` 用 `batchSetCells` 提交。已有 `appAlert(message,{title})`。

**改动**：
- **store 兜底阻止**：`setCell`/`batchSetCells`/`floodFill`/`floodErase` 在取到活动图层后、改数据前加守卫：
  ```ts
  const layer = state.layers[layerIdx];
  if (!layer.visible) return;   // 不改数据、不进历史
  ```
  任何路径（绘制/形状提交/填充）都拦得住，且可测。
- **UI 警告**：`PixelCanvas` 加 `hiddenLayerWarnOpenRef = useRef(false)` 与小助手：
  ```ts
  function warnIfActiveLayerHidden(): boolean {
    const st = useEditorStore.getState();
    const layer = st.layers.find((l) => l.id === st.activeLayerId);
    if (layer && !layer.visible) {
      if (!hiddenLayerWarnOpenRef.current) {
        hiddenLayerWarnOpenRef.current = true;
        appAlert("当前图层已隐藏，无法编辑，请先在图层面板显示该图层。", { title: "图层已隐藏" })
          .finally(() => { hiddenLayerWarnOpenRef.current = false; });
      }
      return true;
    }
    return false;
  }
  ```
  - `applyTool` 开头：仅对编辑工具(pen/eraser/fill/eraserFill)，若 `warnIfActiveLayerHidden()` 为 true 则 `return`（不绘制）。
  - 形状提交（`handleMouseUp` 里 line/rect/circle 调 `batchSetCells` 前）：若 `warnIfActiveLayerHidden()` 为 true 则跳过提交。
  - 守卫 ref 保证拖动经过多格只弹一次提示。
- **不拦**：取色器(eyedropper)、选择(select/wand)、平移(pan)等非编辑工具。
- 粘贴/调整提交等其它走 `batchSetCells` 的操作：由 store 兜底阻止（不产生不可见编辑），不额外弹框（罕见，图层面板已显示隐藏态）。

---

## 测试

- **问题 3（可测）**：新增 `platforms/vscode/tests/hiddenLayerGuard.spec.ts`（Playwright，经 `callAction`，不合成 canvas 指针）：
  - `newCanvas` → `addLayer`（活动顶层）→ `setLayerVisible(activeId, false)` → `setCell(0,0,5)` → 断言活动层 (0,0) 仍为空（被阻止）。
  - `batchSetCells` / `floodFill` 同样在隐藏活动层上无变化。
  - `setLayerVisible(activeId, true)` → `setCell(0,0,5)` → 断言 (0,0)===5（恢复正常）。
- **问题 1 / 2（手测为主）**：DOM 拖动、canvas 缩放/平移/实时预览，靠手测：
  - 选区调整框：右键「颜色调整...」打开 → 拖标题栏移动 → 背景不变暗、能看清画布预览 → 点框外取消。
  - 导入：放大图片 → 中键拖动平移 → 左键框选拖到边缘自动滚动、可选到原先不可见处 → 拖曝光/对比度滑块，源图预览实时变、蓝图预览随之更新。
- 既有全量回归：root `npm test`、`platforms/vscode/` `npm run test:webview` 全过。

## 涉及文件清单

**修改**
- `src/components/Canvas/SelectionColorAdjustDialog.tsx` — 标题栏拖动 + 去遮罩
- `src/components/Import/ImageImportDialog.tsx` — 源图预览吃调整后像素 + 中键平移 + 边缘自动滚动
- `src/store/editorStore.ts` — 四个绘制原语隐藏层守卫
- `src/components/Canvas/PixelCanvas.tsx` — 隐藏层警告（applyTool + 形状提交）

**新增**
- `platforms/vscode/tests/hiddenLayerGuard.spec.ts` — 隐藏层阻止集成测试

**复用（不改）**
- `src/components/Dialog/AppDialog.tsx`（`appAlert`）
- `src/utils/colorAdjust.ts`（`applyAdjustmentsToPixels`）、`src/utils/colorCalibration.ts`（`applyCalibration`）
- `src/components/Canvas/ChangesCompareDialog.tsx`（拖动模式参考）
