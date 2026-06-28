# 透明珠（H1）实现计划 — Transparent Bead H1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 MARD 调色板的 H1 作为「透明珠」被正确呈现——透明底 + X 双对角线，区别于空格与白珠，覆盖编辑器画布、调色板、JS 导出、Rust 导出四处。

**Architecture:** 集中式 helper（`mard221.ts` 加 `TRANSPARENT_BEAD_INDEX`/`isTransparentBead`）+ 共享的 X 绘制函数（`canvasRenderer.ts` 的 `drawTransparentBeadMarker`，被编辑器渲染与 JS 导出复用）+ 渲染时特判。图层合成、统计、自动配色对 H1 已是正确行为，不改动。

**Tech Stack:** TypeScript + React + Canvas 2D（前端）；Rust + `image`/`imageproc`（Tauri 导出）；Vitest（前端单测）；Playwright（VS Code webview 测试）；`cargo test`（Rust 测试）。

**设计依据：** `docs/superpowers/specs/2026-06-28-transparent-bead-h1-design.md`

---

### Task 1: 模型层 helper（H1 索引与判定）

**Files:**
- Modify: `src/data/mard221.ts`（在文件末尾，`getGroupIndices` 之后追加）
- Test: `src/data/mard221.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

新建 `src/data/mard221.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { MARD_COLORS, TRANSPARENT_BEAD_INDEX, isTransparentBead } from "./mard221";

describe("TRANSPARENT_BEAD_INDEX", () => {
  it("points at the H1 color", () => {
    expect(TRANSPARENT_BEAD_INDEX).toBeGreaterThanOrEqual(0);
    expect(MARD_COLORS[TRANSPARENT_BEAD_INDEX].code).toBe("H1");
  });
});

