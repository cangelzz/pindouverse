# 选区与图层三件套设计（浮动区域可操作 / 图层感知警告+复制 / 向下合并可撤销）

日期：2026-06-17
状态：已批准设计，待写实现计划

三个独立但相关的"选区/图层"增强，合并为一份规格、一个实现计划（三个任务）。

## 决策汇总

| 功能 | 决策 |
|------|------|
| 1 浮动区域可操作 | 浮动区域（`原地复制并拖动`/粘贴/拖动产生）= **完整右键菜单 + chip，和普通选区一样**；镜像在浮动原地翻转并保持浮动；其余菜单项一律"**先提交并重新选中 footprint → 再走现有普通选区处理**"复用现有逻辑；并把 commit/拖动落下改为**自动重新选中落点**（拖完不丢选区/菜单） |
| 2a 非当前图层警告 | **两处都警告**：选中时内联琥珀提示（非模态），操作时模态 `appConfirm`（默认取消） |
| 2b 复制所有可见图层 | 新增 `copySelectionAllVisibleLayers()`，右键菜单加"复制（所有可见图层）" |
| 3 向下合并 | **merge down，两层并一层**（上层拍到下层、移除上层、保留下层槽位），沿用下层名字、不透明度重置 100%、上层像素优先 |
| 3 确认 | 合并前弹 `appConfirm`，**文案含回退说明**（"切换图层前可 Ctrl+Z 撤销"）；不另做一次性提示 |
| 3 撤销 | 并入**主历史**：单一 `undoStack` 改为带标签联合（`cells` / `layers`），合并推入图层快照，由主 Ctrl+Z 驱动；单元格撤销与其它图层操作不变。限制：切换图层会清空历史（与全 app 一致），故合并撤销仅在切换图层前有效 |

涉及文件：
- `src/store/editorStore.ts`（核心：新 actions + 历史记录联合类型）
- `src/types/index.ts`（`HistoryAction` 类型调整）
- `src/components/Canvas/PixelCanvas.tsx`（右键/chip 触发条件、菜单接线）
- `src/components/Canvas/SelectionContextMenu.tsx`（浮动模式 + 新菜单项）
- `src/components/Canvas/SelectionActionsChip.tsx`（浮动支持 + 琥珀警告）
- `src/App.tsx`（图层行"合并到下层"按钮）

---

## 现状关键事实（来自代码勘察）

- **选区操作只读当前图层**：`copySelection`/`mirrorSelection`/`replaceColorInSelection`/`liftSelectionToFloat`/`duplicateSelectionAsFloating` 等都走 `layers.findIndex(l=>l.id===activeLayerId)` → `data[r][c]`。当前图层在选区内为空时静默无效果。
- **浮动选区**：`floatingSelection: { cells: Map<"lr,lc",CanvasCell>, offsetRow, offsetCol } | null`。`duplicateSelectionAsFloating()` 把选区拷进浮动并置 `selection:null`。`commitFloatingSelection()` 走 `batchSetCells` 写回当前图层（可撤销），**当前落完会清空选区**（本设计将改为重新选中 footprint）。
- **右键/chip 触发**：`PixelCanvas.tsx:1518` 仅当 `selection && selection.size>0 && !floatingSelectionState` 才开菜单；`:1576` 的 `SelectionActionsChip` 同条件。→ 浮动时既无 chip 也无右键菜单。
- **撤销模型**：`undoStack/redoStack: HistoryAction[]`，`HistoryAction = HistoryEntry[]`，`HistoryEntry={row,col,prevColorIndex,newColorIndex}`（作用于当前图层）。仅单元格级操作（`setCell`/`batchSetCells`/`replaceColor`）可撤销；图层操作（`addLayer`/`removeLayer`/`duplicateLayer`/`moveLayer`/`setActiveLayer`）都**清空**两个栈、不可撤销。
- **合成工具**：已有 `mergeLayers(layers,w,h)`（按可见性、上层非空覆盖，得到展平 `canvasData`），但**没有**对外的 merge action。
- **通知原语**：仅模态 `appAlert`/`appConfirm`/`appPrompt`（`src/components/Dialog/AppDialog.tsx`），**无 toast**。故"选中时"警告用内联 UI，不用模态。

---

## 功能 1：浮动（原地复制/拖动）区域可继续操作

**目标**：浮动区域（`原地复制并拖动`、粘贴、或拖动选区时产生）要和普通选区**一样**有完整右键菜单 + 操作 chip，用完不丢失。镜像在浮动上原地翻转、保持浮动；其余操作落下后回到普通选区继续。

