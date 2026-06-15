# 色彩调整机制设计（曝光/对比度/饱和度/鲜艳度/色温/色调）

日期：2026-06-15
状态：已批准设计，待写实现计划

## 1. 目标

为拼豆编辑器提供一组照片式色彩调整（曝光、对比度、饱和度、鲜艳度、色温、色调），
在**导入图片**和**画布选区**两个场景都可用，调整后让对应的拼豆**色号自动跟随重新吸附**。

本机制与现有「色彩校正（标定）」不同：
- **校正/标定**（已有）：基于"采样区域 RGB ↔ 目标色号 RGB"对，用最小二乘解逐通道线性系数，
  目的是把相机/源图偏色**客观还原**到真实豆色。
- **本设计的调整**：在还原后的基础上做**主观创意微调**。

## 2. 选定的关键决策

| 决策点 | 结论 |
|--------|------|
| 「敏感度」含义 | 同时提供**饱和度 Saturation** + **鲜艳度 Vibrance** 两个滑块 |
| 选区调整语义 | 取每格当前色号的 RGB → 调整变换 → 重新吸附到最近可用色号（离散、有损、一次性） |
| 预览方式 | **实时预览**：拖动滑块即时重算并显示 |
| UI 入口 | 统一进「校正/调整」面板；导入与选区共用同一套调整面板组件 |
| 画布无选区时 | **必须先选区**才能调整；无选区时菜单项灰显 |
| 重吸附候选范围 | **可切换开关**：`全色板`（或当前色组） / `仅已用色`（项目所有图层已出现的色号集合） |
| 色调定义 | 取**白平衡 tint（绿↔品红）**，与色温（蓝↔黄）配对，**不是** Hue 旋转 |

## 3. 架构总览（取向 A）

纯函数引擎 + 临时预览叠层 + 色号查找表(LUT)。

- 新建无平台依赖的 `src/utils/colorAdjust.ts`，输入 RGB → 输出 RGB。
- **导入路径**：`原始像素 → applyCalibration(标定) → applyAdjustmentsToPixels(调整) → matchImageToMard → 预览`，复用现有匹配。
- **选区路径**：选区内不同色号最多 295 种，故每次滑块变动只算 ≤295 次"变换+重吸附"得到
  `srcIndex→dstIndex` 的 LUT，再映射到全部格子——与选区格数无关，几万格也能实时。
- **预览不污染数据**：store 加临时叠层 `previewOverlay`，画布在其上渲染，不进撤销栈；
  「应用」时才用一次 `batchSetCells`（单步撤销），「取消」直接丢弃。每次都从**原始快照**重算，
  拖回 0 即恢复，不累积误差。

### 被否决的取向
- **B 直接改格子再回滚**：预览时真的写格子并抑制历史，取消时从快照还原。少一个叠层概念，
  但易与现有撤销/自动保存冲突（最近刚修过 Ctrl+Z 清空 bug），风险高。
- **C 把选区当虚拟图片走完整导入管线**：语义统一但重；选区是离散色号、无连续像素，
  强套导入管线别扭。

## 4. 调整引擎（核心，纯函数）

新文件 `src/utils/colorAdjust.ts`：

```ts
export interface ColorAdjustments {
  exposure: number;    // -100..+100, 0=原样（内部映射到约 ±2 档）
  contrast: number;    // -100..+100
  saturation: number;  // -100..+100
  vibrance: number;    // -100..+100（低饱和区加权更强，保护已饱和色）
  temperature: number; // -100..+100（蓝↔黄，暖加 R 减 B）
  tint: number;        // -100..+100（绿↔品红）
}
export const IDENTITY_ADJUSTMENTS: ColorAdjustments; // 全 0

export function applyAdjustments(rgb: [number,number,number], adj: ColorAdjustments): [number,number,number];
export function applyAdjustmentsToPixels(pixels: Uint8Array|number[], adj: ColorAdjustments): Uint8Array; // 导入用
export function isIdentity(adj: ColorAdjustments): boolean;
```

**管线**：在 0–1 浮点空间，固定顺序
`曝光 → 白平衡(色温/色调) → 对比度 → 饱和度 → 鲜艳度 → 钳到 0–255`。
全 0 时 `applyAdjustments` 严格恒等。

## 5. 选区路径

### 候选池（snap 开关，复用现有 `groupId`）
- `全色板`：在 `MARD_COLORS`（或当前色组）里找最近色号。
- `仅已用色`：池 = 项目内**所有图层**已出现过的 `colorIndex` 去重集合（已买的豆种），不凭空增豆。

### LUT 计算（每次滑块变动，纯函数）
```ts
// src/utils/colorAdjust.ts
export function buildSelectionRemap(
  srcIndices: number[],              // 选区里去重后的色号
  adj: ColorAdjustments,
  candidatePool: number[],           // 全色板 or 仅已用色
  algorithm: ColorMatchAlgorithm,    // 复用现有 euclidean / ciede2000
  overrides: ColorOverrideMap,
): Map<number, number>               // srcIndex → dstIndex
```
对每个 `srcIndex`：`getEffectiveColor(rgb) → applyAdjustments → findClosestColor(候选池)`。
最多算 295 次，与选区格数无关。

