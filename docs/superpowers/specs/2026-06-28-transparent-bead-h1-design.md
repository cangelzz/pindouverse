# 透明珠（H1）设计 — Transparent Bead

**日期**：2026-06-28
**状态**：已批准设计，待写实现计划

## 背景与目标

MARD 调色板的 H 系列里，`H1`（hex `#FBFBFB`，近白）实际对应的是一颗**透明珠**——一种真实存在的、无色透明的拼豆。它和纯白珠 `H2`（`#FFFFFF`）不是一回事，也和**空格**（`colorIndex === null`，没有珠子）不是一回事：透明珠是一颗真实占格的珠子，只是看上去透明。

代码里已经存在 `TRANSPARENT_CODES = new Set(["H1", "T1"])`，把这两个色号排除在自动配色之外。但目前 H1 仍按其近白 hex 实心渲染，导致在画布、调色板、导出图里都与白珠几乎无法区分。

本特性让 **H1 透明珠**在视觉上被正确呈现：一个**透明底 + X（双对角线）**标记的格子，区别于空格、也区别于白珠。

### 使用场景

1. **填补小片空白**：在需要一颗物理珠子、但不要颜色的位置放透明珠。
2. **在某一图层视觉覆盖下层**：透明珠是真实占格的珠子，放在上层时会在合成图里覆盖（隐藏）下层珠子——这与现有 `mergeLayers` 的「上层非空覆盖下层」语义一致，无需改动。

## 决策（已与用户确认）

| 决策点 | 选择 |
| --- | --- |
| 适用色号 | **仅 H1**（T1 仍按近白实心渲染，但保持配色排除不变） |
| 视觉样式 | **透明底 + X 双对角线** |
| 图层合成 | **覆盖隐藏下层**（沿用 `mergeLayers` top-wins，不改合成逻辑） |
| 导出范围 | **编辑器 + 导出都改**（JS `browser.ts` 与 Rust `image_export.rs` 两端） |

## 非目标（Out of Scope）

- T1 的透明渲染（保持现状）。
- 给 `MardColor` 增加通用 `transparent` 字段 / 支持任意多个透明珠（YAGNI，当前仅 H1）。
- h5（`platforms/h5/packages/client`）与 weapp 的独立渲染器——它们不复用主 `src/`，列为后续跟进。
- 改动图层合成、统计/BOM、自动配色（这些对 H1 已是正确行为，无需动）。

## 架构与改动点

采用**集中式 helper + 渲染时特判**方案。两个正交概念保持分离：

- **配色排除**：`TRANSPARENT_CODES = {H1, T1}`（不动）。
- **透明渲染**：仅 H1（新增）。

### 1. 模型层 — `src/data/mard221.ts`

新增并导出：

```ts
/** Index of the transparent bead (H1) in MARD_COLORS. Rendered see-through with an X. */
export const TRANSPARENT_BEAD_INDEX = MARD_COLORS.findIndex((c) => c.code === "H1");

/** True when a color index is the transparent bead (H1). */
export function isTransparentBead(index: number | null | undefined): boolean {
  return index != null && index === TRANSPARENT_BEAD_INDEX;
}
```

渲染热路径里用 `index === TRANSPARENT_BEAD_INDEX` 直接比较以避免函数调用开销；非热路径用 `isTransparentBead`。导出两端（不持有 index）以 `color_code === "H1"` 判定。

### 2. 编辑器渲染 — `src/utils/canvasRenderer.ts` → `renderPixels`

在每个非空 cell 的绘制分支里，当 `cell.colorIndex === TRANSPARENT_BEAD_INDEX`：

- **不画实心 hex 填充**：保持透明底，露出 `PixelCanvas` 的画布背景（pegboard）。
- **画 X**：两条对角线（左上↘右下、右上↙左下）。
  - 描边色：`rgba(80,80,80,0.6)`（深灰半透明，浅底深底都可见）。
  - 线宽：`Math.max(1, cellSize * 0.08)`。
  - 留 ~12% 内边距，X 不顶到格子边缘。
  - `cellSize` 极小（如 `< 6`）时退化为**单条对角线**，避免糊成一团。