**核心思路（最大化复用）**：浮动菜单 = 普通菜单。除"镜像""取消"外，每个菜单项在浮动模式下都先 `commitFloatingSelection()`（落到当前图层并**自动重新选中 footprint**），再调用现有的普通选区处理函数。于是几乎不需要为浮动单独写每个 action。

实际流程示例（满足"duplicate 也能保持浮动、循环不断"）：
> 普通选区 →「原地复制并拖动」→ 浮动副本，拖到位 → 落下后**自动重新选中这块** → 又是普通选区 → 再「原地复制并拖动」→ 新浮动副本 → …… 每次都留下原内容 + 一份可拖浮动，菜单全程在。镜像则在浮动当场可做、不必落下。

### Store（`editorStore.ts`）

新增 `mirrorFloatingSelection(direction: "horizontal" | "vertical"): void`（浮动模式下"镜像"的唯一特例——不落盘、保持浮动）：
- 取 `floatingSelection`；若无则返回。
- 由 `cells` 的键（`"lr,lc"`，局部坐标）求**实际占用包围盒** `[minR..maxR, minC..maxC]`（避免空行/空列偏移）。
- 构造新 Map：水平翻转列 `lc' = minC + maxC - lc`，垂直翻转行 `lr' = minR + maxR - lr`；值取原 `(lr,lc)`。`offsetRow/offsetCol` 不变。
- `set({ floatingSelection: { cells: newCells, offsetRow, offsetCol } })`。**不**走 `batchSetCells`、**不**入历史。

新增 `discardFloatingSelection(): void`（浮动模式下"取消"）：`set({ floatingSelection: null })`（不提交，区别于 `clearSelection()` 会先 commit）。

修改 `commitFloatingSelection()`：落盘后**不再清空选区**，而是把落点 footprint（被写入的 cell 坐标集合，裁剪到画布内）重新设为 `selection`/`selectionBounds`。
- 影响：所有"落下浮动"的场景（菜单提交、拖动 drop、`pasteClipboard` 内部先提交旧浮动）落完都会留下一个普通选区 → chip/菜单不丢。
- `clearSelection()` 仍在 commit 后显式清空（行为不变：取消选区就是要清掉）。
- 注意核对依赖 commit 后 `selection===null` 的现有测试，按新语义更新。

### 画布（`PixelCanvas.tsx`）

- 计算浮动区域的屏幕包围盒（由 `floatingSelection` 的 cells 局部坐标 + offset + `cellSize/offsetX/offsetY` 推算），供 chip 与右键定位。
- `onContextMenu`（1518 行）：条件改为 `(selection && selection.size>0 && !floatingSelectionState) || floatingSelectionState` 时 `setContextMenu`。
- `SelectionActionsChip`（1576 行附近）：`floatingSelectionState` 时也渲染，定位在浮动包围盒。
- 向 `SelectionContextMenu` 传 `mode: "selection" | "floating"`。`floating` 模式下，菜单各项的回调由 `PixelCanvas` 包装：
  - 镜像 → `mirrorFloatingSelection(dir)`（特例，保持浮动）
  - 取消 → `discardFloatingSelection()`（特例，丢弃）
  - 其余每项（提交到图层 / 移到新图层 / 移到图层X / 复制 / 复制(所有可见图层) / 原地复制并拖动 / 替换颜色 / 颜色调整）→ 先 `commitFloatingSelection()`，再调用对应的现有普通处理函数（`moveSelectionToNewLayer` / `moveSelectionToLayer` / `copySelection` / `duplicateSelectionAsFloating` / 打开替换/调整对话框 …）。
    - 其中「原地复制并拖动」= commit（落下并重选）+ `duplicateSelectionAsFloating()` → 又回到浮动，正好实现"留下原内容 + 新可拖浮动"。
    - 「替换颜色 / 颜色调整」commit 后是普通选区，复用现有对话框（即你确认的"提交后再改"）。

### 菜单（`SelectionContextMenu.tsx`）

- 新增可选 prop `mode`（默认 `"selection"`）。**菜单项与普通模式完全一致**（含功能 2 的新项），不再裁剪。
- `mode==="floating"` 仅多两个语义入口：把"取消选区"显示为"取消（丢弃浮动）"，并保证"提交到图层"项存在（普通模式无此项，浮动模式追加）。其余项点击走上面 `PixelCanvas` 包装的 commit-then-handler。

---

## 功能 2：图层感知——非当前图层警告 + 复制所有可见图层

### 判定辅助（`editorStore.ts` 内部纯函数）

