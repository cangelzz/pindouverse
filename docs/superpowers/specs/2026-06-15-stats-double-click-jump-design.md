# 统计面板双击颜色跳转到色板 设计

日期：2026-06-15
状态：已批准设计，待写实现计划

## 1. 目标

在统计面板（`BeadCounter`，颜色用量统计）里**双击某个颜色行**，自动：
1. 把右侧面板从「统计」tab 切到「色板」tab；
2. 在色板里**选中**该色号（蓝色 ring + 自动滚动到可见）；
3. 在画布上**高亮**该色号的分布（淡化其他色 + 红框圈出）。

当前工具**不改变**。

## 2. 选定的关键决策

| 决策点 | 结论 |
|--------|------|
| 「高亮」含义 | 选中 ring（`selectedColorIndex`）**且** 画布分布高亮（`highlightColorIndex`） |
| 是否切工具 | 否，保持当前工具 |
| 触发方式 | 双击统计行（单击无新行为） |
| 架构 | 回调 prop，由 App 编排跨面板动作（不把 tab 状态搬进 store） |

## 3. 现有机制（复用，不改）

- **统计面板** `src/components/Stats/BeadCounter.tsx`：遍历 `BeadCount[]`（每项含 `colorIndex`）渲染表格行；当前每行仅有 hover 样式，无点击交互。
- **色板** `src/components/Palette/ColorPalette.tsx`：`selectedColorIndex` 控制选中态（`ring-2 ring-blue-500`），并有 useEffect 在 `selectedColorIndex` 变化时 `scrollIntoView` 自动滚到该色（按钮带 `data-color-index`）。
- **画布分布高亮** `src/utils/canvasRenderer.ts`：当 `highlightColorIndex` 非 null 时，非该色像素覆盖半透明白、该色分布画红框。
- **store** `src/store/editorStore.ts`：`setSelectedColor(index)`、`setHighlightColor(index)` 均为纯 `set` 动作。
- **布局** `src/App.tsx`：右侧面板用本地 `useState` 的 `rightTab: "palette"|"stats"|"layers"` 在三个 tab 间切换，`{rightTab === "palette" && <ColorPalette/>}` / `{rightTab === "stats" && <BeadCounter/>}` 条件渲染。统计与色板**不同时可见**，所以跳转必然要切 tab。

## 4. 架构（取向 A：回调 prop）

跨面板编排放在持有 `rightTab` 的 `App` 里，`BeadCounter` 保持纯展示。

**否决取向 B**：把 `rightTab` 提进 store + 原子 action。tab 本质是 App 局部 UI 状态，搬进 store 改动更大、收益有限。

## 5. 数据流

双击统计行（带 `colorIndex`）：
```
BeadCounter <tr> onDoubleClick
  → onColorActivate(colorIndex)            // prop
  → App.handleStatColorActivate(colorIndex):
       setSelectedColor(colorIndex)        // store：色板蓝 ring + useEffect 自动滚动
       setHighlightColor(colorIndex)       // store：画布淡化其他色 + 红框圈出分布
       setRightTab("palette")              // App 本地：切到色板 tab，ColorPalette 挂载即显示选中态
  // 不改当前工具
```

边界：统计行仅在该色 `count>0` 时存在，`colorIndex` 必有效，无额外边界处理；重复双击同色幂等。

## 6. 改动点

**3 个文件，色板/画布零改动。**

### `src/components/Stats/BeadCounter.tsx`
- 新增可选 prop：`onColorActivate?: (colorIndex: number) => void`
- 每行 `<tr>` 加 `onDoubleClick={() => onColorActivate?.(c.colorIndex)}`
- 行样式加 `cursor-pointer`，加 `title="双击：在色板中选中并高亮分布"` 提升可发现性

### `src/App.tsx`
- 新增 `handleStatColorActivate(colorIndex)`：依次 `setSelectedColor(colorIndex)`、`setHighlightColor(colorIndex)`、`setRightTab("palette")`
- 渲染处 `<BeadCounter />` → `<BeadCounter onColorActivate={handleStatColorActivate} />`
- 若 App 尚未从 `useEditorStore` 取 `setSelectedColor`/`setHighlightColor`，补上

### `src/components/Palette/ColorPalette.tsx` / `src/utils/canvasRenderer.ts`
- **不改**：蓝 ring、自动滚动、画布分布高亮均为现成响应。

## 7. 测试

新增 `platforms/vscode/tests/statsJump.spec.ts`（Playwright webview 集成，遵循 CLAUDE.md）。
这是对普通 DOM 表格行的 `dblclick`，**不是**合成 canvas 指针事件，符合规范。

- `setupPage` + `loadProject`，用 `callAction` 画几格已知色号（如 index 0、27），保证统计面板有对应行；
- 点右侧「统计」tab 按钮，断言 BeadCounter 渲染出行；
- 对某色号所在行 `dblclick`；
- 断言：
  - `getStoreState('selectedColorIndex') === 该 colorIndex`
  - `getStoreState('highlightColorIndex') === 该 colorIndex`
  - 色板 tab 已激活：存在可见的 `[data-color-index="该 colorIndex"]` 元素（即 ColorPalette 已挂载并渲染该色）

**验收口径**：双击统计行后，右侧切到色板、该色蓝 ring 选中并滚动到可见、画布该色分布被红框圈出且其余淡化；当前工具不变；重复双击幂等。

## 8. 涉及文件清单

**修改**
- `src/components/Stats/BeadCounter.tsx` — 双击 prop + 行交互样式
- `src/App.tsx` — 编排函数 + 传 prop

**新增**
- `platforms/vscode/tests/statsJump.spec.ts` — webview 集成测试

**复用（不改）**
- `src/components/Palette/ColorPalette.tsx`（选中 ring + 自动滚动）
- `src/utils/canvasRenderer.ts`（分布高亮）
- `src/store/editorStore.ts`（`setSelectedColor` / `setHighlightColor`）