- **blueprint / textOnly 模式**：底仍透明（不实心填充），照旧绘制「H1」码字（现有逻辑保留）。码字对比色按透明底当作浅底处理（深色字）。
- **highlight / dim**：照常生效（高亮描边、非高亮变暗逻辑不变）。

抽出一个内部 helper `drawTransparentMarker(ctx, x, y, cellSize)` 供复用，避免重复对角线代码。

### 3. 调色板 — `src/components/Palette/ColorPalette.tsx`

H1 的色块不再渲染成与 H2 白几乎一样的近白方块，而是**透明底 + X 覆盖层**，让用户在调色板里一眼认出「透明珠」：

- 用一个小的覆盖 `<span>`/伪元素叠加对角线（CSS `linear-gradient` 画 X，或一个内联 SVG），底用浅中性色（如 `#f0f0f0`）以便边框内可见。
- 走 `isTransparentBead(index)` 集中判断，所有渲染 swatch 的位置（主网格、当前选中预览、替换色预览等）统一处理。

### 4. 合成 / 统计 / 配色（无改动，仅验证）

- `mergeLayers`（`editorStore.ts:259`）上层非空覆盖下层 → 满足「覆盖隐藏下层」。
- BOM/统计按 colorIndex 计数 → H1 照常计入「H1 × N」。
- 自动配色（`colorMatching.ts` / `getGroupIndices`）已排除 H1。

### 5. 导出 — 两端都画透明 X

导出用的 `CellData` 携带 `color_code`，导出背景为白色。透明珠在导出图里 = **露出白底 + 画灰色 X**。

- **JS 端 `src/adapters/browser.ts`**：在「Draw cells」循环里，若 `cell.color_code === "H1"`：跳过 `fillRect`（保留白底），改用对角线 `stroke` 画 X（复用与编辑器一致的样式比例）。后续「Color codes」文字循环对 H1 仍照旧（可显示 H1 码）。
- **Rust 端 `src-tauri/src/commands/image_export.rs`**：在「Draw cells」循环（约 line 273）里，若 `cell_data.color_code == "H1"`：跳过像素填充（保留白底），用线段绘制 X（`imageproc::drawing::draw_line_segment_mut`，灰色 `Rgba([80,80,80,255])`）。码字绘制照旧。

两端样式参数（内边距比例、线宽比例、灰色值）保持一致，确保导出与编辑器观感统一。

## 测试

- **`canvasRenderer` 单测**（`src/utils/canvasRenderer.test.ts`，新建或扩展）：用 mock 2D ctx 断言——放置 H1 的格子**不**触发实心 `fillRect`，但触发对角线 `moveTo`/`lineTo`/`stroke`；普通色仍走 `fillRect`；空格两者都不触发。
- **VS Code webview Playwright**（`platforms/vscode/tests/*.spec.ts`，按 CLAUDE.md 要求）：通过 `callAction` 放置 H1 与 H2 与空格，断言三者渲染可区分（至少断言 store/canvas 状态与一次渲染快照差异）。
- **导出回归**：
  - JS 端可在 webview 测试里对 `browser.ts` 导出 canvas 做像素断言（H1 格中心区域为白底、对角线像素为灰）。
  - Rust 端在 `image_export` 现有测试（`blueprint_test.rs` 同目录）补一个用例：含 H1 的小网格导出后，断言该格背景未被填成 H1 的 rgb、且对角线像素存在。
- 运行 `npm run test:webview`（发布 VS Code 扩展前必跑）。

## 风险与注意

- **向后兼容**：老 `.pindou` 文件里已有的 H1 会**自动**开始按透明渲染——这正是期望行为，无需迁移。
- **小 cellSize 可读性**：缩略图/小格下 X 易糊，已用「退化为单对角线」处理；缩略图渲染（`PreviewThumbnail`）若 cellSize 过小可考虑只留透明底不画线。
- **导出白底语义**：导出图透明珠呈现为「白底 + X」而非真正 alpha 透明，符合纸面图纸直觉；如将来需要真 alpha PNG 再议。
- **样式一致性**：编辑器、调色板、JS 导出、Rust 导出四处各有一份 X 绘制；通过统一的样式比例常量降低漂移风险（Rust 端需手写对应常量）。