- `selectionActiveLayerHasContent(state): boolean`——选区内当前图层是否存在非空 cell。
- `selectionVisibleHasContent(state): boolean`——选区内**任一可见图层**是否存在非空 cell。
- "内容在别处"条件 = `!selectionActiveLayerHasContent && selectionVisibleHasContent`。

### 2a 警告（两处）

**选中时（非模态，内联）**：`SelectionActionsChip` 增加一处琥珀提示行。当"内容在别处"为真时显示：
> ⚠ 选区内容在其他图层（当前图层为空）

仅展示，不阻断。chip 已随选区浮动定位，复用其容器。判定在组件内基于 store 选区与图层计算（或由 store 暴露一个派生 selector）。

**操作时（模态 `appConfirm`）**：对"只作用于当前图层"的操作做统一守卫——`镜像`、`替换颜色`、`颜色调整`、`复制`、`移到新图层`。在触发这些操作前，若"内容在别处"为真，弹：
> 当前图层在选区内没有内容，操作不会有效果。是否继续？

默认（回车/默认按钮）= **取消**；确认则照常执行（通常即无效果，但尊重用户选择）。
- 实施位置：放在 `PixelCanvas` 调用这些 store action 的接线处（菜单回调里 `await appConfirm(...)` 守卫），避免污染 store 纯逻辑；store action 自身保持幂等无副作用即可。

### 2b 复制所有可见图层（`editorStore.ts`）

新增 `copySelectionAllVisibleLayers(): void`：
- 无选区返回。
- 在选区包围盒 `{r1,c1,r2,c2}` 内，对每个选中 cell 自下而上遍历**可见**图层（`visible===true`），取最上层非空 `colorIndex`，写入 `cells: Map<"lr,lc",CanvasCell>`（局部坐标，相对 `r1,c1`），跳过全空 cell。
- 与 `copySelection` 一致：`set({ clipboard: { cells, width: c2-c1+1, height: r2-r1+1 } })` 并尝试写系统剪贴板（同 `pindou-selection` JSON 格式）。
- 粘贴沿用现有 `pasteClipboard()` → 居中浮动 → `commitFloatingSelection()` 落到当前图层（展平）。

### 菜单项

`SelectionContextMenu`（`mode==="selection"`）在现有 `复制` 下新增：
- `复制（所有可见图层）` → `onCopyAllVisible`（接到 `copySelectionAllVisibleLayers`）。

该项不受 2a 操作守卫限制（它本就是为"内容在别处"准备的）。

---

## 功能 3：向下合并图层，可撤销

### 历史记录联合类型（`types/index.ts` + `editorStore.ts`）

把历史单位从 `HistoryEntry[]` 升级为带标签联合：
```ts
type CellHistory  = { kind: "cells";  entries: HistoryEntry[] };
type LayerHistory = { kind: "layers"; layers: BeadLayer[]; activeLayerId: string }; // 操作前快照
type HistoryAction = CellHistory | LayerHistory;
```
- 所有现有压栈点（`setCell`/`batchSetCells`/`endStroke`/`replaceColor`）改为包成 `{kind:"cells",entries}`，行为不变。
- `undo()`/`redo()` 按 `kind` 分支：
  - `cells`：与现状一致（反向/正向写单元格，作用当前图层）。
  - `layers`：与"当前 layers/activeLayerId"互换——undo 时把当前快照存入对侧栈、恢复记录里的快照；redo 反之。
- 其它图层操作（add/remove/move/duplicate/setActiveLayer）维持现状（清空两栈、不可撤销），不在本次范围。
- **合并撤销的生命周期**：合并快照入主 `undoStack` 后，合并完成会把 `activeLayerId` 指向合并后的下层（用户停留其上），故紧接着 Ctrl+Z 即可 unmerge。但一旦用户**切换图层**（`setActiveLayer` 清空两栈）或之后做满 `MAX_HISTORY` 次操作，合并快照即丢失、不可再撤销。此为与全 app 一致的取舍，并由合并确认框文案显式告知。
- `deserialize`/加载项目时不持久化历史（与现状一致），无需迁移。

### Store action `mergeLayerDown(id: string): void`

- `idx = layers.findIndex(l=>l.id===id)`；若 `idx<=0`（最底层或未找到）→ 返回（UI 也禁用）。
- 上层 = `layers[idx]`，下层 = `layers[idx-1]`。
- 拍平：逐 cell，上层 `colorIndex` 非空则取上层，否则取下层（**上层优先**；忽略不透明度）。生成新的下层 `data`。
- 合并后图层：`{ id: 下层.id, name: 下层.name, data: 合并data, visible: true, opacity: 1, ... }`（沿用下层 id 与 name，opacity 归 1）。
- 新 `layers` = 删除 `idx`、用合并图层替换 `idx-1`；`activeLayerId = 下层.id`。
- **压入历史快照**：先取操作前 `{kind:"layers", layers: 深拷贝当前 layers, activeLayerId: 当前 activeLayerId}` 入 `undoStack`（`slice(-MAX_HISTORY)`），清空 `redoStack`，`isDirty:true`。
- 同步刷新 `canvasData = mergeLayers(newLayers,...)`（与其它图层操作一致）。