### store 新增（`src/store/editorStore.ts`）
```ts
previewOverlay: Map<string, number> | null;          // "r,c" → 预览色号，仅渲染、不进数据/撤销
beginSelectionAdjust(): void;                         // 快照选区原始色号 + 算 srcIndices / usedColors
updateSelectionAdjustPreview(adj, snapRange): void;   // 重算 LUT → 写 previewOverlay（实时, ~16ms 防抖）
commitSelectionAdjust(): void;                        // 用最终 LUT 跑一次 batchSetCells（单步撤销）→ 清叠层
cancelSelectionAdjust(): void;                        // 丢弃叠层
```
预览始终从**原始快照**重算（拖回 0 即恢复，无累积）。`PixelCanvas` 渲染时若 `previewOverlay`
有该格则优先用其色号。

## 6. 导入路径

现有 `ImageImportDialog` 管线：
```
原始像素 → applyCalibration(标定) → matchImageToMard → 预览
```
改为：
```
原始像素 → applyCalibration(标定) → applyAdjustmentsToPixels(调整) → matchImageToMard → 预览
```

- **校正在前、调整在后**：标定是客观还原，调整是主观创意，分工不同、顺序固定。
- **实现**：现有 `useMemo`（从 `pixels + calibration` 算匹配）把 `adjustments` 加进依赖，
  在 `applyCalibration` 之后、`matchImageToMard` 之前插一行 `applyAdjustmentsToPixels`。
  React 状态驱动，实时预览天然成立；预览是降采样图，性能无忧。
- **导入不加 "仅已用色" 开关**：导入时项目通常为空，没有"已用色"概念；导入沿用现有色组选择。

## 7. UI 与交互

### 共享组件 `src/components/ColorAdjust/ColorAdjustPanel.tsx`
- 6 个滑块（曝光/对比度/饱和度/鲜艳度/色温/色调），各配数字输入 + 双击归零。
- 顶部「全部重置」；`isIdentity` 时给出"无调整"灰显提示。
- 纯受控：`value: ColorAdjustments` + `onChange`，不含业务逻辑，导入与选区共用。

### 入口 A — 导入对话框
把 `ColorAdjustPanel` 放进现有「色彩校正」面板下方：上半标定取样、下半创意调整。

### 入口 B — 画布选区
右键菜单（`SelectionContextMenu.tsx`）新增「颜色调整…」→ 打开 `SelectionColorAdjustDialog`：
- 内嵌 `ColorAdjustPanel`；顶部 snap 开关 `全色板 / 仅已用色`；底部 `应用 / 取消`。
- 打开即 `beginSelectionAdjust()`；滑块/开关变动 → `updateSelectionAdjustPreview()`（防抖，实时画布预览）；
  应用 → `commitSelectionAdjust()`；取消/关闭 → `cancelSelectionAdjust()`。
- 无选区时菜单项灰显。

### 撤销/重做
选区调整全过程只在「应用」时产生**一次** `batchSetCells` 历史，单步可撤销；
预览叠层永不进历史。导入路径不涉及画布撤销。

### 平台
全部为 `src/` 纯逻辑 + React 组件 + zustand store，VS Code webview 直接共用，
**无需改 extension host**（纯 webview 内计算）。

## 8. 测试

### 单元测试 `tests/colorAdjust.test.ts`（Vitest）
- `IDENTITY_ADJUSTMENTS` → `applyAdjustments` 严格恒等（逐通道相等）。
- 单调性：曝光↑ 亮度不减；对比度↑ 暗更暗亮更亮；饱和度 −100 → 灰阶（R=G=B）；色温↑ R 升 B 降。
- 边界钳位：极端参数仍在 0–255。
- `buildSelectionRemap`：恒等参数 → LUT 全 `src===dst`；`仅已用色` 池下 dst 必在已用集合内；空选区 → 空 LUT。

### Webview 集成测试 `platforms/vscode/tests/colorAdjust.spec.ts`（Playwright，遵循 CLAUDE.md）
- `callAction` 设选区 → `beginSelectionAdjust` → `updateSelectionAdjustPreview(非恒等)` →
  断言 `previewOverlay` 有值但底层数据未变。
- `commitSelectionAdjust` → 断言数据已变 + 一次 `undo` 完全复原。
- `cancelSelectionAdjust` → 断言数据不变、叠层清空。
- snap 开关 `仅已用色` → 断言结果色号都来自原已用集合。

### 验收口径
- 恒等参数对任何选区/导入都不改一格。
- 选区调整单步可撤销。
- 几万格选区实时预览不卡（LUT ≤295 次计算）。

## 9. 涉及文件清单

**新增**
- `src/utils/colorAdjust.ts` — 调整引擎 + `buildSelectionRemap`
- `src/components/ColorAdjust/ColorAdjustPanel.tsx` — 共享滑块面板
- `src/components/Canvas/SelectionColorAdjustDialog.tsx` — 选区调整对话框
- `tests/colorAdjust.test.ts` — 单元测试
- `platforms/vscode/tests/colorAdjust.spec.ts` — webview 集成测试

**修改**
- `src/store/editorStore.ts` — `previewOverlay` 状态 + 4 个 action
- `src/components/Canvas/PixelCanvas.tsx` — 渲染时优先用 `previewOverlay`
- `src/components/Canvas/SelectionContextMenu.tsx` — 新增「颜色调整…」菜单项
- `src/components/Import/ImageImportDialog.tsx` — 管线插入调整 + 嵌入面板

**复用（不改）**
- `src/utils/colorMatching.ts`（`matchImageToMard` / `findClosestColor`）
- `src/utils/colorCalibration.ts`（`applyCalibration`）
- `src/utils/colorHelper.ts`（`getEffectiveColor`）
- `src/data/mard221.ts`（`MARD_COLORS`）
