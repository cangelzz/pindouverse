# 取色器只取活动图层（修复多图层透出底层色）设计

日期：2026-06-15
状态：已批准设计，待写实现计划

## 1. 问题（已确认的 bug）

多图层时，取色器（eyedropper）取到的是**合并视图**的颜色，而非**活动图层**的颜色。
当活动图层在某格为空、但下层（或其他可见层）在该格有颜色时，取色器会取到那个非活动层的颜色。

根因：`src/components/Canvas/PixelCanvas.tsx` 的 `applyTool` eyedropper 分支读 `canvasData[row]?.[col]`，
而 `canvasData` 是 store 里 `mergeLayers(所有可见图层)` 的合并视图（`editorStore` 注释即 `// computed merged view`）。
对比：同文件 fill/floodErase 正确地按活动图层 `state.layers[active].data` 取值——唯独取色器用了合并视图。

## 2. 期望行为

- 取色器只看**活动图层**该格：
  - 有颜色 → 选中该色（并沿用原行为切到画笔）。
  - 为空 → **不取色、保持当前选中色不变**，并提示用户"当前图层的这个位置没有颜色"。
- 单图层时行为不变（合并视图==该层）。

## 3. 选定的关键决策

| 决策点 | 结论 |
|--------|------|
| 取色来源 | 仅活动图层（`layers.find(active).data[row][col]`） |
| 活动层为空时 | 保持当前选中色不变，仅提示 |
| 提示方式 | 复用现有模态 `appAlert`（`src/components/Dialog/AppDialog.tsx`） |
| 防刷屏 | `useRef` 守卫：同一时刻最多一个提示框（拖过多个空格只弹一次） |

## 4. 关键约束：拖动会重复触发

`applyTool` 既被 `handleMouseDown` 调用，也被 `handleMouseMove` 在拖动时调用
（`if (isDragging.current && e.buttons === 1) applyTool(cell.row, cell.col)`）。
`appAlert` 会**入队**，若拖过一串空格会弹出多个模态框。
因此用一个 `eyedropWarnOpenRef`（`useRef(false)`）守卫：仅当当前没有提示框打开时才弹，
弹框 `.finally` 后复位。保证任意时刻至多一个提示框。

## 5. 架构

把"按活动图层取色"的取值逻辑放进 store action（与现有 `floodFill`/`floodErase` 同为 store action 的模式一致），
便于用 `callAction` 测试、**避免合成 canvas 指针事件**（CLAUDE.md 测试指引）。
提示（`appAlert`）与切工具（`setTool`）仍由组件负责（保留 `setTool` 的完整副作用）。

## 6. 改动点

### `src/store/editorStore.ts` — 新增 action `pickActiveLayerColor`
接口声明（与其它 action 同区）：
```ts
pickActiveLayerColor: (row: number, col: number) => boolean;
```
实现：
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
- 仅设 `selectedColorIndex`（取到时）；为空返回 `false`、不改任何状态。
- **不**在此 action 内切工具（`setTool` 留给组件，保留其副作用）。

### `src/components/Canvas/PixelCanvas.tsx`
- 顶部 import：`import { appAlert } from "../Dialog/AppDialog";`
- 组件内加守卫 ref：`const eyedropWarnOpenRef = useRef(false);`
- `applyTool` 的 eyedropper 分支（约第 841-848 行）改为：
  ```ts
  case "eyedropper": {
    if (useEditorStore.getState().pickActiveLayerColor(row, col)) {
      setTool("pen");
    } else if (!eyedropWarnOpenRef.current) {
      eyedropWarnOpenRef.current = true;
      appAlert("当前图层的这个位置没有颜色。", { title: "无法取色" })
        .finally(() => { eyedropWarnOpenRef.current = false; });
    }
    break;
  }
  ```
- `applyTool` 依赖数组里的 `canvasData` 可保留（无害；eyedropper 不再用它，但其它分支也未用 canvasData，保留不影响）。

**不改**：合并视图渲染、其它工具、fill/eraser（它们本就按活动层）。

## 7. 测试

核心 bug（按活动层取色）通过 store action 用 `callAction` 充分覆盖，不合成 canvas 指针事件。
模态提示是简单 UI 接线，手测验证。

新增 `platforms/vscode/tests/eyedropperLayer.spec.ts`（Playwright webview 集成）：

- **底层有色、活动层（上层）该格为空**：
  - `newCanvas` → 在当前（底）层画 `(0,0)=5` → `addLayer`（新层成为活动层，在 `(0,0)` 为空）
  - 先把 `selectedColorIndex` 设成一个已知值（如 `callAction('setSelectedColor',[3])`）
  - `callAction('pickActiveLayerColor',[0,0])` 返回 `false`
  - 断言 `getStoreState('selectedColorIndex') === 3`（**未被底层色 5 覆盖**——回归本 bug 的关键）
- **活动层该格有色**：
  - 在活动层画 `(1,1)=9` → `callAction('pickActiveLayerColor',[1,1])` 返回 `true`
  - 断言 `getStoreState('selectedColorIndex') === 9`
- **空格越界/无效**：`callAction('pickActiveLayerColor',[99,99])` 返回 `false`、`selectedColorIndex` 不变

**验收口径**：多图层下取色器只取活动图层该格颜色；活动层为空则不取（保持原选中色）并弹一次"无法取色"提示；拖过多个空格只弹一个框；单图层行为不变。

## 8. 涉及文件清单

**修改**
- `src/store/editorStore.ts` — 新增 `pickActiveLayerColor`
- `src/components/Canvas/PixelCanvas.tsx` — eyedropper 分支改用 action + 守卫式提示

**新增**
- `platforms/vscode/tests/eyedropperLayer.spec.ts` — 集成测试

**复用（不改）**
- `src/components/Dialog/AppDialog.tsx`（`appAlert`）