### UI（`App.tsx` 图层行）

- 在每个图层行按钮区（现有 上/下/复制/删除 一排，约 770-790 行）新增 **合并到下层** 按钮。
- 该图层为最底层（`layers.findIndex===0`）时禁用。
- 点击先 `await appConfirm(...)` 确认，确认后再调 `mergeLayerDown(layer.id)`；store action 自身保持纯逻辑（不弹框）。
- 确认框文案（含回退说明），例如：
  > 向下合并？「{上层名}」将并入「{下层名}」，合并为一层。\n切换图层前可用 Ctrl+Z 撤销。
- 可选小图标/文案："合并↓" 或 "合并到下层"。

---

## 数据流与边界

- 浮动镜像：纯内存 Map 变换，无落盘、无历史；提交时才走既有 `commitFloatingSelection`（一条 cells 历史）。
- 复制所有可见图层：只写 clipboard，不改图层、不入历史；落盘发生在粘贴提交时。
- 合并：一次性结构变更，单条 `layers` 历史；undo 完整还原 `layers + activeLayerId`。undo 一条合并后，其下方的 `cells` 历史仍指向被还原的当前图层（快照含 activeLayerId，故一致）。

## 错误处理 / 边界用例

- 浮动 cells 全空（不可能，但防御）→ 镜像/提交无操作。
- `commitFloatingSelection` 重新选中 footprint 时，落点全部被裁剪到画布外（极端）→ footprint 为空 → `selection` 置 null（退化为无选区，安全）。
- 合并最底层 → 禁用 + store 守卫双保险。
- 合并时画布尺寸：两层同尺寸（同 canvasSize），无需重采样。
- 选区为空或全空 → 复制所有可见图层得到空 clipboard：跳过 `set`（与 `copySelection` 一致，避免清掉旧 clipboard）。
- `appConfirm` 守卫期间用户切换了当前图层：守卫读 store 实时状态，确认后再次以最新 activeLayer 执行（与 `commitSelectionAdjust` 的 layerId 校验思路一致）。

## 测试计划（Playwright webview + store）

- `selection-actions.spec.ts` 扩展：
  - 浮动模式 chip + 右键菜单出现（`duplicateSelectionAsFloating` 后，`floatingSelection` 存在时菜单/ chip 可触发，菜单项与普通模式一致 + "提交到图层"）。
  - `mirrorFloatingSelection` 原地翻转：浮动 cells 按实际包围盒水平/垂直镜像，`floatingSelection` 仍非空、offset 不变、未落盘。
  - `commitFloatingSelection` 落下后**重新选中 footprint**：commit 后 `selection` 非空且等于落点坐标集；拖动 drop 同理。
  - `discardFloatingSelection`：浮动清空且未写图层。
  - 浮动「原地复制并拖动」循环：commit+`duplicateSelectionAsFloating` 后图层留下原内容、又得到新的 `floatingSelection`。
  - `copySelectionAllVisibleLayers`：构造两图层（当前层选区内空、下层有色），复制→粘贴→提交，当前图层落到展平内容。
  - 操作守卫：当前层空、下层有色时，菜单触发镜像 → 期望走到 confirm 分支（store 不被无效调用 / 通过桩验证）。
- 新增 `layer-merge.spec.ts`：
  - `mergeLayerDown` 上层优先合成、层数 -1、activeLayer 指向合并层。
  - 合并后 `undo()` 还原两层与 activeLayerId；`redo()` 再次合并。
  - 最底层 `mergeLayerDown` 无操作。
  - UI："合并到下层" 按钮先弹 `appConfirm`（用 `stageReply`/确认桩），取消则不合并、确认才合并；最底层按钮禁用。
- 必要处加 store 引擎单测（合并合成、历史联合类型 undo/redo）。

## 非目标（YAGNI）

- 不做"向上合并"、"合并全部可见"、"合并选中多层"。
- 不把 add/remove/move/duplicate 纳入可撤销（仅 merge）。
- 合并不做 alpha 混合（纯上层优先）。
- 浮动模式的"替换颜色/颜色调整"不在浮动 buffer 上直接改，而是提交后复用现有对话框（已确认）。