describe("isTransparentBead", () => {
  it("is true only for the H1 index", () => {
    expect(isTransparentBead(TRANSPARENT_BEAD_INDEX)).toBe(true);
  });
  it("is false for other colors (incl. H2 white)", () => {
    const h2 = MARD_COLORS.findIndex((c) => c.code === "H2");
    expect(isTransparentBead(h2)).toBe(false);
    expect(isTransparentBead(0)).toBe(false);
  });
  it("is false for null/undefined (empty cell)", () => {
    expect(isTransparentBead(null)).toBe(false);
    expect(isTransparentBead(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/data/mard221.test.ts`
Expected: FAIL —「TRANSPARENT_BEAD_INDEX is not exported」/ undefined。

- [ ] **Step 3: 实现**

在 `src/data/mard221.ts` 末尾（`getGroupIndices` 函数之后）追加：

```ts
/** Index of the transparent bead (H1) in MARD_COLORS. Rendered see-through with
 * an X marker rather than a solid fill. Distinct from an empty cell (null) and
 * from the white bead (H2). */
export const TRANSPARENT_BEAD_INDEX = MARD_COLORS.findIndex((c) => c.code === "H1");

/** True when a color index is the transparent bead (H1). */
export function isTransparentBead(index: number | null | undefined): boolean {
  return index != null && index === TRANSPARENT_BEAD_INDEX;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/data/mard221.test.ts`
Expected: PASS（3 个 describe 全绿）。

- [ ] **Step 5: 提交**

```bash
git add src/data/mard221.ts src/data/mard221.test.ts
git commit -m "feat(palette): add TRANSPARENT_BEAD_INDEX + isTransparentBead helper for H1"
```

---

### Task 2: 共享 X 绘制函数 + 编辑器渲染特判

**Files:**
- Modify: `src/utils/canvasRenderer.ts`（顶部加 import；新增导出函数；改 `renderPixels` 的填充分支，约 50-62 行）
- Test: `src/utils/canvasRenderer.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

新建 `src/utils/canvasRenderer.test.ts`：

```ts
import { describe, it, expect, vi } from "vitest";
import { drawTransparentBeadMarker, renderPixels } from "./canvasRenderer";
import { TRANSPARENT_BEAD_INDEX } from "../data/mard221";
import type { CanvasData } from "../types";

function mockCtx() {
  return {
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    textAlign: "",
    textBaseline: "",
  } as unknown as CanvasRenderingContext2D;
}

const baseOpts = {
  cellSize: 20,
  offsetX: 0,
  offsetY: 0,
  viewWidth: 100,
  viewHeight: 100,
};

describe("drawTransparentBeadMarker", () => {
  it("draws a full X at normal cell size (no fill)", () => {
    const ctx = mockCtx();
    drawTransparentBeadMarker(ctx, 0, 0, 20);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    // full X = two segments = two moveTo + two lineTo
    expect((ctx.moveTo as any).mock.calls.length).toBe(2);
    expect((ctx.lineTo as any).mock.calls.length).toBe(2);
  });
  it("degrades to a single diagonal at tiny cell size", () => {
    const ctx = mockCtx();
    drawTransparentBeadMarker(ctx, 0, 0, 4);
    expect((ctx.moveTo as any).mock.calls.length).toBe(1);
    expect((ctx.lineTo as any).mock.calls.length).toBe(1);
  });
});

describe("renderPixels transparent bead", () => {
  it("does NOT solid-fill the H1 cell but strokes a marker", () => {
    const ctx = mockCtx();
    const data: CanvasData = [[{ colorIndex: TRANSPARENT_BEAD_INDEX }]];
    renderPixels(ctx, { ...baseOpts, canvasData: data });
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
  });
  it("solid-fills a normal color cell", () => {
    const ctx = mockCtx();
    const data: CanvasData = [[{ colorIndex: 0 }]];
    renderPixels(ctx, { ...baseOpts, canvasData: data });
    expect(ctx.fillRect).toHaveBeenCalled();
  });
  it("draws nothing for an empty cell", () => {
    const ctx = mockCtx();
    const data: CanvasData = [[{ colorIndex: null }]];
    renderPixels(ctx, { ...baseOpts, canvasData: data });
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/utils/canvasRenderer.test.ts`
Expected: FAIL —「drawTransparentBeadMarker is not exported」。

- [ ] **Step 3: 实现 — 新增 import 与函数**

在 `src/utils/canvasRenderer.ts` 顶部 import 区追加：

```ts
import { TRANSPARENT_BEAD_INDEX } from "../data/mard221";
```

在 `renderPixels` 函数定义**之前**新增导出函数：

```ts
/**
 * Draw the transparent-bead (H1) marker: an X (two diagonals) over a see-through
 * cell. At very small cell sizes it degrades to a single diagonal so it stays
 * legible. The caller MUST NOT fill the cell first — the transparent base is the
 * point. Shared by the editor canvas and the JS export path.
 */
export function drawTransparentBeadMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cellSize: number
): void {
  const pad = cellSize * 0.12;
  const x0 = x + pad;
  const y0 = y + pad;
  const x1 = x + cellSize - pad;
  const y1 = y + cellSize - pad;
  ctx.strokeStyle = "rgba(80,80,80,0.6)";
  ctx.lineWidth = Math.max(1, cellSize * 0.08);
  ctx.beginPath();
  ctx.moveTo(x0, y0);          // top-left → bottom-right
  ctx.lineTo(x1, y1);
  if (cellSize >= 6) {
    ctx.moveTo(x1, y0);        // top-right → bottom-left (full X)
    ctx.lineTo(x0, y1);
  }
  ctx.stroke();
}
```

- [ ] **Step 4: 实现 — 改 `renderPixels` 填充分支**

在 `renderPixels` 内，找到当前的填充块：

```ts
        if (!textOnly) {
          ctx.fillStyle = color.hex || "#FF00FF";
          ctx.fillRect(x, y, cellSize, cellSize);

          // Blueprint mode: draw cell border
```

替换为（仅改填充那两行，其余保留）：

```ts
        if (!textOnly) {
          if (cell.colorIndex === TRANSPARENT_BEAD_INDEX) {
            drawTransparentBeadMarker(ctx, x, y, cellSize);
          } else {
            ctx.fillStyle = color.hex || "#FF00FF";
            ctx.fillRect(x, y, cellSize, cellSize);
          }

          // Blueprint mode: draw cell border
```

> 说明：`blueprintMode` 的描边、`hasHighlight` 的变暗、以及后面的蓝图码字逻辑全部保留不动——H1 在蓝图模式下仍显示「H1」码字，底透明。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run src/utils/canvasRenderer.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/utils/canvasRenderer.ts src/utils/canvasRenderer.test.ts
git commit -m "feat(canvas): render H1 transparent bead as see-through X marker"
```

---

### Task 3: 调色板色块叠加 X（可发现性）

**Files:**
- Modify: `src/components/Palette/ColorPalette.tsx`（line 2 import；主网格 `<button>` 内追加覆盖层，约 269-273 行；选中色预览 swatch，约 283 行）

> 纯视觉 CSS 覆盖层，无单测；行为由 Task 6 的 webview 测试与人工核对覆盖。

- [ ] **Step 1: 加 import**

把第 2 行：

```ts
import { MARD_COLORS, COLOR_GROUPS, getGroupIndices, groupIndicesByLetter } from "../../data/mard221";
```

改为：

```ts
import { MARD_COLORS, COLOR_GROUPS, getGroupIndices, groupIndicesByLetter, isTransparentBead } from "../../data/mard221";
```

- [ ] **Step 2: 定义可复用覆盖层组件**

在 `ColorPalette.tsx` 中、组件函数之外（如紧跟 `textColor` 辅助函数之后，约 line 18），新增：

```tsx
/** A faint X overlay marking the H1 transparent bead in swatches. */
function TransparentBeadOverlay() {
  return (
    <span
      className="absolute inset-0 pointer-events-none rounded-sm"
      style={{
        backgroundImage:
          "linear-gradient(to bottom right, transparent 44%, rgba(80,80,80,0.6) 44%, rgba(80,80,80,0.6) 56%, transparent 56%)," +
          "linear-gradient(to top right, transparent 44%, rgba(80,80,80,0.6) 44%, rgba(80,80,80,0.6) 56%, transparent 56%)",
      }}
    />
  );
}
```

- [ ] **Step 3: 主网格 button 内叠加覆盖层**

在主网格 `<button>` 的子节点里（当前是 `{color.code}` 与 override 小圆点），在 `{color.code}` 之后追加：

```tsx
                    {color.code}
                    {isTransparentBead(index) && <TransparentBeadOverlay />}
                    {colorOverrides.has(index) && (
                      <span className="absolute top-0 right-0 w-1.5 h-1.5 bg-orange-400 rounded-full" />
                    )}
```

- [ ] **Step 4: 选中色预览 swatch 叠加覆盖层**

找到选中色信息区的预览方块（约 line 283）：

```tsx
            <div
              className="w-6 h-6 rounded border border-gray-300 shrink-0"
              style={{ backgroundColor: getEffectiveHex(selectedColorIndex, colorOverrides) }}
            />
```

改为（加 `relative` 与条件覆盖层）：

```tsx
            <div
              className="relative w-6 h-6 rounded border border-gray-300 shrink-0"
              style={{ backgroundColor: getEffectiveHex(selectedColorIndex, colorOverrides) }}
            >
              {isTransparentBead(selectedColorIndex) && <TransparentBeadOverlay />}
            </div>
```

- [ ] **Step 5: 构建确认无类型错误**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无报错（与本特性相关）。

- [ ] **Step 6: 提交**

```bash
git add src/components/Palette/ColorPalette.tsx
git commit -m "feat(palette): overlay X on H1 swatch so transparent bead is recognizable"
```

---

### Task 4: JS 导出（browser.ts）复用 X 绘制

**Files:**
- Modify: `src/adapters/browser.ts`（顶部 import；「Draw cells」循环，约 351-360 行）

> 复用 Task 2 的 `drawTransparentBeadMarker`，行为由 Task 6 的导出像素断言覆盖。

- [ ] **Step 1: 加 import**

在 `src/adapters/browser.ts` 顶部 import 区追加：

```ts
import { drawTransparentBeadMarker } from "../utils/canvasRenderer";
```

- [ ] **Step 2: 改「Draw cells」循环**

当前：

```ts
        const cell = cells[row]?.[col];
        if (cell) {
          ctx.fillStyle = `rgb(${cell.r},${cell.g},${cell.b})`;
          ctx.fillRect(col * cell_size, row * cell_size, cell_size, cell_size);
        }
```

替换为：

```ts
        const cell = cells[row]?.[col];
        if (cell) {
          if (cell.color_code === "H1") {
            drawTransparentBeadMarker(ctx, col * cell_size, row * cell_size, cell_size);
          } else {
            ctx.fillStyle = `rgb(${cell.r},${cell.g},${cell.b})`;
            ctx.fillRect(col * cell_size, row * cell_size, cell_size, cell_size);
          }
        }
```

> 背景已是白色（`#FFFFFF`），H1 跳过填充即露出白底 + X。后面的「Color codes」文字循环不动，H1 仍可显示码字。

- [ ] **Step 3: 构建确认无类型错误**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无报错。

- [ ] **Step 4: 提交**

```bash
git add src/adapters/browser.ts
git commit -m "feat(export): draw H1 transparent bead as X in browser PNG export"
```

---

### Task 5: Rust 导出（image_export.rs）画 X

**Files:**
- Modify: `src-tauri/src/commands/image_export.rs`（line 3 import；「Draw cells」循环，约 278-285 行）
- Test: `src-tauri/src/commands/blueprint_test.rs`（在 `mod tests` 内追加一个测试）

- [ ] **Step 1: 写失败测试**

在 `src-tauri/src/commands/blueprint_test.rs` 的 `mod tests { ... }` 内追加：

```rust
    #[test]
    fn test_h1_transparent_bead_not_filled() {
        use image::GenericImageView;
        let cs: u32 = 40;
        // single H1 cell with a deliberately NON-white rgb so we can detect a fill
        let cells: Vec<Vec<Option<CellData>>> = vec![vec![Some(CellData {
            color_code: "H1".to_string(),
            r: 10,
            g: 200,
            b: 30,
        })]];

        let test_dir = std::env::temp_dir().join("pindouverse_test");
        fs::create_dir_all(&test_dir).unwrap();
        let export_path = test_dir.join("test_h1.png");
        let path_str = export_path.to_string_lossy().to_string();

        let request = ExportRequest {
            width: 1,
            height: 1,
            cell_size: cs,
            cells,
            output_path: path_str.clone(),
            format: "png".to_string(),
            start_x: Some(0),
            start_y: Some(0),
            edge_padding: Some(0),
            watermark: None,
            legend_options: None,
        };
        export_image(request).expect("Export failed");

        let img = image::open(&path_str).expect("reopen").to_rgba8();
        // The H1 cell must NOT be filled with its (10,200,30) rgb anywhere.
        let mut green_fill = 0u32;
        for p in img.pixels() {
            if p[0] == 10 && p[1] == 200 && p[2] == 30 {
                green_fill += 1;
            }
        }
        assert_eq!(green_fill, 0, "H1 cell should not be solid-filled with its rgb");

        // And there must be some gray X ink (around rgb 80,80,80).
        let mut gray_ink = 0u32;
        for p in img.pixels() {
            if (p[0] as i32 - 80).abs() < 30
                && (p[1] as i32 - 80).abs() < 30
                && (p[2] as i32 - 80).abs() < 30
            {
                gray_ink += 1;
            }
        }
        assert!(gray_ink > 0, "expected gray X strokes for the H1 transparent bead");

        let _ = fs::remove_file(&path_str);
    }
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src-tauri && cargo test test_h1_transparent_bead_not_filled`
Expected: FAIL —`green_fill` 不为 0（当前 H1 被实心填成 10,200,30），或无灰色 X。

- [ ] **Step 3: 实现 — 加 import**

把 `src-tauri/src/commands/image_export.rs` 第 3 行：

```rust
use imageproc::drawing::draw_text_mut;
```

改为：

```rust
use imageproc::drawing::{draw_text_mut, draw_line_segment_mut};
```

- [ ] **Step 4: 实现 — 改「Draw cells」分支**

当前（约 278-285 行）：

```rust
            if let Some(cell_data) = cell {
                for dy in 0..cs {
                    for dx in 0..cs {
                        let px = x0 + dx;
                        let py = y0 + dy;
                        if px < img_width && py < img_height {
                            img.put_pixel(px, py, Rgba([cell_data.r, cell_data.g, cell_data.b, 255]));
                        }
                    }
                }
```

替换为（H1 走透明 X 分支；其余照旧填充）：

```rust
            if let Some(cell_data) = cell {
                if cell_data.color_code == "H1" {
                    // Transparent bead: leave the white background, draw a gray X.
                    let ink = Rgba([80u8, 80, 80, 255]);
                    let pad = cs as f32 * 0.12;
                    let a = (x0 as f32 + pad, y0 as f32 + pad);
                    let b = (x0 as f32 + cs as f32 - pad, y0 as f32 + cs as f32 - pad);
                    let c = (x0 as f32 + cs as f32 - pad, y0 as f32 + pad);
                    let d = (x0 as f32 + pad, y0 as f32 + cs as f32 - pad);
                    // ~2px thick by drawing each diagonal twice with a 1px offset
                    for off in 0..2i32 {
                        let o = off as f32;
                        draw_line_segment_mut(&mut img, (a.0, a.1 + o), (b.0, b.1 + o), ink);
                        draw_line_segment_mut(&mut img, (c.0, c.1 + o), (d.0, d.1 + o), ink);
                    }
                } else {
                    for dy in 0..cs {
                        for dx in 0..cs {
                            let px = x0 + dx;
                            let py = y0 + dy;
                            if px < img_width && py < img_height {
                                img.put_pixel(px, py, Rgba([cell_data.r, cell_data.g, cell_data.b, 255]));
                            }
                        }
                    }
                }
```

> 注意：上面替换的是 `if let Some(cell_data) = cell {` 之后的**填充循环**。其后的码字绘制（`text_color`/`draw_text_mut`）保持原样不动，闭合花括号结构不变——`else` 块内即原填充循环，原 `}` 仍闭合 `if let`。

- [ ] **Step 5: 运行测试确认通过**

Run: `cd src-tauri && cargo test test_h1_transparent_bead_not_filled`
Expected: PASS。

- [ ] **Step 6: 跑一遍既有导出回归确保没破坏**

Run: `cd src-tauri && cargo test`
Expected: 既有 roundtrip 等测试全过。

- [ ] **Step 7: 提交**

```bash
git add src-tauri/src/commands/image_export.rs src-tauri/src/commands/blueprint_test.rs
git commit -m "feat(export): draw H1 transparent bead as X in Rust PNG export"
```

---

### Task 6: VS Code webview Playwright 测试（三方可区分）

**Files:**
- Create: `platforms/vscode/tests/transparent-bead.spec.ts`

> 按 CLAUDE.md：新增 extension 功能须加 webview 测试。用「空格 0 < H1 的 X < 实心珠」像素数排序证明 H1 与空格、与白珠均可区分。

- [ ] **Step 1: 写测试**

新建 `platforms/vscode/tests/transparent-bead.spec.ts`：

```ts
import { test, expect } from "@playwright/test";
import { setupPage, callAction, countRenderedPixels } from "./helpers";
import { MARD_COLORS, TRANSPARENT_BEAD_INDEX } from "../../../src/data/mard221";

const H2_WHITE_INDEX = MARD_COLORS.findIndex((c) => c.code === "H2");

test.describe("H1 transparent bead", () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page);
  });

  test("renders distinctly from empty and from a solid bead", async ({ page }) => {
    // 1) empty canvas baseline
    const emptyCount = await countRenderedPixels(page);

    // 2) place a solid white (H2) bead at (0,0)
    await callAction(page, "setCell", [0, 0, H2_WHITE_INDEX]);
    const solidCount = await countRenderedPixels(page);
    expect(solidCount).toBeGreaterThan(emptyCount);

    // 3) replace with the H1 transparent bead at the same cell
    await callAction(page, "setCell", [0, 0, TRANSPARENT_BEAD_INDEX]);
    const transparentCount = await countRenderedPixels(page);

    // The X marker draws *some* ink (distinct from empty)...
    expect(transparentCount).toBeGreaterThan(emptyCount);
    // ...but far less than a fully-filled solid bead (distinct from white).
    expect(transparentCount).toBeLessThan(solidCount);
  });
});
```

- [ ] **Step 2: 运行测试确认通过**

Run: `cd platforms/vscode && npm run test:webview -- transparent-bead`
Expected: PASS。若 `setCell` 后画布未自动重绘，改用 `await callAction(page, "setCell", ...)` 后加 `await page.waitForTimeout(50)` 再计数（渲染是 rAF 驱动）。

- [ ] **Step 3: 跑完整 webview 套件确保无回归**

Run: `cd platforms/vscode && npm run test:webview`
Expected: 全部通过（原 42 测试 + 新测试）。

- [ ] **Step 4: 提交**

```bash
git add platforms/vscode/tests/transparent-bead.spec.ts
git commit -m "test(vscode): webview test distinguishing H1 transparent bead"
```

---

### Task 7: 全量验证与收尾

**Files:** 无（仅运行）

- [ ] **Step 1: 前端单测全过**

Run: `npx vitest run`
Expected: 全绿（含新增 `mard221.test.ts`、`canvasRenderer.test.ts`）。

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无报错。

- [ ] **Step 3: Rust 测试全过**

Run: `cd src-tauri && cargo test`
Expected: 全绿。

- [ ] **Step 4: webview 套件全过**

Run: `cd platforms/vscode && npm run test:webview`
Expected: 全绿。

- [ ] **Step 5: 人工核对（编辑器 + 导出）**

- 启动桌面/扩展，选 H1 画几格：画布上应是透明底 + 灰色 X，区别于空格与白珠 H2。
- 调色板里 H1 色块应有 X 覆盖层。
- 导出一张含 H1 的图（PNG）：H1 格为白底 + 灰 X，不是白色实心方块。

- [ ] **Step 6: 收尾合并**

按 CLAUDE.md 的 Git 工作流，将 `feature/transparent-bead-h1` squash 合并回 main：

```bash
git checkout main
git merge --squash feature/transparent-bead-h1
git commit -m "feat: H1 transparent bead — see-through X in editor, palette, and exports"
git branch -D feature/transparent-bead-h1
```

---

## 自查（Self-Review）

**Spec 覆盖：**
- 模型层 `TRANSPARENT_BEAD_INDEX`/`isTransparentBead` → Task 1 ✓
- 编辑器渲染（透明底 + X、小格退化、蓝图码字保留）→ Task 2 ✓
- 调色板 X 覆盖 → Task 3 ✓
- 合成/统计/配色不改 → 无 Task（设计明确为 no-op），Task 7 人工核对兜底 ✓
- 导出两端（JS + Rust）→ Task 4、Task 5 ✓
- 测试（canvasRenderer 单测、webview、Rust 导出）→ Task 2/5/6 ✓

**占位符扫描：** 无 TBD/TODO；每个代码步骤均含完整代码。

**类型/命名一致性：** `drawTransparentBeadMarker`（Task 2 定义，Task 4 复用）、`TRANSPARENT_BEAD_INDEX`/`isTransparentBead`（Task 1 定义，Task 2/3/6 复用）、导出侧统一用 `color_code === "H1"`（Task 4/5）——命名一致。X 样式常量（pad 0.12、灰 80/80/80、线宽 0.08）在四处手工对齐（canvasRenderer、Rust），设计已记此漂移风险。
